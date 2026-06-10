<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Authoring Lens Studio packages

Producer-side workflows: bumping versions, attaching docs, exporting `.lsc` / `.lspkg`, and writing setup scripts. Read [`../SKILL.md`](../SKILL.md) first for the `.lsc` vs `.lspkg` distinction and the [Locate a package meta](../SKILL.md#locate-a-package-meta) primer — every snippet below assumes you can resolve a meta from a `SourcePath`.

## At a glance

| Task | Jump to |
|------|---------|
| Increment the version before re-exporting | [Bump version](#bump-version) |
| Write an updated `.lsc` back to disk | [Export as `.lsc`](#produce-lsc-script-custom-component) |
| Write an updated `.lspkg` back to disk | [Export as `.lspkg`](#produce-lspkg-folder-pack) |
| Configure consumer-facing unpack permissions | [`PackagePolicy` cheat sheet](#packagepolicy-cheat-sheet--what-goes-with-what) |
| Add a README or `.d.ts` to the component | [Attach docs](#attach-readme-and-dts-to-a-custom-component) |
| Write a setup script (auto-run on drop-in) | [Setup scripts](#setup-scripts) |

---

## Bump version

Two independent version fields exist on a script-based custom component — think of them as "package shown to consumers" vs "what the asset library's pull-update compares":

- `NativePackageDescriptor.version` — the **package-level** version. `exportPackage` bakes this into `.lspkg` headers.
- `ScriptAsset.version` — the **script's own** version. `exportScript` bakes this into `.lsc` headers and the asset library uses it to decide whether `canPullUpdate` / `canPushUpdate`.

Both are `Editor.Assets.Version` objects. **Mutating fields in place does not persist** — you must assign a fresh `new Editor.Assets.Version(...)` to trigger the setter, then `model.project.save()`.

```javascript
// Constructor: new Editor.Assets.Version(major, minor, patch, prerelease?)
desc.version = new Editor.Assets.Version(1, 2, 3, "");        // 1.2.3
desc.version = new Editor.Assets.Version(1, 2, 3, "rc.1");    // 1.2.3-rc.1
// Assigning a new object is the only way Lens Studio detects the change.
```

### Recipe — semver bumps that reset lower fields

```javascript
function bump(v, kind /* "major" | "minor" | "patch" */) {
  const { major: m, minor: n, patch: p, prerelease: pre } = v;
  if (kind === "major") return new Editor.Assets.Version(m + 1, 0, 0, pre);
  if (kind === "minor") return new Editor.Assets.Version(m, n + 1, 0, pre);
  return new Editor.Assets.Version(m, n, p + 1, pre);
}

// (see SKILL.md#locate-a-package-meta for the model/am/getFileMeta boilerplate)
// Requires package to be unpacked so the descriptor is reachable.
const desc = descMeta.primaryAsset as Editor.Assets.NativePackageDescriptor;
desc.version = bump(desc.version, "patch");     // e.g. 11.0.0 -> 11.0.1

// For script-based custom components, bump the script too
const scriptMeta = am.getFileMeta(new Editor.Model.SourcePath(
  new Editor.Path("UI Button.lsc").appended(new Editor.Path("UI Button")).appended(new Editor.Path("UI Button.js")),
  Editor.Model.SourceRootDirectory.Assets
));
if (!Editor.isNull(scriptMeta)) {
  const script = scriptMeta.primaryAsset as Editor.Assets.ScriptAsset;
  if (script.version) script.version = bump(script.version, "patch");
}

model.project.save();
```

### Gotchas
- Bump before re-exporting; otherwise consumers see the new archive as unchanged.
- `prerelease` is a plain string (`""`, `"alpha"`, `"rc.1"`). Reset it when going stable.
- `project.save()` persists into `.meta`; the archive on disk is only rewritten by `exportScript` / `exportPackage`.
- If both packed and unpacked copies exist, bump the descriptor at `Assets/<name>.<ext>/package.native` — that's the editable copy.

---

## Pack — two APIs, two extensions

| Goal | Use |
|------|-----|
| Rewrite a script custom component `.lsc` | `IPackageActions.exportScript(scriptAsset, absPath, ExportOptions)` |
| Rewrite a folder package `.lspkg` | `IPackageActions.exportPackage(descriptor, absPath, ExportOptions)` |
| Create a brand-new `.lspkg` from arbitrary assets | `AssetManager.createPackage(metas, destDir, name, PackageOption)` |

`exportScript` / `exportPackage` write to any absolute path you give them — that's how you export to arbitrary locations (e.g., the Desktop).

### `ExportOptions` — what you can configure

`new Editor.Model.ExportOptions()` starts with defaults. At runtime the following fields are writable (some are present at the C++ layer but not in `editor.d.ts`, yet still settable):

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `packagePolicy` | `Editor.Assets.PackagePolicy` | `CannotBeUnpacked` | Controls whether consumers can unpack the exported archive and whether its contents are visible (transparent) in the Packages panel. See policy table below. |
| `externalDependencies` | `ExternalPackageDependency[]` | `[]` | Dependencies to **exclude** from the exported archive (so consumers pull them separately from the asset library). Each entry is a `{fileMeta, includeInPackage, versionOverride}` struct. |
| `pluginsToInclude` | `Editor.Path[]` | `[]` | Absolute paths to Lens Studio plugin zip files to bundle alongside the package so consumers get plugin + package together. |
| `newExportUid` | `boolean` | `false` | When `true`, `exportScript`/`exportPackage` generates a fresh `exportId` UUID on the descriptor. Use this for a "fork" rather than an "update" — consumers will treat the result as a distinct package from the original. |
| `descriptor` | `AssetImportMetadata` | `null` | For script CCs: explicitly supply the descriptor whose metadata should travel with the exported `.lsc`. Normally inferred from `script.fileMeta.topmostNativePackageRoot`. |
| `externalDependenciesStructure` | `ExternalPackageDependencies` | `null` | Serialized into `package_dependencies.json` at export. Populate when a `.lspkg` depends on other asset-library packages. |

### `PackagePolicy` cheat sheet — what goes with what

| Value | Enum | UI label | Update? | Contents visible? | Typical target |
|-------|------|----------|---------|------------------|----------------|
| 0 | `CannotBeUnpacked` | "Cannot be updated or viewed" | No | No | Shipped CC that should stay sealed |
| 1 | `CanBeUnpacked` | "Can be updated and not viewed" | Yes | No | Editable CC (default for `.lsc`) |
| 2 | `CannotBeUnpackedTransparent` | "Cannot be updated but can be viewed" | No | Yes | Read-only folder package |
| 3 | `CanBeUnpackedTransparent` | "Can be updated and viewed" | Yes | Yes | Editable folder package (default for `.lspkg`) |
| 4 | `ShouldBeUnpacked` | "Should be unpacked" | Yes | Yes | Legacy; forces consumer to unpack on import |

`.lsc` typically uses non-transparent variants (`CanBeUnpacked` default, `CannotBeUnpacked` sealed); `.lspkg` typically uses transparent variants (`CanBeUnpackedTransparent` default, `CannotBeUnpackedTransparent` read-only). `.lsc` *can* use the transparent variants too, but it's uncommon.

### Produce `.lsc` (script custom component)

```javascript
const actions = pluginSystem.findInterface(Editor.IPackageActions.interfaceId);

// The ScriptAsset IS the component. Pick the unpacked copy via its file meta.
const scriptMeta = am.getFileMeta(new Editor.Model.SourcePath(
  new Editor.Path("UI Button.lsc").appended(new Editor.Path("UI Button")).appended(new Editor.Path("UI Button.js")),
  Editor.Model.SourceRootDirectory.Assets
));
const script = scriptMeta.primaryAsset as Editor.Assets.ScriptAsset;

const dest = model.project.projectDirectory
  .appended(new Editor.Path("Packages"))
  .appended(new Editor.Path("UI Button.lsc"));

const opts = new Editor.Model.ExportOptions();
opts.packagePolicy = Editor.Assets.PackagePolicy.CanBeUnpacked; // pick CannotBeUnpacked to ship sealed
// opts.newExportUid = true;                                    // forks instead of updates
actions.exportScript(script, dest, opts);
```

### Produce `.lspkg` (folder pack)

```javascript
const descMeta = am.getFileMeta(new Editor.Model.SourcePath(
  new Editor.Path("UI Button.lspkg").appended(new Editor.Path("package.native")),
  Editor.Model.SourceRootDirectory.Assets
));
const desc = descMeta.primaryAsset as Editor.Assets.NativePackageDescriptor;

const dest = model.project.projectDirectory
  .appended(new Editor.Path("Packages"))
  .appended(new Editor.Path("UI Button.lspkg"));

const opts = new Editor.Model.ExportOptions();
opts.packagePolicy = Editor.Assets.PackagePolicy.CanBeUnpackedTransparent; // or CannotBeUnpackedTransparent
actions.exportPackage(desc, dest, opts);
```

### Gotchas
- `exportScript` / `exportPackage` write the archive to disk. When you export **on top of** a package that's already imported under `Packages/`, Lens Studio re-indexes the new file and its `.meta` updates; when the destination is outside the project (e.g. the Desktop), the file has no `.meta` on disk, which is expected for hand-off.
- **`Cannot save project while an asset operation is in progress`** — thrown when `model.project.save()` runs before a pending `importExternalFileAsync` or pack/unpack has settled. The operation still succeeds; call `save()` again in a follow-up `ExecuteEditorCode` call, or split save/export into a separate call after the import chain.
- `AssetManager.createPackage(...)` returned `null` in testing when passed only the descriptor meta. Prefer `exportScript` / `exportPackage` unless you specifically need `createPackage`'s ability to bundle arbitrary assets into a new `.lspkg`.
- Large pack/export operations briefly block the MCP bridge while Lens Studio re-indexes. A short stall after the call is normal.

---

## Attach README and .d.ts to a custom component

**Always write the files inside the unpacked package folder (`Assets/<name>.<ext>/...`), not directly into `Assets/` root.** Other installed packages already have their own `README.md` at the root level; if you write yours there, Lens Studio auto-renames it to `README 2.md` and the subsequent `getFileMeta(SourcePath("README.md", Assets))` lookup returns null. Namespacing by package folder eliminates the collision and lets you rely on auto-import — no `importExternalFileAsync` needed.

A `ScriptAsset` surfaces two documentation slots in the Inspector:

- `script.readMe: MarkdownAsset` — appears on the component and in the asset library preview.
- `script.declarationFile: ScriptAsset` (really a `TypeScriptAsset`) — the `.d.ts` that gives consumers typings for the component's public API.

The `NativePackageDescriptor` also has its own `readMe` slot that's shown on the package itself. Usually you point script and descriptor at the **same** `.md`.

`MarkdownAsset` and script assets are NOT creatable via `AssetManager.createNativeAsset(...)` (it will reject them as "not NativeAsset"). Write the file to disk and let LS auto-import it.

```javascript
// 1) Write the files (can be empty) into Assets/<package>.lsc/ — NOT Assets/ root.
//    Use Bash, the Node fs module, or any editor — the files must be real on disk.
//    Auto-import picks them up; no importExternalFileAsync needed.

// 2) Grab the imported metas (path is the in-package folder)
const pkgFolder = new Editor.Path("UI Button.lsc");
const readmeMeta = am.getFileMeta(new Editor.Model.SourcePath(
  pkgFolder.appended(new Editor.Path("README.md")), Editor.Model.SourceRootDirectory.Assets
));
const dtsMeta = am.getFileMeta(new Editor.Model.SourcePath(
  pkgFolder.appended(new Editor.Path("UI Button.d.ts")), Editor.Model.SourceRootDirectory.Assets
));

// 3) Assign to both the script and the descriptor
const scriptMeta = am.getFileMeta(new Editor.Model.SourcePath(
  pkgFolder.appended(new Editor.Path("UI Button")).appended(new Editor.Path("UI Button.js")),
  Editor.Model.SourceRootDirectory.Assets
));
const script = scriptMeta.primaryAsset as Editor.Assets.ScriptAsset;
script.readMe = readmeMeta.primaryAsset as Editor.Assets.MarkdownAsset;
script.declarationFile = dtsMeta.primaryAsset as Editor.Assets.ScriptAsset;

const descMeta = am.getFileMeta(new Editor.Model.SourcePath(
  pkgFolder.appended(new Editor.Path("package.native")),
  Editor.Model.SourceRootDirectory.Assets
));
(descMeta.primaryAsset as Editor.Assets.NativePackageDescriptor).readMe =
  readmeMeta.primaryAsset as Editor.Assets.MarkdownAsset;

model.project.save();
```

If the source files live outside the project, `am.importExternalFileAsync(absSrc, destSourcePath)` with `destSourcePath` pointed at the package folder achieves the same result.

### File-type mapping

| File on disk | Imported type    | Goes into                                   |
|--------------|------------------|---------------------------------------------|
| `*.md`       | `MarkdownAsset`  | `script.readMe`, `descriptor.readMe`        |
| `*.d.ts`     | `TypeScriptAsset`| `script.declarationFile`                    |
| `*.js`       | `JavaScriptAsset`| the script itself (primary asset of `.lsc`) |

---

## Setup scripts

For the trigger path, instantiation defaults, and inspection patterns, see [`consuming.md`](consuming.md#setup-scripts-from-a-consumers-perspective). This section covers **authoring** only: where the code lives, the function shape, helpers exposed via `instantiator.getUtils()`, and quirks you'll hit while editing.

### Where the code lives

- **Inspector**: labeled **Setup File** on the package/component properties panel.
- **API**: `descriptor.setupScript.code` (a string, runtime-readonly).
- **`package.native` YAML**: a `SetupScript: code:` block.

The Inspector's "Choose file" button reads a `.js` file from disk and inlines its content as the `code` string — the field is always inline text at the data layer.

### Function shape

The string must **return a function**:

```javascript
return function instantiate(asset, scene, target, instantiator) { /* ... */ }
```

- `asset` — the asset being instantiated (a `ScriptAsset` or `NativePackageDescriptor`).
- `scene` — `model.project.scene`.
- `target` — the user-selected parent `SceneObject`, or `null` if dragged into empty scene.
- `instantiator` — provides helpers: `defaultInstantiate(asset, scene, target)`, `getAssetManager()`, `getScene()`, `getUtils()`.
- **Return**: a `SceneObject`, `Component`, or array of them. The runtime filters to things that pass `isOfType("Prefabable")`, so returning a stray non-Prefabable is ignored.

### `instantiator.getUtils()` surface

From the built-in Instantiator plugins (`<LensStudio.app>/Contents/JsPlugins/Instantiator-{ScriptAsset,AssetPackage}/utils/InstantiatorUtils.js` on macOS). The utils module is scoped to setup-script execution (no `import`s allowed inside a setup script — this is the workaround):

- `addToOrthoCamera(scene, sceneObject)` — parents under an orthographic camera (creates one if missing).
- `addToMainCamera(scene, sceneObject)` — parents under the main perspective camera.
- `getOrAddDeviceTracking(scene)` — ensures a `DeviceTracking` component is on main camera.
- `createScreenTransformObject(scene, target)` — creates a `SceneObject` with a `ScreenTransform`, parented under the ortho camera's screen region. Returns the `ScreenTransform` component.
- `getAssetUtils()` / `getHierarchyUtils()` — full `LensStudio:AssetUtils` / `LensStudio:HierarchyUtils` modules.

### Authoring the YAML

Setup-script code lives as plain text inside `package.native` (the descriptor YAML). On an **unpacked** package, edit `Assets/<name>.<ext>/package.native` directly. Skeleton:

```yaml
SetupScript:
  code: |
    return function instantiate(asset, scene, target, instantiator) {
      try {
        /* ... custom setup using instantiator.getUtils() helpers ... */
        return result;
      } catch (e) {
        console.error("setup failed:", e);
        return instantiator.defaultInstantiate(asset, scene, target);
      }
    };
```

For a full worked example (UI Button with ScreenTransform anchor/offset/constraint wiring), see [`setup-script-examples.md`](setup-script-examples.md#ui-button--screentransform-wiring).

After editing, `desc.setupScript.code` through the API reflects the new content immediately. But the in-memory descriptor that `exportScript` / `exportPackage` serializes **does not refresh in the same session** — close and reopen the project, then re-export, for the new setup script to make it into the exported archive.

### Observed quirks around authoring

- `SetupScript.code` is runtime read-only — `desc.setupScript.code = "..."` throws `Property is read-only`. You have to edit `package.native` directly.
- The `SetupScript` constructor is `@hidden`, so you can't swap in a new `SetupScript` instance via `desc.setupScript = new Editor.Assets.SetupScript()` either.
- Top-level code in the setup script runs once when the function is built (e.g. `const BUTTONSIZE = ...` is evaluated before the `return`). Use it for module-scoped constants and helpers.
- `import` statements are not allowed inside a setup script — that's why `instantiator.getUtils()` exists.

### Defensive pattern: fall back on error

Always wrap the body in `try/catch` and call `instantiator.defaultInstantiate(...)` on error so the user still gets *something* in the scene:

```javascript
return function instantiate(asset, scene, target, instantiator) {
  try {
    /* ... custom setup ... */
    return result;
  } catch (e) {
    console.error("setup failed:", e);
    return instantiator.defaultInstantiate(asset, scene, target);
  }
};
```
