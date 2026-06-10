<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Code Node Reference — VFX Additions

> **Prerequisite:** read [`../../shader-graph/reference/code-node-reference.md`](../../shader-graph/reference/code-node-reference.md) first. It covers the GLSL fundamentals that apply to all code nodes (shader and VFX): code structure, port decorators (`input_*`/`output_*`/`global_*`), texture/array sampling, the shader `system.*` API, the display-`Title` port, and a worked example.
>
> This file is purely the **VFX additions** — `system.*` functions only available inside the VFX container code-node family: `node_util_custom_container_spawn`, `node_util_custom_container_update`, `node_util_custom_container_output_pixel`, and `node_util_custom_container_output_vertex`. VFX code nodes have access to **all the shader functions** documented in the prerequisite file, plus everything below.

---

## Get particle attributes

| Function | Returns |
|---|---|
| `system.getParticlePosition()` | `vec3` |
| `system.getParticleVelocity()` | `vec3` |
| `system.getParticleAge()` | `float` |
| `system.getParticleLife()` | `float` |
| `system.getParticleForce()` | `vec3` |
| `system.getParticleDelay()` | `float` |
| `system.getParticleSeed()` | `float` |
| `system.getParticleMass()` | `float` |
| `system.getParticleColor()` | `vec4` |
| `system.getParticleSize()` | `float` |
| `system.getParticleIndex()` | `int` |
| `system.getParticleIndexRatio()` | `float` |
| `system.getParticleAgeRatio()` | `float` |
| `system.getParticleMatrix()` | `mat4` |
| `system.getParticleSpawned()` | `bool` |

## Get particle system settings

| Function | Returns |
|---|---|
| `system.getParticleCount()` | `int` |
| `system.getParticleMaxLife()` | `float` |
| `system.getParticleSpawnRate()` | `float` |
| `system.getParticleBurstRate()` | `float` |
| `system.getParticlePositionMin()` / `Max()` | `vec3` |
| `system.getParticleVelocityMin()` / `Max()` | `vec3` |
| `system.getParticleSizeMin()` / `Max()` | `float` |
| `system.getParticleColorMin()` / `Max()` | `vec4` |
| `system.getParticleMassMin()` / `Max()` | `float` |

## Particle random values

| Function | Returns |
|---|---|
| `system.getParticleRandomFloat(bool useParticleID, bool useNodeID, bool useTime, float extraSeed)` | `float` |
| `system.getParticleRandomVec2(...)` | `vec2` |
| `system.getParticleRandomVec3(...)` | `vec3` |
| `system.getParticleRandomVec4(...)` | `vec4` |

- A helper function that uses the same random number generator as `system.getRandomFloat()` and its variants, but with additional arguments to pass extra data into the seed.
- The same seed rules as `system.getRandomFloat()` apply to `extraSeed`.
- All four take the same parameters: `(bool useParticleID, bool useNodeID, bool useTime, float extraSeed)`.
- A common pattern to produce a new per-particle random number every frame is `system.getParticleRandomFloat(true, true, true, 0.0)` — all three bools ensure the result varies by particle, by node, and by frame. Add whole numbers to `extraSeed` if called multiple times in the same node, or use a variant like `system.getParticleRandomVec4(...)` to get four unique random values in the returned vector.

## Set particle attributes — Spawn/Update stage only

| Function | Parameter |
|---|---|
| `system.killParticle()` | -- |
| `system.setParticlePosition(vec3)` | position |
| `system.setParticleVelocity(vec3)` | velocity |
| `system.setParticleLife(float)` | lifetime |
| `system.setParticleForce(vec3)` | force |
| `system.setParticleMass(float)` | mass |
| `system.setParticleColor(vec4)` | RGBA color |
| `system.setParticleSize(float)` | size |
| `system.setParticleMatrix(mat3)` | rotation |

## Set vertex attributes — Output stage, vertex shader only

| Function | Parameter |
|---|---|
| `system.setVertexPosition(vec3)` | position |
| `system.setVertexNormal(vec3)` | normal |
| `system.setVertexTangent(vec3)` | tangent |

## Set pixel attributes — Output stage, pixel shader only

| Function | Parameter |
|---|---|
| `system.setPixelColor0(vec4)` through `setPixelColor3(vec4)` | render target color |
| `system.setPixelDepth(float)` | depth |
