---
name: specs-depth
description: Access real-time depth frames on Specs via DepthModule — per-pixel depth, back-projection to world space, camera intrinsics, and a depth+color snapshot cache for AI grounding. Load for depth AR placement, occlusion, or spatial queries.
user-invocable: false
paths: "**/*.ts"
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Depth Module — Depth Frame Access

**Requirements:** Experimental API — requires camera access; see the Project settings note below.

Reference: `Spatial Image/`, `Depth Cache/`

**Choose your pattern:**
- **Raw per-frame access** (live depth stream, occlusion, continuous spatial queries) → use the [Full Component](#full-component) below.
- **Snapshot a depth+color pair** (send color image to AI, get pixel coords back, place AR content in 3D) → use the [Depth Cache pattern](#depth-cache-pattern--snapshot--pixel-to-world).
- **Visualize depth in world space** (debug the depth feed, render a live point cloud over real surfaces) → use the [Depth Texture pattern](#depth-texture-pattern--world-space-visualization).

**Combining depth with AI vision models** (cache a frame, send to AI, project returned pixel coords to 3D) → see [`resources/docs/depth-and-ai.mdx`](resources/docs/depth-and-ai.mdx) for the end-to-end flow and the skill boundary.

**Skill hand-offs (don't duplicate here):**
- Sending the cached color frame to Gemini / OpenAI / DALL·E for vision or grounding → load `specs-ai-remote-service`. This skill stops at producing a `Texture` and a pixel→world function; the AI side lives there.
- Surface placement against real-world geometry (raycasts vs. depth) → load `specs-world-query`.
- Color-camera frame access details (request flow, `CameraTextureProvider`) → load `specs-camera`.

---

## Setup

```typescript
private depthModule: DepthModule = require('LensStudio:DepthModule')
```

> `createDepthFrameSession()` must NOT be called inside `onAwake`. Use `OnStartEvent`.

---

## Full Component

```typescript
@component
export class DepthFrameReader extends BaseScriptComponent {
  private depthModule: DepthModule = require('LensStudio:DepthModule')
  private session: DepthFrameSession
  private frameRegistration: EventRegistration

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.startSession())
    this.createEvent('OnDestroyEvent').bind(() => this.stopSession())
  }

  private startSession(): void {
    this.session = this.depthModule.createDepthFrameSession()

    this.frameRegistration = this.session.onNewFrame.add(
      (data: DepthFrameData) => this.onDepthFrame(data)
    )

    this.session.start()
  }

  private onDepthFrame(data: DepthFrameData): void {
    const cam = data.deviceCamera

    // --- Sample depth at a specific pixel ---
    const px = 112, py = 80
    const idx = Math.floor(px + py * cam.resolution.x)
    const depthValue = data.depthFrame[idx]  // depth in centimeters

    // --- Back-project pixel to 3D in device reference space ---
    const uv = new vec2(px / cam.resolution.x, py / cam.resolution.y)
    const point3dDeviceRef = cam.unproject(uv, depthValue)

    // --- Transform to world space ---
    const worldFromDeviceRef = data.toWorldTrackingOriginFromDeviceRef
    const point3dWorld = worldFromDeviceRef.multiplyPoint(point3dDeviceRef)

    print("[Depth] 3D point in world: " + point3dWorld)
  }

  private stopSession(): void {
    if (this.session && this.frameRegistration) {
      this.session.onNewFrame.remove(this.frameRegistration)
      this.session.stop()
    }
  }
}
```

---

## DepthFrameData Properties

```typescript
session.onNewFrame.add((data: DepthFrameData) => {
  // Camera info for this depth frame
  const cam = data.deviceCamera
  print("Resolution: " + cam.resolution)          // vec2 in pixels
  print("Focal length: " + cam.focalLength)       // vec2
  print("Principal point: " + cam.principalPoint) // vec2
  print("Camera pose: " + cam.pose)               // mat4

  // Depth array — Float32Array per pixel, in centimeters
  const depth: Float32Array = data.depthFrame

  // Transform: device reference → world tracking origin (mat4)
  const worldFromDevice: mat4 = data.toWorldTrackingOriginFromDeviceRef

  // Timestamp — use to sync with CameraModule color frames
  const ts: number = data.timestampSeconds
})
```

---

## Depth + Color Frame Sync

Depth is estimated from the **left color camera** on Spectacles '24. Sync frames by comparing timestamps:

```typescript
// From CameraModule (color) frame:
provider.onNewFrame.add((colorFrame) => {
  const colorTs = colorFrame.timestampMillis / 1000  // convert to seconds
  // Match with depthFrame.timestampSeconds
})
```

---

## Iterate All Pixels

```typescript
private onDepthFrame(data: DepthFrameData): void {
  const cam = data.deviceCamera
  const w = cam.resolution.x
  const h = cam.resolution.y
  const depth = data.depthFrame
  const world = data.toWorldTrackingOriginFromDeviceRef

  for (let py = 0; py < h; py += 4) {  // sample every 4th row for perf
    for (let px = 0; px < w; px += 4) {
      const d = depth[Math.floor(px + py * w)]
      if (d <= 0) continue  // invalid depth

      const uv = new vec2(px / w, py / h)
      const p = cam.unproject(uv, d)
      const worldPt = world.multiplyPoint(p)
      // use worldPt...
    }
  }
}
```

---

## Depth Cache pattern — snapshot + pixel-to-world

Reusable component: [`resources/scripts/DepthCache.ts`](resources/scripts/DepthCache.ts) — drop into `Assets/Scripts/`.

It does three things:
1. Continuously pairs each depth frame (~5Hz) with the closest left-color frame (~30Hz).
2. `saveDepthFrame()` → returns an ID; freezes the latest pair so the color frame and the depth+pose data stay aligned even after the user finishes "thinking" / awaiting an API response.
3. `getWorldPositionWithID(pixelPos, id)` → remaps color UV → depth UV, samples a **3×3 median depth** (robust to noise/holes), then unprojects + multiplies by the cached pose to return a `vec3` in world space.

**Usage:**

```typescript
@input depthCache: DepthCache

private async onUserAsk(prompt: string) {
  const depthFrameID = this.depthCache.saveDepthFrame()
  const camImage = this.depthCache.getCamImageWithID(depthFrameID)

  // Hand off to specs-ai-remote-service skill for the vision call
  const response = await this.gemini.makeGeminiRequest(camImage, prompt)

  for (const point of response.points) {
    const worldPos = this.depthCache.getWorldPositionWithID(point.pixelPos, depthFrameID)
    if (worldPos != null) this.placeLabel(point.label, worldPos)
  }
  this.depthCache.disposeDepthFrame(depthFrameID)
}
```

`DepthCache.ts` uses **3×3 median sampling**, **deep-copies the depth buffer + pose** (`.slice()` the Float32Array and `mat4.fromColumns(...)` the matrix at capture time, or the cached entry silently mutates to the latest frame), and **remaps color UV → depth UV** (on Spectacles '24 the depth frame is a cropped, downscaled view of the left color frame, not the same image) — see the JSDoc in [`resources/scripts/DepthCache.ts`](resources/scripts/DepthCache.ts) for the full rationale.

---

## Recommended scene setup

For the snapshot pattern (mirrors `specs-samples/Depth Cache`):

```
Scene
├── Camera (Perspective, Device Tracking: World)
├── DepthCache (SceneObject)
│   └── DepthCache.ts          @input camModule → Camera Module asset
├── SceneController (SceneObject)
│   └── YourController.ts      @input depthCache → DepthCache component
└── (your AR content roots — labels, markers, etc.)
```

**Required assets in Asset Browser:**
- `Camera Module` asset (created via Asset Browser → "+" → Camera Module)
- `DepthModule` is `require()`'d at runtime — no asset needed.

**Project settings:**
- Enable **Camera access** in Project Info (this disables open internet — use Extended Permissions during development if you also need network).
- Add **Spectacles Interaction Kit** only if you want pinch / hand input to trigger snapshots; otherwise not required.
- Lens Studio Preview does **not** stream depth — test on-device.

---

## Depth Texture pattern — world-space visualization

Render the live depth feed as a **point cloud locked to real surfaces** — the best way to *see* that depth is working and to debug placement, since it doesn't depend on reading log values.

Reusable components: [`resources/scripts/DepthTextureHandler.ts`](resources/scripts/DepthTextureHandler.ts) + [`resources/scripts/CameraModel.ts`](resources/scripts/CameraModel.ts) (adapted from the internal `LabsCvLenses/DepthTexture` sample).

How it works:
1. Each depth frame, build a `CameraModel` from the frame's intrinsics and feed the **inverse intrinsic matrix** + **`deviceCamera.pose`** into a custom instanced material (`mainPass.cameraFromDepthPixel`, `mainPass.deviceRefFromCamera`).
2. Upload the raw depth buffer into an `R32Float` `ProceduralTexture` (`setPixelsFloat32`) — one instanced plane per depth pixel (`instanceCount = w*h`).
3. `getTransform().setWorldTransform(depthFrameData.toWorldTrackingOriginFromDeviceRef)` each frame so the cloud stays anchored in world space.

**Hard dependency:** this script only renders with a matching **custom "Depth Texture" material** (a vertex shader that displaces each instance by the sampled depth using `cameraFromDepthPixel` / `deviceRefFromCamera`). The `.ts` alone draws nothing — copy the material from the sample. If the cloud is invisible, first confirm the `instanceCount` is non-zero and the host SceneObject + its Render Mesh Visual are **enabled**.

**Gravity-aligned pose (important):** on current Specs the depth frame's pose is gravity-aligned, so always feed `depthFrameData.deviceCamera.pose` into your pixel math (`deviceRefFromCamera = depthDeviceCamera.pose`). Skipping it doesn't stop frames — it just makes projected points drift/tilt.

**Freeze pattern:** call `session.stop()` / `session.start()` (e.g. on pinch) to freeze and resume the cloud — useful for inspecting a single capture.

---

## Verifying depth on device

Depth has bitten every integration in this skill at the *setup* layer, not the code layer. Before debugging your math, confirm the feed:

1. **Device only.** Lens Studio Preview never streams depth — `onNewFrame` simply won't fire in Preview. Test on Specs.
2. **Experimental API must be SAVED, not just checked.** Toggling Project Settings → "Allow Experimental API" is not enough — the project must be **saved** so the `.esproj` `lensDescriptors` list actually contains `EXPERIMENTAL_API`. An unsaved checkbox builds a Lens with no depth and `onNewFrame` never fires. Verify with: `grep -A3 lensDescriptors *.esproj`.
3. **Accept the on-device camera prompt.** Depth needs the camera frame (which disables open internet for the Lens — use Extended Permissions if you also need network).
4. **Use a delivery probe, not load logs.** Frames arrive ~5 Hz *after* startup. A one-shot probe distinguishes "platform isn't delivering depth" from a lens-side bug far faster than scrolling logs (see the `DelayedCallbackEvent` 5 s probe in `DepthTextureHandler.ts`):

   ```typescript
   let frames = 0
   session.onNewFrame.add(() => frames++)
   session.start()
   const probe = this.createEvent("DelayedCallbackEvent")
   probe.bind(() => print(frames === 0
     ? "[Depth] NO frames 5s after start — platform not delivering depth"
     : `[Depth] ${frames} frames in 5s — pipeline OK`))
   probe.reset(5.0)
   ```
5. **Prefer a visual over prints.** A no-visual Lens lets the compositor throttle (you'll see ~9 FPS and "Output has not changed, skipping rendering") and gives nothing to look at. The Depth Texture point cloud answers "is it working?" by *looking*.
6. `Failed to get tracked device pose! Code -1` at startup is **transient/benign** — it appears even in working depth Lenses and is not the cause of a dead feed.
