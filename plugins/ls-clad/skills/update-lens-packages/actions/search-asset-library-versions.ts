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

const packageName = input.packageName.trim();
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

return (response.data?.assets ?? []).map((asset) => ({
    assetId: asset.assetId,
    assetName: asset.assetName,
    resources: asset.resources?.map((resource) => ({
        name: resource.name,
        uri: resource.uri,
    })),
}));
