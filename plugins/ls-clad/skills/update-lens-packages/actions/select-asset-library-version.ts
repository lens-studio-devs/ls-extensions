function invalidArgs(error: string) {
    return { error: `invalid args: ${error}` };
}

const input = args as any;
if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return invalidArgs("args must be a JSON object");
}
if (typeof input.packageName !== "string" || input.packageName.trim().length === 0) {
    return invalidArgs("packageName must be a non-empty string");
}
if (typeof input.versionSelector !== "string" || input.versionSelector.trim().length === 0) {
    return invalidArgs("versionSelector must be a non-empty string");
}
if (
    input.assetName !== undefined &&
    (typeof input.assetName !== "string" || input.assetName.trim().length === 0)
) {
    return invalidArgs("assetName must be a non-empty string when provided");
}

const packageName = input.packageName.trim();
const assetName = input.assetName?.trim() ?? packageName;
const versionSelector = input.versionSelector.trim();
const registry = pluginSystem.findInterface(
    Editor.IPackageRegistry.interfaceId
) as Editor.IPackageRegistry;
const model = pluginSystem.findInterface(Editor.Model.IModel);

let descriptor: Editor.Assets.NativePackageDescriptor | null = null;
for (const asset of model.project.assetManager.assets) {
    if (asset.getTypeName() !== "NativePackageDescriptor") {
        continue;
    }
    const candidate = asset as Editor.Assets.NativePackageDescriptor;
    if (candidate.packageName === packageName) {
        descriptor = candidate;
        break;
    }
}
if (!descriptor) {
    return "Package not found in project";
}

const AssetLibrary = await import("LensStudio:AssetLibrary");
const provider = pluginSystem.findInterface(
    AssetLibrary.IAssetLibraryProvider.interfaceId
) as import("LensStudio:AssetLibrary").IAssetLibraryProvider;
const environment = new AssetLibrary.EnvironmentSetting();
environment.environment = AssetLibrary.Environment.Production;
environment.space = AssetLibrary.Space.Public;
const filter = new AssetLibrary.AssetFilter();
filter.searchText = packageName;
const response = await provider.assetService.fetchAsync(
    new AssetLibrary.AssetListRequest(environment, filter)
);
if (!response.ok) {
    return { error: response.error?.description };
}

const libraryAsset = (response.data?.assets ?? []).find(
    (asset) => asset.assetName === assetName
);
if (!libraryAsset) {
    return "Package not found in Asset Library";
}

const matchingResources = (libraryAsset.resources ?? []).filter(
    (resource) => resource.uri.includes(versionSelector)
);
if (matchingResources.length === 0) {
    return "Version not found or package has no version resources";
}
if (matchingResources.length > 1) {
    return "Version selector matched multiple package resources";
}

registry.selectVersionFromAssetLibrary(descriptor, libraryAsset, matchingResources[0]);
return "Version selection applied";
