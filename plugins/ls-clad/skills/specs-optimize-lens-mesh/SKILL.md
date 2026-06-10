---
name: specs-optimize-lens-mesh
description: >-
  Cuts Specs draw calls in a Lens Studio prefab by merging same-material
  RenderMeshVisuals, then decimating geometry. Trigger on "reduce draw calls",
  "merge meshes", "optimize this model", "make this Lens faster". Needs Lens Studio MCP.
user-invocable: true
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Optimize Lens Studio Meshes

CPU submission per RMV is the dominant cost factor on Specs, so draw-call reduction is the headline win. Simplification is a secondary geometry-budget win that fits in after consolidation.

## When to use

- Optimizing a prefab that's instantiated many times at runtime (aircraft, vehicles, characters, props)
- An imported model shows up as dozens or hundreds of RenderMeshVisuals in the hierarchy
- Users report the Lens is heavy, slow, or draw-call-bound
- Preparing assets for performance review before publishing a Specs Lens

## Required MCP tools

- `scene-graphql`
- `asset-graphql`
- `ExecuteEditorCode`
- `MergeMeshesTool`
- `SimplifyMeshTool`

Tool naming, deferred schemas, and ask/spawn semantics: see `lens-studio-field-notes` Hard Rule 2 / Cross-runtime orchestration.

## The pipeline

1. **Analyze** — enumerate RMVs, separate mergeable from protected
2. **Merge** — consolidate mergeable RMVs per material into single GLBs
3. **Simplify** — decimate the merged GLBs (and other heavy individual meshes) to visually-lossless levels
4. **Apply** — mutate the prefab through the Editor API to reference the new meshes, delete the sources

## Stage 1: Analyze

### Enumerate the RMVs

Look up the target prefab as an asset, then walk its internal `sceneObjects` collection. `ObjectPrefab` is an `ObjectOwner` — it exposes `rootSceneObjects`, `sceneObjects`, `createSceneObject`, `reparentSceneObject`. Each internal `SceneObject` has `.name`, `.id`, `.components`, `.children`, `.destroy()`, `.addComponent()`. Each `RenderMeshVisual` exposes `.mesh` (the FileMesh asset), `.mainMaterial`, `.materials`.

```ts
const model = pluginSystem.findInterface(Editor.Model.IModel);
const am = model.project.assetManager;
let prefab: any;
for (const a of am.assets) {
  if ((a as any).name === "<PrefabName>") { prefab = a; break; }
}

const rmvs: any[] = [];
for (const so of (prefab as any).sceneObjects) {
  for (const c of ((so as any).components ?? [])) {
    if ((c as any).mesh) {
      rmvs.push({
        soId: (so as any).id,
        soName: (so as any).name,
        meshId: (c as any).mesh.id,
        materialId: (c as any).mainMaterial?.id,
      });
    }
  }
}
```

### Identify protected SceneObjects

A SceneObject must stay intact — can't be deleted, can't have its RMVs moved to another parent — if any script, animator, or runtime system references it by identity. Inspect each `ScriptComponent` on the prefab for ScriptInput properties with type `SceneObject` or `SceneObject[]`. Common shapes:

- **Toggle lists** (e.g. `landingGear: SceneObject[]`) — script enables/disables each listed SO at runtime. All listed UUIDs are protected.
- **Highlight lists** (e.g. `componentsToHighlight: SceneObject[]`) — script swaps materials on each SO. Protected, but internal merging within a single highlight SO is OK because the script enumerates via `getComponents("RenderMeshVisual")`.
- **Transform targets** (e.g. `Rotator.targetObject`, animation retargeting) — the referenced SO's transform is driven at runtime, so it must remain a distinct node.
- **Structural roots** (e.g. a script's `aircraft: SceneObject` field pointing at the visual root) — keep as-is.

Collect the union of all referenced SceneObject UUIDs plus the root visual SceneObject. That's the protected set. Also implicitly protect any SceneObject that's an ancestor of a protected child (deleting an ancestor would destroy the child).

### Group candidates by material

Bucket every non-protected RMV by `mainMaterial.id`. A bucket with **2 or more** entries is a merge group. Single-entry buckets can't merge.

Report the analysis before mutating anything:

```
Total RMVs: 34
Protected: 12 (landing gear ×0, highlight ×6, rotator targets ×2, blade children ×3, root ×1)
Mergeable by material:
  - b54354c2 (body grey): 12 RMVs → merge group A
  - 2172ad81 (panels):    10 RMVs → merge group B
  - 272ded82 (blades):     1 RMV  → skip (below min)
  - e0c0d2f1 (highlight):  0 RMVs → skip (all protected)
```

## Stage 2: Merge

`MergeMeshesTool` merges scene-level SceneObjects (not prefab-asset SceneObjects directly) by matching on `.name`. Produces a single `FileMesh` per call with world transforms baked into vertex positions, saved as a `.glb` at the given output folder.

### Instantiate the prefab

```ts
am.instantiate([prefab]);
```

This places a scene-level instance at the scene root. Find its root via `scene-graphql`'s `rootSceneObjects { id name }` query. Walk the instance to match each prefab-level RMV to its scene-level counterpart — the hierarchy and names mirror the prefab exactly on a fresh instantiation.

### Rename targets to unique names

The tool identifies inputs by name. To avoid picking up unrelated SceneObjects that happen to share a generic name (`Box001`, `Cylinder005`, etc.), rename each target in the instance to a unique label before calling the tool:

```ts
// For each target SceneObject in the instance for group A:
(instanceSO as any).name = `__MERGE_A_${idx}`;
```

Keep a mapping from the unique name back to the original prefab-level UUID so you can match up for the prefab mutation in Stage 4.

### Call MergeMeshesTool

```
MergeMeshesTool({
  sceneObjectNames: ["__MERGE_A_0", "__MERGE_A_1", ...],
  outputFolder: "/MeshOptimizer/<PrefabName>"
})
```

Returns JSON with `assetId`, `assetPath`, `vertexCount`, `sourceBreakdown`, and a 4-angle preview image. Check the image — the merged silhouette should read correctly as the union of the source parts in their correct world-space positions.

### Find the inner FileMesh UUID

The `assetId` returned is the `ObjectPrefab` wrapper, not the inner mesh. The RMV's `mesh` reference needs the `FileMesh` asset inside the GLB. Query:

```
asset-graphql({
  query: `{ allAssets(pathFilter: "MeshOptimizer/<PrefabName>/<filename>.glb",
                      showPackedContent: true) {
              id name type
          } }`
})
```

Pick the entry with `type: "FileMesh"`. That UUID goes into the new RMV.

### Rebind the original material

The merged GLB ships with an auto-generated material inside. When you build the new RMV in Stage 4, set `mainMaterial` (or `materials[0]`) to the **original** material asset the source RMVs were using — not the GLB's internal material. This preserves the shader, color, textures, and any highlight behavior the source group had.

## Stage 3: Simplify

For each merged GLB — plus any standalone heavy mesh (>1,500 tris, e.g. a detailed cylinder or machined part that survived as a single non-merged RMV) — decide whether to decimate and by how much.

### Preview grid first

Call the tool with no `targetVertices`:

```
SimplifyMeshTool({
  meshPath: "MeshOptimizer/<PrefabName>/<file>.glb"
})
```

Returns an image with rows of vertex counts (typically 6–9 levels, progressively more aggressive) × 4 camera columns (Front / 3-quarter / Side / Top). Each row shows the mesh reduced to that vertex target.

### Pick the optimal level

Scan down from the top. The optimal target is the **lowest row** where all four camera angles still read as visually indistinguishable from the top row. One row below optimal, you'll start seeing breakage: thin features fragment, sharp seams crack, cylindrical surfaces show facets.

Heuristics by mesh character:

- **Smooth organic shells (fuselage panels, body plates)** — tolerate 50–70% vertex reduction cleanly.
- **Meshes with hard panel seams (windshields, cockpit covers, door frames)** — be conservative, 20–50%. Decimation collapses the quads defining sharp edges first, which cracks visible seams.
- **Spinning or motion-blurred geometry (rotor blades at speed, fans, wheels)** — extremely aggressive, 80–95%. Silhouette fidelity is irrelevant under motion blur.
- **Highlight components** — users look directly at these when the object is selected, so stay conservative or skip entirely.

Bias conservative when in doubt. A visible regression is a worse outcome than keeping a few extra thousand triangles.

### Commit with `targetVertices`

```
SimplifyMeshTool({
  meshPath: "MeshOptimizer/<PrefabName>/<file>.glb",
  targetVertices: <chosen number>,
  outputFolder: "/MeshOptimizer/<PrefabName>"
})
```

Writes `<name>_<n>verts.glb` in the output folder. Look up its inner FileMesh UUID the same way as in Stage 2 (`allAssets(showPackedContent: true)`). That's the mesh UUID the new RMV will reference.

### What not to simplify

- Meshes already under ~500 triangles — diminishing returns, and low-poly topology tolerates decimation poorly.
- Thin flat geometry (rotor blades, leaves, decals at 20–50 tris) — already minimal; simplification breaks silhouette.
- Anything in `componentsToHighlight` unless the user specifically requests it.
- Meshes packed inside an FBX with no standalone file. The tool needs a file on its own. If such a mesh is heavy enough to matter, route it through the merge step instead (which produces a standalone GLB as a byproduct).

## Stage 4: Apply to the prefab

Mutate the `ObjectPrefab` asset directly and flush with `project.save()`.

### Mutation pattern

```ts
// Reuse model/am/prefab references acquired in Stage 1.

// 1. Find the parent where merged results should live.
//    Typically the visual root or an "-Holder" container at identity local transform.
//    This parent's transform context must match the context the source RMVs rendered
//    under, because the merge baked world transforms relative to the instance.
const visualRoot = (prefab.sceneObjects as any[]).find(so => so.name === "<VisualRootName>");

// 2. Create a new SceneObject + RMV for each merge group.
const merged = prefab.createSceneObject("MergedStatic_<groupKey>");
prefab.reparentSceneObject(merged, visualRoot);
// local transform stays identity — the merge already baked world positions
const rmv = merged.addComponent("RenderMeshVisual");
rmv.mesh = <inner FileMesh of the (possibly simplified) merged GLB>;
rmv.mainMaterial = <original material asset for this group>;

// 3. Destroy the source SceneObjects that were merged away.
//    (Make sure none are in the protected set before destroying.)
for (const so of sourceSceneObjectsToRemove) {
  so.destroy();
}

// 4. Persist the prefab to disk.
model.project.save();
```

`destroy()` removes the SceneObject and all its components from the prefab. Any other SceneObjects that had the destroyed SO in their `Children:` reference get updated automatically.

### Transform placement

`MergeMeshesTool` in flatten mode bakes each source's world-space transform into vertex positions. The parent you pick for the new merged SceneObject must sit at the same effective world transform the sources rendered under:

- If the sources were under a chain with net world transform = identity, parent the merged SO under the same chain with identity local transform.
- If the chain has a net non-identity scale (e.g. an FBX import that was scaled to fit the scene), put the merged SO under the same non-identity parent with identity local transform. The bake already accounts for the chain.
- When uncertain, overlay-test before committing: instantiate the merged GLB at your chosen parent, keep one source RMV visible, verify they coincide.

### Cleanup after save

Stale entries may remain in `PrefabRemaps` referring to deleted internal UUIDs. These are inert — they never resolve at instantiation — and Lens Studio prunes them on the next open-and-save cycle. Don't attempt to scrub them manually.

## Verification

After `project.save()`:

1. Read the `.prefab` file and count top-level `- !<RenderMeshVisual/...>` entries. Expected: `original_count − merged_sources + merge_group_count`.
2. For each protected SceneObject UUID captured in Stage 1, grep the file and confirm it still appears.
3. For each ScriptInput that referenced a SceneObject or SceneObject array (landing gear, highlights, rotator targets, etc.), confirm the reference UUIDs still resolve to present SceneObjects.
4. Instantiate the modified prefab in the scene and visually inspect. If you've kept a baseline comparison prefab (see "Side-by-side comparison" below), instantiate both and eyeball them against each other.

## Reporting

Present a concise before/after table. The key metrics:

| Metric | Before | After |
|---|---:|---:|
| RenderMeshVisuals (draw calls) |  |  |
| Triangles |  |  |
| Vertices |  |  |
| Prefab file size |  |  |
| New merged asset size (net) |  |  |

If multiple instances of the same prefab appear in a scene at runtime, multiply the draw-call savings across the expected instance count for a fleet-level number.

## Side-by-side comparison prefabs

When the user wants to visually compare before/after: copy the `.prefab` + `.prefab.meta`, regenerate the root and meta UUIDs in the copy, apply mutations to the copy only, then ask the user to reload the project.

See [`references/side-by-side-comparison.md`](references/side-by-side-comparison.md) for the full UUID regeneration steps and three-way variant workflow.

## Complete example: reducing a 34-RMV aircraft prefab

Starting state: prefab with 34 RMVs across 4 materials. Protected set: 12 SOs (rotor holders, blade descendants, highlights, visual root). Mergeable: 2 groups (12 + 10 RMVs).

**Result**: 34 → 14 RMVs (−59% draw calls), 8,248 → ~5,500 tris (−33%), protected behavior (landing gear toggle, highlight swap, rotor spin) preserved.

## Anti-patterns

- **Over-decimating highlight components** — users stare at these when objects are selected.
- **Placing the merged SceneObject at the wrong level in the prefab** — the parent must match the world-transform context of the sources, or the merged geometry lands in the wrong place.
- **Trying to simplify a mesh that's packed inside an FBX and has no standalone file** — route through merge instead (merge produces a standalone GLB that the simplifier can operate on).
