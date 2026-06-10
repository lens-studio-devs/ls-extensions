<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

> **Lens Runtime API** — All code here targets the Lens scripting runtime (StudioLib). Do not use these patterns in Editor API code.



# Lens Studio VFX — Reference Guide

Lens Studio's **VFX Graph** system lets you build GPU-accelerated particle effects visually. Scripts control VFX by writing to the graph's exposed **properties**, not by calling imperative particle APIs.


## Core Concepts

| Term | Meaning |
|---|---|
| **VFX Asset** | The `.vfx` file — the graph definition with exposed properties |
| **VFXComponent** | The scene component that runs a VFX Asset on a scene object |
| **Properties** | Named, typed inputs on the asset that scripts can read/write |

```typescript
// Get the VFX component on the scene object
const vfx = this.sceneObject.getComponent('Component.VFXComponent')

// Check the asset is assigned before accessing properties
if (!vfx || !vfx.asset) {
  print('[VFX] Asset not assigned!')
  return
}

// Access the properties object
const props = vfx.asset.properties
```


## Writing Properties to a VFX Graph

The VFX Graph exposes **named properties** that are declared inside the graph editor. Match the property name exactly (case-sensitive) and the type must match.

### Supported property types

| Type | Example |
|---|---|
| `number` | `props['intensity'] = 0.8` |
| `boolean` | `props['emitting'] = true` |
| `vec2` | `props['uvOffset'] = new vec2(0.1, 0.2)` |
| `vec3` | `props['spawnPosition'] = new vec3(0, 1, 0)` |
| `vec4` | `props['color'] = new vec4(1, 0.5, 0, 1)` |
| `quat` | `props['orientation'] = someQuat` |

```typescript
// Set a float intensity property
vfx.asset.properties['intensity'] = 0.5

// Set an emission position from another scene object
const sourcePos: vec3 = sourceObject.getTransform().getWorldPosition()
vfx.asset.properties['spawnPosition'] = sourcePos

// Set a colour via vec4 (RGBA, [0, 1])
vfx.asset.properties['color'] = new vec4(1.0, 0.3, 0.0, 1.0)

// Toggle emission on/off
vfx.asset.properties['emitting'] = true
```

> **Type mismatch warning**: if the value type doesn't match what the graph expects, the property silently does nothing. Use `typeof` or a debug print to confirm the type before writing.


## Sending Transform Data to VFX

### World position
```typescript
updateEvent.bind(() => {
  const pos = anchor.getTransform().getWorldPosition()
  vfx.asset.properties['targetPosition'] = pos
})
```

### World rotation (as vec4 to avoid quat-to-prop issues)
```typescript
const rot = anchor.getTransform().getWorldRotation()
vfx.asset.properties['rotation'] = new vec4(rot.w, rot.x, rot.y, rot.z)
```

### Direction vector
```typescript
const forward = anchor.getTransform().forward  // vec3
vfx.asset.properties['emitDirection'] = forward
```

### AABB mesh dimensions (for bounding-box-shaped emitters)
```typescript
const meshVisual = anchor.getComponent('Component.RenderMeshVisual')
const aabbMax = meshVisual.mesh.aabbMax.mult(anchor.getTransform().getLocalScale())
const aabbMin = meshVisual.mesh.aabbMin.mult(anchor.getTransform().getLocalScale())
vfx.asset.properties['boundsMax'] = aabbMax
vfx.asset.properties['boundsMin'] = aabbMin
```


## Screen-Space to World-Space Conversion

To spawn particles at a 2D screen position (e.g., where the user tapped):

```typescript
// Given: a ScreenTransform and a Camera
function screenToWorld(screenTrans: ScreenTransform, camera: Camera, desiredDepth: number): vec3 {
  const anchors = screenTrans.anchors
  const center  = anchors.getCenter()
  const anchorHalfHeight = anchors.getSize().y / 2
  const fov = camera.fov
  const depth = (desiredDepth / anchorHalfHeight) * 0.5 / Math.tan(fov * 0.5)
  const screenPos = screenTrans.localPointToScreenPoint(center)
  return camera.screenSpaceToWorldSpace(screenPos, depth)
}

// Usage: spawn VFX at the tapped screen position
vfx.asset.properties['spawnPosition'] = screenToWorld(screenTrans, mainCamera, 250)
```


## Particle System Inspector Settings

These are configured in the Lens Studio **VFX Graph editor**, not in script — but knowing them helps when authoring the graph.

| Setting | Purpose |
|---|---|
| **Emitter Rate** | Particles spawned per second (or per burst) |
| **Lifetime** | How long each particle lives (in seconds) |
| **Simulation Space** | `World`: particles stay where emitted; `Local`: particles move with the emitter |
| **Blend Mode** | `Additive` for fire/glow, `Alpha` for soft particles, `Normal` for opaque |
| **Shape** | Sphere, Cone, Box, Mesh surface — defines the spawn volume |

> **World vs Local simulation**: use **World** space for fire or smoke that should trail behind a moving emitter. Use **Local** for effects that rigidly follow the emitter (e.g., a sparkle around a held object).


## Attaching VFX to Face / Body Tracking Anchors

```typescript
// Parent the VFX object to a face tracking anchor in the scene hierarchy
// (drag it under the `hat` or `mouth` anchor in the inspector)
// Then in script, send expression weights to drive emission rate:

const head = headObject.getComponent('Head')

updateEvent.bind(() => {
  // Use getExpressionWeightByName — no getFaceExpressionWeights() method exists
  // The enum is Expressions (global scope) — no FaceTracking.Expressions namespace
  const mouthOpen = head.getExpressionWeightByName('JawOpen')

  // Drive particle emission rate by mouth opening
  vfx.asset.properties['emitRate'] = mouthOpen * 50  // 0–50 particles/sec
  vfx.asset.properties['emitting'] = mouthOpen > 0.3
})
```


## SpawnOnTap Pattern

```typescript
@component
export class SpawnOnTap extends BaseScriptComponent {
  @input vfxPrefab: ObjectPrefab

  onAwake(): void {
    const tapEvent = this.createEvent('TapEvent')
    tapEvent.bind(() => {
      // Instantiate a new VFX instance at the tap position
      const instance = this.vfxPrefab.instantiate(null)
      // Position it (TapEvent gives screen position — use WorldQueryModule for 3D hit point)
      instance.getTransform().setWorldPosition(spawnPos)

      // Destroy after the effect finishes
      const cleanup = this.createEvent('DelayedCallbackEvent')
      cleanup.bind(() => instance.destroy())
      cleanup.reset(3)  // 3 seconds
    })
  }
}
```


## Common Gotchas

- **Property name must match exactly** — property names in the VFX graph are case-sensitive. Always log `Object.keys(vfx.asset.properties)` during development to see what's available.
- **Asset null check**: always guard with `if (!vfx || !vfx.asset)` — if the asset isn't assigned in the inspector, the property access will throw.
- **Type mismatch is silent** — passing a `number` to a `vec3` property won't error; it just won't work. Match the type exposed in the VFX graph.
- **Simulation space matters** — a `Local`-space emitter attached to moving content may produce unexpected particle trails; switch to `World` if that happens.
- **Writing properties every frame is fine** — VFX property writes happen on the CPU; the GPU reads them at emit time. Don't worry about performance for single-value writes.
- **`VFXComponent` is not `ParticleSystem`** — Lens Studio's VFX Graph is separate from the legacy Particle System component. They have different APIs and can't be mixed.
