<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Migration: Camera

**When this applies:** any match for `StereoCameraModule`, `stereoCameraModule`, or
`CameraRawModule` in the project scan.

Replace deprecated `StereoCameraModule` and `CameraRawModule` with the unified `CameraModule`.

## Detection Patterns

- `StereoCameraModule`
- `stereoCameraModule`
- `CameraRawModule`

## Migration Steps

### Remove old input declarations

The old `StereoCameraModule` input is not needed — `CameraModule` is loaded via `require()` in code (see the next step). Remove the input entirely:

```ts
// OLD — remove this decorator and property
@input
stereoCameraModule: StereoCameraModule
```

### Replace camera access with CameraModule request pattern

```js
// OLD
// Direct StereoCameraModule access (varies by Lens)

// NEW
let cameraModule = require('LensStudio:CameraModule');
let request = cameraModule.createCameraRequest();
request.cameraId = cameraModule.CameraId.Left_Color;  // or Right_Color, Default_Color
let texture = cameraModule.requestCamera(request);
```

### Dual camera access

If the Lens accesses both left and right cameras, create two requests with different `cameraId` values:

```js
let leftRequest = cameraModule.createCameraRequest();
leftRequest.cameraId = cameraModule.CameraId.Left_Color;
let leftTexture = cameraModule.requestCamera(leftRequest);

let rightRequest = cameraModule.createCameraRequest();
rightRequest.cameraId = cameraModule.CameraId.Right_Color;
let rightTexture = cameraModule.requestCamera(rightRequest);
```

### CameraRawModule

Remove any `CameraRawModule` references. It was an empty private class with no replacement needed.

### High-res still image capture

If the Lens captures still images, use a capture session on a stream that supports stills
(Lens Studio 5.25+; `createImageRequest()` / `requestImage()` no longer exist). Full pattern:
`specs-camera`.

```ts
const stream = cameraModule.getCameras()
  .map((camera) => camera.getStreams().find((s) => s.operation === CameraModule.Operation.Capture))
  .find((s) => s !== undefined)
if (stream) {
  const config = new CameraModule.StreamConfig()
  config.stream = stream
  const session = cameraModule.createCaptureSession()
  if (session.start(config) === CameraModule.Result.Success) {
    const frame = await session.capture() // frame.texture; stop() the session when done
  }
}
```

In the Lens Studio Preview no stream supports stills, so test still capture on device.

## CameraId enum values

- `Default_Color` — default device camera
- `Left_Color` — left stereo camera
- `Right_Color` — right stereo camera
