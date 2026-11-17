<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Editor API actions

Annotated reference for the path-backed ExecuteEditorCode actions this skill uses. Pass the listed
per-call values as structured runtime `args`.

## Enumerate remote reference assets and read their metadata

There's no UUID-keyed lookup you need here — the action walks `assetManager.assets` and duck-types. `instanceof Editor.Assets.RemoteReferenceAsset` throws `invalid 'instanceof' right operand` at runtime, so the action tests the asset's own fields instead. Each returned record exposes a stable `remoteAssetId`, plus nullable metadata identity/type/size/checksum and `hasDownload`; it intentionally does not return a CDN URL.

```text
ExecuteEditorCode({
  path: "<absolute path to specs-27-migration skill>/actions/list-remote-assets.ts",
  args: {}
})
```

`metadata` is server-provided and nullable. `metadata.type` is an `Editor.Assets.RemoteAssetType`: `Mesh=0, Texture=1, ObjectPrefab=2, Script=3, Audio=4, MlAsset=5, Invalid=6`.

## Download the bundle bytes

Pass the stable `remoteAssetId` from enumeration and a strictly validated `.prfb` basename only. The action rejects directory/path arguments, separators, traversal, dot-normalization, NUL, and non-`.prfb` names. It creates its own fresh private `LensStudio:FileSystem.TempDir` inside ExecuteEditorCode, resolves `metadata.resource.url` only there, fetches with `LensStudio:Network`, and writes binary `body.toBytes()` to the generated path. Never pass a raw CDN URL or output location through `args`.

```text
ExecuteEditorCode({
  path: "<absolute path to specs-27-migration skill>/actions/download-remote-asset.ts",
  args: {
    remoteAssetId: "<remoteAssetId from list-remote-assets>",
    outputFileName: "MyBundle.prfb"
  }
})
```

The result returns the metadata `checksum` and `size`, HTTP status, an opaque `downloadHandle`, and the generated `writeReceipt: { path, bytesWritten }`. The action retains the private TempDir under that handle for the current Lens Studio session, so use the receipt path immediately for byte-exact verification and upload. A failed download returns only the stable `remoteAssetId`, HTTP status, and a sanitized error, never a response error that might contain a signed CDN URL.

## Verify the download

The download is byte-exact — confirm the returned `checksum` and `size` against `writeReceipt.path` before uploading. The checksum is uppercase hex SHA-256; `shasum` emits lowercase, so compare case-insensitively.

```bash
shasum -a 256 "<writeReceipt.path>"   # must equal returned checksum (lowercased)
stat -f%z "<writeReceipt.path>"       # must equal returned size
file "<writeReceipt.path>"            # 'Zip archive data' => .prfb runtime bundle => loadResourceAsRuntimeBundle
```

## Release the retained download

After byte-exact verification and upload succeed, release the retained TempDir by handle. This action accepts no filesystem path and is idempotent:

```text
ExecuteEditorCode({
  path: "<absolute path to specs-27-migration skill>/actions/release-remote-download.ts",
  args: { downloadHandle: "<downloadHandle from download result>" }
})
```

If the Lens Studio session resets or the handle is unavailable before verification/upload, fail closed and re-download; do not claim the prior receipt path still exists. On a retry after a known successful release, `alreadyReleased: true` is safe. Leave the `.remoteReferenceAsset` stub in place; removing it is the user's call.

## Find Editor API types you'd want to cite

| Type | Where in editor.d.ts |
|---|---|
| `Editor.Model.IModel` | `IModel` — has `.project` |
| `Editor.Model.AssetManager` | accessed via `model.project.assetManager`; `.assets` is the top-level asset list you walk to find remote assets |
| `Editor.Path` | constructor `(string)` |
| `Editor.Assets.Asset` | base class for all assets |
| `Editor.Assets.RemoteReferenceAsset` | has `.assetId` (cloud), `.requestTiming`, `.sourceType`, and `.metadata` (`RemoteAssetMetadata?`) |
| `Editor.Assets.RemoteAssetMetadata` | readonly: `id`, `name`, `description`, `iconUrl`, `size`, `type` (`RemoteAssetType`), `createdAt`, `createdBy`, `updatedBy`, `lensUsages`, `minCoreVersion`, `organization`, `resource` |
| `Editor.Assets.RemoteAssetResource` | readonly: `url`, `checksum` |
| `Editor.Assets.RemoteAssetOrganization` | readonly: `id`, `name` |
| `Editor.Assets.RemoteAssetType` | enum: `Mesh`, `Texture`, `ObjectPrefab`, `Script`, `Audio`, `MlAsset`, `Invalid` |
| `LensStudio:Network` | `HttpRequest`, `HttpRequest.Method`, `performHttpRequest(req, cb)`; response `body` is `Editor.Buffer` |
| `LensStudio:FileSystem` | `writeFile(Editor.Path, Uint8Array \| string)` |
| `Editor.Buffer` | `toBytes(): Uint8Array`, `toString(): string` |
