---
name: mesh-builder-scripting
description: Runtime MeshBuilder API reference for Lens Studio — construct or mutate meshes from TypeScript (primitive helpers, lathe, extrude, tube, topology examples, dynamic vertex updates, skinned meshes, vertex colors). Use when writing a script that builds or animates geometry at runtime. For author-time static GLB generation (SPECS Text-to-3D / FAST3D / Blender voxel), use `/build-mesh` instead.
context: fork
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# MeshBuilder API (Runtime)

## API Reference

The core classes live in `Support/StudioLib.d.ts`. Grep for each symbol by name to find the current definition:

| Symbol | Purpose |
|--------|---------|
| `MeshBuilder` | Construct and mutate meshes at runtime |
| `MeshTopology` | Topology enum (Triangles, TriangleStrip, TriangleFan, Points, Lines, LineStrip) |
| `MeshIndexType` | Index type enum (None, UInt16) |

Grep for `class MeshBuilder`, `enum MeshTopology`, and `enum MeshIndexType` in `StudioLib.d.ts` to get the current method signatures (`appendVerticesInterleaved`, `setVertexInterleaved`, `appendIndices`, `eraseVertices`, `eraseIndices`, `getMesh`, `updateMesh`, `setBones`, etc.). This is the same discipline as `lens-studio-field-notes` "Verify the API surface before writing" — apply it to any other unfamiliar LS API too.

## Resources

This skill includes a pre-built vertex color package:

```
{skill_base_dir}/resources/SimpleVertexBaseColor.lspkg
```

Contains `vertexBaseColorMaterial` (UUID: `70d03593-c7b4-410a-ae5c-75cb82ee32dc`) — purpose-built for per-vertex color rendering. Use this instead of UberPBR.

### Material Do / Don't

- **Do** import the packaged `SimpleVertexBaseColor.lspkg` and wire `vertexBaseColorMaterial` (UUID above) to the script's `@input material`. This is the default path.
- **Do** alternatively use Uber PBR / UberUnlit with `passInfos.0.Vertex Color` set to `"Base Color"` (`valueType: STRING`) if you need PBR shading on top of vertex colors.
- **Do** query `asset-graphql assetsByName(name: "vertexBaseColorMaterial")` first if you're not sure whether the package is already installed — avoid re-importing.
- **Don't** hand-write `.mat` YAML files. The UUIDs can collide with Lens Studio built-ins silently (producing "Duplicate material id" warnings and leaving `this.material` null at runtime), and `PassesInfo` is non-trivial to construct correctly.
- **Don't** create a material without a shader assigned — an empty `PassesInfo: []` will load but render as null.

## Workflow

1. Grep for `class MeshBuilder` in `Support/StudioLib.d.ts` and read the full class definition for exact method signatures.
2. **Pick the right generator before writing geometry.** Defaulting to `addBox`/`buildCylinder` for smooth shapes produces blocky output. Classify the target (full examples in `references/smooth-surfaces.md`):

   | Shape | Generator | Reference |
   |---|---|---|
   | Rotationally symmetric (chess piece, vase, map pin) | **lathe** | `smooth-surfaces.md` |
   | 2D outline with depth (heart, star, coin, gear) | **extrude** | `smooth-surfaces.md` |
   | Circular cross-section swept along a path (pipe, cable) | **tube** | `smooth-surfaces.md` |
   | Angular / modular / blocky (crates, walls, pixel-art) | stack `addBox`/`buildCylinder` | `primitives.md` |

   Most real assets compose multiple generators — see composing examples in `references/smooth-surfaces.md`. Unless the user specifies otherwise, target an overall size of roughly **50-100 cm** in Lens Studio world units so the mesh is immediately visible from a typical camera setup.
3. Write a TypeScript `@component` class that:
   - Declares `@input material: Material` to accept the vertex color material from outside.
   - Creates a `RenderMeshVisual` directly in `onAwake()` via `this.sceneObject.createComponent("Component.RenderMeshVisual") as RenderMeshVisual` — do **not** rely on a pre-wired mesh visual input.
   - Creates a `MeshBuilder` with the appropriate vertex layout. **Include `color` (4 components, RGBA) by default** — it enables per-vertex coloring.
   - Sets `topology` and `indexType`.
   - Appends vertices via `appendVerticesInterleaved` and indices via `appendIndices`.
   - Assigns the mesh and material to the RenderMeshVisual:
     ```ts
     const rmv = this.sceneObject.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
     rmv.mesh = builder.getMesh();
     if (this.material) rmv.mainMaterial = this.material;
     builder.updateMesh();
     ```
4. For dynamic meshes (moving vertices each frame), see `references/dynamic-updates.md`.
5. Wire the script into the scene using `scene-graphql` and `asset-graphql`:
   a. Create a SceneObject named after the mesh (e.g. `"Castle"`).
   b. Add a `ScriptComponent` to it — **no need to add RenderMeshVisual via scene-graphql**, the script creates it at runtime.
   c. Wire `scriptAsset` on the ScriptComponent to the `.ts` file you just wrote (`valueType: REFERENCE`).
   d. Query the ScriptComponent's `properties` to confirm `material` appears in `inputNames` — no recompile needed. LS file-watches `.ts` files and updates `inputNames` automatically on save.
6. Set up the vertex color material:
   a. Install the package via the `InstallLensStudioPackage` MCP tool (do **not** `cp` the `.lspkg` — a raw file copy does not register it as a package and it will not appear under "Packages" in the Asset Browser):
      ```
      InstallLensStudioPackage(
        packageUri: "{skill_base_dir}/resources/SimpleVertexBaseColor.lspkg",
        assetName: "SimpleVertexBaseColor"
      )
      ```
   b. The material UUID is stable — wire it directly to the `material` input on the ScriptComponent:
      ```graphql
      mutation {
        setProperty(id: "<script-component-id>", propertyPath: "material", valueType: REFERENCE, value: "70d03593-c7b4-410a-ae5c-75cb82ee32dc") { success message }
      }
      ```
7. Verify by querying the SceneObject's ScriptComponent and confirming `material` input is non-null.
8. **Verify visually** per `lens-studio-field-notes` "See-and-fix loop": capture the mesh from at least two angles (`MovePreviewCamera`) and judge the pixels. Hollow or see-through faces = CW winding (fix the indices per Reminders — do not paper over with two-sided); wrong/faceted lighting = shared-vertex normals (per-face duplication per Reminders).
9. Tell the user: the mesh was added to the scene root at origin with identity transform. Positioning, scaling, and parenting are left to the user.

## Reminders

- Call `updateMesh()` after every change.
- `indexType` should almost always be `MeshIndexType.UInt16`.
- **Winding order — front face = CCW viewed from outside.** Lens Studio has back-face culling on by default (`Cull Back`), so CW triangles are invisible. This is the single most common procedural-mesh bug.
  - **Rule:** each triangle's indices `[v0, v1, v2]` must trace counter-clockwise when viewed from outside the mesh.
  - **Sanity check:** `(v1 - v0) × (v2 - v0)` (cross product) should point the **same direction as the outward normal**. If it points inward, flip the triangle: `tri(v0, v1, v2)` → `tri(v0, v2, v1)`.
  - **Debug:** if your mesh looks inside-out or is invisible, temporarily set the material's Cull Mode to `Front`. If the mesh now renders correctly, your winding is inverted — flip all triangle index orders and switch the material back to `Cull Back`.
  - **Common trap:** copying a winding pattern across helpers. An index pattern is only CCW for the exact vertex labeling it was written for — the cylinder's `[bl, tr, br, bl, tl, tr]` is correct there and CW (culled) on a screen-space-labeled quad. Check each triangle with the cross-product rule above instead of reusing patterns; `references/primitives.md` has numerically verified `addBox` and capped `buildCylinder` helpers.
  - **Common trap:** copy-pasting one face's index pattern to all 6 box faces produces CW winding on at least 3 of them — use the `addBox` helper in `references/primitives.md`.
- **Closed solids need per-face vertices and normals.** A box is 24 vertices — 4 per face, each carrying that face's outward normal — never 8 shared corners. Shared vertices smear lighting across edges and make winding bugs harder to spot. Apply the same per-face duplication to any flat-shaded solid (crates, walls, trunks, towers).
- For genuinely thin sheets (leaves, flags, wing membranes), enable two-sided on the material rather than duplicating reversed indices. Never use two-sided as a band-aid for a see-through *solid* — that is a winding bug; fix the indices.
- **Never use the `script` global inside `BaseScriptComponent` class methods** — it is undefined at runtime. Use `this` instead: `this.sceneObject`, `this.createEvent(...)`, etc.

## Vertex Layout Attributes

```ts
{ name: "position",  components: 3 }           // required
{ name: "color",     components: 4 }           // include by default (RGBA, per-vertex)
{ name: "normal",    components: 3, normalized: true }
{ name: "texture0",  components: 2 }
{ name: "boneData",  components: 4 }           // only for skinned meshes
```

`appendVerticesInterleaved` reads the flat array in strides of `sum(components)`. Each vertex's attributes must appear in the same order as the constructor layout.

## Further Examples

- `references/topology-examples.md` — Points, Lines, LineStrip, TriangleStrip, TriangleFan
- `references/primitives.md` — `addBox`, `buildCylinder` helpers with verified CCW winding (angular/blocky shapes)
- `references/smooth-surfaces.md` — `buildLathe`, `buildExtrude`, `buildTube` for smooth, rotationally-symmetric, or swept shapes (**prefer over stacking primitives for curved geometry**)
- `references/dynamic-updates.md` — `setVertexInterleaved` pattern for per-frame mesh updates
- `references/skinned-meshes.md` — `boneData` attribute, skinned example, and `MeshBuilder.createFromMesh`
