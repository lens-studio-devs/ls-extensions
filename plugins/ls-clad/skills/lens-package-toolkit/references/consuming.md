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
| Reconcile mismatched dependency versions across installed packages | [Sync versions](#sync-versions) |
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

## Sync versions

When several installed packages declare the same dependency at different versions, `IPackageRegistry.syncVersions()` reconciles them by upgrading/downgrading packages to a consistent set. This mirrors the **Sync Version** button in the Package Manager (under the installed-dependencies list).

```javascript
const registry = pluginSystem.findInterface(
  Editor.IPackageRegistry.interfaceId
) as any;   // `syncVersions` is not yet declared on IPackageRegistry in the shipped editor.d.ts; drop the cast once it lands
registry.syncVersions();
```

**What it does** (verified empirically — starting state SIK 0.9.0 + UIKit 0.1.4):

- **Upgrades or downgrades** an installed package to whatever version the dependency graph deems consistent — direction depends on what other installed packages require (UIKit 0.1.4 → 0.1.7 in this example, but a downgrade is possible when a dependent pins an older version).
- **Adds the pinned dependency** if missing (UIKit 0.1.7's manifest required SIK 0.17.3 → that version was installed alongside).
- **Does not remove** the prior copies — SIK 0.9.0 remained loaded next to the new SIK 0.17.3. Cleanup of stale versions is the caller's responsibility.

**Currently scoped to Asset-Library packages.** Reconciliation only fires for packages whose dependency graph is declared via a `package_dependencies.json` shipped in the Asset Library resource description. Local-library packages will be supported in a future Lens Studio release; until then the call is a no-op for them — and likewise a no-op for resources predating the manifest (e.g. SIK 0.18.x + UIKit 0.1.7 already match what UIKit 0.1.7's manifest expects, so `syncVersions()` returned in ~1ms without changing the installed set).

Run it after installing a package that pulls in shared dependencies (e.g. SpectaclesUIKit, which depends on SpectaclesInteractionKit) to align the dependency to the version UIKit was shipped against. Safe to call defensively — it returns silently when nothing needs syncing.

> **Updating libraries?** For the task-level "update my packages" workflow — per-package `pullUpdate` with a version-pinning alternative — use the [`update-lens-packages`](../../update-lens-packages/SKILL.md) skill.

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

Start with the package's README (`descriptor.readMe`) and `.d.ts` (`script.declarationFile`) — those are what the author chose to surface and usually cover the public API. Fall back to reading raw source from the cache only when you need internals the README/`.d.ts` don't expose (tracing a specific function, debugging behavior, etc.).

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
# Example: SpectaclesInteractionKit.lspkg.meta header is !<AssetImportMetadata/bb4fe907-…>
<projectDir>/Cache/bb4fe907-26eb-4874-99fe-f1551378d7fc/<source-hash>/Data/
```

To discover the inner tree programmatically, walk `rootMeta.getNativePackageItems(Editor.Model.AssetImportMetadata.PackageIterate.Deep)` — each item's `sourcePath` resolves to a file under `Cache/` (strip the leading `../`).

`Cache/` is gitignored and owned by Lens Studio; treat it as read-only and edit via `am.unpack` instead.
