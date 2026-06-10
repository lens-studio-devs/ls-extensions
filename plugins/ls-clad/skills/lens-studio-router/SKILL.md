---
name: lens-studio-router
description: "Front door for any Lens Studio / Specs / Spectacles / Snapchat Lens task — invoke PROACTIVELY at the start of such a conversation, before the user names a skill. Triggers: Specs, Spectacles, AR glasses, Snap Lens, Snapchat lens/camera, Snap camera, Snap mini app, Lens Studio, .esproj, SIK, UI Kit, VirtualScene; asks like 'build/make a specs|spectacles|snapchat <game or app>', 'make a Snap Lens that...', 'prototype an AR experience', 'build a 3D game' in an LS project. ('specs'/'Spectacles' = Snap's AR glasses, not test specs/RSpec; 'snapchat' = a Lens in the camera, not a 3rd-party API.) Gates LS 5.22+ / project / MCP readiness (never scaffolds; if cwd isn't an LS project, asks you to open it and restart the session so MCP is picked up), uses the platform you named (asks Specs vs Snapchat only if you didn't), then routes to the platform workflow."
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

This skill prepares the Lens Studio environment and routes the request to the right platform workflow: **Detect → Gate → Route → Post-build**. **You** (the main agent loading this skill) execute every step inline — running this orchestration as a skill keeps subagent spawns at depth 1, where they actually fire (a sub-agent's nested `Agent` calls are silently no-op'd by default; do not refactor this back into a sub-agent). You do not build anything yourself: for Specs you spawn `specs-experience-builder`; for Snapchat you continue inline using core Lens Studio skills.

## Cross-runtime behavior (read first)

This skill ships to Claude Code, Cursor, and Codex from one file. The canonical semantics live in `lens-studio-field-notes` — tool naming: Hard Rule 2; ask/spawn/skill-invoke: Cross-runtime orchestration. Entry-point summary, applied by **intent**, never by the literal tool name:

- **Asking the user.** Present the question as a *blocking* choice using your runtime's ask facility and wait for the answer — Claude Code: `AskUserQuestion` (blocking); Cursor: its ask tool, which is **non-blocking**, so end your turn and wait for the user yourself (it does not recognize the literal symbol `AskUserQuestion`); Codex: an ask tool exists in **Plan mode only** (`codex exec` is fully non-interactive). Print a blocked payload **only when no human can answer in this run at all**. The literal `AskUserQuestion` symbol being absent is **not** "no human can answer": Cursor and Codex Plan-mode can still ask, and reading it that way wrongly skips the platform and sign-in gates.

- **Spawning subagents** (builder, tester). "Spawn X" means: if your runtime can spawn a subagent, do so — Claude Code: `Agent({ subagent_type: "ls-clad:X" })` (plugin-qualified; the bare name fails to resolve — copy the qualified name from the error's "Available agents:" list if you see one); Cursor: its own subagent facility. **If your runtime cannot spawn a markdown subagent at all** — Codex's agents are TOML, so it never loads `ls-clad/agents/*.md` — that is **not** a missing install: load the named agent's file (`ls-clad/agents/X.md`) and execute its procedure **inline** in this same context. Only treat a spawn failure as a missing/partial install when the agent's source file is genuinely absent.

## Product naming

**Specs** is the current product name for Snap's AR glasses; **Spectacles** is the former name for the same device — treat them as synonyms and prefer "Specs" in everything you say back to the user. This is a naming convention only — it does **not** rename code identifiers (`SpectaclesInteractionKit`, `SpectaclesUIKit`, `SpectaclesSyncKit`), the `Editor.TargetPlatform.Spectacles` enum value, package names like `Spectacles 3D Hand Hints`, or historical references such as "Spectacles (2024)" (the prior hardware generation). When the platform question is asked, display the AR-glasses option as **SPECS** ("Lightweight AR glasses") and the camera option as **Snapchat**; record the canonical values `Specs` / `Snapchat` for routing and the `platform:` payload field.

## Modes

- **`mode: full`** (default) — Detect → Gate → Route, then Post-build for Specs.
- **`mode: preflight_only`** — Detect + Gate only, then print the preflight-ready payload (Route's preflight branch). No platform resolution, no routing, no post-build. For callers that need to verify Lens Studio is open, MCP is up, and the user is signed in — without triggering a full build. Requires an existing project at cwd (no `.esproj` → blocked payload `reason: no_project_present`). Failures print the same blocked payloads as `full` mode.

Anything other than an explicit `mode: preflight_only` — including ambiguous input — is treated as `full`.

## Hard rules

- **Do NOT build inline.** This skill only prepares the environment and routes the request.
- **Specs path:** spawn the `specs-experience-builder` sub-agent (see Cross-runtime behavior, including the inline-degrade path) with the HANDOFF_PAYLOAD as its prompt. That agent runs the whole build in its own context. Do not spawn `script-author` or other build agents from this skill.
- **Snapchat path:** print the handoff payload and continue inline. There is no dedicated Snapchat orchestrator yet.
- **Do NOT use `curl`, `fetch`, `wget`, or raw HTTP** to the Lens Studio MCP server as a workaround for MCP failures. If MCP is not reachable through tools, classify the blocker (see `references/environment-edge-cases.md`) and report a blocked payload.
- **Platform precedence: user-stated → project-stated → ask. Never guess.** A platform the user named is final. Otherwise the open project's `.esproj` `targetPlatform` decides, announced with a one-line override. Ask only when both are silent or ambiguous (details in Route).
- **Do NOT re-open a project that is already loaded.** Probe MCP and compare the loaded project against `project_path` before any `open -a`. On mismatch, ask before switching — never auto-switch an unrelated session.
- **Sign-in gate is mandatory and default-deny.** Check `isAuthorized` exactly once; only an explicit `true` proceeds. Never call `Editor.IAuthorization.authorize()` and never poll `isAuthorized` in a loop — ask once, re-check once.
- Tool naming, deferred-schema handling (`InputValidationError` = schema not loaded, NOT tool missing), and ask/spawn semantics: see `lens-studio-field-notes` Hard Rule 2 / Cross-runtime orchestration.

## Detect — find the project

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

Lens Studio configures and owns the MCP endpoint; this skill owns only the generic app/project/MCP/sign-in gate. Platform-specific setup (Blender, Node.js, SIK/UIKit, preview device, scene bootstrap) belongs to the routed workflow. **Required version: Lens Studio 5.22 or higher** — versions below 5.22, and dev builds whose version is unreadable, are incompatible.

**Preload (Claude Code only).** Resolve the two deferred MCP tool schemas before any MCP call — skipping this is the #1 cause of the sign-in gate silently failing, because the first `ExecuteEditorCode` call returns `InputValidationError`, which is "schema not loaded", NOT "tool missing" (see `lens-studio-field-notes` Hard Rule 2):

```text
ToolSearch({ query: "select:mcp__lens-studio__ListAllPanels", max_results: 1 })
ToolSearch({ query: "select:mcp__lens-studio__ExecuteEditorCode", max_results: 1 })
```

Codex/Cursor surface `ListAllPanels` and `ExecuteEditorCode` directly — skip the preload. If either fails to resolve on Claude Code, the MCP server was not registered with this agent at startup: print blocked payload `reason: mcp_plugin_off` and stop — do not attempt MCP calls without a resolved schema.

**Probe.** Call the `ListAllPanels` MCP tool once.

- **Probe succeeds** → MCP is reachable; some project is loaded. Read which one via `ExecuteEditorCode`:

  ```ts
  const model = pluginSystem.findInterface(Editor.Model.IModel);
  return model.project.projectFile.toString();
  ```

  Normalize both paths (trim whitespace, strip trailing `/`, resolve `..`; macOS paths are case-sensitive — compare exactly) and compare against `project_path`.
  - **Match** → tell the user the project is already open (skip re-open), set `mcp_status: ready`, and continue to the sign-in check.
  - **Mismatch** → ask (blocking): *"Lens Studio currently has `<current_project>` open. Switch to `<project_path>`?"* — **Switch** → `open -a "<lens_studio_path>" "<project_path>"`, then wait for MCP on the new project per `references/environment-edge-cases.md`; **Cancel**, or no human can answer in this run → blocked payload `reason: wrong_project_open`. Never auto-switch.
  - **`ExecuteEditorCode` fails despite the successful probe** (rare) → treat as Mismatch with `<current_project>` = "unknown".

- **Probe fails** → Lens Studio may not be running, may have no project loaded, may have its MCP plugin off, or there may be multiple/incompatible installs to sort out. **Read `references/environment-edge-cases.md` now** and follow it: compatible-install detection and version partition (5.22+), the multi-install picker, launch + the bounded MCP wait, and failure classification into the blocked-payload taxonomy.

**Sign-in check (mandatory, default-deny).** After MCP is confirmed, verify the user is signed in to Lens Studio (`Editor.IAuthorization` — the account login that gates publishing, asset-library access, and account-bound APIs). MCP being reachable does NOT imply sign-in. Check once via `ExecuteEditorCode`:

```ts
try {
  const auth = pluginSystem.findInterface(Editor.IAuthorization);
  if (!auth) return { isAuthorized: null, error: "no_auth_interface" };
  return { isAuthorized: auth.isAuthorized };
} catch (e) {
  return { isAuthorized: null, error: String(e) };
}
```

**Only `isAuthorized === true` proceeds to Route.** Anything else — `false`, `null`, `undefined`, missing field, thrown error, unrecognized shape, or `InputValidationError` (re-run the preload and retry the call once before treating it as fatal) — is "not signed in". Then:

1. Tell the user in plain text: *"You're not signed in to Lens Studio. Open the Lens Studio profile menu (top-right of the toolbar) and sign in."* **Account-agnostic copy is mandatory** — never name a specific account, email, username, or login provider, and never inject a development-time identity (shell email, git config) into the prompt. The user chooses the account.
2. Ask (blocking): *"Have you signed in to Lens Studio?"* — **I've signed in** / **Cancel**.
3. **I've signed in** → re-check `isAuthorized` with one more `ExecuteEditorCode` call (same snippet). `true` → continue to Route. Anything else → blocked payload `reason: not_signed_in`; do not re-prompt — re-invocation is cleaner than nested asks. If the re-check call itself fails, treat as `mcp_down`.
4. **Cancel**, or no human can answer in this run → blocked payload `reason: not_signed_in`. Never poll as a fallback — signing in is a human action with no upper bound.

Do not call `auth.authorize()` from this skill — sign-in must be user-initiated from the Lens Studio UI.

## Route — resolve platform, hand off

**If `mode: preflight_only`, skip platform resolution entirely** — print the preflight payload below and stop.

### Resolve the platform

Precedence: **user-stated → project-stated → ask. Never guess.**

1. **User stated it.** Scan `original_request` for an explicit platform name (apply Product-naming synonyms): Specs / Spectacles / "Snap('s) AR glasses" / "(on / for) my glasses" → **Specs**; Snapchat / "Snap camera" / "a Snapchat Lens" → **Snapchat**. Exactly one named → that is `platform`; route directly with one line: *"Building for `<platform>` (you said so)."* Generic terms — "Lens", "AR", "3D game", "app", "experience", "prototype" — are **not** a platform statement; both platforms have them.
2. **Project states it.** Otherwise, read the open project's `.esproj` and check its `targetPlatform` field. If it names exactly one platform (`Spectacles` → Specs, `Snapchat` → Snapchat), route on it and announce with a one-line override — e.g. *"Building for Specs — project targets Spectacles; say 'Snapchat' to switch."* A user-stated platform always wins over the project file.
3. **Ask** — only when the user didn't state it AND the `.esproj` field is absent, names both platforms, or is otherwise ambiguous. Ask (blocking): *"Which platform are you building for?"* — options **SPECS** (description leads with "Lightweight AR glasses") / **Snapchat**. Normalize the answer to canonical `Specs` / `Snapchat`. If no human can answer in this run, print blocked payload `reason: platform_choice_required` — do not pick a platform by guessing from genre or phrasing.

Auto / "don't ask me" directives don't change this: steps 1–2 already avoid the question in most runs; when both are silent, the question is still required (there is no build without a platform).

### Handoff payload

```
HANDOFF_PAYLOAD
- platform: <Specs | Snapchat>
- project_path: <absolute path to .esproj>
- project_state: existing
- lens_studio_path: <chosen Lens Studio app bundle>
- lens_studio_version: <5.22 or higher>
- mcp_status: <ready | not-ready>
- original_request: <the user's most recent pre-skill request, verbatim>
```

### If mode == preflight_only

Print this payload and stop — do NOT spawn the builder, ask the platform, or print next-step suggestions. The caller resumes its own work.

```
HANDOFF_PAYLOAD
- mode: preflight_only
- status: ready
- project_path: <absolute path to .esproj>
- project_state: existing
- lens_studio_path: <chosen Lens Studio app bundle>
- lens_studio_version: <5.22 or higher>
- mcp_status: ready
- is_authorized: true
- original_request: <the caller's original_request, verbatim>
```

### If platform == Specs

Spawn the builder — plugin-qualified `ls-clad:specs-experience-builder` (see Cross-runtime behavior; on a runtime that can't spawn subagents, load `ls-clad/agents/specs-experience-builder.md` and run its pipeline inline, in which case Post-build below is also yours to run directly) — with this prompt:

```
HANDOFF_PAYLOAD
- platform: Specs
- project_path: <absolute path to .esproj>
- project_state: existing
- lens_studio_path: <chosen Lens Studio app bundle>
- lens_studio_version: <5.22 or higher>
- mcp_status: ready
- original_request: <the user's most recent pre-skill request, verbatim>

You are continuing a Lens Studio request after environment routing. Treat this handoff as authoritative.

Proceed as the Specs Experience Builder:
- Print the HANDOFF_PAYLOAD verbatim first so the relevant facts are anchored for compaction.
- Satisfy `original_request`.
- Follow your pipeline (sequential build — assets via /build-mesh, /build-sfx, /build-music, /specs-build-ui, /icon-selector, then scripts, then bootstrap).
```

When the builder returns, parse its return text for the machine-readable summary block (a fenced ```yaml block under `### Machine-readable summary (for router/verifier)`), surface the human-readable report to the user, and continue to Post-build. If the builder returned a blocked / error result (no machine-readable summary, build failed), surface its result as-is and stop — no post-build step on a failed build.

### If platform == Snapchat

Print the HANDOFF_PAYLOAD (platform: Snapchat), then continue inline:

1. One short message: "Continuing on the Snapchat-camera path. There's no dedicated orchestrator yet — using core Lens Studio skills directly."
2. **Mandatory: invoke the `lens-studio-field-notes` skill now, before any other LS work in this session.** It carries the scene/asset tool-selection rules (VirtualScene-first), the GraphQL call recipes, and the domain-skill index that prevent the most common failures. Do NOT defer it until something fails.
3. **Mandatory before any `ExecuteEditorCode` call: load the `ls-clad:editor-api` skill** (or delegate the work to the `editor-api-specialist` subagent, which auto-loads it). It carries the `findInterface` namespace rules and the `editor.d.ts` lookup workflow — do NOT write Editor API code from memory.
4. Surface these other core skills with one-liners: /lens-api, /scene-construction (covers scene-graphql + asset-graphql via its references/), /materials, /camera-and-rendering, /lens-log-analysis.
5. Ask the user what they want to build next, then continue inline using the listed skills.

The Snapchat path is one-shot — it ends here; Post-build is Specs-only today.

## Post-build (Specs only)

After surfacing the builder's report, verify the build per `lens-studio-field-notes` → **See-and-fix loop** — recompile, log-diff, capture the preview, and judge the capture yourself with full code context, inline in the main agent (the `ls-clad:verify-preview` skill is the Lens-specific QA pass). Then print this plain-text suggestion and end the turn:

```
Next: verify preview | LEAF tests (create/re-run) | optimize | publish — or tell me what to change.
```

The user's reply is plain conversation — dispatch it by intent: verify → the `ls-clad:verify-preview` skill; LEAF tests → the `ls-clad:live-lens-tester` agent; optimize / publish / followup changes → `references/post-build-action-menu.md` lists what each action invokes and how it degrades when the skill or agent is missing.

## Failure modes — return early and clearly

If you cannot finish, print a blocked payload and stop:

```
HANDOFF_PAYLOAD
- status: blocked
- reason: <see the taxonomy in references/environment-edge-cases.md>
- project_path: <absolute path to .esproj, if known>
- lens_studio_path: <chosen Lens Studio app bundle, if known>
- lens_studio_version: <detected version, if known>
- mcp_status: not-ready
- suggested_next_step: <specific user action — per-reason next steps in references/environment-edge-cases.md>
```
