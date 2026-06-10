<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Lens Studio — Instantiation Patterns Reference

Sourced from `Essentials/Assets/Instantiation/TS/`.

## Spawn in a circle area
```typescript
// CircleAreaInstantiatorTS.ts
@component
export class CircleAreaInstantiatorTS extends BaseScriptComponent {
  @input center: SceneObject
  @input prefab: ObjectPrefab
  @input numberOfPrefabs: number = 10
  @input radius: number = 5.0

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.spawnAll())
  }

  private spawnAll(): void {
    const origin = this.center.getTransform().getWorldPosition()
    for (let i = 0; i < this.numberOfPrefabs; i++) {
      const angle = Math.random() * Math.PI * 2
      const dist  = Math.random() * this.radius
      const pos = new vec3(
        origin.x + Math.cos(angle) * dist,
        origin.y,
        origin.z + Math.sin(angle) * dist
      )
      const inst = this.prefab.instantiate(null)  // null = root
      inst.getTransform().setWorldPosition(pos)
    }
  }
}
```

## Spawn on a line with fixed spacing
```typescript
// InstantiateAlongLineWithFixedDistanceTS.ts
for (let i = 0; i < count; i++) {
  const t = i / (count - 1)
  const pos = start.add(end.sub(start).uniformScale(t))
  prefab.instantiate(parent).getTransform().setWorldPosition(pos)
}
```

## Spawn on a 3D grid
```typescript
// InstantiateOn3DGridsTS.ts
for (let x = 0; x < cols; x++)
for (let y = 0; y < rows; y++)
for (let z = 0; z < depth; z++) {
  const pos = origin.add(new vec3(x * spacingX, y * spacingY, z * spacingZ))
  prefab.instantiate(parent).getTransform().setWorldPosition(pos)
}
```

## Spawn on sphere surface
```typescript
// RandomPointsOnSphereSurfaceTS.ts
function randomOnSphere(center: vec3, radius: number): vec3 {
  const theta = Math.random() * Math.PI * 2
  const phi   = Math.acos(2 * Math.random() - 1)
  return new vec3(
    center.x + radius * Math.sin(phi) * Math.cos(theta),
    center.y + radius * Math.cos(phi),
    center.z + radius * Math.sin(phi) * Math.sin(theta)
  )
}
```

## Destruction with delay (from HookUpButtonsEventsTS.ts)
```typescript
const instance = prefab.instantiate(null)
const ev = this.createEvent('DelayedCallbackEvent')
ev.bind(() => {
  if (instance) { instance.destroy(); }
})
ev.reset(5) // destroy after 5 seconds
```
