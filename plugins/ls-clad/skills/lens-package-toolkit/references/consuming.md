<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Consuming Lens Studio packages

Consumer-side workflows: installing packages from the Asset Library, unpacking them to inspect or edit, observing what their setup scripts do, and pulling updates. Read [`../SKILL.md`](../SKILL.md) first for the `.lsc` vs `.lspkg` distinction and the [Locate a package meta](../SKILL.md#locate-a-package-meta) primer — everything below assumes you can resolve a meta from a `SourcePath`.

## At a glance

| Task | Jump to |
|------|---------|
| Install a package from the Asset Library | [Install](#install-from-the-asset-library) |
| Open a `.lsc` / `.lspkg` so assets become editable | [Unpack](#unpack) |
| Pull available Asset Library updates for installed packages | [Pull updates](#pull-updates) |
| Understand what runs when a package is dropped into the scene | [Setup scripts from a consumer's perspective](#setup-scripts-from-a-consumers-perspective) |
| Read the setup script of an existing package | [Reading an existing setup script](#reading-an-existing-setup-script) |
| Read source files (`.ts`/`.js`/textures/prefabs) inside a packed package without unpacking | [Reading files inside a packed package](#reading-files-inside-a-packed-package) |

---

## Install from the Asset Library

Use the `/ensure-package-installed <package_name>` slash command — it checks `ListInstalledPackagesTool`, searches via the `SearchLensStudioAssetLibrary` MCP tool, and runs `InstallLensStudioPackage` (which resolves dependencies automatically and fires the [setup script](#setup-scripts-from-a-consumers-perspective)).

---

## Unpack

**Only unpack when you need to edit a package's contents** (see [`../SKILL.md`](../SKILL.md) for the non-mutating read alternatives).

```javascript
const meta = am.getFileMeta(
  new Editor.Model.SourcePath(
    new Editor.Path("UI Button.lsc"),
    Editor.Model.SourceRootDirectory.Packages
  )
);
await am.unpack(meta);   // Promise<ImportResult>
```

After unpack: `Packages/<name>.<ext>` disappears and `Assets/<name>.<ext>/` appears as a regular folder (`package.native` descriptor + the original assets loose). Re-opening the project persists this.

**Locked packages fail.** If `meta.packagePolicy` is `CannotBeUnpacked` (0) or `CannotBeUnpackedTransparent` (2), unpack throws `"Cannot unpack locked package"`. The package must have been exported with either `ExportOptions.packagePolicy = Editor.Assets.PackagePolicy.CanBeUnpacked` (for a script custom component / `.lsc`) or `ExportOptions.packagePolicy = Editor.Assets.PackagePolicy.CanBeUnpackedTransparent` (for a folder package / `.lspkg`). You cannot unlock on the consumer side.

**`ShouldBeUnpacked` (4) auto-unpacks at import.** Calling `am.unpack(meta)` on the `Packages/<name>.<ext>` archive of a policy-4 package throws `"Only packed packages can be unpacked, please provide the package root meta"` even though `meta.isPackageRoot === true` — Lens Studio has already extracted the contents to `Assets/<descriptor.packageName>.<ext>/` on install, and the file in `Packages/` is just a stub.

---

## Pull updates

For both task-level and focused consumer-side updates, use the canonical
[`update-lens-packages`](../../update-lens-packages/SKILL.md) flow. Its path-backed
`pull-package-updates.ts` action accepts either selected JSON `packageNames` or
`updateAll: true`, snapshots live descriptors before it calls `pullUpdate`, and re-finds those
descriptors instead of taking native entities as inputs. Pass those values as structured runtime
`args`; do not restore a placeholder-based EEC body here.

`pullUpdate` is synchronous/blocking but may take time while package assets are downloaded and
updated, so invoke the canonical pull action with a longer `ExecuteEditorCode` timeout (typically
`timeoutMs: 300000`). Re-list packages through its canonical listing action after it returns and
report old/new versions. Do not add task-manager waits or polling for `pullUpdate` itself. If a
package is reported in `unavailable`, it is already current for the available Asset Library
candidate, or a specific version must be selected through the canonical Asset Library flow.

---

## Setup scripts from a consumer's perspective

A **setup script** is a small JS snippet stored inside a package's descriptor that Lens Studio runs every time the package gets instantiated — when a user drags the custom component into a scene, clicks its Asset Library "Install" button, or code calls `assetManager.instantiate([asset])`. It's how producers ship components that "just work" on drop-in (UI Button lands pre-wired with a ScreenTransform, Bitmoji Player Package auto-creates its full player hierarchy, Face Swap builds its orthographic camera render stack).

For the producer side of this — writing the YAML, helpers, quirks — see [`authoring.md`](authoring.md#setup-scripts).

### Trigger path

```
assetManager.instantiate([asset])
   └─ Lens Studio dispatches to a registered AssetInstantiator:
        · ScriptInstantiator   for JavaScriptAsset / TypeScriptAsset  → reads asset.fileMeta.topmostNativePackageRoot.nativePackageDescriptor
        · PackageInstantiator  for NativePackageDescriptor            → uses the descriptor directly
   └─ if descriptor.setupScript.code.length > 0:
        const fn = createFunctionObject(code, "defaultAssetInstantiatorFunc")
        result = fn(asset, scene, target, instantiator)
   └─ otherwise: instantiator.defaultInstantiate(asset, scene, target)
```

### Default behavior — no setup script

When a package ships with an empty `setupScript.code` (or no descriptor reachable), `am.instantiate` falls back to the instantiator's `defaultInstantiate`. The behavior depends on which instantiator is handling the asset:

**Script custom component (`.lsc`, primary asset is `JavaScriptAsset` / `TypeScriptAsset`) → `ScriptInstantiator.defaultInstantiate`:**

Creates a new `SceneObject` named after the asset at scene root (unless `target` is supplied), attaches a `ScriptComponent`, sets its `scriptAsset`, and returns the component. No screen transform, no hierarchy wiring — the component lands "bare" and inputs stay at their defaults. (Full source: `<LensStudio.app>/Contents/JsPlugins/Instantiator-ScriptAsset/main.js`.)

**Folder package (`.lspkg`, primary asset is `NativePackageDescriptor`) → `PackageInstantiator.defaultInstantiate`:**

Returns `null`. Instead, the PackageInstantiator's main `instantiate` method scans the package folder for `.prefab` files whose names follow a `Name__PREFIX.prefab` convention, instantiates each, and parents them based on the prefix:

| Filename suffix | Behavior |
|-----------------|----------|
| `*__ADD_TO_SCENE.prefab`, `*__OBJECTS_PANEL.prefab` | Instantiated at scene root (no reparenting) |
| `*__ADD_TO_MAIN_CAM.prefab`, `*__CAMERA.prefab` | Parented under the main camera `SceneObject` (creates the camera if missing) |
| `*__PLACE_IN_ORTHO_CAM.prefab`, `*__ORTHO.prefab` | Parented under the ortho camera's screen region (creates the ortho hierarchy if missing) |
| Anything without a recognized `__PREFIX` | Ignored |

Prefab name before the `__` becomes the resulting `SceneObject`'s name. A package with zero prefabs and no setup script instantiates to an empty array — nothing visible happens, the asset is just registered.

Write a setup script only when neither default fits — e.g. building scene hierarchy programmatically, configuring `ScreenTransform` anchors, or reading external state to pick what to instantiate.

### Triggering the setup script

```javascript
const result = await am.instantiate([asset]);   // asset = ScriptAsset or NativePackageDescriptor
// result is Editor.Model.Prefabable[] — typically a SceneObject
```

`InstallLensStudioPackage` also runs the setup script at install time — that's why Bitmoji Player Package auto-instantiates its full hierarchy after install, while a `ScriptAsset`-based component (like UI Button) only fires its setup script the first time you drag it into the scene or call `am.instantiate`.

### Reading an existing setup script

Use `meta.nativePackageDescriptor` (packed shortcut) or `descMeta.primaryAsset` (unpacked). The shortcut works even on sealed packages (`packagePolicy === 0`) — the read is metadata-only. **Caveat:** it returns `undefined` for `packagePolicy === 4` (`ShouldBeUnpacked`) — use the unpacked path instead.

```javascript
// (a) Packed — shortcut (works for policy 0–3)
const desc = (meta as any).nativePackageDescriptor as Editor.Assets.NativePackageDescriptor;
console.log(desc.setupScript.code);

// (b) Unpacked — use when (a) returns undefined (policy-4) or you need to edit the descriptor
// (standard SKILL.md#locate-a-package-meta unpacked pattern, plus:)
console.log(desc.setupScript.code);
```

Pattern (a) is the right default; fall back to (b) for policy-4 packages or when editing.

---

## Reading files inside a packed package

Start with `ListInstalledPackagesTool` using `includeDetails: true`. Record the
matched package version, then read its complete README and the focused documents
it links under `Docs/`. These version-aligned docs are authoritative for
imports, public APIs, lifecycle, setup, examples, and workarounds. A skill may
help select or install the package but must not override those details.

At the Editor API level, the same README is available through
`descriptor.readMe`, while public typings may be attached through
`script.declarationFile`. Fall back to reading raw source from the cache only
when the installed README and `.d.ts` omit something needed for the current
task. Report the package documentation gap so the durable fix lands with the
package version rather than in a skill.

Both fields are `Asset` references with no in-memory text accessor — resolve them through `cacheFile` and read with filesystem tools:

```javascript
const desc = (meta as any).nativePackageDescriptor as Editor.Assets.NativePackageDescriptor;
const script = meta.primaryAsset as Editor.Assets.ScriptAsset;  // for .lsc
const readMe = desc.readMe, dts = script.declarationFile;       // either may be null
const cacheDir = String(model.project.cacheDirectory);
if (readMe && !Editor.isNull(readMe)) {
  const path = `${cacheDir}/${String(readMe.cacheFile)}`;       // read with fs
}
```

Most Asset-Library packages ship a populated `readMe` (MarkdownAsset) but leave `declarationFile` empty — always null-check.

Each packed `.lsc` / `.lspkg` extracts its contents to `<projectDir>/Cache/<package-meta-uuid>/<source-hash>/Data/<inner-path>`. The `<package-meta-uuid>` is the UUID in the header of the package's `.meta` file (`!<AssetImportMetadata/...>`). Read those files directly with filesystem tools — `am.unpack` is not required.

```
# Example: InteractionKit.lspkg.meta header is !<AssetImportMetadata/bb4fe907-…>
<projectDir>/Cache/bb4fe907-26eb-4874-99fe-f1551378d7fc/<source-hash>/Data/
```

To discover the inner tree programmatically, walk `rootMeta.getNativePackageItems(Editor.Model.AssetImportMetadata.PackageIterate.Deep)` — each item's `sourcePath` resolves to a file under `Cache/` (strip the leading `../`).

`Cache/` is gitignored and owned by Lens Studio; treat it as read-only and edit via `am.unpack` instead.
