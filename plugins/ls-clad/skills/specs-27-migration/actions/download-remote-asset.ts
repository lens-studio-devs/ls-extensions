// ExecuteEditorCode async-function body. `args` is injected by Core-ChatTools.
const remoteAssetId = typeof args?.remoteAssetId === "string" ? args.remoteAssetId.trim() : "";
const outputFileName = typeof args?.outputFileName === "string" ? args.outputFileName.trim() : "";

if (!/^[A-Za-z0-9._:-]{1,256}$/.test(remoteAssetId)) {
    return { error: "Invalid remoteAssetId" };
}
if (args && typeof args === "object" && ("stagingDirectory" in args || "outputPath" in args)) {
    return { error: "Unsupported output location arguments" };
}
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.prfb$/.test(outputFileName) || outputFileName.includes("..")) {
    return { error: "Invalid outputFileName" };
}

const model = pluginSystem.findInterface(Editor.Model.IModel);
type AssetNode = Editor.Assets.Asset & { children?: Editor.Assets.Asset[] };
const isRemoteReferenceAsset = (
    asset: Editor.Assets.Asset
): asset is Editor.Assets.RemoteReferenceAsset => asset.isOfType("RemoteReferenceAsset");
const findRemoteAsset = (
    assets: readonly Editor.Assets.Asset[]
): Editor.Assets.RemoteReferenceAsset | undefined => {
    for (const asset of assets) {
        if (!asset) continue;
        if (isRemoteReferenceAsset(asset) && String(asset.assetId) === remoteAssetId) return asset;
        const nested = findRemoteAsset((asset as AssetNode).children ?? []);
        if (nested) return nested;
    }
    return undefined;
};

const remoteAsset = findRemoteAsset(model.project.assetManager.assets);
if (!remoteAsset) return { error: `Remote asset ${remoteAssetId} not found` };

const metadata = remoteAsset.metadata;
type RemoteAssetResourceWithChecksum = Editor.Assets.RemoteAssetResource & { checksum?: string };
const resource = metadata?.resource as RemoteAssetResourceWithChecksum | undefined;
if (!resource?.url || !resource?.checksum || metadata?.size == null) {
    return { error: "Remote asset metadata is incomplete", remoteAssetId };
}

const FS = await import("LensStudio:FileSystem");
const temporaryDirectory = FS.TempDir.create();
const outputEditorPath = temporaryDirectory.path.appended(new Editor.Path(outputFileName));
const outputPath = outputEditorPath.toString();
const Network = await import("LensStudio:Network");
const request = new Network.HttpRequest();
request.url = resource.url;
request.method = Network.HttpRequest.Method.Get;

const response = await new Promise<import("LensStudio:Network").HttpResponse>((resolve) =>
    Network.performHttpRequest(request, resolve)
);
const statusCode = typeof response?.statusCode === "number" ? response.statusCode : null;
if (response?.error || statusCode === null || statusCode < 200 || statusCode >= 300) {
    return {
        error: "Remote download failed",
        remoteAssetId,
        statusCode,
    };
}
if (!response.body?.toBytes) return { error: "Remote response has no binary body", remoteAssetId };

const bytes = response.body.toBytes();
FS.writeFile(outputEditorPath, bytes);

const retentionKey = "__lsCladSpecs27RemoteDownloadRetentionV1";
const globalState = globalThis as any;
let retainedDownloads = globalState[retentionKey];
if (!retainedDownloads || typeof retainedDownloads !== "object") {
    retainedDownloads = Object.create(null);
    globalState[retentionKey] = retainedDownloads;
}
let downloadHandle = "";
do {
    const randomPart = Math.random().toString(36).slice(2) || "0";
    downloadHandle = `remote-download-${Date.now().toString(36)}-${randomPart}`;
} while (Object.prototype.hasOwnProperty.call(retainedDownloads, downloadHandle));
retainedDownloads[downloadHandle] = { temporaryDirectory };

return {
    remoteAssetId,
    downloadHandle,
    name: String(remoteAsset.name ?? ""),
    checksum: String(resource.checksum),
    size: Number(metadata.size),
    statusCode: response.statusCode,
    writeReceipt: { path: outputPath, bytesWritten: bytes.length },
};
