---
name: specs-bootstrap-scene
description: >
  Bootstrap an authored Specs scene via two VirtualScene apply calls — Phase A
  creates roots, assets, and bare ScriptComponents; Phase B wires @input after
  recompile, then applies SyncKit hygiene.
user-invocable: true
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Bootstrap the Specs Scene

This skill assembles the authored scene for a Specs experience. The scripts and UI modules already exist on disk (authored by `specs-author-scripts` and `/specs-build-ui`); this skill creates the authored SceneObjects, wires the script `@input`s, verifies placement, and applies SyncKit hygiene. It runs after the `scripts` step and before the audit steps.

---

## Scene assembly doctrine (field-notes Hard Rule 5) — at most 2 `VirtualScene apply` bootstrap calls (Phase A + Phase B)

Scene composition is split by authoring intent. Runtime-only or high-cardinality content can be created by TypeScript, but semantic roots that a human or future agent will want to move, inspect, rename, disable, duplicate, or tune MUST exist as authored SceneObjects created by the bootstrap. The Editor API work is **two** VirtualScene `apply` calls (or `ExecuteEditorCode` fallback), but Phase A creates a richer project-shaped hierarchy instead of a single opaque script root.

**Lay the level out in the scene, not in script — grouped into movable units.** A game developer authors layout in the editor because each placement is a design decision. When positions are bespoke (platforms, props, enemy starts, puzzle pieces, a hand-arranged board), author them as SceneObjects with intentional transforms in the Phase A `create` block — NOT `createSceneObject` loops in `onAwake`. Group each coherent thing under one root so it moves as a unit; its position lives on that root's transform (the one obvious "where is it" control point). Reserve script generation for content that is **regular** (a uniform grid where hand-placing identical elements is pointless — expose `rows`/`columns`/`cellSizeCm`/`gapCm` as `@input` and build under the unit root) or **runtime/data-driven** (spawns, pooled objects, dataset-bound content, anything whose count or positions aren't known until runtime). Discriminator for each element: creative placement → author it; mechanical repetition of an identical element → parametric `@input` + script under the unit root; determined at runtime → script.

**Scale the hierarchy to the experience — this is spatial/game-shaped guidance.** The authored-roots and level-layout rules above assume a build with placed 3D content. A utility, tool, or single-surface experience (translator, timer, AI-chat panel, media viewer, dashboard) has no "level": its authored hierarchy legitimately collapses to the UI panel(s) + their controller(s). Do NOT invent empty `Anchors` / `Content` / `Runtime` group roots to satisfy a shape the experience doesn't have — author only what a human would actually want to grab, move, or tune. The opinion-exposure and passive-view rules still apply in full; only the level-layout machinery is game-specific.

**SyncKit builds parent authored roots under `Colocated World / EnableOnReady`, not scene root.** When the build installs `SyncKit` (Hard Rule 8), every authored gameplay/group root MUST be created under `SyncKit / ColocatedWorld [CONFIGURE_ME] / EnableOnReady / …` — NOT at scene root. Top-level SceneObjects beyond `Camera` / `Lighting` / `InteractionKit` / `SyncKit` render at Lens launch instead of at session-ready, and are deleted on prefab-revert during package updates — the `specs-sync-kit-validator` hard-fails them (Category B). The authored-hierarchy *shape* is unchanged; only its parent moves: build `UI` / `Anchors` / `Content` / … beneath `EnableOnReady`.

Phase A produces:

- ONE `ThemeManager` root SceneObject, **first in root order** — see the ThemeManager rule below.
- ONE main root SceneObject + ScriptComponent (`scriptAsset = @asset:Scripts/<ExperienceName>Main.ts`).
- One authored SceneObject per UI **surface** — this is the default, not a condition to meet. Every panel, dialog, HUD, and toast in the plan's spatial layout gets its own root, positioned at that entry's coords, so a human can select, move, rename, or disable it in the Hierarchy. The `<ExperienceName><PanelName>UI` ScriptComponent attaches to the root of the surface it owns (`scriptAsset = @asset:Scripts/<ExperienceName><PanelName>UI.ts`); a module owning two surfaces gets a sibling root per surface and adopts each by name (`panelRoot` — see `/specs-build-ui`'s *panel-split*). A single UI root with every panel created at runtime is the failure this replaces: nothing in it is selectable.
- Authored empty anchor SceneObjects for spawn points, drop zones, target positions, camera-relative windows, or other human-placeable handles.
- Authored placeholder visual roots for generated assets that can start as cheap primitives and later be swapped to GLB/material/audio outputs without rewriting gameplay logic.
- Any required controller ScriptComponents for reusable authored objects when splitting them improves editability (for example `PlayerController`, `SpawnController`, `AudioController`, `ScoreUIBridge`).
- The main script's typed `@input` fields wired to the authored SceneObjects / ScriptComponents it orchestrates.
- Tunable `@input` fields on UI and controller components for values humans reasonably edit in the Inspector: panel size, padding, row/column gaps, labels, colors, volume, speeds, counts, and debug flags.
- Conditionally `ImageMaterial` — see the detection rule below.

**The two phases (NOT one apply):**

1. **Phase A** — `assets` + `create`. Lands authored SceneObjects, assets, and bare ScriptComponents (no `@input` wiring). Components inside `create` accept only `{ type, properties }` — never `id`. See the "Strict allowlist" subsection.
2. **`RecompileTypeScriptTool`** — required between phases; the `@input` slots only register against live ScriptComponents after compile.
3. **Phase B** — `modify`. Wires SceneObject refs, asset/texture refs, and tunable scalar inputs (batched into one apply regardless of count). **Exception — reference-typed inputs that point at another SCRIPT COMPONENT, and array inputs, are NOT wired by `modify`** (it silently no-ops them, reporting false success); wire those via `scene-graphql setProperty … valueType: REFERENCE` with the target UUID. That is the correct tool for reference properties, **not** the mixed-surface patch anti-pattern below (which is about re-issuing a *malformed* apply through a different surface). See wiring steps 7–8a.

This is enforced by VirtualScene's documented two-phase rule (see `ls-clad/skills/scene-construction/references/virtual-scene.md` "Script Input Wiring (Two-Phase)"). Trying to wire `scorePanel` in Phase A produces the runtime error `Script input 'scorePanel' not found on ScriptComponent — recompile…`.

**Budget:** Phase A + Phase B + one optional retry of EITHER if it produced errors = absolute maximum 3 VirtualScene apply calls per build. After the retry, if errors persist, surface a `bootstrap_failed` blocker — do NOT patch via `scene-graphql` (mixed-surface anti-pattern; see "Recovery: partial-apply errors").

If the scene looks wrong AFTER bootstrap, prefer a deterministic fix path: edit scripts for runtime behavior; use Phase B-style wiring for authored-object refs or scalar defaults; regenerate/swap assets for visual replacements. Do not rebuild the scene piecemeal across mixed MCP surfaces.

What this means in scripts:
- `requireAsset("../path/to/asset.glb")` remains good for fixed internal assets, but asset references MAY be `@input`s when the slot is intentionally human-swappable or part of the placeholder-to-final-asset upgrade path.
- `import { ... } from 'InteractionKit.lspkg/...'` / `'UIKit.lspkg/...'` for IK/UIKit
- `global.scene.createSceneObject()` / `obj.createComponent(...)` for transient, runtime-only, pooled, or high-cardinality children — NOT for semantic roots humans should edit.
- `@input` is preferred for authored scene contracts and human-tunable values. Every input needs a `@hint` and a stable default, grouped and labeled per the Inspector-layout convention (`lens-api/references/conventions.md`) — see "Inspector presentation" in the plan's Script Plan.
- **Debug toggles.** Boolean `@input`s for diagnostic flips (e.g. `debugColliders` — see Hard Rule 6 sub-rule 7 and Essential Patterns #7) are acceptable on the relevant controller, not necessarily only on the entry-point script.

---

## SyncKit post-install hygiene (field-notes Hard Rule 8) — mandatory before reporting completion

Any build that installs the `SyncKit` prefab MUST also apply the three post-install hygiene steps. These are scene mutations you run as part of the build, not TODOs to delegate to the user. The specs-sync-kit skill's §2 Setup documents the *why*; this rule enforces the *when*.

1. **Disable bundled Examples.** Find the SceneObject at path `SyncKit / ColocatedWorld [CONFIGURE_ME] / EnableOnReady / Examples` and call `scene-graphql` `setEnabled(id: <found-id>, enabled: false)`. The Examples SceneObject is hidden in the Inspector at edit-time (its grandparent `EnableOnReady` starts disabled) but the `SetEnabledOnReady.ts` helper flips it to enabled at session-ready — at which point bundled sample content (color-cycling cubes, transform demos) renders on top of your scene. The disable persists on the prefab instance.
2. **Verify `startMode = "START_MENU"`** on the `SessionController [CONFIGURE_ME]`'s `SessionControllerComponent`. `START_MENU` is the prefab default and the correct ship value (users get the Solo / Multiplayer chooser per run). If you flipped to `MULTIPLAYER` during testing, flip it back via `setProperty(<scriptComponentId>, "startMode", valueType: STRING, value: "START_MENU")` before reporting completion. Do NOT write "flip it back in the Inspector" in your completion report as a user TODO — the flip is part of the build.
3. **Verify Camera has `DeviceTracking` with `Tracking Mode: World`.** SyncKit's colocation flow requires this. Without it, the Lens fails at runtime with `Your main camera is currently missing a 'Device Tracking Component'`. On a fresh Specs template the Camera ships with the component configured; if `/specs-project-init` reported it added, you can trust that — but on any custom scene, verify via scene-graphql.

Verification before reporting completion: query each of the three properties and include them in your machine-readable summary as `synckit_hygiene: { examples_disabled, start_mode, device_tracking_world }`. All three must be true / "START_MENU" / true.

Also: in your final completion report, **recommend the caller spawn `ls-clad:specs-sync-kit-validator`** before declaring the build done. That validator runs a fuller structural check (content placement under EnableOnReady, SyncEntity script presence, pre-handoff cleanup) that you can't easily self-verify mid-build. The validator is read-only and reports concrete fixes; it doesn't disrupt your work.

---

## 3a. Minimal bootstrap via VirtualScene

The bootstrap call:
1. Create the `ThemeManager` root SceneObject **first** — see the ThemeManager rule below.
2. Create the main root SceneObject + ScriptComponent (`scriptAsset = @asset:Scripts/<ExperienceName>Main.ts`).
3. Create authored group roots such as `UI`, `Anchors`, `Content`, `Placeholders`, and `Runtime` when the experience is non-trivial. Scale this to the experience (a single-surface utility needs none of them) and, for SyncKit builds, parent them under `ColocatedWorld [CONFIGURE_ME] / EnableOnReady` — see Hard Rule 5's scoping notes.
4. Create one authored UI SceneObject per UI **surface** (panel/dialog/HUD/toast), each positioned at its own Spatial Layout entry's coords, and attach the owning module's ScriptComponent (`scriptAsset = @asset:Scripts/<ExperienceName><PanelName>UI.ts`) to the root it owns. A module with two surfaces gets two sibling roots.
5. Create authored anchor/slot SceneObjects from the authoring manifest: spawn points, drop zones, target handles, placeholder visual roots, and reusable prop roots. Use cheap primitives/materials for placeholder visuals when final assets are still pending.
6. Create additional controller ScriptComponents when they are authored, reusable, or independently inspectable (`PlayerController`, `SpawnController`, `AudioController`, etc.).
7. Wire the main script's typed `@input`s to UI/controller ScriptComponents and authored SceneObjects. **A `@input` that references another SCRIPT COMPONENT (e.g. a UI module, a controller, an audio controller) must be wired via `scene-graphql setProperty(id: <mainScriptComponentId>, propertyPath: "<field>", valueType: REFERENCE, value: "<targetScriptComponentUUID>")`, NOT via VirtualScene `modify` with an `@component:<path>/<ScriptName>` value.** Every script component is *type* `ScriptComponent` (keyed by `scriptAsset`), so `<ScriptName>` is not a resolvable component-type in the `@component:` path — VirtualScene reports the modify as `applied` with no error but **silently binds nothing**, and the lens crashes at runtime with `Input <field> was not provided`. This is the same reference-typed limitation that already forces array `@input`s onto `scene-graphql`; it applies to single script-component refs too. Scalar and SceneObject refs still go through Phase B `modify` as before.

   **The `value` shape matches the property's arity** — this is the detail to get right: a **single** reference (one script component or one object) takes a **plain string UUID**, `value: "<uuid>"`; an **array-typed** input takes an **array** of UUIDs, `value: ["<uuid1>", "<uuid2>", …]`. Passing the single-element array `value: ["<uuid>"]` for a scalar reference returns `success: false` and binds nothing (measured across every script-component ref of a build). When in doubt, match the field: scalar `@input` → string, `@input []` → array.
8. Set UI/controller `@input` fields — Texture refs via `REFERENCE` (UUID string from `Assets/Icons/<name>.png`), strings via `STRING`, numbers via `NUMBER`, booleans via `BOOLEAN`, array and script-component refs via `scene-graphql setProperty` `REFERENCE` per step 7 (single ref → string UUID, array → array of UUIDs).
8a. **Verify every reference-typed `@input` actually bound — do not trust VirtualScene's `applied` count.** Because `modify` reports success even when a reference property didn't bind, after wiring read each script/array/asset ref back (a `scene-graphql` query or `QueryRuntimeSceneTool`) and confirm it is non-null. A `modify` that returned `applied: N, errors: []` is NOT proof the refs stuck. Any ref that reads back null → wire it via the `scene-graphql setProperty … REFERENCE` path and re-verify.
9. **Conditionally** create `ImageMaterial` via `ImageMaterialPreset` under `Materials/` — see detection rule below.

A genuinely **single-surface** build is the one explicit collapse: main + one UI root. Every other build authors a root per surface (step 4) — for anything with multiple panels, meaningful placement handles, or placeholder-to-final asset slots, a richer authored hierarchy is the expected output.

### ThemeManager rule (canonical) — one per scene, first root, `_theme = "System3"`

Every scene this pipeline builds runs the **System 3.0** theme (`System3`), and the whole wiring is one authored SceneObject that this step owns — this section is canonical for it. The bootstrap is where the ThemeManager lands in the scene; the theme's runtime styling behavior is owned by the installed UIKit package (`Scripts/Themes/ThemeManager.ts` + `ThemeService.ts`).

Create it in the Phase A `create` block:

- **Name it `ThemeManager`, no parent, and place it FIRST in root order — before the main root and before every UI module root.** `ThemeManager.onAwake()` calls `setTheme(System3)`, and per `ThemeService` the theme only styles visuals created *after* that call (existing visuals are not restyled). System3 is also `ThemeService`'s built-in default, so setting it late is a no-op for this pipeline — but keep ThemeManager first anyway so the invariant still holds if a scene ever selects a non-default theme: a late `setTheme(System2)` would leave UI built before it on System3.
- **One ScriptComponent, `scriptAsset = @asset:Packages/UIKit.lspkg/Scripts/Themes/ThemeManager.ts`, with input `_theme = "System3"`** (`STRING`) — the `Packages/`-prefixed form is the one VirtualScene resolves. The package script is already compiled when the project opens, so the input can be set in Phase A alongside `scriptAsset`; if the apply reports the input isn't found, wire it in the Phase B `modify` instead. The `_theme` value is package-version-specific: UIKit 4.0 has one theme, `"System3"` (System 2.0 is retired: `"System2"` / `"SnapOS2"` load as System 3.0 with a warning, so never use them); pre-rename UIKit revisions used `"SnapOS3"` — wire whichever value the installed `ThemeManager`'s `_theme` widget exposes.
- **Exactly one per scene.** A second ThemeManager is a race over which `setTheme` runs last — if the scene already has one (template, user-authored, an earlier half of this step), reuse it and just verify `_theme`, per *Reuse, never re-create*.
- **Missing package or missing script = misconfigured build, not something to skip.** If `UIKit.lspkg` isn't installed or the script path doesn't resolve, the apply drops the component and the scene loses its explicit theme selection with no error anywhere. `ThemeService` then keeps its default, which happens to be System3 (`ThemeService.ts` initializes `_currentTheme = System3`; `ThemeManager.ts` documents the same absent-component fallback), so the theme isn't wrong here — but a dropped ThemeManager usually means UIKit itself is missing or misresolved, which breaks far more than the theme. Surface it: record it in `deviations[]` and report `status: partial`. Never omit the object and report `ok`.

`mode: bootstrap-ui` owns it — that half creates the UI surface roots, so the ThemeManager is the first object it creates and belongs in its reported `created_roots[]`. `mode: skeleton` does not create it (that mode attaches no ScriptComponents at all) and doesn't need to: skeleton places proxy geometry, no UIKit visuals.

### ImageMaterial detection rule (canonical)

`Component.Image` requires a `mainMaterial` that doesn't exist by default. Whoever writes `createComponent('Component.Image')` is contractually required to also `requireAsset('../Materials/ImageMaterial.mat').clone()` for that instance (this is documented in `/specs-build-ui` and `specs-author-scripts`'s contracts). This skill's job is to ensure that material exists in the project iff any written script actually uses it.

**Detect, don't guess. Before bootstrap, grep the written scripts:**

```bash
grep -rlE "Component\.Image|ImageMaterial\.mat" Assets/Scripts/ --include="*.ts" 2>/dev/null
```

- **Any hit** → include the `ImageMaterial` asset in the bootstrap apply (full canonical shape below).
- **Zero hits** → omit the `assets` block entirely; bootstrap is just root + ScriptComponent.

This replaces the older heuristic of "always when the manifest has icon entries," which gets it wrong in two ways: a manifest with icons can produce a text-only-fallback UI module that never uses `Component.Image` (creates an unused material), and a main script can use `Component.Image` for an in-world picture/billboard with no `icon` manifest entries (skips a material that's actually needed → runtime crash).

### VirtualScene instruction shape — strict allowlist

Before showing the canonical bootstrap, two schema constraints that have shipped broken builds when violated:

1. **Components inside a `create` entry accept ONLY `type` and `properties` keys.** Any other key — most commonly an `id` — is rejected at apply time with `Unknown key 'id'. Allowed: type, properties`, and the *whole create entry* falls through with cascading `value is not iterable` / `Value is not a native object` errors. The `id` field is valid on the SceneObject create entry itself (top-level `{ id, name, parentId, transform, components, … }`) and on `assets` entries, but never on a nested component. See `ls-clad/skills/scene-construction/references/virtual-scene.md` "Creating Scene Objects" (line 219) for the canonical scene-object/component split.
2. **Script `@input` wiring requires a SECOND `apply` call after `RecompileTypeScriptTool`** — see Hard Rule 5's two-phase rule (and virtual-scene.md "Script Input Wiring (Two-Phase)", line 213). The `@input` slots only register against the live ScriptComponent after the recompile, so Phase A creates structure and Phase B wires inputs.

These two rules combined mean the bootstrap is two applies, never one. More authored SceneObjects do not imply more apply calls: create all authored roots in Phase A, then wire all inputs in Phase B. Reaching for `scene-graphql setProperty` to "patch around" a malformed first apply (a documented anti-pattern — see `ls-clad/skills/lens-studio-field-notes` for the no-mixed-surface rule) is NOT a recovery path; the recovery path is re-issuing a corrected VirtualScene apply.

### Canonical shape (two-phase apply) — see `references/bootstrap-shape.md`

The full canonical JSONC for both applies — **Phase A** (`assets` for `ImageMaterial` iff the grep hit, + `create` for the main root, the group roots, and the authored UI / anchor / placeholder / controller SceneObjects, with **bare** ScriptComponents), the **inter-phase `RecompileTypeScriptTool`**, and **Phase B** (`modify` to wire component/UI/controller refs, authored-object refs, arrays, and tunable scalar `@input`s via `@sceneObject:` refs, batched into one apply) — plus the authored-root handling and the `ExecuteEditorCode` fallback, lives in `references/bootstrap-shape.md`. **Read it now** before issuing the applies. Invariants to carry in from the rules above: components inside `create` take only `{type, properties}` (no `id`); wiring `@input` requires the second apply *after* recompile; never exceed the Hard Rule 5 budget.

### Recovery: partial-apply errors

If the Phase A apply returns a non-empty `errors[]` (e.g. *"Skipped: parent object '$temp:uiGroup' was not created in phase 1"*, *"Unknown key 'id'"*, *"value is not iterable"*), the recovery path is **fix the instructions and re-issue the apply** — not patch via scene-graphql. Each error in the response includes the offending `op`, `targetId`, and message; fix the instruction shape and retry.

The retry counts as the "one optional retry" from Hard Rule 5; you do NOT get a third bootstrap call. If the second VirtualScene apply still has errors:

1. Read the scene with `VirtualScene { command: "read" }` to see what landed vs what didn't.
2. If only a single component wire failed (e.g. one `@input` reference resolved wrong), one `scene-graphql setProperty` is permissible as a final wiring fix — but ONLY targeting a property that VirtualScene's modify path cannot reach (e.g. a UUID-only reference). For anything VirtualScene CAN express, fix it in VirtualScene.
3. If the scene is structurally broken (no main SceneObject, no UI ScriptComponent), the bootstrap has failed — surface a `bootstrap_failed` blocker to the caller and stop. Do NOT attempt to reconstruct piece-by-piece via scene-graphql. That mixed-surface path violates the field-notes Hard Rule and has shipped scenes with orphaned partial state that survive into the user's project.

The forbidden pattern in plain words: patching a partial VirtualScene apply with `scene-graphql setProperty` (e.g. "Phase A landed 7 of 9 objects so I'll just set the missing `scorePanel` and `transform.position` directly"). No — VirtualScene's `modify` path expresses both cleanly, so the fix is a corrected Phase B apply, not scene-graphql calls. The failure ships a working scene tree with an unwired `scorePanel` that only surfaces as "the UI doesn't get game state" several feature-additions later.

**Two ways this goes wrong:** (1) building the scene piecemeal across mixed surfaces — `ExecuteEditorCode` + `scene-graphql setProperty`/`addComponent` over 10+ calls instead of the two applies; (2) a single-phase apply that puts an `id` on a nested component and wires `scorePanel` in Phase A — rejected with `Unknown key 'id'. Allowed: type, properties` AND `Script input 'scorePanel' not found on ScriptComponent — recompile…`.

**Right (2 atomic applies + authored hierarchy + modular scripts):**
```
RIGHT:
  Write Assets/Scripts/<ExperienceName>Main.ts          ← orchestration only
  Write Assets/Scripts/<ExperienceName>State.ts         ← pure logic
  Write Assets/Scripts/<ExperienceName>ScorePanelUI.ts  ← UI @component, built earlier by /specs-build-ui
  Write optional controller/component modules as needed
  RecompileTypeScriptTool                   ← first compile — required before bootstrap
  grep for Component.Image / ImageMaterial.mat in written scripts
  VirtualScene apply (Phase A)              ← assets (ImageMaterial iff grep hit) + create authored roots,
                                              placeholders, anchors, UI/controller SceneObjects
                                              with BARE ScriptComponents (no input wiring)
  RecompileTypeScriptTool                   ← registers @input slots against live ScriptComponents
  VirtualScene apply (Phase B)              ← modify @sceneObject:<Name> ScriptComponent refs/scalars/arrays
                                              in one batched apply
```

If the scene needs changes: edit `.ts` for runtime behavior, or re-run the two-phase bootstrap pattern for authored structure/input wiring. **Do not patch piecemeal across mixed MCP surfaces** (Hard Rule 5).

## 3b. Measure actual AABB & verify — `refit` mode (runs after meshes land)

**This section is the `refit` pass, not the wire pass.** In `bootstrap-scripts` (wire) mode the real GLBs may not exist yet, so size every collider from the frozen `target_size_cm` (the plan baseline — proxy and real mesh share it, so it is usually exactly right) and do **not** call `GetBoundingBox` for drift. The measure-and-correct below runs in `mode: refit`, dispatched once the real meshes have landed and the `mesh` step has re-bound its instances. Refit is **conditional and cheap**: only meshes whose measured bounds drift from `target_size_cm` need any change; meshes that matched need none.

**First, determine collider ownership — it decides whether the `box.size` pass applies at all.** Colliders come in two models and only ONE gives refit a `box.size` to touch:
- **Static / wire-time** — `bootstrap-scripts` created `ColliderComponent`s as scene components, sized from `target_size_cm`. These exist at edit time and are exactly what refit re-measures and adjusts below.
- **Runtime / script-owned** — the controller creates its colliders in `onStart`/`init` via `createComponent("Physics.ColliderComponent")` (the idiomatic IK-interactable pattern: collider + `Interactable` set up together in code, sized in code). These do **not** exist at edit time and their size is not a scene knob, so **refit has nothing to adjust for them**.

Make this determination with ONE cheap check, not a scene walk: grep the authored controller scripts (`Assets/Scripts/*.ts`) for `createComponent("Physics.ColliderComponent")` / `Physics.BodyComponent`. If the gameplay colliders are runtime-owned, **skip the collider `box.size` pass entirely** — report `deviations: ["colliders runtime-created by <Script>.init; no wire-time box.size to refit"]` and move on. Do **not** launch a recursive Editor-API collider census to "confirm zero colliders" (`VirtualScene read` doesn't serialize colliders, so that fallback costs ~10 `ExecuteEditorCode` probes for a fact one grep already gave you). The mesh-AABB drift check below still runs regardless — it's about the *visual*, independent of collider ownership.

In `refit` mode, call `GetBoundingBox` with `includeChildren: true` on each placed mesh **wrapper**, so it descends into the imported GLB's geometry node and measures the real mesh AABB. Returns world-space bounds (already accounts for `localScale`). On a Lens Studio whose Core-ChatTools carries the meshless-node fix, this is the drift-authoritative number directly: empty wrapper/intermediate nodes contribute nothing, so only the real geometry is measured. **On an unfixed plugin the same call still returns the transform-AABB phantom — a suspiciously round ~100 cm cube — because the empty prefab root falls back to a scale-inflated unit box; when you see that, do not re-derive the measurement by hand — run the canonical tool `skills/build-mesh/tools/measure-world-aabb.ts`** (via `make-eec-script.py --json TARGETS=<[{name}|{id}]>` → `ExecuteEditorCode`). It reads true vertex extents (`mesh.info.aabbSize × geometry worldScale`) and returns each mesh's `worldAabbCm`. Prefer the engine-backed `GetBoundingBox` box when it returns a real (non-round-cube) result; fall back to `measure-world-aabb.ts` whenever it returns the phantom — the fallback works regardless of plugin version.

- Compare result to `aabb_cm * scale / 100`. If significantly off, the fix depends on which value is wrong: **`box.size` mismatch** (wire-time colliders only) → adjust `box.size` directly (it's expressed in cm and is the right knob for collider sizing). **Visual mesh mismatch** → re-invoke `/build-mesh` for that mesh with a corrected `target_size_cm`; the asset is normalized at the boundary so downstream nodes stay at unit scale (Hard Rule 6.8). Do NOT reach for `setLocalScale` to compensate — that re-introduces the same units-leak bug Hard Rule 6.2 / 6.8 exists to prevent.
- Pairwise check that AABBs don't intersect (2cm buffer). UI vs 3D content should be in separate Y regions or different Z depths.
- Adjust positions in script + recompile if overlaps detected.
- **Facing (`/build-mesh` Pose contract).** Confirm each placed mesh points the intended way. Stamped meshes read `forward_axis: -Z` (`analyze_glb.js --orient-meta`) and are baked correct — spot-check one with `CaptureRuntimeViewTool { uniqueIds:[id], isolate:true }`. For **moving** meshes, confirm the runtime facing tracks the travel/target vector (a ship points where it's going, not belly-first). For **unstamped / `forward_axis: unknown`** meshes you MUST capture and visually confirm the front — never assume.
- **Completeness.** Any mesh that arrived `completeness: suspect`/`unverified`, or any externally-sourced mesh — capture it isolated and confirm it's the whole subject, not a fragment (e.g. a vehicle that generated as only its cockpit). A fragment is a `/build-mesh` re-invocation, not something to build gameplay around.
- **Foot-on-floor.** For `grounded` meshes, confirm the measured min-Y sits at the intended surface (not floating above / sunk below). If off, fix the placement Y per the script author's foot-on-floor rule — not the asset.

## Placement verification (runs post-bootstrap, alongside 3b)

Don't compute pairwise overlap/occlusion geometry in prose before bootstrap — measure and look after it:

1. **Measure.** `GetBoundingBox` every placed root (meshes AND UI panels) and read the numbers: AABBs intersecting (2 cm buffer) = overlap; **a co-visible panel pair whose x/y rectangles intersect while their z differs by less than the 2 cm panel separation also counts as an `overlaps` hit — even when the 3D AABBs technically don't intersect**, because two thin coplanar (or near-coplanar) surfaces z-fight rather than merely touch; report the pair and separate their z (mutually exclusive panes, where only one is ever enabled, are exempt); an "A on/in B" pair whose A-footprint isn't inside B's = containment violation; bounds past ±26.5 cm X, or outside the **asymmetric** Y band at z = −110 — roughly **−47 … +26**, *not* ±38.5 — = viewport escape. Compute the exact band from the camera's actual pitch and vertical FOV (e.g. 5.55° down, 36.59° vFOV → **−47.05 … +25.68**) and report it in `deviations[]` when you move a panel because of it. For swap-set slots (lifecycle stages, gallery swaps), check against the largest recorded `aabb_cm` in the set.

   `GetBoundingBox` sometimes returns a transform-AABB fallback (a suspiciously round cube, commonly ≈100 cm — one measured build saw ≈±5000 cm) for prefab-instantiated roots that render correctly — if a known-good object reports the same suspicious cube, the numbers are meaningless for **both**; fall back to `QueryRuntimeSceneTool`'s `bounds { extents }` and a capture.
1b. **A failed capture is a diagnosis, not a caveat — read the log before you write the word "paused".** `CapturePanelScreenshotTool` returning `cannot read property 'width' of null`, or any capture that yields no frame, has two very different causes: the Preview panel really is paused, or **the Lens is in a crash loop and there is no frame to capture**. They are indistinguishable from the outside and one of them means the build does not run. So when a capture fails, run `RunAndCollectLogsTool` (`mode: refresh`) once and read what comes back:

   - `TypeError: undefined is not a function` at some `onAwake`, `Component is not yet awake`, `exception while processing lens`, `Rendering failed N times in a row` → the build is **broken**, not paused. Report `status: partial` with the file, line and message in `deviations[]`, and set `runtime_log_status: "errors"`. Placement judged from authored transforms alone is not verification and must be labelled as such.
   - A clean log with no frame → genuinely paused/unavailable; say so, set `runtime_log_status: "clean"`, and report what you could not verify.

2. **Look.** Take one `CaptureRuntimeViewTool` capture and judge placement visually per `lens-studio-field-notes` → "See-and-fix loop": `far`-tagged pairs reading as one clump instead of deliberately separated; a UI panel hidden behind a mesh whose forward AABB reaches past the panel's z (different root z does NOT save it — push the panel closer to camera than `mesh_z + aabb_z/2 + 2 cm`); truncated labels (visible glyphs shorter than the authored string — re-invoke `/specs-build-ui` for that surface, which sizes text via the installed package's text/content sizing contract and confirms legibility in its Verify checklist); anything floating above or sunk through its support.
3. **Fix and re-capture.** Edit the script, recompile, re-capture until the capture matches intent. Numbers come from tool output, judgment from the capture — never from float arithmetic in prose.

4. **Delete every diagnostic object you created.** Probe cubes, marker quads, ruler objects, temporary lights — anything you spawned to measure rather than to ship. They are visible and render as debris in front of the experience. Prefix them so they're findable (`ZZProbe_*`), then delete them all in the same pass that reads their measurement, and confirm zero remain before you report. A capture that still shows debris is not a passing capture.

5. **Save the project — the scene is not on disk until you do.** Everything you built through MCP lives only in the running editor session; a crash, a restart, or simply the user closing Lens Studio loses the entire build, and nothing in the working tree reflects it. This step owns the save:

   ```
   ExecuteEditorCode: const model = pluginSystem.findInterface(Editor.Model.IModel); model.project.save();   // the save lives on model.project — model.save() does not exist
   ```

   Then confirm on disk — `Assets/Scene.scene` should have a fresh mtime and contain your authored root names. Report the save in `deviations[]` if the API differed.

---

## Skeleton mode (`mode: skeleton`) — early visible layout

A build pipeline can call this skill twice: once early in `mode: skeleton`, then again for the full bootstrap. Skeleton mode exists so the user sees real layout minutes into a build instead of after every asset and script is done.

In skeleton mode you do **structure only**: create the unit roots at their planned world positions and instantiate the **proxy** meshes as children at their `spatial_layout` poses, including repeated placements like a grid at its planned pitch. Then take one runtime-view capture and report `visible_confirmed` honestly — a failed capture means the user still sees nothing.

**Placement structure — a plain wrapper with the geometry as a CHILD prefab; never `_prefab` the wrapper itself.** For each placed mesh, create the positioned placement node (`<Name>`) as a **plain SceneObject** (position/rotation only, scale left at 1) and instantiate the GLB as a **child** named `<Name>Mesh` — i.e. two `create` entries: `{ name: "<Name>", parentId: <unit root>, transform:{position:…} }` then `{ name: "<Name>Mesh", parentId: "<Name>", _prefab: "@asset:GeneratedMeshes/<Name>.glb" }`. **Do NOT put `_prefab` on the placement node itself.** A `_prefab` node *is* the instantiated prefab root, and a Lens Studio GLB import carries its m→cm scale as `localScale = [100,100,100]` on that root. If the placement node is the prefab root, it holds the ×100 — and then the `mesh` step's re-bind (which re-instantiates the real GLB as a child under that node) adds a **second** ×100, giving a 10 000× world scale and a mesh that renders 100× oversize (measured: `Board [100,100,100]` × child `BoardMesh [100,100,100]`). Keeping the wrapper plain means there is always exactly **one** prefab root (`<Name>Mesh`) carrying the sole ×100, and the re-bind cleanly replaces that child — no doubling, ever. This also makes skeleton and the re-bind produce the identical `<Name>` / `<Name>Mesh` structure.

Boundaries:
- **No `ScriptComponent`s and no `@input` wiring.** No authored script exists yet.
- **No UI surfaces.** The `ui` step runs concurrently and owns them.
- **Budget: 2 applies**, not 3 — structure is one Phase A shape.
- **The root names you create are a contract.** The full bootstrap pass reuses them by name and wires into them; different names there mean the scene gets rebuilt and the early pass is wasted. Report `created_roots` exactly as spelled.
- **The geometry is placeholder and will be overwritten in place** at the same asset paths. Do not re-place or re-scale anything after the swap: the proxy and the real mesh share `target_size_cm`, so the poses hold.

Result: emit one fenced `STEP_RESULT`. Before returning, also write your STEP_RESULT JSON to `.clad/steps/skeleton.json` in the project (create the dir if needed) — the orchestrator and downstream steps read your payload from there.

## Standalone invocation (one step, no pipeline)

You do not need a full build to run this. This skill serves two steps — `skeleton` and `bootstrap-ui`, selected by `mode`.

**Preconditions:** Lens Studio running with the target project open, MCP registered, signed in. `.clad/steps/plan.json` holds the validated plan (the `plan` step wrote it there), which is where most of this step's input is sliced from.

When a required input is missing and no `.clad/` record supplies it, **ask for it and stop** — do not invent a value and do not fall back to a lesser output (field-notes Hard Rule 1).


## The full bootstrap runs as two halves

Run as one unit, bootstrap could not start until `scripts` finished — the longest step in the pipeline. But its UI half depends only on `ui` and `skeleton`, both of which finish long before scripts does. So the work splits by dependency:

- **`mode: bootstrap-ui`** (step `bootstrap-ui`; depends on `ui` + `skeleton`; **budget 1 apply**) — create the `ThemeManager` root first (see the ThemeManager rule), then the UI surface roots, attach each `<Name><Panel>UI` ScriptComponent, and create any material asset those modules resolve via `requireAsset`. Nothing from `scripts`.
- **`mode: bootstrap-scripts`** (step `bootstrap-scripts`; depends on `scripts` + `bootstrap-ui`; **budget 2 applies**) — attach the authored ScriptComponents, wire every `@input`, verify placement, and **save the project**. Sizes any **wire-time** colliders from `target_size_cm` (colliders the controller creates at runtime are owned by the script, not created here) and **does not wait for `meshes`** — it wires against the proxy scene (wiring binds to persistent wrapper roots, not the swapped GLB). The real-bound drift correction is deferred to `mode: refit`.
- **`mode: refit`** (step `bootstrap-refit`; depends on `meshes` + `bootstrap-scripts`; **budget ≤1 apply, usually 0**) — after the real GLBs land and the `mesh` step has re-bound its instances, run §3b (`refit`): first determine collider ownership (one grep), then `GetBoundingBox` each placed mesh and correct only the drifted **wire-time** colliders' `box.size`; runtime-owned colliders have no edit-time knob and are skipped. Conditional and cheap; save only if something changed. This is the only wiring-side mode gated on meshes.

The `bootstrap-scripts` + `refit` split moves wiring off the mesh critical path: the lens is wired and interaction-testable on proxies while meshes generate, then a short conditional refit corrects any drift when they land.

**Why running the UI half beside `scripts` is safe:** `step-scripts` holds no scene-write tools at all — no `VirtualScene`, no `scene-graphql` — it writes `.ts` files and recompiles. So the two never write the same surface and one-writer-surface (field-notes Hard Rule 4) is not at risk. Do not extend `scripts` with scene-write tools without revisiting this.

**Reuse, never re-create.** `skeleton` hands forward its `created_roots`, and `bootstrap-ui` hands forward its own. `bootstrap-scripts` attaches to those objects **by name**. Re-creating them throws away work the user has already seen on screen.

## Output contract

End your result with **exactly one** fenced `STEP_RESULT` JSON block for your mode. Before returning, also write your STEP_RESULT JSON to `.clad/steps/<mode>.json` in the project (create the dir if needed) — the orchestrator and downstream steps read your payload from there.

Both modes report: `step`, `status` (`ok`|`partial`|`blocked`), `errors[]`, `deviations[]`, `retries`, `applies_used`, `apply_errors[]`.

- **`bootstrap-ui`** adds `created_roots[]` (a contract — `bootstrap-scripts` reuses these names verbatim); optional `ui_components_attached[]`, `created_assets[]`, `screenshot_paths[]`. It has **no** `placement` or `synckit_hygiene` field on purpose: this half verifies no placement and wires no authored `@input`, so reporting them would be a self-report about work it did not do.
- **`bootstrap-scripts`** adds `wired_inputs[]`, `placement` (`{overlaps, containment_violations, viewport_escapes}`), `synckit_hygiene` (object or `null`), and `project_saved` (boolean — required); optional `created_roots[]`, `screenshot_paths[]`, and `runtime_log_status` (`clean` | `errors` | `not_read`) — required whenever a capture failed, per step 1b (report `not_read`, not "paused").
