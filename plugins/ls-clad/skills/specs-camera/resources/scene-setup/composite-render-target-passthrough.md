<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Composite Camera — Render Target Passthrough

How to make virtual scene content show up *inside* the captured texture
(and, as a side effect, get an infinite-mirror feedback loop on the live
panel when you display the composite in front of the camera).

This pattern is what you reach for when the question is **"how do I get
augmented virtual content baked into the camera capture?"** rather than
just **"how do I see what the camera sees?"**.

## Concept

The Lens Studio scene already has a passthrough composite pipeline:

```
Device Camera Texture  ──background──▶  Render Target  ◀──renders──  Main Camera
                                          │
                                          ▼ visible on the Specs display
```

The **Render Target** is the texture the main scene Camera writes to. Its
background is the **Device Camera Texture** (raw camera feed), and on top
of that the scene Camera draws every world-space object, UI panel, etc.

Normally you would point a crop / capture pipeline at the raw camera
texture. For composite captures, point it at the **Render Target**
instead — anything the user can see is now in the captured image.

## Scene hierarchy at edit time (minimum)

```
Scene
├── Camera Object                 (Camera, Perspective — writes to Render Target)
├── Device Tracking               (DeviceTracking, Mode: World)
├── CameraServiceObject           (SceneObject)
│   └── ScriptComponent: CameraCompositeRenderService
└── CameraSetup (display)         (SceneObject — display script that consumes cropTexture)
```

> The display script is the same `CameraSetup.ts` as in
> [camera-panel-with-capture-and-ratio](camera-panel-with-capture-and-ratio.md),
> with the `startCameraStream()` block **stripped of `requestCamera`** —
> only the composite service may call `requestCamera()`.
>
> Replace the request lines with a no-op that just consumes the
> already-wired crop texture:
>
> ```typescript
> private startCameraStream(): void {
>   // Composite pattern: CameraCompositeRenderService owns requestCamera()
>   // and has already wired cropTexture.inputTexture to the scene Render Target.
>   this.applyCrop();
>   if (this.liveMat && this.cropTexture) {
>     this.liveMat.mainPass.baseTex = this.cropTexture;
>   }
> }
> ```

## Required assets

| Asset                 | Type                              | Purpose                                                  |
| --------------------- | --------------------------------- | -------------------------------------------------------- |
| `CameraModule`        | `CameraModule`                    | Keeps the camera pipeline awake                          |
| `ScreenCropTexture`   | `Texture` (`RectCropTextureProvider`) | Cropped output consumed by display + capture        |
| `Render Target`       | `Texture` (Render Target)         | Project-default RT the main Camera renders into          |
| `Device Camera Texture` | `Texture` (Device Camera Texture) | RT's background — the raw passthrough feed (no wiring required, it is already the background of Render Target) |

## Wiring on `CameraCompositeRenderService`

| Input               | Reference                                              |
| ------------------- | ------------------------------------------------------ |
| `camModule`         | `CameraModule` asset                                   |
| `screenCropTexture` | `ScreenCropTexture` asset                              |
| `sceneRenderTarget` | The scene `Render Target` texture                      |

## Why this works

1. The main scene Camera continuously renders its view (camera background +
   all scene content) into the Render Target.
2. `CameraCompositeRenderService` calls `requestCamera()` once — this keeps
   the camera frame pipeline ticking (which in turn keeps the Render
   Target's background alive). The handle itself is published on the
   component but the crop provider is **not** pointed at it.
3. `cropTexture.control.inputTexture = sceneRenderTarget` so every
   consumer of the crop texture (display panel, capture button via
   `cropTexture.copyFrame()`) sees the composite.
4. The display script no longer calls `requestCamera()` (would conflict
   with the service); it just consumes `cropTexture` like before.

## Infinite-mirror sanity check

If the live display panel reads from the crop texture, and the panel itself
is in the scene that the main Camera renders into the Render Target, you
get a tight feedback loop:

```
Camera feed  ─▶  Render Target  ─▶  CropTexture  ─▶  LiveFeed Image panel  ─┐
                          ▲                                                  │
                          └──────── main Camera redraws scene ◀──────────────┘
```

The panel will show a recursively-nested version of itself — that's the
"infinite mirror" effect, and it is the cheapest way to verify the
composite pipeline is alive.

## Captures now include virtual content

The capture button is unchanged:

```typescript
const frozen = this.cropTexture.copyFrame();
this.capturedMat.mainPass.baseTex = frozen;
```

Because `cropTexture` is sourced from the Render Target, the frozen frame
contains the real-world camera feed **plus** anything the scene Camera
drew (UI, 3D, text, particles…).

## Gotchas

- **Only one `requestCamera()` per scene.** The service owns it. The
  display script must drop its `createCameraRequest()` /
  `requestCamera()` block, otherwise both scripts compete and one of
  them silently loses.
- **Ratio cropping still works** — `cropRect` is recomputed on the same
  crop provider; the upstream change is just what feeds `inputTexture`.
- **Privacy still applies** — accessing the camera still disables open
  internet (Extended Permissions required for camera + internet, not
  publishable publicly).
