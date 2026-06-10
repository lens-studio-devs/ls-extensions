<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Code Node Reference

> Code nodes are standard **GLSL ES 3.00**. This file covers only the extensions:
> port decorators (`input_*`, `output_*`, `global_*`), texture/array sampling, and the `system.*` API.
> For GLSL itself, refer to the [OpenGL ES Shading Language 3.00 Specification](https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf).
>
> **YAML host structure:** see [`SKILL.md` §1](../SKILL.md) for the magic values a custom code node must carry (`TemplateVersionMinor: 2`, `ngs_Version`, `ngs_Height`, `LastChached3`, `LastCodeFormatted3`, etc.) and the `node_util_custom*` template variants. The bundled `codeNode.graphShader` referenced in SKILL.md is the canonical schema example.

---

## 1. Code Structure

- `main()` is required — code will not compile without it.
- Extra functions can be defined outside `main()`.
- Input variables are **implicitly available** in all functions — no need to pass them as arguments.
- Call `.evaluate()` on an input variable to inject upstream graph logic into the code (used with Code Global nodes).
- Apply changes: **Cmd+Enter** (macOS) / **Ctrl+Enter** (Windows), or deselect the node.

---

## 2. Port Decorators

Decorators are written as top-level statements outside `main()`. They create ports on the code node.

### Input ports — `input_[type] Name;`

| Decorator | GLSL type | Notes |
|---|---|---|
| `input_int` | `int` | |
| `input_bool` | `bool` | |
| `input_float` | `float` | |
| `input_vec2` | `vec2` | |
| `input_vec3` | `vec3` | |
| `input_vec4` | `vec4` | |
| `input_color3` | `vec3` | Creates a color picker port in the editor |
| `input_color4` | `vec4` | Creates a color picker port with alpha |
| `input_mat2` | `mat2` | |
| `input_mat3` | `mat3` | |
| `input_mat4` | `mat4` | |
| `input_texture_2d` | sampler | Has `.sample()` methods (see section 3) |
| `input_texture_2d_array` | sampler | |
| `input_texture_cube` | sampler | |
| `input_texture_3d` | sampler | |
| `input_float_array` | -- | Has `.sample(int index)` (see section 3) |
| `input_curve` | -- | Curve object input |
| `input_voxel_data` | -- | Voxel data object input |
| `input_group` | -- | UI-only: groups following ports visually |
| `input_droplist` | `const int` | Returns selected option index (0-based) |
| `input_checkbox` | `const bool` | |

### Output ports — `output_[type] Name;`

| Decorator | GLSL type |
|---|---|
| `output_float` | `float` |
| `output_vec2` | `vec2` |
| `output_vec3` | `vec3` |
| `output_vec4` | `vec4` |
| `output_mat2` | `mat2` |
| `output_mat3` | `mat3` |
| `output_mat4` | `mat4` |

VFX container code nodes cannot create output ports — see [`SKILL.md` §1](../SKILL.md) ("Custom code node conventions").

### Global variables — `global_[type] Name;`

Same types as outputs (`global_float` through `global_mat4`). Globals are declared in a code node, then referenced elsewhere in the graph via a **Code Global** node.

---

## 3. Special Input Syntax

### Droplist and group

```glsl
input_droplist Mode("Option A : Option B : Option C");   // returns `const int` (0-indexed selection)
input_group Group("My Settings");                        // UI-only label; groups subsequent inputs
input_checkbox UseNormals;                               // returns `const bool`
```

### Texture and array sampling

Connect a Texture 2D Object Parameter node (or similar) to a texture input, then call methods on it:

| Method | Available on | Returns |
|---|---|---|
| `.sample(vec2 uv)` | `texture_2d` | `vec4` |
| `.sample(vec3 uvw)` | `texture_cube`, `texture_3d` | `vec4` |
| `.sampleLod(vec2 uv, float lod)` | `texture_2d` | `vec4` |
| `.sampleLod(vec3 uvw, float lod)` | `texture_cube`, `texture_3d` | `vec4` |
| `.textureSize()` | `texture_2d`, `texture_cube` | `vec2` |
| `.textureSize()` | `texture_3d` | `vec3` |
| `.pixelSize()` | `texture_2d`, `texture_cube` | `vec2` |
| `.pixelSize()` | `texture_3d` | `vec3` |
| `.sample(int index)` | `float_array` | `float` |
| `.arraySize()` | `texture_2d_array` | `int` |

---

## 4. System API — Shader Graph

All functions are called on the `system` struct (e.g., `system.getSurfacePosition()`).

### Surface position

| Function | Returns |
|---|---|
| `system.getSurfacePosition()` | `vec3` |
| `system.getSurfacePositionObjectSpace()` | `vec3` |
| `system.getSurfacePositionWorldSpace()` | `vec3` |
| `system.getSurfacePositionCameraSpace()` | `vec3` |
| `system.getSurfacePositionScreenSpace()` | `vec4` |

### Surface normal

| Function | Returns |
|---|---|
| `system.getSurfaceNormal()` | `vec3` |
| `system.getSurfaceNormalFaceted()` | `vec3` |
| `system.getSurfaceNormalObjectSpace()` | `vec3` |
| `system.getSurfaceNormalWorldSpace()` | `vec3` |
| `system.getSurfaceNormalCameraSpace()` | `vec3` |

### Surface tangent and bitangent

| Function | Returns |
|---|---|
| `system.getSurfaceTangent()` | `vec3` |
| `system.getSurfaceTangentObjectSpace()` | `vec3` |
| `system.getSurfaceTangentWorldSpace()` | `vec3` |
| `system.getSurfaceTangentCameraSpace()` | `vec3` |
| `system.getSurfaceBitangent()` | `vec3` |
| `system.getSurfaceBitangentObjectSpace()` | `vec3` |
| `system.getSurfaceBitangentWorldSpace()` | `vec3` |
| `system.getSurfaceBitangentCameraSpace()` | `vec3` |

### UV and color

| Function | Returns |
|---|---|
| `system.getSurfaceUVCoord0()` | `vec2` |
| `system.getSurfaceUVCoord1()` | `vec2` |
| `system.getSurfaceColor()` | `vec4` |

### Time

| Function | Returns |
|---|---|
| `system.getTimeElapsed()` | `float` |
| `system.getTimeDelta()` | `float` |

### Screen

| Function | Returns |
|---|---|
| `system.getScreenUVCoord()` | `vec2` |

### Matrices

| Function | Returns |
|---|---|
| `system.getMatrixProjectionViewWorldInverse()` | `mat4` |
| `system.getMatrixProjectionViewWorld()` | `mat4` |
| `system.getMatrixProjectionViewInverse()` | `mat4` |
| `system.getMatrixProjectionView()` | `mat4` |
| `system.getMatrixViewWorldInverse()` | `mat4` |
| `system.getMatrixViewWorld()` | `mat4` |
| `system.getMatrixWorldInverse()` | `mat4` |
| `system.getMatrixWorld()` | `mat4` |
| `system.getMatrixViewInverse()` | `mat4` |
| `system.getMatrixView()` | `mat4` |
| `system.getMatrixProjectionInverse()` | `mat4` |
| `system.getMatrixProjection()` | `mat4` |
| `system.getMatrixCamera()` | `mat4` |
| `system.getMatrixCameraInverse()` | `mat4` |

### Lighting

| Function | Returns | Notes |
|---|---|---|
| `system.getDirectionalLightCount()` | `int` | |
| `system.getDirectionalLightDirection(int index)` | `vec3` | |
| `system.getDirectionalLightColor(int index)` | `vec3` | |
| `system.getDirectionalLightIntensity(int index)` | `float` | |
| `system.getPointLightCount()` | `int` | |
| `system.getPointLightPosition(int index)` | `vec3` | |
| `system.getPointLightColor(int index)` | `vec3` | |
| `system.getPointLightIntensity(int index)` | `float` | |
| `system.getAmbientLightCount()` | `int` | |
| `system.getAmbientLightColor(int index)` | `vec3` | |
| `system.getAmbientLightIntensity(int index)` | `float` | |

### Camera

| Function | Returns |
|---|---|
| `system.getCameraPosition()` | `vec3` |
| `system.getCameraForward()` | `vec3` |
| `system.getCameraRight()` | `vec3` |
| `system.getCameraUp()` | `vec3` |
| `system.getCameraAspect()` | `float` |
| `system.getCameraFOV()` | `float` |
| `system.getCameraNear()` | `float` |
| `system.getCameraFar()` | `float` |

### Bounding box and instances

| Function | Returns |
|---|---|
| `system.getAABBMinLocal()` | `vec3` |
| `system.getAABBMaxLocal()` | `vec3` |
| `system.getAABBMinWorld()` | `vec3` |
| `system.getAABBMaxWorld()` | `vec3` |
| `system.getInstanceCount()` | `int` |
| `system.getInstanceID()` | `int` |
| `system.getInstanceRatio()` | `float` |
| `system.getNodeID()` | `int` |
| `system.getHairStrandID()` | `float` |
| `system.getHairDebugColor()` | `vec4` |

### Utility

| Function | Returns | Notes |
|---|---|---|
| `system.remap(T value, T oldMin, T oldMax, T newMin, T newMax)` | `T` | Overloaded: `float`, `vec2`, `vec3`, `vec4` |
| `system.pack16Bit(float value, float min, float max)` | `vec2` | |
| `system.pack24Bit(float value, float min, float max)` | `vec3` | |
| `system.pack32Bit(float value, float min, float max)` | `vec4` | |
| `system.unpack16Bit(vec2 value, float min, float max)` | `float` | |
| `system.unpack24Bit(vec3 value, float min, float max)` | `float` | |
| `system.unpack32Bit(vec4 value, float min, float max)` | `float` | |

### Environment and color space

| Function | Returns | Notes |
|---|---|---|
| `system.sampleEnvironmentSpecular(vec3 direction, float lod)` | `vec3` | |
| `system.sampleEnvironmentDiffuse(vec3 direction)` | `vec3` | |
| `system.linearToneMapping(vec3 color)` | `vec3` | |
| `system.linearToSRGB(vec3 color)` | `vec3` | |
| `system.SRGBToLinear(vec3 color)` | `vec3` | |
| `system.setPreviewColor(vec4 color)` | `void` | Pixel shader only |

### Random

These functions are hash-based: the same seed always produces the same output. The seed can be any type (`float`, `vec2`, `vec3`, `vec4`).

- **Spatial noise:** Pass scaled UV coordinates as the seed to get a grid of random values across the surface. For example, `system.getRandomFloat(system.getSurfaceUVCoord0() * 10.0)` produces a 10x10 grid of random values.
- **Unique results:** If you call `getRandom*` multiple times in the same node, use a different seed for each call — identical seeds produce identical output.
- **Seed magnitude:** Seeds should be large enough to spread the hash. Raw UVs (0.0–1.0) will produce only a single random value — multiply them up (e.g. `uv * 100.0`) for finer variation.
- **Prefer over manual hashes:** Always use `system.getRandom*` instead of hand-rolled `fract(sin(dot(...)))` patterns common in GLSL. The built-in functions are more optimized for this platform.

| Function | Returns | Seed types |
|---|---|---|
| `system.getRandomFloat(seed)` | `float` | `float`, `vec2`, `vec3`, `vec4` |
| `system.getRandomVec2(seed)` | `vec2` | same |
| `system.getRandomVec3(seed)` | `vec3` | same |
| `system.getRandomVec4(seed)` | `vec4` | same |

> **VFX-only `system.*` additions** (particle attribute getters/setters, particle random, vertex/pixel attribute writers) live in [`../../vfx-graph/reference/vfx-code-node-reference.md`](../../vfx-graph/reference/vfx-code-node-reference.md) — read that file too if you're authoring a VFX code node.

---

## 5. Display Title

Set the `Title` port (ClassType1: `STRING`) to give the code node a descriptive name in the graph editor. This replaces the default "Custom Code" label and makes it easier to identify nodes at a glance.

```yaml
Title:
  ClassType1: STRING
  String: Scrolling Noise
```

The `Title` value also appears in `Title1` on the node (e.g. `Title1: Scrolling Noise`). Both should match — `Title1` is the node-level display name, `Title` is the port that controls it.

---

## 6. Example

A code node that samples a texture with UV distortion:

```glsl
input_texture_2d BaseTexture;
input_float DistortStrength;
output_vec4 Result;

void main()
{
    vec2 uv = system.getSurfaceUVCoord0();
    float time = system.getTimeElapsed();

    // Simple sine-based UV distortion
    uv.x += sin(uv.y * 10.0 + time) * DistortStrength;

    Result = BaseTexture.sample(uv);
}
```
