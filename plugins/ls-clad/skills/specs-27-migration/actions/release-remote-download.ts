// @eec
// ExecuteEditorCode async-function body. Releases a retained Specs 27 remote-download TempDir.
if (
    !args ||
    typeof args !== "object" ||
    Array.isArray(args) ||
    Object.keys(args).length !== 1 ||
    typeof args.downloadHandle !== "string"
) {
    return { error: "Invalid cleanup arguments" };
}

const downloadHandle = args.downloadHandle.trim();
if (!/^remote-download-[a-z0-9]+-[a-z0-9]+$/.test(downloadHandle)) {
    return { error: "Invalid downloadHandle" };
}

const retentionKey = "__lsCladSpecs27RemoteDownloadRetentionV1";
const retainedDownloads = (globalThis as any)[retentionKey];
if (!retainedDownloads || typeof retainedDownloads !== "object") {
    return { released: false, alreadyReleased: true };
}
if (!Object.prototype.hasOwnProperty.call(retainedDownloads, downloadHandle)) {
    return { released: false, alreadyReleased: true };
}

delete retainedDownloads[downloadHandle];
return { released: true };
