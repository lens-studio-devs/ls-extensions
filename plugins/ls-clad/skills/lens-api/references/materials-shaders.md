<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

> **Lens Runtime API** — All code here targets the Lens scripting runtime (StudioLib). Do not use these patterns in Editor API code.



# Lens Studio Materials & Shaders — Reference Guide

Lens Studio uses a **graph-based Material Editor** to create shaders, combined with a runtime TypeScript API for modifying material properties. Most visual customization flows through `RenderMeshVisual.mainMaterial`.


## The Golden Rule: Clone Before Modify

Materials in Lens Studio are **shared assets** — multiple scene objects can use the same material. Modifying it directly changes every object using it. Always clone first:

```typescript
const meshVisual = this.sceneObject.getComponent('Component.RenderMeshVisual')

// BAD: modifies the shared asset, affecting all objects
meshVisual.mainMaterial.mainPass.baseColor = new vec4(1, 0, 0, 1)

// GOOD: clone creates a per-instance copy
const mat = meshVisual.mainMaterial.clone()
meshVisual.clearMaterials()
meshVisual.addMaterial(mat)
mat.mainPass.baseColor = new vec4(1, 0, 0, 1)
```

Clone once in `OnStartEvent`, then modify the cached clone freely each frame.


## Common `mainPass` Properties

### Typed properties on `Pass` (always available)

These properties are declared on the `Pass` class and exist on every material:

```typescript
mat.mainPass.blendMode   // BlendMode enum — how the material composites
mat.mainPass.depthTest   // boolean — depth test on/off
mat.mainPass.depthWrite  // boolean — write to depth buffer
mat.mainPass.twoSided    // boolean — render both sides
mat.mainPass.cullMode    // CullMode enum — face culling mode
```

### Shader graph dynamic properties

> **Dynamic properties** (`baseColor`, `baseTex`, `opacity`, `emissiveColor`, `metallic`, `roughness`, etc.) are shader-defined — they only exist if the material graph exposes them. The `Pass` class uses `[index: string]: any` for dynamic access. The names below are conventions used by Lens Studio's built-in materials but are **not** guaranteed to exist on every material.

```typescript
const mat = meshVisual.mainMaterial.clone()
meshVisual.clearMaterials()
meshVisual.addMaterial(mat)

// Solid color (RGBA, each component 0–1) — if the shader exposes 'baseColor'
mat.mainPass.baseColor = new vec4(0.2, 0.8, 0.4, 1.0)

// Transparency (0 = fully transparent, 1 = fully opaque) — if the shader exposes 'opacity'
mat.mainPass.opacity = 0.5

// Texture assignment — if the shader exposes 'baseTex'
mat.mainPass.baseTex = myTexture

// Emissive / glow — if the shader exposes 'emissiveColor'
mat.mainPass.emissiveColor = new vec4(1.0, 0.5, 0.0, 1.0)

// PBR metallic/roughness — if the shader exposes these inputs (exact name depends on the graph)
mat.mainPass.metallic = 0.0
mat.mainPass.roughness = 0.8
```


## Blend Modes

Set `blendMode` on the `mainPass` to control how the material composites over what's behind it:

```typescript
mat.mainPass.blendMode = BlendMode.Normal      // standard alpha blend (default)
mat.mainPass.blendMode = BlendMode.Add         // adds colour — fire, glow, neon
mat.mainPass.blendMode = BlendMode.Screen      // lightens only — soft glow
mat.mainPass.blendMode = BlendMode.Multiply    // darkens — shadow, colour grading
mat.mainPass.blendMode = BlendMode.AlphaToCoverage  // MSAA-friendly transparency
```

> Use `BlendMode.Add` for particles and VFX that should glow over the scene. Use `BlendMode.Normal` with `opacity` for standard transparent surfaces.


## Depth & Cull Settings

```typescript
// Depth test: should this surface check if something is in front of it?
mat.mainPass.depthTest  = true   // default; disable for UI-always-on-top
mat.mainPass.depthWrite = true   // writes this surface to the depth buffer; disable for transparent surfaces

// Show both sides of the mesh (no back-face culling)
mat.mainPass.twoSided = true

// Manual cull mode
mat.mainPass.cullMode = CullMode.Back         // default (cull back-faces)
mat.mainPass.cullMode = CullMode.Front        // cull front-faces (inverted normals)
mat.mainPass.cullMode = CullMode.FrontAndBack // cull all faces (nothing rendered)
```


## Render Order

Objects render in ascending `renderOrder`. Lower numbers render first (farther back):

```typescript
meshVisual.renderOrder = 0   // renders before renderOrder = 1
meshVisual.renderOrder = 100 // renders in front of most objects

// For UI / always-on-top objects:
meshVisual.renderOrder = 9999
mat.mainPass.depthTest = false
```


## Texture Assignment at Runtime

```typescript
// Assign a texture loaded from a RemoteMediaModule call
remoteMediaModule.loadResourceAsImageTexture(resource, (texture: Texture) => {
  mat.mainPass.baseTex = texture
}, print)

// Use a render target texture as a material input (render pipeline chaining)
// The render target IS a Texture — assign it directly
mat.mainPass.baseTex = myRenderTarget

// Clear / reset to default texture
mat.mainPass.baseTex = null
```


## Render Targets

A `RenderTarget` lets you render one camera's view into a texture, which another material can then use. This is the basis for post-processing, mirrors, and portals.

### Setup in Lens Studio
1. Create a **Render Target** asset (Asset Browser → + → Render Target).
2. Assign it to a **Camera** component's *Render Target* field.
3. The camera renders into this texture each frame.
4. Assign the texture to another material's `baseTex`.

### Scripting
```typescript
@input renderTarget: Texture
@input displayMesh: RenderMeshVisual

onAwake(): void {
  this.createEvent('OnStartEvent').bind(() => {
    const mat = this.displayMesh.mainMaterial.clone()
    this.displayMesh.clearMaterials()
    this.displayMesh.addMaterial(mat)
    // Use the render target texture on a display surface
    mat.mainPass.baseTex = this.renderTarget
  })
}
```

### Render target formats
| Format | Use |
|---|---|
| `TextureFormat.RGBA8Unorm` | Standard colour + alpha (default) |
| `TextureFormat.RGBA8Srgb` | Standard colour + alpha with gamma encoding |
| `TextureFormat.RG11B10Float` | HDR without alpha — VFX, bloom |
| `DepthStencilRenderTargetProvider` | Depth-only targets — shadow maps, depth effects (use a separate depth render target, not a colour format) |


## Material Variants

The graph-based material editor lets you create **variants** — instances of a graph with different parameter values, without code. In script you select between them by switching which material is assigned to the mesh visual:

```typescript
@input materialA: Material  // variant 1
@input materialB: Material  // variant 2

function switchToVariant(variant: 'a' | 'b'): void {
  const mat = (variant === 'a' ? this.materialA : this.materialB).clone()
  meshVisual.clearMaterials()
  meshVisual.addMaterial(mat)
}
```


## Graph-Based Material Editor

Lens Studio's material editor uses a **node graph** (similar to Blender's shader nodes or Unreal's Material Editor):

- **Inputs** (leftmost): Vertex attributes (position, normal, UV, color), time, textures
- **Math nodes**: Add, Multiply, Lerp, Remap, Noise, Abs …
- **Texture nodes**: Sample Texture 2D, Gradient, Render Target
- **Output** (rightmost): connects to `baseColor`, `emissive`, `opacity`, `normal`, `metallic`, `roughness`

### Exposing a graph parameter to script

1. Right-click a value node in the graph → **Create Input Property**
2. Give it a name (e.g., `"tintColor"`)
3. In script, access it via `mat.mainPass.<propertyName>`:

```typescript
// If you exposed 'tintColor' as a vec4 input:
mat.mainPass.tintColor = new vec4(1, 0.2, 0.2, 1)

// If you exposed 'scroll' as a float:
mat.mainPass.scroll = getTime() * 0.5  // animate scroll UV in every frame
```


## Colour Lerp / Animated Materials

```typescript
// Animate material color between two values using time
const updateEvent = this.createEvent('UpdateEvent')
updateEvent.bind(() => {
  const t = (Math.sin(getTime() * 2) + 1) * 0.5  // oscillates 0→1
  const colA = new vec4(1, 0.2, 0, 1)
  const colB = new vec4(0, 0.5, 1, 1)
  // Manual lerp: a + (b - a) * t
  mat.mainPass.baseColor = new vec4(
    colA.r + (colB.r - colA.r) * t,
    colA.g + (colB.g - colA.g) * t,
    colA.b + (colB.b - colA.b) * t,
    1.0
  )
})
```


## Screen-Space / Post-Processing Pattern

To apply a full-screen effect:
1. Render the world camera into **Render Target A**.
2. Apply Render Target A as a texture to a full-screen quad.
3. That quad uses a custom shader graph for the effect (color grade, distort, blur, etc.).

```
World Camera → RenderTarget A
                ↓
 Full-Screen Quad (Post FX Shader) → Output Camera
```


## Common Gotchas

- **Always clone before modifying** — forgetting this is the #1 material bug, since all objects using the same asset change together.
- **`blendMode` must match opacity usage** — if `blendMode` is `Normal` but `opacity` is 0.5, the surface may not sort correctly. For transparent surfaces, also set `depthWrite = false`.
- **Graph parameter names are case-sensitive** — `mat.mainPass.TintColor` and `mat.mainPass.tintColor` are different.
- **Render target format** must match what the sampling shader expects — use `TextureFormat.RGBA8Unorm` for general textures, `TextureFormat.RG11B10Float` for HDR pipelines.
- **Render order and transparency**: transparent materials (alpha blend) must have higher `renderOrder` than opaque objects behind them, otherwise sorting artifacts occur.
- **`twoSided` vs `cullMode`** — `twoSided = true` renders both sides of polygons. There is no equivalent `CullMode` value — use `twoSided` directly. (`CullMode.FrontAndBack` culls everything, which is the opposite of what you want.)
