<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Lens Studio Physics — MCP Workflow

How to drive Lens Studio MCP tools when the work is **physics-specific**. Generic MCP usage (the `VirtualScene read` → grep → ID lookup loop, `scene-graphql.setProperty` syntax, `ExecuteEditorCode` preamble, Preview screenshot capture, script-wiring) lives in:

- `scene-construction` → `references/scene-graphql.md` — `setProperty` / `valueType` / `enumType` / `setLocalTransform` syntax.
- `scene-construction` → `references/asset-graphql.md` — `createAsset` / `createAssetFromPreset` / asset property syntax.
- `editor-api` — `pluginSystem.findInterface(...)` preamble, `safeDeepFind`, script-component-to-TS-asset wiring, "editor model doesn't reflect runtime sim".
- `preview-inspection` — `PreviewPanelTool` capture loop, `MovePreviewCamera` quirks, `outputPath` rule, component-tree introspection, log-based verification.

This file covers only the physics-specific pieces of those workflows.

## Physics-relevant discovery starts

After the generic `VirtualScene read`, these grep patterns answer "where does physics already live in this project?":

```
FileGrepTool(pattern: '"type": "BodyComponent"',        uri: 'project://.virtual-scene.json')
FileGrepTool(pattern: '"type": "ColliderComponent"',    uri: ...)
FileGrepTool(pattern: '"type": "ConstraintComponent"',  uri: ...)
FileGrepTool(pattern: '"type": "WorldComponent"',       uri: ...)
FileGrepTool(pattern: '"type": "ScriptComponent"',      uri: ...)   # find existing physics scripts

# Mode C — skinned / deforming visuals (face / hand / body / world mesh):
FileGrepTool(pattern: '"type": "FaceMeshVisual"',       uri: ...)
FileGrepTool(pattern: '"type": "HandMeshVisual"',       uri: ...)
FileGrepTool(pattern: '"type": "FullBodyMeshVisual"',   uri: ...)
FileGrepTool(pattern: '"type": "DeformMeshVisual"',     uri: ...)
FileGrepTool(pattern: '"type": "WorldMeshVisual"',      uri: ...)

# Scene asset (for physicsRootSettings — see "Wiring the root WorldSettingsAsset" below):
FileGrepTool(pattern: '"type": "Scene"',                uri: ...)
```

Confirm available physics presets at runtime rather than baking in a list — preset names change across LS versions:

```graphql
query { presets(type: SceneObject) { name } }
```
Filter the result for `Physics` and `PhysicsObjectPreset`.

## Physics-component property paths

Use the exact key names that appear in `.virtual-scene.json`. The physics-specific ones:

- `components.BodyComponent.dynamic` (bool)
- `components.BodyComponent.damping` / `angularDamping` (number)
- `components.BodyComponent.bodySetting` (enum `Mass | Density`) + `bodySettingValue` (number)
- `components.BodyComponent.shape.size` (vec3, Box only)
- `components.BodyComponent.shape.radius` / `length` / `axis` (Sphere / Capsule / Cylinder / Cone)
- `components.BodyComponent.shape.mesh` / `shape.skin` (asset refs — Mesh shape)
- `components.BodyComponent.shape.convex` (bool — Mesh shape, must be true for dynamic)
- `components.ColliderComponent.intangible` / `fitVisual` / `forceCompound` / `debugDrawEnabled` (bool)
- `components.ColliderComponent.matter` / `filter` / `overlapFilter` / `worldSettings` (asset refs)
- `components.ConstraintComponent.constraint` (enum `Fixed | Point | Hinge`)
- `components.ConstraintComponent.target` (component ref — BodyComponent or ColliderComponent)
- `components.WorldComponent.updateOrder` (int) / `worldSettings` (asset ref)

`enumType` for the constraint kind is `Editor.Components.Physics.Constraint` — copy verbatim from the JSON. For `ExecuteEditorCode` paths, use integer indices: `Fixed=0, Point=1, Hinge=2` (see `gotchas.md` on integer-enum risks).

## Mode A — fresh primitive via PhysicsObjectPreset

`scene-graphql.createSceneObjectFromPreset({ presetName: "BoxPhysicsObjectPreset", parentId })` returns a SceneObject pre-wired with `RenderMeshVisual` + `BodyComponent` + a matching shape. Then:

- Body fields: set `dynamic`, `bodySetting`, `bodySettingValue`, `damping` via `setProperty`.
- Shape size: set `shape.size` / `shape.radius` / etc. via `setProperty`.
- **Preset default scale is `(10, 10, 10)` — set scale to `(1, 1, 1)` before adding constraint children** (see `gotchas.md`).

## Mode B — attach to existing imported mesh

Follow the bbox-driven sizing + pivot-wrapper recipe in `references/api-surface.md` (*Fitting colliders to existing imported meshes*) — the fit loop is measure → triage → plumb → shape → verify → mass-apply. Delegate the `ExecuteEditorCode`-heavy steps to the `editor-api-specialist` subagent. Done when the wireframe lines up with the visible mesh in a screenshot.

## Mode C — skinned / deforming-mesh collider

Mesh shape with both `shape.mesh` and `shape.skin` bound. Construction requires `Editor.Shape.createMeshShape(scene)` — a native call only available inside `ExecuteEditorCode`. Delegate to `editor-api-specialist`; pass:

- SceneObject id of the deforming visual (FaceMeshVisual / HandMeshVisual / FullBodyMeshVisual / DeformMeshVisual / WorldMeshVisual).
- Whether the SceneObject already has a `Skin` component (use `scene-graphql.addComponent({componentType: "Skin"})` first if not — bare `FaceMeshObjectPreset` ships without it).
- That the collider must be `ColliderComponent` (or `BodyComponent { dynamic: false }`) — skinned mesh colliders cannot be dynamic.

See `references/api-surface.md` § *Skinned / deforming mesh colliders* for the exact code recipe.

## Wiring the root WorldSettingsAsset

For the full 3-step recipe (createAsset → grep Scene → setProperty), see `gotchas.md` § *The default WorldSettingsAsset is read-only*.

Per-world (custom `WorldComponent`) override path: `setProperty` on the WorldComponent with `propertyPath: "worldSettings"`. Per-collider override path: `setProperty` on the ColliderComponent / BodyComponent with the same field name.

## Matter / Filter asset wiring

Per-collider `matter` and `filter` overrides take asset references. Pattern:

```
asset-graphql.createAssetFromPreset({ presetName: "Matter",  name: "BouncyMatter" })
asset-graphql.createAssetFromPreset({ presetName: "Filter",  name: "DynamicOnlyFilter" })
asset-graphql.setProperty({ id: matterId, propertyPath: "dynamicBounciness", value: 0.9, valueType: NUMBER })
scene-graphql.setProperty({ id: colliderId, propertyPath: "matter", value: matterId, valueType: REFERENCE })
```

See `gotchas.md` § *Bouncing "doesn't work" — check the partner* for the multiplicative-bounciness rule and the `defaultMatter` fix.

## Shape construction (always `ExecuteEditorCode`)

Shapes are native objects scene-graphql can't construct. `scene` and `body` come from the standard `ExecuteEditorCode` preamble documented in `editor-api`. For the full minimal code block and gotchas, see `api-surface.md` § *Minimal shape-build pattern*.

## Verifying physics work specifically

The generic screenshot / log / component-tree introspection loops live in `preview-inspection`. What's specific to physics:

- **`debugDrawEnabled = true` is mandatory while authoring** — the cyan wireframe is the only way to confirm the collider matches the visual. Always set it on every collider/body you touch.
- **The editor model's `worldTransform.position` does NOT update during runtime physics sim.** For motion verification, screenshot the preview at successive times; for "did my handler fire", use `print()` + `RunAndCollectLogsTool`. (Generic note in `editor-api`; physics is the canonical example.)
- **`InjectPreviewGesture` is not reliable for continuous drag** — for drag testing, drive the handler directly via a `DelayedCallbackEvent` in your script.
- **Self-firing launchers for screenshot loops** — bind a `DelayedCallbackEvent` after N seconds to call the launch handler. Lets you capture motion without injecting a tap.

## Physics-relevant script-wiring inputs

When wiring a physics `ScriptComponent` to a TS asset (generic wiring covered in `editor-api`), the common `@input` slots:

- `body: BodyComponent` (or `collider: ColliderComponent` — note the latter accepts both at runtime; feature-test before reaching for body-only APIs, see `gotchas.md`).
- `worldSettings: Asset` — runtime fallback when you can't guarantee root assignment.
- `sweepShape: Asset` — Shape input for `probe.shapeCast` (probe can't construct shapes itself).

Assign these via `(sc as any).body = bodyComponent;` after binding the script asset.
