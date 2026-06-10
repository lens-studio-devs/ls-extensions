---
name: physics
description: Build or debug Lens Studio physics — gravity, collisions, joints, raycast input, trigger zones, force-driven motion, and physics-driven AR (objects colliding with face/hand/world mesh). Use when wiring `BodyComponent`/`ColliderComponent`/`ConstraintComponent`/`WorldComponent`, building ragdolls, vehicles, breakables, or draggable props, debugging tunneling/constraints, or using `Physics.ForceMode`/`createGlobalProbe`/`addPointConstraint`/`WorldSettingsAsset`/`Matter`/`Filter`. Fires on `.esproj` with `Physics.*` or code like `body.addForce`/`probe.rayCast`. SKIP for other engines (Unity, Unreal, three.js, matter.js, Cannon, Rapier, Godot), non-physics LS work (visual-only face mesh, materials, TouchEvent with no body), and Hair/Cloth sim.
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Lens Studio Physics

Three-layer model — skipping a layer is where most bugs come from.

## 1. World

- Gravity, sim rate, slow-mo, speed limits, layer matrix — all live on a `WorldSettingsAsset`.
- **The root world's default settings are uneditable.** `Physics.getRootWorldSettings()` returns `null` until you create your own `WorldSettingsAsset` and assign it on the Scene asset's `physicsRootSettings` field. Writes to the implicit default silently no-op.
- **Ground Is Zero** — invisible infinite floor at `y = 0`, enabled by default on the root world. Disable it (Scene > Physics) when you need custom floor geometry or want to drop below `y = 0`. Custom `WorldComponent` worlds do not inherit it.
- For parallel simulations (slow-mo overlay, inverted-gravity zone, isolated UI), add a `Physics.WorldComponent`. **Character Controller projects are limited to a single `WorldComponent`.**

## 2. Body and Collider

- `Physics.ColliderComponent` = static / trigger. `Physics.BodyComponent` extends Collider with a `dynamic` flag plus mass/density/damping. **`Body { dynamic: false }` ≡ a Collider** — prefer `ColliderComponent` for static intent; it reads cleaner and skips the mass/damping fields.
- **One body OR collider per SceneObject.** Multi-shape silhouettes use the **compound pattern**: parent owns `BodyComponent`; each child SceneObject owns a `ColliderComponent` with its own shape. The whole assembly tumbles as one rigid body. `forceCompound: bool` on a child controls whether raycasts return the leaf or the parent.
- Three build modes:
  - **A — fresh primitive**: use `*PhysicsObjectPreset` (Box / Sphere / Capsule / Cone / Cylinder). Comes wired with mesh + body + matching shape. For purely static visuals, use the non-physics counterparts (`BoxMeshObjectPreset` …) and add a `ColliderComponent` — clearer intent than dropping a physics preset and flipping `dynamic = false`.
  - **B — attach to existing imported mesh**: add `BodyComponent` / `ColliderComponent`, pick a shape, size to match. **Off-center pivots need a pivot-wrapper** — a body rotates around the SceneObject pivot, not the mesh center. Pin authored with pivot-at-base spins sideways instead of toppling. See `references/api-surface.md` § Fitting.
  - **C — skinned / deforming mesh (face / hand / body / world mesh)**: `ColliderComponent` only (dynamic skinned bodies are unsupported). Set both `shape.mesh` and `shape.skin` — without `skin` the collider freezes at the bind pose. Hollow + no CCD → fast bodies tunnel; raise `simulationRate` or use a primitive on the dynamic side.
- **Always turn on `debugDrawEnabled = true` while authoring.** The cyan wireframe is the only way to see whether a collider matches the visual.

## 3. Constraints

- `Physics.ConstraintComponent` on a **child** of a body. Types: `Fixed` / `Point` / `Hinge`. `target` = another body/collider, or `null` to anchor to world.
- The component's world transform when added becomes the anchor — **immutable after**. Move the `target` to move the joint.
- **Hinge axis = local Y of the constraint child.** See `references/gotchas.md` § *Hinge axis defaults to local Y* for the rotation recipe and code example.
- **Persistent** (editor-authored child) vs **ad-hoc** (`body.addPointConstraint / addFixedConstraint / addHingeConstraint`, paired with `removeConstraint`) — pick by lifetime. Ad-hoc is the canonical form for grab/throw/break interactions.

## Hard limits

- **Collider sweet spot: 10 cm – 5 m** under default gravity. Lens Studio has no continuous collision detection — below 10 cm, fast bodies tunnel through static colliders.
- **Mitigations for fast scenes**: raise `worldSettings.simulationRate` (default 60, valid 30–240 step 30) to 120/240, or set `absoluteSpeedLimit` / `relativeSpeedLimit`.
- **Units are centimeters.** Default gravity `(0, -980, 0)` cm/s². **Right-handed**: +X right, +Y up, **−Z forward**.
- **Object budget**: ~200 dynamic bodies on mobile, ~100 on Spectacles 2021.
- **Mesh shapes**: `shape.convex = true` is **required** on dynamic bodies (engine bakes a convex hull; concavity collapses). For concave dynamic geometry, use a compound of primitives. Mesh-vs-mesh is the most expensive contact pair.
- **`fitVisual` only works on Box and Sphere** — Capsule/Cylinder/Cone/Mesh silently ignore it. `Plane.mesh` has 0 thickness on Y, so `fitVisual` on a flat floor produces a zero-thickness slab that bodies fall through. Static floors/walls need ≥ 20 cm explicit thickness on the contact axis.
- **Matter combines multiplicatively** between the two contact surfaces — a bouncy ball that "won't bounce" is almost always a wall with no `matter` assigned.
- **Filter `includeIntangible` defaults to false** — triggers don't detect other triggers unless explicitly opted in.

## Behavior helper vs script

| Behavior helper | Script |
|---|---|
| Trigger is a `Physics Collider Event`, response is a stock action (Play Sound, Set Color, Spawn Prefab, Apply Force, Send Custom Trigger) | Need raycasts, dynamic spawning, math on contact normals, conditional logic on impulse |
| Purely declarative (event → action) | Read/write `velocity` / `angularVelocity`, apply mass-aware impulses, per-frame `UpdateEvent` loop |

Bridge: `global.behaviorSystem.sendCustomTrigger('name')` ↔ `addCustomTriggerResponse('name', cb)`.

`Physics Collider Event` has its own Static / Dynamic / Intangible filter checkboxes — set them on the trigger, not on the body.

## Adjacent features (NOT this skill)

- **Hair / Cloth Simulation** — separate runtimes with their own components. World-physics bodies do not interact with them. Cloth only accepts primitive Physics colliders. **LevelSet shapes belong here**, not on rigid bodies — `Physics.ColliderComponent` will accept a LevelSet shape but rigid bodies won't collide with it.
- **Character Controller** — separate movement system that talks to physics but isn't a body. Limits the project to a single `WorldComponent`.

## When to dig deeper

- **Full API surface** (force modes, event payloads, Probe / raycast / shapeCast, constraint types, matter/filter, shape.skin, compound, persistent vs ad-hoc): `references/api-surface.md`.
- **Fitting colliders to imported meshes** (bbox-vs-pivot check, shape picker, wrapper recipe, sizing math, `Editor.Shape.create*Shape(scene)` patterns): `references/api-surface.md` § Fitting.
- **Gotchas list** — read before debugging anything that "doesn't work": `references/gotchas.md`.
- **Patterns library** (static obstacle, dynamic-on-tap, hinge/point/fixed joints, trigger zone, continuous-force field, articulated chain, compound, skinned-mesh, multi-world, drag-to-move): `references/patterns.md`.
- **Drag-to-Move** — the most reusable physics input pattern: `references/draggable-pattern.md`.
- **MCP workflow specifics** (scene-graphql / asset-graphql shapes for physics components, dispatching shape construction to `editor-api-specialist`): `references/mcp-workflow.md`.
