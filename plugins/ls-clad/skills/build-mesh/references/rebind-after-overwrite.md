<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Re-binding placed instances after a GLB overwrite

When the mesh step overwrites a GLB that Lens Studio has already imported (the proxy→real swap, or any regeneration), the editor **deletes the old mesh asset** rather than reloading its binary in place. Every instance the skeleton placed is left holding `mesh: null` / `materials: {0: null}` — correct pose, nothing rendered. A preview refresh does not fix it. The only reliable repair is: destroy the stale instance subtree, re-instantiate from the freshly-imported prefab under the same parent.

Two facts before the recipe:

- **The detection signal is a zero-extent runtime bound** on a placed instance. `mesh: null` read via `scene-graphql` is NOT reliable on its own — healthy instances report it too.
- **The pose lives on the skeleton's wrapper node, not on what you instantiate.** The skeleton places a named wrapper (e.g. `<Name>Root/<Group>Root/<Slot>`) and parents the geometry under it. Re-instantiating **under the same wrapper** preserves the pose for free — you never re-derive or re-apply a transform unless the skeleton parented geometry directly.

## The recipe (worked, verified on a real build)

Do **not** re-derive this from `Support/editor.d.ts` — one build spent ~6 minutes grepping `IModel` / `ObjectPrefab` / `instantiatePrefab` out of the type defs to reproduce exactly this. One `ExecuteEditorCode` call per overwritten mesh (or batch the loop over several):

```ts
const model = pluginSystem.findInterface(Editor.Model.IModel);
if (!model) { return { error: "no IModel" }; }
const am: any = model.project.assetManager;
const scene: any = model.project.scene;

// 1. Find the freshly-imported ObjectPrefab by asset name.
let prefab: any = null;
for (const a of (am.assets || [])) {
  if (String(a.name) !== "<MeshName>") { continue; }
  let ok = false;
  try { ok = a.isOfType("ObjectPrefab"); } catch (_e) { /**/ }
  if (ok) { prefab = a; break; }
}
if (!prefab) { return { error: "<MeshName> ObjectPrefab not found" }; }

// 2. Walk to the skeleton's wrapper node by the created_roots path.
function findChild(obj: any, name: string) {
  if (!obj) { return null; }   // a prior path step may have returned null; chain safely to null
  for (const k of (obj.children || [])) { if (k.name === name) { return k; } }
  return null;
}
let node: any = null;
for (const r of (scene.rootSceneObjects || [])) { if (r.name === "<ExperienceRoot>") { node = r; } }
node = findChild(findChild(node, "<UnitRoot>"), "<MeshName>");   // adjust to the actual path
if (!node) { return { error: "wrapper node not found" }; }

// 3. Destroy the stale subtree, re-instantiate under the same wrapper.
for (const k of (node.children || []).slice()) {
  try { k.destroy(); } catch (_e) { /**/ }
}
const created: any = scene.instantiatePrefab(prefab, node);
created.name = "<MeshName>Mesh";

// 3b. Guard against a doubled import scale. `created` is a prefab root, so it carries
// the GLB's m->cm import scale (local scale ≈ [100,100,100]). That is the ONE scale the
// mesh should have. If the wrapper `node` is ALSO a prefab root (a skeleton that put
// `_prefab` on the placement node instead of a plain wrapper), it carries a second
// ×100 and the mesh renders 100× oversize (world scale 10000). The wrapper must be a
// plain transform: if its OWN local scale is ~100, neutralize it to 1 so only `created`
// holds the import scale. Editor transforms assign via the `.scale` property (same
// accessor style as worldTransform.position/rotation), not a setter method.
try {
  const lt = node.localTransform;
  const s = lt.scale;
  // any wrapper axis ≥ 50 is the stray import ×100, never an intentional pose scale
  if (s && (Math.abs(s.x) >= 50 || Math.abs(s.y) >= 50 || Math.abs(s.z) >= 50)) {
    lt.scale = new vec3(1, 1, 1);
  }
} catch (_e) { /* wrapper already a plain transform, or scale API absent — the primary fix is the plain-wrapper skeleton */ }

// 4. Persist. The save lives on the PROJECT, not the model: `model.save()` does not exist,
// and one measured build spent ~35s grepping editor.d.ts to rediscover this one line.
model.project.save();
return { rebound: created.name };
```

After the re-bind, confirm with one runtime-bounds read (non-zero extents) or a capture — and report each re-bind in the mesh `STEP_RESULT` so the orchestrator and audit know the placed instances are live.

**Scope the re-bind from the skeleton step's placed-instance list, or from a fresh scene query at re-bind time — never from a directory listing.** A listing of the output folder answers a different question, and answers it too early: one measured build probed the folder before the proxy step had written it, read it as empty, and reported "no placed instances to re-bind" while ten instances sat orphaned.

The wrapper path comes from the skeleton payload's `created_roots` (parent object + local pose of every instance it created) — that hand-forward exists precisely so this repair is mechanical. If a wrapper is missing from the payload, that is a skeleton contract gap to report, not a license to guess.

**`bootstrap-scripts` (wire) now runs before this re-bind and may re-parent the skeleton's proxies under the authored hierarchy.** So treat `created_roots` as the pose hint, not the guaranteed current path: confirm each instance's **current** parent with a fresh scene query before re-instantiating, and re-parent under wherever it lives now. The pose still comes from the wrapper (it moved as a unit), so the repair stays mechanical — you just resolve the wrapper live instead of trusting a path recorded before wiring ran.
