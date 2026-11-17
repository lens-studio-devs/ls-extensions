#!/usr/bin/env node
// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// verify-scripts.js — the scripts step's whole static gate, in ONE call.
//
// One pass over the authored scripts, all lifecycle/static checks, machine-readable
// verdict — catches defects that compile clean but fail at runtime (e.g. an entry
// onAwake() calling into sibling ScriptComponents before they have awoken). Run it
// BEFORE the final recompile, fix every `error`, then recompile once.
//
// Usage:
//   node verify-scripts.js <scripts-dir> [--json] [--music-asset <Name>.wav ...]
//                          [--icon <name>.png ...]
//     <scripts-dir>   usually <project>/Assets/Scripts
//     --json          print only the JSON verdict (default prints JSON + a summary line)
//     --music-asset   name a generated music file so the play(-1) check is exact
//                     (repeatable; without it the check falls back to name matching)
//     --icon          an imported icon from the icon payload's `imported[]`; each one
//                     must be referenced by some requireAsset or it is an orphan
//                     (repeatable)
//
// Exit: 0 = no errors (warnings may exist), 1 = at least one error, 2 = usage error.
//
// Findings are {level, check, file, line, message}. `error` means it will not run or
// violates a Hard Rule; `warn` means a real issue you must consciously accept and
// report in `deviations[]`.

const fs = require("fs");
const path = require("path");

// Escape regex metacharacters so an interpolated identifier is matched literally.
// TS identifiers can contain `$` (e.g. `stream$`), which is a regex anchor — left
// unescaped it silently breaks the RegExp built from a name.
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// A "sibling" @input is one typed as another ScriptComponent CLASS authored in this
// same project — the lifecycle hazard, because its own onAwake may not have run yet.
// Everything else (SceneObject, a UIKit element, a platform Component, a number) is
// not: touching those in onAwake is a different, milder rule.
// Detected structurally, not by name list: `class X extends BaseScriptComponent`.
function scriptClassNames(sources) {
  const names = new Set();
  for (const src of sources) {
    const re = /class\s+([A-Za-z_$][\w$]*)\s+extends\s+BaseScriptComponent\b/g;
    let m;
    while ((m = re.exec(src)) !== null) names.add(m[1]);
  }
  return names;
}

function baseTypeName(t) {
  return (t || "").replace(/\s/g, "").replace(/\|(null|undefined)$/g, "").replace(/\[\]$/, "");
}

// ---------------------------------------------------------------------------
// Deferred code is not onAwake code. Everything inside an arrow-function body runs
// later (an OnStartEvent bind, an event .add(), a delayed callback), so it must not be
// read as onAwake work — only the call that REGISTERS it is onAwake work.
function stripDeferredCallbacks(src) {
  const out = src.split("");
  let i = 0;
  while (i < out.length - 1) {
    if (out[i] === "=" && out[i + 1] === ">") {
      let j = i + 2;
      while (j < out.length && /\s/.test(out[j])) j++;
      if (out[j] === "{") {
        let depth = 0;
        for (let k = j; k < out.length; k++) {
          if (out[k] === "{") depth++;
          else if (out[k] === "}") {
            depth--;
            if (depth === 0) {
              blank(out, j + 1, k);
              i = k;
              break;
            }
          }
        }
      } else {
        // single-expression arrow: blank to the end of the enclosing call
        let depth = 0;
        let terminated = false;
        for (let k = j; k < out.length; k++) {
          const c = out[k];
          if (c === "(" || c === "[") depth++;
          else if (c === ")" || c === "]") {
            if (depth === 0) {
              blank(out, j, k);
              i = k;
              terminated = true;
              break;
            }
            depth--;
          } else if ((c === "," || c === ";" || c === "\n") && depth === 0) {
            blank(out, j, k);
            i = k;
            terminated = true;
            break;
          }
        }
        // An arrow body that runs to EOF has no closing terminator; blank the rest
        // so its deferred code is not misread as onAwake work.
        if (!terminated) {
          blank(out, j, out.length);
          i = out.length;
        }
      }
    }
    i++;
  }
  return out.join("");
}

function blank(chars, from, to) {
  for (let k = from; k < to; k++) if (chars[k] !== "\n") chars[k] = " ";
}

// Body of `name(...) { ... }` (a class method), brace-matched. Returns {body, offset}.
function methodBody(src, name) {
  const re = new RegExp(`(?:^|\\s)(?:public\\s+|private\\s+|protected\\s+)?${escapeRegExp(name)}\\s*\\([^)]*\\)\\s*(?::\\s*[A-Za-z<>\\[\\]|. ]+\\s*)?\\{`, "m");
  const m = re.exec(src);
  if (!m) return null;
  const open = src.indexOf("{", m.index + m[0].length - 1);
  let depth = 0;
  for (let k = open; k < src.length; k++) {
    if (src[k] === "{") depth++;
    else if (src[k] === "}") {
      depth--;
      if (depth === 0) return { body: src.slice(open + 1, k), offset: open + 1 };
    }
  }
  return null;
}

function lineOf(src, index) {
  return src.slice(0, index).split("\n").length;
}

// ---------------------------------------------------------------------------
function declaredInputs(src) {
  const inputs = [];
  // Handles both `@input\n<prop>` (multi-line) and `@input <prop>` (single-line),
  // an optional hint arg (`@input('float')`), and comment lines between the two.
  const re = /@input\b\s*(?:\([^)]*\)\s*)?(?:\/\/[^\n]*\n\s*)*(?:private\s+|public\s+|protected\s+)?([A-Za-z_$][\w$]*)\s*[!?]?\s*:\s*([A-Za-z0-9_$.<>\[\]| ]+)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    inputs.push({ name: m[1], type: m[2].trim().replace(/[;=].*$/, "").trim(), index: m.index });
  }
  return inputs;
}

// Local method names declared on the class (so we can follow onAwake -> helper calls).
function declaredMethods(src) {
  const names = new Set();
  const re = /(?:^|\n)\s*(?:public\s+|private\s+|protected\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[A-Za-z<>\[\]|. ]+\s*)?\{/g;
  let m;
  while ((m = re.exec(src)) !== null) names.add(m[1]);
  for (const kw of ["if", "for", "while", "switch", "catch", "function", "return"]) names.delete(kw);
  return names;
}

// Cross-component access in a chunk of (deferred-stripped) code:
//   this.<siblingHandle>.<anything>   — call or property write on a script-typed @input
function crossComponentHits(chunk, siblingNames) {
  const hits = [];
  if (!siblingNames.size) return hits;
  // The trailing `(` (call), `.` (chained access, e.g. this.panel.onStart.add(...)),
  // or `=` (write) all mean the sibling was touched — reading .onStart before its
  // onAwake ran is as unsafe as calling a method on it.
  const re = /this\.([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*(\(|\.|=[^=])/g;
  let m;
  while ((m = re.exec(chunk)) !== null) {
    if (!siblingNames.has(m[1])) continue;
    hits.push({
      index: m.index,
      handle: m[1],
      member: m[2],
      kind: m[3][0] === "(" ? "call" : m[3][0] === "." ? "access" : "write",
    });
  }
  return hits;
}

// Property writes through a non-sibling @input handle (SceneObject/Component/...).
function handleWrites(chunk, handleNames) {
  const hits = [];
  const re = /this\.([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$.]*)\s*=[^=]/g;
  let m;
  while ((m = re.exec(chunk)) !== null) {
    if (handleNames.has(m[1])) hits.push({ index: m.index, handle: m[1], member: m[2] });
  }
  return hits;
}

// ---------------------------------------------------------------------------
function checkFile(file, src, project, opts, findings) {
  const rel = path.basename(file);
  const isUiModule = /UI\.ts$/.test(rel) || rel === "UIKitHelpers.ts";
  const add = (level, check, index, message) =>
    findings.push({ level, check, file: rel, line: index == null ? null : lineOf(src, index), message });

  // --- 1. LIFECYCLE (the crash class) -------------------------------------
  const inputs = declaredInputs(src);
  const siblings = new Set(
    inputs.filter((i) => project.scriptClasses.has(baseTypeName(i.type))).map((i) => i.name)
  );
  const allHandles = new Set(inputs.map((i) => i.name));
  const awake = methodBody(src, "onAwake");
  if (awake) {
    const methods = declaredMethods(src);
    // Which local helpers are themselves unsafe? Fixpoint so onAwake -> a() -> b() is caught.
    const bodies = new Map();
    for (const name of methods) {
      if (name === "onAwake") continue;
      const b = methodBody(src, name);
      if (b) bodies.set(name, stripDeferredCallbacks(b.body));
    }
    const unsafe = new Map(); // name -> first offending member
    let changed = true;
    while (changed) {
      changed = false;
      for (const [name, body] of bodies) {
        if (unsafe.has(name)) continue;
        const direct = crossComponentHits(body, siblings)[0];
        if (direct) {
          unsafe.set(name, `${direct.handle}.${direct.member}`);
          changed = true;
          continue;
        }
        const callsUnsafe = [...unsafe.keys()].find((u) =>
          new RegExp(`this\\.${escapeRegExp(u)}\\s*\\(`).test(body)
        );
        if (callsUnsafe) {
          unsafe.set(name, `${callsUnsafe}() -> ${unsafe.get(callsUnsafe)}`);
          changed = true;
        }
      }
    }

    const awakeCode = stripDeferredCallbacks(awake.body);
    for (const hit of crossComponentHits(awakeCode, siblings)) {
      add("error", "lifecycle-onawake", awake.offset + hit.index,
        `onAwake ${hit.kind === "call" ? "calls" : hit.kind === "access" ? "accesses" : "writes"} this.${hit.handle}.${hit.member} — ` +
        `${hit.handle} is a sibling ScriptComponent whose own onAwake may not have run ` +
        `(TypeError: undefined is not a function). Move it into an OnStartEvent handler bound from onAwake.`);
    }
    for (const name of unsafe.keys()) {
      const re = new RegExp(`this\\.${escapeRegExp(name)}\\s*\\(`, "g");
      let m;
      while ((m = re.exec(awakeCode)) !== null) {
        add("error", "lifecycle-onawake", awake.offset + m.index,
          `onAwake calls this.${name}(), which reaches a sibling component (${unsafe.get(name)}). ` +
          `Bind it in OnStartEvent instead — cross-component work in onAwake crashes the Lens on the first frame.`);
      }
    }
    for (const hit of handleWrites(awakeCode, new Set([...allHandles].filter((h) => !siblings.has(h))))) {
      add("warn", "lifecycle-onawake-write", awake.offset + hit.index,
        `onAwake writes this.${hit.handle}.${hit.member} — property writes belong in OnStartEvent ` +
        `(onAwake is createSceneObject / createComponent / setParent only).`);
    }
    if (!/createEvent\(\s*["']OnStartEvent["']\s*\)/.test(src) && siblings.size)
      add("warn", "lifecycle-no-onstart", awake.offset,
        `declares ${siblings.size} sibling-component @input(s) but binds no OnStartEvent — ` +
        `cross-component wiring has nowhere safe to run.`);
  }

  // --- 2. Hard Rule 3: no UI primitives outside a *UI.ts module ------------
  if (!isUiModule) {
    // UIKit is matched on the import path (legacy SpectaclesUIKit.lspkg or 4.0 UIKit.lspkg), not on
    // raw text: a comment or a class name that merely mentions UIKit is not a UI primitive.
    for (const re of [/Component\.Text\b/g, /from\s+["'](?:[^"']*\/)?(?:Spectacles)?UIKit\.lspkg\b/g]) {
      let m;
      while ((m = re.exec(src)) !== null)
        add("error", "hard-rule-3", m.index,
          `${m[0]} outside a *UI.ts module — text and UIKit primitives live in the UI modules only.`);
    }
  }

  // --- 3. Type annotations that do not compile ----------------------------
  let m;
  const badType = /:\s*(Physics\.(?:ColliderComponent|BodyComponent))/g;
  while ((m = badType.exec(src)) !== null)
    add("error", "type-annotation", m.index,
      `${m[1]} is not a type — the component classes are global (ColliderComponent / BodyComponent). TS2503/TS2694.`);

  // --- 4. Generated music must actually play (project-wide: the manifest file
  //         names the asset, the audio controller is what loops it) ---------
  if (!project.loopsAudio) {
    const reqRe = /requireAsset\(\s*["']([^"']+)["']\s*\)/g;
    while ((m = reqRe.exec(src)) !== null) {
      const name = path.basename(m[1]);
      const isMusic = opts.musicAssets.length
        ? opts.musicAssets.includes(name)
        : /(music|bgm|theme|bed)/i.test(name);
      if (isMusic)
        add("error", "music-not-played", m.index,
          `${name} is required but no script calls play(-1) — the music renders and stays silent (the audit step hard-fails this).`);
    }
  }

  // --- 5. Declared-but-unwired @input knobs -------------------------------
  for (const inp of inputs) {
    const uses = (src.match(new RegExp(`this\\.${escapeRegExp(inp.name)}\\b`, "g")) || []).length;
    if (uses === 0)
      add("warn", "unused-input", inp.index,
        `@input ${inp.name} is declared but never read — either wire it to behaviour or delete it ` +
        `(a knob that changes nothing reads as a feature).`);
  }

  // --- 6. Leftover placeholder markers ------------------------------------
  const todo = /TODO:?\s*(verify with aabb_cm|placeholder|fill in|wire)/gi;
  while ((m = todo.exec(src)) !== null)
    add("warn", "leftover-todo", m.index, `unresolved marker "${m[0]}" — the sizing/wiring pass did not close it.`);

  // --- 7. Prefab-instance scale overwrite (the invisible-prop class) -------
  // Every /build-mesh GLB instance carries the importer's baked localScale=100;
  // setLocalScale on the instance OVERWRITES it (1 -> 1% size, 0.2 -> a speck).
  // One measured build planted invisible crops exactly this way — the doc'd fix
  // (build-mesh prefab-scale-trap: scale a wrapper, never the instance) existed
  // and was skipped, so this is now a check, not just prose.
  const instVars = new Set();
  const instRe = /(?:const|let|var)\s+(\w+)\s*=\s*[\w.$\[\]]+\.instantiate\(/g;
  while ((m = instRe.exec(src)) !== null) instVars.add(m[1]);
  if (instVars.size) {
    const scaleRe = /(\w+)(?:\.getTransform\(\))?\.setLocalScale\(/g;
    while ((m = scaleRe.exec(src)) !== null)
      if (instVars.has(m[1]))
        add("error", "prefab-scale-overwrite", m.index,
          `setLocalScale on prefab instance '${m[1]}' overwrites the GLB's baked 100× import scale ` +
          `(1 means 1% of authored size — the object renders invisible). Scale a wrapper SceneObject ` +
          `and instantiate into it (build-mesh -> prefab-scale-trap).`);
  }

  // --- 8. Entry-file size -------------------------------------------------
  const lines = src.split("\n").length;
  if (lines > 400 && !/size reason|deliberately large|split deferred/i.test(src.slice(0, 2000)))
    add("warn", "file-size", null,
      `${lines} lines (> 400) with no size reason in the header — split it, or state the reason in the header contract.`);
}

// ---------------------------------------------------------------------------
function main() {
  const argv = process.argv.slice(2);
  const dir = argv.find((a) => !a.startsWith("--"));
  if (!dir) {
    process.stderr.write("usage: node verify-scripts.js <scripts-dir> [--json] [--music-asset <Name>.wav ...]\n");
    process.exit(2);
  }
  const opts = { json: argv.includes("--json"), musicAssets: [], icons: [] };
  argv.forEach((a, i) => {
    if (a === "--music-asset" && argv[i + 1]) opts.musicAssets.push(argv[i + 1]);
    if (a === "--icon" && argv[i + 1]) opts.icons.push(argv[i + 1]);
  });

  let names;
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".ts"));
  } catch (e) {
    process.stderr.write(`cannot read ${dir}: ${e.message}\n`);
    process.exit(2);
  }

  // Pass 1: project facts every per-file check needs (which classes are script
  // components, and whether ANY file loops audio).
  const files = [];
  for (const n of names.sort()) {
    const file = path.join(dir, n);
    try {
      files.push({ file, src: fs.readFileSync(file, "utf8") });
    } catch {
      // unreadable file is not a finding; the recompile will speak for it
    }
  }
  const project = {
    scriptClasses: scriptClassNames(files.map((f) => f.src)),
    loopsAudio: files.some((f) => /\.play\(\s*-1\s*\)/.test(f.src)),
  };

  // Pass 2: the checks.
  const findings = [];
  for (const { file, src } of files) checkFile(file, src, project, opts, findings);

  // Project-level: every imported icon must be referenced by some requireAsset.
  // An icon on disk and in the manifest that no script requires is an orphan — the
  // One measured build shipped an orphan icon and paid a ~145s fix agent for it
  // after audit-static caught it two steps later.
  if (opts.icons.length) {
    const all = files.map((f) => f.src).join("\n");
    for (const icon of opts.icons)
      if (!all.includes(icon))
        findings.push({
          level: "error",
          check: "orphan-icon",
          file: null,
          line: null,
          message: `imported icon ${icon} is referenced by no requireAsset — either use it or drop it from the manifest.`,
        });
  }

  const errors = findings.filter((f) => f.level === "error");
  const warns = findings.filter((f) => f.level === "warn");
  const verdict = {
    scripts_dir: dir,
    files_scanned: names.length,
    lifecycle_gate: findings.some((f) => f.check.startsWith("lifecycle-onawake") && f.level === "error")
      ? "failed"
      : "passed",
    errors: errors.length,
    warnings: warns.length,
    findings,
  };
  process.stdout.write(JSON.stringify(verdict, null, 2) + "\n");
  if (!opts.json)
    process.stdout.write(
      `\n${names.length} files · ${errors.length} error(s) · ${warns.length} warning(s) · lifecycle gate: ${verdict.lifecycle_gate}\n`
    );
  process.exit(errors.length ? 1 : 0);
}

main();
