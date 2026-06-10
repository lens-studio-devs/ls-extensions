---
name: lens-js-debugger
description: Debug a running JS Lens. Use when you need to evaluate expressions, set breakpoints, pause/resume execution, or inspect runtime state in a Lens Studio preview or on a Specs device.
user-invocable: true
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Lens JS Debug — Quick Reference

The grammar lives in the CLI, not here: **`lsdbg list-commands --summary`** is the authoritative
verb list (no session needed), and **`lsdbg <verb> --help`** carries each verb's response shape and
gotchas. Failures self-describe — read `error.recovery` / `error.errorCode`; successful results that
have a caveat carry a `hint` / `hintCode`.

<a id="wrapper-location"></a>
`<skill-dir>` = the absolute path of this skill directory; the CLI wrapper is
`<skill-dir>/scripts/lsdbg`. **Run `<skill-dir>/scripts/lsdbg install-link` once** — it puts a bare
`lsdbg` on `$PATH` (the examples assume it). Until then, invoke by absolute path. **Never** stash the
path in a shell variable — each Bash call is a fresh shell.

## Happy path (single preview)

Most bugs need exactly this loop:

    lsdbg attach                                         # readiness gate; blocks until live
    lsdbg console-log                                    # did the repro print / throw?
    lsdbg set-breakpoint "Bug.ts" 14 --reload --wait-paused
    lsdbg eval "this.speed"                              # paused → auto-frames the top frame
    lsdbg resume                                         # → {"ok": true}
    lsdbg cleanup --all                                  # tear down when done

`attach` **is** the readiness gate — it blocks through a cold boot until the VM is live, then returns
`{attached, targetId, state}`. Do not hand-roll `sleep`/poll loops. Shorthand verbs auto-attach in
the single-target case, so explicit `attach` is only needed to pre-warm or to pick among multiple
targets (`--target "<title>"`, or a pre-attach `health` to list them).

## When to use

- A **JavaScript Lens** (SnapHermes / Hermes VM) where you must evaluate expressions, set
  breakpoints, step, or inspect runtime state — and the bug only reproduces while **running**
  (init crash, missing-`await`, callback wiring, runtime data shape).

**Not for:** C++ runtime / non-JS scripting (the JS debugger can't reach those); pure static
analysis (read the source instead).

<a id="the-three-rules-that-bite-first"></a>
## The three rules that bite first

1. **Init-time breakpoints need `--reload`.** `onAwake` / top-level code already ran before the
   debugger attached.
2. **Exceptions are invisible to `console-log` until you opt in.** Set `pause-on-exceptions
   {uncaught|all}`; then the VM halts on the throw (`--wait-paused` returns), `health` reports
   `state: paused` with the thrown text in `vm.exception_text`, and the throw also lands in
   `console-log` as an `error` line. (Does **not** catch unhandled Promise rejections — only
   synchronous throws.)
3. **`eval` is global scope while *running*** — vars inside `@component`, callbacks, async fns, or
   `onAwake` are invisible then. **Once paused**, frame-less `eval` / `inspect-host-object`
   auto-evaluate in the top frame (so `this` / closures resolve; envelope carries `autoFramed: true`).
   Pass an explicit `callFrameId` (from `backtrace`) to target another frame, or use `locals` /
   `eval-on-frame`.

Other gotchas: **Async frames** — `this` is the Hermes stepper closure, not the component.
**Synthetic taps** can't be
dispatched from the debugger — if the lens-studio MCP is enabled use its `InjectPreviewGesture`,
else `eval` the bound handler as a standalone function, else ask the user to interact (then confirm
the pause with `health`).

## Response & failure contract

- **One JSON envelope per verb** on stdout; exit code is `0` on `ok:true`, `1` on `ok:false` — branch
  on the envelope, not the exit code. **`console-log` is the exception**: it emits NDJSON (one event
  per line).
- **Trigger verbs that just act** (`resume`, `pause`, `step-*`, `reload`) → `{"ok": true}`.
- **Wait flags ride trigger verbs only** (`eval`, `pause`, `resume`, `step-*`, `reload`,
  `set-breakpoint`, `pause-on-exceptions` — marked `*` in `--summary`), and must ride the **same
  command that triggers the pause** — a follow-up `--wait-paused` hangs. Passing one to an inspection
  verb or `health` is a hard error. `--wait-paused` then emits **two** stdout objects: the command
  envelope, then the compacted `Debugger.paused` — read the second for the pause site.
- **Multi-target:** the daemon multiplexes N previews; every dispatching verb takes `--target
  "<title>"` (or raw id). With several attached and no `--target`, the call is refused with
  `error.errorCode == "multiple_targets"` (+ `error.targets`). `console-log` is per-target; `health`
  is daemon-wide.
- **The verb set is closed** — no raw escape hatch. If `list-commands` doesn't list it, the CLI
  doesn't expose it.

## Line numbers

**Read `editorLine` (1-based)** — it matches editor / `Read` / grep / IDE gutters, on `set-breakpoint`
`locations[]`, paused frames, and `backtrace[]`. With a source map (`.ts`/`.tsx`) it's the source
line; without one (`.js` Lenses) it's the raw script line (still the editor line). The compiled `.js`
line rides alongside as `generatedLine` — rarely needed. Breakpoint *input* lines are 1-based for
`.ts`/`.tsx` (source-map resolved), 0-based for `.js`. Source-map walk + the snap-forward rule in
`lsdbg set-breakpoint --help`.

<a id="diagnose-empty-console-log"></a>
## Diagnose an empty `console-log` / a pause that never fired

`health`'s `result.state` collapses the "why nothing happened" outcomes — read it first:

| `state` | What's true | Next step |
|---|---|---|
| `paused` | halted at a breakpoint or throw | read `vm.pause_reason` / `vm.exception_text`; `backtrace` / `locals` / `eval-on-frame`, then `resume` |
| `init_throw` | threw in `onAwake` / top-level | read `activity_since_attach.last_exception_ts`; fix init code |
| `healthy_running` | VM alive and executing; the watched path just isn't running (no debug event pending) | widen the breakpoint, add a `console.log`, or `eval` |
| `preview_idle` | user hasn't pressed Play (or hit end-of-timeline) | ask the user to press Play, or `reload` |
| `wrong_target` | stale / torn-down session | re-attach |
| `ambiguous` | no positive nor negative signal | wait briefly, re-call `health`; if still ambiguous, escalate |

Pre-attach (no daemon) `health` answers with `result.status`: `booting` (LS coming up / not
attached — `attach` blocks until live) vs `no_session` (LS not running or no Lens). The derivation
rule is canonical in `_derive_health_state` (`tools/lsdbg/commands/health.py`).

## Deep dives

- **Per-verb response shapes, recipes, gotchas** → `lsdbg <verb> --help`
- **Recovery** — wedged daemon, cleanup partial-failure, symptom → fix matrix →
  [references/recovery.md](references/recovery.md)
