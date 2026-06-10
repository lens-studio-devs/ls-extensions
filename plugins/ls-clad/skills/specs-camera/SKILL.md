---
name: specs-camera
description: Access Specs camera frames via CameraModule — live stream, still capture, intrinsics, 3D↔2D project/unproject, crop and composite patterns. Camera + internet is publishable via Transparent Permission. Load for CV, AR overlays, ML/AI.
user-invocable: false
paths: "**/*.ts"
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Camera Module — Specs Camera Frame Access

**Requirements:** Lens Studio v5.x+. `CameraModule` is a regular
sensitive-sensor API (not Experimental) — combining it with internet
connectivity triggers Transparent Permission, but the Lens is still
publishable. Still image requests (`requestImage`) are device-only; the
continuous camera stream and crop pipelines also run in the editor with
`Default_Color`.

> **Privacy:** Camera + internet **is** allowed in published Lenses. The
> combination triggers **Transparent Permission**: the user sees an
> explicit permission prompt at launch and the device LED blinks while the
> camera is in use. Users with Extended Permissions enabled skip the
> prompt. See [docs/transparent-permission.mdx](resources/docs/transparent-permission.mdx)
> and [docs/permissions-and-privacy.mdx](resources/docs/permissions-and-privacy.mdx).

---

## What this skill gives you

| Goal | Start here |
| --- | --- |
| Show the live camera feed on a panel in front of the user | [scripts/CameraFrameStream.ts](resources/scripts/CameraFrameStream.ts) + [scene-setup/basic-camera-panel.md](resources/scene-setup/basic-camera-panel.md) |
| Live viewfinder + freeze-frame capture + aspect-ratio crop (editor-friendly) | [scripts/CameraSetup.ts](resources/scripts/CameraSetup.ts) + [scene-setup/camera-panel-with-capture-and-ratio.md](resources/scene-setup/camera-panel-with-capture-and-ratio.md) |
| Take a high-resolution still photo (device only) | [scripts/StillImageCapture.ts](resources/scripts/StillImageCapture.ts) |
| Read camera intrinsics, project/unproject 3D↔2D | [scripts/CameraIntrinsics.ts](resources/scripts/CameraIntrinsics.ts) |
| Crop the camera feed to a region of interest (picture-in-picture, zoom) | [scripts/CropCameraTexture.ts](resources/scripts/CropCameraTexture.ts) + [scene-setup/crop-camera-texture.md](resources/scene-setup/crop-camera-texture.md) |
| Share one camera request across many consumers (UI + ML + encoder) | [scripts/CompositeCameraService.ts](resources/scripts/CompositeCameraService.ts) + [scene-setup/composite-camera-texture.md](resources/scene-setup/composite-camera-texture.md) |
| Bake virtual scene content into the captured image ("augmented capture", infinite-mirror) | [scripts/CameraCompositeRenderService.ts](resources/scripts/CameraCompositeRenderService.ts) + [scene-setup/composite-render-target-passthrough.md](resources/scene-setup/composite-render-target-passthrough.md) |
| Full official API reference | [docs/camera-module.mdx](resources/docs/camera-module.mdx) |
| Permission rules + which combinations need Transparent Permission | [docs/permissions-and-privacy.mdx](resources/docs/permissions-and-privacy.mdx), [docs/transparent-permission.mdx](resources/docs/transparent-permission.mdx) |
| Experimental API flag + watermark behavior | [docs/experimental-apis.mdx](resources/docs/experimental-apis.mdx) |

---

## Minimizing `@input` — what's programmatic, what isn't

Every `@input` is a wiring step the user has to perform in the editor
(and a step that breaks silently when scenes are regenerated). It is
worth asking, per field, whether the dependency can be resolved in code
instead — but the honest answer is **two-tier**: some camera
dependencies have no editor-authored equivalent and *must* be inputs.

### Tier 1 — always resolve programmatically (no `@input`)

These have a fully working in-code path. Exposing them as inputs adds
wiring without buying anything.

| Dependency            | Programmatic resolution                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------- |
| `CameraModule`        | `const cameraModule = require("LensStudio:CameraModule")` — module singleton, not an asset reference. |
| Camera id             | Branch on `global.deviceInfoSystem.isEditor()` — `Default_Color` in editor, `Right_Color` (or `Left_Color`) on device. |
| Display surface       | Simplest path: a SceneObject with a regular `Transform` whose material's `baseTex` is the camera texture (or an `Image Texture`). Only switch to a `Canvas` + `ScreenTransform` + `Component.Image` panel when you need UI-layout-aware sizing (frames, buttons, aspect ratios). See `CameraFrameStream.ts`. |
| Frame callback wiring | `provider.onNewFrame.add(...)`, request creation, lifecycle — all code paths.                 |

### Tier 2 — must be assigned in the Inspector (`@input`)

These are project-level assets with **no script construction path** —
the typings literally forbid it. Confirmed against `StudioLib.d.ts`:

| Dependency             | API evidence                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `Render Target`        | `RenderTargetProvider` has `protected constructor()` and no static `create*()`. The Texture asset can only be authored in the Asset Browser, and is wired on the scene `Camera.renderTarget` at edit time. |
| `Screen Crop Texture`  | `RectCropTextureProvider` has `protected constructor()` and no static `create*()`. The provider can only be obtained as `texture.control` on an authored `Texture` asset.                                  |
| Base `Material`        | `Material.clone()` works at runtime, but cloning requires a source. Shader graph and defines (e.g. `ENABLE_BASE_TEX` on the unlit preset) can only be authored at edit time.                              |
| Per-instance variation | Anything the user genuinely needs to vary in the editor without writing code (e.g. a controller picking one of several materials).                                                                       |

Compare with constructable providers like `ProceduralTextureProvider`
which expose `createFromTexture()` / `createWithFormat()` — those would
be tier 1. The tier-2 providers above explicitly do not.

> **What about `requireAsset(name)`?** `requireAsset` is a real API and
> can pull an authored asset by name without an `@input`. **Do not use
> it for tier-2 dependencies.** It trades inspector wiring for hardcoded
> string coupling: the editor cannot validate the reference, renaming
> the asset silently breaks the script, and the dependency disappears
> from the inspector. `@input` is the correct pattern for tier 2 — it
> gives the editor a reference it can validate and the user a slot they
> can introspect. Reserve `requireAsset` for genuinely
> location-independent assets that ship in a `.lspkg` you control.

### How this looks across the skill

- **Tier-1-only scripts** — zero `@input`, build their own display surface:
  [`CameraFrameStream.ts`](resources/scripts/CameraFrameStream.ts),
  [`StillImageCapture.ts`](resources/scripts/StillImageCapture.ts),
  [`CameraIntrinsics.ts`](resources/scripts/CameraIntrinsics.ts).
  Use these as the template when adding a new script.
- **Scripts that genuinely need tier-2 inputs** keep them:
  [`CropCameraTexture.ts`](resources/scripts/CropCameraTexture.ts) needs
  the screen crop texture;
  [`CameraCompositeRenderService.ts`](resources/scripts/CameraCompositeRenderService.ts)
  needs the project Render Target;
  [`CameraSetup.ts`](resources/scripts/CameraSetup.ts) needs the base
  `ImageMaterial` (with `ENABLE_BASE_TEX` enabled on the source).
  When adapting these, the first refactor pass is dropping **tier-1**
  inputs (`CameraModule`, camera selection, owned display Image),
  **not** the tier-2 ones.

---

## Common TypeScript gotchas

- **`onNewFrame` callback takes zero args.** `provider.onNewFrame.add(cb)` expects `() => void`. Do not type the callback as `(value) => void` or `(e) => void` — it fails with TS2345. Read the frame from the texture/provider inside the handler, not from a parameter.
- **`onNewFrame.remove(...)`** requires the same `EventRegistration` returned by `.add(...)`, not a bare function. Store the registration when you subscribe and pass it back to `remove`.
- **`getMaterial` / `mainPass` are on `Image` and `MeshVisual`, not `Text`.** Calling `getMaterial(0)` on a `Component.Text` fails with TS2339. The display surface for a camera texture must be `Component.Image` (created via `sceneObject.createComponent("Component.Image")`) — never a Text component, even if you only want a flat quad.
- **Recompile TypeScript before wiring `@input`s from the editor / virtual scene.** Setting a script input via virtual-scene apply fails with `Script input '<name>' not found on ScriptComponent` until the `.ts` file is compiled. Save and let the editor recompile (or call `RecompileTypeScriptTool`) before applying inspector wiring.

## Core mental model

1. **Module asset, not module SceneObject.** `CameraModule` is an *asset*
   that you reference from a script input or via
   `require('LensStudio:CameraModule')`. It exposes
   `createCameraRequest()`, `createImageRequest()`, `requestCamera(req)`,
   `requestImage(req)`, `getSupportedImageResolutions()`.

2. **`requestCamera()` returns a live Texture handle.** Assign the same
   handle to an `Image.mainPass.baseTex`, to an `MLComponent` input, or to a
   `CropTextureProvider.inputTexture`. You usually do not re-assign per
   frame — the texture is updated in place.

3. **`onNewFrame` ticks the pipeline.** Subscribe to
   `(cameraTexture.control as CameraTextureProvider).onNewFrame` to receive
   `CameraFrame` events. Some downstream providers (e.g. crop) require at
   least one listener to stay warm — an empty handler is fine.

4. **Lifecycle:** never call `createCameraRequest()` inside `onAwake`. Bind
   `OnStartEvent` and unsubscribe in `OnDestroyEvent`.

---

## Quick reference

```typescript
// One-liner stream — see scripts/CameraFrameStream.ts for a full component
const cameraModule = require('LensStudio:CameraModule');
this.createEvent('OnStartEvent').bind(() => {
  const req = CameraModule.createCameraRequest();
  req.cameraId = CameraModule.CameraId.Default_Color;
  const tex = cameraModule.requestCamera(req);
  const provider = tex.control as CameraTextureProvider;
  provider.onNewFrame.add(() => {
    this.uiImage.mainPass.baseTex = tex;
  });
});
```

### Camera IDs

| ID | Use when |
| --- | --- |
| `CameraModule.CameraId.Default_Color` | Abstraction alias for the "preferred/default color camera" — resolves to the right camera under the hood. Recommended default; works in editor. |
| `CameraModule.CameraId.Left_Color` | Explicit left camera (CV). Use for depth-synchronized workflows — the depth module also uses left. |
| `CameraModule.CameraId.Right_Color` | Explicit right camera (RGB). Use for composite / paired-eye scenarios. Common choice on-device. |

A common pattern is to branch on `global.deviceInfoSystem.isEditor()` and use
`Default_Color` in the editor and `Right_Color` (or `Left_Color`) on device.

### Resolution

```typescript
const supported: vec2[] = cameraModule.getSupportedImageResolutions();
request.imageSmallerDimension = 352; // editor
// request.imageSmallerDimension = 756; // device
```

Use the **smallest** resolution that meets the goal. Higher resolutions
increase power draw and thermal load.

### Still images (device only)

```typescript
const req = CameraModule.createImageRequest();
req.imageSmallerDimension = 512;
const frame: ImageFrame = await cameraModule.requestImage(req);
const t = frame.timestampMillis;
this.uiImage.mainPass.baseTex = frame.texture;
```

### Intrinsics + project/unproject

```typescript
const cam = global.deviceInfoSystem.getTrackingCameraForId(
  CameraModule.CameraId.Left_Color
);
cam.focalLength;     // vec2
cam.principalPoint;  // vec2
cam.resolution;      // vec2
cam.pose;            // mat4 — offset from device reference frame

const pixel = cam.project(new vec3(x, y, z));        // → vec2 pixel
const point = cam.unproject(new vec2(u, v), depth);  // u,v normalized 0..1
```

### Crop pipeline

```typescript
const cropProvider = cropTexture.control as CropTextureProvider;
cropProvider.inputTexture = cameraTexture;
cropProvider.cropRect.left   = -0.2;
cropProvider.cropRect.right  =  0.2;
cropProvider.cropRect.bottom = -0.2;
cropProvider.cropRect.top    =  0.2;
```

Crop coordinates are normalized to `-1..1`. See
[scripts/CropCameraTexture.ts](resources/scripts/CropCameraTexture.ts) and
[scene-setup/crop-camera-texture.md](resources/scene-setup/crop-camera-texture.md).

### Sending a frame to an AI model

Encode the camera texture to JPEG (e.g. via the Remote Service Gateway's
`VideoController`) and send it as a media chunk to your model — Gemini Live,
OpenAI, etc. Trigger from `onNewFrame` and gate by a time budget so you do
not flood the network.

### Encoding a frame for upload / network send

`Base64.encodeTextureAsync` is the built-in path from a `Texture` to JPEG
bytes you can post to a backend (Snap Cloud bucket, REST endpoint, AI
service). Pair it with `Base64.decode` to get a `Uint8Array` directly —
no manual `charCodeAt` loop:

```typescript
const b64: string = await new Promise((resolve, reject) => {
  Base64.encodeTextureAsync(
    texture,
    (s) => resolve(s),
    () => reject(new Error("encode failed")),
    CompressionQuality.HighQuality,
    EncodingType.Jpg
  );
});
const bytes = Base64.decode(b64) as unknown as Uint8Array;
// → upload `bytes` to your backend
```

**Wait one frame before encoding.** Immediately after
`requestCamera()` the camera texture is not yet rendered (especially in
editor); encoding it returns a blank/uninitialized JPEG. Await a single
`onNewFrame` first, then read the texture:

```typescript
const camTex = this.cameraModule.requestCamera(req);
const provider = camTex.control as CameraTextureProvider;
await new Promise<void>((resolve) => {
  const reg = provider.onNewFrame.add(() => {
    provider.onNewFrame.remove(reg);
    resolve();
  });
});
// camTex is now safe to encode / upload / pass to ML
```

> **Uploading to a Snap Cloud bucket?** That's the
> [`specs-snap-cloud`](../specs-snap-cloud/SKILL.md) skill's territory. The bucket
> must exist before the first upload and have policies that match the
> auth pattern (anonymous vs Snapchat OIDC, public vs per-user reads).
> A 400 `Bucket not found` from the camera path is almost always a
> missing bucket + policies, not a camera-side bug.

---

## Building from the editor (minimum hierarchy)

Every camera workflow needs the same three things:

1. A **`CameraModule` asset** referenced from the script.
2. A **ScriptComponent** on a SceneObject, with the compiled `.ts` attached and its `@input` fields wired to assets/components.
3. Any **target assets** the script writes into (e.g. an `Image` component's `mainPass.baseTex`, a `Material` for the panel, a `CropTextureProvider` texture).

### Mandatory wiring sequence (virtual-scene / MCP)

Follow this order exactly — skipping a step produces the errors `Script input '<name>' not found`, `Property '<name>' not found`, `Asset not found at path: ...`, or `Value is not a native object`:

1. **Write the `.ts` file** with `@input` declarations.
2. **Recompile TypeScript** (`RecompileTypeScriptTool`) — without this, the ScriptComponent has no addressable inputs.
3. **Create all asset dependencies** (`CameraModule`, `Material`, `Texture`, crop provider, etc.) and **capture each returned UUID**.
4. **Create the SceneObject and attach the ScriptComponent** referencing the compiled script asset.
5. **Recompile again** so the ScriptComponent picks up the `@input` schema, then **wire `@input` fields**. Use `setProperty` on the ScriptComponent (not `modify.component`, which targets native component properties and fails with `Property '<name>' not found` for script inputs). Use `propertyPath` = the exact `@input` name from the `.ts` (e.g. `camModule`, `cameraSelection`, `cropTexture`, `imageMaterial`) and `value` = `@id:<uuid>` for asset-typed inputs. Never pass an asset *name* string like `"CameraModule"` — it will fail with `Asset not found at path: ...`.

If you rename an `@input` in the `.ts`, you must recompile again before re-wiring.

**Error decoder:**

- `Script input '<name>' not found` → ScriptComponent schema is stale. Recompile, then re-read the scene so you get the refreshed ScriptComponent id before wiring.
- `Property '<name>' not found` → you used `modify.component` on a script `@input`. Switch to `setProperty` on the ScriptComponent.
- `Value is not a native object` → you passed a raw string for an asset input. Use `@id:<uuid>`.
- `Asset not found at path: <Name>` → display-name lookup is not supported. Use `@id:<uuid>` captured from the asset's create response.

The three `scene-setup/*.md` recipes are extracted from real scene files
and list the exact hierarchy, asset list, and script-input wiring needed
for the three main patterns. They are intentionally hierarchy-only — they
do not depend on any package outside `resources/scripts/`.

---

## Findings — lessons from real builds

The failure modes for the "see what the camera sees" panel (world-space
Canvas, `ScreenTransform.offsets`, Z + renderOrder, clone-per-panel,
`ENABLE_BASE_TEX`, wait-one-`onNewFrame`, `Base64.decode`, one
`requestCamera()` per scene, composite-needs-Render-Target, capture from
crop, `requestImage` device-only, ratio = crop not scale, SUIK Button +
ElementContent) are catalogued in the "Why this layout" section of
[scene-setup/camera-panel-with-capture-and-ratio.md](resources/scene-setup/camera-panel-with-capture-and-ratio.md)
and encoded into [CameraSetup.ts](resources/scripts/CameraSetup.ts). Read
that recipe before improvising a different layout.

## Notes & gotchas

- `Left_Color` is the camera you want when correlating with depth frames —
  the depth module is left-camera aligned.
- The `CropTextureProvider` only ticks while there is at least one
  `onNewFrame` listener on the upstream camera texture — register an empty
  handler if nothing else is consuming it.
