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

## Transparency: set `blendMode` (and `depthWrite`) on the pass

Setting alpha on an editor-side material does **not** make it transparent on its own. The alpha rides on `passInfos.0.baseColor` (the `.w` channel), but the surface keeps compositing **opaque** until the pass's `blendMode` is switched off `Disabled`. Set `blendMode` (and `depthWrite`) with `asset-graphql setProperty` on the pass:

```graphql
mutation {
  setProperty(id: "<materialId>", propertyPath: "passInfos.0.blendMode",
              value: "Normal", valueType: ENUM, enumType: "Editor.Assets.BlendMode") { changed after }
}
```

Use `Normal` for alpha blend and `Add` for additive; reading `blendMode` back returns its full `options` list and default, and the members live in the `Editor.Assets.BlendMode` enum — prefer the symbolic names. Set `passInfos.0.depthWrite` (BOOLEAN) **false** for transparent surfaces, **true** for opaque/cutout. This is the single most common "I set alpha but it's still solid" failure in editor-side scene builds.

(Runtime Lens scripts use the opposite handle: `mat.mainPass.blendMode = BlendMode.Normal` — see `lens-api/references/materials-shaders.md`. The `passInfos` (editor) / `mainPass` (runtime) split is the same Editor-vs-Runtime divide as the `baseColor` row in the table below.)

## UberPBR gotchas (pink / white / black / dim / invisible surfaces)

`UberPBRMaterialPreset` is the default PBR material for imported / converted content, and its shader + preset defaults cause a family of surface bugs that are otherwise chased in lighting. These are shader/preset behaviors (not visible in the type declarations) — observed against the migration material pipeline as of 2026-09; re-verify against the installed preset, since a new preset revision can change its shipped defaults:

- **Final opacity = `baseColor.a × baseTex.a`.** The shader does `Opacity *= Albedo.a`, so a `baseColor.a` of 0 renders the surface **fully invisible regardless of texture**, and texture-borne transparency is missed if you only inspect the color's alpha.
- **`opacityTex` samples luminance (brightness), not alpha.** Binding a light-background albedo there reads as fully opaque → **white shards**. For alpha-cutout foliage, set `ENABLE_OPACITY_TEX=false` and use a cutout `blendMode` on `baseTex`'s own alpha instead.
- **Magenta error tile = an `ENABLE_*_TEX` define is true while its slot is null/unresolved.** (A color-only material with an emissive define but no emissive texture is a valid exception.) A bound-but-undecoded albedo renders **black**, not magenta.
- **The preset ships a 1×1 50%-grey `Base.png` as the default `baseTex` (with `ENABLE_BASE_TEX` auto-on).** A color-only material left untouched therefore renders `baseColor × 0.5 grey` — half brightness. Bind a project-local white 1×1 so color-only = `baseColor × white`. The preset may symmetrically ship `ENABLE_NORMALMAP` on with a default normal map, giving false relief to a flat surface.
- **Assigning any texture-slot value auto-adds its `ENABLE_*` define.** To turn one **OFF**, read-modify-write the `passInfos.N.defines` array via `asset-graphql setProperty` (verified: a STRING-array write applies). Do **not** set the define as a property path (`passInfos.0.ENABLE_GLTF_LIGHTING`) — that's the silent no-op described above.
- **`UnlitMaterialPreset`'s `baseTex` slot is gated behind `ENABLE_BASE_TEX`, which is OFF by default.** With the define off the slot is hidden and a `setProperty` on `passInfos.N.baseTex` reads back `null` (it does not bind — and the assignment does not auto-add the define here). Enable the define first (write `passInfos.N.defines`, see above), then set `baseTex`: it binds and renders the texture normally. (Verified in LS 5.25 — the texture does render; it does not show a magenta tile.)
- **No reflection probe in Preview** → a high-`metallic` surface with nothing to reflect samples **black/flat**. Keep water/metal `metallic ~0–0.1` and get glint from low `roughness ~0.1–0.25` + a ripple normal. A cubemap on a planar `reflectionTex` (`ENABLE_SIMPLE_REFLECTION`) logs `texture has different texture type with uniform` — that slot takes a 2D texture only.

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
