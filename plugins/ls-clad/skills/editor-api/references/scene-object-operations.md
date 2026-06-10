<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Scene Object Operations (Editor API)

Most patterns now live as JSDoc on the relevant class in `editor.d.ts`:

- **Create / reparent / rename / duplicate / destroy** — grep `class SceneObject`, `reparentSceneObject`, `createSceneObject`, `addSceneObject`, `copy`.
- **Find by UUID** — `@example` on `class SceneObject`.
- **Component management** — grep `addComponent`, `removeComponentAt`, and `interface ComponentNameMap`.

For find-by-name lookups prefer `scene-graphql.sceneObjectsByName` over an EEC walk. For built-in primitives prefer `scene-graphql.createSceneObjectFromPreset`.

## `getTypeName()` Confusion Table

`comp.getTypeName()` returns the same string used as the `ComponentNameMap` key — **not** the user-facing label.

| Common name          | `getTypeName()` string                                                            | Note                                                 |
| -------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Light                | `LightSource`                                                                     | not `Light`                                          |
| Material Mesh Visual | `MaterialMeshVisual`                                                              | not `MaterialVisual`; superclass of RenderMeshVisual |
| Physics Body         | `BodyComponent`                                                                   | not `PhysicsBody`                                    |
| Collider             | `ColliderComponent`                                                               |                                                      |
| Script               | `ScriptComponent`                                                                 |                                                      |
| World (physics)      | `WorldComponent`                                                                  |                                                      |
| Audio                | `AudioComponent`                                                                  |                                                      |
| Trackers             | `DeviceTracking`, `ObjectTracking`, `ObjectTracking3D`, `MarkerTrackingComponent` | no umbrella `Tracker` type                           |

For the full canonical list, grep `interface ComponentNameMap` in `editor.d.ts` — its keys are the only strings accepted by `addComponent` / `getComponent`.

## Batch Creation Pattern

Prefer loops in a single EEC call over multiple tool calls:

```ts
const model = pluginSystem.findInterface(Editor.Model.IModel);
const scene = model.project.scene;
const parent = scene.createSceneObject('Grid');
for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
    const tile = scene.createSceneObject(`Tile_${row}_${col}`);
    scene.reparentSceneObject(tile, parent);
    tile.localTransform.position = new vec3(col * 10, 0, row * 10);
}
return `Created 64 tiles under ${parent.name}`;
```

## Scene Object Gotchas

- **`isSame()` for equality**: Use `obj.isSame(other)`, not `===`.
- **Scene traversal pattern**: There is no built-in `scene.findById()`; recurse from `scene.rootSceneObjects` over `node.children`.
- **`obj.getParent()`, not `obj.parent`**: the `.parent` access silently returns `undefined`.
