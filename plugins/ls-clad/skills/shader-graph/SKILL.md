---
name: shader-graph
description: Create or edit custom shaders and shader graphs — `.graphShader` YAML, GLSL code nodes, and library subgraphs.
user-invocable: true
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Shader Graph YAML

## When to use this skill (vs. vfx-graph / materials)

This skill is for **creating or editing custom shaders** — `.graphShader` files, GLSL code nodes, library subgraphs in shader graphs.

**Don't use this skill** when:
- The task is a `.graphVfx` particle/VFX graph → [`vfx-graph`](../vfx-graph/SKILL.md)
- The user wants to tweak an existing material — color, metallic/roughness, texture, or a built-in preset (PBR, Unlit, screen-space Image) plus property changes → [`materials`](../materials/SKILL.md)

> **Read the bundled example file first.** It shows the full schema in working form. This skill only covers what you can't see in that file: runtime constraints, conventions, embedding procedures, and strategic guidance.

## Resolving `<LS_INSTALL>`

Several reference files (below) and the manifest (§6) live inside the user's Lens Studio install. Run the `getLensStudioInstallPath` snippet from [`reference/resolve-ls-install.md`](reference/resolve-ls-install.md) via the `ExecuteEditorCode` MCP tool to get the path.

## Reference files

- **Shader graph example** — `codeNode.graphShader` at `<LS_INSTALL>/Contents/JsPlugins/PresetsRegistry/Assets/CodeNodeMaterial/Resources/codeNode.graphShader`.
- **Custom-code GLSL** (port decorators, shader `system.*` API): [`reference/code-node-reference.md`](reference/code-node-reference.md). VFX-specific `system.*` additions live in [`vfx-graph`'s reference dir](../vfx-graph/reference/vfx-code-node-reference.md).
- **Manifest** (`nodes.json`) — every template's port set: see §6 below.
- **VFX-specific concerns** (pipeline, container subgraphs, particle attributes): [`vfx-graph`](../vfx-graph/SKILL.md).

---

## 1. Things you can't see by reading the example

### `Node{N}CheckEnabled` / `CheckExists` / `CheckValue` are siblings, not children

These three flags sit at the same indent level as `Node{N}:` — **outside** the node block, as sibling keys under `ChildNodes`:

```yaml
ChildNodes:
  Node3:
    ...
  Node3CheckValue: false           # sibling of Node3, NOT a child
  Node6:
    ...
  Node6CheckEnabled: true          # CheckEnabled+CheckExists usually paired
  Node6CheckExists: true
```

Defaults: **`CheckEnabled: false`, `CheckExists: false`, `CheckValue: true`**. So:
- `Node{N}CheckValue: false` (written) means it's been **toggled off** from its default of true.
- `Node{N}CheckEnabled: true` + `CheckExists: true` (written, usually paired) means they've been **toggled on** from their default of false.
- All three absent means defaults — Enabled false, Exists false, Value **true**.

**Most defaults are stripped from the YAML** — when authoring, only write the ports/fields you're actively setting; the engine fills in the rest with defaults from the manifest.

When embedding a library subgraph, copy whatever metadata the source file specifies.

### `IOType: 0` is never written

Output ports write `IOType: 1`. Input ports omit `IOType` entirely. Don't write `IOType: 0` even though it'd be valid.

### `ClassType1` is omitted for inferable classes

The codec strips `ClassType1` from YAML on save when it can re-derive the class from the port's structural shape. On load the engine re-infers it; runtime behavior is unchanged.

- **Omitted (do not write)**: `FLOAT`, `INT`, `BOOL`, `STRING`, `COMBO`, `LINK`.
- **Preserved (must write)**: `COLOR`, `MATRIX`, `TEXT`, `REFUID`, and anything whose stored value differs from the inferred class — e.g. typed asset refs that carry `ClassType1: ""` alongside `BaseType`.

When authoring, only write `ClassType1` for the preserved set. Older fixtures may show explicit `ClassType1: FLOAT/LINK/etc.`; those will be stripped on the next save and are not a correctness concern either way.

### `Connection0` only — no `Connection1` or higher

Each port has at most one incoming connection. The key is always `Connection0:` (the trailing zero is convention). Multi-input nodes use distinct port names (`Input0`, `Input1`, `Value1`, `Value2`, ...) — fan-in lives in port-name multiplicity, not connection-number multiplicity.

There is no `ConnectionCount` field — presence of `Connection0` implies one connection, absence implies zero.

To disconnect: remove the entire `Connection0` block. Don't leave a stub.

LINK ports omit `Variable` entirely. Other types keep `Variable` even when connected — it's the fallback if the connection is removed later.

### Asset references — two coexisting forms

```yaml
# Typed (preferred when the slot has a fixed asset class)
Mesh:
  ClassType1: ""                   # empty string when paired with BaseType
  BaseType: Asset.RenderMesh       # or Asset.Material, etc.
  ScriptType: All
  String: ""                       # asset GUID; "" = unbound

# REFUID (generic)
CustomCodeNodeAsset:
  ClassType1: REFUID
  String: ""
```

Texture inputs are different — they use `LINK` + `ClassType2: TEXTURE_OBJECT_2D`, not an asset ref.

### Parameter droplist exception (`ItemCount` + `Title0..N`)

`nodes_inputs_parameters_droplist` is the **only** template that uses `ItemCount` plus `Title0`/`Title1`/...`Title<N-1>` ports for its dropdown options. Regular `COMBO` ports use the flat `ItemList: "a : b : c"` string with no `ItemCount` or per-item title ports. Don't confuse them.

### Custom code node conventions

Most port defaults for `node_util_custom` (and the VFX container variants `node_util_custom_container_spawn`, `_container_update`) are in the manifest — look them up there. The conventions an agent needs to know that aren't obvious from the manifest:

- **`TemplateVersionMinor`** is a sibling field on the node block (NOT a port). The correct value depends on the template family:
  - `node_util_custom` (regular shader code nodes) → `TemplateVersionMinor: 2`
  - `node_util_custom_container_*` (VFX container variants: `_spawn`, `_update`, `_output_pixel`, `_output_vertex`) → `TemplateVersionMinor: 1`

  The manifest's `schemaDefaults` lists `0`, but neither family uses the manifest default — always write the correct value above.
- **`LastChached3`** and **`LastCodeFormatted3`** ports are engine-populated GLSL caches. Leave them at the manifest default (`""`) when authoring — the engine fills them in on save. **Never hand-author them.**
- **`ID`** port — the manifest may list a per-instance value (e.g. `75`); ignore that. For new nodes use `0` or the node's `LevelID`. Used for variable-name prefixing in the compiled cache.
- **`Title`** port — display name. See [`reference/code-node-reference.md` §5](reference/code-node-reference.md) for the port shape and its required `Title1` sibling.
- The `Code` port's GLSL block scalar uses **tabs**, not spaces.
- Container variants (`_container_spawn`, `_container_update`) cannot declare `output_*` decorators — they set particle attributes via `system.*` calls and chain through implicit `ParticleIn`/`ParticleOut` LINK ports.
- **Texture `input_*` decorators map to LINK ports, not FLOAT.** A `input_texture_2d Tex;` declaration in GLSL produces a host YAML port whose stored class is `LINK` and whose `ClassType2` is `TEXTURE_OBJECT_2D` — not a FLOAT/vec4 port. `ClassType1: LINK` is stripped on save (see "`ClassType1` is omitted for inferable classes"); the structural signal is the bare `ClassType2`. Example connecting a Texture 2D Object Parameter:

  ```yaml
  BaseTex:
    ClassType2: TEXTURE_OBJECT_2D
    Connection0:
      NodeLevelID: 16        # the Texture 2D Object Parameter node
      PortID: Texture
  ```

  Same shape for `_texture_2d_array`, `_texture_cube`, `_texture_3d` — just `ClassType2` set to the matching `TEXTURE_OBJECT_*`. Verify the exact value against an existing instance or the manifest.

### Pause briefly after writing graph YAML

Lens Studio reimports the asset asynchronously after the file changes. A query against the asset or its dependents (e.g. `asset-graphql` reads) issued within ~1s of the write may return a stale snapshot. Wait at least 1–2 seconds between the write and any verify-by-query step.

---

## 2. Adding a node

Steps:

1. Look up the `TemplateID` in the manifest (see §6) to find the available port IDs, types (`ClassType1`), and dimensions. Use this when you need to know a port name to set or connect.
2. Pick the next free `Node{N}` map key under `ChildNodes`.
3. Assign `LevelID = max(existing LevelIDs across the entire graph) + 1`. LevelIDs must be unique anywhere a connection might cross.
4. Assign `DependencyIndex = max(existing DependencyIndex) + 1`. Sequential per file.
5. Write the ports you're setting (with `Variable`/`String`/`ItemList`+`ItemIndex`/etc.) and any input ports you're connecting (with `Connection0`). Omit ports you don't touch.

The bundled example file shows how the editor saves a working graph — it may include more ports than strictly required because the editor writes the full active state. When authoring from scratch, prefer minimal.

### Deleting a node

Procedure for deleting `Node{K}:`:

1. **Strip every `Connection0` that references the removed node's `LevelID`.** Find every `NodeLevelID: <K's LevelID>` in the file and delete the enclosing `Connection0:` block. The remaining `Variable:` default takes over.

   **Exception — replace, don't strip.** If you're swapping the deleted node for a new one in the same pipeline slot, retarget each downstream `Connection0` to the replacement node's `LevelID` instead of stripping it. Stripping then re-adding the same connection is just busywork — and easy to forget the re-add half of.

   **Bypass-rewire.** If the deleted node was a pass-through (one logical input wired through to its output), retarget downstream `Connection0`s to whatever was feeding that input port. Trace the input's `Connection0` (or, for subgraphs, the outer port whose `SubGraphUniqueID{N}` matches the inner export node's `LevelID`) to find the upstream source.
2. **Remove the `Node{K}:` block** itself, plus its `Node{K}CheckEnabled` / `Node{K}CheckExists` / `Node{K}CheckValue` siblings if present.
3. **Leave everything else alone.** Don't touch other nodes' `LevelID`s, `DependencyIndex`s, or the alphabetic `Node{N}:` keys — the engine resolves wiring through `LevelID` references, so gaps in any of these sequences load and run correctly. The editor renumbers densely when *it* next saves the file, but externally-edited files with gaps are fine.

---

## 3. Connecting

Connections live on the **input** port of the destination:

```yaml
Input0:
  Connection0:
    NodeLevelID: 5                 # source node's LevelID
    PortID: Output                 # source port's map key
  Variable: [0.0, 0.0, 0.0, 0.0]   # fallback if disconnected (kept on non-LINK ports)
```

(`ClassType1: FLOAT` is omitted here — see §1.)

---

## 4. Embedding a library subgraph

Library subgraphs are `.subgraphCommon`, `.subgraphVfxSpawn`, `.subgraphVfxUpdate`, `.subgraphVfxOutput` files. Each is a complete `NodeType: 3` container with internal nodes and external `SubGraphUniqueID{N}` ports.

`.subgraphCommon` is a subgraph format that's shared between shader graph and vfx graph. The other formats are specific to VFX graph.

**`SubGraphUniqueID{N}` matches inner LevelID:** the container's outer-facing port named `SubGraphUniqueID{N}` corresponds to the inner `nodes_import_*` or `nodes_export_*` node whose `LevelID` is `{N}`. When you remap LevelIDs, you must rename these ports.

### Procedure

1. Read the library subgraph file — the `Nodes:` block is the container.
2. **Remap LevelIDs.** Scan the parent for `max(LevelID)`, assign new sequential IDs starting at `max + 1` to the container and all its internal nodes, update every `Connection0.NodeLevelID` inside the subgraph's `ChildNodes`, and rename the container's `SubGraphUniqueID{N}` port keys to match the new internal LevelIDs.
3. **Wire the container into the parent graph** (input ports connect to upstream, downstream nodes connect from the container's output ports). Pick the next free `Node{N}` map key — pipeline ordering is enforced by the `Begin`/`End` connection chain, not map position.
4. **Set sibling metadata.** VFX container subgraphs typically need `Node{N}CheckEnabled: true` and `Node{N}CheckExists: true` — copy what the source file shows.
5. **Assign `DependencyIndex`** values past `max(existing)` for the container and its internals (depth-first, internals before their container). Gaps in the sequence are fine — don't renumber existing nodes.

### Library paths

| Extension | Directory |
|---|---|
| `.subgraphCommon` | `Systems/Shaders/library/subgraph/` |
| `.subgraphVfxSpawn` | `Systems/Particles/library/subgraph_vfx_spawn/` |
| `.subgraphVfxUpdate` | `Systems/Particles/library/subgraph_vfx_update/` |
| `.subgraphVfxOutput` | `Systems/Particles/library/subgraph_vfx_output/` |

---

## 5. Adding parameter nodes for user-facing controls

Parameter nodes (`nodes_inputs_parameters_float`, `_color`, `_bool`, `_texture2d_object`, `_droplist`) expose user-tweakable values in the Lens Studio Inspector and at runtime via the material's `mainPass`.

### Constraints not visible in the YAML

- **Must live at the root level** of the graph. The engine errors if a parameter node is nested inside a subgraph.
- **`ScriptName`** rules:
  - camelCase
  - no spaces, no special characters
  - **must be unique** among all parameter nodes in the same shader
- Place ≥250 px to the left of the node they feed.
- Add parameter nodes for any value a user would reasonably want to tweak. Default to using them rather than hardcoding values.

### Common ports

`Title` (display label), `ScriptName` (runtime variable name), `Default` or per-output `Variable` (initial value), `Group` (optional Inspector group label), `Tooltip`, `SortIndex` (Inspector display order).

---

## 6. Manifest (`nodes.json`)

Authoritative port set, types, dimensions, and per-port defaults for every template, plus the `schemaDefaults` table.

**Paths** (under `<LS_INSTALL>`, see "Resolving `<LS_INSTALL>`" at the top):
- Shader graphs: `Contents/Plugins/Es_ShaderGraph.bundle/GraphResources/documentation/nodes.json`
- VFX graphs: `Contents/Plugins/Es_VFXGraph.bundle/GraphResources/documentation/nodes.json`

**Required when authoring a template you haven't seen instances of in the project.** For the jq lookup recipe, the structure of port entries, how to map manifest fields to YAML, and the `schemaDefaults` table, see [`reference/manifest.md`](reference/manifest.md).

### `SystemID`

| Graph type | SystemID |
|---|---|
| Shader (`.graphShader`) | `dev.snap.shaders` |
| VFX/Particle (`.graphVfx`) | `dev.snap.particles` |

---

## 7. Strategic guidance

### Start from `codeNode.graphShader` by default

Always start from the bundled `codeNode.graphShader` and edit the custom code node's GLSL. Code nodes are more compact and easier to reason about than large graphs. Only depart from this default when:

- The user specifically asks for a node-based approach.
- The task requires one of the always-template exceptions below.

Always-template exceptions (no code-node equivalent exists):
- **PBR shading** — `nodes_main_material_brdf`. Use this template node for any PBR lighting.
- **Interpolate nodes** — vertex→fragment varyings. Code nodes cannot create interpolants. Use sparingly; varyings consume GPU resources.
- **Parameter nodes** — always template-based (`nodes_inputs_parameters_*`).

### Positioning

- Graphs flow left-to-right: sources on left, output (`nodes_main_graph` for shaders) on right.
- ~250 px horizontal spacing keeps connections readable.
- Stagger Y to avoid overlapping nodes that share a column.
- Minimize crossing connections — keep the graph tidy for the author.
