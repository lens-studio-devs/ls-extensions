<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Loader template — RemoteSupabaseLoader.ts

The bundled `assets/RemoteSupabaseLoader.ts` is the canonical replacement for any `RemoteReferenceAsset.downloadAsset()` consumer. It's deliberately minimal so it's easy to extend asset-by-asset.

## Anatomy

```ts
@input internetModule: InternetModule;       // create one InternetModule asset, share it
@input remoteMediaModule: RemoteMediaModule; // same for RemoteMediaModule
@input url: string;                          // public Supabase URL
@input kind: string;                         // image | bytes | gltf | audio | font | string | bundle
```

`OnStartEvent` triggers the load. The success callback for each `kind` calls `print("[RemoteSupabaseLoader] loaded ...")` so the preview log shows a green-path line. Failures print `failed`. This is enough for verification; for production Lenses you'll want the success callback to do something useful.

## Wiring up

After copying the file into `Assets/`, recompile TypeScript so the asset is registered, then for each migrated asset:

1. Create `InternetModule` and `RemoteMediaModule` assets if the project doesn't already have them (one per project is enough — they can be shared).
2. `createSceneObject` for the loader; `addComponent` ScriptComponent.
3. `setProperty scriptAsset` → the RemoteSupabaseLoader script asset.
4. `setProperty internetModule`, `remoteMediaModule` (REFERENCE), `url` (STRING), `kind` (STRING).

Lens Studio's TypeScript compiler emits a `checkUndefined` for every `@input`. That means an `@input foo: Image | undefined` in TS won't actually be optional — a missing value at preview time throws. The cleanest fix is to give string/numeric inputs a default literal (as `url` and `kind` do here) and to set Asset/Component inputs explicitly via `setProperty` before preview.

## Extending for asset-specific consumers

The default success callbacks just log. For real consumers, replace the relevant case:

### Image texture → material
```ts
case "image":
    this.remoteMediaModule.loadResourceAsImageTexture(
        resource,
        (texture) => {
            this.targetMaterial.mainPass.baseTex = texture;
            ok("ImageTexture(" + texture.getWidth() + "x" + texture.getHeight() + ")");
        },
        fail
    );
    break;
```
Add a matching `@input targetMaterial: Material;` and wire it via `setProperty`.

### Runtime bundle → use the bundled asset
The default `bundle` case only prints what was loaded. Extend that callback when the Lens needs to apply or instantiate the loaded asset. The asset's runtime type matches what was bundled:

- `FileMesh` → callback receives a `RenderMesh`. Apply it to a `RenderMeshVisual.mesh`.
- `ObjectPrefab` → callback receives an `ObjectPrefab`. Call `.instantiate(parent)`.
- `FileTexture` → callback receives a `Texture`. Use it as a material's `baseTex`, etc.

```ts
case "bundle":
    this.remoteMediaModule.loadResourceAsRuntimeBundle(
        resource,
        (asset) => {
            // FileMesh path — what your old downloadAsset RenderMesh consumer used to do
            const mesh = asset as unknown as RenderMesh;
            const visual = this.targetVisual;
            visual.mesh = mesh;
            ok("RuntimeBundle(mesh) -> applied to " + visual.getSceneObject().name);
        },
        fail
    );
    break;
```
Add matching `@input` fields (e.g. `targetVisual: RenderMeshVisual`) and wire them via `setProperty`. For an `ObjectPrefab` bundle, switch the body to `(asset as unknown as ObjectPrefab).instantiate(this.parent ?? this.getSceneObject())`.

### Bytes → custom binary parser
```ts
case "bytes":
    this.remoteMediaModule.loadResourceAsBytes(resource, (bytes) => {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        // ... parse however the format demands
        ok("Bytes(" + bytes.length + ")");
    }, fail);
    break;
```

## Why one loader instead of one-script-per-asset

Repeating the same boilerplate per asset is noisy and bug-prone. The `kind` input gives you compile-time-checked dispatch through a single switch, and the `InternetModule + RemoteMediaModule` pair is shared across every loader instance — no per-asset asset configuration to wrangle. When a consumer needs custom behavior (apply texture to material, parent the prefab elsewhere), extending one case is cheaper than maintaining N parallel scripts.
