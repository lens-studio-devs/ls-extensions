<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

> **Lens Runtime API** — All code here targets the Lens scripting runtime (StudioLib). Do not use these patterns in Editor API code.



# Lens Studio World Query — Reference Guide

"World query" covers two related capabilities: detecting real-world surfaces (using the device's depth and mesh data) and raycasting against scene geometry (using physics). Most Specs Lenses need at least one of these.


## World Query Module (Real Surfaces)

> **Specs only** — WorldQueryModule, HitTestSession, and related APIs are marked @wearableOnly. They are only available on Specs devices.

`WorldQueryModule` lets you cast a ray and find where it hits real-world surfaces recognised by the Specs depth sensor.

```typescript
const WorldQueryModule = require('LensStudio:WorldQueryModule')
```

### Creating a hit test session

```typescript
onAwake(): void {
  const options = HitTestSessionOptions.create()
  options.filter = true  // smooth / filter jitter (recommended)

  this.hitTestSession = WorldQueryModule.createHitTestSessionWithOptions(options)
}
```

### Performing a hit test

```typescript
// rayStart and rayEnd are world-space vec3 positions
this.hitTestSession.hitTest(rayStart, rayEnd, (result) => {
  if (result === null) {
    // No surface found along the ray
    indicator.enabled = false
    return
  }

  // result.position — world position of the hit point
  // result.normal  — surface normal at the hit point
  const hitPos = result.position
  const hitNormal = result.normal

  const isHorizontal = 1 - Math.abs(hitNormal.normalize().dot(vec3.up())) < 0.01
  const lookDir = isHorizontal ? vec3.forward() : hitNormal.cross(vec3.up())
  indicator.getTransform().setWorldPosition(hitPos)
  indicator.getTransform().setWorldRotation(quat.lookAt(lookDir, hitNormal))
  indicator.enabled = true
})
```

### Typical hit test using SIK targeting interactor (Spectacles)

```typescript
import { InteractorInputType } from 'SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor'
import { SIK } from 'SpectaclesInteractionKit.lspkg/SIK'

this.createEvent('UpdateEvent').bind(() => {
  // Get the currently active targeting interactor (the hand pointing at something)
  const primaryInteractor = SIK.InteractionManager
    .getTargetingInteractors()
    .shift()

  if (primaryInteractor && primaryInteractor.isActive() && primaryInteractor.isTargeting()) {
    const rayStart = primaryInteractor.startPoint
    const rayEnd   = primaryInteractor.endPoint

    this.hitTestSession.hitTest(rayStart, rayEnd, (result) => {
      if (result) this.placeObject(result.position, result.normal)
    })
  }
})
```

### Typical hit test in UpdateEvent (camera gaze, Specs)

```typescript
this.createEvent('UpdateEvent').bind(() => {
  const origin = cameraTransform.getWorldPosition()
  const forward = cameraTransform.forward
  const rayEnd = origin.add(forward.uniformScale(5)) // 5-metre ray

  this.hitTestSession.hitTest(origin, rayEnd, (result) => {
    if (result) this.placeObject(result.position, result.normal)
  })
})
```


## Semantic Hit Testing (Specs only)

Semantic hit testing classifies the surface type at the hit point — useful for only placing content on floors, tables, or walls.

```typescript
onAwake(): void {
  const options = HitTestSessionOptions.create()
  options.filter = true
  options.classification = true  // enable surface type detection

  this.hitTestSession = WorldQueryModule.createHitTestSessionWithOptions(options)
}

// In the hit callback:
this.hitTestSession.hitTest(rayStart, rayEnd, (result) => {
  if (!result) return

  // result.classification — the detected surface type
  switch (result.classification) {
    case SurfaceClassification.Ground:
      print('Hit ground — safe to place furniture')
      break
    case SurfaceClassification.Wall:
      print('Hit wall — mount picture here')
      break
    case SurfaceClassification.Ceiling:
      print('Hit ceiling')
      break
    case SurfaceClassification.Table:
      print('Hit table — place small object')
      break
    default:
      print('Hit unclassified surface')
  }
})
```

> **Note:** Semantic hit testing is only available on Specs. Phone Lenses should use basic hit test (no `classification`). The classification is unavailable in the Lens Studio desktop simulator — test on-device.


## Aligning Objects to Hit Surfaces

After a hit test, orient an object so it sits flat on the detected surface:

```typescript
function alignToSurface(obj: SceneObject, position: vec3, normal: vec3): void {
  obj.getTransform().setWorldPosition(position)

  // If the surface is nearly horizontal (floor/ceiling), use a stable up vector
  const EPSILON = 0.01
  const isHorizontal = 1 - Math.abs(normal.normalize().dot(vec3.up())) < EPSILON

  const lookDir = isHorizontal ? vec3.forward() : normal.cross(vec3.up())
  obj.getTransform().setWorldRotation(quat.lookAt(lookDir, normal))
}
```


## Physics Raycasting (Scene Geometry)

Use `Physics.createGlobalProbe()` to cast rays against **scene colliders** (not real-world surfaces). This is the tool for hover detection, interaction, and projectile collision:

```typescript
const probe = Physics.createGlobalProbe()

probe.rayCast(
  rayStart.getTransform().getWorldPosition(),
  rayEnd.getTransform().getWorldPosition(),
  (hit) => {
    if (hit) {
      print('Hit object: ' + hit.collider.getSceneObject().name)
      print('Hit position: ' + JSON.stringify(hit.position))
      print('Hit normal: ' + JSON.stringify(hit.normal))

      if (markerObject) {
        markerObject.getTransform().setWorldPosition(hit.position)
      }
    }
  }
)
```

### Gaze ray from camera

`scene.findByName()` does not exist on `ScriptScene`. Obtain the camera via `@input`:

```typescript
@input camera: Camera

// In your update handler:
const camT = this.camera.getSceneObject().getTransform()
const origin = camT.getWorldPosition()
const direction = camT.forward
const rayLength = 50

probe.rayCast(origin, origin.add(direction.uniformScale(rayLength)), (hit) => {
  if (hit) handleGazeHit(hit)
})
```

### Layers and filtering

`Probe` exposes a `filter` property of type `Physics.Filter` for collision filtering. Use `filter.onlyLayers` / `filter.skipLayers` (both `LayerSet`) to restrict which layers the probe tests against. `CollisionLayer` and `collisionMask` do not exist.

```typescript
const probe = Physics.createGlobalProbe()
const filter = Physics.Filter.create()
// filter.onlyLayers = LayerSet.fromNumber(0)  // restrict to a specific layer if needed
probe.filter = filter
```


## WorldQueryModule vs Physics Raycasting

| | `WorldQueryModule.hitTest` | `Physics.createGlobalProbe().rayCast` |
|---|---|---|
| Hits | Real-world surfaces (depth mesh) | Scene colliders only |
| Use for | Placing content in the room | Interaction, collision detection |
| Async? | Yes (callback) | Yes (callback) |
| Available in simulator? | Limited / No | Yes |
| Semantic labels? | Yes (Specs only) | No |


## Leaderboard Module

For LeaderboardModule API reference, see `user-context.md`.


## Common Gotchas

- **Hit test results are async** — never read `result` synchronously before the callback fires.
- **`filter: true`** on hit test sessions smooths jittery hit positions. Disable it only if you need raw sensor accuracy.
- **Ray length matters** — a ray that misses all surfaces returns `null`. If you expect a hit, try multiple lengths (0.5×, 1×, 2× of your target) before giving up.
- **World Query is unavailable in the Lens Studio simulator** on desktop — test surface placement on-device.
- **Semantic classification** requires `classification = true` in options and is Specs-only. Surface types are accessed as top-level `SurfaceClassification` enum values (e.g. `SurfaceClassification.Ground`), not nested under `HitTestSessionOptions`.
