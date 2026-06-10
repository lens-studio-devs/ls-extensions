---
name: specs-world-query
description: Place objects on real-world surfaces using the WorldQueryModule — fast ray casting against physical surfaces, depth hit testing, surface normals, and semantic ground detection. Load when implementing surface placement, AR object spawning on floors/tables, or real-world surface interaction.
user-invocable: false
paths: "**/*.ts"
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# World Query Module — Surface Hit Testing

Lightweight, fast ray casting against real surfaces. Optimized for Specs wearable.

**Requirements:** Add `WorldQueryModule` to project. Requires SIK for interactor-based ray.

> **Performance note:** Updates at ~5Hz — suitable for static/slow surfaces only. Not for fast-moving objects.

Reference: `Essentials/` (raycasting examples), `WorldQueryHit` package from Asset Library

---

## Setup

```typescript
const WorldQueryModule = require('LensStudio:WorldQueryModule') as WorldQueryModule
```

Two ways to create a session:

```typescript
// With default options
const session: HitTestSession = WorldQueryModule.createHitTestSession()

// With custom options
const options = HitTestSessionOptions.create()
options.filter = true
const session: HitTestSession = WorldQueryModule.createHitTestSessionWithOptions(options)

// IMPORTANT: must call start() before the session will produce results
session.start()
```

---

## Basic Surface Placement

```typescript
// WorldQueryModule required — see Setup
const SIK = require('SpectaclesInteractionKit/SIK').SIK
const {InteractorTriggerType} = require('SpectaclesInteractionKit/Core/Interactor/Interactor')

@component
export class SurfacePlacer extends BaseScriptComponent {
  @input
  @hint("Object to preview on surface (will follow pointing)")
  targetObject: SceneObject

  @input
  @hint("Enable hit test result smoothing")
  filterEnabled: boolean = true

  private hitTestSession: HitTestSession

  onAwake(): void {
    const options = HitTestSessionOptions.create()
    options.filter = this.filterEnabled
    this.hitTestSession = WorldQueryModule.createHitTestSessionWithOptions(options)

    // MUST call start() — depth computation only runs after this
    this.hitTestSession.start()

    this.targetObject.enabled = false
    this.createEvent('UpdateEvent').bind(() => this.onUpdate())
  }

  private onUpdate(): void {
    const interactor = SIK.InteractionManager.getTargetingInteractors().shift()
    if (!interactor?.isActive() || !interactor.isTargeting()) {
      this.targetObject.enabled = false
      return
    }

    this.hitTestSession.hitTest(
      interactor.startPoint,
      interactor.endPoint,
      (result: WorldQueryHitTestResult | null) => this.onHitResult(result, interactor)
    )
  }

  private onHitResult(result: WorldQueryHitTestResult | null, interactor): void {
    if (!result) {
      this.targetObject.enabled = false
      return
    }

    this.targetObject.enabled = true

    // Place at hit position
    const tr = this.targetObject.getTransform()
    tr.setWorldPosition(result.position)

    // Orient to surface normal
    const normal = result.normal
    const EPSILON = 0.01
    let lookDir: vec3
    if (1 - Math.abs(normal.normalize().dot(vec3.up())) < EPSILON) {
      lookDir = vec3.forward()  // surface is nearly horizontal
    } else {
      lookDir = normal.cross(vec3.up())
    }
    tr.setWorldRotation(quat.lookAt(lookDir, normal))

    // Spawn on pinch release
    if (interactor.previousTrigger !== InteractorTriggerType.None &&
        interactor.currentTrigger === InteractorTriggerType.None) {
      this.spawnAtHit(result)
    }
  }

  private spawnAtHit(result: WorldQueryHitTestResult): void {
    print("[WorldQuery] Spawning at: " + result.position)
    this.sceneObject.copyWholeHierarchy(this.targetObject)
  }
}
```

---

## Hit Test Result Properties

```typescript
result.position      // vec3 — world position of hit
result.normal        // vec3 — surface normal at hit point
result.classification // SurfaceClassification — e.g. Ground, None (requires Experimental)
```

---

## Semantic Ground Detection (Experimental)

Detect specifically floor/ground surfaces:

```typescript
// Enable Experimental APIs in Project Settings first

const options = HitTestSessionOptions.create()
options.filter = true
options.classification = true  // enable semantic surface type

const session = WorldQueryModule.createHitTestSessionWithOptions(options)
session.start()  // required before hitTest will return results

session.hitTest(rayStart, rayEnd, (result: WorldQueryHitTestResult) => {
  if (!result) return

  switch (result.classification) {
    case SurfaceClassification.Ground:
      print("[WorldQuery] Hit ground!")
      this.placeOnGround(result.position, result.normal)
      break
    case SurfaceClassification.None:
      print("[WorldQuery] Hit unknown surface")
      break
  }
})
```

---

## Custom Ray (without SIK interactor)

```typescript
// Cast ray from arbitrary points (session must be started — see Setup)
const rayStart = new vec3(0, 0, 0)
const rayEnd = new vec3(0, -100, 0)  // straight down

session.hitTest(rayStart, rayEnd, (result) => {
  if (result) {
    print("[WorldQuery] Hit at: " + result.position)
  } else {
    print("[WorldQuery] No hit (ray outside FOV)")
  }
})
```

> Returns `null` if the ray falls **outside the camera field of view** — the depth map only covers what Specs can see.

---

## Alternatives

| Use case | API |
|----------|-----|
| Fast surface placement | `WorldQueryModule` (this) |
| Precise mesh raycasting | `DeviceTracking.hitTestWorldMesh()` |
| Physics-based raycasting | `Physics.Probe.raycast()` |
| Raw depth at UV point | `DepthTexture.sampleDepthAtPoint()` |
