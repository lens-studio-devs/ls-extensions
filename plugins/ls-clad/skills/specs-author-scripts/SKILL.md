---
name: specs-author-scripts
description: >
  Author the main entry script and helper modules for a Specs experience —
  lifecycle (onAwake/onStart), controllers, and UI wiring via typed @input
  handles and Event<T> emitters. Applies aabb_cm sizing and collider math,
  then recompiles TypeScript.
user-invocable: true
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Author the Main Script + Helper Modules

This skill is the script-authoring step of a Specs build: it writes `Assets/Scripts/<ExperienceName>Main.ts` and the focused helper modules the script plan calls for, wires them to the UI modules and assets produced by the earlier steps, then applies real `aabb_cm` sizing and recompiles. It runs **after** assets (icons, meshes, SFX/music) and the UI modules exist, and **before** the scene bootstrap.

Inputs it expects from the build:
- The **script plan** (module decomposition, naming, exposure rules) — authored by `/specs-plan-experience`.
- The **asset payloads**: per-mesh `aabb_cm` / `aabb_center_offset_cm` / `aabb_min_cm` / `forward_axis` / `grounded` / `animation_available`, generated SFX/music paths, imported icon paths.
- The **UI public APIs**: each `<ExperienceName><PanelName>UI.ts` module's class name, public setter methods, and `Event<T>` emitters — from `/specs-build-ui`.

## Essential Patterns

The runtime must-knows live in `lens-api/references/specs-runtime-patterns.md` (§1–§10): `requireAsset` string-literal semantics + the GLB scale formula (`scale = desired_cm * 100 / aabb_cm`), IK `.lspkg` import paths + `getTypeName()` component creation, the root −Z / child +Z depth idiom, `isNull()`, the authored-scene script shell (debug toggle + typed UI/anchor handles + ref-validation guard), `LowLatency` SFX vs `LowPower` BGM playback, and the `faceDirection` yaw helper (`atan2(dir.x, -dir.z)`). Full code snippets: `references/essential-patterns-code.md`.

**Read `lens-api/references/specs-runtime-patterns.md` before writing the main script.** "Essential Patterns #N" citations below resolve to §N there. The full authored-scene entry-script boilerplate — the `@input`-validation guard (Hard Rule 5), the `setColliderDebugAll` walker (Hard Rule 6.7), and the wrapper-pattern `buildScene()` body (Hard Rule 6.2) — lives in `references/entry-script-boilerplate.md`; read it before writing `<ExperienceName>Main.ts`.

## Write the main script + helper modules

Per the script plan, write the scripts into `Assets/Scripts/`: the main orchestrator `<ExperienceName>Main.ts`, plus the focused modules the plan warrants (`<ExperienceName>State.ts`, `<ExperienceName>SceneRefs.ts`, `<ExperienceName>AudioController.ts`, `<ExperienceName>Interactions.ts` / `<ExperienceName><X>Controller.ts`, `<ExperienceName>SceneBuild.ts`, `<ExperienceName>AssetManifest.ts`). Keep `<ExperienceName>Main.ts` small — it should read like an orchestration table, not the whole app. Each non-trivial file opens with the short header contract (what it owns, what `@input`s it expects, what it must not do) from the script plan's Required-scripts guidance.

- Import each UI/controller class the main script orchestrates: `import { ScorePanelUI } from "./ScorePanelUI"`.
- Declare one typed `@input` per authored SceneObject / ScriptComponent the main script orchestrates — UI modules (`@input scorePanel!: ScorePanelUI`), controllers (`@input playerController!: PlayerController`), and authored anchors/slots (`@input primarySpawnPoint!: SceneObject`) — each typed as its class directly per Lens Studio's [@input + class-type pattern](https://developers.snap.com/lens-studio/features/scripting/accessing-components#accessing-typescript-from-typescript); wired by the bootstrap step's Phase A. **Do NOT** declare a UI/controller handle as `ScriptComponent` and **do NOT** call `.getScript()` or cast with `as unknown as <Class>` — the wired ScriptComponent resolves to the typed class instance at runtime.
- Push state via each UI module's public methods (`this.scorePanel.setScore(n)`) and subscribe to its `Event<T>` emitters (`this.scorePanel.onStart.add(() => ...)`).
- Semantic scene roots — group roots, UI/controller SceneObjects, spawn/drop/target anchors, placeholder visual roots — are **authored by the bootstrap step, not built in code** (Hard Rule 5). In `onAwake`/`onStart`, validate that the required `@input`s were wired (fail loudly with a clear log if not — this is what `<ExperienceName>SceneRefs.ts` is for), then create only transient, pooled, or high-cardinality children in code via `global.scene.createSceneObject()`. Bespoke layout (each placement a design decision) is authored by the bootstrap, not built in `onAwake`; only regular grids and runtime/data-driven content are script-built, under a movable unit root — see Hard Rule 5's "Lay the level out in the scene" for the discriminator. Use `@input` for human-swappable and placeholder-to-final asset slots; use `requireAsset` for fixed internal assets that should not be swapped in the Inspector.
- **Start the background music bed in `onAwake()`** (Essential Patterns #9) for each `music` entry in the manifest, if any: create a SceneObject + `AudioComponent` near the top of `onAwake()`, set `volume = 0.4` (background bed level), and call `play(-1)` to loop. Skipping this line means the music asset is generated but silent. The audit step hard-fails any `requireAsset('../GeneratedSFX/<MusicName>.wav')` without a matching `play(-1)`.
- **No `Component.Text`, no `UIKit.lspkg` imports** in the main script or any non-UI controller module (Hard Rule 3). The audit step will hard-fail any inline text or direct UIKit import outside a `*UI.ts` module.
- **Debug-collider toggle (Hard Rule 6.7):** include `@input debugColliders: boolean = false` on the entry-point (or the relevant controller) class, and a `setColliderDebugAll(SceneObject, boolean)` walker invoked from `onAwake()` after `buildScene()`. Lets the developer flip a single Inspector check-box to wireframe-render every ColliderComponent/BodyComponent in the generated scene. See Essential Patterns #7.
- **`onAwake` touches nothing outside its own component.** Sibling ScriptComponents have not awoken yet, so every call into one — a controller method, a UI module's setter, an `Event<T>` `.add()` subscription, the opening-presentation paint — resolves to `undefined` and takes the whole Lens down (`TypeError: undefined is not a function` → `Rendering failed 5 times in a row`; the build does not render a single frame). `onAwake` gets: `@input` validation, own-field construction, `createSceneObject` / `createComponent` / `setParent`, and `createEvent(...)` binds. **Everything cross-component goes in an `OnStartEvent` handler bound from `onAwake`**, with a `started` flag so no state change can paint into an unawake UI module before that handler runs (Essential Patterns #10; see also the lifecycle order in `/lens-studio-field-notes`). The verification pass below gates this mechanically.
- Compile with `RecompileTypeScriptTool` **once, after the verification pass below** — not after each file. Fix errors (max 3 attempts).

## One verification pass, then one recompile

Every static check this step owes is one command over the whole directory — run it after the last file is written and before the recompile:

```bash
node <skill-tools-dir>/verify-scripts.js <project>/Assets/Scripts \
    [--music-asset <Name>.wav ...] [--icon <name>.png ...]
```

It prints `{lifecycle_gate, errors, warnings, findings[]}` (each finding carries `file`, `line`, `check`, `message`) and exits non-zero on any `error`. One pass covers the `onAwake` lifecycle gate, Hard Rule 3 (UI APIs outside a `*UI.ts` module), non-compiling type annotations, unwired `@input` knobs, oversized files, leftover `aabb_cm` TODOs, and — when you pass `--icon` — orphan icons. Read its `findings[]` for the specifics rather than re-deriving them.

- **Fix every `error`, then recompile once.** `lifecycle_gate: "failed"` is a hard stop: report `status: partial` rather than handing a crash loop to the next step.
- **Each `warn` is a decision, not noise** — fix it or carry it in `deviations[]` with the reason. Silently shipping one turns a declared-but-unwired knob or an orphan icon into a separate downstream fix agent.
- **Do not re-derive these checks as one-off `grep`s.** Re-deriving them by hand is slow, sits on the build's critical path, and still misses the lifecycle crash a single pass catches.

**Do NOT hardcode scale or collider sizes yet** — the AABB-sizing pass below uses real `aabb_cm`. Don't call `setLocalScale` on instantiated prefabs: every backend in `/build-mesh` produces a GLB normalized to `target_size_cm`, so the default 100 scale already gives the size you asked for (Essential Patterns #3). If a mesh comes back the wrong size, that's a `/build-mesh` re-invocation (correct `target_size_cm`), not a downstream scale fix — Hard Rule 6.8. Use spatial-layout-plan estimates for `box.size` and positions, marked `// TODO: verify with aabb_cm`.

## Update script with actual `aabb_cm` (+ center offset, + animation gating)

Mandatory before the bootstrap step. Collider sizes, positions, and overlap checks all depend on real dimensions.

1. **Compute displayed sizes** per Essential Patterns #3 — `aabb_cm` (recorded during mesh generation) IS the displayed size at default scale. Because mesh generation passed `target_size_cm` to `/build-mesh`, `aabb_cm` should already match (or closely match) the plan's estimate; the asset arrived normalized, no scale needed.
   **If `aabb_cm` doesn't match the intended size, the fix is NOT `setLocalScale`** (see Hard Rule 6.8). Instead: re-invoke `/build-mesh` for that mesh with the correct `target_size_cm`. If the mesh has `size_warning: true` in its mesh-generation record, that's an unresolved oversize — re-invoke now, before writing collider code against the wrong dimensions.
   Use intentional art-direction scaling (e.g. "make the trophy 1.5× larger as a hero element") only when the size mismatch is a creative choice, not a units bug — and even then, prefer the wrapper pattern with the scale on a child visual (Hard Rule 6.2), never on a node that owns a collider.
2. **Wrapper-pattern collider placement uses `aabb_center_offset_cm`.** The collider wrapper position is `mesh_world_position + aabb_center_offset_cm`. For voxel meshes with default centering, the offset is mostly zero (or positive Y for bottom-center origin). FAST3D meshes routinely have non-zero offsets; placing the collider at the mesh origin without applying the offset means the collider misses the visual centroid — raycasts won't hit where the user expects. Hard Rule 6.2.
3. **Pairwise overlap check** with displayed sizes:
   - Horizontal gap: `|x1 - x2| > (width1/2 + width2/2 + 2cm)`
   - Vertical gap: `|y1 - y2| > (height1/2 + height2/2 + 2cm)`
   - Different Z depths → overlap is OK *for static-mesh pairs*. UI panels in the foreground of swappable meshes need the bootstrap step's post-bootstrap depth-occlusion check. A panel at z=-110 vs a tree at z=-105 passes this XY check, but if the tree's forward AABB reaches z=-89 the panel is hidden.
4. **Adjust positions** when actual differs from estimates (larger → shift neighbors out; smaller → fine).
5. **Viewport bounds check:** keep every visible object inside the preview camera's frustum at its Z. The visible band is **asymmetric in Y** — the camera pitches down, so more of the scene sits below the eye line than above it, and objects placed high fall off-screen first. Derive the actual bounds from the preview camera/sim rather than hardcoding them. Also confirm the position's **frame of reference**: a value the plan states as world must be written local-minus-parent-offset for any object parented under a shifted root (a panel at "z = -110" set as a local position under a root already at z = -110 lands at world -220).
6. **Animation gating for assets with `animation_available: false`** (Hard Rule 6.6) — grep the script for `playAnimation`, animation clip names, and idle/walk trigger calls referencing flagged assets. Remove or guard those calls. The asset still instantiates and renders as a static prop.
7. **Update script, run the one verification pass above, then recompile** — the sizing edits are part of the same single pass; they are not a second round of checks.

**Foot-on-floor placement (uses `grounded` / `aabb_min_cm` from mesh generation).** A mesh that rests on a surface should *sit* on it — not float above or sink through:
- `grounded: true` (the GLB was re-seated to min-Y = 0) → place the root directly at the surface: `new vec3(x, surface_y, z)`; the base lands on `surface_y`.
- `grounded: false` → offset the root by `-aabb_min_cm.y` so the base reaches the surface: `new vec3(x, surface_y - aabb_min_cm.y, z)`.

`surface_y` is whatever the mesh stands on — the scene's ground baseline for floor props, or a platform/pad's top (`pad_y + pad_height/2`) for a mesh placed on it. This is what makes a helicopter land *on* its pad instead of hovering over it or clipping through.

Common fixes: HUD over 3D content → raise Y or bring forward (z=-108). Two meshes overlap → increase X spacing. Dialog over everything → fine if it starts hidden.

## Standalone invocation (one step, no pipeline)

You do not need a full build to run this. This skill is the `scripts` step.

**Preconditions:** Lens Studio running with the target project open, MCP registered, signed in. `.clad/steps/plan.json` holds the validated plan (the `plan` step wrote it there), which is where most of this step's input is sliced from.

When a required input is missing and no `.clad/` record supplies it, **ask for it and stop** — do not invent a value and do not fall back to a lesser output (field-notes Hard Rule 1).

## Output contract

End the run with exactly one fenced `STEP_RESULT` JSON block. Before returning, also write your STEP_RESULT JSON to `.clad/steps/scripts.json` in the project (create the dir if needed) — the orchestrator and downstream steps read your payload from there. Required fields:

- `step` — `"scripts"`
- `status` — `ok` | `partial` | `blocked`
- `errors[]`, `deviations[]` — arrays of strings
- `retries` — integer ≥ 0
- `scripts[]` — each `{ path, role }` (e.g. `{ "path": "Assets/Scripts/FarmMain.ts", "role": "entry" }`)
- `recompile_status` — `ok` | `failed` | `skipped`

- `lifecycle_gate` — `passed` | `failed` | `skipped`, straight from `tools/verify-scripts.js`. `failed` cannot ship as `status: ok`.

Optional: `animation_gated[]` (asset names whose animation calls were removed/guarded), `aabb_applied` (boolean — real `aabb_cm` sizing pass completed), `fanout` (`{files_total, files_delegated, spawn_messages, inline_files[]}` — set when the per-file fan-out ran; `spawn_messages` must be 1).
