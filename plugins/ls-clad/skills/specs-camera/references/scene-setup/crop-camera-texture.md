<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Crop Camera Texture — Scene Setup

Picture-in-picture / region-of-interest extraction from the live camera using
a `CropTextureProvider`. The script (`CropCameraTexture.ts`) takes the raw
camera feed, pipes it through a crop texture asset, and shows the cropped
result on a UI `Image`.

## Scene hierarchy

```
Scene
├── Camera Object                 (Camera, Perspective)
├── Device Tracking               (DeviceTracking, Mode: World)
├── CropCameraController          (SceneObject)
│   ├── CameraTexture             (ScriptComponent — CropCameraTexture)
│   └── Image                     (Component.Image — assigned to uiImage)
```

## Required assets

| Asset                  | Type                    | Purpose                                          |
| ---------------------- | ----------------------- | ------------------------------------------------ |
| `CameraModule`         | `CameraModule`          | Live camera access                               |
| `Screen Crop Texture`  | `Texture` (Crop)        | Has a `CropTextureProvider`; receives the raw   |
|                        |                         | camera texture as its `inputTexture`            |
| `Image Material`       | `Material`              | Applied to the `Image`; its `mainPass.baseTex` |
|                        |                         | is assigned the cropped texture                  |

To create the crop texture: in the Asset Browser, **+ → Texture → Crop
Texture** (or duplicate the one in the reference project). Its `control`
exposes `inputTexture` and `cropRect { left, right, bottom, top }`.

## Wiring on `CameraTexture` (CropCameraTexture.ts)

| Input             | Reference                                                          |
| ----------------- | ------------------------------------------------------------------ |
| `uiImage`         | `Image` component under the controller                             |
| `screenTexture`   | The crop texture asset                                             |
| `camModule`       | The `CameraModule` asset                                           |
| `cropLeft/Right/Bottom/Top` | -1..1 normalized crop bounds (default ±0.2 for a centered tight crop) |

## Replicating from the scene file

The reference scene contains a single `__PLACE_IN_SCENE` parent containing
the script and the display Image:

```yaml
- SceneObject: CropCameraTextureTS - __PLACE_IN_SCENE
  Components:
    - ScriptComponent: CameraTexture
      ScriptInputs:
        uiImage:       reference.Image          -> sibling Image
        screenTexture: reference.Texture        -> crop texture asset
        camModule:     reference.CameraModule   -> CameraModule asset
        cropLeft:   -0.8
        cropRight:   0.8
        cropBottom: -0.8
        cropTop:     0.8
  Children:
    - Image   # the display panel
```

## Runtime flow

1. `setupCamera()` runs on `OnStartEvent`.
2. `CameraModule.createCameraRequest()` is built and `requestCamera()`
   returns the live `Texture`.
3. The crop texture's `control.inputTexture` is set to the camera texture.
4. The crop rect is written from the script inputs.
5. `onNewFrame` updates `uiImage.mainPass.baseTex = getCameraTexture()`, so
   the panel shows the cropped region every frame.

Use `getOriginalCameraTexture()` if you also need the uncropped feed
(e.g. ML on full frame, crop only for display).

## Resolution

The script picks `imageSmallerDimension`:

- `352` in the Lens Studio editor
- `756` on device

Prefer the smallest resolution that meets your needs — higher = more power
and thermal load.
