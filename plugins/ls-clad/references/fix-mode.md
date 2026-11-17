<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

## Phase 4: Fix Mode

Entered **only** when the Mode Dispatch step routes here (`HANDOFF_PAYLOAD` contained `mode: fix`). The scene + scripts + assets already exist from a prior build pass; you are doing targeted surgery to address issues returned by the caller's post-build verify (the See-and-fix loop / `verify-preview` pass).

**Do NOT re-run Phase 0 (plan), Phase 1 (survey), Phase 2 (sequential build), or Phase 3 (full bootstrap).** Fix mode reuses the existing manifest and scripts as source of truth. The whole `Phase 2 → Phase 3` heavy lift is what produced the broken state in the first place; repeating it would discard partial work and likely introduce new failures.

**Verification does not run in fix mode.** The caller (`/lens-studio-router` skill running in the main agent) is responsible for the re-verify after fix mode returns — it invokes `/verify-preview` itself. The fix-report's machine-readable summary adds a `fix_report:` key on top of the Phase 3e shape; everything else (`asset_manifest`, `backend_deviations`, `ui_packages`, `spatial_layout`) matches Phase 3e.

**EXCEPTION — a post-fix visual inspection IS mandatory when any applied fix has visual implications** (materials/opacity/blend mode, meshes, textures, placement/orientation/scale, animation, lighting, VFX — anything that changes what is rendered). The full structural re-verify still belongs to the caller, but you must never hand back a visual change you did not look at — see §4c.5. 'The caller re-verifies' is exactly how an opaque-material or occluding edit ships unnoticed.

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

Split the work into **required** and **optional**. **Required = every `severity == "blocker"` AND every item the improvement list marks `MUST` / required / critical / #1 (including the evaluator's `Major Issues — Must-Fix`).** You MUST implement ALL required items — not a subset — before returning; a pass that lands only some of the must-haves is incomplete. Then take on as many `HIGH`/high-impact optional items as the budget allows, and address one-line warnings opportunistically. The ONLY thing you may leave undone is a genuinely out-of-scope subsystem (a whole new networking/video/ML stack, or a custom shader system the environment cannot build) — record each such deferral, with why, in `issues_skipped`. Never skip a required item just to stay under the recompile budget.

For each issue, route by `category`:

| `category` | Fix action |
|---|---|
| `missing_component` | Edit the relevant `Assets/Scripts/<X>.ts` to add the missing component creation in `onAwake()` (or wherever the parent SceneObject is built). If the missing component is a wiring-only fix (e.g. `Interactable` needs to be added to an existing SceneObject), edit the script. `RecompileTypeScriptTool` after. |
| `wrong_position` | Edit the `worldPosition` constants / `transform.setLocalPosition(…)` calls in the relevant script. Re-check with Phase 2g's spatial-layout math (pairwise overlap + viewport bounds) before committing the edit. `RecompileTypeScriptTool` after. |
| `ui_wiring` | If an authored `@input` reference isn't connected — a UI/controller/component ref, an authored-object ref, an anchor array, or a tunable scalar — run ONE targeted `VirtualScene apply` batching the missing `setProperty` op(s) (`valueType: REFERENCE` for refs, `STRING`/`NUMBER`/`BOOLEAN` for scalars, `VEC3`/`VEC4` for colors and vectors — a color `@input` is a `vec3`/`vec4`, e.g. `value: "0.8, 0.1, 0.1, 1.0", valueType: VEC4`; the component-UUID path for component-typed refs — see `scene-graphql.md`). If the issue is a missing setter/event on a UI module, re-invoke `/specs-build-ui` for that single method (Phase 2d's re-invocation rule applies). |
| `missing UI surface` (categorized as `ui_wiring` with detail mentioning a missing element) | Re-invoke `/specs-build-ui` with the missing surface described in the prose args. After it produces the updated `*UI.ts`, re-bootstrap that ScriptComponent if needed (one VirtualScene apply max). |
| `missing mesh / wrong dimensions` (categorized as `missing_component` with detail mentioning a mesh) | Re-invoke `/build-mesh` for that single entry with corrected `target_size_cm`. Update collider sizes in the script per Hard Rule 6.8. Never compensate with `setLocalScale`. |
| `orphan_asset` | Either reference the asset from the relevant script (preferred — the asset was generated, so use it) or delete the asset file. Warning severity, never blocks. |
| `interaction_failed` | Likely a wiring issue: the object has `Interactable` but its collider is wrong shape/size, or `InteractableManipulation` isn't configured. Read the scene state via `VirtualScene read` + `scene-graphql`, identify root cause, edit + `RecompileTypeScriptTool`. |
| `scene_empty` | The main script never instantiated the planned content (likely a Phase 2f failure). Read the main script. If `buildScene()` exists but is empty / no-op, the script is broken — re-invoke `/build-mesh` is not the fix; the script needs to actually call `requireAsset()` and `createComponent()`. Edit + recompile. |
| `runtime_error` | A runtime exception fired (blocker — the verify pass prefers this category when a log finding is the root cause, and attaches the verbatim error line + user-script frame in `detail`). Load `/lens-log-analysis`, read the attached `tail` frame to locate the throwing line in the named `Assets/Scripts/<X>.ts`, edit to fix the cause, then `RecompileTypeScriptTool`. Don't re-run a generation skill — this is a script bug. |
| `compile_error` | The verify pass already ran `RecompileTypeScriptTool` and saw it fail (blocker). Fix the TypeScript error in the named script (read `detail` for the compiler message), then recompile. Stay within the §4c three-recompile budget. |
| `other` | Read `detail` and `suggested_fix`. If neither suggests a clean route, surface the issue in `issues_skipped` of the fix-report and continue. |

### 4b.5. Parallel dispatch — only when nested sub-agents are available

Run the builder's nesting probe first (Hard Rule 7: `echo "${CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH:-1}"`). At depth 1 or
unset, skip this step — every issue is fixed inline as in 4b. At depth ≥ 2:

1. Partition the accepted issues into **independent** items: different files, no shared interface change, no scene
   bootstrap. Anything that touches the same file, changes a type/`@input` surface another file depends on, or needs a
   `VirtualScene` apply stays inline and sequential.
2. Fix any shared interface yourself first, then dispatch the independent items **in one message**: one
   `ls-clad:step-script-file` per script (brief = file path, the exact defect, the expected behaviour, the interfaces it
   must not change), `ls-clad:step-ui-module` per UI module, `ls-clad:step-mesh` for asset regeneration,
   `ls-clad:editor-api-specialist` for heavy `ExecuteEditorCode` work. Briefs are self-contained — the agents start
   with zero context.
3. Spawn exactly as the builder's Hard Rule 7 says (foreground, one message for the parallel batch, wait for every
   result, no `ListAgents` / `TaskStop`; a dropped or failed spawn is done inline instead of retried).
4. Continue with **one** recompile (4c), the mandatory post-fix visual inspection (4c.5), and the save — all in your own
   context. Never delegate the inspection, the report, or the budget decisions.

### 4c. Recompile and re-bootstrap budget

- **Max one `VirtualScene apply`** in the entire Phase 4 (for `@input` rewiring or bootstrapping a single new UI ScriptComponent). If multiple issues each require a VirtualScene op, batch them into the single apply call. If you can't fit, prefer script edits over bootstrap-side fixes.
- **Max three `RecompileTypeScriptTool` calls.** Edit, recompile, fix compile errors, recompile, final check. Beyond three, abort and report compile failure in `issues_skipped`.

### 4c.5. Post-fix visual inspection (REQUIRED for visual changes)

If ANY applied fix has visual implications (materials/opacity/blend mode, meshes, textures, placement/orientation/scale, animation, lighting, VFX, scene composition), you MUST look at the result — the way the user sees it — before returning. Measured failure this rule exists for (CI run `f1487297`, 2026-09-24): a fixer added a translucent water volume + glass panel + interior light, "inspected" with two `CaptureRuntimeViewTool` renders, and handed back a tank whose interior had become a washed-out milky rectangle; the post-eval fell 4.25 → 3.0.

0. **Snapshot the pre-fix evidence before you edit anything.** `cp -R <lens>/capture_driver <lens>/capture_driver_prefix` (the runner wipes `capture_driver/` on every run) and note the evaluator's `eval_frames/<run>/` paths. These are your "before".
1. **Re-run the evaluator's capture timeline, don't improvise.** The evaluation left `<lens>/capture_config.json` (start actions, viewpoint, timeline) at the lens root. After the final recompile run
   `python3 <ls-clad>/skills/lens-evaluation/scripts/capture_driver.py "<lens>" --config "<lens>/capture_config.json"`
   — it resets/starts the lens exactly as the evaluation did and writes `capture_driver/` frames (+ `contact_sheet.png` / `timeline.gif` where ffmpeg exists) in seconds. Only if no config exists: reset the preview, drive the primary interaction to the main result yourself, `MovePreviewCamera` to the main viewpoint(s) and `CapturePanelScreenshotTool` (pluginId `Snap.Plugin.Gui.PreviewPanel`).
2. **`CaptureRuntimeViewTool` is NOT an inspection.** It is an isolated orthographic render of selected objects on a black background: translucency stacking, overexposure, occlusion by other objects, layering/render-order and background problems are invisible in it. Use it, if at all, only as a structural aid after the real frames have been read.
3. `Read` the after-frames (contact sheet first when present) **next to the before-frames** and confirm, for each visual fix: (a) the intended change actually renders; (b) the lens's **main result is at least as visible as before** — the payoff (e.g. the fish in the tank) must be clearly distinguishable, not merely "present"; (c) no fix **newly occluded, washed out, or regressed** the visible result. Watch specifically for stacked translucent layers plus lights (milky/overexposed interiors), material edits that render opaque/black (e.g. a `blendMode` that ignores alpha), objects that now clip out of bounds, broken orientation/facing, or animation that looks wrong.
4. If a fix made the visible result worse or did not achieve its visual intent, **revert or correct it now** and re-inspect (re-run the driver). This corrective edit, its recompile, and the inspection itself are OUTSIDE the §4c base budget — never skip the visual verify to stay under budget. If after a genuine attempt a visual goal still cannot be met, record it in `issues_skipped` with what you saw.
5. Record the inspection outcome in the fix-report: the before/after frame paths, what you saw per fix, any revert. A fix-report without before/after frame paths is incomplete.

This does not replace the caller's structural re-verify; it ensures you never hand back a visual change you did not witness as the user would.

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
**Visual inspection:** <for visual fixes: viewpoints checked + what you saw; is the main result visible?; any revert — or "n/a (no visual fixes)">
```

Then the machine-readable block (same shape as Phase 3e):

````markdown
### Machine-readable summary (for router/verifier)

```yaml
asset_manifest:
  meshes:     [<Name>.glb, …]
  sfx:        [<Name>.wav, …]
  icons:      [<name>.png, …]
  ui_modules: [<ExperienceName><PanelName>UI.ts, …]
  scripts:    [<ExperienceName>Main.ts, <ExperienceName><Module>.ts, …]
backend_deviations: [{mesh: <Name>.glb, backend: fast3d, reason: <backend_reason>}, …]  # meshes re-generated off-SPECS this pass; [] when none
ui_packages:   # forwarded from the ui step; {} when the ui step did not run this pass
  UIKit: {installed_version: <version | unknown>, contract: references/uikit-4.0.md, imports_verified: <true | false>}
  InteractionKit: {installed_version: <version | unknown>}
spatial_layout: |
  <spatial layout, updated if positions changed>
fix_report:
  issues_addressed: [<short summary>, …]
  issues_skipped:   [<short summary + reason>, …]
  assets_added:     [<paths>]
  assets_modified:  [<paths>]
  scripts_modified: [<paths>]
  required_items_done: [<each MUST/required item: done | deferred(reason)>]
  visual_inspection: <what you saw across viewpoints; main result visible?; any revert — or n/a>
```
````

The router parses `asset_manifest` + `spatial_layout` for the re-verify call and `fix_report` for the summary it surfaces to the user.
