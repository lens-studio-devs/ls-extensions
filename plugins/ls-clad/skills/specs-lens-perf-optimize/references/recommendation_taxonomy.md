<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Recommendation taxonomy

Maps each `specs-lens-perf-attribution` recommendation category to a concrete tactic that `perf-fix-applicator` can apply. The orchestrator (`/specs-lens-perf-optimize`) looks up `recipe = recipe_for(candidate.category)` from this table before spawning the worker.

Categories below match the strings produced by `analyze_perfetto_attribution.py`'s `recommendation_for()`. Any category not in this table maps to `recipe = {tactic: "unsupported"}` and the candidate is skipped (logged in the final report).

## Lookup table

| Category | Tactic | Delegate skill | Min reversible edit |
|----------|--------|----------------|---------------------|
| `camera/render` | `reduce-render-passes` | — | Disable the `Camera` that renders to an unused `RenderTarget`, drop extra cameras, narrow `renderLayer`. |
| `mesh/visual/draw` | `merge-static-renderables` | `/specs-optimize-lens-mesh` | Merge RenderMeshVisuals sharing a material; simplify geometry to lowest visually-indistinguishable vertex count. |
| `tracking/ML/gesture` | `gate-tracking-to-active-state` | — | Toggle `tracking.enabled = false` outside the user-active state window. |
| `script/component/logic` | `throttle-update-loop` | — | Throttle hot-path work with a frame counter/accumulator that stays in `UpdateEvent`, cache `getComponent` lookups, remove hot-path `print()`s. |
| `VFX/particle` | `reduce-particle-spawn` | — | Halve spawn rate, reduce lifetime, drop render-target passes; pause when invisible. |
| `generic` | `unsupported` | — | No concrete fix — skip and record in report. |

## Tactic recipes

Each tactic below specifies the minimum viable edit the `perf-fix-applicator` agent should attempt. The agent must NOT generalize beyond these — if a tactic doesn't match the candidate's `top_slices`, it should return `status: "unresolved"` so the orchestrator can revert cleanly.

### `reduce-render-passes` (camera/render)

Targets `Camera`, `RenderTarget`, `RenderMeshVisual.renderLayer` usage. The candidate's `top_slices` usually name a specific camera or render target.

- Pick the lowest-impact disable first: an idle secondary `Camera` component, or the `Camera` that renders to a `RenderTarget` nothing samples from. NOTE: `RenderTarget` is an **asset**, not a component — you cannot "disable" it on a SceneObject; instead disable the `Camera` that outputs to it (or the `Image`/`Material` that samples it). A `renderLayer` that's empty at runtime is also fair game.
- Edit the component's `enabled` input on the SceneObject. Prefer scene-graphql + ExecuteEditorCode over removing the component entirely.
- If multiple render targets are candidates, pick the one whose name appears in `top_slices`.
- Surface in `notes`: which camera/render-target/layer was disabled.

### `merge-static-renderables` (mesh/visual/draw)

Targets clusters of RenderMeshVisuals sharing a material that never move at runtime. The candidate's `top_slices` typically name the parent SceneObject ("treeRoot", "rockCluster", etc.).

- **Preferred path**: invoke `/specs-optimize-lens-mesh` via `Skill` and pass the candidate's parent SceneObject path. The skill performs the merge and simplification.
- **Fallback path** (skill unavailable): manually combine the RenderMeshVisuals under one parent. Only replace them with a single shared mesh asset when the source meshes are genuinely identical geometry; for distinct geometry, do NOT force-share — keep separate meshes and just share the material, or return `unsupported`. Never replace distinct geometry with one shape. Note the manual fallback in `notes`.
- Never apply to skinned meshes, runtime-animated meshes, or meshes parented under a tracked anchor.
- If `top_slices` names a single `ScnVisual` rather than a cluster, fall back to `simplify-mesh` on that one mesh (still via `/specs-optimize-lens-mesh`).

### `gate-tracking-to-active-state` (tracking/ML/gesture)

Targets always-on tracking components (`DeviceTracking`, `WorldTracking`, `HandTracking`, ML detectors) when the candidate has a clearly defined inactive state (onboarding done, intro skipped, scanner closed, etc.).

- Find the script that owns the state transition (`top_slices` will usually name an onboarding/intro/HUD script).
- Add `tracking.enabled = false` in the inactive-state branch and `tracking.enabled = true` in the active-state branch.
- Do NOT delete the tracking component — gate it.
- If the candidate names an ML detector with no clear state owner, return `unresolved` — picking the wrong gate can break the experience.

### `throttle-update-loop` (script/component/logic)

Targets scripts with `UpdateEvent` handlers doing work every frame that doesn't need to. The candidate's `top_slices` will name the script (e.g. `OnboardingTick`, `HUDRefresh`).

- Open the named script. If it has `getComponent(...)` inside `onUpdate` for a **persistent** component (a peer on the same SceneObject, or a stable parent that shares the script's lifecycle), cache the result in `onAwake` and reference the cached value. Do NOT hoist the lookup for components on pooled or dynamically spawned/destroyed objects — a reference cached in `onAwake` goes stale/null once the target is recreated, crashing the loop; leave those in `onUpdate` (or null-check the cached ref each use).
- If it has `print(...)` or `Debug.log(...)` in the update loop, comment out with `// PERF: removed hot-path log`.
- If the work is a tick (counter, refresh) that doesn't need per-frame fidelity, **prefer** throttling in place: keep the `UpdateEvent` handler but only run the heavy work every Nth frame (frame counter) or once an accumulator of elapsed `eventArgs.getDeltaTime()` crosses a threshold. This preserves any per-frame delta-time logic the rest of the handler relies on.
- Only switch the subscription from `UpdateEvent` to a `DelayedCallbackEvent` (4–10 Hz, self-rescheduling) when the update body does NOT use `eventArgs.getDeltaTime()`. `DelayedCallbackEvent` callbacks receive no delta-time arg, so a naive swap crashes at runtime. If you must switch, compute the elapsed delta manually from `getTime()` deltas between callbacks and pass that to the work.
- If the update body's correctness depends on per-frame delta time and cannot be safely throttled in place (e.g. integrators, physics steps), skip the candidate and return `status: "unsupported"` with a note — do NOT convert it.
- Never silently delete error logs or behavior — preserve the side effect, just throttle it.

### `reduce-particle-spawn` (VFX/particle)

Targets `ScnVisual` / `_ngsVfxManager` slices indicating VFX cost.

- Find the VFX component in `Assets/VFX/` (search by name from `top_slices`).
- Halve the `spawnRate` (or equivalent rate input) in the VFX config asset. Do NOT halve the visible particle count by deleting emitters.
- If the VFX has a `visibleOnly` flag or `enabledByDistance`, set it true.
- If the candidate names a render-target pass used only by the VFX, disable that pass.
- Never delete the VFX entirely — the orchestrator's parity check will catch the visual loss, but it's a wasted iteration.

### `unsupported` (generic)

The candidate's category did not narrow to a specific tactic. The orchestrator will skip the candidate and log it in `perf_optimization_report.md` under `skipped (unsupported)`. The user can then either:

- update this taxonomy with a new tactic for the category, or
- exclude the candidate from future runs by raising `min-delta-ms`.

## Adding a new tactic

When a new category appears in `optimization_candidates.md` (e.g. `audio/voice`), update both:

1. The lookup table above with a new row.
2. A new tactic section with: minimum reversible edit, target slice patterns, fallback path, what to put in `notes`.

Test the new tactic on a small fixture before relying on it — `perf-fix-applicator` follows these recipes verbatim, so a vague tactic produces a vague edit.
