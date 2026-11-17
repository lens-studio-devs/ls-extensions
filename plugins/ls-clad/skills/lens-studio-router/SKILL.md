---
name: lens-studio-router
description: "Never use for publishing, submitting, releasing, or shipping a Specs Lens — use specs-publish. Front door for Lens Studio / Specs / Spectacles / Snapchat Lens creation, editing, debugging, and evaluation. Triggers: .esproj, IK (SIK), UI Kit, VirtualScene."
arguments:
  - name: mode
    description: "'full' (default) or 'preflight_only'. preflight_only runs Detect + Gate only — for callers that need a readiness gate without triggering a full build."
    required: false
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Lens Studio Router

## Scope check — is this even a route? (answer before doing anything)

This skill exists for work that will **touch a Lens Studio project or preview in this turn**. If the user's request doesn't, exit this skill immediately, say one line ("this doesn't need the Lens Studio environment — answering directly"), and handle the request normally. Real over-triggers observed in the field, all of which must NOT route:

- **Research or web lookups** ("find information about penguin lifecycles") — even when the user might use the answer in a lens later. *Might feed a lens* is not *touches a lens*.
- **Writing docs, plans, or analysis**, reviewing transcripts, answering general coding questions.
- **Anything whose only Lens Studio connection is the cwd.** Being inside an `.esproj` directory is not a trigger; the requested work is. A user in a lens project still asks normal questions.

When genuinely unsure, ask the user one short question rather than routing by default — a wrong route costs a full environment gate for work that never needed it.

This skill prepares the Lens Studio environment and routes the request to the right platform workflow: **Detect → Gate → Route → Post-build**. **You** (the main agent loading this skill) execute every step inline — running this orchestration as a skill keeps the platform gate, the build report, and the post-build verify in the context the user is watching (do not refactor this back into a sub-agent). You do not build anything yourself: for Specs you invoke either `specs-prototype-builder` (quick, one authored file) or `specs-build-experience` (the full build — a main-context orchestrator that spawns/collects/validates each build step from here); for Snapchat you spawn `snapchat-experience-builder`.

## Cross-runtime behavior (read first)

This skill ships to Claude Code, Cursor, and Codex from one file. The canonical semantics live in `lens-studio-field-notes` — tool naming: Hard Rule 2; ask/spawn/skill-invoke: Cross-runtime orchestration. Entry-point summary, applied by **intent**, never by the literal tool name:

- **Asking the user.** Present the question as a *blocking* choice using your runtime's ask facility and wait for the answer — Claude Code: `AskUserQuestion` (blocking); Cursor: its ask tool, which is **non-blocking**, so end your turn and wait for the user yourself (it does not recognize the literal symbol `AskUserQuestion`); Codex: an ask tool exists in **Plan mode only** (`codex exec` is fully non-interactive). Print a blocked payload **only when no human can answer in this run at all**. The literal `AskUserQuestion` symbol being absent is **not** "no human can answer": Cursor and Codex Plan-mode can still ask, and reading it that way wrongly skips the platform question and the sign-in prompt.

- **Spawning subagents** (builder, tester). "Spawn X" means: if your runtime can spawn a subagent, do so — Claude Code: `Agent({ subagent_type: "ls-clad:X" })` (plugin-qualified; the bare name fails to resolve — copy the qualified name from the error's "Available agents:" list if you see one); Cursor: its own subagent facility. **If your runtime cannot load a named Markdown agent**, read `ls-clad/agents/X.md` and pass its instructions to a general-purpose subagent when available. Run its procedure inline only when no supported subagent mechanism exists; this is not a missing install. Only treat a spawn failure as a missing/partial install when the agent's source file is genuinely absent.

## Product naming

**Specs** is the current product name for Snap's AR glasses; **Spectacles** is the former name for the same device — treat them as synonyms and prefer "Specs" in everything you say back to the user. This is a naming convention only — it does **not** rename code identifiers (such as `SpectaclesKitModule` or the legacy `SpectaclesInteractionKit`, `SpectaclesUIKit`, `SpectaclesSyncKit`), the `Editor.TargetPlatform.Spectacles` enum value, or historical references such as "Spectacles (2024)" (the prior hardware generation). When the platform question is asked, display the AR-glasses option as **SPECS** ("Lightweight AR glasses") and the camera option as **Snapchat**; record the canonical values `Specs` / `Snapchat` for routing and the `platform:` payload field.

## Modes

- **`mode: full`** (default) — Detect → Gate → Route, then Post-build (Specs full builds and Snapchat; the Specs prototype route skips it).
- **`mode: preflight_only`** — Detect + Gate only, then print the preflight-ready payload (Route's preflight branch). No platform resolution, no routing, no post-build. For callers that need to verify Lens Studio is open and MCP is up, and to read sign-in state — without triggering a full build. Because it skips platform resolution, `is_authorized` here is the raw reading for the **project's target platform** (report it, do not gate on it). Requires an existing project at cwd (no `.esproj` → blocked payload `reason: no_project_present`). Failures print the same blocked payloads as `full` mode.

Anything other than an explicit `mode: preflight_only` — including ambiguous input — is treated as `full`.

## Hard rules

- **Publish is already a terminal route.** For publishing, submitting, releasing, or shipping a Specs Lens, load `specs-publish` directly and do not load or continue this router.
- **Do NOT build inline.** This skill only prepares the environment and routes the request.
- **Specs path — two routes, decided on depth in Route.** A request for something quick to react to goes to `ls-clad:specs-prototype-builder` (one authored file, shared background init, minutes); everything else takes the full build.
- **Specs full build:** invoke the Skill `ls-clad:specs-build-experience` with the HANDOFF_PAYLOAD. It runs the spawn/collect/validate loop over the build steps from here in the main context — each step gets its own fresh, tool-sandboxed sub-agent (`ls-clad:step-*`), dispatched a wave at a time with each wave's spawns co-located in one message; inline skill invocation is its floor for runtimes with no `Agent` tool, not a preference. This same skill serves every runtime, so there is no separate "load the agent inline" degrade path. The `specs-experience-builder` agent is retained only for callers that explicitly want the whole build fully delegated to one sub-agent. Do not spawn `script-author` or other build agents from this skill.
- **Snapchat path:** spawn the `snapchat-experience-builder` sub-agent (see Cross-runtime behavior, including the inline-degrade path) with the HANDOFF_PAYLOAD as its prompt. That agent runs the whole build in its own context. Do not spawn `script-author` or other build agents from this skill.
- **Do NOT use `curl`, `fetch`, `wget`, or raw HTTP** to the Lens Studio MCP server as a workaround for MCP failures. If MCP is not reachable through tools, classify the blocker (see `references/environment-edge-cases.md`) and report a blocked payload.
- **Platform precedence: user-stated → project-stated → ask. Never guess.** A platform the user named is final. Otherwise the open project's `.esproj` `targetPlatform` decides, announced with a one-line override. Ask only when both are silent or ambiguous (details in Route).
- **Do NOT re-open a project that is already loaded.** Probe MCP and compare the loaded project against `project_path` before any `open -a`. On mismatch, ask before switching — never auto-switch an unrelated session.
- **Sign-in is checked but never a terminal dead-stop.** `Editor.IAuthorization.isAuthorized` is the only JS-readable auth signal, and it reflects the *project target platform's* account (on a Spectacles project that is the SPECS account — see `references/gate-diagnose.ts`), so it is only meaningful **after** the platform is resolved. To make the reading trustworthy, Route first **aligns the project's Target Platform to the resolved platform** (a sanctioned, announced, reversible setting change — building for a platform requires the project to target it), then reads `isAuthorized` against it, surfaces `is_authorized: true | false | unknown` in the payload, and hands off. When the user is signed out, the build plans around the features that need sign-in (see Route → Sign-in check). Never emit `not_signed_in` as a router verdict for a build. Check `isAuthorized` at most twice (once in Gate, once after an align/sign-in re-probe); never call `Editor.IAuthorization.authorize()` and never poll `isAuthorized` in a loop.
- **Never launch a Lens Studio while one is already serving MCP for this project.** The running instance owns the session — launching a second (or a differently-named install) splits state. Launch only when the probe shows nothing running, and launch only the `executablePath` from this project's `ls-live-instance.json` (see `references/environment-edge-cases.md`).
- **Specs package names changed in Lens Studio 5.25.** Before handing off a Specs build, make sure the build knows the rename (`lens-studio-field-notes` Hard Rule 7, details in `/specs-package-renames`): a project may carry the legacy `SpectaclesInteractionKit` / `SpectaclesUIKit` / `SpectaclesSyncKit` packages or the 4.0 `InteractionKit` / `UIKit` / `SyncKit` ones, and the build must use whichever is installed.
- Tool naming, deferred-schema handling (`InputValidationError` = schema not loaded, NOT tool missing), and ask/spawn semantics: see `lens-studio-field-notes` Hard Rule 2 / Cross-runtime orchestration.

## Detect — find the project

Detect and Gate run **every session** — there is no `.clad/routing.json` cache. The five findings below each cost a file read, an app probe, or sometimes a question to the user, and are re-derived each time.

**`mcp_status` and `is_authorized` are liveness facts — always re-probed, never inherited.** Lens Studio can quit and a session can lose auth between one turn and the next, so the single Diagnose call in Gate (which reads both) runs every single time. `is_authorized` is read but **not gated on in Gate** — it is interpreted in Route against the resolved platform (below), and asked-at-most-once.

The cwd is a Lens Studio project if **either** holds:

1. A `*.esproj` file exists at the cwd root (strongest signal — every LS project has exactly one).
2. `Assets/` AND `Packages/` directories exist together at cwd.

```bash
ls *.esproj 2>/dev/null | head -1
test -d Assets && test -d Packages && echo "ASSETS_AND_PACKAGES_PRESENT"
```

- **Project found** → record `project_path` (absolute path to the `.esproj`) and proceed to Gate.
- **No project found** (either mode) → this skill does **not** scaffold a project. Print a blocked payload with `reason: no_project_present` and stop, with `suggested_next_step`: open Lens Studio with the intended project, then fully restart the coding-assistant session so it re-registers the Lens Studio MCP server at startup, then re-invoke this skill (or, in preflight mode, the skill that triggered the preflight) from that project's directory. The MCP endpoint is registered at session start — no project at startup means the Lens Studio MCP tools are absent for the whole session, and only a restart recovers them.

## Gate — Lens Studio readiness

Lens Studio configures and owns the MCP endpoint; this skill owns only the generic app/project/MCP readiness gate and the sign-in read. Platform-specific setup (Blender, Node.js, IK/UIKit, preview device, scene bootstrap) belongs to the routed workflow. **Required version: Lens Studio 5.25 or higher** — versions below 5.25, and dev builds whose version is unreadable, are incompatible.

**Preload (Claude Code only).** Resolve the deferred `ExecuteEditorCode` schema before any MCP call — skipping this is the #1 cause of the Diagnose call silently failing, because the first `ExecuteEditorCode` call returns `InputValidationError`, which is "schema not loaded", NOT "tool missing" (see `lens-studio-field-notes` Hard Rule 2):

```text
ToolSearch({ query: "select:mcp__lens-studio__ExecuteEditorCode", max_results: 1 })
```

Codex/Cursor surface `ExecuteEditorCode` directly — skip the preload. If it fails to resolve on Claude Code, the MCP server was not registered with this agent at startup: print blocked payload `reason: mcp_plugin_off` and stop — do not attempt MCP calls without a resolved schema.

**Diagnose (one call).** After the preload, run a single `ExecuteEditorCode` that reads project identity, target platform, and sign-in state in one round-trip. This call doubles as the MCP reachability probe — a JSON return means MCP is reachable and a project is loaded.

**Fire `references/gate-diagnose.ts` by path** — pass its absolute path as the `path` argument of `ExecuteEditorCode`. Do **not** read the file and inline its contents; run it by path, unedited (its `any`-typing and enum-inversion are load-bearing; see the header comments). Each field is isolated in its own `try/catch` so one failing read never masks the others. It reads project identity, target platform, the running Lens Studio executable/version, and sign-in state in one round-trip and returns JSON:

```json
{ "ok": true, "projectPath": "…/x.esproj", "targetPlatform": "Snapchat" | "Spectacles",
  "intendedPlatforms": ["…"] | null, "isAuthorized": true | false | null,
  "lensStudioPath": "…", "lensStudioVersion": "5.x.x",
  "modelError?": "…", "projectPathError?": "…", "targetPlatformError?": "…",
  "lensStudioError?": "…", "authError?": "…" }
```

**Classify the call outcome first:**

- **Returns JSON** → MCP reachable; evaluate the fields below.
- **`InputValidationError`** → schema not loaded, NOT MCP down (see `lens-studio-field-notes` Hard Rule 2). Re-run the Preload and retry once. Still failing → blocked payload `reason: mcp_plugin_off`.
- **Fails to connect / times out / any other error** → MCP not reachable: Lens Studio may not be running, have no project loaded, or have its MCP plugin off. **Read `references/environment-edge-cases.md` now** and follow it: find the executable from `ls-live-instance.json`, launch + the bounded MCP wait, and failure classification into the blocked-payload taxonomy.

**Version gate.** From the returned identity, require non-empty `lensStudioPath`/`lensStudioVersion` (a set `lensStudioError` or malformed values → blocked payload `reason: mcp_down`). Compare numeric `(major, minor) >= (5, 25)`; below that → blocked payload `reason: lens_studio_wrong_version`. `lensStudioPath` is also the executable the Switch step below launches.

**Project match.** Normalize `projectPath` and `project_path` (trim whitespace, strip trailing `/`, resolve `..`; macOS paths are case-sensitive — compare exactly):

- **Match** → tell the user the project is already open (skip re-open), set `mcp_status: ready`, and continue to Route.
- **Mismatch** → ask (blocking): *"Lens Studio currently has `<projectPath>` open. Switch to `<project_path>`?"* — **Switch** → `open -a "<lens_studio_path>" "<project_path>"`, then wait for MCP on the new project per `references/environment-edge-cases.md` and re-run this Diagnose call against the switched project; **Cancel**, or no human can answer in this run → blocked payload `reason: wrong_project_open`. Never auto-switch.
- **`projectPath` is null despite a returned JSON** (rare) → treat as Mismatch with `<projectPath>` = "unknown".

**Sign-in is NOT gated here.** Gate reads `isAuthorized` as part of the one Diagnose call but does not decide anything on it — that boolean is only meaningful once the platform is resolved (it reflects the *project target platform's* account), so its interpretation lives in Route's **Sign-in (advisory)** step. Gate proceeds to Route regardless of `isAuthorized`.

## Route — resolve platform, hand off

**If `mode: preflight_only`, skip platform resolution entirely** — print the preflight payload below and stop.

### Resolve the platform

Precedence: **user-stated → project-stated → ask. Never guess.**

1. **User stated it.** Scan `original_request` for an explicit platform name (apply Product-naming synonyms): Specs / Spectacles / "Snap('s) AR glasses" / "(on / for) my glasses" → **Specs**; Snapchat / "Snap camera" / "a Snapchat Lens" → **Snapchat**. Exactly one named → that is `platform`; route directly with one line: *"Building for `<platform>` (you said so)."* Generic terms — "Lens", "AR", "3D game", "app", "experience", "prototype" — are **not** a platform statement; both platforms have them. ("prototype" still matters once platform is settled — it is a *depth* signal in the Specs branch below.)
2. **Project states it.** Otherwise, use the `targetPlatform` the Gate's Diagnose call already read (no re-read of `.esproj`). If it names exactly one platform (`Spectacles` → Specs, `Snapchat` → Snapchat), route on it and announce with a one-line override — e.g. *"Building for Specs — project targets Spectacles; say 'Snapchat' to switch."* A user-stated platform always wins over the project file.
3. **Ask** — only when the user didn't state it AND the `.esproj` field is absent, names both platforms, or is otherwise ambiguous. Ask (blocking): *"Which platform are you building for?"* — options **SPECS** (description leads with "Lightweight AR glasses") / **Snapchat**. Normalize the answer to canonical `Specs` / `Snapchat`. If no human can answer in this run, print blocked payload `reason: platform_choice_required` — do not pick a platform by guessing from genre or phrasing.

Auto / "don't ask me" directives don't change this: steps 1–2 already avoid the question in most runs; when both are silent, the question is still required (there is no build without a platform).

### Align the project target, then read sign-in

`isAuthorized` reflects the account of the project's **target** platform (on a Spectacles project that is the SPECS account), so it is only trustworthy once the project targets the platform the user actually wants. Align the target first, then read auth against it. This step **never blocks routing**.

1. **Align the target to the resolved `platform`.** Compare it with `targetPlatform` (from Gate's Diagnose).
   - **Same** → nothing to do; the `isAuthorized` Gate already read applies.
   - **Different** → set the project's target to the resolved platform, in one `ExecuteEditorCode`: `const model = pluginSystem.findInterface(Editor.Model.IModel); model.project.targetPlatform = Editor.TargetPlatform.<Spectacles|Snapchat>` (`Spectacles` for Specs). The scripting setter routes to `Project::setTargetPlatform`, which switches the active account **in-memory immediately** (so the re-read below is correct), aligns the lens-client compatibilities, and marks the project modified. Building for a platform *requires* the project to target it (credential routing and export follow the project target), so this is a precondition of the request, not an extra. **Announce it in one line** and note it is reversible — e.g. *"Your project targeted Snapchat; switching it to Specs to build what you asked (reversible in Project Settings)."* Then persist it with `<ls-clad>/skills/editor-api/scripts/save-project-safe.ts` (by `path`, `timeoutMs ≥ 30000`) so on-disk state is consistent, and re-read `isAuthorized` from a fresh `references/gate-diagnose.ts` run (the one allowed re-probe — it now reflects the resolved platform). Never call `Editor.IAuthorization.authorize()`; the platform switch does not sign anyone in, it only selects which account is active.

2. **Sign-in check**, now that the project targets the resolved platform and `isAuthorized` is a trustworthy reading for it (the false-negative from a wrong-platform view is gone):
   - `isAuthorized === true` → `is_authorized: true`; proceed.
   - Anything else (`false` / `null` / missing / `authError` set) → `is_authorized: false`. Ask (blocking): *"You don't appear to be signed in to Lens Studio for `<platform>`. Without sign-in, these won't work: AI-generated 3D models and images, voice/ASR and AI services through Remote Service Gateway, and publishing. I can build everything else, with simpler non-AI models. Sign in from the Lens Studio profile menu (top-right of the toolbar) and I'll recheck, or continue without sign-in?"* — **Signed in** → re-read `isAuthorized` once via `references/gate-diagnose.ts`; `true` → `is_authorized: true`, proceed. **Continue without sign-in** (or still not `true` after the recheck) → proceed with `is_authorized: false`. When no human can answer in this run (headless), print the same text as a note and proceed with `is_authorized: false`. Either way **do not emit `not_signed_in`**. **Copy discipline:** a `false` here can also mean a *signed-in but unverified* account, so say *"don't appear to be signed in **for `<platform>`**"* — never "you have no account" — and leave the verify-vs-sign-in distinction to the cloud step. **Account-agnostic copy is mandatory**: name the platform, never a specific account, email, username, or login provider, and never inject a development-time identity (shell email, git config).

Never poll `isAuthorized`.

### Start Specs init in the background

For a new Specs build in `mode: full`, once Gate and platform alignment are
complete, announce and start `ls-clad:step-init` as a background subagent with the
verified `project_path`. Do this before choosing prototype versus full build or
planning the experience. Continue that work while init runs; do not wait here.
Do not start init for `preflight_only`, Snapchat, or edit/fix/debug/evaluation work.

Carry `init_task` (the actual runtime task handle) in the handoff, or `init_result`
(the returned `STEP_RESULT`) if it has already completed; never both. Both Specs
builders run in this main context and must reuse that invocation, not spawn a
second init. If spawning is unavailable, run `step-init` inline and hand off its
result; report that initialization could not overlap.

Before editor writes, package-dependent compilation, or preview runs, collect
that invocation's result. Require `step: "init"`, `status: "ok"`, matching
`project_path`, `project_ready: true`, `sik_installed: true`,
`uikit_installed: true`, and empty `errors[]` / `blockers[]`. A previous
`.clad/steps/init.json` is not evidence that this invocation completed. A failed,
uncollectable, or wrong-project result blocks editor work; report it rather than
starting a duplicate task. For a retry, first confirm the old task has stopped.

Until that join, init is the only editor writer. Planning and local drafting may
continue; do not switch projects, install packages, mutate scene/assets through
editor tools, recompile, or refresh the preview alongside it. If the request is
cancelled or changes platform/project, stop and collect init before proceeding.

### Handoff payload

```
HANDOFF_PAYLOAD
- status: ready
- platform: <Specs | Snapchat>
- project_path: <absolute path to .esproj>
- project_state: existing
- lens_studio_path: <absolute Lens Studio executable path from the running Editor API>
- lens_studio_version: <5.25 or higher>
- mcp_status: <ready | not-ready>
- is_authorized: <true | false | unknown>
- original_request: <the user's most recent pre-skill request, verbatim>
- init_task: <Specs new builds only; omit if init_result is supplied>
- init_result: <completed current STEP_RESULT; omit if init_task is supplied>
```

`is_authorized: false` or `unknown` is **expected, not a blocker** — the plan step uses it to plan around the features that need sign-in, and the gated skills skip and continue if they still hit `not_signed_in`. Do not re-add a top-level auth gate downstream.

Every payload shape this skill emits — route, preflight, blocked — carries `status` as its first field. `status: ready` means the gate passed and these facts are trustworthy; `status: blocked` means stop. Nothing downstream may cache or act on a `blocked` payload's facts.

### If mode == preflight_only

Print this payload and stop — do NOT spawn the builder, ask the platform, or print next-step suggestions. The caller resumes its own work.

```
HANDOFF_PAYLOAD
- mode: preflight_only
- status: ready
- project_path: <absolute path to .esproj>
- project_state: existing
- lens_studio_path: <absolute Lens Studio executable path from the running Editor API>
- lens_studio_version: <5.25 or higher>
- mcp_status: ready
- is_authorized: <true | false>
- original_request: <the caller's original_request, verbatim>
```

### If platform == Specs

Platform is settled; now decide **depth** from `original_request`.

**Prototype** → invoke `ls-clad:specs-prototype-builder` with `original_request`
verbatim, `project_path`, and `init_task` or `init_result`. Use it for a quick
sketch or a small interaction to try. It joins init, verifies, and hands off;
return its report without running Post-build or adding a second menu.

**Full build** → invoke `ls-clad:specs-build-experience` when the request requires
generated models/GLBs, physics, multiplayer, AI/voice, sound design, or a shippable
experience. Required capabilities take precedence over “quick” or “prototype”
wording. Briefly explain the route when those signals conflict.

If neither capabilities nor explicit depth settles it, start with a prototype
and announce the choice: “Starting with a quick prototype; say ‘full build’ for
the broader workflow.” Generic words such as “Lens”, “AR”, or “game” do not decide
depth. A successful prototype can later use `/specs-prototype-promote`.

For the full build, invoke the Skill `ls-clad:specs-build-experience` with this
payload. It orchestrates the whole build from here in the main context — spawning each step as its own fresh sub-agent (`ls-clad:step-*`), with each wave's spawns emitted together in a single message so independent asset steps overlap. The same skill serves every runtime; you stay in the main context, so Post-build below is yours to run when it returns.

```
HANDOFF_PAYLOAD
- status: ready
- platform: Specs
- init_task: <current task handle; omit if init_result is supplied>
- init_result: <completed current STEP_RESULT; omit if init_task is supplied>
- project_path: <absolute path to .esproj>
- project_state: existing
- lens_studio_path: <absolute Lens Studio executable path from the running Editor API>
- lens_studio_version: <5.25 or higher>
- mcp_status: ready
- is_authorized: <true | false | unknown>
- original_request: <the user's most recent pre-skill request, verbatim>
```

When `specs-build-experience` returns, parse its return text for the machine-readable summary block (a fenced ```yaml block under `### Machine-readable summary (for router/verifier)`), surface the human-readable report to the user, and continue to Post-build. If it returned a blocked / error result (no machine-readable summary, build failed), surface its result as-is and stop — no post-build step on a failed build.

### If platform == Snapchat

Spawn the builder — plugin-qualified `ls-clad:snapchat-experience-builder` (see Cross-runtime behavior; on a runtime that can't spawn subagents, load `ls-clad/agents/snapchat-experience-builder.md` and run its pipeline inline, in which case Post-build below is also yours to run directly) — with this prompt:

```
HANDOFF_PAYLOAD
- status: ready
- platform: Snapchat
- project_path: <absolute path to .esproj>
- project_state: existing
- lens_studio_path: <absolute Lens Studio executable path from the running Editor API>
- lens_studio_version: <5.25 or higher>
- mcp_status: ready
- is_authorized: <true | false | unknown>
- original_request: <the user's most recent pre-skill request, verbatim>

You are continuing a Lens Studio request after environment routing. Treat this handoff as authoritative.

Proceed as the Snapchat Experience Builder:
- Print the HANDOFF_PAYLOAD verbatim first so the relevant facts are anchored for compaction.
- Satisfy `original_request`.
- Follow your pipeline (sequential build — assets via /build-mesh, /build-sfx, /build-music, /icon-selector, screen-space UI authored inline, then scripts, then bootstrap).
```

When the builder returns, parse its return text for the machine-readable summary block (a fenced ```yaml block under `### Machine-readable summary (for router/verifier)`), surface the human-readable report to the user, and continue to Post-build. If the builder returned a blocked / error result (no machine-readable summary, build failed), surface its result as-is and stop — no post-build step on a failed build.

## Post-build

**Required progress checkpoint, before the next verification tool call:** if the
builder has not already announced ready-to-try during this build, and compilation,
and startup have passed, emit a standalone user-facing message:
**🟢 First build is running — you can try it now in Lens Studio.** Follow it with
**🟡 I’m checking visuals and interactions; these are not yet verified.** Invite the
user to try it and say “stop testing” if satisfied. Green means ready to try, not
fully verified; do not show it for compilation or startup failures. Refresh the user's visible
Preview panel before sending it, so "try it now" shows the build (`preview-inspection` → Preview
routing → "Show the user the result"). Visual checks follow this
message; they must not delay telling the user the build is running.
A tool result or final summary does not count. Send this before screenshots, layout checks, or interaction testing,
then continue without waiting for a response. On a stop request, stop active
verification agents/editor work, save, and report remaining checks as unverified.

After surfacing the builder's report, verify the build per `lens-studio-field-notes` → **See-and-fix loop** — recompile, log-diff, capture the preview, and judge the capture yourself with full code context, inline in the main agent (the `ls-clad:verify-preview` skill is the Lens-specific QA pass; it works on both Specs and Snapchat previews).

**Honest completion status — never round an unverified build up to "done".** Lead the user-facing summary with a status derived from that verify pass, not from the fact that the builder returned: `verified` (you may say complete / working) **only** when `verify-preview` actually exercised the expected behavior — including driving the core interaction for an interactive Lens — and confirmed it; `partially-verified` when it built but the interaction/behavior was inconclusive or a blocker remains (say "built; core interaction not confirmed" and list the blocker); `unverified` when the verify pass was skipped or could not run (say "built but unverified — I could not confirm it works" and name why). A structurally-assembled scene is not a working Lens, and an interaction that could not be exercised is `unverified`, never "playable". (Router-level counterpart to the `verify-preview` honest-status gate — applies to both platforms.)

Then offer 2–4 relevant lettered next actions, one per line, and end the turn. Accept a letter
or plain language; keep letter meanings stable within the current build. Use
numbers for test steps, letters for choices. The following are examples: omit
irrelevant actions, mark one recommendation, and never require a selection to
continue already-authorized work.

- **Specs:**
  ```
  A — Keep this version | B — Change something | C — More testing | D — Publish
  ```
- **Snapchat:**
  ```
  A — Keep this version | B — Change something | C — More testing
  ```
  (While testing is active, A means save and stop testing. For C, offer relevant preview or LEAF checks. On-device LEAF testing and publish are Specs-only.)

When `is_authorized` is not `true`, replace **Publish** with a one-line note that publishing needs sign-in.

The user's reply may be a letter from the displayed choices or plain conversation — dispatch it by intent: verify → the `ls-clad:verify-preview` skill; LEAF tests (Specs only) → the `ls-clad:live-lens-tester` agent; optimize / publish / followup changes → `references/post-build-action-menu.md` lists what each action invokes and how it degrades when the skill or agent is missing. That menu's Specs-specific entries — LEAF, `specs-publish`, and `specs-experience-builder` fix/followup re-spawn — do not apply to the Snapchat path; Snapchat followup changes re-run a fresh build pass (fix-mode is a deferred follow-up).

## Failure modes — return early and clearly

If you cannot finish, print a blocked payload and stop:

```
HANDOFF_PAYLOAD
- status: blocked
- reason: <see the taxonomy in references/environment-edge-cases.md>
- project_path: <absolute path to .esproj, if known>
- lens_studio_path: <Lens Studio executable path, if known>
- lens_studio_version: <detected version, if known>
- mcp_status: not-ready
- suggested_next_step: <specific user action — per-reason next steps in references/environment-edge-cases.md>
```
