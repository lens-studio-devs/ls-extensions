<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Remote Asset Migration to Supabase / Snap Cloud

**When this applies:** any match for `RemoteReferenceAsset` / `.remoteReferenceAsset` in the
project scan, where the user wants those assets hosted on Supabase / Souffle / Snap Cloud and
fetched from a URL at runtime instead of through Lens Cloud `AssetId`.

This migration is **automated** — earlier it required manual download through the Remote Assets
panel and a hand-copied Snap Cloud upload, but the asset's CDN bytes are now reachable directly
from `RemoteReferenceAsset.metadata.resource.url`, so the whole round trip can run from the
Editor API plus `curl`.

Replaces the legacy Lens-Cloud `RemoteReferenceAsset` workflow with the Souffle pattern: the
asset bytes live in a Supabase storage bucket, and the Lens fetches them at runtime via
`InternetModule.makeResourceFromUrl()` + `RemoteMediaModule.loadResourceAs*()`.

The bytes you upload are exactly what Lens Cloud already hosts for the asset. Every
`RemoteReferenceAsset` carries a `metadata` property (`Editor.Assets.RemoteAssetMetadata`) whose
`resource.url` points at the CDN object for that asset — a runtime bundle (a zip-wrapped
`.prfb`). You download those bytes and re-host them on Supabase. At runtime the Lens fetches the
bundle with `loadResourceAsRuntimeBundle()`, and the callback receives the same asset type the
original `downloadAsset` callback would have: a `RenderMesh` for a mesh, an `ObjectPrefab` for a
prefab, a `Texture` for a texture, and so on.

## Why this is non-obvious

`RemoteReferenceAsset` only knows how to fetch by Lens Cloud `AssetId`; there is no URL source.
To use Supabase the consumer pattern has to change to `InternetModule + RemoteMediaModule`. The
migration itself is mostly plumbing, but two pieces are non-obvious:

- The asset's CDN bytes are reachable through the `RemoteReferenceAsset.metadata.resource.url`
  property — you fetch them with `LensStudio:Network` and write them to disk with
  `LensStudio:FileSystem`.
- The downloaded object is a runtime bundle with **no extension** — name it `<asset>.prfb` when
  uploading so consumers recognize the format. `RemoteMediaModule` has no `loadResourceAsMesh`;
  the proprietary `.mesh` format is only consumable at runtime through
  `loadResourceAsRuntimeBundle`, whose callback hands back a `RenderMesh` the consumer assigns to
  a `RenderMeshVisual` — mirroring the original `downloadAsset` callback shape.

## Tools this uses

- The `asset-graphql`, `ExecuteEditorCode`, `RecompileTypeScriptTool`, and
  `RunAndCollectLogsTool` MCP tools. (Resolve MCP tool names per your runtime — see
  `lens-studio-field-notes` Hard Rule 2.)
- Supabase MCP calls in this repo must use **nimbus-mcp**. For Snap Cloud / Souffle, use
  `list_projects` if needed, then `get_project_url`, `get_publishable_keys`, and `execute_sql`
  with the explicit `project_id`. For self-hosted local Supabase, use the local URL and Docker
  service key instead of MCP. No MCP binary-upload tool exists, so use `curl` against the
  Storage REST API for the actual object upload.
- `Bash` for `curl`, `docker exec`, and filesystem operations.

## The pipeline

For each remote asset to migrate:

1. **Identify** — list `.remoteReferenceAsset` files; the path-backed action returns each stable
   remote asset ID plus metadata checksum, size, and type. Find the consumer code that calls
   `downloadAsset` on it.
2. **Download** — pass that stable asset ID and a strictly validated `.prfb` basename to the
   path-backed action. It creates a fresh private EEC temporary directory, retains it under an
   opaque download handle for this Lens Studio session, and returns the generated receipt path;
   verify the returned size + SHA-256 against that receipt.
3. **Upload** to a public Supabase storage bucket via `curl` + service-role key, named
   `<asset>.prfb`.
4. **Replace consumers** — swap `downloadAsset` callers for `InternetModule.makeResourceFromUrl
   + RemoteMediaModule.loadResourceAsRuntimeBundle`. The bundled `assets/RemoteSupabaseLoader.ts`
   is a ready-to-drop loader; use its `bundle` kind.
5. **Clean up** — after verification/upload, release the retained download by its opaque handle.
   Keep the `.remoteReferenceAsset` stub so the manifest still resolves; the user removes it once
   they're confident.
6. **Verify** — recompile, refresh preview, grep the log for `loaded` / `failed` lines.

## Stage 1: Identify the remote assets

```graphql
# asset-graphql
query { allAssets(typeFilter: "RemoteReferenceAsset") { id name path type } }
```

Run the path-backed action that reads remote metadata in-editor. `instanceof Editor.Assets.RemoteReferenceAsset` throws `invalid 'instanceof' right operand` at runtime, so the action duck-types the asset's own fields. Its output provides a stable `remoteAssetId`, nullable metadata identity/type/size/checksum, and `hasDownload`, but never a raw CDN URL:

```text
ExecuteEditorCode({
  path: "<absolute path to specs-27-migration skill>/actions/list-remote-assets.ts",
  args: {}
})
```

`metadata` is server-provided and nullable (`RemoteAssetMetadata?`). `metadata.type` is an `Editor.Assets.RemoteAssetType` enum value: `Mesh=0, Texture=1, ObjectPrefab=2, Script=3, Audio=4, MlAsset=5, Invalid=6`. The download is always a runtime bundle regardless of type, so `type` doesn't change how you fetch or upload — it tells you the asset type the bundle wraps, i.e. what the runtime callback will hand back (a `Mesh` → `RenderMesh`, an `ObjectPrefab` → `ObjectPrefab`, etc.) so you can write the consumer's success body in stage 4.

Also `grep` the project for `downloadAsset`, the asset's name, and any `RemoteReferenceAsset` script inputs — those are the consumers you'll rewrite in stage 4.

## Stage 2: Download the bundle bytes

Pass one stable remote asset ID from Stage 1 and a strictly validated `.prfb` basename per call. The action rejects caller-provided directories/paths, separators, traversal, dot-normalization, NUL, and non-`.prfb` names. It creates a fresh private `LensStudio:FileSystem.TempDir`, resolves the metadata and CDN URL internally, fetches with `LensStudio:Network`, and writes `body.toBytes()` to its generated path; raw CDN URLs and arbitrary output locations are never accepted through `args`.

```text
ExecuteEditorCode({
  path: "<absolute path to specs-27-migration skill>/actions/download-remote-asset.ts",
  args: {
    remoteAssetId: "<remoteAssetId from list-remote-assets>",
    outputFileName: "MyBundle.prfb"
  }
})
```

The action rejects invalid IDs/names before mutation and returns the metadata `checksum` and `size` alongside an opaque `downloadHandle` and generated `writeReceipt: { path, bytesWritten }`. It retains the TempDir under that handle for the current Lens Studio session. Use the returned receipt path immediately for byte-exact verification and upload. A failed download returns only a sanitized stable error, HTTP status, and the remote asset ID; it never reflects a signed URL from the native response. Then verify the download is byte-exact against that result — size and SHA-256 (the checksum is uppercase hex; compare case-insensitively), and confirm it's a runtime bundle:

```bash
shasum -a 256 "<writeReceipt.path>"   # must equal returned checksum (lowercased)
stat -f%z "<writeReceipt.path>"       # must equal returned size
file "<writeReceipt.path>"            # 'Zip archive data' — the .prfb runtime bundle format
```

## Stage 3: Upload to Supabase

The Supabase MCP doesn't expose a binary upload tool — use the Storage REST API via `curl`. For Snap Cloud / Souffle, get the project URL with `nimbus-mcp.get_project_url({ project_id })` and obtain the service-role key from the project dashboard/secret store. For local Supabase, set the local URL and read the service key from Docker. The publishable/anon key normally can't write storage objects.

```bash
# Discover URL + service-role key.
# Hosted/Souffle: URL comes from nimbus-mcp get_project_url(project_id); SERVICE_KEY from dashboard.
# Local self-hosted:
URL=http://127.0.0.1:54321
SERVICE_KEY=$(docker exec supabase_storage_$(whoami) env | grep '^SERVICE_KEY=' | cut -d= -f2-)

# Create the bucket once (idempotent: re-running returns "already exists")
curl -s -X POST "$URL/storage/v1/bucket" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"id":"static-assets","name":"static-assets","public":true,"file_size_limit":52428800}'

# Upload (use x-upsert for idempotent re-runs; .prfb is application/octet-stream)
curl -s -X POST "$URL/storage/v1/object/static-assets/<Asset>.prfb" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/octet-stream" \
  -H "x-upsert: true" \
  --data-binary "@<writeReceipt.path>"

# Verify the public URL (status + byte count should match the local file)
curl -s -o /dev/null -w "%{http_code} %{size_download}\n" \
  "$URL/storage/v1/object/public/static-assets/<Asset>.prfb"
```

The public URL the Lens will fetch is `<URL>/storage/v1/object/public/static-assets/<Asset>.prfb`. The helper script `scripts/upload_to_supabase.py` wraps this (`python3 scripts/upload_to_supabase.py <writeReceipt.path> static-assets <Asset>.prfb`) — cross-platform (macOS / Linux / Windows), stdlib only. (It reads `SERVICE_KEY` from a `supabase_storage_<user>` container; if your local project's container is named after the project instead, pass `SERVICE_KEY` in the environment.)

For Snap Cloud / Souffle (or any hosted Supabase), swap the Docker discovery for the project's service-role key from the dashboard and use the project's `https://<ref>.supabase.co` URL. Everything else — the bucket, the upload, the public URL pattern, the loader-side code — is identical.

## Stage 4: Replace consumers

Find every script that calls `downloadAsset` on the migrated `RemoteReferenceAsset` (typically a `@input asset Asset.RemoteReferenceAsset` field plus a `.downloadAsset(onOk, onFail)` call). Replace that pattern with the loader.

The bundled `assets/RemoteSupabaseLoader.ts` is the canonical drop-in. Use its `bundle` kind: the `loadResourceAsRuntimeBundle` success callback receives the asset that was bundled (a `RenderMesh` if it was a FileMesh, an `ObjectPrefab` if it was a prefab, etc.) — the same shape the original `downloadAsset` callback would have received. Extend the `bundle` case with the old consumer's success body, keeping casts such as `asset as RenderMesh` intact. Copy the file into the project's `Assets/` directory and wire it up:

1. Recompile TypeScript so Lens Studio picks up the new script.
2. Create or reuse `InternetModule` + `RemoteMediaModule` assets via `asset-graphql createAsset`.
3. For each migrated asset, `createSceneObject` + `addComponent ScriptComponent`, then `setProperty scriptAsset` to the loader, then set `internetModule`, `remoteMediaModule`, `url`, and `kind` (`bundle`) via `setProperty`.
4. Delete (or leave dormant) the SceneObjects that previously hosted `downloadAsset` callers.

If the consumer was custom code that applied the mesh to a specific component, extend the `bundle` success callback to do that (e.g., `RenderMeshVisual.mesh = asset as RenderMesh`, or `(asset as ObjectPrefab).instantiate(parent)`) instead of the generic `print` — but keep the existing inputs working so the same loader can be reused for multiple assets.

## Stage 5: Release the retained download

Once upload and verification succeed, release the retained private TempDir by passing only the handle to its owned cleanup action:

```text
ExecuteEditorCode({
  path: "<absolute path to specs-27-migration skill>/actions/release-remote-download.ts",
  args: { downloadHandle: "<downloadHandle from download result>" }
})
```

If the Lens Studio session reset or the handle is unavailable before verification/upload, fail closed and re-download rather than claiming `writeReceipt.path` still persists. `alreadyReleased: true` is safe only for a retry after a known successful release. **Do not delete the `.remoteReferenceAsset`** — it's the legacy stub the user may want to keep around for rollback or inspection. Removing it is the user's call. Nothing is written into `Assets/`, so there's nothing else to clean up there.

## Stage 6: Verify

Recompile (the `RecompileTypeScriptTool` MCP tool) and refresh the preview (the `RunAndCollectLogsTool` MCP tool, with the same `previewName` as step 7b). Read the log starting at the returned `byteOffset` and grep for the loader's tag (`RemoteSupabaseLoader`) plus `loaded` / `failed`. A successful run looks like:

```
[RemoteSupabaseLoader] loaded RuntimeBundle from <url>
```

If you see `failed`, the most common causes are:
- `127.0.0.1` URL but the Lens runs on-device — only the preview can resolve `localhost`, not Specs.
- Bucket isn't public, or RLS blocks anonymous read.
- Bundle file uploaded without renaming — check the Supabase object name has the `.prfb` extension.

## Important details / gotchas

- **No `instanceof` for `RemoteReferenceAsset`.** It throws `invalid 'instanceof' right operand` at runtime. Duck-type on `"assetId" in a && "requestTiming" in a && "sourceType" in a`.
- **`metadata` is nullable.** `RemoteReferenceAsset.metadata` is `RemoteAssetMetadata?` — it's server-provided and can be `null`. Guard before reading `resource.url`.
- **Binary bytes need `toBytes()`.** The HTTP response `body` is an `Editor.Buffer`; call `.toBytes()` for a `Uint8Array`. `.toString()` corrupts binary payloads.
- **`FileSystem.writeFile(path, data)`** takes an `Editor.Path` and a `Uint8Array | string`. Pass the bytes straight through.
- **Checksum case.** `metadata.resource.checksum` is uppercase hex SHA-256; `shasum` emits lowercase. Compare case-insensitively.
- **`loadResourceAsBytes` won't reconstruct a Mesh.** It hands back raw `Uint8Array`. The proprietary `.mesh` format isn't directly constructable at runtime — `loadResourceAsRuntimeBundle` is the only path that hands back a usable `RenderMesh`.
- **Bundled-asset callback type matches the bundled asset.** A FileMesh bundle's callback gets a `RenderMesh`, an ObjectPrefab bundle's gets an `ObjectPrefab`. The default loader's bundle case only logs success, so extend the case to do something asset-specific (assign `.mesh` on a `RenderMeshVisual`, or call `(asset as ObjectPrefab).instantiate(parent)`, etc.).
- **Loader's `@input` fields are required.** Lens Studio's compiler emits `checkUndefined` for every `@input` regardless of TypeScript optionality. Either supply a default (string/number) or set the value via `setProperty` before preview.
- **Idempotency.** Re-running the upload with `x-upsert: true` overwrites cleanly. Re-running the bucket-create returns 409 "already exists" — ignore it.

## Supporting files

The stages above are the complete happy path — don't open a supporting file unless its trigger fires.

- `references/remote-asset-editor-api.md` — **open when** an `ExecuteEditorCode` action throws or returns nothing (e.g. `invalid 'instanceof' right operand`, `metadata` is `null`, `body.toString()` returned garbage), or you need the exact `Editor.Assets.*` / `LensStudio:Network` / `LensStudio:FileSystem` type signatures. It documents the path-backed enumerate and download actions and their receipts.
- `references/remote-asset-loader-template.md` — **open when** the original `downloadAsset` consumer did more than log (assigned `RenderMeshVisual.mesh`, called `ObjectPrefab.instantiate(parent)`, applied a texture to a material) and you must extend the loader's `bundle` case beyond the default `print`.
- `assets/RemoteSupabaseLoader.ts` — copy into the project's `Assets/` directory in stage 4.
- `scripts/upload_to_supabase.py` — **use in stage 3 instead of raw `curl`** for the upload; creates the bucket, upserts the file, and verifies the public URL. Cross-platform (macOS / Linux / Windows), Python stdlib only. Pulls the service-role key from the local `supabase_storage_<user>` Docker container (pass `SERVICE_KEY` in the env for hosted/Souffle projects).
