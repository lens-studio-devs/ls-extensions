// ExecuteEditorCode async-function body. `args` is injected by Core-ChatTools.
const model = pluginSystem.findInterface(Editor.Model.IModel);

type AssetNode = Editor.Assets.Asset & { children?: Editor.Assets.Asset[] };
type RemoteAssetResourceWithChecksum = Editor.Assets.RemoteAssetResource & { checksum?: string };
type RemoteAssetSummary = {
    name: string;
    remoteAssetId: string;
    metadataId: string | null;
    type: number | null;
    size: number | null;
    checksum: string | null;
    hasDownload: boolean;
};
const isRemoteReferenceAsset = (
    asset: Editor.Assets.Asset
): asset is Editor.Assets.RemoteReferenceAsset => asset.isOfType("RemoteReferenceAsset");

const remoteAssets: RemoteAssetSummary[] = [];
const visit = (asset: Editor.Assets.Asset): void => {
    if (!asset) return;
    if (isRemoteReferenceAsset(asset)) {
        const metadata = asset.metadata;
        const resource = metadata?.resource as RemoteAssetResourceWithChecksum | undefined;
        remoteAssets.push({
            name: String(asset.name ?? ""),
            remoteAssetId: String(asset.assetId),
            metadataId: metadata?.id != null ? String(metadata.id) : null,
            type: metadata?.type != null ? Number(metadata.type) : null,
            size: metadata?.size != null ? Number(metadata.size) : null,
            checksum: resource?.checksum != null ? String(resource.checksum) : null,
            hasDownload: !!resource?.url,
        });
    }
    for (const child of (asset as AssetNode).children ?? []) visit(child);
};

for (const asset of model.project.assetManager.assets) visit(asset);
return remoteAssets;
