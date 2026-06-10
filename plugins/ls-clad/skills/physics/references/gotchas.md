<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Lens Studio Physics — Gotchas

## Runtime types are NOT under the `Physics.` namespace

Wrong (compiler error):
```ts
@input body: Physics.BodyComponent;
```

Right:
```ts
@input body: BodyComponent;
@input collider: ColliderComponent;
@input world: WorldComponent;
```

But the engine APIs ARE namespaced — `Physics.ForceMode.VelocityChange`, `Physics.Constraint.create`, `Physics.createGlobalProbe`. The split is type-vs-API.

## Hinge axis defaults to local Y of the constraint object

If you create a hinge child with rotation `(0, 0, 0)`, the hinge axis is world Y (vertical). That's good for saloon doors but useless for pendulums — gravity is parallel to the axis so nothing swings.

For a pendulum or top-mounted swinging flap, rotate the constraint **BEFORE adding the component**:
```ts
pivot.getTransform().setLocalRotation(
  quat.angleAxis(Math.PI / 2, new vec3(1, 0, 0))     // local Y now points along world Z
);
pivot.createComponent('Physics.ConstraintComponent');
```

The `debugDrawEnabled = true` yellow line shows the actual axis — always enable it while authoring constraints.

## Constraints cannot be moved after creation

Setting `constraint.target` works, but changing the constraint SceneObject's transform after the component is attached is silently ignored. If you need to change the pivot:

1. Destroy the constraint child.
2. Recreate it with the new transform.
3. Add a fresh `ConstraintComponent`.

To "move" a constraint anchor without destroying it: move the `target` collider — the constraint follows.

## Parent scale multiplies child local position

If a body has scale `(2, 2, 2)` and you place a constraint child at local `(-50, 0, 0)`, the child's world offset is `(-100, 0, 0)` — twice what you wanted.

Two fixes:

1. **Preferred:** keep bodies at scale `(1, 1, 1)` and resize via `shape.size` (box) / `shape.radius` (sphere) / etc.
2. **Compute compensating local:** `localPos = (targetWorldPos - parentWorldPos) / parentScale`.

This bites hardest with the `*PhysicsObjectPreset` presets, which default to scale `(10, 10, 10)`.

## Default preset scale is 10, not 1

`BoxPhysicsObjectPreset` and friends spawn at scale `(10, 10, 10)`. For most scenes you want `(1, 1, 1)` and configure the shape directly. Either way, set this BEFORE adding constraint children.

## `addForce` mode matters more than force magnitude

The #1 reason "the impulse does nothing": wrong `ForceMode`. Quick diagnostic — if a 300-unit impulse barely moves your 2.5 kg ball, the magnitude is too small for the mass; switch to `VelocityChange` (mass-independent) or scale the impulse by mass. Continuous modes (`Force` / `Acceleration`) must be applied every frame in `UpdateEvent`, not once on `TapEvent`. Full mode table + application-point matrix: `api-surface.md` § *Force modes*.

## Editor `worldTransform.position` doesn't reflect runtime simulation

```ts
// After PreviewPanelTool refresh + sleep, this STILL returns the design-time position:
ball.worldTransform.position;   // useless for runtime checks
```

This is the canonical example of a generic rule documented in `editor-api`: the editor model is a design-time snapshot, not a runtime view. For motion verification, screenshot the preview; for "did my handler fire", use `print()` + `RunAndCollectLogsTool`.

## Mesh colliders are hollow

A mesh-shape collider — even on a closed mesh — is a thin shell. Fast bodies tunnel through it because Lens Studio doesn't have CCD. Fixes:

- Raise `worldSettings.simulationRate` to 120 or 240.
- Use primitive shapes for fast-moving bodies (sphere collider for a bowling ball, even if the mesh is detailed).
- Compound multiple primitives instead of one mesh collider.

For static environment colliders (lane edges, table cushions), mesh is fine because nothing is moving through them at speed.

## `Convex` flag must be true for dynamic mesh-shape bodies

The engine generates a convex hull from the mesh — concave details collapse. If you need concave dynamic shapes, decompose the mesh into convex pieces in a DCC tool and compose them as a compound.

## Bouncing "doesn't work" — check the partner

If your ball has `dynamicBounciness = 0.9` but the floor's matter has `staticBounciness = 0` or the floor has no matter assigned (so it uses the world default `Matter` which might be 0), the product is zero.

Set bounciness on BOTH surfaces, or set the world's `defaultMatter` to a high-bounciness asset.

## Collision events only fire when one side is dynamic

Two static colliders touching produce zero events. Make at least one side a dynamic `BodyComponent` to get `onCollisionEnter/Stay/Exit`.

For trigger volumes, use `onOverlapEnter/Stay/Exit` instead — those work for any combination of static/dynamic/intangible (with the appropriate `overlapFilter`).

## `includeIntangible` defaults to false on `overlapFilter`

Common confusion: setting `includeIntangible = true` to "include myself" — no, the filter is about what other types of colliders the events should fire for. The SELF being intangible doesn't matter; leave the default (`false`) unless you specifically want triggers to detect other triggers.

## TouchEvent on the screen doesn't auto-block Snapchat's gestures

For drag interactions, Snapchat's app may grab the touch first. The Drag Script does:

```ts
global.touchSystem.touchBlocking = true;
```

Without this, taps swap the camera instead of starting a drag.

## Behavior helper script's `Physics Apply Force` ignores `Force`/`Acceleration` modes

The Behavior helper's `Physics Apply Force` response works best with instantaneous modes (`Impulse`, `VelocityChange`, `Set Velocity`). For continuous modes, attach a real script that applies the force every frame in `UpdateEvent`.

## `dynamic = true` doesn't undo `intangible = true`

A body can be both dynamic and intangible — gravity affects it, but it doesn't collide with anything. Useful for "hidden weights" in plant rigs and similar. If you wanted normal collision, also set `intangible = false`.

## Layers / collision matrix gotcha

If two bodies don't interact, the layer matrix may be blocking them. Check `worldSettings.getLayersCollidable(a, b)`. Default is all-on; custom worlds may have a different matrix.

## The default `WorldSettingsAsset` is read-only

Fix:

1. `asset-graphql.createAsset({ assetType: "WorldSettingsAsset", name: "RootWorldSettings" })`.
2. Locate the Scene asset in `.virtual-scene.json` (look for `"type": "Scene"` under `assets`).
3. `asset-graphql.setProperty({ id: sceneAssetId, propertyPath: "physicsRootSettings", value: "<new-asset-uuid>", valueType: REFERENCE })`.

After that, `Physics.getRootWorldSettings()` returns the asset and gravity/simRate writes stick.

## "Ground Is Zero" is enabled by default

Common surprise scenarios:

- "Why does my body stop in mid-air?" — it landed on Ground-Is-Zero.
- "I built a custom floor at `y = -50` and the ball never reaches it." — Ground-Is-Zero intercepts at `y = 0` first.
- "I want everything to fall forever (zero-G demo)." — Disable it.

Toggle: Scene > Physics settings > Ground Is Zero. Custom `Physics.WorldComponent` worlds do **NOT** inherit Ground-Is-Zero — they're empty unless you build a floor.

## Character Controller supports exactly ONE `PhysicsWorldComponent`

Multi-world demos (slow-mo zones, inverted gravity) silently misbehave — collisions stop firing, the controller drifts. KB-documented constraint, not a bug.

If you need both a Character Controller and a parallel-world effect, fake the parallel-world inside the same world (per-collider Matter overrides, time-scale by script) rather than adding a second `WorldComponent`.

## Skinned-mesh colliders can't be dynamic

The skinned mesh is an **input** to the collider, not a thing the simulation drives — it has its own animation source (face tracker, body tracker, hand tracker, world mesh reconstructor). Setting `dynamic = true` either fails silently or detaches the collider from the deformation source (you get a static mesh frozen at the bind pose). Use `ColliderComponent` or `BodyComponent { dynamic: false }`.

## Mesh shape needs `shape.skin` for skinned meshes

Symptom: face mesh collider doesn't deform with expression changes. Full recipe (including the `Skin`-component requirement for bare `FaceMeshObjectPreset`): `api-surface.md` § *Skinned / deforming mesh colliders*.

## Compound bodies: only the PARENT carries `BodyComponent`

A `BodyComponent` on a compound child doubles up the simulation — the child becomes a separate body that the parent collides with (jitter / explosive separation). Common trigger: pasting a `*PhysicsObjectPreset` into a compound parent without stripping its `BodyComponent`. Fix: delete the child body and add a `ColliderComponent` instead. Full recipe: `patterns.md` Pattern 8.

## `forceCompound` flips raycast hit semantics per child

On a compound child:

- `forceCompound = false` (default) — raycasts return the **leaf** child collider you actually hit.
- `forceCompound = true` — raycasts return the **parent** compound collider, hiding the leaf.

Pick intentionally per child. Mostly:

- **Gameplay code** (impact event, damage attribution, grab handling) usually wants `true` — one "I hit the chair" event, not three "I hit the chair leg / cushion / arm" events.
- **Scene-editing UIs** (picking parts to recolor or detach) usually want `false` — you want the leaf.

You can mix-and-match: e.g., a hammer's handle is a leaf hit (for "grab here" UX) while the head treats hits as parent (for impact effects).

## Levelset shape is Hair/Cloth ONLY

See `api-surface.md` § *LevelSet — NOT supported in world physics* for the full rule and workarounds. Short version: rigid bodies do not collide with LevelSet shapes — use a Mesh shape or compound primitives instead.

## `Physics.WorldSettingsAsset.create()` doesn't auto-assign to root

`Physics.WorldSettingsAsset.create()` returns a fresh asset. You still need to assign it to either:

- The Scene asset's `physicsRootSettings` field (to make it the root world's settings), OR
- A `WorldComponent.worldSettings` field (to make it the per-world override).

A common bug pattern: create the asset, set gravity on it, then expect `Physics.getRootWorldSettings()` to return it. It won't until you assign the reference.

## `scene.physicsRootSettings` lives on the Scene ASSET, not a SceneObject

There is no SceneObject named "Physics Root" to find and configure. The `physicsRootSettings` field is on the **Scene asset** in the Asset Browser. In `.virtual-scene.json`, look under `assets` for `"type": "Scene"` (the file is typically `Scene.scene`); the asset's id is the one you target with `asset-graphql.setProperty`. If you're hunting in the SceneObject tree, you'll never find it.

## `getLayersCollidable` is on `WorldSettingsAsset`, not on the component

Calling `world.getLayersCollidable(a, b)` or `body.getLayersCollidable(a, b)` throws "method not found". Pass through `worldSettings` first:

```ts
const ws = world.worldSettings ?? Physics.getRootWorldSettings();
const collides = ws?.getLayersCollidable(a, b);   // ws null until you assign a custom WorldSettingsAsset
```

Same goes for `setLayersCollidable` and `resetLayerCollisionMatrix`.

## Behavior Helper `Physics Apply Force` fires ONCE per trigger

The Behavior helper's `Physics Apply Force` response is **single-shot** per trigger event. `Force` and `Acceleration` modes — which are designed to apply continuously over many frames — only get one frame's worth of effect through the helper, which is usually invisible.

For continuous force fields (wind, magnet, current, buoyancy), use a real script that applies the force every frame in `UpdateEvent` or in an `onOverlapStay` callback. The Behavior helper is fine for instantaneous modes (`Impulse`, `VelocityChange`, `SetVelocity`) — that's what it's actually built for.

## `@input collider: ColliderComponent;` accepts both `ColliderComponent` AND `BodyComponent`

In Lens Studio's type system, `BodyComponent` extends `ColliderComponent`. An `@input collider: ColliderComponent` slot in TypeScript silently accepts either. Your script may receive a plain collider where it expected a body, and `body.velocity` / `body.addForce` won't exist on the plain case:

```ts
@input collider: ColliderComponent;

onAwake() {
  // Don't assume body-only fields.
  const asBody = this.collider as any as BodyComponent;
  if (typeof asBody.velocity === 'object' && 'addForce' in asBody) {
    asBody.addForce(new vec3(0, 100, 0), Physics.ForceMode.VelocityChange);
  } else {
    print('Wired a ColliderComponent instead of a BodyComponent — drag is a no-op.');
  }
}
```

Feature-test (`'addForce' in collider`) before reaching for body-only APIs. This bites the Drag pattern in particular: a `ColliderComponent` (no body) gets picked up by the raycast, then the constraint attaches and silently does nothing.
