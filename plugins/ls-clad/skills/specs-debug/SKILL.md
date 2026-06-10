---
name: specs-debug
description: "Specs layer on `ls-clad:lens-debug`. Load alongside it for Specs-only bugs: SIK, RSG, SyncKit, SnapML, VIO/SLAM tracking, on-device perf tooling, Specs perf rules, world-space UI render order / z-fighting, feature compatibility."
argument-hint: [subsystem and symptom]
user-invocable: false
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Specs Subsystem Debug

Debugging issue: **$ARGUMENTS**

**Layered on top of `ls-clad:lens-debug`** — start there, then read this *in addition* once the symptom is Specs-specific. The orchestrator's rules (Step 0, Pacing, Stop-and-ask, Reading the preview) and its general triage all apply here.

## SIK (SpectaclesInteractionKit)

```typescript
import {Interactable} from 'SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable'
import {HandInputData} from 'SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandInputData'
import {WorldCameraFinderProvider} from 'SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider'

// Is hand tracking active?
const hand = HandInputData.getInstance().getHand('right')
console.log('Right hand tracked: ' + hand.isTracked())

// Is the Interactable triggering? Get the component from the same SceneObject.
const interactable = this.sceneObject.getComponent(Interactable.getTypeName()) as Interactable
interactable.onTriggerStart.add(() => {
  console.log('Interactable triggered')
})

// Is WorldCameraFinderProvider returning a camera?
const cam = WorldCameraFinderProvider.getInstance()
console.log('Camera found: ' + (cam !== null))
```

If `isTracked()` is always false, the Lens is running on a device without hand tracking (phone preview, or Specs with the hand provider disabled) — guard the rest of the script with that check rather than asserting tracking. If `onTriggerStart` never fires, confirm the `Interactable` is on the same scene object as the collider mesh (not on a parent or sibling).

## UI rendering — z-fighting, render order, depth (world-space UIKit)

Symptoms: content bleeds through a panel, panels flicker, or elements paint in the wrong overlap order. This is almost never a layout bug — it is a Canvas-sort or depth-flag bug. See `specs-build-ui` SKILL.md → *Render-order rules* and `references/gotchas.md` for the authoritative checklist.

Quick triage: (1) confirm no manual `renderOrder` on any child, (2) confirm content child is +0.6 cm forward in Z, (3) confirm `Component.Image` has `depthWrite = false`.

## Remote Service Gateway (Gemini / OpenAI / websocket)

```typescript
// WebSocket lifecycle — log every state transition
this.GeminiLive.onOpen.add(() => console.log('Gemini: connected'))
this.GeminiLive.onError.add((e) => console.error('Gemini: ' + JSON.stringify(e)))
this.GeminiLive.onClose.add((e) => console.log('Gemini: closed — ' + e.reason))

// Audio output started?
this.dynamicAudioOutput.onAudioStarted?.add(() => console.log('Audio output started'))
```

If `onOpen` never fires, the connection failed before the handshake — almost always RSG configuration (project settings → Remote Service Gateway). If `onError` fires with a 401/403, the gateway credential is missing or expired. A bare `Network request failed` from any RSG call also points at the same root cause: gateway not configured in project settings.

## Sync Kit (multiplayer)

```typescript
// Ownership — am I the authoritative writer for this entity?
console.log('doIOwnStore: ' + this.syncEntity.networkRoot.doIOwnStore())

// Session state — how many users connected?
const session = SessionController.getInstance()
console.log('Session users: ' + session.getUsers().length)

// Remote change — is the subscription firing on remote edits?
this.myProp.onRemoteChange.add((val) => {
  console.log('Remote change: ' + JSON.stringify(val))
})
```

If `doIOwnStore()` returns false on the client doing the writes, the property is being written by the non-owner and will be discarded silently. If `onRemoteChange` never fires, the property is being mutated locally without going through the `SyncEntity` API.

## SnapML

```typescript
// Did inference actually run?
this.mlComponent.runImmediate(false)
const out = this.mlComponent.getOutput('output')
console.log('ML output shape: ' + JSON.stringify(out?.shape))
console.log('ML output length: ' + (out?.data as Float32Array)?.length)
```

If `out` is null, the named output ("output") doesn't exist on this model — re-check the model's output names. If `out.data.length === 0`, the model loaded but inference didn't fire — confirm `runImmediate` or `runScheduled` was called and the input tensor was populated.

## Tracking and environment (VIO / SLAM / Scene Understanding)

If the symptom is "tracking drifts," "anchors slip," "scene mesh wrong," or "depth wrong," the Lens code is usually fine — the environment is the cause.

- **Lighting:** ≥100 LUX measured off walls/floor, not at the light source. Below this, exposure climbs and tracking degrades.
- **Visual features:** every viewpoint needs several distinct corner-rich features. Repetitive patterns (tape lines, checkerboards repeated across a wall) confuse VIO. Add posters, decals, textured props.
- **Static scene:** avoid leafy plants or anything that moves with airflow. Use static props (cactus/succulents, cubes, plinths).
- **Thermal:** hot ambient + high Lens power → throttling / standby. Keep airflow up.
- **Validation:** run the Point Cloud Lens (CV 6DoF Points) on-device — green points = strong features, red = weak. Lots of red → tracking will struggle here.

If the user reports unstable anchors but the environment is fine, the bug *is* in code (Sync Kit ownership, world query timing) — fall through to the subsystem sections above.

## Performance tooling

- **Lens Performance Overlay** (on Specs; all three tools share the same Lens Power scale: 0–100, smooth ≤100, throttling above) — Spectacles App → Developer Settings → enable overlay. Shows CPU, GPU, FPS, battery, Lens Power live. Consumes some power itself, so its readings are slightly conservative.
- **Spectacles Monitor** (in Lens Studio) — `Window → Utilities → Spectacles Monitor`. Same metrics with more precision; **turn the overlay off** when reading from Monitor to avoid double-counting.
- **Perfetto trace** for CPU hot paths — capture from Spectacles Monitor, then analyze with `ls-clad:perfetto-trace-analysis`.

### Specs-specific perf rules (over and above `references/performance.md`)

These contradict or extend general Lens Studio optimization advice — verify after applying:

- Textures ≤ 512×512 unless you actually need more.
- Avoid PBR materials; prefer simpler shading.
- Turn MSAA off unless you've confirmed you need it.
- Use WAV over MP3 for audio; cap simultaneous sounds.
- Disable invisible meshes (they still render) — destroy if unused.
- `UpdateEvent` should do as little as possible; precompute, cache, offload to GPU.

General scripting perf patterns (allocations, handler timing, object pooling) live in `ls-clad:lens-api` → `references/performance.md`.

## Feature compatibility across Specs models

Some APIs (custom locations, certain camera modes, specific ML capabilities) are gated by Specs model and firmware. If a feature silently no-ops on hardware but works in preview, check the official compatibility list at <https://developers.snap.com/spectacles/about-spectacles-features/compatibility-list> before treating it as a code bug.

## See also

- `ls-clad:lens-api` → `references/performance.md` — general scripting perf patterns
- `ls-clad:perfetto-trace-analysis` — interpreting CPU traces captured from Spectacles Monitor
- `ls-clad:specs-sync-kit` — multiplayer ownership and SyncEntity deep-dives
- `/specs-build-ui` (this plugin) → *Render-order rules* + `references/gotchas.md` — source of truth for world-space UI depth / z-fighting / Canvas sort
