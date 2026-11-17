---
name: snapchat-follow-camera
description: Set up or tune the 3D camera that follows the character on a mobile Snapchat Lens with the Camera Controller component (v2.2.0) — Follow, Third-Person, Orbit, and Gyroscope modes plus obstacle avoidance. Standalone-usable. Spoke of snapchat-controllable-character.
user-invocable: false
---
<!--
Copyright 2026 Snap Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Follow Camera (CameraController v2.2.0)

A modular follow/third-person/orbit/gyroscope camera for mobile Lenses — the camera half of the Bitmoji Player Package, also usable standalone. It moves the **controlled Camera SceneObject's** Transform each `LateUpdateEvent` to track a **follow target**.

Parent/setup context: `snapchat-controllable-character`. Movement side: `snapchat-character-controller`.

## Import

```ts
import { CameraController, CameraMode } from "CameraController.lsc/CameraController";
// Strategy interfaces + GyroscopeAxes + ObstacleAvoidance are declared in the .d:
import {
  FollowCameraModeStrategy, ThirdPersonCameraModeStrategy,
  OrbitCameraModeStrategy, GyroscopeCameraModeStrategy,
  GyroscopeAxes, ObstacleAvoidance,
} from "CameraController.lsc/CameraController.d";
```

`CameraMode` is a runtime enum: `Orbit = "Orbit"`, `ThirdPerson = "Third Person"`, `Follow = "Follow"`, `Gyroscope = "Gyroscope"` (note the ComboBox string for third-person is `"Third Person"` with a space).

## Wiring (two references)

- **`camera`** (getter/setter over the `_camera` @input) — the **SceneObject that has the Camera** this controller drives. In the Bitmoji Player Package, `PlayerCharacterInit` sets `cameraController.camera = mainCamera.getSceneObject()` (the **perspective 3D** camera, not the ortho UI camera).
- **`followTarget`** (over `_followTarget`) — the SceneObject to track/orbit. `PlayerCharacterInit` doesn't set this in code, but **the drop-in prefab already wires it to the character**. Standalone, wire it in the Inspector. Setting it at runtime pushes the new Transform into the live strategy.
- `_snapToTargetOnAwake` (drop-in: true) → `moveToTarget()` runs on start to snap without smoothing.

## `@input` surface

`_camera` (SceneObject, `@allowUndefined`), `_followTarget` (SceneObject, `@allowUndefined`), `_snapToTargetOnAwake` (true), `_cameraMode` (`@input("string")` ComboBox — **component default `Follow`, but the drop-in prefab ships `Orbit`**; see next section), one `@showIf`-gated config block per mode (`_orbitModeConfigInput` / `_thirdPersonModeConfigInput` / `_followModeConfigInput` / `_gyroscopeModeConfigInput`), `_avoidObstacles` (true) + `_obstacleAvoidanceConfigInput`, `_printWarningLogs` (true), `_printInfoLogs` (false).

## What the Bitmoji Player Package drop-in configures

The drop-in ships the CameraController **configured differently from the component's own defaults** (below). The durable facts (read the live component / grep `UI Controls.prefab` for the current numbers — they're a per-version snapshot):

- **Mode = `Orbit`** (not the component default `Follow`, and **not** Third-Person). The camera swipe-orbits around the character; the swipe is captured by a screen-space `interactiveArea` (an `InteractionComponent` on the `3D Camera Controller` object under `UI Controls`).
- `followTarget` is **wired to the character**, snap-to-target on awake, and **obstacle avoidance is on**.
- All four modes are **pre-tuned** in the prefab, and Follow/Third-Person use explicit offsets (`useSceneDerivedOffset` off) rather than the scene-derived capture.

**To change the feel:** flip `_cameraMode` in the Inspector, or call `enableThirdPersonCameraMode()` / `enableFollowCameraMode()` / `enableGyroscopeCameraMode()` at runtime — Third-Person = behind-the-back adventure cam, Follow = fixed non-rotating offset, Orbit = the shipped swipe-to-rotate. For the exact radius / speed / clamps / offsets, read the live component (values drift across versions — see the hub's version caveat).

**Which mode for which genre:**
- **Orbit** (shipped default) — player swipe-rotates around the character. Best for **3D platformers / action**, where the player wants to pick the angle to line up jumps and judge depth. Often the right call is *don't switch* — keep Orbit.
- **Follow** — position-only; the view **angle never changes**. Best for a **fixed perspective**: side-scroller (side-locked), top-down. Use when you specifically *don't* want the view to rotate.
- **Third-Person** — auto-rotates to stay behind the character, but the **default rotation is fast/finnicky**, so reserve it for **slow exploration** where precise camera control isn't important (and expect to tune it). Avoid for action/platforming.
- **Gyroscope** — device-orientation drives the view.

## Modes & tunable defaults (component defaults)

Switch at runtime with `enableFollowCameraMode()` / `enableThirdPersonCameraMode()` / `enableOrbitCameraMode()` / `enableGyroscopeCameraMode()` — each sets the mode, rebuilds the strategy, and **returns the strategy object** to tune. `getCameraModeStrategy()` returns the current one. (Changing mode destroys/rebuilds the strategy, discarding runtime tweaks.)

> The per-mode numbers below are **v2.2.0 component defaults** (from the decompiled source) — illustrative snapshots, not authoritative. The drop-in overrides several (see the previous section) and any version can change them; read the live component for current values. What's durable here is the **shape** of each mode (which fields exist, position-only vs position+direction).

**Follow** — moves camera **position only** (keeps the camera's own rotation):
- `smoothingFactor` 0.05 (0–1, higher = smoother), `positionOffset` `(0,100,300)`, `lockX/lockY/lockZ` false.
- `useSceneDerivedOffset` (default true) is an **Inspector / ConfigInput** field (creation-time) — **not** a property of the runtime strategy. When true, the offset is captured once at build as `cameraWorldPos − targetWorldPos` and the config `positionOffset` is ignored. The strategy object returned by `enableFollowCameraMode()` exposes only `smoothingFactor`, `positionOffset`, `lockX/Y/Z` — there is **no `useSceneDerivedOffset` to toggle at runtime**; just set `strategy.positionOffset` directly and it's honored as-is.

**Third Person** — moves **position + rotation** (frames the target, looking back):
- `smoothingFactor` 0.85, `positionOffset` `(0,150,-300)`, `rotationOffset` `(-10,180,0)` euler° (the `180` yaw = "face back toward the character"). Scene-derived by default (offsets computed target-relative). Pivot Y is pinned to the target each frame (Y = up).
- **Runtime type caveat (bit us in testing):** on the strategy returned by `enableThirdPersonCameraMode()`, `positionOffset` is a `vec3` but **`rotationOffset` is a `quat`** — the `(-10,180,0)` euler° above is only the **ConfigInput** (converted at build via `quat.fromEulerVec(euler · DegToRad)`). Assigning a raw euler `vec3` to `strategy.rotationOffset` fails `validateQuat` and resets toward identity → the camera points *away* from the character (empty-sky preview). Set it as `strategy.rotationOffset = quat.fromEulerVec(new vec3(x,y,z).uniformScale(MathUtils.DegToRad))`, or **just don't override it** — the config default already faces back.

**Orbit** — free rotation around the target (touch/auto), position + direction:
- `smoothingFactor` 0.05, `radius` 300, `orbitSpeed` 150 (sign = auto direction: >0 anticlockwise), `autoOrbit` false, `verticalClamp` `(-10,80,40)` = (min,max,default), `horizontalClamp` `(-180,180,0)`, `interactiveArea` (an `InteractionComponent` restricting the swipe region; null = anywhere).

**Gyroscope** — device orientation rotates the camera around a pivot, position + direction:
- `smoothingFactor` 0.05 (applies to camera move, **not** device rotation), `pivotPosition` `(0,120,0)`, `pivotRotation` `(0,180,0)` euler°, `positionOffset` `(0,0,200)` (pivot-local), `activeAxes` `GyroscopeAxes.All`.
- `GyroscopeAxes`: `All=0, Roll, Pitch, Yaw, RollPitch, RollYaw, PitchYaw`. Calibration methods on the strategy: `calibrateToCurrentDevice()`, `calibrateYaw()`, `calibratePitch()`, `calibrateRoll()`.

## Obstacle avoidance

Raycast-based; pulls the camera in when something is between it and the target. `getObstacleAvoidance(): ObstacleAvoidance`, `enableObstacleAvoidance()` / `disableObstacleAvoidance()`, `isObstacleAvoidanceEnabled()`. Tunables (via `ObstacleAvoidance` methods): `setCheckRadius` (32), `setOriginOffset` (`(0,110,0)`), `setReturnSmoothingFactor` (0.80), `setMinDistanceFactor` (0.088, 0–1), `setCharacterToIgnore(scriptComponent)` / `setCollidersToIgnore([...])` (ignore the player's own colliders), `enableDebug()`.

## Gotchas

- **Strategies build in `onAwake`, not the constructor.** `enable*`, `moveToTarget`, `getCameraModeStrategy`, and obstacle methods are guarded by `@assertsAwaken` — calling before awake logs "Unexpected access to CameraController before it has awakened." and no-ops. Do runtime tuning from `OnStartEvent` or later.
- **Updates run on `LateUpdateEvent`** — the camera follows *after* gameplay/character movement each frame (correct order; don't move the camera yourself in `UpdateEvent`).
- **Controlled camera is the perspective 3D camera.** The ortho "UI Controls" camera renders the joystick, not the world — don't point the controller at it.
- **Set `characterToIgnore`** on obstacle avoidance to the player's controller/colliders, or the camera will collide with the character it's following.
- **Runtime mode switch resets the strategy** — re-apply any tuning after `enable*Mode()`.
- **Mode switch keeps the camera's *rotation*.** `enable*Mode()` rebuilds the strategy but never touches the Camera SceneObject's Transform rotation. **Follow** drives **position only**, so whatever pitch the previous mode left persists — and the shipped **Orbit** tilts the camera downward, so after `enableFollowCameraMode()` the view stays pitched down, not level. For a level view (side-scroller, flat top-down) reset it yourself after switching: `cameraController.camera.getTransform().setLocalRotation(quat.quatIdentity())` (then apply any yaw you want).
- Units are centimeters (offsets like 300 / 150 are cm). Coordinate frame per repo canon (+Z forward, Y up) — see `snapchat-controllable-character` §7.
