---
name: snapchat-project-init
description: Snapchat (in-camera Lens) project setup — camera tracking mode, preview camera (front/back) and input via PreviewPanelTool, and project target, each inferred from the Lens's intent. Use when setting up or sanity-checking a Snapchat Lens before previewing.
user-invocable: true
---

# Snapchat Project Init

> Inline checklist to run by hand. Match each setting to what the Lens actually does — template defaults are frequently wrong, and a wrong default yields a build that looks fine in the editor but does nothing in preview.

Three things to set before you preview:

## 1. Camera tracking mode

Attach `DeviceTracking` to the Camera (or the tracked object) **only** when content should stay fixed in the *real world* rather than on screen. Pick by intent:

| Lens intent | Tracking |
|---|---|
| Face / front-camera effect (the common case) | none — content rides the face/screen |
| Content anchored to a real surface (table, floor) | `DeviceTracking` **Surface** |
| Walk-around / world-locked content | `DeviceTracking` **World** |
| Skybox / 360 | `DeviceTracking` **Rotation** |

## 2. Preview camera + input

Configure the preview simulator with the `PreviewPanelTool` MCP tool — `setConfig` takes `deviceCategory`, `cameraView`, and the input source, and `getConfig` reports the current state. For a phone Lens:

- **`deviceCategory: "mobile"`** — the phone simulator.
- **`cameraView: "Front" | "Back"`** — which phone camera the Lens runs against. Match it to the tracking choice: **Front** for face/selfie effects (the common case), **Back** for world/surface/rear-camera Lenses.
- **Input media that *exercises the Lens's trigger*** — otherwise you can't tell whether the behavior fires. Set a `Multimedia` source (`.mp4`/image) via `listSources` → `setConfig`, matched to the behavior:
  - open-mouth effect → a video where the mouth opens
  - hand-gesture Lens → hands in frame
  - surface Lens → footage panning across a flat surface
  - body-tracking Lens → a full-body video

The same tool covers the rest of preview control — `listSources`, `getConfig`, `refresh`, `pause`, `resume` — for inspecting or adjusting the running preview later.

## 3. Project target

Stays Snapchat. The front/rear distinction above is the preview camera; the shipping Lens uses whichever camera its tracking/effect implies (face → front, world → rear).

---

When unsure, infer from the user's request rather than leaving the default: "attach a hat to my head" → face, Front camera; "place a vase on the table" → Surface, Back camera; "open your mouth to shoot lasers" → Front camera + open-mouth preview video.
