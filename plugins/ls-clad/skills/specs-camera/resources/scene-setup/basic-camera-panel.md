<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Basic Camera Panel — Minimum Hierarchy

A flat panel anchored in front of the user that displays the live camera
feed on an `Image` component. The canonical "see what the camera sees"
setup. Pairs with [scripts/CameraFrameStream.ts](../scripts/CameraFrameStream.ts)
or [scripts/StillImageCapture.ts](../scripts/StillImageCapture.ts).

**Both scripts are programmatic-first — they have zero `@input` fields.**
Drop the component onto a SceneObject and it builds its own display
panel and resolves the `CameraModule` via `require`. No editor wiring is
required.

## Scene hierarchy at edit time (minimum)

```
Scene
├── Camera Object                 (Camera, Perspective)
├── Device Tracking               (DeviceTracking, Mode: World)
└── CameraController              (SceneObject)
    └── CameraFrameStream         (ScriptComponent — no inputs)
```

That is the entire edit-time setup. The script creates a child Canvas
+ ScreenTransform + Image at runtime.

## Runtime hierarchy (created by the script)

```
CameraController
└── CameraFrameStreamCanvas       (Component.Canvas, World units, 32×18 cm)
    └── CameraFrameStreamImage    (ScreenTransform + Image, z=0.1, order=10)
```

## Required assets

None. The `CameraModule` is resolved via
`require('LensStudio:CameraModule')`, the camera is picked by branching
on `global.deviceInfoSystem.isEditor()`, and the display surface is
generated programmatically.

## Wiring

Nothing to wire — `@input` fields are intentionally absent. If you need
to bind the live texture to an **existing** authored Image, set the
script's public `displayImage` property from another script before
`OnStartEvent` fires.

## Privacy note

Camera + internet is publishable via Transparent Permission. See
[docs/transparent-permission.mdx](../docs/transparent-permission.mdx).
