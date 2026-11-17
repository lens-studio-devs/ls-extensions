---
name: specs-spatial-anchors
description: Persist content in the user's space on Specs with the native AnchorModule (Lens Studio 5.25+) — create, save, restore, discover and delete world anchors, show content only while tracked, and read a Custom Location anchor's latitude / longitude. Load for "remember where I put this", persistent placement across sessions, anchored notes/widgets, areas (home vs office), or moving / deleting saved anchors. Not for location-locked sites (specs-custom-locations) or one-off surface placement (specs-world-query).
user-invocable: false
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Spatial Anchors — persistent content on Specs

**Requirements:** Lens Studio 5.25+ (Lens Scripting 376+), Specs. The anchor API is built into
Lens Studio: no package is needed for the API itself. Lens Studio Preview has **no anchor
service**: test persistence on device.

## Concepts

- **AnchorModule** opens an **AnchorSession** for one area; the session creates, saves, resolves,
  deletes and discovers anchors.
- An **Anchor** is a saved place; its `id` is what you store. Holding one tracks nothing.
- An **AnchorComponent** on a SceneObject tracks an anchor, drives that object's transform and
  reports tracking state and positional uncertainty (cm).
- **AnchorLocationModule** returns the latitude / longitude of a Custom Location anchor.

The installed type definitions own the full API surface.

## Core flow

```ts
const anchorModule = require("LensStudio:AnchorModule") as AnchorModule
const options = new AnchorModule.AnchorSessionOptions()
options.area = "living-room"                       // optional; omit = every anchor of this Lens
const session = await anchorModule.openSession(options)

// Create + save (createWorldAnchor resolves a Promise)
const anchorObject = global.scene.createSceneObject("Anchor")
const anchor = await session.createWorldAnchor(poseInWorld)       // mat4, world-from-anchor
const tracker = anchorObject.createComponent("Component.AnchorComponent") as AnchorComponent
tracker.anchor = anchor                                            // assigning starts tracking
content.setParent(anchorObject)                                    // content is a CHILD
await session.saveAnchor(anchor)                                   // resolves once mapped enough
global.persistentStorageSystem.store.putString("myLens.anchorId", anchor.id)

// Next session: by stored id, or by discovery
const restored = await session.resolveAnchor(storedId)            // rejects if unknown
session.onAnchorNearby.add((found) => { /* attach an AnchorComponent, rebuild content */ })

// Show only while tracked
tracker.onStateChanged.add((state) => {
  content.enabled = state === AnchorModule.AnchorTrackingState.Tracking
})
```

Delete: `session.deleteAnchor(anchor)`; wipe: `clearArea()` (needs an area) / `clearAllAnchors()`;
switch area: `close()` the session and open a new one.

## Rules

1. **Hide the content child, never the anchor object.** Disabling the object that carries the
   `AnchorComponent` can stop tracking, so the content would never come back.
2. **Content does not persist, anchors do.** Store your own data keyed by `anchor.id` and rebuild
   the content when the anchor comes back (`resolveAnchor` or `onAnchorNearby`).
3. **Anchors are immutable.** To move one: create + save a new anchor at the new pose, retarget the
   `AnchorComponent`, then delete the old anchor.
4. **Guard creation.** Ignore repeated create requests while one is still creating / saving;
   overlapping creates can leave the session stuck.
5. **Tracking lifecycle:** `Initializing` → `Ready` → `Tracking` ⇄ `Lost`; `Error` does not recover.
   Use positional uncertainty to wait for a stable pose before showing precise content.
6. **Areas:** one per physical space (home, office), each under about 250 m². A single-space Lens
   may not need an area. Areas are per Lens.
7. **Saving needs mapping.** Tell the user to look around slowly while a save is pending.
8. **Geo position** answers for Custom Location anchors only; ask for the location permission and
   handle refusal (the Promise rejects).

## Package: AnchorExamples (4.0.0)

AnchorExamples wraps the native API in a reusable controller, ships a one-component persistent
example and a full widget demo. Use it when the Lens needs more than one anchored object or named
areas; for a single anchor the core flow above is enough.

- **AnchorController** (singleton helper, not a component): one session at a time, re-opened when
  the area changes; create + save in one call; restore by id or discovery; tracker management with
  state and uncertainty events; Custom Location geo position. In Preview every call is a no-op that
  returns `null` / `false` (`isSupported` is false).

```ts
import {AnchorController} from "AnchorExamples.lspkg/Scripts/AnchorController"

const anchors = AnchorController.getInstance()
const session = await anchors.openSession("home")             // null in Preview
const anchor = savedId
  ? await anchors.resolveAnchor(savedId)
  : await anchors.createAndSaveWorldAnchor(target.getTransform().getWorldTransform())
anchors.onTrackingStateChanged.add(({target: t, state}) => {
  if (t === target) print(AnchorController.stateName(state))
})
anchors.track(target, anchor)                                  // AnchorComponent on target
const geo = await anchors.getGeoPosition(customAnchor)         // Custom anchors only; null otherwise
```

- **PersistentAnchorExample** (`Examples/Native/PersistentAnchorExample`): a component with inputs
  `content`, `area`, `placeDistance` (cm), `maxUncertaintyCm`. On start it restores last launch's
  anchor (stored id, then `onAnchorNearby`) or creates and saves one in front of the wearer, and
  shows `content` only while tracking within the uncertainty budget. Methods: `placeHere()`,
  `forget()`, `clearArea()`. Do not combine it with the demo prefab in one scene: both drive the
  controller's single session.
- **Demo prefab** `AnchorExamples__PLACE_IN_SCENE`: named areas (up to 9), Note / Watch / Photo
  widgets stored relative to the anchored parent, surface snapping. Needs the InteractionKit prefab
  in the scene. Delete its `Guide` and `ExampleCarousel` children in your own Lens.

## Verify

- Preview: compiles, no script errors; content placement logic runs (no real anchors).
- Device: save, relaunch the Lens, confirm the content returns to the same spot; walk away and back
  to see `Lost` → `Tracking`.
