<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Migration: Remote Media and Remote Assets

**When this applies:** any match for `loadAsImageTexture`, `loadAsVideoTexture`,
`loadAsGltfAsset`, `loadAsAudioTrackAsset`, or `RemoteReferenceAsset` in the project scan.

Two parts: (1) automated migration of deprecated `loadAs*` URL methods to `loadResourceAs*`
via `DynamicResource`, and (2) manual guidance for `RemoteReferenceAsset` to Snap Cloud.

## Detection Patterns

**Automated migration (Part 1):**
- `loadAsImageTexture`
- `loadAsVideoTexture`
- `loadAsGltfAsset`
- `loadAsAudioTrackAsset`

**Manual guidance (Part 2):**
- `RemoteReferenceAsset`

## Part 1: URL Methods to DynamicResource

### Method mapping

| Old method | New method |
|---|---|
| `loadAsImageTexture(url, onSuccess, onFailure)` | `loadResourceAsImageTexture(resource, onSuccess, onFailure)` |
| `loadAsVideoTexture(url, onSuccess, onFailure)` | `loadResourceAsVideoTexture(resource, onSuccess, onFailure)` |
| `loadAsGltfAsset(url, onSuccess, onFailure)` | `loadResourceAsGltfAsset(resource, onSuccess, onFailure)` |
| `loadAsAudioTrackAsset(url, onSuccess, onFailure)` | `loadResourceAsAudioTrackAsset(resource, onSuccess, onFailure)` |

### Migration pattern

```js
// OLD (JS)
script.remoteMediaModule.loadAsImageTexture(url, onSuccess, onFailure);

// NEW (JS) - requires InternetModule input
let resource = script.internetModule.makeResourceFromUrl(url);
script.remoteMediaModule.loadResourceAsImageTexture(resource, onSuccess, onFailure);

// NEW (TS) - inside a @component class
let resource = this.internetModule.makeResourceFromUrl(url);
this.remoteMediaModule.loadResourceAsImageTexture(resource, onSuccess, onFailure);
```

### Steps

1. Ensure the file has an InternetModule input. If not, add `//@input Asset.InternetModule internetModule` (JS) or `@input internetModule: InternetModule` (TS) near the other input declarations.
2. For each `loadAs*` call, extract the first argument (the URL).
3. Insert a line before the call: `let resource = script.internetModule.makeResourceFromUrl(<url>);` (JS) or `this.internetModule.makeResourceFromUrl(<url>);` (TS).
4. Replace the `loadAs*` call with `loadResourceAs*`, passing `resource` as the first argument instead of the URL. The remaining callback arguments stay the same.
5. If the same URL is used in multiple `loadAs*` calls, create the resource once and reuse it.

### New methods with no old equivalent

These are available on RemoteMediaModule but have no deprecated predecessor:
- `loadResourceAsString(resource, onSuccess, onFailure)`
- `loadResourceAsBytes(resource, onSuccess, onFailure)`
- `loadResourceAsGaussianSplattingAsset(resource, onSuccess, onFailure)`
- `DynamicResource.createWithBuffer(await blob.bytes())` - creates DynamicResource from a Blob instead of a URL

## Part 2: RemoteReferenceAsset to Supabase / Snap Cloud

**Only run this section if `RemoteReferenceAsset` was found in the scan.** This is an automated
migration — the asset's bytes are re-hosted on a Supabase / Snap Cloud bucket and consumers are
rewritten to `InternetModule` + `RemoteMediaModule`. Read `remote-asset-supabase-migration.md`
and follow its pipeline.
