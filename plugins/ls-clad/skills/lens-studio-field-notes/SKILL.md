---
name: lens-studio-field-notes
description: Plugin-specific field notes for Lens Studio work — scene/asset tool selection (VirtualScene-first), the domain-skill index, Editor API delegation specifics, and scene-prep slash commands. Loaded by /lens-studio-router.
user-invocable: true
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Lens Studio Field Notes

## Hard Rules

The canonical copies of the cross-cutting rules other ls-clad skills and agents reference.

1. **No raw HTTP, no Bash workarounds for MCP.** Never use `curl`, `fetch`, `wget`, or any raw HTTP/REST call to reach the Lens Studio MCP server — or to fetch an asset a Lens Studio MCP tool already provides — and never shell out to `tsc`/Node via `Bash` to compile or "fix" what an MCP tool owns (use the `RecompileTypeScriptTool` MCP tool). Always use the Lens Studio MCP tools in your tool list. If an MCP tool fails or seems absent, treat it as the naming/schema/retry issue in rule 2 — never as license to work around it. A hand-downloaded or hand-placed asset file is invisible to Lens Studio until imported through the proper tool.

2. **Naming MCP tools across runtimes — name by bare tool name; resolve the prefix per runtime.** In skill/agent prose, refer to a Lens Studio MCP tool by its **bare CamelCase name** (`ExecuteEditorCode`, `VirtualScene`, `ListAllPanels`, `scene-graphql`) — **never** the fully-qualified `mcp__<server>__<Tool>` literal. Only the server prefix + separator vary by runtime; the tool name itself is invariant:
   - **Claude Code:** `mcp__lens-studio__<Tool>` (hyphen server, `__` separator). These tools are **deferred** — a tool "not in your list" or an `InputValidationError` means the schema is NOT LOADED YET (it does **not** mean the tool is missing): run `ToolSearch({query: "select:mcp__lens-studio__<Tool>"})` once to load it, then call the tool. First-turn retry gate, never a permanent fallback.
   - **Codex:** `mcp__lens_studio.<Tool>` (underscore server, `.` separator), surfaced directly — **no `ToolSearch` step**.
   - **Cursor:** its own MCP namespace, surfaced directly — **no `ToolSearch` step**.

   The fully-qualified literal is correct in exactly two places: the `query` argument of a Claude-only `ToolSearch({query: "select:…"})` call (gate such lines with "On Claude Code, …" so other runtimes skip them), and Claude-only manifests (`.claude-plugin/settings.json`, agent `tools:` frontmatter) — leave those literal. Everywhere else, use the bare name and resolve the prefix to your runtime's form. Never fall back to `curl`/HTTP or silently degrade because a tool "isn't in your list."

3. **Units & coordinates (runtime).** Lens Studio is **right-handed** — +X right, +Y up, **−Z forward**. World units are **centimeters (cm)**. Rotations are **degrees in the Editor API** but **radians at runtime** — convert at the boundary.

4. **One writer surface — no mixed-surface patching.** Build/repair the scene through a single surface (VirtualScene is the default; see `ls-clad:scene-construction`). Do NOT reach for `scene-graphql setProperty`/`addComponent` or `ExecuteEditorCode` to "patch around" a malformed VirtualScene apply — that mixed-surface path leaves orphaned partial state in the user's project. The recovery path for a bad apply is re-issuing a corrected VirtualScene apply, not patching it on another surface.

## Cross-runtime orchestration

This plugin ships to Claude Code, Cursor, and Codex from one source. The orchestration primitives below differ per runtime — apply them by **intent**, not by the literal Claude tool name. (MCP tool naming is Hard Rule 2.) This is the canonical home; other skills/agents point here.

- **Spawn a subagent.** If your runtime can spawn one, do so — Claude Code: `Agent({ subagent_type: "ls-clad:<name>" })` (plugin-qualified; the bare name fails to resolve); Cursor: its subagent facility; Codex: a generic spawn (e.g. `multi_agent_v1.spawn_agent`) given the agent's instructions — there is no typed `ls-clad:` interface there. **If your runtime cannot spawn a markdown subagent at all** (Codex's agents are TOML, so it never loads `ls-clad/agents/*.md`), that is **not** a missing install — load the named agent's file `ls-clad/agents/<name>.md` and run its procedure **inline** in this context. Only treat a spawn failure as a bad install when the agent's source file is genuinely absent.
- **Continue a long-running subagent.** Claude Code: `SendMessage({ to: <agentId> })` to reuse a spawned verifier/worker across turns (on failure, spawn fresh). Runtimes without a persistent-subagent-session facility: spawn fresh each time, or run the agent's procedure inline.
- **Invoke a skill.** Claude Code: the `Skill` tool / `/<skill-name>` (plugin-qualified `ls-clad:<skill>`); otherwise read `ls-clad/skills/<skill>/SKILL.md` and follow it inline.
- **Ask the user.** Present a *blocking* choice with your runtime's ask facility and wait — Claude Code: `AskUserQuestion` (blocking); Cursor: its ask tool (non-blocking — end your turn and wait yourself; it does not recognize the literal `AskUserQuestion`); Codex: an ask tool in Plan mode only (`codex exec` is non-interactive). Block **only when no human can answer in this run at all** — never merely because the literal symbol is absent.
- **Show progress.** Claude Code: `TaskCreate`/`TaskUpdate`; runtimes without a task facility: terse inline per-phase status lines. The requirement is *visible progress*, not the specific tool.

## See-and-fix loop

The canonical verification recipe — other skills point here. Run it after each meaningful change:

1. **`RecompileTypeScriptTool`** — read the errors, not just the exit status.
2. **`RunAndCollectLogsTool`** — capture an error baseline *before* the change, diff after. New errors are yours.
3. **`CaptureRuntimeViewTool`** — capture the running preview.
4. **Read the captured image** and actually judge the pixels with full code context — does it look like what the code claims to build?
5. Fix, re-capture. Repeat until the capture matches intent.

Verification runs **inline in the main agent** — the point is multimodal judgment on your own output. Under context pressure, delegate a *batch* of captures to a generic ad-hoc subagent and have it report back; never maintain a standing verifier.

**Temporary instrumentation.** When a capture looks wrong and the cause isn't obvious: inject a temporary log probe (a script edit or an `ExecuteEditorCode` print), run, observe the logs, read the source, fix the *cause* — then REMOVE the probe and grep to confirm no leftovers.

**Blind-spot checklist** — what a single screenshot cannot show:

1. **Anything animated** — capture at 2+ timestamps, never one frame.
2. **Heavy scenes** — one perf sanity probe: texture sizes, material/mesh counts via `asset-graphql` queries.
3. **Movement/flight paths** — sanity-check against scene bounds with `GetBoundingBox`, not just the visible frame.
4. **Silent-failure classes no screenshot reveals** — property writes in `onAwake`, hand-written `.mat` YAML, CW winding. Grep for these.

**Capture hygiene.** Frame the object under test. Never re-read a stale capture after the scene has changed — capture again.

## Definition of done (Specs builds)

Outcome checks, not steps — verify these before declaring a build done; how and in what order is your call:

- **Every asset imported through a Lens Studio tool** — its `.meta` exists. Hand-placed files are invisible to the project.
- **Plan ↔ disk ↔ scripts agree** — every planned asset is on disk AND referenced by a script; an asset generated but never wired (or promised but missing) is a gap to fix before sign-off.
- **UI built from UIKit primitives** inside a `<Name>UI.ts` module, wired via `@input` typed as the UI class (never `ScriptComponent` + `getScript` casts). No hand-rolled BackPlate (RenderMeshVisual + SimplePBR), hand-rolled Button (collider + Interactable + Text), or hand-positioned label stacks — these compile clean and render, which is exactly why they need a deliberate check.
- **Scene graph written through `VirtualScene`** and saved.
- **`RecompileTypeScriptTool` clean; `RunAndCollectLogsTool` clean** at runtime.
- **A capture reviewed** per the See-and-fix loop (2+ timestamps for anything animated).
- **Icons preferred for UI elements** — pass only `name` to `IconSelector`.
- **Background music** — announced default for game-like/ambient experiences (state it in the plan so the user can strike it); omit for utility/tool UIs or on opt-out.

**Escalation rule:** if one specific item regresses repeatedly, promote that ONE item to a hard rule — do not rebuild enforcement machinery around the whole list.

## Verify the API surface before writing

Before writing against any unfamiliar Lens Studio API, grep `Support/StudioLib.d.ts` (or the project's bundled `.d.ts`) for the class/enum/method signature — the d.ts always wins over any cheatsheet. For conceptual/behavioral questions, query the `QueryLensStudioKnowledgeBase` MCP tool. Cheatsheets and references in this plugin cover behavior the d.ts cannot show (lifecycle, render order, silent drops) — use the d.ts for signatures, the references for behavior.

## Scene & Asset Tools

Tool surfaces for building scenes, in order of preference:

1. **VirtualScene** — Batch declarative scene + asset manipulation in one `apply` call (creates, modifies, deletes; mixed scene objects and assets). Use `read` to introspect (serializes the scene to `.virtual-scene.json` for grep/file-tool inspection at zero MCP cost). **This is the default surface for any scene write.** A single `apply` replaces 50+ scene-graphql/asset-graphql mutations.
2. **scene-graphql / asset-graphql** — **Discovery and introspection only.** Use for `presets { ... }`, `__type` / `__schema`, `allAssets(nameContains: ..., typeFilter: ...)` / `assetsByName(name: ..., typeFilter: ...)` to search the broader asset library (including package-imported assets like SIK prefabs that VirtualScene `read` doesn't index well), and `createSceneObjectFromPreset` for the few SceneObject presets VirtualScene doesn't cover (Camera Object, Image Object, Text Object). Do NOT use `setProperty` / `createSceneObject` / `addComponent` / `createAssetFromPreset` — those go through VirtualScene.
3. **editor-api (skill) / editor-api-specialist (subagent)** — For `ExecuteEditorCode` (LensStudio:* modules, complex traversals, bulk mutations sharing execution context). **Before any `ExecuteEditorCode` call, load the `ls-clad:editor-api` skill** — it carries the `findInterface` namespace / `I`-prefix rules and the `editor.d.ts` lookup workflow that prevent the most common Editor API failures (guessed `Editor.*` symbols that don't exist). For heavy work (2+ EEC calls or several `editor.d.ts` lookups), delegate to the `editor-api-specialist` subagent instead — it auto-loads `editor-api` and keeps the noise out of your context. Never hand-roll Editor API code from memory.

For VirtualScene `apply` syntax and instruction details, read `ls-clad:scene-construction` → `references/virtual-scene.md`. For GraphQL syntax (when discovery/introspection genuinely requires it), read `ls-clad:scene-construction` → `references/scene-graphql.md` or `references/asset-graphql.md` before writing queries — wrong syntax causes silent failures. The `ls-clad:scene-construction` skill covers cross-tool selection.

### Reading scene state between VirtualScene applies

`VirtualScene { command: "read" }` (callable any time — before or between `apply`s) serializes the scene to `.virtual-scene.json` at the project root. For inspection-only reads (filtering one object, checking a property, extracting an ID), use `jq` against that file directly — it's zero-cost and zero-MCP. Don't reach for `python3 -c "import json..."` heredocs.

```bash
# Find SocialFeed object's components
jq '.sceneObjects[] | select(.name=="SocialFeed") | {id, comps: [.components[].type]}' .virtual-scene.json
```

**Safety**: this file is VirtualScene's view of state. Trust it between consecutive VirtualScene applies in a single-writer session. Do NOT trust it after `ExecuteEditorCode` mutations, scene-graphql mutations, UI interactions, or runtime changes — re-run `VirtualScene cmd=read` instead.

## Canonical Call Recipes

For exact GraphQL discovery syntax, do NOT invent argument names — load the authoritative references instead:

- **scene-graphql / asset-graphql syntax** → load `ls-clad:scene-construction` and read `references/scene-graphql.md` or `references/asset-graphql.md`.
- **Runtime/preview state** (live scene at render time, rendered pixels, hand-interactor input, runtime logs) → that's a different surface. Use the `preview-inspection` skill, or run the See-and-fix loop (above) for multi-step verification.

### Author time vs runtime — two surfaces for the same data

Lens Studio has two phases, and most scene data (bounds, transforms, materials, component values) is readable/writable from a *different* surface in each. Reach for the wrong-phase surface and you get a silent no-op or a "method doesn't exist" error, not a helpful one. Match the surface to the phase:

| | **Author / editor time** (building the scene, not running) | **Runtime** (preview running) |
|---|---|---|
| Surface | MCP tools (VirtualScene, `GetBoundingBox`, …), scene/asset-graphql, `ExecuteEditorCode` | runtime Lens API in `.ts` scripts, `QueryRuntimeSceneTool` (`preview-inspection`) |
| Bounds / AABB | `GetBoundingBox` MCP tool | `rmv.worldAabbMin()/worldAabbMax()` in script, or `QueryRuntimeSceneTool { … bounds }` |
| Material color | `setProperty(propertyPath: "passInfos.0.baseColor")` | `mat.mainPass.baseColor = …` |

The same author-vs-runtime split is documented per-property in `materials` § Editor/GraphQL vs Runtime API and `lens-debug` § Layout wrong at runtime (the AABB card). When in doubt about which phase you're in: if a preview is *running* and you want what's actually on screen, that's runtime; everything else is author time.

### scene-graphql discovery
- `{ allSceneObjects(nameContains: "X") { id name } }`
- `{ allSceneObjects(hasComponent: "Camera") { id name } }`
- `{ sceneObject(id: "uuid") { id name components { type } } }`
- `{ rootSceneObjects { id name } }`
- Filter args (only these): `nameContains`, `hasComponent`, `hasProperty`, `limit`, `offset`. There is no `filter:` and no `scene` root field.

## Editor API Delegation

The rule for **all** Editor API work: **load the `ls-clad:editor-api` skill before writing any `ExecuteEditorCode` code.** Never hand-roll Editor API code from memory. The skill carries the `findInterface` namespace / `I`-prefix rules and the `editor.d.ts` lookup workflow.

**Load inline vs. delegate — the skill is loaded either way:**

- **Single call, no type hunt** → load `ls-clad:editor-api` and call `ExecuteEditorCode` yourself.
- **Heavy work** → delegate to the `editor-api-specialist` subagent (it auto-loads `editor-api`), so the intermediate noise stays out of your context.

When in doubt between the two, delegate: an unnecessary subagent call is one round-trip; hand-rolled Editor API code is a debug spiral.

Delegate (rather than load inline) whenever you need to:

- **Access `LensStudio:*` modules** — FileSystem, Shell, Network, Preview, App; hidden/internal modules such as Engine only after checking public declarations or using a guarded workflow-specific import
- **Make 2+ `ExecuteEditorCode` calls or several `editor.d.ts` lookups** for one task
- **Perform complex scene traversals** — recursive walks, filtering, bulk queries
- **Do bulk mutations** — operations that must share execution context

The subagent starts fresh with no context about your scene. Give it specific, actionable instructions — not high-level goals:

- **BAD:** "Set up the scene for a face filter"
- **GOOD:** "Create a SceneObject named 'Face Mask' as child of the Face Tracking object (ID: abc-123). Add a RenderMeshVisual component. Set its material to the FaceMaskMaterial asset (ID: def-456)."

Include: target object names and IDs, exact property values, parent-child relationships, and order of operations. The more specific your delegation, the fewer round-trips needed.

### Domain Skills

Invoke these skills **during planning, not just execution** — they document requirements that cause hours of debugging when missed. For the full domain-skill table (camera-and-rendering, materials, shader-graph, vfx-graph, physics, lens-api, lens-debug) and when to invoke each, see `ls-clad:scene-construction`. The three scene-construction reference files are:

| Reference | When to read |
|---|---|
| **`ls-clad:scene-construction` → `references/virtual-scene.md`** | Batch scene + asset manipulation via the VirtualScene MCP tool — `read`/`apply`, instruction format, reference syntax (`@id:`, aliases), phase ordering. Read before any scene-write work; this is the default scene/asset surface. |
| **`ls-clad:scene-construction` → `references/scene-graphql.md`** | Exact GraphQL syntax for scene-graphql discovery operations — `presets`, `__type`/`__schema`, the few preset creates VirtualScene doesn't cover. Read when introspection actually requires GraphQL. |
| **`ls-clad:scene-construction` → `references/asset-graphql.md`** | Exact GraphQL syntax for asset-graphql discovery — `allAssets`, `assetsByName`, asset library search including package-imported assets. Read when searching the broader asset library. |

## Platform setup before testing

Project target, camera tracking mode, and preview simulation input are platform-dependent and must match the Lens's intent **before** you preview — defaults are frequently wrong, and a wrong default yields a build that looks fine in the editor but does nothing in preview. Don't hand-roll these; run the platform init skill:

- **Specs** → `specs-project-init` (auto-fixes Spectacles target, Perspective + `DeviceTracking` World, Spectacles preview device).
- **Snapchat** → `snapchat-project-init` (inline checklist: tracking mode, preview input, target — each inferred from what the Lens does).

## Scene Preparation

Before any scene generation task or when starting fresh:
1. **Reset the preview** — use `/reset-preview-environment` to clear existing objects, reset the camera, and establish a log baseline
2. **Ensure dependencies** — use `/ensure-package-installed` to verify required packages are present before building

## Best Practices

- When a rendering issue persists, check the full pipeline: camera type → render layer → Canvas component → material blend mode — not just the object itself
