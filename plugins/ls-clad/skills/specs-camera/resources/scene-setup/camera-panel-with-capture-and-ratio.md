<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Camera Panel — Live Feed + Freeze-Frame Capture + Ratio Crop

The fuller "viewfinder + photo" pattern paired with
[scripts/CameraSetup.ts](../scripts/CameraSetup.ts).

Two side-by-side image panels:

- **Left** — live camera feed (streams every frame).
- **Right** — captured still (frozen via `Texture.copyFrame()`).

A button bar below cycles aspect ratios (`16:9 → 4:3 → 1:1`) by changing
the crop, not the panel scale, and triggers capture.

The script builds the entire UI from a single SceneObject at runtime — the
scene side is just the root and a handful of asset references.

## Scene hierarchy at edit time (minimum)

```
Scene
├── Camera Object                 (Camera, Perspective)
├── Device Tracking               (DeviceTracking, Mode: World)
└── CameraSetup                   (SceneObject — script attaches here)
    └── ScriptComponent: CameraSetup
```

## Runtime hierarchy (what the script creates)

```
CameraSetup
└── Canvas                        (Component.Canvas, World units, 40×30 cm)
    ├── BackPlate                 (SUIK BackPlate, dark, 40×30 cm, z=-0.1)
    ├── LiveFeed                  (SceneObject, z=+0.1)
    │   └── ScreenTransform + Image  (renderOrder=10, baseTex = cropTexture)
    ├── Captured                  (SceneObject, z=+0.1)
    │   └── ScreenTransform + Image  (renderOrder=10, baseTex = frozen copy)
    └── ButtonBar
        ├── Capture button        (SUIK Button "Primary", Capsule)
        └── Ratio button          (SUIK Button "Secondary", Capsule)
```

## Required assets

| Asset                 | Type                          | Purpose                                              |
| --------------------- | ----------------------------- | ---------------------------------------------------- |
| `CameraModule`        | `CameraModule`                | Live camera access                                   |
| `ImageMaterial`       | `Material` (unlit, image)     | **Base** material — the script `.clone()`s it per   |
|                       |                               | panel so each Image owns its own `baseTex`           |
| `ScreenCropTexture`   | `Texture` with                | Wraps the camera texture; ratio cycling rewrites    |
|                       | `RectCropTextureProvider`     | its `cropRect` to produce a true cropped output      |

To make the crop texture: **Asset Browser → + → Texture → Screen Crop
Texture** (the variant whose `control` is a `RectCropTextureProvider`).

## Wiring on the `CameraSetup` ScriptComponent

| Input             | Reference                                                  |
| ----------------- | ---------------------------------------------------------- |
| `camModule`       | `CameraModule` asset                                       |
| `imageMaterial`   | Base `ImageMaterial` (will be cloned per panel)            |
| `cropTexture`     | `ScreenCropTexture` asset                                  |
| `cameraSelection` | `Default_Color` (editor) / `Right_Color` (device)          |

## Runtime flow

1. `OnStartEvent` → `buildUI()` creates the Canvas, BackPlate, two
   Images, and the SUIK button bar.
2. `applyRatio()` resizes both Image `ScreenTransform`s to the target
   aspect (panel size).
3. `startCameraStream()` calls `CameraModule.createCameraRequest()`,
   `requestCamera()`, wires the crop provider's `inputTexture` to the
   live camera texture, and assigns `cropTexture` to the **live**
   panel's material `baseTex`. An empty `onNewFrame` handler keeps the
   pipeline warm.
4. `applyCrop()` writes the crop rectangle based on source vs. target
   aspect — the only thing that actually changes when ratios cycle is
   the crop rect (and the panel size).
5. `capturePhoto()` calls `cropTexture.copyFrame()` (falling back to
   `cameraTexture` if no crop) and assigns the frozen `Texture` to the
   right panel's `baseTex`. The left panel keeps streaming.

## Key formulas — aspect-correct crop

```typescript
const sourceAspect = 4 / 3;
const targetAspect = ratios[idx].v;
let halfW = 1, halfH = 1;
if (targetAspect > sourceAspect) {
  // Target wider → keep full width, crop top/bottom
  halfH = sourceAspect / targetAspect;
} else {
  // Target taller (or equal) → keep full height, crop left/right
  halfW = targetAspect / sourceAspect;
}
cropRect.left   = -halfW;
cropRect.right  =  halfW;
cropRect.bottom = -halfH;
cropRect.top    =  halfH;
```

## Why this layout (and not other things I tried first)

These are the failure modes that pushed the design here — keep them in
mind if you start changing it:

- **Don't use `RenderMeshVisual` planes** for the panels. They render
  in world space and ignore `ScreenTransform`, which makes layout fight
  you. Use `Component.Image` + `ScreenTransform` on an empty
  SceneObject.
- **Don't use SUIK `Frame` with `FlexLayout`** to host the camera
  images — the Image children do not receive a sized Canvas context
  from inside a Frame, so they render at full screen.
- **Do use a world-space `Canvas`** as the parent: `unitType = World`,
  `offsetUnit = World`, `setSize(new vec2(40, 30))`. That is what gives
  the child `ScreenTransform`s a cm-based coordinate system.
- **Position with `ScreenTransform.offsets`, not Transform xy.**
  `ScreenTransform` overrides the Transform's x/y every frame. Set
  `offsets.left/right/bottom/top` in cm.
- **Z and renderOrder both matter.** Push image SceneObjects to
  local `z = 0.1` *after* attaching components (so ScreenTransform
  doesn't reset it), call `image.setRenderOrder(10)`, and put the
  BackPlate at `z = -0.1`. Without both you'll get z-fighting or the
  BackPlate covering the images.
- **Clone the material per panel.** Each Image needs its own
  `mainMaterial` instance so they don't share a `baseTex` — otherwise
  capturing into the right panel also replaces the left.
- **`requestImage` is device-only.** Calling it in the editor logs
  *"Image request not supported. Please check requirements."*. For an
  editor-friendly capture, use `Texture.copyFrame()` on the camera (or
  crop) texture — works in editor and on device.
- **Ratio = crop, not scale.** Resizing the panel without changing the
  source texture stretches the image. The right path is a
  `RectCropTextureProvider` whose `cropRect` you recompute against the
  source aspect.
- **Enable `ENABLE_BASE_TEX` on the source `ImageMaterial`.** The unlit
  preset ships with this define **off**, so a cloned material whose
  `baseTex` you set will render fully white — the texture sampler is
  simply not compiled in. Enable the define on the source material
  (`mat.mainPass.ENABLE_BASE_TEX = true` via Editor API, or toggle it in
  the material inspector). Clones inherit the define from the source.
  Symptom: live feed panels are solid white squares.
- **Wait one `onNewFrame` before reading the texture.** Right after
  `requestCamera()` the camera texture exists as a handle but the GPU
  hasn't filled it yet — most obviously in editor. If you encode or
  upload the texture immediately you'll get a blank/uninitialized
  JPEG. Await a single frame first, then read it.
- **`Base64.decode(b64)` returns bytes directly** — assign it to a
  `Uint8Array`. Don't loop `charCodeAt` over a string; that pattern
  comes from generic JS code and is unnecessary here.
- **Only one `requestCamera()` per scene.** As soon as two scripts both
  try to own the camera (e.g. a display script *and* a composite
  service), they silently conflict and one wins. When you graduate to a
  shared / composite pattern, strip `createCameraRequest()` /
  `requestCamera()` out of the display script and let the service script
  publish the texture.
- **Composite captures need the Render Target, not the raw camera.**
  To bake virtual scene content into the captured frame, point the crop
  provider's `inputTexture` at the scene `Render Target` (what the main
  Camera renders into), not at the camera texture. The Device Camera
  Texture is already the RT's background, so the RT is "camera feed +
  everything the scene Camera drew". Capturing via
  `cropTexture.copyFrame()` then includes any UI, 3D, or overlay content
  visible to the scene Camera. Pointing a visible Image panel back at
  the same composite produces an intentional infinite-mirror feedback
  loop — a cheap way to verify the pipeline is alive.
- **Capture from the crop, not the raw camera.** When you copy a
  frame for the captured panel, copy from `cropTexture`
  (`cropTexture.copyFrame()`) so the snapshot reflects the currently
  selected ratio.
- **SUIK Button + ElementContent is the control surface.** Don't
  build raw mesh / material / Interactable buttons; use
  `Button.getTypeName()` + `ElementContent.getTypeName()`, set
  `_themeOverride = "SnapOS2"`, `_shapeSnapOS2 = "Capsule"`, and
  `_styleSnapOS2 = "Primary" | "Secondary" | "Ghost"`.
