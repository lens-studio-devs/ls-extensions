---
name: camera-and-rendering
description: Camera configuration, 2D/screen-space rendering, RenderMeshVisual patterns, and visibility debugging for Lens Studio scene construction. Use when setting up cameras (orthographic/perspective), creating screen-space content (ScreenTransform, Image, Text), debugging invisible objects, or planning any scene involving rendering config.
user-invocable: true
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

## Orthographic Camera (Top-Down, 2D-Style 3D)

For a top-down orthographic view of **3D objects** (RenderMeshVisual with meshes):

1. Find the camera object and its Camera component ID (via scene-graphql query)
2. Set the camera's type property to orthographic
3. Set `size` to control the visible area — **`size` is the full visible height in world units, not half-height**. If your scene is 160cm tall, set `size` to 160 (not 80). This differs from some other engines where orthographic size means half-height.
4. Position above the scene and rotate to look down:
   - Position: `(0, height, 0)` — high above
   - Rotation: `(-90, 0, 0)` — looking along -Y

If scripts need to convert between screen coordinates and world coordinates, the half-height for conversion math is `size / 2`.

This approach works for 3D geometry viewed from above. It does **not** work for screen-space 2D content (ScreenTransform, Image, Text) — see below.

## Orthographic Camera for 2D/Screen-Space Content

For 2D screen-space content (ScreenTransform, Image, Text), use the `OrthographicCameraObjectPreset` (this is the exact `presetName` argument for `createSceneObjectFromPreset`) rather than converting an existing camera. The preset correctly configures properties that a manual conversion will miss:

- **Canvas component** — the preset itself does not add a Canvas, but when ScreenImage or ScreenText presets create an orthographic camera they add a Canvas automatically. Canvas is not strictly required for ScreenTransform, but without it, ScreenTransform objects may not size or position correctly. Canvas supports three unit modes: **World** (default), **Pixels**, and **Points** (device-independent pixels) — choose based on whether you need world-scale or screen-accurate sizing. A missing Canvas is the most common cause of "I created objects but nothing shows up."
- **Render layer** — screen-space objects use the `Ortho` layer, not the default layer 0. The camera must render this layer or objects will be invisible. Reference the layer by name (`Ortho`) rather than hardcoding a numeric mask, since the mask value depends on the project's layer configuration.
- **Near plane** — must be `-1` to render elements on the z=0 plane. A positive near clips ScreenTransform children that sit at the camera's z position.
- **Render target** — the preset typically configures this to `scene.captureTarget`. Render targets are configurable per camera — Lenses that chain cameras or use custom render targets may assign different targets.
- **Render order** — the preset sets this higher than the main camera so 2D content draws on top. This is the typical configuration, but not always correct — for example, a background segmentation layer may need to render below 3D content. Adjust render order based on your scene's compositing needs.

Do not convert an existing perspective camera to orthographic for screen-space content — too many properties differ. Use the preset.

### Choosing Between 3D-Orthographic and Screen-Space

If your goal is a 2D-looking game or visualization, you have two viable approaches:

| Approach | Use when... | Camera | Objects |
|---|---|---|---|
| **3D objects + orthographic camera** | You want physics, mesh colliders, or 3D lighting on flat-looking objects | Manually configured orthographic (see above) | RenderMeshVisual with plane/box meshes |
| **Screen-space (ScreenTransform)** | You want UI-style layout with anchors, text, and Image components | `OrthographicCameraObjectPreset` (with Canvas) | ScreenImage/ScreenText presets |

## Creating Screen-Space Objects

Screen-space objects require preset creation — not manual SceneObject + component assembly.

Key requirements for screen-space Image objects:

- **Use presets, not ExecuteEditorCode** — always use `createSceneObjectFromPreset` via scene-graphql.
- **Default Image material** — preset-created Images come with a default material configured for screen-space compositing (`PremultipliedAlphaAuto` blend mode, `baseTex` texture slot). Custom UnlitMaterials will not render correctly on screen-space Image components. To change an Image's color, modify the default material's `baseColor` property rather than replacing the material.
- **Parent hierarchy** — screen-space objects must be children (direct or nested) of a camera that has a Canvas component. Objects outside this hierarchy will not render.

## Perspective Camera (3D, Default)

Default type; configured with field of view. No special setup required for 3D objects on the default render layer.

## Camera Properties

Set camera properties via scene-graphql `setProperty` on the Camera **component** ID:

- Clear color configuration: the property names differ between the Editor API and the runtime API — if `setProperty` on a camera property doesn't work as expected, use scene-graphql to query the component's `properties` field to discover the actual property names

### Editor API vs Runtime API

Camera property names in the Editor API are **not** the same as in the runtime Lens API. For example, `clearColorOption` is a runtime property that does not exist in the Editor API. Always query the component's properties or grep `editor.d.ts` if you need Editor API property names.

## RenderMeshVisual

A RenderMeshVisual component provides an object's visible appearance. It has two key aspects:

- **`mesh`** — the geometry (sphere, box, plane, custom mesh)
- **`materials`** — an array of materials controlling appearance

### Assigning a Material

Materials are always an array, even for single-material objects. To assign a material:

```graphql
mutation {
  setProperty(
    id: "render-mesh-visual-component-id"
    propertyPath: "materials.0"
    value: "material-asset-id"
    valueType: REFERENCE
  )
}
```

The `id` must be the RenderMeshVisual **component** ID, not the scene object ID. Query the object's `components` field to get the component ID if unknown.

## Visibility Debugging

If an object is correctly positioned but invisible in the preview:

1. **Is it enabled?** — check `setEnabled` state
2. **Does it have a material?** — objects without materials may not render
3. **Render layer match?** — screen-space objects use the `Ortho` layer, not default layer 0.
4. **Near plane?** — ortho 2D camera must have `near: -1` or ScreenTransform children are clipped.
5. **Canvas present?** — required under `OrthographicCameraObjectPreset`; missing Canvas = nothing visible.
6. **Created via preset?** — use `ScreenImageObjectPreset` via scene-graphql; manual assembly lacks internal bindings.
7. **For physics objects** — dynamic bodies may have fallen out of view due to gravity. See the `physics`.
