---
name: snapchat-project-init
description: Snapchat (in-camera Lens) project setup — tracking mode, preview camera/input, project target, and self-contained (non-AR/game) scene setup (clean color background + device-consistent FOV). Use before previewing or sanity-checking a Snapchat Lens.
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

Configure the preview simulator with the `PreviewPanelTool` MCP tool — `setConfig` takes `deviceCategory`, `cameraView`, and the input source, and `getConfig` reports the current state. If the user will watch their own panel, configure it too by passing its title as `previewName`. For a phone Lens:

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

## 4. Self-contained scenes (games / 3D experiences — not an AR effect)

Some Lenses render their **own** 3D world (a game, a 3D data-viz, a virtual scene) instead of augmenting the camera feed. These are **not** AR effects — don't inherit the AR defaults:

- **No tracking.** Leave tracking `none` (§1) — there's nothing in the real world to anchor to.
- **Clear the background to a solid color — don't use the camera feed.** By default the scene's **Render Target** clears to the live **Device Camera Texture** (the camera passthrough). Set the Render Target's `clearColorOption` to **`CustomColor`** so the camera feed isn't used at all. Besides a clean, readable backdrop, **a Lens that doesn't use the camera feed can run in a more optimized state** (the camera pipeline can be skipped) — and it drops the noisy real-world video that makes a scene hard to read and hard to verify in preview.
- **Backdrop beyond a flat color (optional, additional).** If you want more than a solid color behind the scene, add a **skybox** or environment — a separate visual layer on top of the cleared background, not a substitute for the color clear.
- **Pin the FOV — set the perspective camera's Device Property to `Aspect`.** `Camera.devicePropertyUsage` defaults to **`All`**, which inherits the *physical device camera's* field of view — so the same Lens frames differently on different phones. Set it to **`Aspect`** (inherit aspect ratio only) so FOV is fixed by the camera's own `fov` and your framing is **consistent across devices**. (Inspector: Camera → **Device Property → Aspect**; runtime: `camera.devicePropertyUsage = Camera.DeviceProperty.Aspect`.)
- **Raise the camera's far clip plane.** The perspective camera's **far** clipping distance defaults low, so distant parts of a 3D scene (platforms/scenery ahead of the player) silently vanish — you can barely see ahead. Set it **high** — up to the UI max **999999** — so everything renders; only lower it if distant surfaces show **z-fighting** (depth-precision flicker). (Inspector: Camera → **Far**; runtime: `camera.far`.)
- **Preview needs no trigger media** (§2) — the scene renders itself; a neutral or empty input source is fine.
- **Wiring these enum properties:** `clearColorOption`, `devicePropertyUsage`, etc. are **enum** properties, and the wire format differs by tool — via `scene-graphql` set them with `valueType: ENUM` + the option **name** (`CustomColor`, `Aspect`); via a `VirtualScene` apply you must pass the numeric **option index** instead. Read the index from the property controls; don't assume/hardcode it (indices drift across versions).

This is the setup a player-controlled character game wants — see `snapchat-controllable-character`.

---

When unsure, infer from the user's request rather than leaving the default: "attach a hat to my head" → face, Front camera; "place a vase on the table" → Surface, Back camera; "open your mouth to shoot lasers" → Front camera + open-mouth preview video.
