---
name: snapchat-character-controller
description: Tune or script character movement on a mobile Snapchat Lens with the Character Controller component (v1.7.0) — speed/sprint, jump, dash, axis-locks for side-scroller/top-down/first-person, auto-face, actions/animations. Standalone-usable for NPCs. Spoke of snapchat-controllable-character.
user-invocable: false
---
<!--
Copyright 2026 Snap Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Character Controller (CharacterController v1.7.0)

The movement brain of the Bitmoji Player Package — also shippable standalone (Asset Library → "Character Controller"). A **non-physics** movement model with optional physics interactions: responsive locomotion for third-person, first-person, side-scroller, and top-down formats without a rigidbody. Usable for the player **or** for NPCs/AI (drive it from script via `move()` / `moveToPosition()`).

Parent/setup context: `snapchat-controllable-character`. Input wiring (joystick → movement): `snapchat-screen-input`.

## Import

```ts
import {
  CharacterController,
  AutonomousProxy, ProxyCharacter, SimulatedProxy, ProxyCharacterSettings,
} from "CharacterController.lsc/CharacterController";
```

`CharacterController.lsc/CharacterController` is a barrel that re-exports the proxy classes. Types like `GroundInfo`, `RuntimeActionConfig`, `MoveAnimationHandle` come from `CharacterController.lsc/CharacterController.d`. To reference the component as an `@input`, use `@input("Component.ScriptComponent")` and type it `CharacterController`.

## Author-time `@input` surface

> Default values below are a **v1.7.0 snapshot** from the decompiled source — illustrative, not authoritative. They drift across versions, and the Bitmoji Player Package drop-in overrides several (see the drop-in note after the tables); read the live component / grep the prefab for current values. What's durable is the **knob names + what they do**.

Units are **centimeters**; time knobs are **milliseconds** at the Inspector/API (stored as seconds internally).

**Movement**

| Input | Type | Default | Meaning |
|---|---|---|---|
| `moveSpeed` | number | 100 | walk speed (cm/s) |
| `sprintSpeed` | number | 200 | sprint speed (cm/s) |
| `acceleration` | number | 100 | reach-full-speed rate (cm/s²) |
| `deceleration` | number | 100 | slow-down rate when input stops |
| `minMoveDistance` | number | 0.01 | anti-jitter threshold |
| `slopeLimit` | number | 45 | max walkable slope (deg) |
| `autoFaceMovementDirection` | boolean | true | rotate to face movement |
| `_enableAutoMove` | boolean | false | continuous forward (endless runner) |
| `_rotationSmoothing` | number | 0.5 | 0 = instant … 1 = smooth (shown when auto-face on) |

**Jump**: `jumpSpeed` (400), `multiJumpCount` `@input("int")` (1), `jumpBufferTime` ms (100), `jumpCoyoteTime` ms (100), `minTimeToGroundForFalling` ms (150, label "Fall Minimum Time").

**Dash** (shown when `enableDash`): `enableDash` (true), `dashSpeed` (1300), `dashDuration` s (0.16), `dashCooldown` s (0.6), `allowAirDash` (true).

**Axis locks**: `lockXAxis` / `lockYAxis` / `lockZAxis` (all false). These pick the genre — see §Genre modes.

**Input control**: `enableTouchBlocking` (true — blocks Snapchat gestures globally), `inputControlType` `@input("int")` ComboBox **None=0 / Joystick=1** (default 0), `trackingCamera` (Camera, shown when Joystick), `joystickConfig` (shown when Joystick). Set `inputControlType = None` to drive purely from script.

**Physics**: `gravity` vec3 (default `(0,-980,0)`), `alignRotationToGravity` (true), `airControl` 0–1 (1).

**Grounding**: `showCollider` (false, debug capsule), `groundIsZero` (false — virtual ground plane at Y=0, cheapest grounding), `groundCheckDistance` (1000), `stepHeight` (10).

**Collider**: `colliderHeight`, `colliderRadius`, `colliderCenter` (capsule; proxy defaults are 75 / 25 / `(0,65,0)`).

**Proxy push** (multiplayer): `enableProxyPush` (true), `proxyPushStrength` (2), `proxyPushMargin` (0).

**Animations / actions / events / logging**: `useAnimation` (true) + `basicMovementAnimationConfig`; `actionsConfig` (custom named actions); `eventConfigs[]` (collision/behavior triggers); `loggerConfig`.

> There is **no** named enum for `inputControlType` — it's a raw `@input("int")` with an inline ComboBox (None=0, Joystick=1). A separate real enum governs joystick placement inside `joystickConfig`.

**Drop-in tuning (Bitmoji Player Package).** The package configures this controller **faster than stock** (higher move / sprint / acceleration), keeps it **world-Y-up** (`alignRotationToGravity` off), lowers **air control**, and runs with **`inputControlType = None`** — movement is driven *externally* by the joystick/InputAction calling `move()`, not the controller's own input. Those are the durable *directions*; read the live component for the shipped numbers (they're a per-version snapshot).

## Runtime API by capability

Full signatures live in the package's `CharacterController.d.ts`; the high-value calls:

- **Move (call every frame or it stops):** `move(direction: vec3)` (Y ignored, normalized), `stopMovement()`, `moveToPosition(target: vec3, minDistance = 25)`, `cancelMoveToPosition()`, `setPosition(p)`, `getPosition()`, `getDirection()`, `getVelocity()` / `setVelocity(v)` / `addInstantVelocity(v)` (per-frame additive), `getMoveVelocity()`. Note `getPosition()` returns the **capsule-center** world position — Y ≈ root + `colliderCenter`, **well above the feet/ground** (re-verified live: `getPosition().y ≈ 62.5` while the feet sit at ≈ 0 in v4.0.2; the offset ≈ `colliderCenter`, config-dependent — read it live, don't hardcode). For jump/ground state use `isGrounded()`, not a `getPosition().y` threshold; for pickups/goals spanning heights use a horizontal (XZ) distance check.
- **Speed:** `setMoveSpeed`/`getMoveSpeed`, `setSprintSpeed`/`getSprintSpeed`, `setSprintEnabled(b)`/`isSprinting()`, `setTargetSpeedModifier(0..1)` (analog input), `setAcceleration`/`setDeceleration`. **Sprint works with the joystick's external-move path:** `setSprintEnabled(true)` sets the target speed to `sprintSpeed` and **ignores `targetSpeedModifier`** (full sprint speed regardless of stick magnitude); `false` returns to `moveSpeed * targetSpeedModifier` (both smoothly accel/decel). So for a sprint burst just set `sprintSpeed` > `moveSpeed` and toggle `setSprintEnabled` — no `setMoveSpeed` hack. Note the **drop-in ships no sprint UI**: its buttons are Emote / **Dash** / Jump, and Dash is an *instant* burst, not a hold-to-sprint — add your own button that toggles `setSprintEnabled`.
- **Facing (yaw only):** `setRotation(q)` (pitch/roll dropped), `getRotation()`, `setAutoFaceMovement(b)`/`getAutoFaceMovement()`, `rotationSmoothing` (0..1).
- **Jump:** `jump()`, `setJumpSpeed`, `setMultiJumpCount`, `getAvailableJumps()`, `setJumpBufferTime`, `setJumpCoyoteTime`; event `onJumpStarted`.
- **Dash:** `dash()`, `isDashing()`, `getDashTimeLeft()`, `getDashCollisionFilter()` (`dashThroughColliders[]`); events `onDashStarted`, `onDashedThroughCollider`.
- **Grounding:** `isGrounded()`, `getGroundInfo(): GroundInfo | null`, `isMoving()`. Grounding shapecasts against real `ColliderComponent`s on your floor/platforms. The **`groundIsZero`** `@input` (default **false**) adds a virtual floor at Y=0 when true — the character then can't fall; **keep it false** for platformers/anything with gaps or fall-respawn.
- **Gravity/up:** `setGravity(v)`/`getGravity()`, `setAlignRotationToGravity(b)`.
- **Axis locks:** `setLockXAxis/Y/Z(b)` + getters.
- **Auto-move:** `enableAutoMovement()` / `disableAutoMovement()`. Caveat: the auto-move **ground speed is *not* `moveSpeed`** — measured well above it, and it differs airborne (~`moveSpeed·airControl`), so a jump advances the character very little forward (it lands ≈ where it took off — which breaks the "jump over an obstacle" feel unless you jump at the obstacle's near edge). Measure the live rate from `getPosition()` deltas and tune; don't assume `moveSpeed` cm/s.
- **Actions & animations:** `startAction(name)`, `registerAction(RuntimeActionConfig)`, `unregisterActions(...names)`, `hasAction`, `getActiveActions()`, `isActionActive`, `addMoveAnimation(RuntimeMoveAnimationConfig): MoveAnimationHandle`, `getMoveAnimations()`; events `onActionStarted/Registered/Unregistered`. **Drop-in built-in action:** the Bitmoji Player Package registers an **`emote`** action (verified: `actionName: emote` in the drop-in's `UI Controls.prefab`) — the on-screen Emote button calls `startAction("emote")`, and your own scripts can trigger the same celebration the same way. Action names are case-sensitive; the drop-in's live action set is grep-able in the installed prefab, not via scene-read tools.
- **Collision/overlap events (built-in gameplay detection):** `onCollisionEnter/Stay/Exit` (blocking contact — solid colliders) and `onOverlapEnter/Stay/Exit` (trigger / pass-through — pickups, zones). The other object is `e.collision.collider.getSceneObject()` / `e.overlap.collider.getSceneObject()`. These are the first-class way to make gameplay react to the player — copy-paste recipes (collision reactor, overlap pickup + score, distance/goal trigger) in `../../references/snapchat-gameplay-recipes.md`.
- **Controls visibility:** `showControls()` / `hideControls()`.
- **Collider access:** `getCollider(): ColliderComponent`, `setShowCollider(b)`.

## Genre modes (via axis locks + auto-move)

- **Third-person / top-down (default):** no locks; full XZ movement; `autoFaceMovementDirection = true`. Top-down pairs with a high Follow camera (`snapchat-follow-camera`).
- **Side-scroller / 2.5D:** `setLockZAxis(true)` — movement stays in the XY plane; keep jump on; pair with a side-locked Follow camera.
- **First-person:** drive facing from the camera; usually `autoFaceMovementDirection = false` and rotate via `setRotation`.
- **Endless runner:** `enableAutoMovement()` (continuous forward along facing) + steer with the joystick.
- **Scripted / on-rails:** `inputControlType = None` + `moveToPosition(target)` (great for NPCs and cutscenes).

## Multiplayer proxies (bring-your-own-sync)

The controller ships network-agnostic proxy primitives — you bridge them to any sync transport via a `SyncInterface`. ConnectedFramework is **not** required (see `snapchat-controllable-character` §6).

```ts
interface SyncInterface {
  getStore(): GeneralDataStore;   // shared networked store snapshots are written to / read from
  getServerTimestamp(): number;   // authoritative clock for ordering + interpolation
}
```

- **Owner side:** `new AutonomousProxy(syncInterface, character: CharacterController, updateInterval = 0.025)` — samples the local controller each late-update and publishes snapshots to the store. `destroy()` to stop.
- **Remote side:** build a `ProxyCharacter`, then `new SimulatedProxy(syncInterface, proxyCharacter, context)` — reads snapshots each frame and drives the proxy (position/rotation/velocity, replays jump/dash/actions).
- **Remote avatar wrapper:** `new ProxyCharacter(settings, context)` where `settings = ProxyCharacterSettings.fromCharacterController(sourceController, rootSceneObject)` copies gravity/jump/dash/collider/animation/actions config off the local controller. `context` is a `CoreExtensions.lspkg/Context/Context`.

This is exactly what `PlayerCharacterInit` does when a `SyncEntity` is injected (owner → `AutonomousProxy`; remote → `ProxyCharacter` + `SimulatedProxy`).

## Gotchas

- **Subsystems build in `onAwake`, not the constructor.** `movementController`, colliders, input control, animation/actions are created in `onAwake` — calling most public methods before then hits `undefined`. Inspector-configured actions register during `onAwake`, so `onActionRegistered` only observes later *runtime* `registerAction()` calls.
- **Destroyed guard throws.** Public methods start with an assert that throws `"Object is null - component was destroyed"` once the component is gone. Null-check lifetimes across awaits.
- **`enableTouchBlocking` is global.** When true, `onAwake` sets `global.touchSystem.touchBlocking = true` for the whole Lens (claims taps from Snapchat gestures). Turn off if other native gestures are needed.
- **Physics layers singleton.** Importing the package creates `global.characterController` (a `CharacterControllerSpace`) once, handing out distinct local vs proxy physics layers (`getLocalCharacterPhysicsLayer()`, `getProxyCharacterPhysicsLayer()`, `getAllCharacterLayers()`).
- **Units & gravity:** centimeters; default gravity `(0,-980,0)` cm·s⁻² (≈ 9.8 m·s⁻²). Defaults (jumpSpeed 400, moveSpeed 100, collider 75/25) are all cm.
- **Yaw-only rotation.** `setRotation` keeps upright (Y-axis only); `move()` ignores the up component.
- **Coordinate frame:** repo canon is right-handed, **+Z forward** in the script-author frame (`transform.forward` → `(0,0,1)`). The package's internal projection/auto-move math uses `vec3.forward()` and a velocity negation in the input path — those are internal; you don't hand-write them. If *you* need facing math (e.g. aim a projectile from movement), use the repo's canonical `faceDirection` yaw helper rather than reinventing sign conventions. Verify observed facing in a live Preview.
