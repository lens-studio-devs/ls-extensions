<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Recreate Outdated Package Prefab Instances

After a package update — typically SIK 0.13 → 0.18, or similar major version bumps —
some scripts inside the package detect a structural mismatch between the package's
current expected prefab layout and the version that was serialized into the user's
`.scene`/`.prefab` files when they originally dropped the package prefab in. The package
surfaces this at runtime as:

```
Error: <ComponentName>: Outdated <ComponentName> SceneObject detected. Please click on
the <PrefabName> SceneObject in the Scene Hierarchy, then click Revert in the Inspector
Panel.
```

The most common variant is SIK's HandVisual check (`HandVisual: Outdated HandVisual
SceneObject detected...`), but the same pattern can appear from any package that
versions its prefab layout. The runtime message tells the user to use the Inspector's
**Revert** button, but that action is **not exposed via the Editor MCP API**. To fix it
programmatically, you delete the outdated SceneObject and re-instantiate a fresh copy
from the source prefab asset.

This is a non-destructive operation **only when the SceneObject has no user-attached
content under it**. For system prefabs like SIK that the user typically does not modify,
this is safe. Verify before acting.

## Detection

After launching the preview and collecting logs, search for:

```
grep -nE "Outdated [A-Za-z]+ SceneObject detected" "<runtime-log>"
```

The message mentions both the prefab name (the one to find in the scene) and the
SceneObject in the Scene Hierarchy that needs to be reverted. Extract both.

## Procedure

### 1. Locate the SceneObject in the scene

Use the scene-graphql tool's `allSceneObjects` query (or filter on `nameContains` if the
schema supports it) to find the SceneObject by name. The query response can be huge —
write it to a file first and grep, rather than parsing inline:

```graphql
# via scene-graphql:
query {
  allSceneObjects {
    id
    name
  }
}
```

Find the SceneObject whose name matches the prefab name from the error. Capture its
`id` (a UUID string).

### 2. Verify it has no user-attached content

Before deleting, walk the SceneObject's hierarchy and confirm there's nothing the user
has authored beyond the standard package layout. Use `ExecuteEditorCode`:

```typescript
const model = pluginSystem.findInterface(Editor.Model.IModel.interfaceId) as Editor.Model.IModel;
const scene: any = (model.project as any).scene;

function findById(obj: any, id: string): any {
  if (!obj) return null;
  if (obj.id && obj.id.toString() === id) return obj;
  for (const c of (obj.children || [])) {
    const r = findById(c, id);
    if (r) return r;
  }
  return null;
}

let target: any = null;
for (const r of scene.rootSceneObjects) {
  target = findById(r, "<sceneObjectId>");
  if (target) break;
}
if (!target) return { error: "not found" };

function summarize(o: any, depth = 0): any {
  return {
    name: o.name,
    components: (o.components || []).map((c: any) => c.getTypeName ? c.getTypeName() : "?"),
    children: depth < 3 ? (o.children || []).map((c: any) => summarize(c, depth + 1)) : [],
  };
}

return summarize(target);
```

Compare the resulting tree against the package's source prefab (e.g., for SIK look at
`Assets/SpectaclesInteractionKit.lspkg/Prefabs/SpectaclesInteractionKit.prefab`).
The standard SIK layout looks like:

- `[REQUIRED] Core/` → `Configuration`, `LeftHandInteractor`, `RightHandInteractor`,
  `MouseInteractor`, `MobileInteractor`
- `[OPTIONAL] Visuals/` → `HandVisuals/{LeftHandVisual, RightHandVisual}`,
  `InteractorCursors`, `[LEGACY] InteractorLineVisual/InteractorLineVisual`

If the user has added their own children or extra components beyond this, **stop and ask
the user**. They may want to preserve those before the recreate. If the layout matches
the package's stock prefab, proceed.

### 3. Find the source prefab asset

```typescript
const model = pluginSystem.findInterface(Editor.Model.IModel.interfaceId) as Editor.Model.IModel;
const matches: any[] = [];
for (const a of (model.project.assetManager as any).assets) {
  const t = a.getTypeName ? a.getTypeName() : null;
  if (t === "ObjectPrefab" && (a.name || "").includes("<PrefabName>")) {
    matches.push({ id: a.id?.toString(), name: a.name });
  }
}
return matches;
```

Prefab assets are typed `"ObjectPrefab"` in the asset manager (not `"Prefab"`). Capture
the matching asset's `id`.

### 4. Capture parent and ordering

Record the deleted SceneObject's parent (or note "root" for top-level), and its index
among the parent's children — these matter if you want the re-instantiated copy to
land in the same place. For root-level SIK SceneObjects, parent is null.

### 5. Delete + re-instantiate

```graphql
mutation {
  deleteSceneObject(id: "<oldSceneObjectId>") {
    success
  }
}
```

```graphql
mutation {
  instantiatePrefab(
    prefabId: "<prefabAssetId>"
    name: "<originalName>"
    # parentId: "<parentId>"  # omit for root-level
  ) {
    success
    id
  }
}
```

The `id` returned by `instantiatePrefab` is the new SceneObject's UUID. **It will be
different from the deleted one** — anything in your project that referenced the old
SceneObject id (most commonly `@input SceneObject` references from other scripts) will
now point to nothing.

### 6. Persist

The mutations update the in-memory scene model, not disk. Save before the user
restarts the preview or closes the editor:

```typescript
const model = pluginSystem.findInterface(Editor.Model.IModel.interfaceId) as Editor.Model.IModel;
await (model.project as any).save();
return { saved: true };
```

### 7. Verify

After saving, the project's `.scene` file should reference the new SceneObject id and
no longer reference the old one:

```bash
grep -c "<oldSceneObjectId>" Assets/Generated/Scene.scene  # expect 0
grep -c "<newSceneObjectId>" Assets/Generated/Scene.scene  # expect >= 1
```

Then re-run the preview and confirm the `Outdated <X> SceneObject detected` error is
gone.

## Caveat: broken `@input SceneObject` references

The new SceneObject has a fresh UUID. If any other ScriptComponent had an `@input
SceneObject` whose serialized value pointed into the deleted hierarchy (the root, or any
of its children), that input is now broken — Lens Studio will load it as `null` and the
runtime may produce additional `Input <name> was not provided` errors.

Detect by collecting logs after the recreate and checking for new orphan-input errors
(see `orphan-script-inputs.md`). For each:

- If the input was wired to the deleted SceneObject's root → the user must re-wire it
  in the Inspector to the new SceneObject. Cannot be done programmatically without
  knowing intent.
- If the input was wired to a child (e.g. a specific HandVisual) → same answer.

Surface the list to the user with the new SceneObject's id so they can re-wire quickly.
This caveat is the same one Inspector "Revert" introduces — it's not an artifact of the
delete-and-recreate workaround, just the natural cost of regenerating prefab IDs.

## When to fall back to manual Revert

If the SceneObject has user-authored content under it that you cannot programmatically
distinguish from the package's stock layout, stop and tell the user to use the
Inspector's Revert button manually. You can select the SceneObject for them with
`SetLensStudioSelection({ ids: ["<sceneObjectId>"], mode: "set" })` so they only need
to click once.
