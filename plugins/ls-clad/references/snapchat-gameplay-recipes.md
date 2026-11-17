<!--
Copyright 2026 Snap Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Gameplay recipes for the controllable character

The `snapchat-controllable-character` family gives you a **drivable character**, not a
game. This file is the bridge: how to turn "the character moves" into "reaching the flag
wins" / "touching a coin scores" / "hitting a wall hurts." Copy a template, wire the
`@input`s, adapt the handler.

**Lean on the character's own detection first.** The `CharacterController` already carries
collision, overlap, and ability events — you rarely need to bolt on a separate physics
body just to detect the player. Reach for the `physics` skill only when you need blocking
world colliders, forces, joints, or raycasts beyond what's below.

> Verified against **CharacterController v1.7.0 / Bitmoji Player Package v4.0.2** — install the latest available and treat these (and any version-specific value below) as a snapshot to re-check live. The
> event/method *names* are the durable part; read the live component if a signature looks
> off (see `snapchat-character-controller`).

## Detection surface (already on the `CharacterController`)

Subscribe with `.add(cb)` / unsubscribe with `.remove(cb)`. **Subscribe *late*, not in `onAwake`.** These are getters that dereference the controller's collider, which the drop-in creates during its **async `OnStart`** — so `character.onOverlapEnter.add(...)` (or any `onCollision*`/`onOverlap*`) in `onAwake` throws *`Cannot read property 'characterCollider' of undefined`*. Gate the subscription on `character.enabled === true` (the pattern is in Templates 1–2; same async gate as `snapchat-controllable-character` §8).

| Event | Fires when | Payload → the other object |
|---|---|---|
| `onCollisionEnter` / `Stay` / `Exit` | the character makes **blocking** contact with a solid collider | `e.collision.collider.getSceneObject()`; contacts via `e.collision.contacts[i].{position, normal, impulse}` |
| `onOverlapEnter` / `Stay` / `Exit` | the character enters/leaves a **trigger** (pass-through) collider | `e.overlap.collider.getSceneObject()`; all current: `e.currentOverlaps[]` |
| `onJumpStarted` / `onDashStarted` | the character jumps / dashes | `void` |
| `onActionStarted` / `onActionStopped` | a named action (e.g. an emote) starts/stops | the action name (`string`) |
| `onDashedThroughCollider` | a dash punched through a collider in its dash-filter | `DashedThroughColliderEvent` |
| `isGrounded()` | *(polled, not an event)* — grounded right now? | `boolean` |

**Collision vs. overlap** is the collider-vs-trigger split: a **collision** blocks the
character (walls, floors, solid props); an **overlap** lets the character pass through and
just reports it (coins, checkpoints, zones). For a pickup or a zone, make the other
object's collider a **trigger** so the character walks through it — see `physics` for
`ColliderComponent` trigger setup. For a pure radial "am I near X" check with **no colliders
at all**, use the distance template below (cheapest, and what scenario #1 shipped).

Identify *which* object you touched by comparing the returned `SceneObject` to an `@input`
reference, checking `.name`, or looking for a marker component on it.

---

## Template 1 — React to collision with the player character

Blocking contact (hazard, bumper, breakable). Put this on the character, or on any script
that holds a reference to the `CharacterController`.

```ts
import { CharacterController } from "CharacterController.lsc/CharacterController";

@component
export class PlayerCollisionReactor extends BaseScriptComponent {
    @input("Component.ScriptComponent")
    character!: CharacterController; // the Bitmoji Player Package's CharacterController

    private subscribed = false;

    onAwake(): void {
        // Subscribe LATE, not in onAwake: the onCollision*/onOverlap* getters dereference the
        // controller's collider, which the drop-in only creates during its async OnStart (see
        // snapchat-controllable-character §8). Subscribing in onAwake throws
        // "Cannot read property 'characterCollider' of undefined". Gate on enabled === true.
        this.createEvent("UpdateEvent").bind(() => {
            if (this.subscribed || this.character?.enabled !== true) return;
            this.subscribed = true;
            this.character.onCollisionEnter.add((e) => {
                const other = e.collision.collider.getSceneObject();
                // Identify what we hit (by name, a marker component, or an @input ref):
                if (other.name.startsWith("Hazard")) {
                    print("[game] player hit a hazard: " + other.name);
                    // …lose a life / knockback / game-over. Contact point for FX:
                    const p = e.collision.contacts[0]?.position;
                    // spawnSparks(p); etc.
                }
            });
        });
    }
}
```

## Template 2 — Overlap pickup + score

Coins/gems: make each pickup's collider a **trigger** (via `physics`), then let the
character's overlap event drive scoring. Keep the score in one place.

```ts
import { CharacterController } from "CharacterController.lsc/CharacterController";

@component
export class PickupScorer extends BaseScriptComponent {
    @input("Component.ScriptComponent")
    character!: CharacterController;

    @input @allowUndefined
    scoreText!: Text;         // optional on-screen count (place per snapchat-ui-and-spatial)

    @input
    pointsPerPickup: number = 1;

    private score: number = 0;
    private subscribed = false;

    onAwake(): void {
        // Subscribe LATE (see Template 1 + snapchat-controllable-character §8): onOverlapEnter
        // isn't valid until the controller's async OnStart creates its collider — subscribing in
        // onAwake throws "Cannot read property 'characterCollider' of undefined".
        this.createEvent("UpdateEvent").bind(() => {
            if (this.subscribed || this.character?.enabled !== true) return;
            this.subscribed = true;
            this.character.onOverlapEnter.add((e) => {
                const other = e.overlap.collider.getSceneObject();
                if (other.name.startsWith("Coin")) {
                    this.score += this.pointsPerPickup;
                    if (this.scoreText) this.scoreText.text = "Score: " + this.score;
                    other.enabled = false; // or other.destroy() — remove the collected coin
                }
            });
        });
    }

    getScore(): number { return this.score; }
}
```

> **Score / win-banner text: use `Text`, not `Text3D`.** `Text3D` is heavyweight extruded 3D geometry; a HUD counter or a "YOU WIN!" banner wants a cheap **`Text`** — **screen-space** `Text` under the ortho UI camera for true UI (see the `camera-and-rendering` skill's ScreenText preset + `snapchat-ui-and-spatial.md`), or a **world-space** `Text` object billboarded to the camera (a `LookAt` component aimed at the camera, or a one-line rotate-to-camera script) if it must sit in the scene. Reserve `Text3D` for when you genuinely need extruded 3D lettering.

## Template 3 — Distance / goal trigger (no colliders)

Radial "reach the goal / enter the zone" with zero physics — just horizontal (XZ) distance
from `getPosition()`. This is what scenario #1 shipped; generalize the radius and payload.

```ts
@component
export class GoalTrigger extends BaseScriptComponent {
    @input("Component.ScriptComponent")
    character!: any;            // CharacterController (typed import optional)

    @input
    triggerRadius: number = 90; // cm; a Bitmoji is ~170 cm tall — size relative to that

    private fired: boolean = false;

    onAwake(): void {
        this.createEvent("UpdateEvent").bind(() => this.onUpdate());
    }

    private onUpdate(): void {
        if (this.fired) return;
        const pos = this.character?.getPosition?.();
        if (!pos) return; // controller not awake yet
        const goal = this.getSceneObject().getTransform().getWorldPosition();
        const dx = pos.x - goal.x, dz = pos.z - goal.z;
        if (dx * dx + dz * dz <= this.triggerRadius * this.triggerRadius) {
            this.fired = true;
            print("[game] goal reached");
            // …win flourish: this.character.startAction("emote"); advance level; etc.
        }
    }
}
```

## Template 4 — Fall detection & respawn (platformer)

When the level has gaps, poll the character's height and teleport it back when it falls off.

```ts
@component
export class FallRespawn extends BaseScriptComponent {
    @input("Component.ScriptComponent")
    character!: any;                    // CharacterController

    @input killPlaneY: number = -200;   // fall below this (cm) → respawn
    private spawn = new vec3(0, 20, 0);

    onAwake(): void {
        this.createEvent("UpdateEvent").bind(() => {
            const p = this.character?.getPosition?.();
            if (!p || p.y >= this.killPlaneY) return;
            this.character.setPosition(this.spawn);
            this.character.setVelocity(vec3.zero()); // kill fall momentum
            // optional feedback: this.character.startAction("emote"); or a "Respawn!" HUD
        });
    }
}
```

## Building the level (colliders & materials)

A platformer character needs **real geometry to stand on** — grounding shapecasts against colliders, there's no magic floor:

- **Don't hand-build every mesh.** The Asset Library has drop-in **`Platformer Ground Kit`** (themed ground: snow/grass/sand) and **`Platformer Obstacles Kit`** (platforms, spikes, spinning blades, pendulums, bounce/spring pads, coins/gems/orbs, flags, a finish gate…) — install via `InstallLensStudioPackage`, same as the player package. They're **art/mesh packs — no colliders**, so add a `ColliderComponent` to the pieces the character stands on / hits (next bullets). *(labeled v5.0.0; install the latest — verified to install + auto-instantiate cleanly on LS 5.24.)* For a platformer, prefer these over hand-built primitives — a fresh agent tends to hand-roll boxes and never find the kits.
- **Presets arrive at surprising scales — calibrate.** A `*MeshObjectPreset` (a SceneObject preset) and the raw `*MeshPreset` mesh asset used via a `RenderMeshVisual` can carry very different baked scales (a box came out ~10× off in one build). Always `GetBoundingBox` a created piece and rescale to real centimeters — a Bitmoji is ~170 cm, so platforms are on the order of 100s of cm, not single digits.
- **Every platform/floor needs a collider** (a Box collider, `filter = null`). The component is `Physics.ColliderComponent` at **runtime**, but when you add it via the **editor/MCP** (`VirtualScene` / `scene-graphql` / `ExecuteEditorCode addComponent`) the type string is the **bare `ColliderComponent`** — `Physics.ColliderComponent` fails at edit-time with *"Unknown entity type"*. See the `physics` skill for collider setup.
- **`groundIsZero`** is a CharacterController `@input`, default **false**. When **true** it adds a virtual floor at Y=0 so the character can *never* fall — which **breaks gaps and fall-respawn**. Keep it **false** for a platformer.
- **Flat-colored platforms:** create them with an **`UnlitMaterialPreset`** (its `passInfos.0.baseColor` is settable); a `PBRMaterialPreset` has no simple `baseColor` (texture-graph-driven) and setting it errors. See the `materials` skill.
- **Trigger colliders do NOT auto-fit — set the shape.** A `VirtualScene` `ColliderComponent` with `intangible: true` is a trigger, but its shape defaults to a **small Sphere (radius ~6)** that does *not* fit the visual — so `onOverlapEnter` **silently never fires** on a larger prop. Set **`fitVisual: true`** (Box/Sphere only; Sphere uses a bounding-*sphere* radius, over-fitting non-spherical meshes), and note that changing the shape *type* (e.g. to Box) needs `ExecuteEditorCode` (`Editor.Shape.createBoxShape`) — `scene-graphql`/`VirtualScene` can't switch shape type. **Collider bounds resolve at runtime** — `GetBoundingBox colliderOnly` returns *"no valid bounds"* at edit-time, so verify the trigger with `debugDrawEnabled` + a preview capture (or an overlap log), not an edit-time bounds query. See the `physics` skill.
- **Pickup height matters (overlap gotcha).** `onOverlapEnter` only fires when the pickup's collider actually **intersects the character capsule** — which spans roughly y≈30–100 cm (center ~65) in v4.0.2, *not* the floor. A collectible resting at y≈0 has its collider *below* the capsule and never triggers. Place pickups at about the character's mid-height, and confirm live (capsule extents are version-specific — read them via `getCollider()` / `GetBoundingBox`). Relatedly, **`getPosition()` returns the capsule *center*** — ≈ root + `colliderCenter`, **well above the feet** (re-verified live: `getPosition().y ≈ 62.5` while the feet sit at ≈ 0 in v4.0.2; config-dependent, so read it live rather than hardcoding). So a **distance-based** pickup/goal that spans heights should key off a **horizontal (XZ) distance** (Template 3), never a 3D distance that assumes the character's y matches the pickup's.
- **Orient the course along the joystick-forward axis, and drive to verify.** The shipped input projects joystick-up to **camera-forward**, and the shipped Orbit camera hugs the character — so a **static-spawn capture won't show the course ahead**. Lay the course out along the forward world axis, and verify a level by driving forward (or orbiting the camera), not from the spawn frame.

## Showing the result — score & win/lose HUD

Goal *detection* is above; this is the *feedback*. **Use a `Text` component, not `Text3D`** (see the note under Template 2). The cheapest and most legible option on the two-camera mobile setup is **screen-space `Text`** under the orthographic **UI Controls** camera the package already created:

- Create it via the **ScreenText preset** (`createSceneObjectFromPreset`) parented under the ortho UI camera — see the `camera-and-rendering` skill (screen-space objects need that camera + a Canvas). Size/anchor via its `ScreenTransform` (thumb-safe zones: `snapchat-ui-and-spatial.md`).
- Update from your game script: `this.scoreText.text = "Score: " + n;` and show/hide a win banner with `bannerObject.enabled = true/false`.
- Wire as `@input @allowUndefined scoreText: Text` (as in Template 2) + `@input winBanner: SceneObject`.

If a label must live **in the 3D world** (e.g. floating over a pickup), use a **world-space `Text` object** billboarded to the **perspective/game camera** (a `LookAt` aimed at *that* camera — not the ortho UI camera — or a one-line `setWorldRotation` script) — still `Text`, not `Text3D`. Avoid `Text3D` for a HUD: its `size` is **not centimeters** (a "size 96" renders as a speck at world scale) and its color is **material-driven** (the `materials` skill warns against swapping text materials), so it's fiddly to make legible.

A screen-space `Text` **renders with no font asset assigned** (a default font is used) — you don't need to import a font just to show a score or timer.

**Countdown timer** (collectors / time-attack): accumulate `getDeltaTime()` in an `UpdateEvent`, display `Math.ceil`, and reveal a game-over panel at zero.

```ts
@component
export class CountdownTimer extends BaseScriptComponent {
    @input timerText!: Text;                    // screen-space Text (HUD)
    @input @allowUndefined gameOverPanel!: SceneObject;
    @input duration: number = 30;               // seconds

    private timeLeft = 0;

    onAwake(): void {
        this.timeLeft = this.duration;
        this.createEvent("UpdateEvent").bind(() => {
            if (this.timeLeft <= 0) return;                     // already expired
            this.timeLeft = Math.max(0, this.timeLeft - getDeltaTime());
            this.timerText.text = "Time: " + Math.ceil(this.timeLeft);
            if (this.timeLeft <= 0) {
                // end play — freeze the player: characterController.setMoveSpeed(0).
                // hideControls()/stopMovement() alone do NOT stop joystick-driven motion
                // (the joystick drives the controller every frame); also hide the joystick.
                if (this.gameOverPanel) this.gameOverPanel.enabled = true;
            }
        });
    }
}
```

## Choosing a detection method

| Want | Use |
|---|---|
| Solid walls/floors/props that **block** the player | `onCollisionEnter` (+ a solid `ColliderComponent` on the prop) |
| Pickups / checkpoints / zones the player **passes through** | `onOverlapEnter` (+ a **trigger** collider on the object) |
| "Am I within R of X" with **no colliders** | distance off `getPosition()` (Template 3) |
| React to an ability | `onJumpStarted` / `onDashStarted` / `onActionStarted` |
| Fall detection / coyote-time / landing | `isGrounded()` polled each frame |

## Driving movement from script (tap-to-move · NPCs)

The drop-in ships `inputControlType = None` — movement is driven externally. Two common non-joystick patterns:

### Tap-to-move (point-and-click)

Tap the ground → walk there. You must intersect the **tap ray with the ground plane** — do **not** use a single fixed depth (`screenSpaceToWorldSpace(tap, cameraHeight)`); that only lands on the ground for a *straight-down* camera, and the package's default camera is angled.

```ts
@component
export class TapToMove extends BaseScriptComponent {
    @input("Component.ScriptComponent") character!: any; // CharacterController (inputControlType = None)
    @input cam!: Camera;                                 // the perspective world camera
    @input groundY: number = 0;                          // world Y of the ground plane

    onAwake(): void {
        this.createEvent("TapEvent").bind((e) => {
            if (!this.character?.enabled) return;                 // wait for the async OnStart
            const tap = e.getTapPosition();                       // normalized screen 0..1
            const origin = this.cam.getTransform().getWorldPosition();
            const dir = this.cam.screenSpaceToWorldSpace(tap, 500).sub(origin).normalize();
            if (Math.abs(dir.y) < 1e-4) return;                   // ray parallel to ground
            const t = (this.groundY - origin.y) / dir.y;          // ray ∩ plane y=groundY
            if (t <= 0) return;                                   // tap points away from ground
            this.character.moveToPosition(origin.add(dir.uniformScale(t)));
        });
    }
}
```

### Standalone NPC (a second character controller)

The CharacterController is usable on its own — add a **second SceneObject with its own `CharacterController`** (no `PlayerCharacterInit`, no joystick) and script it with `moveToPosition`.

- **Animate it:** parent a `Bitmoji 3D` (or any rigged mesh) **under the CharacterController's SceneObject** — the controller **auto-discovers the avatar/animation from its child hierarchy** (that's how the drop-in animates; there's no explicit bind). Without a child avatar the NPC moves but doesn't animate.
- **Stability caveat:** script-driven patrols with **long, fast legs and hard (~180°) reversals** can overshoot and oscillate (non-physical position jumps observed near collider/ground edges). Keep waypoints **modest and interior** (away from edges), speeds moderate, and avoid sharp reversals; tune from a live capture.

```ts
@component
export class NpcPatrol extends BaseScriptComponent {
    @input("Component.ScriptComponent") npc!: any;  // a SECOND, standalone CharacterController
    @input waypoints!: vec3[];                       // keep modest + interior

    private i = 0;
    private started = false;

    onAwake(): void {
        // Don't call npc.moveToPosition() from onAwake: CharacterController builds its movement
        // subsystems in its own onAwake, and component init order isn't guaranteed, so this can
        // fire before npc is ready. Gate the first move on the same `npc.enabled` check the loop
        // below already uses.
        this.createEvent("UpdateEvent").bind(() => {
            if (!this.npc?.enabled || !this.waypoints?.length) return;
            if (!this.started) {
                this.npc.moveToPosition(this.waypoints[0]);
                this.started = true;
                return;
            }
            const p = this.npc.getPosition(), tgt = this.waypoints[this.i];
            const dx = p.x - tgt.x, dz = p.z - tgt.z;
            if (dx * dx + dz * dz < 30 * 30) {                    // reached → next
                this.i = (this.i + 1) % this.waypoints.length;
                this.npc.moveToPosition(this.waypoints[this.i]);
            }
        });
    }
}
```

### Endless runner (auto-runner)

Continuous forward + tap-to-jump. Reuse the jump idea from Tap-to-move (`TapEvent → character.jump()`), turn on `enableAutoMovement()`, and mind these genre gotchas (each cost real iteration):

- **The shipped ground is finite** (`Ground Prefab` ≈ 1280×1280 cm) — the runner runs off it in seconds. Add a **treadmill**: each frame set the ground's world Z to the character's Z, or set `groundIsZero = true` so grounding never depends on the finite mesh.
- **Auto-move speed ≠ `moveSpeed`** (see `snapchat-character-controller`) — measure the live rate; ramp difficulty with `setMoveSpeed(base + rate * t)` capped at a max.
- **Startup grace.** The frame the avatar finishes downloading has a huge `getDeltaTime()`; with auto-move already on, the character teleports hundreds of cm into the first obstacle. Enable auto-move only after `characterController.enabled` **and** a couple of normal-`dt` frames.
- **Swept collision.** Preview frame-drops produce 150–250 cm single-frame steps that can skip *past* an obstacle's footprint between frames. Detect a crash by testing whether the traversed **z-interval `[lastZ, z]`** crossed an obstacle while `isGrounded()` (airborne = cleared) — not an instantaneous overlap.
- **Obstacles:** an author-time pool recycled ahead of the runner (reposition each one from behind → ahead as the character passes).

## What's still yours (plain scripts)

Score persistence, win/lose flow, level advance, spawning, timers, difficulty ramps — these
are ordinary Lens scripts, not character features. Keep game state in one manager object and
have the templates above call into it. For scripting patterns see `lens-api`; for building
the objects/props see `scene-construction`; to orchestrate a whole experience end-to-end use
the `snapchat-experience-builder` agent.
