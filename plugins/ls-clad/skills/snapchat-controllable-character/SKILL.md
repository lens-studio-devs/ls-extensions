---
name: snapchat-controllable-character
description: Add a player-controlled character to a Snapchat (mobile phone) Lens using the Bitmoji Player Package — a drop-in bundle of a movement Character Controller, follow Camera Controller, on-screen Joystick + Input Action, and a 3D Bitmoji avatar. Use for third-person / top-down / side-scroller / endless-runner characters the player drives with an on-screen joystick. Covers install, the two-camera setup, tuning, and the (optional) multiplayer path. Delegates deep per-part detail to sibling skills.
user-invocable: true
---
<!--
Copyright 2026 Snap Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Snapchat Controllable Character — Bitmoji Player Package

Package (Asset Library): **Bitmoji Player Package** (v4.0.x, built on LS 5.22+). A *drag-and-drop player character* for mobile Lenses: an avatar the player drives around a 3D world with an on-screen joystick, viewed through a follow camera.

This is a **hub skill**. It owns the end-to-end "drop in a controllable character" journey — install, scene shape, wiring, single-player default, recipes — and delegates per-part detail to four spoke skills. Load a spoke only when you need its depth.

> Part of **`snapchat-games`** (the general "build a Snapchat game" entry point) — this skill is the *player-character* piece. For starting templates, self-contained-scene setup, game-logic recipes, asset kits, and a genre map, start there.

## §0 — What it actually is (read first)

The package is a **bundle of 6 independently-versioned sub-packages** glued by one orchestrator script (`PlayerCharacterInit`). It is **multiplayer-ready but sync-transport-agnostic**: single-player is the default and needs no networking package.

| Concern | Sub-package | Spoke skill for detail |
|---|---|---|
| Movement / physics / jump / dash / actions | **CharacterController** v1.7.0 | `snapchat-character-controller` |
| Follow / third-person / orbit / gyro camera | **CameraController** v2.2.0 | `snapchat-follow-camera` |
| On-screen joystick + input→action mapping (2D→3D) | **Joystick** v2.3.0 + **InputAction** v1.4.1 | `snapchat-screen-input` |
| 3D Bitmoji avatar loading | **Bitmoji 3D** v10.0.2 | `snapchat-bitmoji-avatar` |
| Context / logger foundation | CoreExtensions v0.1.1 | — (internal dep) |

Each sub-package also ships standalone in the Asset Library and is usable on its own (e.g. CharacterController for an NPC with no joystick/avatar). The spoke skills document that à-la-carte use too.

> **Not a dependency:** the shipped package does **not** depend on ConnectedFramework / Connected Lenses. Multiplayer is opt-in and bring-your-own-sync — see §6.

## §1 — Router: where to look

| You need | Go to |
|---|---|
| Install the package + get a working character | §2 Setup |
| Understand the scene it builds (two cameras, the glue) | §3 Architecture |
| Tune movement (speed, jump, dash, gravity, axis-locks) | `snapchat-character-controller` |
| Change/ tune the camera (third-person, follow, orbit, gyro) | `snapchat-follow-camera` |
| Joystick, the Emote/Dash/Jump buttons, or keyboard/dpad input — style, reposition, remove, or rebind | `snapchat-screen-input` |
| Swap the avatar (friend / My AI), quality, shadows | `snapchat-bitmoji-avatar` |
| Build a specific genre (top-down, side-scroller, runner) | §5 Recipes |
| Make it multiplayer (Connected Lenses) | §6 Multiplayer |
| Coordinate / units / gravity conventions | §7 |

## §2 — Setup

> **Starting from a template?** If you created the project from the **Bitmoji Game** template (see `snapchat-games` §1), the player character is already set up — **skip the install**, introspect the scene, and build on it. Otherwise install from scratch below.

1. **Install from the Asset Library.** Search for **"Bitmoji Player Package"** and install the most recent version (or use the `ensure-package-installed` skill). Programmatically: `SearchLensStudioAssetLibrary({ keywordFilter: ["Bitmoji Player Package"], onlyMostRecent: true })` → `InstallLensStudioPackage({ packageUri: <the .lspkg uri>, assetName: "Bitmoji Player Package" })`.
2. **It auto-instantiates.** Installing drops two things into the scene via the package's SetupScript: a **`Bitmoji Player Package`** root SceneObject (holding `PlayerCharacterInit` + `Player Visuals` + `UI Controls`) and a **`Ground Prefab`** (a floor grid + collider), and it reparents `UI Controls` under a 2D orthographic camera (creating one if absent). **`UI Controls` ships more than a joystick** — by default it also includes **Emote / Dash / Jump** action buttons and a **Keyboard Controls** object (what each does, and how to remove or tune them: `snapchat-screen-input`). **Do not instantiate the prefab a second time** — introspect the actual scene first (a `VirtualScene read`). Note the install tool's **return value under-reports what it created**: it often lists only the `Bitmoji Player Package` root (not the Ground Prefab / UI Controls / ortho camera — even though all *were* created). Decide from a scene read, **never from the install return** — re-instantiating on a misread return produces a duplicate character, the #1 setup mistake.
3. **Wait for TypeScript compilation** before touching the wiring or previewing — instantiating/editing before the compile finishes can corrupt the prefab's script links. Force it with `RecompileTypeScriptTool` and confirm `succeeded`.
4. **Preview it — a game doesn't need AR/camera tracking.** This is a self-contained 3D world, not an AR effect: no world/surface tracking, and no live camera-feed background (noisy real-world video just makes the game hard to read and hard to verify). Set it up as a **self-contained scene** — clear the Render Target to a solid color (camera feed unused, which also lets the Lens run more optimized), tracking `none`, and the perspective camera's **Device Property = `Aspect`** for a device-consistent FOV. Full checklist: `snapchat-project-init` §4. Keep a camera-feed background only if the lens is genuinely meant to composite the character over the real world.

After install you have a working, drivable single-player character. Everything below is customization.

## §3 — Architecture (what `PlayerCharacterInit` wires)

`PlayerCharacterInit` sits on the package root and orchestrates the pieces. Its `@input`s (all optional except the character controller):

| `@input` | Role |
|---|---|
| `characterController` | the movement brain (enabled for the local player, disabled for remote) |
| `bitmoji3D` | optional — a `Bitmoji 3D` component; auto-loads the avatar |
| `_mainCamera` (label "3D Camera") | the **perspective** world camera; auto-finds the first perspective camera if unset |
| `_cameraController` (label "3D Camera Controller") | the follow `CameraController`; gets `.camera` set to the 3D camera |
| `_controlsCamera` (label "UI Controls 2D Camera") | the **orthographic** UI camera; auto-finds the first ortho camera if unset |
| `controlsRoot` (label "UI Controls Root") | the on-screen controls; parented under the 2D camera for the local player, **destroyed for remote players** |

**Two-camera model (matches the repo's mobile doctrine).** A **perspective 3D camera** renders the world + character; an **orthographic 2D camera** renders the on-screen controls (joystick/buttons). This is the same two-layer split described in `../../references/snapchat-ui-and-spatial.md` and `../../references/snapchat-bootstrap-and-boilerplate.md` — the package builds it for you; keep the controls on the ortho layer.

**2D→3D projection wiring (the load-bearing detail).** `PlayerCharacterInit.assignCameraToScripts` walks `controlsRoot`, finds Input Action scripts (those with a `movementInput`), and sets `movementInput.{joystick,keyboard,dpad}AdapterConfig.projection.projectionCamera = the 3D camera`. That projection is how a 2D joystick vector becomes movement in the 3D world — the joystick's "up" means "away from the camera," not "screen-up." (Detail: `snapchat-screen-input`.)

**Single-player is the default.** `PlayerCharacterInit` runs the local-player setup whenever no `SyncEntity` was injected (`syncEntity == null`). You get a working character with zero networking. The multiplayer branch only runs if something calls `setPrefabSyncEntity(...)` first (§6).

## §4 — Customizing at a glance

You rarely edit `PlayerCharacterInit`. To change behavior, get the relevant component and call its API (import paths and full surfaces are in the spokes):

- **Movement feel** — `characterController.setMoveSpeed(...)`, `.setJumpSpeed(...)`, `.setGravity(...)`, sprint/dash, axis-locks. → `snapchat-character-controller`
- **Camera** — `cameraController.enableThirdPersonCameraMode()` / `enableFollowCameraMode()` / `enableOrbitCameraMode()` / `enableGyroscopeCameraMode()`, then tune the returned strategy. → `snapchat-follow-camera`
- **Controls** — restyle/resize the joystick, add keyboard/dpad adapters, block Snapchat gestures. → `snapchat-screen-input`
- **Avatar** — load a friend's or My AI Bitmoji, tune quality/shadows, or swap for a custom mesh under `Player Visuals`. → `snapchat-bitmoji-avatar`

**Beyond the character — the world & the game (these skills don't cover it):**
- **Background** — as in §2, a game wants a clean background (cleared color / skybox), not a live camera feed; no AR tracking needed.
- **Environment & props** — generate meshes via `/build-mesh`, or install a ready-made pack from the Asset Library. For platformers/runners there are drop-in **`Platformer Ground Kit`** and **`Platformer Obstacles Kit`** packages (install via `InstallLensStudioPackage`, same path as the player package) — ground pieces, platforms, obstacles, collectibles, and flags off the shelf. They're **meshes/art (no colliders)** — add a `ColliderComponent` to whatever the character stands on/hits. (Labeled v5.0.0 but verified to install + instantiate on LS 5.24.) **Size props in centimeters relative to the character** (a Bitmoji is ~170 cm tall): preset primitives come in at roughly 1 cm, so a "scale 1.5" marker is a ~1.5 cm speck — set real cm sizes and confirm with `GetBoundingBox`.
- **The game itself is yours — but the detection is built in.** These skills give you a *drivable character*, not a game; objective/scoring/spawning/win-lose are your own scripts. You rarely need separate physics to detect the player, though: the `CharacterController` already fires `onCollisionEnter/Stay/Exit` (blocking) and `onOverlapEnter/Stay/Exit` (triggers/pickups), plus `onJumpStarted`/`onDashStarted`/`onActionStarted` and `isGrounded()`. **Copy-paste gameplay recipes — collision reactor, overlap pickup + score, distance/goal trigger — are in `../../references/snapchat-gameplay-recipes.md`.** For world colliders/forces/raycasts beyond that, see `physics`; to orchestrate a whole experience, the `snapchat-experience-builder` agent.

## §5 — Recipes (genre presets)

All of these start from §2's drop-in, then adjust the character controller + camera. Load the two spokes for exact calls.

- **Orbit (the shipped default):** the drop-in ships an **Orbit** camera — swipe to rotate around the character (`snapchat-follow-camera`).
- **Third-person adventure:** switch the camera to **Third Person** mode (behind-the-back follow) + auto-face-movement on. Note its default auto-rotation is fast/finnicky — best for *slow* exploration; tune it, or prefer Orbit if the player needs precise control.
- **3D platformer (jump across gaps):** **keep the shipped Orbit camera — don't switch modes.** The player swipe-rotates to line up jumps and judge gap depth (Third-Person's fast auto-rotation is too finnicky for precise platforming; Follow can't reframe). Enable multi-jump + dash; author platforms with `ColliderComponent`s and keep `groundIsZero` **false** so gaps/falling work; respawn on fall (`../../references/snapchat-gameplay-recipes.md` Template 4). Camera-mode-by-genre: `snapchat-follow-camera`.
- **Top-down (collector / twin-stick):** a high **`Follow`** camera looking straight down — set `strategy.positionOffset` high on +Y and pitch the camera straight down (`quat.fromEulerVec` for −90° on X — the LS camera renders along **−Z**, so **−90° looks down at the ground and +90° looks at the sky**, an easy sign to invert). A strict overhead makes a humanoid read as a small blob, so **lower the camera (~600 cm) or add a slight tilt** for character presence. Full XZ movement, auto-face-movement on. A straight-down camera does **not** break the joystick projection; tune the height from a live capture. Sprint is BYO (see `snapchat-character-controller`); collectibles + score + timer HUD via `../../references/snapchat-gameplay-recipes.md`.
- **Side-scroller / 2.5D platformer:** `characterController.setLockZAxis(true)` (play stays in the XY plane), jump enabled, and a side-on `Follow` camera. Three things the drop-in *won't* do for you here: (1) after `enableFollowCameraMode()`, **reset the camera's rotation to level** — it inherits the shipped Orbit's downward pitch: `camera.getTransform().setLocalRotation(quat.quatIdentity())`; (2) **park the camera to the side** — set `strategy.positionOffset` on +Z looking down −Z (e.g. ~`(0,100,430)`) so the XY play-plane faces the camera (a portrait mobile frame has a narrow *horizontal* FOV, so expect to need a larger z + some X lead-room than a landscape guess — tune from a live capture; a ~300 cm-away goal was off-screen at z≈430, fine at z≈620); (3) **constrain the joystick to horizontal** (`allowedAxis = Horizontal`) — with a level side camera the vertical joystick axis is degenerate and bleeds into horizontal (push-up can read as run-left). See `snapchat-follow-camera` + `snapchat-screen-input`.
- **Endless runner (auto-runner):** `enableAutoMovement()` for continuous forward + **tap-to-jump** (a full-screen `TapEvent → jump()`), not joystick steering. Genre gotchas the drop-in won't handle: the shipped **Ground Prefab is finite** (~1280×1280 cm) so the runner runs off it — add a **ground treadmill** (reposition the ground to follow, or `groundIsZero = true`); auto-move ground speed **isn't `moveSpeed`** (measure live); and preview frame-hitches cause big single-frame steps, so **gate auto-move for a couple frames after avatar load** and use **swept** collision. Key points: `../../references/snapchat-gameplay-recipes.md` (Driving movement → Endless runner).
- **On-rails / cutscene / tap-to-move:** `characterController.moveToPosition(target)` for scripted movement; the drop-in already runs Input Control Type `None`. Copy-paste **tap-to-move** (screen tap → ground-plane → `moveToPosition`) and a **standalone-controller NPC** (patrol AI + how to animate it) are in `../../references/snapchat-gameplay-recipes.md` ("Driving movement from script").

State which recipe you're building, apply the character-controller + camera changes from the spokes, then verify live.

## §6 — Multiplayer (optional, bring-your-own-sync)

The package is multiplayer-*ready* but ships **no** sync transport. The plumbing:

- `PlayerCharacterInit` implements `SyncPrefabController` — an instantiator injects a `SyncEntity` via `setPrefabSyncEntity(syncEntity)` **between OnAwake and OnStart**. If injected and the local client owns the store, it wraps the character in an `AutonomousProxy`; otherwise it builds a `ProxyCharacter` + `SimulatedProxy` for the remote representation and destroys the local `controlsRoot`.
- Those proxy classes (`AutonomousProxy` / `ProxyCharacter` / `SimulatedProxy` / `ProxyCharacterSettings`) live in **CharacterController** and speak a generic `SyncInterface { getStore(), getServerTimestamp() }` — they're decoupled from any specific framework. (Detail: `snapchat-character-controller`.)

To make it actually networked you supply the transport — a Connected-Lenses framework that provides the `SyncEntity` + an instantiator that calls `setPrefabSyncEntity`. **That's a separate concern from this package** (ConnectedFramework is not a dependency). A dedicated `snapchat-connected-lenses` skill (the mobile analogue of `specs-sync-kit`) is the intended home for that wiring and is a planned follow-up; until it exists, treat mobile Connected Lenses as an advanced, out-of-scope build and single-player as the supported path here.

## §7 — Coordinates, units, conventions

- **Units:** centimeters. Default gravity is `{x:0, y:-980, z:0}` cm·s⁻² (≈ 9.8 m·s⁻²).
- **Rotation is yaw-only.** `characterController.setRotation(q)` keeps the character upright and only applies the Y-axis (yaw) component; auto-face-movement turns the character toward its computed movement vector.
- **Coordinate frame:** repo canon — **right-handed, +Z forward** in the script-author frame (`transform.forward` → `(0,0,1)`), +X right, +Y up; a camera with identity rotation faces world −Z. The package's auto-generated `AGENTS.md` says "right-handed / −Z forward" — consistent with this canon (its "−Z forward" describes camera-facing, not the `forward` vec3 constant). Movement facing is derived from the joystick + projection camera, so no forward-axis constant is hardcoded against the author.
- **Concrete values are version snapshots — verify live.** Every specific number across this skill family (both the component defaults *and* the drop-in's configured values — speeds, camera offsets, avatar quality, enum indices, etc.) is a **v4.0.x snapshot** that drifts whenever the package or a sub-component updates. Treat them as illustrative direction, not authoritative. The **live component is the source of truth** — read it in the scene, or grep the installed prefab (`…/Cache/<uuid>/…/Data/*.prefab`), for current values before relying on any specific number. The durable facts (which knobs exist, the API, the two-camera shape, *which direction* the drop-in tunes things) are what these skills lean on.

## §8 — Pitfalls

- **Double instantiation.** Install auto-instantiates the prefab + ground. Re-adding the prefab yields two characters/joysticks. Introspect the scene before instantiating anything.
- **Controls on the wrong camera.** The `UI Controls` must live under an **orthographic** camera (the package reparents them there). If you rebuild the scene, keep that split — controls under a perspective camera won't composite as a 2D overlay.
- **Editing before compile.** Wiring `@input`s or previewing before the post-install TypeScript compile finishes can break the prefab's script links. Recompile and confirm first.
- **The drop-in disables the character until an async `OnStart`.** `PlayerCharacterInit` sets `characterController.enabled = false` (and `controlsRoot.enabled = false`) in its constructor, and only re-enables them inside an **async** `setupLocalPlayer()` bound to `OnStartEvent` — which completes *after* the avatar download (seconds later in preview). Runtime tuning you run in your own `onAwake`/`onStart` will hit a **disabled** controller and silently no-op. Gate your setup on `characterController.enabled === true` (poll a frame or two, or key off the avatar's `onDownloaded`) before calling move/camera/lock APIs. **The same gate covers *subscribing* to the events** — `onCollisionEnter/Stay/Exit` and `onOverlapEnter/Stay/Exit` are getters that dereference the controller's collider (created during that async init), so `character.onOverlapEnter.add(...)` in `onAwake` throws *`Cannot read property 'characterCollider' of undefined`*. Subscribe once `enabled === true`, not in `onAwake`.
- **Remote players destroy `controlsRoot`.** Only the local player keeps the joystick; don't parent shared HUD you need on all clients under `controlsRoot`.
- **Avatar load is async.** `downloadAvatar()` / `downloadAvatarForUser()` return Promises; genuine failures (permissions/network) reject to `onDownloadFailed`. A user with no Bitmoji / not signed in does **not** fail or render empty — the loader falls back to a default Bitmoji. Gate avatar-dependent gameplay on the load and handle rejection. (Detail: `snapchat-bitmoji-avatar`.)

## §9 — Cross-references

- Movement brain → `snapchat-character-controller`
- Follow/third-person/orbit/gyro camera → `snapchat-follow-camera`
- On-screen joystick + input mapping → `snapchat-screen-input`
- 3D Bitmoji avatar → `snapchat-bitmoji-avatar`
- Mobile UI + two-camera doctrine → `../../references/snapchat-ui-and-spatial.md`, `../../references/snapchat-bootstrap-and-boilerplate.md`
- Project setup (tracking, preview camera) → `snapchat-project-init`
- Installing packages → `ensure-package-installed`
