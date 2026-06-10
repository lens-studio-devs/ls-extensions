<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Lens Studio Physics — Patterns Library

Composable building blocks for physics scenes. Each pattern is **one capability**, not one scene. Bowling/pool/breakable/wind scenes are assembled by combining several patterns; see "Assembled examples" at the bottom.

Sizing and positioning are intentionally **symbolic** — every pattern points back to `api-surface.md` § *Fitting colliders to existing meshes* for the bbox-driven sizing math. The preview-camera/Interactive setup from `mcp-workflow.md` is assumed. Start from the pattern set a scene needs, not the scene name — then skim "Assembled examples" to see how the patterns fit together.

---

## Pattern 1 — Static obstacle (floor, wall, ramp)

The cheapest and most-used pattern: a fixed surface that dynamic bodies hit.

**When you need a generic flat floor** and don't care about its exact extent → don't build one. The root world's **Ground Is Zero** setting (Scene > Physics settings, enabled by default) is an invisible infinite floor at `y = 0`. Free, exact, and you can build everything dropped onto it without authoring a slab.

**When you need a finite or angled surface** (a ramp, a wall, a custom-shaped floor below `y = 0`, a finite arena):

- `ColliderComponent` (or `BodyComponent { dynamic: false }` — functionally identical, prefer `ColliderComponent` for static intent).
- Shape sized via the bbox-driven sizing math in `api-surface.md`. **Don't let it go below ~10 cm thick on any contact axis** or fast bodies tunnel.
- For floors: `Plane.mesh` has zero Y-thickness — set `fitVisual = false` and give an explicit Y size (≥ 20 cm typical).

**Used by:** every scene that has solid ground. Ramps, table edges, pool cushions, lane gutters, wall panels, breakable wall (its initial state).

---

## Pattern 2 — Dynamic primitive launched on input

The "make something happen on tap" pattern. Shows: `@input` binding, script wiring, mass-aware vs mass-independent force modes.

**Recipe:**

1. Body: a `*PhysicsObjectPreset` for primitive shapes, or pivot-wrapper + body for existing imported visuals (Mode B).
2. Script with `@input body: BodyComponent` and a launch handler bound to `TapEvent` / `TouchStartEvent` / a custom trigger.
3. On fire: `body.addForce(launchVec, Physics.ForceMode.VelocityChange)`.

**Why `VelocityChange` not `Impulse`:** VelocityChange ignores mass — the launch *velocity* is what you specified, regardless of the body's density. Impulse divides by mass, so a 300-unit impulse barely moves a 2.5 kg ball. **Reach for VelocityChange when you want consistent feel across bodies of different masses;** reach for Impulse when you want mass-aware behavior (a heavier object should require more impulse to move).

**Variants:**
- Self-firing for visual verification: bind `DelayedCallbackEvent` after `N` seconds to call the same handler — works without manual tap, useful for screenshot loops.
- Aim-and-fire: `Physics.createGlobalProbe()` raycast on tap, apply impulse to `hit.collider` (when it's a body) at `hit.position` via `body.addForceAt(...)`.

**Used by:** tap-to-launch projectile, bowling-ball launcher, slingshot, "punch" interaction.

---

## Pattern 3 — Hinge joint (one parameterization for door, pendulum, flap)

A `Hinge` constraint locks position and locks rotation to a single axis — the **local Y** of the constraint SceneObject. Vertical-axis (door) and horizontal-axis (pendulum) are the same pattern with a different rotation on the constraint child.

**Recipe:**

1. Body (the swinging thing) and a target body or static collider (the anchor) — both already exist.
2. Create an empty child SceneObject of the swinging body named e.g. `Hinge`.
3. Set `setLocalTransform` to place the pivot at the anchor's world position (compute local = world − parentWorld, divided by parent scale).
4. Set rotation:
   - **Vertical axis (saloon door, gate)**: `(0, 0, 0)` — local Y = world Y.
   - **Horizontal axis (pendulum, top-mounted flap)**: `(90, 0, 0)` — local Y now points along world Z.
5. `addComponent: ConstraintComponent`.
6. `setProperty: constraint = 2 (Hinge), target = <anchor body or null for world-anchored>, debugDrawEnabled = true`.

`debugDrawEnabled` is non-optional while authoring — the yellow line shows the actual axis, which is the only way to catch a wrong rotation before runtime.

**Used by:** doors, gates, see-saws, pendulums, vehicle wheels, swinging signs, top-mounted flaps.

---

## Pattern 4 — Fixed / Point joint

Two related constraints — pick by what rotation you want.

| Pick **Point** when… | Pick **Fixed** when… |
|---|---|
| Bodies should stay pinned together at one point but **rotate freely** relative to each other. | Bodies should be rigidly attached — no relative rotation. |
| Example: ball-and-socket joint, dragging a body around (the Drag pattern), connecting a rope segment to its neighbor. | Example: bolting a hammer head to a handle, welding two boxes into one rigid assembly. |

**Recipe — design-time (persistent):** same as Pattern 3 but with `constraint = 0 (Fixed)` or `1 (Point)`, and no rotation requirement on the constraint child (Fixed and Point are rotation-axis-agnostic).

**Recipe — runtime (ad-hoc):**

```ts
const c = body.addPointConstraint(targetCollider, worldPos);
const c = body.addFixedConstraint(target);
// later:
body.removeConstraint(c);
```

Use ad-hoc form for grab interactions, breakable connections, runtime-tuned scaffolds. See `references/draggable-pattern.md` for the canonical ad-hoc Point pattern.

**Used by:** rope/chain segment joining, breakable joints, drag-to-move, rigid assembly of multiple imported parts.

---

## Pattern 5 — Trigger zone (intangible collider + onOverlap)

A volume that detects when another body enters/exits without applying force. The basis for coin collectors, kill zones, pocket sensors, wind volumes, gameplay regions.

**Recipe:**

1. `ColliderComponent` (no body needed) with `intangible = true` — doesn't push anything, but still fires overlap events.
2. Shape sized to the volume.
3. In script: `collider.overlapFilter.includeDynamic = true; collider.onOverlapEnter.add(e => { ... })`.
4. In the callback, inspect `e.overlap.collider.getSceneObject()` to identify what entered.

`includeIntangible` on `overlapFilter` defaults to `false` — the **self** being intangible doesn't matter; the filter is about whether to detect *other* intangible colliders. Leave the default unless you specifically want triggers to detect other triggers.

**Behavior-helper equivalent** for no-code wiring: `Physics Collider Event` trigger → `Play Sound` / `Destroy Object` / `Send Custom Trigger` response. Use the helper when the response is one of those stock actions; reach for a script when you need raycasts, math, or per-frame logic.

**Used by:** coin collector, kill zone, pocket sensor (pool), wind volume (combine with Pattern 6), checkpoint, scoring zone, magnet zone (combine with Pattern 6).

---

## Pattern 6 — Continuous-force field (wind, magnet, current, buoyancy)

Pattern 5 (trigger zone) plus a per-frame force applied to every body inside. The force vector is the only thing that distinguishes wind from magnet from buoyancy.

**Recipe:**

```ts
@component
export class ContinuousForceField extends BaseScriptComponent {
  @input collider: ColliderComponent;
  @input forcePerFrame: vec3 = new vec3(0, 0, -50);
  @input mode: number = 1;   // 0=Force (mass-aware), 1=Acceleration (mass-independent)

  onAwake() {
    this.collider.overlapFilter.includeDynamic = true;
    this.collider.onOverlapStay.add(e => {
      for (let i = 0; i < e.currentOverlapCount; i++) {
        const c = e.currentOverlaps[i].collider as any;
        if (!('addForce' in c)) continue;        // ColliderComponent without body — skip
        const mode = this.mode === 0 ? Physics.ForceMode.Force : Physics.ForceMode.Acceleration;
        c.addForce(this.computeForce(c), mode);
      }
    });
  }

  protected computeForce(_body: BodyComponent): vec3 {
    return this.forcePerFrame;
  }
}
```

**Force-vector variants** (override `computeForce`):

- **Wind**: constant `forcePerFrame`. `Acceleration` mode so light and heavy bodies drift equally.
- **Magnet**: `attractorWorldPos.sub(bodyWorldPos).normalize().uniformScale(strength)`. `Force` mode so heavy objects accelerate less — feels right.
- **Buoyancy**: `new vec3(0, +g * displacedVolume * fluidDensity / bodyMass, 0)`. `Acceleration` mode + extra damping.
- **Current**: like wind but with a depth-varying direction.

**Don't use the Behavior helper's `Physics Apply Force` for continuous fields** — it fires once per trigger event, so the force you wanted as a sustained push lasts one frame. Use a script.

**Used by:** wind zone, gravity well, magnet, buoyancy/water volume, conveyor belt, river current, air-jet launcher.

---

## Pattern 7 — Articulated chain (ragdoll, rope, responsive plant)

A series of dynamic bodies connected end-to-end by constraints, anchored to a static base.

**Recipe:**

1. Static anchor: `ColliderComponent` on a non-moving SceneObject.
2. N segment bodies: `BodyComponent dynamic = true`. Each capsule / box / sphere depending on the silhouette you want.
3. Each segment gets a `ConstraintComponent` (child SceneObject) whose `target` is the previous segment (or the anchor for segment 0).
4. Pick the joint type per use case:
   - **Floppy rope** → Point constraints.
   - **Semi-rigid stem / plant** → Fixed constraints with low density on segments.
   - **Hinge skeleton (ragdoll knee, elbow)** → Hinge constraints.

**The non-obvious rule:** segments must NOT be parented to each other in the scene hierarchy. They live at the **same level** (under a common group SceneObject), connected only via constraints. Parenting would compound transforms — the constraint expects an unforced parent transform.

**Used by:** rope/chain, ragdoll skeleton, responsive plant/tail, hanging banner, swinging trapeze, jellyfish tentacle.

---

## Pattern 8 — Compound body (multi-shape per object)

When one primitive can't approximate the silhouette and a Mesh shape would be too expensive: nest child SceneObjects under one parent.

**Recipe:**

```
Parent (BodyComponent — dynamics owner: mass, density, damping)
├── Child A — ColliderComponent + Box shape
├── Child B — ColliderComponent + Sphere shape
└── Child C — ColliderComponent + Cylinder shape
```

- **Only the parent** carries `BodyComponent`. Each child carries `ColliderComponent` (not another body — that doubles the simulation).
- Keep the parent's transform clean (rotation `(0,0,0)`, scale `(1,1,1)`) so child local coords map directly to world coords. Non-uniform parent scale shears child shapes — see `gotchas.md`.
- Each child can have its own `Matter` (e.g. low-friction hammer head, grippy handle).
- `forceCompound = true` on a child makes raycasts return the parent collider; `false` returns the leaf. Pick per gameplay need (see `gotchas.md`).

**Why this beats a Mesh-shape collider:** 3–4 well-placed primitives are far cheaper per frame than a Mesh shape and usually approximate the silhouette better for collision purposes (you get a solid, not a hollow shell).

**Used by:** humanoid character body, chair, hammer (head + handle), spaceship (fuselage + wings), L-shaped block, irregular prop.

---

## Pattern 9 — Skinned / deforming-mesh collider (AR physics)

The marquee AR-physics capability: physics objects collide with the user's face, hand, body, or detected world geometry as those surfaces deform in real time.

**Recipe:**

1. Start with a SceneObject that has a `RenderMeshVisual` driven by a deforming source: `Face Mesh`, `Hand Mesh`, `Full Body Mesh`, `Deform Mesh`, or `World Mesh`. Most of these come from tracker presets and already have a `Skin` component.
2. Add a `ColliderComponent` (NOT a dynamic body — skinned mesh colliders cannot be dynamic).
3. Build a Mesh shape and bind both `mesh` and `skin`:

```ts
const rmv  = so.components.find(c => c.type === 'RenderMeshVisual');
const skin = so.components.find(c => c.type === 'Skin');   // add via scene-graphql if absent
const collider = so.components.find(c => c.type === 'ColliderComponent');

const meshShape = Editor.Shape.createMeshShape(scene);
meshShape.mesh = rmv.mesh;
meshShape.skin = skin;       // CRITICAL — without this, the collider freezes at bind pose
collider.shape = meshShape;
collider.debugDrawEnabled = true;
```

**Caveats:**

- Skinned mesh colliders are **hollow shells** — fast dynamic bodies tunnel through them. Mitigations: raise `worldSettings.simulationRate` to 120 or 240; clamp `absoluteSpeedLimit`; or use a primitive on the dynamic side (sphere collider for a "ball" hitting the head — the visual can still be a fancy mesh).
- They cannot be `dynamic = true`. The deformation source drives the geometry — the simulation doesn't.
- Expensive per-frame. Use only where the silhouette matters (head, hand, body, world); otherwise wrap the tracker's transform in a primitive.

**Used by:** ball that bounces off the user's face/hand, hat that lands on a tracked head, props that interact with detected world geometry (table, wall), full-body physics interactions (snowball fight against a tracked person).

---

## Pattern 10 — Multi-world (slow-mo, inverted gravity, isolated UI physics)

Run independent simulations side-by-side in one scene.

**Recipe:**

1. SceneObject with `Physics.WorldComponent` for each world (root world is implicit — order 0).
2. Each world has its own `worldSettings: WorldSettingsAsset` — gravity, simulationRate, slow-time, layer matrix.
3. Place physics objects under the appropriate world SceneObject — children of a `WorldComponent` simulate **only** in that world.
4. Optional: a script that reparents an object between worlds when a trigger fires ("step into slow-motion zone" = move from world A to world B mid-game).

**Hard constraint:** if any `Character Controller` component exists in the project, **only one** `WorldComponent` is supported. Multi-world demos silently misbehave under a Character Controller. Pick: parallel worlds OR a Character Controller, not both.

**Used by:** slow-mo overlay for impact moments, inverted-gravity zone (seaweed example), isolated UI physics that shouldn't interact with the gameplay world.

---

## Pattern 11 — Rolling cylinder (vehicle wheel, inclined plane)

A cylinder with the right axis convention and low rolling friction. Distinct from Pattern 2 because the energy goes into rotation, not translation.

**Recipe:**

1. `CylinderPhysicsObjectPreset` (Mode A) or a wrapper with cylinder shape (Mode B).
2. `axis` aligned with the rolling axis — for a wheel rolling along the X-Z floor, `axis = 0 (X)` or `axis = 2 (Z)` depending on roll direction; **not** `axis = 1 (Y)` (that's an upright cylinder).
3. `Matter` with `friction ≈ 0.4` (enough to grip the surface) and **low `rollingFriction` ≈ 0.001** so the wheel keeps rolling instead of damping out in two frames.
4. For vehicles: attach two wheels to a chassis via Hinge constraints (Pattern 3, horizontal axis). The chassis is a separate dynamic body. The wheels' hinge children rotate `(90, 0, 0)` so the hinge axis matches the wheel's roll axis.

**For a rolling ball:** Pattern 11 isn't right — a sphere has rolling-friction issues but doesn't need axis specification. Use a sphere with `rollingFriction ≈ 0.001` directly.

**Used by:** vehicle wheels, ramp-rolling barrel, gear/cog, bowling ball traversal (the cylinder model is wrong for the ball itself but right for the pin's secondary tip-spin).

---

# Assembled examples

These are recognizable scenes built by combining the patterns above. They're **demonstrations**, not recipes — start from the pattern set, not the name.

## Bowling

- Pattern 1: static lane + gutters (or skip the lane and use Ground-Is-Zero with thin gutters).
- Pattern 2: launch the ball (`VelocityChange`).
- Pattern 8 OR a `CylinderPhysicsObjectPreset` per pin: pins are **cylinders** (Pattern 11's axis convention but stationary), not capsules — capsules' rounded base rolls under any side load and pins fall over on frame one.
- World settings: raise `simulationRate` to 120+ (pin break is the canonical fast-collision scenario).
- Materials: lane `Matter` with high friction + low rolling friction; pin `Matter` with low density (light pins). Heavy ball density 2 g/cm³ ish.

## Pool table (top-down)

- Pattern 1: felt + 4 cushions (cushion `Matter` with `dynamicBounciness ≈ 0.9` for lively rebounds).
- Pattern 5: 6 intangible pocket triggers, `onOverlapEnter` to despawn balls.
- 16 ball bodies with damping just high enough to converge to rest.
- Cue: combine Pattern 11 (cylinder) with `references/draggable-pattern.md` for cue control; on release apply `addRelativeForceAt(forceVec, hitOffset, Impulse)` to the cue ball for spin.

## Breakable stack

- Pattern 1: floor (or Ground-Is-Zero).
- N dynamic primitives stacked vertically.
- Pattern 2: projectile body.
- Pattern 5 *or* a Behavior helper per box: `Physics Collider Event` (Collision, On Enter) filtered to the projectile → `Instantiate Prefab` (chunks) + `Destroy Object` (self). The filter prevents box-on-box collisions in the stack from triggering breaks.

## Swinging door

- Pattern 1: static wall pillar (the hinge anchor).
- Pattern 3 vertical-axis: door body + Hinge child rotated `(0, 0, 0)`.
- Optional Pattern 2 for a pusher object that hits the door.

## Pendulum

- Pattern 1 OR a world-anchored Hinge (target `null`).
- Pattern 3 horizontal-axis: bob body + Hinge child rotated `(90, 0, 0)`.

## Ragdoll / responsive plant

- Pattern 7: anchored chain of capsule (or compound) bodies.
- Joint mix: Point for floppy ragdoll limbs, Hinge for knee/elbow joints, Fixed for stiff plant stems.

## Trigger zone with score + sound

- Pattern 5: intangible zone collider.
- Behavior helper on the zone: `Physics Collider Event` (Overlap, On Enter, filtered to the collectible) → `Play Sound` + `Destroy Object` (the collectible) + `Send Custom Trigger 'coin_collected'`.
- A separate script listens with `global.behaviorSystem.addCustomTriggerResponse('coin_collected', updateScore)`.

## Slow-mo zone

- Pattern 10: two `WorldComponent`s — normal world A, slow-mo world B (`slowDownTime = 5`).
- Pattern 5: an intangible trigger that reparents the player body from A to B on `onOverlapEnter` (and back on Exit).

## Magnet / attractor

- Pattern 5: intangible zone collider defining the magnet's reach.
- Pattern 6 with `computeForce` = `attractorPos.sub(bodyPos).normalize().uniformScale(strength)`, `Force` mode.

## Buoyancy / water volume

- Pattern 5: intangible water-volume collider.
- Pattern 6 with `computeForce` = constant upward force scaled by submerged depth, plus extra `damping` on bodies inside.
