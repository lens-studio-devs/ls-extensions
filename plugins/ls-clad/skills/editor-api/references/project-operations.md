<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Project Operations (Editor API)

All snippets assume the `IModel` entry point (`model = pluginSystem.findInterface(Editor.Model.IModel); project = model.project`).

Project-level lifecycle: open, save, export, Lens metadata, publishing. For asset-level work see `./asset-operations.md`; scene work see `./scene-object-operations.md`.

## Project Paths — Quick Reference

See the canonical path table in `./asset-operations.md` (§ "Project & Asset Paths — Quick Reference"). The `model.` prefix is required from this context (`model.project.projectFile`, etc.). There is no `project.path` — use `projectFile` or `projectDirectory`.

| What you want   | Read it from              | Note                                          |
| --------------- | ------------------------- | --------------------------------------------- |
| Target platform | `project.targetPlatform`  | `Editor.TargetPlatform` enum — `Snapchat` or `Spectacles` |

## Open / Save

```ts
const model = pluginSystem.findInterface(Editor.Model.IModel);
model.openProject(new Editor.Path('/absolute/path/to/MyProject.esproj'));
```

`openProject` takes an `Editor.Path` (not a raw string — string args coerce silently). Related `IModel` entry points: `setDefaultProject()`, `setEmptyProject()`, and signals `onProjectAboutToBeChanged` / `onProjectChanged` / `onProjectLocationChanged` / `onProjectSaving` / `onMetaInfoChanged`.

See JSDoc on `project.save` (synchronous, returns `void`) and `project.saveTo` (save-as, retargets the tracked location). For a plain "save the project" request, call the `SaveProject` MCP tool directly rather than spawning EEC.

## Export (zip / package / script)

`Editor.IPackageActions` exposes the three export entry points:

```ts
const pkgActions = pluginSystem.findInterface(Editor.IPackageActions);
const opts = new Editor.Model.ExportOptions();
// opts.packagePolicy = Editor.Assets.PackagePolicy.<...>;
// opts.externalDependencies = [...];
// opts.pluginsToInclude = [new Editor.Path('/abs/plugin/path'), ...];

pkgActions.exportAsZip(new Editor.Path('/abs/out/MyProject.zip'), opts, /*includeCache*/ false);
pkgActions.exportPackage(descriptor, new Editor.Path('/abs/out/MyPackage.lspkg'), opts);
pkgActions.exportScript(scriptAsset, new Editor.Path('/abs/out/MyScript.lsc'), opts);
```

`ExportOptions` fields: `packagePolicy` (`Editor.Assets.PackagePolicy`), `externalDependencies` (declare external package deps), `pluginsToInclude` (`Editor.Path[]`).

> For `.lsc` / `.lspkg` packaging workflows, prefer the `lens-package-toolkit` skill — it covers `NativePackageDescriptor`, setup scripts, and unpack/instantiate hooks.

## Lens Metadata

Metadata lives on `project.metaInfo` (`Editor.Model.MetaInfo`). See JSDoc for `setIcon` (external path, copies in), `setVideoPreview`, `isLensNameValid`, etc.

Properties commonly set:

- `lensName` (string — call `MetaInfo.isLensNameValid(name)` first)
- `lensApplicability: LensApplicability[]` (Front / Back)
- `lensClientCompatibilities: LensClientCompatibility[]` (Mobile / Spectacles)
- `activationCamera: LensActivationCamera`
- `project.targetPlatform = Editor.TargetPlatform.Spectacles` (or `.Snapchat`)

## Publishing

No Editor API publish call. Submit Snapchat Lenses via the My Lenses portal; Specs Lenses via the `ls-clad:specs-publish` skill.

## Gotchas (not covered by JSDoc)

- **`isLensNameValid` pre-check**: call before assigning `metaInfo.lensName` — invalid names silently fail or throw depending on context.
