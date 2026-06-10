<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Asset Operations (Editor API)

All snippets assume `model = pluginSystem.findInterface(Editor.Model.IModel); assetManager = model.project.assetManager`.

## Lookup

For simple name/type/path queries, prefer `asset-graphql.assetsByName` / `assetsByType` over an EEC scan. For bulk filtering, use `assetManager.assets.filter(...)`. UUIDs always lowercase via `.toString().toLowerCase()`. Compare assets with `asset.isSame(other)`, never `===`.

For path-keyed lookups, use `assetManager.getFileMeta`:

```ts
const path = new Editor.Model.SourcePath(
    new Editor.Path('MyMaterial.mat'),
    Editor.Model.SourceRootDirectory.Assets,
);
const material = assetManager.getFileMeta(path).assets[0];
```

## Create

`assetManager.createNativeAsset(typeName, name, folder: SourcePath)` — see JSDoc.

For PBR / Unlit / SimplePBR materials, **do not** use `createNativeAsset('Material', ...)` — it yields `passInfos.length === 0`. Use `asset-graphql.createAssetFromPreset('SimplePBRMaterialPreset', name, destPath)` instead, then `materials` for properties.

## Rename / Move / Delete

See JSDoc on `assetManager.rename`, `.move`, `.remove`. `move` destination is a **folder**, not a file path.

## Packed package filter

`assetManager.assets` includes internal items of packed `.lspkg` packages. To list only top-level assets, filter on `fileMeta.isPackedPackageItem`:

```ts
const top = assetManager.assets.filter(a => {
  const fm = a.fileMeta;
  if (!fm?.isPackedPackageItem) return true;
  const rootPrimary = fm?.nativePackageRoot?.primaryAsset;
  return rootPrimary ? a.isSame(rootPrimary) : false;
});
```

## Project & Asset Paths — Quick Reference

| What you want                       | Read it from                              | Note                                                                                               |
| ----------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Absolute path of the `.esproj` file | `model.project.projectFile`               | `Editor.Path`. Stringify via `String(...)` or `.toString()`. **There is no `model.project.path`.** |
| Project root on disk                | `model.project.projectDirectory`          | `Editor.Path`                                                                                      |
| Project's `Assets/` directory       | `model.project.assetsDirectory`           | `Editor.Path`                                                                                      |
| Cache directory                     | `model.project.cacheDirectory`            | `Editor.Path`                                                                                      |
| Asset path inside the project       | `asset.fileMeta.assetTreePath.toString()` | Returns e.g. `Assets/Materials/Foo.mat`                                                            |

## Saving

See `./project-operations.md` (or call the `SaveProject` MCP tool directly).
