<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

## Phase 4: Fix Mode

Entered **only** when the Mode Dispatch step routes here (`HANDOFF_PAYLOAD` contained `mode: fix`). The scene + scripts + assets already exist from a prior build pass; you are doing targeted surgery to address issues returned by the caller's post-build verify (the See-and-fix loop / `verify-preview` pass).

**Do NOT re-run Phase 0 (plan), Phase 1 (survey), Phase 2 (sequential build), or Phase 3 (full bootstrap).** Fix mode reuses the existing manifest and scripts as source of truth. The whole `Phase 2 → Phase 3` heavy lift is what produced the broken state in the first place; repeating it would discard partial work and likely introduce new failures.

**Verification does not run in fix mode.** The caller (`/lens-studio-router` skill running in the main agent) is responsible for the re-verify after fix mode returns — it invokes `/verify-preview` itself. The fix-report's machine-readable summary adds a `fix_report:` key on top of the Phase 3e shape; everything else (`asset_manifest`, `backend_deviations`, `spatial_layout`) matches Phase 3e.

### 4a. Parse the handoff

Read these fields from the fix-mode `HANDOFF_PAYLOAD`:
- `project_path` — absolute path to the `.esproj` (same as the original build).
- `original_request` — verbatim user request from the original build (for context, not for re-planning).
- `issues` — JSON array of `{ severity, category, object, detail, suggested_fix }` entries from the post-build verify.

Read the existing artifacts so the fix can reference them by name:
- `Assets/Scripts/*.ts` (main script + helper modules + `*UI.ts`).
- Asset folders: `Assets/GeneratedMeshes/`, `Assets/GeneratedSFX/`, `Assets/Icons/`.
- Current scene state: `VirtualScene { command: "read" }`.

### 4b. Process issues — blockers first, warnings best-effort

Split `issues[]` into `blockers = [severity == "blocker"]` and `warnings = [severity == "warning"]`. Address every blocker. Address warnings opportunistically — if the fix is one line, do it; if it requires re-running a costly skill, defer and skip.

For each issue, route by `category`:

| `category` | Fix action |
|---|---|
| `missing_component` | Edit the relevant `Assets/Scripts/<X>.ts` to add the missing component creation in `onAwake()` (or wherever the parent SceneObject is built). If the missing component is a wiring-only fix (e.g. `Interactable` needs to be added to an existing SceneObject), edit the script. `RecompileTypeScriptTool` after. |
| `wrong_position` | Edit the `worldPosition` constants / `transform.setLocalPosition(…)` calls in the relevant script. Re-check with Phase 2g's spatial-layout math (pairwise overlap + viewport bounds) before committing the edit. `RecompileTypeScriptTool` after. |
| `ui_wiring` | If the `uiHud` (or similar `@input`) reference isn't connected, run ONE targeted `VirtualScene apply` with a `setProperty(propertyPath: "uiHud", valueType: REFERENCE, value: <ui-script-id>)` op. If the issue is a missing setter/event on the UI module, re-invoke `/specs-build-ui` for that single method (Phase 2d's re-invocation rule applies). |
| `missing UI surface` (categorized as `ui_wiring` with detail mentioning a missing element) | Re-invoke `/specs-build-ui` with the missing surface described in the prose args. After it produces the updated `*UI.ts`, re-bootstrap that ScriptComponent if needed (one VirtualScene apply max). |
| `missing mesh / wrong dimensions` (categorized as `missing_component` with detail mentioning a mesh) | Re-invoke `/build-mesh` for that single entry with corrected `target_size_cm`. Update collider sizes in the script per Hard Rule 6.8. Never compensate with `setLocalScale`. |
| `orphan_asset` | Either reference the asset from the relevant script (preferred — the asset was generated, so use it) or delete the asset file. Warning severity, never blocks. |
| `interaction_failed` | Likely a wiring issue: the object has `Interactable` but its collider is wrong shape/size, or `InteractableManipulation` isn't configured. Read the scene state via `VirtualScene read` + `scene-graphql`, identify root cause, edit + `RecompileTypeScriptTool`. |
| `scene_empty` | The main script never instantiated the planned content (likely a Phase 2f failure). Read the main script. If `buildScene()` exists but is empty / no-op, the script is broken — re-invoke `/build-mesh` is not the fix; the script needs to actually call `requireAsset()` and `createComponent()`. Edit + recompile. |
| `runtime_error` | A runtime exception fired (blocker — the verify pass prefers this category when a log finding is the root cause, and attaches the verbatim error line + user-script frame in `detail`). Load `/lens-log-analysis`, read the attached `tail` frame to locate the throwing line in the named `Assets/Scripts/<X>.ts`, edit to fix the cause, then `RecompileTypeScriptTool`. Don't re-run a generation skill — this is a script bug. |
| `compile_error` | The verify pass already ran `RecompileTypeScriptTool` and saw it fail (blocker). Fix the TypeScript error in the named script (read `detail` for the compiler message), then recompile. Stay within the §4c three-recompile budget. |
| `other` | Read `detail` and `suggested_fix`. If neither suggests a clean route, surface the issue in `issues_skipped` of the fix-report and continue. |

### 4c. Recompile and re-bootstrap budget

- **Max one `VirtualScene apply`** in the entire Phase 4 (for `@input` rewiring or bootstrapping a single new UI ScriptComponent). If multiple issues each require a VirtualScene op, batch them into the single apply call. If you can't fit, prefer script edits over bootstrap-side fixes.
- **Max three `RecompileTypeScriptTool` calls.** Edit, recompile, fix compile errors, recompile, final check. Beyond three, abort and report compile failure in `issues_skipped`.

### 4d. Return the fix-report

After all blockers are addressed (or you've hit the budget and need to surface remaining issues), return:

```markdown
## Fix-mode report

**Issues addressed:** N of M blockers.

- <one-line summary per issue: what was fixed and how>

**Issues skipped:** <count>
- <one-line summary per skipped issue + reason>

**Assets added:** [<paths>]
**Assets modified:** [<paths>]
**Scripts modified:** [<paths>]
**Backend deviations:** <for any `/build-mesh` re-invocation that returned `backend ≠ specs`: mesh, backend, `backend_reason` — or "none">
```

Then the machine-readable block (same shape as Phase 3e):

````markdown
### Machine-readable summary (for router/verifier)

```yaml
asset_manifest:
  meshes:     [<Name>.glb, …]
  sfx:        [<Name>.wav, …]
  icons:      [<name>.png, …]
  ui_modules: [<Name>UI.ts, …]
  scripts:    [<Name>.ts, …]
backend_deviations: [{mesh: <Name>.glb, backend: fast3d, reason: <backend_reason>}, …]  # meshes re-generated off-SPECS this pass; [] when none
spatial_layout: |
  <spatial layout, updated if positions changed>
fix_report:
  issues_addressed: [<short summary>, …]
  issues_skipped:   [<short summary + reason>, …]
  assets_added:     [<paths>]
  assets_modified:  [<paths>]
  scripts_modified: [<paths>]
```
````

The router parses `asset_manifest` + `spatial_layout` for the re-verify call and `fix_report` for the summary it surfaces to the user.
