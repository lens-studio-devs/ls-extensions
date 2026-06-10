---
name: vfx-graph
description: Create or edit custom VFX and particle graphs — `.graphVfx` YAML, the Emit/Spawn/Update/Output pipeline, container subgraphs, particle attributes, and helper templates.
user-invocable: true
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# VFX Graph

> **Required reading: [`shader-graph`](../shader-graph/SKILL.md) first.** VFX shares its YAML schema and custom-code-node base with shader graphs; this skill covers the VFX-specific additions — the four-container pipeline, particle attributes, container subgraphs, and the helper-template catalog.

## When to use this skill (vs. shader-graph / materials)

This skill is for **creating or editing custom particle effects** — `.graphVfx` files, particle pipeline configuration, custom GLSL inside the `node_util_custom_container_*` family (`_spawn`, `_update`, `_output_pixel`, `_output_vertex`).

**Don't use this skill** when:
- The task is a shader graph (`.graphShader`) → [`shader-graph`](../shader-graph/SKILL.md)
- The task is "set a material color / PBR property / texture / exposed parameter on an existing material or VFX asset" → [`materials`](../materials/SKILL.md)
    - GraphQL property-setting works the same way for VFX assets as for materials. Only edit the `.graphVfx` itself when the parameter doesn't exist yet or the underlying simulation needs to change.

## Placing a VFX in the scene

VFX Graph (`.graphVfx` → `VFXAsset` → `VFXComponent`) is **not** the legacy GPU Particles system (`GPUParticles*Preset` → `RenderMeshVisual` + `GPU Particles.mat`). Picking a `GPUParticles*Preset` gives you the legacy system and your `.graphVfx` won't render.

**There is no preset for VFX Graph today** — don't search `presets(type: SceneObject)` / `presets(type: Component)` for one. And don't try to wire one after the fact via `setProperty(..., "VFXAsset" | "vfxAsset" | "asset", ...)` or `VirtualScene apply.modify` — those fail because `VFXComponent` has no editor-side JS-bound properties beyond the base Component fields.

**Use `AssetManager.instantiate()` from `ExecuteEditorCode`** — the native path that drag-and-drop uses. One call creates a SceneObject + VFXComponent wired to the asset:

```ts
const model = pluginSystem.findInterface(Editor.Model.IModel);
const am = model.project.assetManager;
const VFX_ASSET_UUID = "<vfx-asset-uuid>";
const vfxAsset = am.assets.find(a => a.id.toString() === VFX_ASSET_UUID);
if (!vfxAsset) return { error: `VFX asset ${VFX_ASSET_UUID} not found` };
const [obj] = await am.instantiate([vfxAsset]);
return { sceneObjectId: obj.id.toString() };
```

Rename, reparent, and transform via `scene-graphql` afterward — base SceneObject properties ARE bound. Exposed VFX parameters on the output Material (`passInfos.0.baseTex`, `passInfos.0.Port_*`) use `asset-graphql: setProperty` against the Material asset — those paths work normally.

## Reference files

- **VFX graph examples** — bundled `.graphVfx` presets at `<LS_INSTALL>/Contents/Plugins/Es_VFXGraph_Presets.bundle/Assets/`. **Canonical starting point: `Simple Emitter Code Node.graphVfx`** — prefer it above all others. It uses custom code nodes for Spawn/Update/Output logic, which is easier to reason about and therefore optimize. The other presets — `Simple Emitter.graphVfx` and `Custom Mesh Emitter.graphVfx` — have more template nodes wired up and are useful as a reference for how specific helper templates (parameter nodes, math nodes, attribute setters) are wired in YAML, but don't start from them. `Empty.graphVfx` is also a good starting point and reference for the most basic VFX that only contains high level container nodes. Resolve `<LS_INSTALL>` via [`shader-graph` → "Resolving `<LS_INSTALL>`"](../shader-graph/SKILL.md).
- **VFX manifest** — `<LS_INSTALL>/Contents/Plugins/Es_VFXGraph.bundle/GraphResources/documentation/nodes.json`. Authoritative port spec for every VFX template, including the `node_util_custom_container_output_pixel`/`_output_vertex` code-node variants not present in any bundled preset. See [`shader-graph/reference/manifest.md`](../shader-graph/reference/manifest.md) for the jq lookup recipe.
- **Custom-code GLSL — base** — [`../shader-graph/reference/code-node-reference.md`](../shader-graph/reference/code-node-reference.md). Code structure, port decorators (`input_*`/`output_*`/`global_*`), texture/array sampling, the shader `system.*` API, and the `Title` port. Everything in it applies to VFX code nodes too.
- **Custom-code GLSL — VFX additions** — [`reference/vfx-code-node-reference.md`](reference/vfx-code-node-reference.md). VFX-only `system.*` functions: particle attribute getters/setters, particle random, vertex/pixel attribute writers.

---

## 1. The container pipeline

Every VFX graph has **exactly four containers**, in this fixed order: **Emit → Spawn → Update → Output**. Each container is a `Begin`/`End` pair; helper nodes and container subgraphs sit between them. Containers chain via `LINK`/`PARTICLE` ports.

When the user says "the spawn container" or "the output container", they mean one of these four — not a subgraph or helper cluster.

```
Emit Begin   →  [Spawn Continuous / Spawn Burst]                     →  Emit End
                                                                          ↓
Spawn Begin  →  [Set Position, Set Size, Set Color, ...]              →  Spawn End
                                                                          ↓
Update Begin →  [Set Alpha (Fade), Add Force, ...]                    →  Update End
                                                                          ↓
Output Begin →  [Align to Camera, Set Fragment Color, texture sample] →  Output End
```

### Stage TemplateIDs

| Stage (code/template) | UI label | Begin | End |
|---|---|---|---|
| **Emit** (count + spawn rate) | Emit | `nodes_particle_emit_begin` | `nodes_particle_emit_end` |
| **Spawn** (initial particle attributes) | Initialize Particle | `nodes_particle_spawn_begin` | `nodes_particle_spawn_end` |
| **Update** (per-frame simulation) | Update Particle | `nodes_particle_update_begin` | `nodes_particle_update_end` |
| **Output** (rendering) | Output | `nodes_particle_output_begin` | `nodes_particle_output_end` |

### Emission control

Add a `node_main_particle_spawn_continuous` or `node_main_particle_spawn_burst` between `nodes_particle_emit_begin` and `nodes_particle_emit_end`. There is no code-node variant for emission control.

### Default rendering when Output is empty

When **no nodes** are placed in the Output container (between `output_begin` and `output_end`), default rendering is applied automatically:
- **Vertex:** particle attributes are composited into quad/mesh vertex positions; world-to-NDC handled by the backend.
- **Fragment:** interpolated vertex color is used directly as pixel color.

A minimal VFX graph can produce visible particles with no Output-stage code.

### Common Output pattern

For most VFX, prefer this pattern over writing custom vertex code:
1. Add `node_main_particle_orient` to control how particles face the camera or align to a direction — see §2 for presets and options. The `Title2` field mirrors the active preset (e.g. `Title2: Billboard ( Camera Up )`).
2. For velocity-stretched effects (rain, sparks, streaks), add `node_main_particle_size_multiplier` after orient — still in the Output container, before the fragment color step — see §2 for the velocity-stretch fields.
3. For pixel color, either:
   - Use `node_main_particle_set_fragment_color` (a helper template) with upstream nodes computing the `Color` input, OR
   - Use a `node_util_custom_container_output_pixel` code node that calls `system.setPixelColor0(vec4)` directly. This is the right choice when the color logic involves more than two or three nodes (texture sample + particle color + math), since one code node replaces all the helpers and lives inline in the Output container chain.

Only write custom vertex code (`node_util_custom_container_output_vertex`) when the effect requires actual vertex deformation beyond what `node_main_particle_orient` produces.

### Container contents need `CheckEnabled` + `CheckExists` siblings

Every node placed **inside** one of the four containers — between that stage's `Begin` and `End` — needs both `Node{N}CheckEnabled: true` and `Node{N}CheckExists: true` as sibling keys (outside the node block; see [`shader-graph` §1](../shader-graph/SKILL.md) for the sibling-key layout). Without these the engine treats the node as disabled and the YAML loads but the behavior is silently missing. Applies to:

- Helper templates (`node_main_particle_spawn_continuous`, `_orient`, `_set_fragment_color`, `_force`, `_set_force`, etc.)
- Custom code nodes (`node_util_custom_container_spawn`, `_update`, `_output_pixel`, `_output_vertex`)
- Container subgraphs (`nodes_main_container_subgraph`)

The `Begin`/`End` nodes themselves do **not** need these — they default to enabled. The rule is "every container *content* node, opt-in via siblings."

---

## 2. Helper template catalog

| Template ID | Purpose |
|---|---|
| `node_main_particle_spawn_continuous` | Continuous emission rate (particles/sec or particles/frame) |
| `node_main_particle_spawn_burst` | Burst emission |
| `node_main_particle_orient` | Output-stage particle orientation. `Presets` COMBO: `Billboard ( Camera Up )` / `Billboard ( World Up )` / `Look at ( Position Forward )` / `Velocity`. Plus `QuadOrientation`, `UpAxis`, `Advanced` mode with `CustomForward`/`CustomUpAxis`, and `RotationAngle`. **Replaces the removed `node_main_particle_align_to_camera`.** |
| `node_main_particle_set_fragment_color` | Output-stage per-pixel color |
| `node_main_particle_size_multiplier` | Output-stage size adjustment. Toggle `Velocity Stretch: true` + set `VelocityStretchAmount` (e.g. `0.03`) to stretch particles along their velocity for streaks/trails (rain, sparks). Also has `EnableScale`/`ScaleQuad`/`ScaleMesh` for plain scaling and `EnableCustomVelocity`/`CustomVelocity` to override the stretch direction. |
| `node_main_particle_force` | Read a particle attribute (Color, Position, Velocity, Mass, Matrix, ...) |
| `node_main_particle_set_force` | Write a particle attribute (Spawn or Update stage) |
| `node_main_particle_random` | Particle-aware random number generator |
| `node_util_custom_container_spawn` | Custom code node scoped to the Spawn stage |
| `node_util_custom_container_update` | Custom code node scoped to the Update stage |
| `node_util_custom_container_output_pixel` | Custom code node scoped to the Output stage, pixel shader. In-pipeline (has `ParticleIn`/`ParticleOut`). Call `system.setPixelColor0(vec4)` to write the fragment color — can replace `node_main_particle_set_fragment_color` entirely. |
| `node_util_custom_container_output_vertex` | Custom code node scoped to the Output stage, vertex shader. In-pipeline. Call `system.setVertexPosition` / `setVertexNormal` / `setVertexTangent`. |

`node_main_particle_force` and `node_main_particle_set_force` carry both a `Value` (FLOAT, scalar or vector) port and a `ValueMatrix` (MATRIX, 16-element flow array) port — only one is meaningful per attribute, but both are written.

### Code-node `Title` must be alphanumeric + spaces only

The `Title` port on every `node_util_custom_container_*` node becomes part of a GLSL function name in the generated simulate/render shader (`Node{LevelID}_{Title with spaces → underscores}`). **Keep `Title` alphanumeric and spaces only.** Punctuation like `+` lands verbatim in the identifier, fails the GLSL compile, and cascades into a Metal/Vulkan pipeline failure that can crash the renderer. Use `Buoyancy and Drag`, not `Buoyancy + Drag`. Spaces are safe (they convert to `_`); other punctuation is not worth testing case-by-case.

---

## 3. Container subgraphs (`nodes_main_container_subgraph`)

VFX uses a distinct subgraph template (`nodes_main_container_subgraph`) for behavior subgraphs that live **inside** a stage container. The key difference from shader subgraphs (`nodes_main_subgraph`) is the **TemplateID** itself — `nodes_main_container_subgraph` (VFX) vs `nodes_main_subgraph` (shader). Container subgraphs follow the same CheckEnabled/CheckExists convention as other container content nodes — see §1.

The internal structure (`nodes_import_*`, `nodes_export_*`, `SubGraphUniqueID{N}` ports) follows the same conventions as shader subgraphs — see the embedding procedure in [`shader-graph` §4](../shader-graph/SKILL.md).

---

## 4. Particle attributes

Set in the **Spawn** stage (initial values), modified in the **Update** stage (per-frame). Read anywhere.

Two equivalent ways to set/get: the `node_main_particle_force` / `_set_force` templates (see §2), or `system.getParticle*` / `system.setParticle*` calls from inside any `node_util_custom_container_*` body (see [`reference/vfx-code-node-reference.md`](reference/vfx-code-node-reference.md)).

---

## 5. Positioning rules specific to VFX

- Container chain (`Begin`/`End` pairs) aligned vertically at a consistent X coordinate, top-to-bottom in pipeline order.
- Helper nodes (parameters, math, samplers) sit to the **left** of the container they feed into. Containers are wide — keep helpers ≥300 px to the left of the container's X position to avoid overlap.
- Container subgraphs stack vertically inside their containing stage; no manual positioning required.
- Parameter nodes (`nodes_inputs_parameters_*`) MUST live at the root level of the graph — not inside any container or subgraph. (See [`shader-graph` §5](../shader-graph/SKILL.md).)

---

## 6. Strategic guidance

### Start from `Simple Emitter Code Node.graphVfx` by default

For non-trivial VFX requests ("make a rain VFX", "fire particles"), copy `Simple Emitter Code Node.graphVfx` (see "Reference files" above) and edit its code nodes — **do not** assemble many template nodes from scratch, and don't start from the other bundled presets. The code-node version is both faster at runtime (fewer template nodes to evaluate) and faster to author programmatically (one GLSL body per stage instead of dozens of wired template nodes). See §2 for which code nodes handle each stage. Only depart from this default when:

- The user specifically asks for a node-based approach.
- The task requires one of the always-template exceptions below.

Always-template exceptions (no code-node equivalent exists):
- **Emission rate** — see §1 Emission control.
- **Parameter nodes** — `nodes_inputs_parameters_*` (always template-based).
- **Interpolate nodes** — vertex→fragment varyings. Code nodes cannot create interpolants.

---

## 7. Performance optimization

**Always use the lowest particle count that still sells the effect.**

For particle count/emission-rate sizing and overdraw diagnosis, see [reference/perf-tuning.md](reference/perf-tuning.md).

---

## 8. Debugging

If a VFX looks wrong or is not rendering anything at all, **disable content nodes in chunks to isolate where the issue is introduced.** Toggle a node off by setting its `Node{N}CheckEnabled: false` sibling (Begin/End nodes stay in the chain and never need toggling). When a container has no enabled content, the engine falls back to that container's defaults — and those defaults double as a known-good baseline you can bisect against.

**Empty-VFX baseline.** A graph with only the four container Begin/End pairs (no content nodes between them at all) renders a **grid of white billboard quads that progressively emit over ~16 seconds.** That's the engine's all-defaults fallback. If a stripped-down graph doesn't look like this, the problem is **outside** the graph — asset import, `VFXComponent` disabled, SceneObject layer mismatch with the rendering camera, or camera framing — not in the YAML.

Typical bisection move: disable the Output container's content first (`Node{N}CheckEnabled: false` on `node_main_particle_orient`, any `_size_multiplier`, and the `node_util_custom_container_output_pixel`/`_vertex` code nodes). If particles re-appear as white quads, the issue is in the output stage — re-enable nodes one at a time until the failure returns; that node owns the bug. Apply the same disable-and-restore pattern to the Update and Spawn containers when the issue is upstream of rendering.
