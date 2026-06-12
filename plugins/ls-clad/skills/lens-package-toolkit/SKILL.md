---
name: lens-package-toolkit
description: "Lens Studio native packages: install from Asset Library, pack/unpack `.lsc`/`.lspkg`, bump versions, attach README/`.d.ts`, author setup scripts. APIs `NativePackageDescriptor`, `exportScript`/`exportPackage`, `unpack`, `instantiate`, `SetupScript`."
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Lens Studio Package Toolkit

Lens Studio ships reusable functionality as **native packages**. Two flavors coexist:

| Extension | Shape on disk | Primary asset | Created by |
|-----------|---------------|---------------|------------|
| `.lsc` | Single archive file, `Packages/Foo.lsc` | `ScriptAsset` (the script IS the component) | `IPackageActions.exportScript(script, path, opts)` |
| `.lspkg` | Single archive file, `Packages/Foo.lspkg` | `NativePackageDescriptor` (`package.native`) | `IPackageActions.exportPackage(descriptor, path, opts)` or `AssetManager.createPackage(...)` |

After install, an archive sits in `Packages/<name>.<ext>`. Most archives stay packed there; an archive becomes an editable folder under `Assets/<name>.<ext>/` only when the consumer calls `AssetManager.unpack(meta)` (see the [primer](#locate-a-package-meta) below for how to obtain `assetManager` and `meta`), or — for legacy packages exported with `packagePolicy === ShouldBeUnpacked` (4) — automatically at import time. **Only unpack when you need to edit a package's contents.** To just read source files (e.g. when `FileReadTool` refuses with *"sealed package"*), use the cache-read pattern in [`consuming.md`](references/consuming.md#reading-files-inside-a-packed-package) — it's non-mutating. Don't assume an Asset-Library install lands an unpacked copy in `Assets/`; check first via `getFileMeta`.

## Pick the right reference

| If your task is… | Load |
|------------------|------|
| Installing a package, unpacking it to inspect, observing its setup script, or pulling an update from the Asset Library | [`references/consuming.md`](references/consuming.md) |
| Reading source files (`.ts`/`.js`/textures/prefabs) inside an installed `.lsc`/`.lspkg` without unpacking | [`references/consuming.md`](references/consuming.md#reading-files-inside-a-packed-package) |
| Authoring a package — bumping versions, attaching README / `.d.ts`, exporting `.lsc` / `.lspkg`, writing setup scripts | [`references/authoring.md`](references/authoring.md) |

---

## Locate a package meta

Everything else starts here. A **meta** (`Editor.Model.AssetImportMetadata`) wraps a file on disk with its primary asset + package info.

```javascript
const model = pluginSystem.findInterface(Editor.Model.IModel.interfaceId);
const am = model.project.assetManager;

// Packages/ root — where imported .lsc / .lspkg live
const packedSP = new Editor.Model.SourcePath(
  new Editor.Path("UI Button.lsc"),   // or "Foo.lspkg"
  Editor.Model.SourceRootDirectory.Packages
);
const meta = am.getFileMeta(packedSP);
// Interpret:
//   meta.primaryAsset.getTypeName() === "JavaScriptAsset"
//     OR                              "TypeScriptAsset"           => .lsc script component
//   meta.primaryAsset.getTypeName() === "NativePackageDescriptor" => .lspkg folder package
//   (use `meta.primaryAsset.isOfType("ScriptAsset")` to cover both .lsc subclasses)
//   meta.packagePolicy: 0 CannotBeUnpacked, 1 CanBeUnpacked, 2 CannotBeUnpackedTransparent, 3 CanBeUnpackedTransparent, 4 ShouldBeUnpacked
//   meta.isPackageRoot: true for package archives
```

When the package is **unpacked**, the descriptor lives at `Assets/<name>.<ext>/package.native`:

```javascript
const descSP = new Editor.Model.SourcePath(
  new Editor.Path("UI Button.lsc").appended(new Editor.Path("package.native")),
  Editor.Model.SourceRootDirectory.Assets
);
const descMeta = am.getFileMeta(descSP);
const desc = descMeta.primaryAsset as Editor.Assets.NativePackageDescriptor;
// desc.packageName, desc.version, desc.readMe, desc.tags, desc.attachments, desc.setupScript, desc.icon
```

**Disambiguation trick.** If two copies are loaded (e.g. the exported `.lsc` in `Packages/` AND an unpacked folder in `Assets/`), `am.assets` will list duplicates. Always use `getFileMeta(SourcePath(..., root))` to pick the specific one you want to edit. `am.assets.find(a => a.name === ...)` can return the wrong one.

---

## Reference — relevant editor.d.ts surfaces

- `Editor.Model.AssetManager.getFileMeta`, `.unpack`, `.createPackage`, `.importExternalFileAsync`, `.createNativeAsset` (not for md/script)
- `Editor.Model.AssetImportMetadata` — `primaryAsset`, `sourcePath`, `assetTreePath`, `isPackageRoot`, `packagePolicy`, `getNativePackageItems`
- `Editor.IPackageActions.exportScript`, `.exportPackage`, `.exportAsZip`
- `Editor.IPackageRegistry.canPullUpdate`, `.pullUpdate`, `.pushUpdate`, `.packageMetadata` (for task-level package updates, use the [`update-lens-packages`](../update-lens-packages/SKILL.md) skill)
- `Editor.Assets.NativePackageDescriptor` — `version`, `readMe`, `setupScript`, `tags`, `icon`, `attachments`, `description`, `packageName`
- `Editor.Assets.ScriptAsset` — `version`, `readMe`, `declarationFile`, `attachments`
- `Editor.Assets.JavaScriptAsset` / `Editor.Assets.TypeScriptAsset` (subclasses of `ScriptAsset`) — additionally expose `scriptInputInfo`
- `Editor.Assets.Version(major, minor, patch, prerelease?)`
- `Editor.Model.ExportOptions` — `packagePolicy`, `externalDependencies`, `pluginsToInclude`
- `Editor.Assets.PackagePolicy` — `CannotBeUnpacked` (0), `CanBeUnpacked` (1), `CannotBeUnpackedTransparent` (2), `CanBeUnpackedTransparent` (3), `ShouldBeUnpacked` (4)
- `Editor.Model.SourceRootDirectory` — `Assets` (0), `Packages` (1)
