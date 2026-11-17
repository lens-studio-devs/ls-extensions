<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Snapchat (mobile in-camera Lens) — UI & spatial doctrine

On-demand detail for `snapchat-experience-builder`. Consulted at **Phase 0** (spatial layout) and **Phase 2d** (UI module). This is the mobile counterpart to the Specs orchestrator's IK/UIKit + fixed-world-display doctrine — a phone Lens has **no** IK/UIKit and no fixed 53×77cm world display; it has a screen and a camera feed. The authoritative API references are `ls-clad:lens-api` → `references/2d-ui.md` (screen-space primitives, touch) and `ls-clad:camera-and-rendering` (orthographic/screen-space camera setup). Read those before writing; this file is doctrine, not an API restatement.

## The core mental model: two layers, two cameras

A phone Lens composes two independent layers. Decide, per surface, which layer it belongs to — mixing them is the #1 mobile layout bug.

| Layer | Camera | Coordinate space | Use for |
|---|---|---|---|
| **Screen-space UI** | Orthographic camera on the `Ortho` layer → a Full-Frame/Safe `ScreenRegion` → elements (built by the `ScreenImage`/`ScreenText` presets — see below) | `ScreenTransform` anchors in **[-1, 1]** + offsets; origin = screen centre | HUD, score, buttons, dialogs, menus — anything pinned to the screen regardless of what the camera sees |
| **World / AR content** | Perspective (default) | world cm, placed relative to camera / face / tracked surface | 3D meshes, effects, characters, physics bodies — anything that lives *in* the camera scene |

The screen layer rides the glass; the world layer rides the real world (or the face). A score counter is screen-space (always top-centre). A hat on the user's head is world/face-space. This split replaces the Specs "everything sits on a fixed world panel at z=-110" model entirely — **do not** port z=-110 coordinates or a fixed viewport rectangle into a mobile build.

## Screen-space UI — primitive vocabulary (replaces UIKit)

There is no `Frame`/`BackPlate`/`FlexLayout`/`Button` here. Compose from native primitives (full API in `2d-ui.md`):

- **`ScreenTransform`** — position/size in screen space. Anchors are a `Rect(left, right, bottom, top)` in [-1, 1]; a point anchor + `offsets` (half-extents) sizes a fixed element. This is your layout tool — there is no flex/grid container, so arrange by **anchoring each element to a screen region**, not by hand-stacking magic-number Y offsets.
- **`Component.Image`** (ScreenImage) — a textured/tinted quad; the panel backing and icons. Screen-space Images **must be preset-created** (`ScreenImage`/Image preset) — a manually assembled `Component.Image` will not composite correctly (see `camera-and-rendering` → "Creating Screen-Space Objects").
- **`Component.Text`** — 2D text (`text`, `size`, alignment, `textFill.color`). Sanitize any untrusted/network string before assigning it (`2d-ui.md` → untrusted sources) — unclosed HTML-style tags crash the renderer.
- **Tap affordance** — the phone button pattern is an **invisible/visible `Component.Image` + `Component.InteractionComponent`** whose `onTap` fires the action (`2d-ui.md` → "UI Buttons for Phone Lenses"). Never an IK `Interactable` or UIKit `Button`, never a physics collider for a flat screen button.
- **Camera** — an orthographic camera on the `Ortho` layer renders the screen-space objects (as its children). Its `size` sets the visible extent (the `[-1,1]` anchor range maps onto it): **set `size` to fit this scene's content and anchor relative to it** — an off-screen element means `size` doesn't match the content. (This doc gives no canonical `size` number on purpose — choose the value the scene needs; don't copy one from another build as if it were "correct.")
- **Canvas & ScreenRegion — the presets handle both; don't hand-fight them.** The `ScreenImage`/`ScreenText` presets build the canonical hierarchy: an ortho camera with a `Canvas` **attached to the camera** (screen-space, no world rect) → a **Full-Frame/Safe `ScreenRegion`** → your `ScreenTransform` elements. Keep that camera-attached Canvas — it's part of the canonical screen-space setup (`camera-and-rendering` treats a camera Canvas as required for screen-space rendering); use the preset default, don't strip it. **Never add a Canvas as a separate *child* object** — a child Canvas exposes a world-space rect and is for **2D-in-3D content under a *perspective* camera** (a world-anchored panel — the Spectacles case), not flat phone-screen UI.

## Passive-view UI module contract (ported architecture, mobile vocabulary)

Keep the Specs event-bus architecture — it is platform-agnostic and worth every line. Each user-facing surface is a `@component class extends BaseScriptComponent` (`Assets/Scripts/<ExperienceName><PanelName>UI.ts`) that is a **passive view over preset-created screen objects**:

- **Channel A — data in:** public setter methods the main script calls — `setScore(n: number)`, `setStatus(msg: string)`, `showGameOver(finalScore: number)`, `hideGameOver()`. The module reads its child screen objects' components (`getComponent('Component.Text')`, `…ScreenTransform`, `…Image`) and updates them. It holds **only** ephemeral view state (which tab is open) — never domain state, never game decisions.
- **Channel B — intent out:** the module reports user taps back to the main script. Mobile has no IK `Event<T>` — **do not import `InteractionKit.lspkg`**. Use a typed **callback field** (`onStart: (() => void) | null = null`), the idiom shown in `2d-ui.md`'s `TapButton`. When a surface genuinely needs multiple subscribers, include a ~10-line local generic `Event<T>` helper in the module — still no IK import.
- The main script owns state, mutates it, and pushes it to the view via setters; the view pushes intent up via callbacks. One-way flow, single source of truth per slice — identical to the Specs `Script Plan` doctrine.

Because there is no mobile UI-composition skill yet (a deferred follow-up — the eventual `snapchat-build-ui`, analog of `specs-build-ui`), the orchestrator authors these modules **inline** against the primitives above. This is a legitimate, native-primitive path — not the banned "hand-roll a UIKit panel" degradation, because on mobile there is no UIKit to fall back from.

## Spatial layout — design to the screen, not to a fixed rectangle

Replaces the Specs "53×77cm viewport, ±26.5/±38.5cm bounds" plan. Two sub-plans:

**Screen-space plan (portrait-first, aspect-robust).** Phones vary in aspect ratio and have notches/rounded corners. Lay out by **anchoring to screen regions**, never by absolute pixel coordinates that assume one device:
- Anchor HUD/status to the **top** region, primary actions to the **bottom** third (thumb-reachable), dialogs centred.
- Keep every interactive/important element inside the **`SafeRender`** region (`ScreenRegionComponent` region types: `FullFrame`, `SafeRender`, `Capture`, `Preview`, `RoundButton`) — the camera UI (capture button, caption bar) overlaps `FullFrame` edges.
- Record the plan as an **anchor table**, not a coordinate table:
  ```
  Screen layout (anchors in [-1,1], keep interactive within SafeRender):
    ScoreHUD:    top-centre     anchors≈(-0.5, 0.5, 0.75, 0.95)
    StartButton: bottom-centre  anchors≈(-0.5, 0.5, -0.9, -0.7)   ← thumb zone
    GameOverDlg: centre overlay anchors≈(-0.8, 0.8, -0.4, 0.4)     ← starts hidden
  ```

**World/AR plan (matches the Lens's tracking).** Placement depends on what `/snapchat-project-init` set (front-camera face effect, back-camera surface/world, etc.):
- **Face / front-camera** → attach content to face attach points / landmarks (`lens-api` → `references/face-tracking.md`); it rides the face, not a fixed depth.
- **Surface / world / back-camera** → place relative to the tracked surface or camera-forward; size objects relative to each other (the Specs relative-sizing + containment/support rules port unchanged — a thing that "rests on" another must have the smaller footprint).
- Keep the two layers from colliding: 3D content shouldn't render over screen HUD that must stay legible; verify with a capture, not arithmetic.

## Bans (Phase 3c static-check targets)
- **No `UIKit.lspkg` / `InteractionKit.lspkg` imports** anywhere — there is no IK on a phone Lens.
- **No `z=-110` / fixed-world-panel coordinates**, no ±26.5/±38.5cm viewport checks — those are Specs-only.
- **No hand-stacked label columns** by magic-number `setLocalPosition` Y offsets — anchor each element to its screen region.
- **No physics collider + `Interactable` for a flat screen button** — that's the world-layer picking pattern (below), not a UI tap.

## World-layer touch picking (when 3D content is tappable)
For tapping/dragging **3D** objects (not screen UI), raycast from the camera through the touch point and act on the hit body — `camera.screenSpaceToWorldSpace(touchPos, depth)` + a `Physics` probe `rayCast`, with `global.touchSystem.touchBlocking = true` to claim taps from Snapchat's gestures. The canonical implementation is `ls-clad:physics` → `references/draggable-pattern.md` (tap-to-grab, tap-to-launch, aim-and-fire, multi-touch map). This is the mobile replacement for the Specs IK collider-wrapper interaction model.

## Verification hooks (Phase 3b / 3c)
- **Look, don't compute.** Capture the running preview (`CapturePanelScreenshotTool`; `CaptureRuntimeViewTool` ignores the camera) on the **correct preview camera** (front for face, back for world — `/snapchat-project-init` sets it) and judge placement visually. Screen arithmetic can't tell you a HUD is behind a mesh or clipped by the notch.
- Confirm interactive elements sit inside `SafeRender` and read at a plausible phone aspect (don't trust one device's editor frame).
- Confirm no `Spectacles*Kit` import and no `z=-110` literal snuck in (Phase 3c grep).
