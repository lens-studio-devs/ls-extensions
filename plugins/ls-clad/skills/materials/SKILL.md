---
name: materials
description: Material creation, configuration, and assignment patterns for Lens Studio scene construction. Use this skill whenever creating materials, setting colors or PBR properties, assigning materials to objects, or debugging material-related rendering issues. Covers the critical distinction between Editor/GraphQL API and Runtime Lens API material access — using the wrong API is a common source of silent failures.
user-invocable: true
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Materials

## When to use this skill (vs. shader-graph / vfx-graph)

**Use this skill** for any work that can be expressed as *"pick a preset and tweak its properties"*:
- Adding a material to an object — any preset (`SimplePBRMaterialPreset`, `UnlitMaterialPreset`, etc.)
- Setting `baseColor`, `metallic`, `roughness`, or other shader-exposed properties on an existing material
- Assigning textures to material slots (`baseTex`, `normalTex`, ...)
- Configuring screen-space Image materials
- Discovering what properties a material exposes via GraphQL

**Use a graph skill instead** when the task requires editing the shader/VFX itself:
- Custom shader work (writing GLSL via code nodes, composing template nodes, editing `.graphShader` YAML, adding a parameter that doesn't exist on any preset) → [`shader-graph`](../shader-graph/SKILL.md)
- Custom VFX/particle effect (creating or editing `.graphVfx`, particle pipeline configuration) → [`vfx-graph`](../vfx-graph/SKILL.md)

**Default to this skill.** Escalate to a graph skill only when (a) the user explicitly asks for a custom shader/VFX, or (b) no preset combined with property tweaks can produce the requested look.

## Creating a Material

Use asset-graphql to create from a preset:

```graphql
mutation {
  createAssetFromPreset(
    presetName: "SimplePBRMaterialPreset"
    name: "MyMaterial"
    destinationPath: "Materials"  # folder relative to Assets/ — do NOT prefix with "Assets/"
  ) {
    id
    name
  }
}
```

Common presets:

| Preset | Description | Color setting |
|---|---|---|
| `SimplePBRMaterialPreset` | PBR material with `baseColor`, `metallic`, `roughness` properties. Responds to scene lighting. | Set `baseColor` directly (VEC4) — no texture required for solid colors |
| `PBRMaterialPreset` | Full PBR material requiring texture maps (`baseTex`, `normalTex`, `materialParamsTex`). Use when you have prepared texture assets. | Requires textures — not suitable for setting colors directly |
| `UnlitMaterialPreset` | Renders without lighting calculations. Flat color/texture, ignores lights and shadows. | Good for UI elements, debug visuals, or flat-shaded objects |

## Setting Material Properties

Material properties are accessed through the `passInfos.0` property path prefix:

```graphql
mutation {
  setProperty(
    id: "material-asset-id"
    propertyPath: "passInfos.0.baseColor"
    value: "0.8, 0.1, 0.1, 1.0"
    valueType: VEC4
  )
}
```

| Property | Path | ValueType | Notes |
|---|---|---|---|
| Base color | `passInfos.0.baseColor` | VEC4 | RGBA, each 0-1 |
| Roughness | `passInfos.0.roughness` | NUMBER | 0 = mirror, 1 = matte |
| Metallic | `passInfos.0.metallic` | NUMBER | 0 = dielectric, 1 = metal |

These paths are for **PBR materials** (`SimplePBRMaterialPreset`). The `passInfos.0` prefix refers to the first render pass of the material's shader graph — it is not discoverable from the GraphQL schema, it must be known. See [Discovering Material Properties](#discovering-material-properties) below for other material types.

**Imported GLB (glTF) materials use different property names**: `metallicFactor` / `roughnessFactor` (not SimplePBR's `metallic`/`roughness`). Their lighting mode is a **preprocessor define** — the string `ENABLE_GLTF_LIGHTING` in the pass's `defines` array — not a property: a GraphQL `setProperty` on `passInfos.0.ENABLE_GLTF_LIGHTING` returns `success: true` but changes nothing (verified silent no-op). To inspect or change it, use `ExecuteEditorCode` on the embedded material (`assetManager.getFileMeta(sourcePath).assets.filter(a => a.isOfType('Material'))` → edit `passInfos[i].defines`) and read the array back to confirm.

## Assigning a Material to an Object

Materials are assigned to a **RenderMeshVisual component**, not to the scene object directly:

1. Query the object to find its RenderMeshVisual component ID
2. Use `setProperty` with REFERENCE type:

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

The `id` must be the RenderMeshVisual **component** ID, not the scene object ID. Query the scene object's components to get the RenderMeshVisual component ID (see the scene-construction skill for the components query pattern).

## Screen-Space Image Materials

Screen-space Image components (created via `ScreenImageObjectPreset`) come with a **default Image material** that has specific properties for screen-space compositing:

- **Blend mode** — `PremultipliedAlphaAuto`, required for correct screen-space rendering
- **Texture slot** — `baseTex`, used for the Image's texture content
- **Color** — modifiable via `baseColor` on the material

Do **not** replace the default Image material with a custom UnlitMaterial or PBR material — it will not render correctly in screen-space. Instead, modify the existing default material's `baseColor` to change the Image's color. If you need a solid color with no texture, you can clear the `baseTex` property — but be aware this may produce a checkerboard pattern, which is Lens Studio's visual indicator that a required texture input is missing or empty.

## Editor/GraphQL vs Runtime API

There are two completely different APIs for working with materials. Using the wrong one causes silent failures:

| | GraphQL / Editor API | Runtime Lens API |
|---|---|---|
| Set color | `setProperty(propertyPath: "passInfos.0.baseColor")` | `mat.mainPass.baseColor = new vec4(...)` |
| Where it runs | Scene construction tools, ExecuteEditorCode | TypeScript Lens scripts (.ts files) |
| Documented in | This skill | `lens-api/references/materials-shaders.md` |

`mat.mainPass.baseColor` is **runtime API only** — it does not work in ExecuteEditorCode or GraphQL. The `passInfos.0.baseColor` path is for GraphQL/Editor API only — it does not work in Lens scripts.

### Discovering Material Properties

The properties under `passInfos.0` are **shader-determined** — they vary by material type and custom shader. The table above lists common SimplePBR properties, but other materials (Graph Materials, custom shaders) expose different properties entirely.

Before setting a material property, query the asset's `properties` field via asset-graphql to discover the actual property names available on that specific material. Look for entries prefixed with `passInfos.0.` — these are the settable shader properties.
