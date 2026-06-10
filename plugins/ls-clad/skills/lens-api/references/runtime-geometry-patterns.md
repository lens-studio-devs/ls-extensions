<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Math Recipes — Runtime Gizmos and Geometry Reference

Sourced from `Essentials/Assets/RuntimeGizmos/` and `Essentials/Assets/MiniDemos/`.

## DotProduct demo — angle between gaze and object

```typescript
// Essentials/Assets/MiniDemos/DotProduct/TS/DotProductDemoTS.ts
// Shows how dot product gives the cosine of angle between two directions

function isLookingAt(camera: SceneObject, target: SceneObject, threshold: number = 0.9): boolean {
  const camForward = camera.getTransform().forward
  const toTarget = target.getTransform().getWorldPosition()
    .sub(camera.getTransform().getWorldPosition())
    .normalize()
  const dot = camForward.dot(toTarget)
  return dot > threshold  // 0.9 ≈ within ~26° cone
}
```

## ScaleBasedOnDistance — scale to maintain apparent size

```typescript
// Essentials/Assets/MiniDemos/DirectionShadows/ScaleBasedOnDistance.ts
@component
export class ScaleBasedOnDistance extends BaseScriptComponent {
  @input reference: SceneObject   // the camera or anchor point
  @input baseScale: vec3 = vec3.one()
  @input scaleFactor: number = 1.0

  onAwake() {
    this.createEvent('UpdateEvent').bind(() => {
      const dist = this.sceneObject.getTransform().getWorldPosition()
        .distance(this.reference.getTransform().getWorldPosition())
      const s = this.baseScale.uniformScale(dist * this.scaleFactor)
      this.sceneObject.getTransform().setLocalScale(s)
    })
  }
}
```

## Runtime line / polyline drawing

```typescript
// Essentials/Assets/RuntimeGizmos/Line.ts pattern
// Draw a world-space line segment each frame using a thin box mesh:

function drawLine(start: vec3, end: vec3, lineObj: SceneObject, thickness: number = 0.002): void {
  const mid = start.add(end).uniformScale(0.5)
  const len = start.distance(end)
  const dir = end.sub(start).normalize()

  const up = Math.abs(dir.dot(vec3.up())) > 0.999 ? vec3.right() : vec3.up()
  lineObj.getTransform().setWorldPosition(mid)
  lineObj.getTransform().setWorldRotation(quat.lookAt(dir, up))
  lineObj.getTransform().setLocalScale(new vec3(thickness, thickness, len))
}
```
