// ExecuteEditorCode async-function body. `args` is injected by Core-ChatTools.
const vfxAssetId = typeof args?.vfxAssetId === "string" ? args.vfxAssetId.trim() : "";

if (!/^[A-Za-z0-9._:-]{1,256}$/.test(vfxAssetId)) {
    return { error: "Invalid vfxAssetId" };
}

const model = pluginSystem.findInterface(Editor.Model.IModel);
const assetManager = model.project.assetManager;

type AssetNode = Editor.Assets.Asset & { children?: Editor.Assets.Asset[] };
const findAssetById = (assets: readonly Editor.Assets.Asset[]): Editor.Assets.Asset | undefined => {
    for (const asset of assets) {
        if (!asset) continue;
        if (asset.id != null && String(asset.id) === vfxAssetId) return asset;
        const nested = findAssetById((asset as AssetNode).children ?? []);
        if (nested) return nested;
    }
    return undefined;
};

const vfxAsset = findAssetById(assetManager.assets);
if (!vfxAsset) return { error: `VFX asset ${vfxAssetId} not found` };
const assetType = typeof vfxAsset.getTypeName === "function" ? vfxAsset.getTypeName() : "unknown";
if (assetType !== "VFXAsset") return { error: "Asset is not a VFXAsset", assetType };

const instantiated = await assetManager.instantiate([vfxAsset]);
const sceneObject = instantiated[0];
if (!sceneObject) return { error: `VFX asset ${vfxAssetId} produced no scene object` };

return { sceneObjectId: sceneObject.id.toString() };
