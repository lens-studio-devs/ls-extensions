<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Editor API snippets

Annotated reference for the ExecuteEditorCode calls this skill uses. Each snippet is self-contained — copy, paste, fill in the names. Treat the prose between snippets as the spec for what each call returns.

## Enumerate remote reference assets and read their metadata

There's no UUID-keyed lookup you need here — walk `assetManager.assets` and duck-type. `instanceof Editor.Assets.RemoteReferenceAsset` throws `invalid 'instanceof' right operand` at runtime, so test the asset's own fields instead. Each remote asset exposes a `metadata` property (`Editor.Assets.RemoteAssetMetadata | null`) describing the server-side object.

```ts
const model: any = pluginSystem.findInterface(Editor.Model.IModel);
const isRemote = (a: any) => a && "assetId" in a && "requestTiming" in a && "sourceType" in a;

const out: any[] = [];
const walk = (a: any) => {
  if (!a) return;
  if (isRemote(a)) {
    const m = a.metadata;                  // Editor.Assets.RemoteAssetMetadata | null
    out.push({
      name: a.name,
      assetId: String(a.assetId),          // Lens Cloud manifest ID
      meta: m && {
        id: m.id,
        name: m.name,
        type: Number(m.type),              // Editor.Assets.RemoteAssetType enum (numeric)
        size: m.size,
        url: m.resource?.url,              // CDN object URL — the bytes to re-host
        checksum: m.resource?.checksum,    // uppercase hex SHA-256
      },
    });
  }
  for (const k of (a.children ?? [])) walk(k);
};
for (const a of model.project.assetManager.assets) walk(a);
return out;
```

`metadata` is server-provided and nullable — guard for `null` before reading `resource.url`. `metadata.type` is an `Editor.Assets.RemoteAssetType`: `Mesh=0, Texture=1, ObjectPrefab=2, Script=3, Audio=4, MlAsset=5, Invalid=6`.

## Download the bundle bytes

`metadata.resource.url` is a plain HTTPS URL to the Lens Cloud CDN object. Fetch it with `LensStudio:Network` and write it with `LensStudio:FileSystem`. The response `body` is an `Editor.Buffer` — use `.toBytes()` for binary; `.toString()` corrupts non-text payloads.

```ts
const Network = await import("LensStudio:Network");
const FS = await import("LensStudio:FileSystem");

const req = new Network.HttpRequest();
req.url = "<metadata.resource.url>";
req.method = Network.HttpRequest.Method.Get;

const resp: any = await new Promise((resolve) => Network.performHttpRequest(req, resolve));
// A 4xx/5xx returns an error page with no resp.error — guard the status or you'll write it as the bundle.
if (resp.error || resp.statusCode < 200 || resp.statusCode >= 300) {
  throw new Error(`HTTP ${resp.statusCode}: ${resp.error || "non-2xx status"}`);
}

const bytes: Uint8Array = resp.body.toBytes();
FS.writeFile(new Editor.Path("<absoluteOutPath>"), bytes);   // (Editor.Path, Uint8Array | string)
return { statusCode: resp.statusCode, bytesWritten: bytes.length };
```

`performHttpRequest(req, cb)` is callback-style — wrap it in a `Promise` so the `ExecuteEditorCode` call can `await` the response. `HttpRequest.Method` enum: `Get=0, Post=1, Put=2, Delete=3`.

## Verify the download

The download is byte-exact — confirm it against the metadata before uploading. The checksum is uppercase hex SHA-256; `shasum` emits lowercase, so compare case-insensitively.

```bash
shasum -a 256 "<outPath>"   # must equal metadata.resource.checksum (lowercased)
stat -f%z "<outPath>"       # must equal metadata.size
file "<outPath>"            # 'Zip archive data' => .prfb runtime bundle => loadResourceAsRuntimeBundle
```

## Clean up the download

The download lives outside `Assets/`. Once it's uploaded and verified, delete the file:

```bash
rm "<outPath>"
```

Leave the `.remoteReferenceAsset` stub in place; removing it is the user's call.

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
