---
name: update-lens-packages
description: Update outdated packages/libraries (SIK, UIKit, SSK, SyncKit) in a Lens Studio project via the Editor API. Use for 'update my packages', 'upgrade SIK', 'update dependencies', 'pull latest SIK', or any package update ask. Requires Lens Studio MCP.
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Update Lens Studio Packages

Updates installed packages in a Lens Studio project to the latest available versions by default, via per-package `pullUpdate(desc)`, with version-pinning via `selectVersionFromAssetLibrary` when a specific version is needed — all executed through `ExecuteEditorCode`.

## Background

Lens Studio projects use `.lspkg` packages for libraries like SpectaclesInteractionKit (SIK), SpectaclesUIKit (UIKit), and SpectaclesSyncKit (SSK). These packages are managed through the `Editor.IPackageRegistry` interface, which provides methods to check for and apply updates.

> **Scope:** this skill is the task-level entry point for *updating* installed libraries. For the broader package toolkit — installing, unpacking, inspecting internals, and authoring `.lsc`/`.lspkg` packages — see [`lens-package-toolkit`](../lens-package-toolkit/SKILL.md).

There are two update mechanisms:

1. **Pull Update** (default) — Updates a package to the most recent version available in the Asset Library.

2. **Version Selection from Asset Library** — Searches the remote Asset Library for package versions and selects a specific version. Use this when the user requests a specific version.

## Workflow

### Step 1: List installed packages and check for updates

Run this code via `ExecuteEditorCode` to discover all installed packages and their update status:

```typescript
const registry = pluginSystem.findInterface(Editor.IPackageRegistry.interfaceId) as Editor.IPackageRegistry;
const model = pluginSystem.findInterface(Editor.Model.IModel.interfaceId) as Editor.Model.IModel;
const allAssets = model.project.assetManager.assets;

const packages: {name: string, version: string, canPullUpdate: boolean}[] = [];
for (const asset of allAssets) {
  if (asset.getTypeName() === "NativePackageDescriptor") {
    const desc = asset as Editor.Assets.NativePackageDescriptor;
    packages.push({
      name: desc.packageName,
      version: desc.version
        ? `${desc.version.major}.${desc.version.minor}.${desc.version.patch}`
        : "(none)",
      canPullUpdate: registry.canPullUpdate(desc),
    });
  }
}
return packages;
```

Present the results to the user. Highlight any packages where `canPullUpdate` is `true` — these have updates available.

### Step 2: Update packages via Pull Update

For each package the user wants to update (or all updatable ones if they said "update everything"), run `pullUpdate`:

```typescript
const registry = pluginSystem.findInterface(Editor.IPackageRegistry.interfaceId) as Editor.IPackageRegistry;
const model = pluginSystem.findInterface(Editor.Model.IModel.interfaceId) as Editor.Model.IModel;
const allAssets = model.project.assetManager.assets;

for (const asset of allAssets) {
  if (asset.getTypeName() === "NativePackageDescriptor") {
    const desc = asset as Editor.Assets.NativePackageDescriptor;
    if (desc.packageName === "<PACKAGE_NAME>" && registry.canPullUpdate(desc)) {
      registry.pullUpdate(desc);
    }
  }
}
return "done";
```

Replace `<PACKAGE_NAME>` with the target package name (e.g., `"SpectaclesInteractionKit"`). To update multiple packages, either loop over a list of names or remove the name check to update all updatable packages.

### Step 3: Verify the update

Re-run the listing code from Step 1 to confirm versions changed and `canPullUpdate` is now `false` for updated packages.

### Step 4: Report results

Tell the user which packages were updated and their old/new versions. If any packages could not be updated (`canPullUpdate` was `false`), mention that no Pull Update candidate is currently available. The package may already be up to date, or the user may need to check the Asset Library / use version selection to confirm whether a newer version exists.

## Version Selection from Asset Library (advanced)

If the user asks to update to a specific version, or if `canPullUpdate` is false but they believe a newer version exists, use the Asset Library search approach.

### Search for available versions

```typescript
const AssetLibrary = await import("LensStudio:AssetLibrary");
const provider = pluginSystem.findInterface(
  AssetLibrary.IAssetLibraryProvider.interfaceId
) as import("LensStudio:AssetLibrary").IAssetLibraryProvider;

const envSetting = new AssetLibrary.EnvironmentSetting();
envSetting.environment = AssetLibrary.Environment.Production;
envSetting.space = AssetLibrary.Space.Public;

const filter = new AssetLibrary.AssetFilter();
filter.searchText = "<PACKAGE_NAME>";

const request = new AssetLibrary.AssetListRequest(envSetting, filter);
const response = await provider.assetService.fetchAsync(request);

if (!response.ok) {
  return { error: response.error?.description };
}

const assets = response.data?.assets || [];
return assets.map((a: import("LensStudio:AssetLibrary").Asset) => ({
  assetId: a.assetId,
  assetName: a.assetName,
  resources: a.resources?.map((r: import("LensStudio:AssetLibrary").Resource) => ({
    name: r.name,
    uri: r.uri,
  })),
}));
```

Each asset has multiple `resources`, where each resource represents a version (the `name` field is the Lens Studio version it targets, and the URI filename contains the package version, e.g., `SpectaclesInteractionKit.v0.17.3.lspkg`).

### Apply a specific version

Once the user picks a version, use `selectVersionFromAssetLibrary`:

```typescript
// Run the search block above first to obtain `assets`, then:
const AssetLibrary = await import("LensStudio:AssetLibrary");
const registry = pluginSystem.findInterface(Editor.IPackageRegistry.interfaceId) as Editor.IPackageRegistry;
const model = pluginSystem.findInterface(Editor.Model.IModel.interfaceId) as Editor.Model.IModel;

// Find the installed package descriptor
let descriptor: Editor.Assets.NativePackageDescriptor | null = null;
for (const asset of model.project.assetManager.assets) {
  if (asset.getTypeName() === "NativePackageDescriptor") {
    const desc = asset as Editor.Assets.NativePackageDescriptor;
    if (desc.packageName === "<PACKAGE_NAME>") { descriptor = desc; break; }
  }
}
if (!descriptor) return "Package not found in project";

// Re-run the search (assets must come from a live fetchAsync, not a cached list)
const provider = pluginSystem.findInterface(
  AssetLibrary.IAssetLibraryProvider.interfaceId
) as import("LensStudio:AssetLibrary").IAssetLibraryProvider;
const envSetting = new AssetLibrary.EnvironmentSetting();
envSetting.environment = AssetLibrary.Environment.Production;
envSetting.space = AssetLibrary.Space.Public;
const filter = new AssetLibrary.AssetFilter();
filter.searchText = "<PACKAGE_NAME>";
const response = await provider.assetService.fetchAsync(new AssetLibrary.AssetListRequest(envSetting, filter));
const assets = response.data?.assets || [];

const libraryAsset = assets.find(
  (a: import("LensStudio:AssetLibrary").Asset) => a.assetName === "<PACKAGE_NAME>"
);
if (!libraryAsset) return "Package not found in Asset Library";

const targetResource = libraryAsset.resources?.find(
  (r: import("LensStudio:AssetLibrary").Resource) => r.uri.includes("<VERSION_STRING>")
);
if (!targetResource) return "Version not found or package has no version resources";

registry.selectVersionFromAssetLibrary(descriptor, libraryAsset, targetResource);
return "Version selection applied";
```

Replace `<VERSION_STRING>` with a substring that uniquely matches the desired version URI (e.g., `v0.17.3`).

## Important Notes

- This skill requires the Lens Studio MCP connection (the `ExecuteEditorCode` MCP tool — tool naming, deferred schemas, and ask/spawn semantics: see `lens-studio-field-notes` Hard Rule 2 / Cross-runtime orchestration). If the tool isn't available, the user needs to have Lens Studio open with the project loaded.
- Asset Library searches require the user to be logged into their Snapchat account in Lens Studio. If searches fail with gRPC errors, suggest they log in via Menu Bar > My Lenses > Login.
- `pullUpdate` is synchronous and fast. `selectVersionFromAssetLibrary` may take longer as it downloads from the CDN.
- Always verify updates by re-listing packages after the update completes.
