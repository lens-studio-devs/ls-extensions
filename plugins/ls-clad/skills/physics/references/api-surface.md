<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Lens Studio Physics — API Surface

Runtime physics API for `Assets/*.ts` / `Assets/*.js`. **Runtime classes are global** (`BodyComponent`, not `Physics.BodyComponent`). The `Physics.*` namespace contains enums and factories.

## Component graph

```
Scene asset
  └── physicsRootSettings → WorldSettingsAsset     (null = uneditable default)

WorldSettingsAsset
  ├── gravity (vec3)                               default (0, -980, 0) cm/s²
  ├── defaultMatter  → Matter                      fallback when collider has none
  ├── defaultFilter  → Filter                      fallback when collider has none
  ├── simulationRate (int, 30–240, step 30)        default 60
  ├── absoluteSpeedLimit / relativeSpeedLimit      tunneling clamps
  └── slowDownStep / slowDownTime                  slow-motion knobs

WorldComponent (parallel sim — slow-mo, inverted-gravity, isolated UI)
  ├── updateOrder (int, root = 0)
  └── worldSettings → WorldSettingsAsset

ColliderComponent (static / trigger)
  ├── shape → Box | Sphere | Capsule | Cone | Cylinder | Mesh
  ├── fitVisual (bool)                             Box/Sphere only
  ├── intangible (bool)                            trigger mode
  ├── matter / filter / overlapFilter / worldSettings   per-collider overrides
  └── debugDrawEnabled (bool)                      always on while authoring

BodyComponent extends ColliderComponent
  ├── dynamic (bool)                               false ≡ a ColliderComponent
  ├── damping / angularDamping                     0…1 per-frame decay (not real drag)
  ├── bodySetting (Mass | Density) + bodySettingValue
  └── velocity / angularVelocity                   direct r/w

ConstraintComponent (lives on a CHILD of a body)
  ├── constraint → Physics.Constraint.create(Fixed | Point | Hinge)
  └── target     → BodyComponent | ColliderComponent | null   (null = world)
```

Resolution order for matter/filter: per-collider → world `default*` → engine fallback. A "won't bounce" wall is almost always a wall with no matter assigned.

## Runtime globals vs `Physics` namespace

```ts
// Components — global, NOT Physics.*
@input body: BodyComponent;
@input collider: ColliderComponent;
@input constraint: ConstraintComponent;
@input world: WorldComponent;

// Engine APIs — namespaced
Physics.ForceMode.{Force, Acceleration, Impulse, VelocityChange, SetVelocity}
Physics.Constraint.create(Physics.ConstraintType.{Fixed, Point, Hinge})
Physics.Filter.create()
Physics.Matter.create()
Physics.WorldSettingsAsset.create()
Physics.createGlobalProbe()      // all worlds
Physics.createRootProbe()        // root world only
Physics.getRootWorldSettings()   // null until you assign a custom asset
```

Editor side (consumed via `ExecuteEditorCode`) uses `Editor.Components.Physics.BodyComponent` etc. — different types from runtime.

## WorldSettingsAsset

> See `SKILL.md` § *World* for the setup rules (null-until-assigned, Ground Is Zero). Per-world overrides: `WorldComponent.worldSettings`. Per-collider overrides: `collider.worldSettings`.

**Runtime fallback**: if you can't guarantee the root asset is wired, accept it as `@input worldSettings: Asset` instead of relying on `getRootWorldSettings()`.

| Property | Default | Notes |
|---|---|---|
| `gravity: vec3` | `(0, -980, 0)` cm/s² | Set `(0, 980, 0)` for inverted gravity. |
| `defaultMatter / defaultFilter` | none | Per-world fallbacks. |
| `simulationRate: int` | `60` | 30–240, step 30. Raise to 120/240 for fast small bodies. |
| `absoluteSpeedLimit: float` | `0` | cm/s clamp; 0 = disabled. |
| `relativeSpeedLimit: float` | `0.5` | Per-frame distance as fraction of shape size. Default prevents tunneling. |
| `slowDownStep / slowDownTime` | `1.0` | Discrete vs continuous slow-mo. Time-scale variant is smoother. |
| `setLayersCollidable(a, b, bool)` | | Mutate the layer matrix. |
| `resetLayerCollisionMatrix()` | | All-on default. |

## Matter

Coefficients combine **multiplicatively** between contact pairs.

| Property | Default | Notes |
|---|---|---|
| `friction` | `0.5` | `a.friction * b.friction`. |
| `rollingFriction` | `0` | Damps rolling. Not physically accurate. |
| `spinningFriction` | `0` | Damps spin. Not physically accurate. |
| `dynamicBounciness` | `0` | Used when both sides are dynamic. |
| `staticBounciness` | `1` | Used when one side is static. High default preserves wall energy. |

## Filter

Used by `WorldSettingsAsset.defaultFilter`, `ColliderComponent.filter`, `ColliderComponent.overlapFilter`, and `probe.filter`.

| Property | Type | Notes |
|---|---|---|
| `includeStatic / includeDynamic` | bool | Default true. |
| `includeIntangible` | bool | Default **false** — triggers don't detect other triggers. |
| `onlyLayers / skipLayers` | LayerSet | Allow/denylist. |
| `onlyColliders / skipColliders` | ColliderComponent[] | Allow/denylist by reference. |

## BodyComponent

Every `ColliderComponent` property plus:

| Property / method | Notes |
|---|---|
| `dynamic: bool` | `false` = behaves like a `ColliderComponent` (zero overhead). |
| `bodySetting` (`Mass` \| `Density`) + `bodySettingValue` | kg if Mass; kg/L if Density (derived from shape volume). |
| `damping / angularDamping` | 0…1 per-frame velocity decay. Not real drag. |
| `velocity / angularVelocity: vec3` | Direct r/w. Setting `velocity` is equivalent to `SetVelocity` force mode. |
| `addForce(force, mode)` | Linear at center of mass. |
| `addForceAt(force, offset, mode)` | Linear at offset → generates torque. |
| `addTorque(torque, mode)` | Pure angular. |
| `addRelativeForce / addRelativeForceAt / addRelativeTorque` | Local-frame variants. |
| `addPointConstraint(target, worldPos)` → `ConstraintComponent` | Ad-hoc joint; tear down with `removeConstraint`. |
| `addFixedConstraint(target)` → `ConstraintComponent` | |
| `addHingeConstraint(target, worldPos, worldAxis)` → `ConstraintComponent` | |
| `removeConstraint(c)` | |
| `clearMotion()` | Zero linear+angular velocity. Useful before re-attaching a constraint. |

### Collision events

`onCollisionEnter / onCollisionStay / onCollisionExit` — fire when a **dynamic** body contacts something. Static-vs-static produces nothing.

```ts
body.onCollisionEnter.add((e) => {
  const c = e.collision;
  print(`Hit ${c.collider.getSceneObject().name}, id=${c.id}`);
  for (let i = 0; i < c.contactCount; i++) {
    const { position, normal, impulse } = c.contacts[i];
  }
});
```

`e.collision.collider` is typed `ColliderComponent` but may be a `BodyComponent` at runtime — feature-test (`'addForce' in c.collider`) before reaching for body-only APIs. `onCollisionStay` fires every frame; reserve for sustained-impact effects, prefer Enter/Exit for one-shot logic.

## ColliderComponent

| Property | Notes |
|---|---|
| `shape` | A `Shape` — Box / Sphere / Capsule / Cone / Cylinder / Mesh. Dimensions are in the SceneObject's **local** frame (multiplied by world scale at runtime). See [Shapes](#shapes) below. |
| `fitVisual: bool` | Auto-stretch to `RenderMeshVisual`'s local AABB. **Box and Sphere only** — Capsule/Cylinder/Cone/Mesh silently ignore it. Sphere uses bounding-*sphere* radius (over-fits non-spherical meshes). |
| `forceCompound: bool` | When part of a compound, raycast returns the compound root instead of the leaf. |
| `intangible: bool` | No physical effect; still raycast-hits and fires overlap events. Trigger zones, wind zones, pocket detectors. |
| `matter / filter / overlapFilter / worldSettings` | Per-collider overrides (matter/filter fall back to world defaults). |
| `smooth + translateSmoothFactor / rotateSmoothFactor` | Smooths externally-driven motion (tracking, scripts). No effect on dynamic bodies. |
| `debugDrawEnabled: bool` | Cyan wireframe in Preview. Indispensable while authoring. |

### Overlap events

Request-only — only fires if you add a callback. Works for static-vs-static and intangible.

```ts
collider.intangible = true;
collider.overlapFilter.includeIntangible = false;
collider.onOverlapEnter.add(e => {
  print(`Entered: ${e.overlap.collider.getSceneObject().name}`);
});
```

## Shapes

Construct via `Editor.Shape.create*Shape(scene)` inside `ExecuteEditorCode` — the scene is the sole argument. Runtime scripts cannot construct shapes; pass them in via `@input … : Asset`.

| Shape | Sizing | Use for |
|---|---|---|
| **Box** | `size: vec3` | Cubes, walls, floors, bricks. |
| **Sphere** | `radius` | Balls. |
| **Capsule** | `axis` (0/1/2), `radius`, `length` (cylindrical segment; total span = `length + 2*radius`) | Rolling pills, character bobs, projectiles. |
| **Cylinder** | `axis`, `radius`, `length` | Pegs, pipes, cue sticks — **and anything that must stand upright** (bowling pins, bottles, cans). A capsule's hemispherical base rolls under any side load. |
| **Cone** | `axis`, `radius`, `length` | Funnels, horns, wedges. |
| **Mesh** | `mesh` (`RenderMesh`), `convex: bool`, `skin?` | Concave static silhouettes (funnels, ramps, terrain), or deforming AR meshes. |

**Mesh shape rules:**
- **`convex = true` is required on dynamic bodies** — engine bakes a convex hull, concavity collapses. For concave dynamic geometry, use a compound of primitives instead.
- Static mesh colliders are the most expensive contact pair — reach for primitives first.
- LS has **no continuous collision detection** — mesh colliders are effectively hollow on the inside; fast bodies tunnel through them. Mitigate with `simulationRate` 120/240 or `absoluteSpeedLimit`.

## Fitting colliders to existing imported meshes

The full fit loop — measure → triage → plumb → shape → verify → mass-apply — applies whenever an existing imported SceneObject needs a body/collider. Follow the recipe below directly: delegate the `ExecuteEditorCode`-heavy steps (traversal, `GetBoundingBox`, mass-apply) to the `editor-api-specialist` subagent; run the wireframe-vs-mesh screenshot check yourself — capture and look, per `lens-studio-field-notes`' See-and-fix loop.

**Order**: (0) measure, (1) triage failure modes, (2) pick shape, (3) size. Most failures skip step 0 or 1.

**Step 0 — Measure** with `GetBoundingBox`. `bboxCenter = (min + max) / 2` (world-space). `pivotOffset = bboxCenter − so.worldTransform.position`. The world AABB already accounts for rotation and scale. Note each axis extent and flag any axis with extent ≈ 0 (flat plane / billboard) or one axis wildly larger than the others (off-center pivot or hidden geometry).

**Step 1 — Pre-fit triage.** Walk the five failure modes in order *before* placing any collider — skipping this step is the most common reason a fit looks right in the editor and wobbles wrong at runtime.

1. **Pivot off-center?** `|pivotOffset|` > a small fraction of bbox extent → a body will rotate around the wrong point (a bowling pin authored with pivot-at-base spins sideways instead of toppling). `fitVisual = true` also lies in this case (it sizes around the pivot, not the mesh). **Wrap** in an empty parent at `bboxCenter` with identity rotation and `(1,1,1)` scale; reparent the visual under it with its local transform shifted by `−pivotOffset`; the body lives on the wrapper. Also handles multi-`RenderMeshVisual` SceneObjects (the world bbox already includes every visual).
2. **Need an offset on a Box?** Boxes have **no `offset` field** on the shape. If the collider must sit off the SceneObject pivot (e.g. an L-shape where the box wraps one arm), wrap in a child SceneObject whose `localTransform.position` carries the offset. Same wrapper pattern as failure mode 1.
3. **Parent has non-identity rotation?** Don't try to reason about which local axis maps to which world axis — that math is where fits silently go wrong. Place **one** collider, read back its world position, confirm against intent, *then* mass-apply to siblings. If the readback is on an unexpected world axis, flip the local axis or sign and retry.
4. **Ancestor has a `Skin` component?** The visual is bone-driven. The `BodyComponent` goes on the **Armature SceneObject**, not on the mesh SceneObject — putting the body on the mesh detaches it from the skeleton's transform. If the caller actually wants a deforming AR collider (Face / Hand / Full Body / Deform / World Mesh), this is *not* the rigid-body case; use the `shape.mesh + shape.skin` recipe in *Skinned / deforming mesh colliders* below.
5. **Flat plane / one-axis-zero?** Never `fitVisual` — it produces a zero-thickness slab that bodies fall through. Use explicit `BoxShape.size` with deliberate thickness on the thin axis (≥ 0.05 local; size so world thickness is ≥ 20–30 cm to avoid tunneling).

**Step 2 — Pick a shape.** Roughly cubic / wall / floor → Box. Roughly round → Sphere. Tall pill with rounded ends → Capsule. **Must stand upright on a flat base → Cylinder, not Capsule** (a capsule's hemispherical base rolls under any side load). Tube / peg / pipe / wheel → Cylinder. Funnel / horn / wedge → Cone. Concave static silhouette → Mesh (cost honestly; primitives first).

**Step 3 — Size.**
- `fitVisual = true` (Box/Sphere only): free and accurate when the mesh has volume on all 3 axes and the pivot is centered (see failure modes 1, 5).
- Manual from the wrapper (scale 1, identity rotation → local = world cm):
  - Cylinder pin/bottle: `radius = bboxWidth/2`, `length = bboxHeight`, `axis` = long direction.
  - Capsule pill: `radius = shortSide/2`, `length = longSide − 2*radius`.
  - Sphere: `radius = max(bboxExtent)/2` (or average for tighter fit on near-spherical meshes).
- For dynamic bodies thinner than 10 cm (dice, coins, dominoes), don't oversize the collider — bump `simulationRate` and/or set `absoluteSpeedLimit`.

### Minimal shape-build pattern

The physics-only lines (the generic `pluginSystem.findInterface(...)` preamble that exposes `scene` and `so` lives in `editor-api`):

```ts
const S = (Editor as any).Shape;
const body: any = so.components.find((c: any) => c.type === 'BodyComponent');

const box = S.createBoxShape(scene);
box.size = new vec3(1, 0.02, 1);    // LOCAL — multiplied by world scale
body.shape = box;
body.fitVisual = false;              // MUST set AFTER assigning shape — assignment resets it to true
body.debugDrawEnabled = true;
```

Other factories: `createSphereShape / createCapsuleShape / createCylinderShape / createConeShape / createMeshShape`. Capsule / Cylinder / Cone all take `axis` (0=X, 1=Y, 2=Z), `radius`, `length`.

**Gotchas (full list in `gotchas.md`):**
- `Editor.Shape.create*Shape(...)` requires the scene as its sole argument — no args fails with `Wrong argument count`.
- `body.shape = newShape` resets `fitVisual` to true — set `fitVisual = false` *after* assigning shape.
- `body.shape = Editor.Components.Physics.Box` (the type tag) fails with "Value is not a native object". Always construct via the factory.
- Capsule shapes don't honor `fitVisual` even when the readback says they do.

## Skinned / deforming mesh colliders

Bind a Mesh shape to a `Skin` component so the collider follows a deforming mesh — Face Mesh, Hand Mesh, Full Body Mesh, Deform Mesh, World Mesh. **`shape.mesh` alone gives a static snapshot at bind pose; `shape.skin` is required for live deformation.**

```ts
const meshShape = S.createMeshShape(scene);
meshShape.mesh  = rmv.mesh;                                      // RenderMeshVisual.mesh
meshShape.skin  = so.components.find(c => c.type === 'Skin');    // required
collider.shape  = meshShape;
collider.debugDrawEnabled = true;
```

**Constraints:**
- Must be a `ColliderComponent` (or `BodyComponent { dynamic: false }`). Dynamic skinned bodies are unsupported.
- Hollow + no CCD → fast bodies tunnel. Raise `simulationRate` or use a primitive on the dynamic side.
- Most expensive shape per-frame — use only where the silhouette truly matters.
- Hand/Body tracking presets typically include `Skin`. Bare `FaceMeshObjectPreset` ships only `RenderMeshVisual` — add `Skin` separately and let tracker presets populate its bones.

## Compound colliders

Parent owns `BodyComponent` (dynamics, mass, velocity). Each child owns `ColliderComponent` with its own shape. Engine simulates the union as one rigid body.

```
Parent  ── BodyComponent (mass / density / damping live here)
├── Child0  ── ColliderComponent + Box
├── Child1  ── ColliderComponent + Sphere
└── Child2  ── ColliderComponent + Cylinder
```

- Parent must have identity rotation `(0,0,0)` and scale `(1,1,1)` — non-uniform scale shears child shapes.
- Each child can carry its own `Matter` (low-friction hammer head + grippy handle).
- `forceCompound: bool` on a child: `true` raycasts return the parent; `false` return the leaf. Mix per child.
- Mass sums across children — keep per-child density consistent unless you want a weighted distribution.

3–4 nested primitives usually beat a single Mesh-shape collider on both cost and accuracy.

## ConstraintComponent

Goes on a **child** of a body. World transform when added becomes the anchor — **immutable after**. Move the `target` to move the joint.

| Property | Notes |
|---|---|
| `constraint` | `Physics.Constraint.create(Physics.ConstraintType.{Fixed, Point, Hinge})`. |
| `target` | Another `BodyComponent` or `ColliderComponent`. `null` → anchor to world. |
| `debugDrawEnabled` | Yellow axis line + pivot. |

**Types:**
- **Fixed** — locks position and rotation.
- **Point** — locks position, free rotation. Ball-and-socket, ad-hoc grab.
- **Hinge** — single rotation axis = the constraint child's **local Y**. See `gotchas.md` § *Hinge axis defaults to local Y* for the rotation recipe and code example.

**Persistent (editor-authored) vs ad-hoc (runtime)** — pick by lifetime:

| Persistent (design-time child SceneObject) | Ad-hoc (`body.addPointConstraint / addFixedConstraint / addHingeConstraint`) |
|---|---|
| Lives for the Lens lifetime (door, pendulum, swing arm, ragdoll, vehicle hinge) | Created/torn down dynamically (grab, breakable, slingshot, grappling hook) |
| Pivot authored in editor, fixed | Pivot computed from raycast hit, touch point, or state |
| Visible in SceneObject tree | No permanent child |

Ad-hoc form always pair with `body.removeConstraint(c)` teardown.

## WorldComponent

Parallel physics world. Children of this SceneObject simulate independently from the root world.

| Property | Notes |
|---|---|
| `updateOrder: int` | Multi-world execution order; root = 0. |
| `worldSettings: WorldSettingsAsset` | Own gravity, slow-mo, layer matrix. |
| `createProbe()` → Probe | Cast within this world only. |

Common uses: multiple gravity zones side-by-side, slow-motion overlay for impact moments, isolated UI physics.

## Probe (raycast / shapeCast)

```ts
const probe = Physics.createGlobalProbe();      // all worlds
const probe = Physics.createRootProbe();        // root world only
const probe = worldComponent.createProbe();     // specific custom world

probe.filter.includeStatic = true;
probe.filter.includeDynamic = true;
probe.filter.includeIntangible = false;
probe.filter.onlyLayers = layerSet;
probe.filter.skipColliders = [c1, c2];
probe.debugDrawEnabled = true;

probe.rayCast(start, end, hit => {
  if (!hit) return;
  const { collider, position, normal, distance, t } = hit;
  hit.skipRemaining = true;          // for rayCastAll
});

probe.rayCastAll(start, end, hits => { for (const h of hits) {…} });
probe.sphereCast(radius, start, end, hit => {…});
probe.sphereCastAll(radius, start, end, hits => {…});

// shapeCast — Shape must come from editor side via @input
@input sweepShape: Asset;
probe.shapeCast(this.sweepShape, start, startRot, end, endRot, hit => {…});
```

Swept-shape rotation limit: **180° per cast** (takes the shortest arc).

`hit.triangle` populates only for mesh colliders. `hit.skipRemaining = true` stops returning more hits past this one.

## Force modes

| Mode | Mass-aware? | Continuous? | Use |
|---|---|---|---|
| `Force` | yes | per-frame | Wind, gravity boost, rocket thrust |
| `Acceleration` | no | per-frame | Custom gravity, magnet-like pull |
| `Impulse` | yes | instant | Bullet hit, explosion, jump |
| `VelocityChange` | no | instant | Tap-to-jump (consistent height regardless of mass), launchers |
| `SetVelocity` | no | overwrite | Stop a body, hard-set initial velocity |

**Application points:**
- **Position** (`addForce`) — at center of mass; pure linear.
- **Position With Offset** (`addForceAt`) — at a world-space point; generates torque too.
- **Rotation** (`addTorque`) — pure angular.

## LevelSet — NOT supported in world physics

`Editor.Shape.createLevelSetShape(scene)` exists, and `Physics.ColliderComponent` will accept a LevelSet shape, but **rigid bodies will not collide with it.** LevelSet belongs to Hair Simulation and Cloth Simulation only. For deforming surfaces use a Mesh shape with `skin`; for static complex silhouettes use a compound of primitives.
