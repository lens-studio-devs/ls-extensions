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

VFX Graph (`.graphVfx` → `VFXAsset` → `VFXComponent`) is a **different system** from GPU Particles (`GPUParticles*Preset` → `RenderMeshVisual` + `GPU Particles.mat`). Picking a `GPUParticles*Preset` gives you the GPU Particles system and your `.graphVfx` won't render. If you deliberately want GPU Particles (a quick preset, no graph authoring), see [§9 GPU Particles](#9-gpu-particles-a-preset-based-system-separate-from-vfx-graph).

**There is no preset for VFX Graph today** — don't search `presets(type: SceneObject)` / `presets(type: Component)` for one. And don't try to wire one after the fact via `setProperty(..., "VFXAsset" | "vfxAsset" | "asset", ...)` or `VirtualScene apply.modify` — those fail because `VFXComponent` has no editor-side JS-bound properties beyond the base Component fields.

**Use `AssetManager.instantiate()` from `ExecuteEditorCode`** — the native path that drag-and-drop uses. Call the path-backed action with the stable VFX asset ID as structured runtime `args`.

Pass the stable VFX asset ID to the action; it resolves the asset internally and uses the same native instantiation path as drag-and-drop:

```text
ExecuteEditorCode({
  path: "<absolute path to this skill>/actions/instantiate-vfx.ts",
  args: { vfxAssetId: "<vfx-asset-id>" }
})
```

The result includes `sceneObjectId`. A missing/invalid asset ID, a resolved non-`VFXAsset`, or an empty native instantiation result is an action failure.

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

---

## 9. GPU Particles (a preset-based system, separate from VFX Graph)

GPU Particles is a **separate system** from VFX Graph — it shares none of the `.graphVfx` pipeline above (no Spawn/Update/Output containers, none of the graph nodes you author in §§1–8). It is a **preset**: instanced quads (or 3D meshes) driven by a prebuilt, **stateless** particle **shader graph** (itself authored with custom code nodes) that you configure through **material pass properties** rather than by editing the graph. Both systems are current and supported — neither is deprecated.

**Which to use.** VFX Graph is the default for most effects. The two systems differ in one fundamental way: **VFX Graph is stateful, GPU Particles is stateless.** GPU Particles recomputes every particle each frame from the lens clock, a per-instance seed, and the emitter's *current* transform — nothing carries over between frames. That gives it three properties:

- **Translation-locked.** Every frame, `position = emitterWorldMatrix × spawnPoint + displacement`. Move the emitter and every live particle moves with it — an emitter parented to a bone follows it, and so do its already-emitted particles (no lag, no trail). It cannot leave a trail behind a moving emitter or leave sparks at a hit point once the emitter moves on.
- **No inter-frame state.** No collisions and no per-particle logic. Motion is closed-form in particle age: velocity range and drag, gravity, local force, sine and simplex noise, a velocity ramp, and one custom force. The custom force defaults to Attract/Repel, but it is computed from the particle's spawn point, not its current position, so it cannot orbit particles or settle them on a target.
- **Deterministic.** The same seed and time give the same frame, and time can be scrubbed (External Time). The exception is **World Position Seed**: it adds the emitter transform to the seed, so moving the emitter reshuffles the particles. Unlike VFX Graph, GPU Particles has no simulation stage: the vertex shader computes every position fresh each frame.

Its **World / Local Space** option only picks the axes for velocity and gravity, and whether 3D Mesh particles rotate with the emitter (`Local Space`, `World Space – Ignore Emitter Rotation`, `World Force – Gravity Ignores Emitter Rotation`); it never detaches positions from the emitter.

**Use VFX Graph** when particles must persist in the world independently of the emitter (smoke or fire trailing a moving object, debris left at an impact), when you need collisions, attractors, or per-particle logic, or for multi-emitter and interactive effects. **Use GPU Particles** when the effect rigidly belongs to its emitter (an aura around a held object, sparkle on a bone), for a quick ambient effect with no graph authoring, or for a replayable burst at a fixed point.

**Editor code and runtime scripts use different APIs for this system** — creating the emitter, reaching its material, and reading its properties all differ. The usual division of labor is: **create and configure the emitter at author time (Editor API), then let a runtime script *drive* an already-placed emitter** (see the burst recipe below).

**Creating the emitter (author-time / Editor API).** There is no `scene.createSceneObjectFromPreset` on the editor `Scene`. Use the MCP call `scene-graphql.createSceneObjectFromPreset` with preset `"GPUParticlesObjectPreset"`, or construct the preset through `PresetsRegistry` in `ExecuteEditorCode` (see `editor-api` → `references/presets.md`). The preset populates its `RenderMeshVisual` **asynchronously** — its components are empty on the tick you create it, so don't read them synchronously.

**Reading & writing the config.** The emitter's per-instance material holds the entire configuration as **pass properties**. Names can differ between versions of the particle graph. A material keeps the graph it was created with, even after its project is opened in a newer Lens Studio, and nothing in the scene tells you which version that is. **So decide by what you did: if you created the preset in this task, it uses the current graph and the names documented in this section are safe. For any material you didn't create, enumerate the names before relying on them.** How you access them depends on where your code runs:

- **Editor API (`ExecuteEditorCode` / asset tools)** — the material exposes `passInfos[0]`. `passInfos[0].getPropertyNames()` returns the writable uniform names; `passInfos[0].uiData.passBindings` returns the full labeled schema — each entry's `name`, `label`, `type`, and (for numeric bindings) `defaultValue` and `min`/`max` — including the feature-toggle `#define`s that gate optional groups. The name list only includes properties the current toggle settings use, so set the toggles before you read it. Read or write a value by **direct named access on the pass** — `material.passInfos[0].<name>` in `ExecuteEditorCode` — or via the asset-graphql `setProperty(propertyPath: "passInfos.0.<name>")` mutation. (There is no `getProperty`/`setProperty` method on the material itself.)
- **Runtime (Lens API script)** — reach the same fields directly by name through the visual's material: `visual.mainMaterial.mainPass.<name>` (shader uniforms surface as named properties on the `Pass`). The runtime `Pass` has no way to *list* its property names — it's fixed accessors plus get/set by known name — so discover the identifiers once with the editor probe above (or the Material inspector), then address them by name at runtime.

When you enumerate, read each property back before writing — a field's value encoding can vary by version too. The controls group into categories such as lifetime & spawn timing, spawn shape (box / sphere / point), motion (velocity range, drag, gravity), size and color/alpha over life, rotation, and the base texture — plus optional `#define`-gated groups such as flipbook / sprite-sheet animation, PBR, noise, and trails (enumerate their parameters the same way; don't assume names).

Particle count is the pass's instance count on both surfaces — `passInfos[0].instanceCount` in the Editor API, `mainPass.instanceCount` at runtime (it's a `Pass` property, not a property of the host visual). There is **no** separate spawn-rate / `birthRate` parameter — spawn behavior is governed by the spawn-duration field and the spawn-mode `#define`s.

### Bursts (hit sparks, confetti, muzzle flash)

Enable **External Time**, **Instant Spawn**, and **Pre-Warm** on the GPU Particles material; in the Editor API, add `EXTERNALTIME`, `INSTANTSPAWN`, and `PREWARMSPAWN` to `passInfos[0].defines`. Pre-Warm is required: with Instant Spawn on and Pre-Warm off, no particle ever appears. To fire, set `mainPass.externalTimeInput = 0` from a script and advance it by `getDeltaTime()` each frame until it passes the particle lifetime; the emitter stays invisible until the next fire.

**Reusing a material you didn't create:** check it in the same Editor call that sets those toggles. After setting them, `getPropertyNames()` must include `externalTimeInput`, `externalSeed`, `timeGlobal`, and `lifeTimeMinMax` or `lifeTimeConstant`. If `PREWARMSPAWN` is missing from `uiData.passBindings`, skip it: graphs from before Lens Studio 5.10 lack the toggle and already behave pre-warmed. If neither lifetime name is present, look for `timeLifeMinMax`, which older graphs use, and substitute it in the script; or recreate the material from the preset.

```js
// @input Component.RenderMeshVisual visual   // defaults to this object's RenderMeshVisual
var pass = (script.visual || script.getSceneObject().getComponent("Component.RenderMeshVisual")).mainMaterial.mainPass;
// Lifetime Random picks which lifetime field the shader uses; the larger covers either setting.
var longest = Math.max(pass.lifeTimeConstant || 0, pass.lifeTimeMinMax ? pass.lifeTimeMinMax.y : 0);
// Global Time Multiplier scales particle age; at 0 particles never age, so no burst can play.
var rate = pass.timeGlobal;

if (rate > 0 && longest > 0) {
    setUpBurst(longest / rate);
} else {
    print("GPU Particles burst not set up: needs Global Time Multiplier > 0 and a lifetime > 0");
}

function setUpBurst(life) {
    var t = life + 1;                       // start past the end: nothing visible until fire()
    pass.externalTimeInput = t;

    function fire() {
        t = 0;
        pass.externalSeed = Math.random();  // new random look per burst
        pass.externalTimeInput = 0;         // rewind: every particle restarts
    }

    script.createEvent("UpdateEvent").bind(function () {
        if (t > life) { return; }           // burst over; hold
        t += getDeltaTime();
        pass.externalTimeInput = t;
    });
    script.createEvent("TapEvent").bind(fire);
    script.fire = fire;                     // other scripts: script.fire()
}
```

(For the cross-script hook that a gameplay controller calls to fire, see `lens-api` Cross-Script Communication.)

> **Motion verification:** an orthographic `CaptureRuntimeViewTool` freezes simulation time — two captures come out pixel-identical even while particles are emitting. To confirm a GPU-particle emitter is actually live, use Preview-panel screenshots ≥1 s apart; a `playing = true` emitter can still be inert.
