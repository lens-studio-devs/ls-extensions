<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Side-by-side comparison prefabs

When the user wants to visually compare before/after, don't overwrite the original. Produce a variant:

1. Copy `<Prefab>.prefab` and `<Prefab>.prefab.meta` to `<Prefab>Merged.prefab` and its `.meta`.
2. In the copied `.prefab`, regenerate the root `!<ObjectPrefab/UUID>` on line 1 with a fresh UUID.
3. In the copied `.prefab.meta`, regenerate three UUIDs: the `AssetImportMetadata/UUID` header, the `ImportedAssetIds`/`PrimaryAsset` references (one shared UUID, matching the new prefab UUID in step 2), and the `AssetDataMap`/`!<own>` entry.
4. Internal SceneObject/RMV UUIDs inside the copied prefab stay as-is — they're unique within a file and don't collide with the original because prefabs are loaded in isolation.
5. Apply your merge/simplify mutations to the **copy**, not the original.
6. After the file changes land on disk, ask the user to reload the Lens Studio project so the asset manager picks up the new prefab file.

For a three-way compare (original / merged / merged+simplified), repeat the copy step for the simplified variant and swap the `Mesh:` references in the copy's YAML from the original merged FileMesh to the simplified FileMesh (a simple `sed` works — these are leaf references with no cross-dependencies).
