<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Composite Camera Texture — Scene Setup

Shared camera service that publishes the camera texture once and lets other
scripts / images / render targets consume it without re-requesting the
camera. Use this whenever more than one feature needs the same frame
(e.g. an Image panel + an ML pipeline + a recording encoder).

> Calling `requestCamera()` from multiple scripts on the same camera ID
> causes conflicts. The Composite pattern centralizes the request.

## Scene hierarchy

```
Scene
├── Camera Object                 (Camera, Perspective)
├── Device Tracking               (DeviceTracking, Mode: World)
├── CompositeImage                (SceneObject, ScreenTransform)
│   ├── Image                     (Component.Image — shows the feed)
│   └── ImageVirtContent          (optional — extra layers composited on top)
├── CameraServiceObject           (SceneObject)
│   └── CameraService             (ScriptComponent — CompositeCameraService)
└── Render Target / Screen Region (optional — for off-screen composition)
```

## Required assets

| Asset                  | Type                    | Purpose                                                 |
| ---------------------- | ----------------------- | ------------------------------------------------------- |
| `CameraModule`         | `CameraModule`          | Live camera access                                      |
| `Screen Crop Texture`  | `Texture` (Crop)        | `inputTexture` is filled with the camera texture so      |
|                        |                         | downstream consumers can crop / sample it                |
| `Editor Camera`        | `Camera`                | The scene camera used for editor preview / compositing   |

## Wiring on `CameraService`

| Input               | Reference                                          |
| ------------------- | -------------------------------------------------- |
| `editorCamera`      | Scene `Camera` component                           |
| `screenCropTexture` | Crop texture asset                                 |
| `camModule`         | `CameraModule` asset                               |

## Replicating from the scene file

```yaml
- ScriptComponent: CameraService
  ScriptInputs:
    editorCamera:      reference.Camera        -> Camera Object/Camera
    screenCropTexture: reference.Texture       -> crop texture asset
    camModule:         reference.CameraModule  -> CameraModule asset
```

## Runtime flow

1. `start()` runs on `OnStartEvent`.
2. Camera ID is selected per platform:
   - `Default_Color` in the Lens Studio editor
   - `Right_Color` on the device (paired-eye color, suitable for composite)
3. `requestCamera()` returns the live `Texture`. The script exposes it as
   `cameraTexture` and `cameraTextureProvider` so other scripts can grab it:

   ```typescript
   const svc = sceneObject.getComponent("Component.ScriptComponent") as CameraService
   const tex = svc.cameraTexture                 // assign to materials / Image
   const provider = svc.cameraTextureProvider     // .onNewFrame.add(...)
   ```

4. The crop texture's `control.inputTexture` is hooked to the camera
   texture so any downstream crop sampling works automatically.
5. An empty `onNewFrame` handler is registered to keep the pipeline warm
   (the texture only ticks while there is at least one listener).

## When to pick this over the basic stream

- More than one consumer needs the same frame.
- You want to layer additional content on top of the camera image
  (composite UI, virtual objects, recorded overlay).
- You want a single owner for the camera lifecycle.

For a simple "show the camera in front of me" panel, the
[basic-camera-panel](basic-camera-panel.md) hierarchy with
`CameraFrameStream.ts` is enough.
