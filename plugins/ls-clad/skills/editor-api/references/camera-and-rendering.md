<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Camera and Rendering (Editor API)

For domain knowledge (camera setup, material assignment, visibility debugging), invoke the `camera-and-rendering`. This file covers the Editor API surface only.

## Built-in Primitive Meshes (Cube / Sphere / Cylinder / Plane)

Use `scene-graphql.createSceneObjectFromPreset` with `presetName: 'Com.Snap.SceneObjectPreset.Cube'` (or Sphere / Cylinder / Plane) — single tool call. Never read meshes from the Lens Studio app bundle: that path is version-pinned and macOS-only. To drive the preset registry from EEC directly, see `./presets.md`.

## Camera Component

Camera property names in the Editor API differ from the runtime Lens API (e.g. there is no `clearColorOption`). Grep `class Camera extends` in `editor.d.ts` for the canonical surface.

## RenderMeshVisual — Material Slot Operations

`materials` is fine for bulk replacement (`rmv.materials = [a, b]`). For slot-by-slot edits use the methods inherited from `MaterialMeshVisual`:

- `rmv.getMaterialsCount()` — number of slots (0 means none).
- `rmv.getMaterialAt(i)` — read; guard with `Editor.isNull(...)` for empty slots, not JS truthiness.
- `rmv.setMaterialAt(i, mat)` — replace an existing slot.
- `rmv.addMaterialAt(mat, i?)` — append (or insert at `i`) when the slot does not yet exist.
- `rmv.removeMaterialAt(i)`, `rmv.clearMaterials()`, `rmv.indexOfMaterial(mat)`, `rmv.moveMaterial(from, to)`.

```ts
if (rmv.getMaterialsCount() === 0) rmv.addMaterialAt(defaultMat, 0);
else if (Editor.isNull(rmv.getMaterialAt(0))) rmv.setMaterialAt(0, defaultMat);
```

## Render Layers

Cameras inherit from `RenderLayerOwner` (`renderLayer: Editor.Model.LayerSet`). Grep `class RenderLayerOwner` in `editor.d.ts`.

## World Bounding Box

See `@example` on `Editor.Components.RenderMeshVisual` in `editor.d.ts`. For the current editor selection only, prefer the `GetBoundingBox` MCP tool.
