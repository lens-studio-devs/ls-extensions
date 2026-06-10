<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Migration: Depth

**When this applies:** any match for `DepthTextureProvider` (excluding `DepthModule`),
`WorldDepthTextureProvider`, or `sampleDepthAtPoint` in the project scan.

Replace deprecated `DepthTextureProvider` / `WorldDepthTextureProvider` (point-sampling) with
the new `DepthModule` / `DepthFrameSession` (frame-based) API.

This is a **paradigm change**, not a 1:1 method swap. Show the user the before/after code and
ask them to verify the depth data usage makes sense for their Lens logic before finalizing.

## Detection Patterns

- `DepthTextureProvider` (excluding matches that are part of `DepthModule`)
- `WorldDepthTextureProvider`
- `sampleDepthAtPoint`

## Migration Steps

### Add the DepthModule require

```js
let depthModule = require("LensStudio:DepthModule");
```

### Replace the sampling pattern with a session-based pattern

```js
// OLD
let depth = depthTextureProvider.sampleDepthAtPoint(point);
let scale = depthTextureProvider.getScale();

// NEW
let session = depthModule.createDepthFrameSession();
session.onNewFrame.add(function(data) {
    // data.depthFrame - Float32Array of depth values in centimeters
    // data.timestampSeconds - frame timestamp
    // data.deviceCamera - camera intrinsics for unprojection
    // data.toWorldTrackingOriginFromDeviceRef - transform matrix
});
session.start();
```

### Key differences to explain to the user

- **Old:** synchronous point queries (`sampleDepthAtPoint(vec2)`) returning a single depth value
- **New:** asynchronous frame callbacks with the full depth buffer as `Float32Array` in centimeters
- Old `getScale()` and `getDepthToDisparityNumerator()` have no direct equivalent — depth values in the new API are already in centimeters
- Code that called `sampleDepthAtPoint` in a render loop must be refactored to cache the latest `DepthFrameData` from the event and sample from `data.depthFrame`

### Clean up old references

Remove old `DepthTextureProvider` or `WorldDepthTextureProvider` references and resource assignments.

### WorldDepthTextureProvider world-space transform

If the Lens used `WorldDepthTextureProvider`, note that `DepthFrameData.toWorldTrackingOriginFromDeviceRef` provides the equivalent world-space transform.

### Session lifecycle

Remind the user to call `session.stop()` when depth data is no longer needed to avoid unnecessary processing.
