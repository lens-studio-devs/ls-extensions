<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Lens Studio Physics — The Drag Pattern

The Lens Studio Physics sample project ships a reusable Drag Script (locate it via the asset browser; the path varies by template version) that implements **tap-to-grab-and-drag any physics body**. It's **one** of the common input-driven physics patterns — useful whenever the user wants to "pick up and move" a body without breaking the simulation around it.

Peer patterns to consider before picking this one:

- **Tap-to-launch** — apply `VelocityChange` on `TapEvent`. The right choice when the user fires-and-forgets (slingshot, bowling, projectile). See `patterns.md` Pattern 2.
- **Continuous push** — apply `Force` in `UpdateEvent` while touch is held. The right choice for "blow on it" / "push it gently along".
- **Aim-and-fire** — raycast on tap, apply impulse to whatever was hit. The right choice for gravity-gun style ranged interactions.
- **Gaze-pickup on Specs** — use the user's gaze direction as the ray (no screen-space input). See variants below.
- **Drag the world around the body** — move the camera instead of the body. The right choice when the body is the "anchor" and the user is repositioning their view.

Reach for **this pattern** only when the user actually needs to hold a body, drag it around, and have it keep responding to gravity and collisions during the drag.

## The idea

To drag a physics body, you don't move it directly (that fights gravity and other forces). Instead:

1. On tap, **raycast** from the camera through the touch point. The first hit collider's body is the "grabbed" body.
2. Create an invisible **target collider** somewhere in world space.
3. **Attach a point constraint** between the grabbed body and the target collider. The point constraint pins them together — they can rotate freely relative to each other but their pivot points stay aligned.
4. On touch-move, move the target collider. The constraint hauls the grabbed body along — it still responds to gravity, collisions, and other forces.
5. On release, remove the constraint. The body's velocity at the moment of release becomes its initial velocity (great feel — toss objects with a flick).

The crucial detail is that the body keeps physics simulation active during the drag — you can drag it INTO other bodies and they collide naturally. Direct transform manipulation would skip collisions entirely.

## Three Body convenience methods (undocumented but very useful)

The `BodyComponent` exposes shortcuts that bypass the child-SceneObject + `ConstraintComponent` workflow for ad-hoc constraints:

```ts
const constraint: ConstraintComponent = body.addPointConstraint(targetCollider, worldPos);
const constraint: ConstraintComponent = body.addFixedConstraint(target);
const constraint: ConstraintComponent = body.addHingeConstraint(target, worldPos, worldAxis);
body.removeConstraint(constraint);
```

They return a `ConstraintComponent` that you store for later teardown. Use these for runtime-created constraints (drag, ad-hoc joints, breakable connections). Use the `ConstraintComponent`-on-child-SceneObject pattern for permanent design-time constraints (doors, pendulums).

`collider.clearMotion()` — zero out linear + angular velocity on a collider. Important to call on a kinematic target right before attaching a constraint, otherwise its accumulated motion can impart an unwanted impulse on the grabbed body.

## Minimal reference implementation

```ts
@component
export class Draggable extends BaseScriptComponent {
  @input camera: Camera;
  @input includeStatic: boolean = false;
  @input includeDynamic: boolean = true;
  @input includeIntangible: boolean = false;

  private probe = Physics.createGlobalProbe();
  private targetObj!: SceneObject;
  private targetCollider!: ColliderComponent;
  private dragBody: BodyComponent | null = null;
  private dragConstraint: ConstraintComponent | null = null;
  private dragDepth = 0;
  private dragTouchId = -1;
  private touchPos: vec2 | null = null;
  private wasStatic = false;

  onAwake() {
    global.touchSystem.touchBlocking = true;     // claim taps from Snapchat

    this.probe.filter.includeStatic = this.includeStatic;
    this.probe.filter.includeDynamic = this.includeDynamic;
    this.probe.filter.includeIntangible = this.includeIntangible;

    // Create an invisible target collider that we'll move around to drag bodies.
    this.targetObj = global.scene.createSceneObject('DragTarget');
    this.targetCollider = this.targetObj.createComponent('Physics.ColliderComponent') as ColliderComponent;
    this.targetCollider.intangible = true;       // doesn't collide with anything itself

    this.createEvent('TouchStartEvent').bind(e => this.onTouchStart(e));
    this.createEvent('TouchMoveEvent').bind(e => this.onTouchMove(e));
    this.createEvent('TouchEndEvent').bind(e => this.onTouchEnd(e));
    this.createEvent('UpdateEvent').bind(() => this.onUpdate());
  }

  private rayFromTouch(touchPos: vec2, depth: number): { start: vec3; end: vec3 } {
    const camTr = this.camera.getTransform();
    const start = camTr.getWorldPosition();
    const worldPos = this.camera.screenSpaceToWorldSpace(touchPos, 1);
    const dir = worldPos.sub(start).normalize();
    return { start, end: start.add(dir.uniformScale(depth)) };
  }

  private onTouchStart(e: TouchStartEvent) {
    if (this.dragTouchId !== -1) return;
    this.dragTouchId = e.getTouchId();
    this.touchPos = e.getTouchPosition();
    const { start, end } = this.rayFromTouch(this.touchPos, 10000);

    this.probe.rayCast(start, end, hit => {
      if (!hit) return;
      const obj = hit.collider.getSceneObject();
      const body = obj.getComponent('Physics.BodyComponent') as BodyComponent;
      if (!body) {
        // The hit collider is a ColliderComponent with no BodyComponent on the SceneObject.
        // Drag silently does nothing — no constraint can attach. Log it so wiring bugs
        // surface during testing rather than vanishing into a no-op.
        print(`Draggable: hit ${obj.name} has no BodyComponent — cannot drag.`);
        return;
      }

      // If we hit a static body and we're allowed to grab static, temporarily make it dynamic.
      if (!body.dynamic && this.includeStatic) {
        body.dynamic = true;
        this.wasStatic = true;
      }

      this.dragBody = body;
      this.dragDepth = hit.distance;
      this.targetObj.getTransform().setWorldPosition(hit.position);
      this.targetCollider.clearMotion();                            // avoid impulse spike
      this.dragConstraint = body.addPointConstraint(this.targetCollider, hit.position);
    });
  }

  private onTouchMove(e: TouchMoveEvent) {
    if (e.getTouchId() !== this.dragTouchId) return;
    this.touchPos = e.getTouchPosition();
    this.onUpdate();
  }

  private onUpdate() {
    if (!this.dragBody || !this.touchPos) return;
    const { end } = this.rayFromTouch(this.touchPos, this.dragDepth);
    this.targetObj.getTransform().setWorldPosition(end);
  }

  private onTouchEnd(e: TouchEndEvent) {
    if (e.getTouchId() !== this.dragTouchId) return;
    this.dragTouchId = -1;
    this.touchPos = null;
    if (!this.dragBody) return;
    if (this.dragConstraint) {
      this.dragBody.removeConstraint(this.dragConstraint);
      this.dragConstraint = null;
    }
    if (this.wasStatic) {
      this.dragBody.dynamic = false;
      this.wasStatic = false;
    }
    this.dragBody = null;
  }
}
```

## Variations to know

- **Different probe**: `Physics.createGlobalProbe()` hits everything across all worlds. `Physics.createRootProbe()` is root world only. `worldComponent.createProbe()` is one specific world (e.g., drag only objects in the slow-mo zone).
- **Filter by name**: add a `physicsAllowedNames: string[]` input and check `body.getSceneObject().name` in the raycast callback.
- **Filter by reference**: a `ColliderComponent[]` input lets you restrict to a hand-picked list.

### Specs — replace screen-space ray with gaze/pinch input

On Specs, there's no screen for `screenSpaceToWorldSpace` to anchor onto. The physics side stays the same — only the **ray source** and the **input event** change:

- Replace `TouchStartEvent` / `TouchMoveEvent` / `TouchEndEvent` with SIK pinch / interactable events.
- Replace `rayFromTouch(...)` with SIK's targeting ray, or `GestureModule` head/gaze pose.

For the canonical recipes (targeting ray, pinch-pull-release, fist-grab, init-order rule), use `ls-clad:specs-interaction-recipes`. Don't inline ad-hoc gaze code — the SIK + `HandInputData` patterns there handle paired-phone fallback and editor-mock correctly.

### Multi-touch — one drag per finger

`dragTouchId = -1` and the per-touch state in the reference impl assume a **single pointer**. For two-finger drag (move two bodies simultaneously), keep a `Map<touchId, DragState>` and instantiate one `DragTarget` collider + one constraint per active touch:

```ts
private drags = new Map<number, {
  body: BodyComponent;
  constraint: ConstraintComponent;
  targetObj: SceneObject;
  depth: number;
  touchPos: vec2;
  wasStatic: boolean;
}>();

private onTouchStart(e: TouchStartEvent) {
  const id = e.getTouchId();
  if (this.drags.has(id)) return;
  // ...build drag state, store in this.drags.set(id, state)...
}

private onTouchEnd(e: TouchEndEvent) {
  const id = e.getTouchId();
  const s = this.drags.get(id);
  if (!s) return;
  s.body.removeConstraint(s.constraint);
  s.targetObj.destroy();
  if (s.wasStatic) s.body.dynamic = false;
  this.drags.delete(id);
}
```

## Why this is so reusable

By layering the drag pattern on top of any of the assembled examples in `patterns.md` — bowling, pool, hinged door, breakable stack — you get a sandbox feel without writing scene-specific input handling. The Drag Script in the reference Physics sample project is used unchanged across all of its example sub-scenes.

## Quick checklist before recommending this

- Camera input (or gaze source on Specs) is set on the script.
- `global.touchSystem.touchBlocking = true` is present (phone) — claim taps from Snapchat's gestures.
- The drag target is an **intangible** collider — otherwise it collides with stuff and the drag jitters.
- The constraint is created with `addPointConstraint` (not Fixed) — Fixed would prevent the body from rotating naturally.
- On release, the constraint is removed with `body.removeConstraint(saved)`.
- If `includeStatic = true`, the saved static→dynamic flip is restored on release.
- The script handles the **no-body** case: a `ColliderComponent` (no BodyComponent on the same SceneObject) is a silent drag-failure source. The early-return + `print` in `onTouchStart` makes this visible during testing.

## Related

- `api-surface.md` § *Persistent vs ad-hoc constraints* — this pattern is the canonical example of the **ad-hoc** branch (runtime `body.addPointConstraint` / `removeConstraint`).
- `patterns.md` Pattern 5 (Trigger zone) — combining drag with an overlap event makes a coin-collector / magnet-zone / "drop here to win" interaction.
- `patterns.md` Pattern 4 (Fixed / Point joint) — design-time form for joints that should outlast the input gesture.
