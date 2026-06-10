---
name: specs-sync-kit
description: Build multiplayer/shared/colocated AR experiences with SpectaclesSyncKit — Connected Lenses, SyncEntity, StorageProperty, Instantiator, networked events/RPCs, ownership transfer, ColocatedWorld placement, the notifyOnReady lifecycle.
user-invocable: false
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# SpectaclesSyncKit — Multiplayer Guide

Package path: `SpectaclesSyncKit.lspkg/`

This skill teaches the network plumbing: shared state, ownership, prefab instantiation, networked events, scene placement, the readiness lifecycle. Visuals (UI, icons, meshes, sound) come from sibling skills — see §9.

## §0 — Build method (read this first)

Most fresh-agent failures here come from *skipping method*, not from missing docs. Do these in order:
1. **Find the recipe before you design.** Match your concept to a §1 row first. If one fits (turn-based grid → `TurnTakingGame.ts`; an object each player controls → §6.4 + the §8 interactive-object callout; one host spawns the shared world → §6.3), USE it — reinventing an existing recipe is the #1 source of avoidable bugs.
2. **Build + verify ONE layer at a time.** SyncKit failures are silent at author-time and only surface at runtime (a claim that "succeeds" but doesn't stick; a gate that quietly disables an object). Confirm each layer in a live two-pane Preview before stacking the next — not build-everything-then-run-once.
3. **When something's wrong, inspect the live object BEFORE changing code.** For "I don't see it / can't interact / it desyncs," query the runtime object's transform, scale, `doIOwnStore()`, and the actual StorageProperty values first. Iterating on mechanics without looking turns a one-line cause into a dozen rounds.
4. **Before "fixing" flaky multiplayer behavior, check the §10 Preview decoder.** `isHost()`, `getUsers()`, ownership stickiness, and server-time behave differently in Lens Studio's two-pane mock than on hardware — don't write code to fix the simulator.

## §1 — Quick reference router

| What you need | Where to look |
|---|---|
| Initial project setup (install SyncKit, prefab placement, testing) | §2 Setup |
| Where in the scene synced content must live | §3 Scene placement |
| When can I call API X? (`notifyOnReady` gates) | §4 Lifecycle |
| API surface reference (SessionController, SyncEntity, etc.) | §5 Core API |
| Sync a SceneObject's transform | §6.1 Transform sync + `resources/scripts/TransformSync.ts` |
| Per-player name tag floating above the head | §6.2 Name tag + `resources/scripts/NameTagSpawner.ts` + `NameTagController.ts` |
| Host-only spawn (one device spawns shared objects) | §6.3 Host-only spawn + `resources/scripts/HostOnlySpawner.ts` |
| Per-player spawn (each device spawns its own copy) | §6.4 Per-player spawn + `resources/scripts/PerPlayerSpawner.ts` |
| Synced two-team scoreboard | §6.5 Scoreboard + `resources/scripts/Scoreboard.ts` |
| Collectible / claim-and-destroy pickup | §6.6 Collectible + `resources/scripts/Collectible.ts` |
| One-shot networked events / RPCs (SFX, gesture broadcast, damage) | §6.7 + `resources/scripts/NetworkEventBus.ts` |
| Per-player avatar with head-follow | §7 + `resources/scripts/PlayerAvatarSpawner.ts` + `PlayerAvatarController.ts` |
| Spawn-stream-fade transient (laser pointer dot, ping marker) | §7 + `resources/scripts/TransientSpawner.ts` + `TransientController.ts` |
| Multi-state player label (status, availability, ping pip) | §7 + `resources/scripts/MultiStatePlayerLabel.ts` |
| Turn-taking game (3×3 grid, X/O, scoreboard, win detection) — *controller only; you render the cell marks (see §7)* | §7 + `resources/scripts/TurnTakingGame.ts` |
| Free-for-all shared state (UI sliders, hand poses) | §7 + `resources/scripts/UIKitSharedControls.ts` / `HandSyncBroadcast.ts` |
| Synchronized countdown timer (server-time based; owner broadcasts remaining for Preview-pane consistency) | §7 + `resources/scripts/SyncedTimer.ts` |
| Targeted ping with response (dual-event RPC) | §7 + `resources/scripts/PingResponse.ts` |
| Movable game piece with cooperative ownership transfer (handler-level gating; canTranslate stays true) | §7 + `resources/scripts/ManipulatablePiece.ts` |
| Draggable piece that locks into one of N discrete target slots on release (Lego, jigsaw, Sokoban, inventory grid) | §7 + `resources/scripts/SnapToSlotPiece.ts` |
| On-demand spawn of session-persistent objects (dispenser bins, dropped pickups, placeable inventory) with optional per-spawn config | §7 + `resources/scripts/PersistentSpawner.ts` |
| Deterministic per-player color from `connectionId` | §7 + `resources/scripts/PlayerColorAssigner.ts` / `TeamPalette.ts` |
| Automatic material color sync | §7 + `resources/scripts/MaterialColorSync.ts` |
| Bitmoji / Snapchat user lookup | §7 + `resources/scripts/BitmojiLookup.ts` |
| Decide between SyncEntity vs RealtimeStore, or between ownership APIs | §8 Decision tables |
| Choose between `doIOwnStore()` and `isHost()` for host gating (per-entity vs. session-wide) | §5 SyncEntity → "Host gating" callout + §10 "Host gating" pitfall |
| Make a per-player object interactable only by its owner (pouch / paddle / cursor / piece) — which gate, and the coupling anti-pattern | §8 "Picking the gate for an interactive object" callout + §10 `doIOwnStore()`-gating pitfalls |
| Auto-start a multiplayer lobby once N players have joined (works across `START_MENU` + `MULTIPLAYER` modes) | §10 host-gating pitfall + EnableOnReady-timing pitfall (combine: claimOwnership entity → `doIOwnStore()` gate → `getUsers().length` → per-frame retry from `UpdateEvent`) |
| Make late / staggered joiners discover earlier peers (`sendEvent` doesn't replay history) | §6.7 self-delivery callout + §10 late-joiner presence/announce handshake |
| Handle a player or the host leaving mid-session (cleanup, ownership re-claim, host migration) | §10 "Handle players — and especially the host — leaving" pitfall |
| Why code that works in `MULTIPLAYER` mode breaks in `START_MENU` (and vice versa) | §10 `startMode` pitfall + `isHost` pitfall + `EnableOnReady`-timing pitfall (mode-asymmetry triad) |
| **Verify a sync-kit build's structural state** (Examples disabled? `startMode` correct? content under `EnableOnReady`? Device Tracking on Camera? at least one `SyncEntity` in scripts?) | spawn `ls-clad:specs-sync-kit-validator` (read-only post-build verifier; reports issues with concrete fixes for the main agent to apply) |
| Cross-link to UI / mesh / icon / sound / interaction skills | §9 Cross-references |
| Avoid common pitfalls (bogus APIs, parity-team fragility, no private state) | §10 Pitfalls |
| Sync SIK components (Slider, ScrollView, Manipulation) | `resources/docs/syncing-sik-components.mdx` |
| Custom Location pinned AR | `resources/docs/connected-custom-location.mdx` |
| Debugging tools (SyncEntityDebug, Connected Lenses Monitor) | `resources/docs/debugging.mdx` |

## §2 — Setup

> ⚠️ **CRITICAL — four checks fresh agents routinely skip (1–3 produce visible runtime bugs; 4 ships the wrong platform). Not optional, not user TODOs — apply right after the prefab is installed:**
> 1. **Disable** `SpectaclesSyncKit / Colocated World / EnableOnReady / Examples` (see step 4)
> 2. **Verify** `SessionController [CONFIGURE_ME].startMode = "START_MENU"` (see step 5)
> 3. **Verify** the Camera has `Device Tracking` with `Tracking Mode: World` (see step 7)
> 4. **Verify** `targetPlatform: Spectacles` in the `.esproj` (see step 6)

1. Install via **Window → Asset Library → Spectacles → Spectacles Sync Kit**. This auto-installs `Connected Lens Module`, `Location Cloud Storage Module`, and bundled SpectaclesInteractionKit + SpectaclesUIKit.
2. **Wait for TypeScript compilation** (TypeScript Status panel) before dragging the prefab into the scene — instantiating early can corrupt the prefab's script links.
3. Drag `Assets/SpectaclesInteractionKit/Prefabs/SpectaclesInteractionKit.prefab` into the Scene Hierarchy first, then drag `Assets/SpectaclesSyncKit/SpectaclesSyncKit.prefab`.
4. ⚠️ **Disable the bundled `Examples` SceneObject** at `SpectaclesSyncKit / Colocated World / EnableOnReady / Examples`. It's hidden in the Inspector at edit time (because `EnableOnReady` starts disabled), but `SetEnabledOnReady.ts` flips it on at session-ready and bundled sample content (color-cycling cubes, transform demos, etc.) renders on top of your scene. Expand the SyncKit prefab → Colocated World → EnableOnReady, find `Examples`, uncheck `Enabled`. **Agents: this is one of the most-frequently-missed steps.** Programmatically: `scene-graphql` query for the SceneObject named "Examples" with parent path containing "EnableOnReady", then `setEnabled(id, false)`. Verify by re-querying — if its `enabled` is still `true`, you missed it.
5. ⚠️ **Leave the `StartMenu` SceneObject ENABLED and keep `startMode = START_MENU`** (the prefab default — what humans should ship with). The StartMenu is a separate top-level SceneObject in the SyncKit prefab — NOT under `Colocated World / EnableOnReady`; don't confuse it with `Examples`. At lens-launch the menu shows Multiplayer/Singleplayer buttons; tapping Multiplayer triggers the colocation flow and then flips `EnableOnReady` on automatically. Customize visuals (title, icon, button styling) under `StartMenu`'s children. **Don't permanently switch `startMode` to `MULTIPLAYER`** just to skip the menu during development — that's a debug-only override that has known mock-preview failure modes (see §10 startMode pitfall) and ships a different code path than what your humans will see. If you need menu-less testing temporarily, the §10 pitfall has the workflow. See also `resources/docs/start-menu-and-single-player.mdx`.
6. **Project Settings → Platform Settings → Spectacles** so Connected Lens permissions are configured. **Also verify the project's `targetPlatform` is `Spectacles`, not `Snapchat`.** Projects scaffolded from the default "New Project" template are Snapchat-targeted (`fromTemplateName: Default`); SyncKit/SIK packages preview fine on top while the Lens still *builds* for Snapchat. Start from the Spectacles template, or fix the `.esproj`: `targetPlatform: Spectacles` + `lensClientCompatibilities: [Spectacles]`. On an existing project, read these from the `.esproj` and reconcile before building — the router/builder don't auto-correct it.
7. ⚠️ **Camera needs `Device Tracking` with `Tracking Mode: World`.** Without it, colocation fails at runtime with `Your main camera is currently missing a 'Device Tracking Component'`. On a fresh Specs template the camera ships with the component already configured; if you started from a blank scene, add `Device Tracking` to the Camera SceneObject and set `Tracking Mode` to `World`.
8. Run `ls-clad:update-lens-packages` after install — bundled UIKit / SIK can lag the Lens Studio TypeScript type defs, producing compile errors that cascade into shim hacks.
9. **Singleplayer testing**: in the `StartMenu` Inspector, confirm `Single Player Type: Mocked Online (Automatic)` so your synchronization logic works with a single Preview panel during development. Manual mode requires you to write your own singleplayer fallback.
10. **Local multi-user testing**: open multiple Preview panels via **Window → General → Preview**. Each panel simulates a distinct user in the same session. The Session ID at the top of each Preview confirms they're joined to the same session. Click `Randomize Session ID` in the Connected Lens Module Inspector to reset all Previews to a fresh session.

Deferred details: `resources/docs/overview.mdx`, `resources/docs/building-connected-lenses.mdx`, `resources/docs/start-menu-and-single-player.mdx`, `resources/docs/release-notes.mdx`.

## §3 — Scene placement: `Colocated World / EnableOnReady`

All synced content goes under `SpectaclesSyncKit / Colocated World [CONFIGURE_ME] / EnableOnReady`. Content placed elsewhere can render out of frame.

```
SpectaclesSyncKit/
├── SessionController [CONFIGURE_ME]
├── StartMenu                          ← keep enabled (top-level)
└── Colocated World [CONFIGURE_ME]     ← shared coordinate frame
    └── EnableOnReady                  ← disabled until session ready
        ├── Examples                   ← disable this manually
        └── (your synced content)      ← put it here
```

- **`Colocated World`** is the root of the shared colocated coordinate space. Transforms underneath are interpreted in the shared frame, so every user sees content in the same physical place.
- **`EnableOnReady`** starts disabled at edit time. SyncKit flips it on after `SessionController.notifyOnReady` fires (and the StartMenu's `Enable on Singleplayer Nodes` list flips it on for singleplayer mode). Placing content here hides it during mapping / relocalization so users don't see half-initialized state.

**Important warning** (from `resources/docs/release-notes.mdx`): if you place content elsewhere inside the SyncKit prefab and **revert the prefab** during a package update, your custom objects will be deleted. Keep custom content under `Colocated World / EnableOnReady`.

**For content the user should be near at session start** (shared HUD, intro panel): add `PositionInitializer` + `SyncTransform` to the shared root. `PositionInitializer` places the object in front of the first user (the mapper); `SyncTransform` syncs that placement to subsequent joiners. Configure `Trigger Only For Mapper: true` (recommended). See `resources/docs/content-placement.mdx`.

**Head-following / billboarded UI is still "content" for placement purposes.** If your UI is a HUD that orients to the local user (e.g., score panel that billboards to camera), the SceneObject's HIERARCHY placement determines WHEN it renders — independent of its transform-space behavior. UI parented at scene root renders at Lens launch, alongside the SyncKit `StartMenu`, producing a visual overlap. UI parented under `Colocated World / EnableOnReady` stays hidden until session-ready, after the user has picked Solo/Multiplayer from the menu. The transform's runtime BEHAVIOR (head-following, camera-relative positioning) is a separate concern set by your script — it works the same regardless of where the SceneObject lives in the hierarchy. **Default placement: under `EnableOnReady`.** Place at scene root ONLY for UI that's meant to be visible BEFORE session-ready (e.g., custom lobby UI replacing the SyncKit StartMenu) — in which case disable the SyncKit StartMenu, don't double up.

**`[CONFIGURE_ME]` is a naming convention, not a runtime gate.** The default SceneObjects `ColocatedWorld [CONFIGURE_ME]` and `SessionController [CONFIGURE_ME]` ship with `[CONFIGURE_ME]` in their names as UI hints to humans — the SceneObjects have Inspector properties (PositionInitializer offsets, LocatedAtComponent reference, Custom Location) worth customizing for production. Renaming is optional. Runtime behavior — including whether `EnableOnReady` fires at session-ready — is determined by the SetEnabledOnReady helper's `SessionController.notifyOnReady` subscription, NOT by the SceneObject name. Verifier agents or other tooling that flags `[CONFIGURE_ME]` in a name as a blocker are wrong; flag actual misconfigured properties instead.

## §4 — Lifecycle

Three readiness gates, in dependency order:

1. **`SessionController.getInstance().notifyOnReady(cb)`** — session connected + user mapped / relocalized. SessionController APIs (`getLocalUserInfo`, `getUsers`, `isHost`, `getSession`, `getServerTimeInSeconds`) become callable here.
2. **`syncEntity.notifyOnReady(cb)`** — that entity's Realtime Store is ready. Safe to read storage props, call `setPendingValue`, call `sendEvent`.
3. **`instantiator.notifyOnReady(cb)`** — that Instantiator is ready. Safe to call `instantiate()`.

**Safe before ready**: adding storage properties (`addStorageProperty`), subscribing to events (`onEventReceived.add`), pre-emptive `requestOwnership` (queued). The SyncEntity constructor itself runs anytime.

**Needs the gate**: reading `currentValue` (it may be `null` for the first user — use `currentOrPendingValue` inside callbacks), `setPendingValue`, `sendEvent`, `Instantiator.instantiate`.

**Decision rule:** what are you about to call? → wait on that gate. Chain them when both are needed: `SessionController.notifyOnReady → instantiator.notifyOnReady → instantiate(...)`.

**Mode-asymmetry warning (mock-preview):** the *moment* `notifyOnReady` fires — and therefore the moment scripts under `Colocated World / EnableOnReady` run their `onAwake` — differs dramatically between `startMode = MULTIPLAYER` (both panes ~simultaneously, ~1 s after Lens load) and `startMode = START_MENU` (only when *that* pane's user clicks the Multiplayer button, so panes can boot seconds apart and the second one joins an already-connected session). Event handlers wired in `onAwake` to `SessionController.onConnected` / `onHostUpdated` can silently miss firings that already happened on a peer. Pair every event subscription with a per-frame retry in `UpdateEvent` for any "I am authoritative now" transition. See §10 EnableOnReady-timing pitfall for the full recipe.

Deep dive: `resources/docs/lifecycle.mdx`.

## §5 — Core API surface

API names below are verbatim from `resources/docs/`. If an API name isn't listed here or in a recipe, it likely doesn't exist — don't invent.

**SessionController** (singleton). `getInstance()`, `notifyOnReady(cb)`, `getIsReady()`, `getLocalUserInfo()`, `getLocalUserName()`, `getLocalConnectionId()`, `getLocalUserId()`, `getUsers()`, `getUserByConnectionId(id)`, `getUsersByUserId(id)`, `getHostUserId()`, `getHostConnectionId()`, `getSession()`, `getServerTimeInSeconds()` (returns `number | null` — `null` until the session is created; callers gating round deadlines on a "server clock available" condition must null-check before reading; in mock-preview the value is per-pane local — see §10 server-time pitfall), `isSingleplayer()`, `isHost()` (returns `boolean | null` — `null` until the pane has joined + host is elected; reliable on real hardware and in `START_MENU` Preview, but a `MULTIPLAYER`-mode single-pane refresh can confuse it — see §10; for *per-entity* authority prefer `syncEntity.doIOwnStore()` on a `claimOwnership: true` entity). Events: `onConnected` (fires when the local pane finishes connecting — the canonical "I + the already-connected externalUsers are now in `getUsers()`" signal; `onUserJoinedSession` does NOT fire for the local user, so use `onConnected` to seed your initial player tracking), `onUserJoinedSession` (fires for *subsequent remote* arrivals only — never for the local user; internally deduped by `connectionId`), `onHostUpdated` (fires when host election completes or re-elects; subscribe alongside `onConnected` for any logic gated on host status so you catch later re-elections), `onUserLeftSession`, `onRealtimeStoreUpdated`, `onConnectionFailed`. See `resources/docs/session-controller.mdx`.

**SyncEntity** — constructor:

```typescript
new SyncEntity(component, storagePropertySet?, claimOwnership?, persistence?, networkIdOptions?)
```

The 3rd argument is `claimOwnership: boolean` (NOT `autoSync`). Persistence values: `"Session"` (default — entity lives as long as any user is in session), `"Owner"` (auto-destroy when owner leaves), `"Persist"` (not supported on Specs), `"Ephemeral"` (not recommended).

**Singleton manager entities — pass a custom `NetworkIdOptions` so every client agrees on the id.** When one entity must carry shared game state (current round, phase, score, drawer assignment) and every client must agree on which entity that is, the default auto-id derives from the component instance and DIFFERS across clients — peers end up with two distinct entities that never sync. Pin the id explicitly:

```typescript
import {NetworkIdOptions} from "SpectaclesSyncKit.lspkg/Core/NetworkIdTools"
import {NetworkIdType} from "SpectaclesSyncKit.lspkg/Core/NetworkIdType"

const idOpts = new NetworkIdOptions(NetworkIdType.Custom, "MyGameEntity")
this.syncEntity = new SyncEntity(this, propSet, /* claimOwnership */ true, "Session", idOpts)
```

Use this for any "there is only one of these per session" manager. For per-player or per-instance entities created via `Instantiator.instantiate(...)`, the InstantiationOptions `overrideNetworkId` field serves the same purpose.

**Host gating — pick the primitive by scope** (full decision tree + mock-preview caveats in §10 "Host gating" pitfall):
- **`syncEntity.doIOwnStore()` on a `claimOwnership: true` entity** → *per-entity* authority ("am I the writer for THIS entity's state?"); reliable in both mock-preview modes AND on real hardware; where ~90% of game-state writes belong.
- **`SessionController.isHost() === true`** → *session-wide* authority, or when you have no SyncEntity yet (early init) or it's `claimOwnership: false`. Always compare with `=== true`, not a truthy check (return type is `boolean | null`).

Methods: `notifyOnReady(cb)`, `addStorageProperty(prop)`, `requestOwnership(onSuccess, onError)`, `tryClaimOwnership(onSuccess, onError)`, `tryRevokeOwnership(onSuccess?, onError?)`, `doIOwnStore()`, `canIModifyStore()`, `isStoreOwned()`, `ownerInfo` (UserInfo), `onOwnerUpdated`, `sendEvent(name, data?, remoteOnly?)`, `onEventReceived.add(name, cb)`, `destroy()`, `destroyed`, `onDestroyed`/`onLocalDestroyed`/`onRemoteDestroyed`, `networkRoot` (NetworkRootInfo when instantiated, else null), `currentStore`, `isSetupFinished`.

Static: `SyncEntity.getSyncEntityOnSceneObject(obj)`, `SyncEntity.getSyncEntityOnComponent(comp)`. See `resources/docs/sync-entity.mdx`.

**StorageProperty** — three families:

- **Manual** (you call `setPendingValue`): `manualBool`, `manualInt`, `manualFloat`, `manualDouble`, `manualString`, `manualVec2`, `manualVec3`, `manualVec4`, `manualQuat`, `manualMat2/3/4`, all `*Array` variants. Plus `manual<T>(key, StorageTypes.T, initial, smoothing?)` for custom types.
- **Auto** (poll + replicate via getter/setter): `autoBool` / `autoInt` / `autoFloat` / `autoVec3` / `autoVec4` / etc., plus `auto<T>(key, StorageTypes.T, getter, setter, smoothing?)`.
- **Pre-bound auto helpers**: `forTextText(textComponent)` (bidirectional text sync), `forPosition(transform, propertyType)`, `forRotation(transform, propertyType)`, `forScale(transform, propertyType)`, `forTransform(transform, posType, rotType, scaleType)`, `forMeshVisualBaseColor(visual, clone?)`, `forMaterialProperty(material, key, type)`, `forMeshVisualProperty(visual, key, type, clone?)`.

Read API: `currentValue` (server-synced — may be `null` for joiner inside `notifyOnReady`), `pendingValue` (local-only queued write), `currentOrPendingValue` (use this in `notifyOnReady` callbacks). Write: `setPendingValue(v)` (queued to server at LateUpdate), `setValueImmediate(currentStore, v)` (rare — only after `canIModifyStore()` check).

Events: `onAnyChange(cb)`, `onLocalChange(cb)`, `onRemoteChange(cb)`, `onPendingValueChange(cb)`.

Generic types use **`StorageTypes`**, not raw types: `StorageProperty<StorageTypes.string>`, NOT `StorageProperty<string>` (breaking change in SyncKit v1.3.6064068 — see `resources/docs/release-notes.mdx`).

All `StorageTypes`: `bool`, `float`, `double`, `int`, `string`, `vec2`, `vec3`, `vec4`, `quat`, `mat2`, `mat3`, `mat4`, all `*Array` variants, `packedTransform` (alias for `vec4Array`).

`PropertyType` for transform sync: `Local` (parent-relative), `Location` (colocated-frame-relative — use for colocated content), `World` (Specs world origin — not recommended for colocated).

Rate limit: `prop.sendsPerSecondLimit = N`. Smoothing: `prop.setSmoothing({ interpolationTarget: -0.25 })` or pass a `SnapshotBufferOptions` to the constructor.

See `resources/docs/storage-properties.mdx`.

**StoragePropertySet** — `new StoragePropertySet([prop1, prop2, ...])`; pass to SyncEntity constructor's 2nd argument to bulk-add.

**Instantiator** — `notifyOnReady(cb)`, `isReady()`, `instantiate(prefab, options?, onSuccess?)`. `InstantiationOptions`: `claimOwnership`, `persistence`, `overrideNetworkId`, `localPosition` / `localRotation` / `localScale`, `worldPosition` / `worldRotation` / `worldScale`, `customDataStore` (a `GeneralDataStore` carrying identity / config payload), `onSuccess`, `onError`. Accepts either an `InstantiationOptions` instance or a plain object. Auto-instantiate mode (per-user spawn on join) is Inspector-configured on the Instantiator component. See `resources/docs/prefab-instantiation.mdx`.

**NetworkRootInfo** — fields on every instantiated prefab's root SceneObject. `instantiatedObject`, `locallyCreated`, `dataStore` (the `customDataStore` passed to instantiate, if any), `onDestroyed` / `onLocalDestroyed` / `onRemoteDestroyed`. Methods: `getOwnerUserId()`, `getOwnerId()`, `isOwnedBy(connectionId)`, `isOwnedByUserInfo(user)`, `canIModifyStore()`, `doIOwnStore()`. Reachable from any SyncEntity in the prefab via `syncEntity.networkRoot`.

**Networked events** (on SyncEntity): `sendEvent(name, data?, remoteOnly?)` + `onEventReceived.add(name, cb)` — **scoped to that one entity: a sender on entity A reaches only listeners on entity A (every pane), not other scripts/entities; for cross-script signals share one entity — see §6.7 `NetworkEventBus`**. `MessageInfo` (the `cb` argument): `senderUserId`, `senderConnectionId`, `message`, `data`. Data must be JSON-serializable (primitives, vec2 / vec3 / vec4, quat, plain objects). Limits (`resources/docs/payload-and-rate-limits.mdx`): **100 KB per message**, **350 messages per 5-second window per session**.

**SyncTransform component** — Inspector-configured component that auto-syncs the SceneObject's transform. Settings: Network ID Type (Object ID / Custom), Sync Settings (None / Location / Local / World per axis), Sends Per Second (default 10), Use Smoothing + Interpolation Target. Cannot change settings at runtime. See `resources/docs/sync-transform.mdx`.

**SyncMaterials component** — Inspector-configured per-property material sync (float, vec2, vec3, vec4). Auto-clone option for shared materials. See `resources/docs/sync-materials.mdx`.

**SyncRealtimeStore component** — minimal SyncEntity wrapper around a Realtime Store for raw key/value sync. See `resources/docs/sync-realtime-store.mdx`.

**Helper scripts** — `DisplayStorageProperty` (binds a Text component to a property by name, useful for scoreboards and debug overlays), `SetEnabledIfOwner` (toggles entire SceneObjects based on the owner's identity). See `resources/docs/helper-scripts.mdx`.

**SIK component sync** — set `isSynced = true` on Slider, ToggleButton, ScrollView, InteractableManipulation, ContainerFrame and SIK syncs their state via SyncEntity internally. `Interactable` exposes `onSync*` events (`onSyncHoverStart`, `onSyncTriggerStart`, `onSyncDragUpdate`, etc.) that fire on remote interactions. Requires enabling the `[OPTIONAL] Connected Lens` SceneObject under the SpectaclesInteractionKit prefab. See `resources/docs/syncing-sik-components.mdx`.

**UserInfo** — `userId` (Snapchat account; stable across devices for that account-in-that-lens), `connectionId` (device-session; unique per join; RealtimeStore ownership keys off this), `displayName` (Snapchat profile name). For Bitmoji: `session.getSnapchatUser(userInfo, cb)` returns a `SnapchatUser` with `displayName`, `userName`, `hasBitmoji`. Returns `null` in singleplayer / mocked mode — always null-check. See `resources/docs/user-information.mdx`.

## §6 — Inline recipes

Each recipe is a complete, attachable TypeScript component. Same content is also a standalone file under `resources/scripts/` for copy-paste.

### §6.1 — Transform sync

**Default: declarative `SyncTransform` component.** Use this for the common case of "one device drives the transform, others passively follow" — grabbable objects, NPC positions, projectiles, anything where you want sync to happen without writing code.

Inspector setup (no code required):

1. Add `SyncTransform` component to the SceneObject (the one whose transform you want synced).
2. **Sync Settings**: Position = `Location`, Rotation = `Location`, Scale = `None` (most cases don't need scale sync). `Location` = colocated-frame-relative, the right choice for content under `Colocated World`. `Local` = parent-relative (rarely needed). `World` = Specs world origin (not recommended for colocated builds).
3. **Sends Per Second**: `10` is a good default. Lower to `5` for static-ish entities, raise to `20` for fast-moving projectiles.
4. **Use Smoothing**: `true` (default). Peers see interpolated motion between updates.
5. **Interpolation Target**: `-0.25` is the standard small backward-extrapolation buffer; tune if motion looks choppy or laggy.

For grabbable / draggable objects with cooperative ownership transfer, use the **§7 `ManipulatablePiece.ts`** recipe — it composes `SyncTransform` + SIK `InteractableManipulation` + handler-level ownership claim/revoke. Don't reinvent.

Settings can't change at runtime — once `SyncTransform` initializes, it runs with its Inspector config. For runtime-controllable transform sync, see the manual variant below.

#### Manual variant — drop down to storage properties ONLY when SyncTransform can't express what you need

Use the manual code path BELOW only if one of these applies:
- **Selective axes**: sync X only, ignore Y/Z (SyncTransform syncs whole position/rotation/scale per axis-group).
- **Conditional sync**: only when a flag is true (e.g., only sync while the player is grabbing it).
- **Runtime smoothing tweaks**: need to change `SnapshotBufferOptions` per entity or per-frame (SyncTransform's smoothing is Inspector-only).
- **Animating a transform property alongside other game-state StorageProperties on the same SyncEntity**.

**If your case isn't in that list, you want SyncTransform.**

```typescript
// Manual variant. See bullets above for when to actually use this.
import {StorageProperty, PropertyType} from "SpectaclesSyncKit.lspkg/Core/StorageProperty"
import {StoragePropertySet} from "SpectaclesSyncKit.lspkg/Core/StoragePropertySet"
import {SyncEntity} from "SpectaclesSyncKit.lspkg/Core/SyncEntity"

@component
export class TransformSync extends BaseScriptComponent {
  private readonly positionProp = StorageProperty.forPosition(this.getTransform(), PropertyType.Location)
  private readonly rotationProp = StorageProperty.forRotation(this.getTransform(), PropertyType.Location)
  private readonly syncEntity = new SyncEntity(this,
    new StoragePropertySet([this.positionProp, this.rotationProp]),
    true, "Session")
}
```

Full file: `resources/scripts/TransformSync.ts`. Tuning details: `resources/docs/sync-transform.mdx`.

### §6.2 — Name tag (per-player floating label)

Two scripts. **Spawner** (one SceneObject in scene under `Colocated World / EnableOnReady`, holding an `Instantiator` component with `NameTagPrefab` in its Prefabs array). **Controller** (on the prefab leaf).

**Spawner Instantiator Inspector config — non-obvious requirement.** On the spawner's `Instantiator` component, set `Spawn As Children: true` AND wire `Spawn Under Parent` to the spawner SceneObject (or any SceneObject under `Colocated World [CONFIGURE_ME]`). Wire both — the default `Spawn As Children: false` and a `true`-but-unwired `Spawn Under Parent` each throw a distinct error. Full failure mode and error strings in §10 (LocatedAtComponent pitfall).

**Prefab requirements**: Text component wired to `userNameText` @input; `SyncTransform` (Sync Settings: Position = Location, Rotation = Location) — this provides the SyncEntity the controller shares (avoids the two-SyncEntities-on-one-SceneObject anti-pattern); this controller. **Location-mode SyncTransform requires the spawner's Instantiator to parent spawns into the ColocatedWorld subtree — see the Spawner Instantiator Inspector config note above.**

**Design choice — read prefab data, don't sync it.** The name + team color are one-shot prefab data: set once at spawn by the owning device, replicated to all peers as part of NetworkRootInfo. The controller reads both from `networkRoot.dataStore` (name) and `networkRoot.ownerInfo` (color), so no StorageProperty sync is involved for name/color. This avoids the auto-property thrashing pitfall — `StorageProperty.forTextText` / `autoVec4` on the *shared, unowned* SyncEntity from `SyncTransform` (constructed with `claimOwnership:false`) causes every device's auto-poll to broadcast, last-write-wins clobbers the spawner's value. See §10 for the correct `forTextText` pattern when you DO need mutable synced text.

Spawner — runs on **every device** after the chained `SessionController.notifyOnReady → instantiator.notifyOnReady`. Cascades through identity sources to pick the best available name (Lens Studio Preview panes can return empty `displayName` when no Snapchatter identity is set), then bakes it into the customDataStore:

```typescript
const local = session.getLocalUserInfo()
const resolvedName =
  local.displayName ||
  local.userId ||
  session.getLocalUserName() ||
  "Unknown User"

const data = GeneralDataStore.create()
data.putString("displayName", resolvedName)
data.putString("connectionId", local.connectionId || "")
data.putString("userId", local.userId || "")

this.instantiator.instantiate(this.nameTagPrefab, {
  claimOwnership: true,
  persistence: "Owner",                    // auto-destroy on disconnect
  customDataStore: data,                   // displayName / connectionId / userId
  overrideNetworkId: local.connectionId + "_nameTag",   // stable across reconnects
})
```

Controller — **share SyncTransform's SyncEntity** for `notifyOnReady` (so we wait until the network root is wired before reading its data), defer the lookup to `OnStartEvent`, and on ready: set the Text from `networkRoot.dataStore` and compute the team color deterministically from the sorted-by-connectionId position of `networkRoot.ownerInfo`:

```typescript
private syncEntity: SyncEntity

onAwake() {
  this.createEvent("OnStartEvent").bind(() => this.init())
}

private init() {
  this.syncEntity = SyncEntity.getSyncEntityOnSceneObject(this.sceneObject)
  this.syncEntity.notifyOnReady(() => this.onReady())
}

private onReady() {
  const root = this.syncEntity.networkRoot
  if (!root) return

  // Name from prefab customDataStore — one-shot, no sync race.
  this.userNameText.text =
    root.dataStore?.getString("displayName") || "Unknown User"

  // Team color from owner's connectionId, sorted index globally consistent.
  const ownerConn = root.ownerInfo?.connectionId
    || root.dataStore?.getString("connectionId") || ""
  const sorted = SessionController.getInstance().getUsers()
    .slice().sort((a, b) => a.connectionId.localeCompare(b.connectionId))
  const ownerIndex = sorted.findIndex(u => u.connectionId === ownerConn)
  const team = ownerIndex % 2 === 0 ? "red" : "blue"
  this.userNameText.textFill.color = team === "red" ? RED : BLUE

  // Local-only: head-follow + tell Scoreboard which team THIS pane is on.
  if (root.locallyCreated) {
    this.createEvent("UpdateEvent").bind(() => this.followCamera())
    Scoreboard.instance?.setLocalTeam(team)
  }
}
```

**Sync verification**: every device sees the same `dataStore.getString("displayName")` value (set once by the spawner, replicated as part of prefab instantiation). Every device computes the same team color from the same sorted **connection set** (built via a `presence` handshake so late joiners converge; `getUsers()` sorted by `connectionId` works too) against the same `ownerInfo.connectionId`. No StorageProperty round-trip, no thrash.

Full files: `resources/scripts/NameTagSpawner.ts` + `resources/scripts/NameTagController.ts`. **Caveat**: parity-based team assignment is still fragile under player *churn* (leaves/rejoins) — see §10. Team = the owner's index in a sorted set of connections; it recomputes as peers arrive, so the first joiner's tag (initially alone → index 0) gets corrected once the peer joins. The recipe builds that set via a `presence` networked-event handshake so late / staggered joiners reliably discover each other (`sendEvent` doesn't replay history — §6.7); `getUsers()` sorted by `connectionId` is equally valid now that it reports the live count. **Caveat**: this recipe intentionally avoids `forTextText` / `autoVec4` on the shared SyncEntity — those properties poll & broadcast from every device, and an unowned shared entity has no single writer. If you DO need mutable post-spawn text, use the ownership-claimed pattern in §10 and `Examples/StorageProperty/TextStoragePropertyExample.ts`.

### §6.3 — Host-only spawn (e.g., coins, level layout)

**What "host" means**: `SessionController.isHost()` returns `true` for exactly one user per session (typically the first joiner who completed mapping). Consistent across all devices. Use when exactly one user should run a privileged action: initial layout, spawning shared props, arbitrating turns, seeding game state.

```typescript
this.instantiator.notifyOnReady(() => {
  // `=== true` (not truthy) — isHost() returns boolean | null;
  // null during the race window before host is determined.
  if (SessionController.getInstance().isHost() !== true) return
  for (let i = 0; i < N; i++) {
    this.instantiator.instantiate(this.prefab, {
      claimOwnership: true,
      persistence: "Session",
      worldPosition: randomPos(),
    })
  }
})
```

Full file: `resources/scripts/HostOnlySpawner.ts`.

**Composing with cooperative grab (Instantiator + ManipulatablePiece)**: if the spawned prefab is meant to be grabbed and moved by users, the **prefab asset itself** must include all SIK interaction components — `Interactable`, `InteractableManipulation`, plus `ManipulatablePiece` (or your own derived controller) — alongside the `SyncTransform`. Attaching those scripts to a sibling scene object you build separately won't work: Instantiator only replicates the prefab's components to peer devices, so spawned instances on other clients will have RenderMeshVisual + SyncTransform but no interaction layer, and even the host's local instance only "works" because the controller happens to sit beside it locally. Build the BlockPrefab / DraggablePrefab once, with the full ManipulatablePiece prefab requirement list (see the §7 ManipulatablePiece recipe), and reference it from the Instantiator's Prefabs array. Distinguish active vs decorative variants by passing `customDataStore.role` at instantiate time and reading it on the prefab's controller in `notifyOnReady`. **Common gotchas that block this composition** — see §10: collider shape must match the visual mesh; never use `setCanTranslate(false)` to gate grab (it blocks SIK's Idle→Active state machine); for turn-based or per-player restriction, toggle `Interactable.enabled` per frame, not `setCanTranslate`.

### §6.4 — Per-player spawn (each device gets its own)

Every device runs `instantiate()` once after the chained readiness. Components inside the spawned prefab gate per-player vs observer logic with `doIOwnStore()`.

```typescript
SessionController.getInstance().notifyOnReady(() => {
  this.instantiator.notifyOnReady(() => {
    if (this.hasInstantiated) return
    this.hasInstantiated = true
    this.instantiator.instantiate(this.prefab, {
      claimOwnership: true,
      persistence: "Owner",
    })
  })
})
```

Full file: `resources/scripts/PerPlayerSpawner.ts`.

### §6.5 — Scoreboard (host-arbitrated two-team)

One SyncEntity, two `manualInt` props, `claimOwnership: true` (first joiner becomes the writer). Any device can call `addScore(team, n)`. Owner applies directly; non-owners route through `sendEvent` to the owner. `onAnyChange` repaints text on every device including the writer.

```typescript
const RED = new vec4(1.0, 0.35, 0.35, 1)
const BLUE = new vec4(0.3, 0.55, 1.0, 1)

private readonly redScoreProp = StorageProperty.manualInt("redScore", 0)
private readonly blueScoreProp = StorageProperty.manualInt("blueScore", 0)
private readonly syncEntity = new SyncEntity(this,
  new StoragePropertySet([this.redScoreProp, this.blueScoreProp]),
  true, "Session")

onAwake(): void {
  if (this.redText) this.redText.textFill.color = RED
  if (this.blueText) this.blueText.textFill.color = BLUE
  // ... event subscriptions ...
}

public addScore(team: string, delta: number): void {
  if (this.syncEntity.doIOwnStore()) {
    this.applyAddScore(team, delta)
  } else {
    this.syncEntity.sendEvent("addPoint", {team, delta})
  }
}
// Owner-only handler — note `msg: {data?: unknown}` to match the
// SyncEntity callback's NetworkMessage<unknown> contract, then cast
// inside after runtime validation:
this.syncEntity.onEventReceived.add("addPoint", (msg: {data?: unknown}) => {
  if (!this.syncEntity.doIOwnStore()) return
  const data = msg.data as {team: string; delta: number} | undefined
  if (!data || typeof data.team !== "string") return
  this.applyAddScore(data.team, data.delta ?? 1)
})
this.redScoreProp.onAnyChange.add(v => this.redText.text = "Red: " + v)
```

Full file: `resources/scripts/Scoreboard.ts`.

### §6.6 — Collectible (claim-and-destroy pickup)

On pinch, `tryClaimOwnership` serializes destruction through one device — simultaneous claims, only the first succeeds. The losing claim's callback never fires, so destroy runs exactly once.

```typescript
private readonly syncEntity = new SyncEntity(this, null, false)
private static readonly DETACH_EVENT = "detach-before-destroy"

onAwake(): void {
  this.syncEntity.notifyOnReady(() => {
    this.interactable.onTriggerStart.add(() => this.onLocalPinch())
    // Every device detaches its local leaf when the picker broadcasts.
    this.syncEntity.onEventReceived.add(DETACH_EVENT, () => {
      if (this.sceneObject.hasParent()) this.sceneObject.removeParent()
    })
  })
}

private onLocalPinch(): void {
  this.syncEntity.tryClaimOwnership(() => {
    Scoreboard.instance?.addScore(myTeam, 1)
    this.syncEntity.sendEvent(DETACH_EVENT, {})        // ← suppress reparent warning
    const delay = this.createEvent("DelayedCallbackEvent")
    delay.bind(() => this.syncEntity.destroy())
    delay.reset(0.1)            // let the score event + detach event land first
  })
}
```

**Prefab requirements**: RenderMeshVisual, SIK `Interactable`, `Physics.ColliderComponent` (Box or Sphere — REQUIRED for the pinch raycast; without it `onTriggerStart` never fires), this script.

**Do NOT add `SyncTransform` to the collectible prefab.** The spawner's `worldPosition` already replicates the spawn position, and collectibles don't move after spawn. Adding `SyncTransform` puts a second SyncEntity on the same SceneObject, which conflicts with this script's SyncEntity and silently breaks `tryClaimOwnership`.

**Suppress the host-side `Cannot reparent...` warning on destroy.** Before `syncEntity.destroy()`, broadcast a `sendEvent` (e.g., `"detach-before-destroy"`) and have every device's subscription run `this.sceneObject.removeParent()` on its local leaf. Without this, the host's `NetworkRootInfo.finishSetup` child-OnDestroy handler (bound only when `canIModifyStore()` is true — i.e., on the spawner, since `Instantiator.instantiate({claimOwnership: true, ...})` claims the NetworkRoot) calls `child.removeParent()` on a mid-destroy child during the remote-destroy cascade and logs the warning. The 0.1s `DelayedCallbackEvent` before `destroy()` covers both the score-sync window and the detach event propagation.

Full file: `resources/scripts/Collectible.ts`.

### §6.7 — Networked events / RPC

**Before reaching for `sendEvent`, check whether what you're broadcasting is *state* or *signal* — see the §8 StorageProperty-vs-sendEvent decision table.** Durable "the world looks like X right now" (positions, scores, game-state strings, UI toggles) is **state** → `StorageProperty` (§6.5 Scoreboard is the canonical pattern). `sendEvent` is for one-shot **signals** with no persistent meaning a second later (SFX cues, particle bursts, gesture reactions, damage routing). `sendEvent` in a loop or on a timer is the smell — switch to StorageProperty. See the §10 pitfall *"Prefer `StorageProperty.manualString` over `sendEvent`"* for the empirical 1024-byte cap on `sendEvent` data that catches loop-style usage.

`syncEntity.sendEvent(name, data?, remoteOnly?)` + `syncEntity.onEventReceived.add(name, cb)`. The callback receives a `MessageInfo` with `senderConnectionId`, `senderUserId`, `message` (event name), and `data` (payload).

**Events are scoped to ONE SyncEntity** (matched by its network id). A `sendEvent` on entity A is delivered only to `onEventReceived` listeners on entity A — the *same* entity, on every pane. It is NOT received by other SyncEntities or other scripts, and it is NOT a global by-name bus. So "broadcast" means "every pane's copy of *this* entity fires," not "every listener everywhere with this event name." **To signal between different scripts/entities** — e.g. a bullet manager telling a target cube it was hit — route through ONE shared entity (`NetworkEventBus`, this section's recipe) or send on the entity the receiver already listens to. And per the state-vs-signal rule above: durable state (a destroyed cube, a claimed slot) belongs in a `StorageProperty` the receiver watches, not a one-shot event — late joiners don't replay events.

Use for one-shot signals: SFX cues, particle bursts, "high five" gesture reactions, damage events. Payload must be JSON-serializable (rate/size limits in §10).

**Targeting idioms** (both supported by the same primitive):

- **Broadcast** (default): `sendEvent("highFive")` — every device's listener **on this same SyncEntity** fires (including self, **synchronously** — see the self-delivery callout below). A listener on a *different* entity hears nothing (same scoping rule as above — not a global bus).
- **Remote-only**: `sendEvent("damage", payload, true)` — every device except self fires the listener.
- **Targeted**: include `target: connectionId` in the payload and have listeners filter `data.target === SessionController.getLocalConnectionId()`. Used for damage routing, "kick from team", per-player notifications.

**⚠️ `sendEvent` self-delivery is synchronous and re-entrant.** A default broadcast (no `onlySendRemote`) fires this entity's *local* `onEventReceived(name)` listeners **in the same call stack** — `SyncEntity.sendEvent → messaging.sendMessage → _dispatchMessageEvents` runs the local handlers before `sendEvent` returns. Only *remote* peers are delivered async via the session. Consequence: **calling `sendEvent(name, …)` from inside the `onEventReceived(name, …)` handler for the same event re-enters immediately and stack-overflows** — `RangeError: Maximum call stack size exceeded` — unless a terminating guard short-circuits the synchronous self-echo. This is the #1 cause of a presence/announce handshake crashing on session start. **Safe re-broadcast (the late-joiner announce pattern):** add your own id to the dedup `Set` *before* the first broadcast, and `return` early when the received id is already in the Set — so your own synchronous echo dedups out instead of recursing. (Or re-announce with `onlySendRemote=true` so it never re-enters your local handler.) See `resources/scripts/TurnTakingGame.ts` (`onReady` adds self → broadcasts; `onPresenceReceived` dedup-guards → re-broadcasts) for the reference ordering.

Full file: `resources/scripts/NetworkEventBus.ts`. Deep dive: `resources/docs/networked-events.mdx`.

## §7 — Composite & extended recipes

Each recipe is a complete file under `resources/scripts/` — they're too long or too specialized to inline. Organized by pattern category, not by alphabet — find your shape, then open the file.

**Spawning & lifecycle.** When each player needs a visible body that follows their own head and other players see it move, use `PlayerAvatarSpawner.ts` + `PlayerAvatarController.ts` — the owner runs an `UpdateEvent` lerping toward `WorldCameraFinderProvider`, peers receive position via `SyncTransform`. For short-lived per-event objects (laser-pointer dots, gunshot puffs, ping markers, reaction emojis) use `TransientSpawner.ts` + `TransientController.ts` — the owner drives a fade and calls `syncEntity.destroy()`, `persistence: "Owner"` cleans up if the user disconnects mid-fade. For on-demand spawn of objects that should OUTLIVE the spawning device's disconnect (dispenser bins handing out game pieces, dropped pickups, placed turrets, inventory items meant to stay in the world) use `PersistentSpawner.ts` — same shape as TransientSpawner but `persistence: "Session"`, with an optional per-spawn `customDataStore` config (one-shot prefab data — color index, prefab variant, initial state) read by the prefab's controller in `notifyOnReady`. **Pick by lifetime, not by triggering source:** "Owner" = "disappear when I leave"; "Session" = "stay in the world until destroyed or session ends." For a richer name-tag pattern with status / availability / ping-pip props bundled in a `StoragePropertySet`, see `MultiStatePlayerLabel.ts` — pair with `NameTagSpawner.ts` to instantiate it.

**Shared state & coordination.** For turn-taking games (tic-tac-toe shape), `TurnTakingGame.ts` serializes the grid as a single `manualString`, assigns X/O via a `presence`-event handshake at `notifyOnReady` (so late / staggered joiners discover each other and roles recompute as peers arrive — see §6.7; `getUsers()` sorted by `connectionId` also works), uses `sendEvent("start" | "restart")` for flow control, and keeps per-symbol `manualInt` scores — win detection runs in `onAnyChange`. **It renders turn/winner/score TEXT only — it does NOT draw the X/O marks on the board cells** (it's a controller). To show the board, extend it with an `@input cellTexts: Text[]` (one per cell) and set `cellTexts[i].text` from `grid[i]` inside `onGridChanged`; otherwise the grid syncs perfectly across panes but the board looks empty — a common "sync is broken" false alarm. **When to use `TurnTakingGame`'s internal scores vs `Scoreboard.ts`:** `TurnTakingGame.xScore` / `oScore` track symbol-based wins (X vs O) inside the same SyncEntity as the grid — use these for symbol-vs-symbol games. `Scoreboard.ts` is a standalone two-team board (red / blue) consumed by `Collectible.ts` and other team-based patterns. Pick one model per Lens; mixing both leaves two divergent score sources. For UIKit controls (sliders, text inputs, button labels) shared across all users with no ownership arbitration, `UIKitSharedControls.ts` uses `GeneralDataStore` directly with first-vs-joining seeding and echo-prevention counter guards. For per-connection broadcasts (each user publishes their own slice — hand poses, cursor positions — keyed by `connectionId`) use `HandSyncBroadcast.ts` and filter self-echoes via `updateInfo.updaterInfo.connectionId`; late joiners must call `readAll(suffix)` once on join to pick up existing slices. For countdowns that don't drift across devices, `SyncedTimer.ts` stores `endsAtServerSeconds` on a single owned SyncEntity; the owner computes remaining time locally from `SessionController.getServerTimeInSeconds()`, then broadcasts it via a rate-limited `broadcastRemaining` manualFloat. Non-owners read the broadcast value directly — this keeps the displayed remaining consistent across Lens Studio Preview panes, where `getServerTimeInSeconds()` falls back to each pane's local clock and the naive recompute would drift (see §10 server-time pitfall). For host-arbitrated turn rotation that needs to handle late joiners, subscribe to `SessionController.onUserJoinedSession` and append the new connectionId to the player list — never freeze it at startup (see §10 player-list pitfall).

**Peer-to-peer events.** When the original sender needs to know whether the target acknowledged ("are you there?", "join my team?", "wave back"), use `PingResponse.ts` — dual-event handshake: send `ping_request` with `target: connectionId`, target filters on `data.target === localConnectionId` and replies with `ping_response` filtered back by `MessageInfo.senderConnectionId`. For one-way targeted messages (damage routing, notifications), use the broadcast-with-target-filter idiom from `NetworkEventBus.ts` directly.

**Player identity & coloring.** `PlayerColorAssigner.ts` hashes `connectionId` modulo a fixed palette — stable per-player coloring with no coordination needed. `TeamPalette.ts` is for slot-indexed coloring when you've already decided team assignment (sorted-userId slot, host-assigned, etc.). `BitmojiLookup.ts` wraps `session.getSnapchatUser(userInfo, cb)` — returns null in singleplayer / mocked mode.

**Manipulation & material.** `ManipulatablePiece.ts` is a movable game piece: SyncTransform replicates position, SIK `Manipulatable` handles the drag, and ownership is gated **at the handler level** (`onManipulationStart` calls `requestOwnership`, `onManipulationEnd` calls `tryRevokeOwnership`) — `setCanTranslate` stays `true` forever, never used as a disable knob. Calling `setCanTranslate(false)` blocks SIK's Idle→Active transition and cooperative grab can't bootstrap — full failure mode in §10 "setCanTranslate(false) blocks SIK's Idle→Active". For per-player or per-turn gating (e.g. only the current-turn player can grab), toggle the sibling `Interactable.enabled` per frame. `SnapToSlotPiece.ts` extends `ManipulatablePiece` with slot-locking semantics — for draggable pieces that should lock into one of N discrete target slots on release (Lego-like building, jigsaw puzzles, Sokoban-style placement, inventory grid). Adds a `slotIndex` `manualInt` StorageProperty (-1 = free, ≥0 = placed), a release-time snap search via caller-supplied `findNearestTarget` callback, per-frame `Interactable.enabled = !isPlaced` gate so placed pieces can't be re-grabbed, and an owner-gated hover preview hook (override `updateHoverPreview()` for visual feedback during drag — MUST stay owner-only; see §10 "Local UX cues must be doIOwnStore-gated"). The recipe's key insight: it uses the discrete `slotIndex` StorageProperty as the **authoritative position source** rather than relying on SyncTransform alone — every device locally moves the piece to the slot's world position when `slotIndex` changes (via `onAnyChange`), bypassing the SyncTransform-vs-ownership-handoff race at commit time. See §10 "Slot-anchored position bypasses the SyncTransform race at snap commit." `MaterialColorSync.ts` syncs a `RenderMeshVisual`'s base color via `StorageProperty.forMeshVisualBaseColor` — owner writes the color, peers' setter applies it automatically; pass `clone: true` if multiple SceneObjects share the same source material.

**Helpers as building blocks.** `SetEnabledIfOwner` (from `resources/docs/helper-scripts.mdx`) toggles whole SceneObjects based on ownership — useful for showing owner-only edit affordances on a `MultiStatePlayerLabel`. `DisplayStorageProperty` binds a property's value to a Text component without custom binding code — drop-in replacement for the `onAnyChange` repaint pattern in `Scoreboard.ts`.

## §8 — Decision tables

**SyncEntity vs RealtimeStore:**

| Use case | SyncEntity (StorageProperty) | RealtimeStore (GeneralDataStore) |
|---|---|---|
| Owned authoritative state (scores, turn order, game grid) | ✅ | clunky |
| Free-for-all unowned shared state (UI sliders, per-user hand poses) | clunky | ✅ |
| Per-user data keyed by `connectionId` | clunky | ✅ |
| Typed accessors (int, float, string, bool, vec, quat) | ✅ | manual `putString` / `putFloat` |
| Ownership semantics (turn-taking, pickups) | ✅ | ✘ |

**Transform sync — which mechanism?**

| Use case | SyncTransform component | `StorageProperty.forPosition` / `forRotation` | `manualVec3` / `manualQuat` |
|---|---|---|---|
| One device drives, others passively follow | ✅ **canonical** | ✘ over-engineered | ✘ over-engineered |
| Grabbable / draggable with ownership transfer | ✅ + §7 ManipulatablePiece | ✘ | ✘ |
| Selective axes (sync X only, not Y/Z) | ✘ no per-axis config | ✅ | ✅ |
| Conditional sync (only when flag is true) | ✘ | ✅ | ✅ |
| Many entities, position-only, host-authoritative simulation | ✘ per-entity overhead | ✘ | ✅ as single broadcast snapshot — see §10 data-shape ladder |
| Runtime tweakable sync rate / smoothing | ✘ Inspector-only | partial — `sendsPerSecondLimit` is runtime-settable | ✅ |

**Rule of thumb**: start with SyncTransform. If your case isn't in the right two columns, you want SyncTransform — even when it feels like you "need" more control.

**StorageProperty vs sendEvent (broadcasting to peers):**

| Use case | StorageProperty | sendEvent |
|---|---|---|
| Continuous state (positions, scores, game grid, UI toggles) | ✅ | wrong tool |
| Late-joiner sees current condition | ✅ replicates | ✘ no replay |
| One-shot signal (SFX cue, particle burst, gesture reaction) | clunky | ✅ |
| Targeted message (damage to one player, ping reply) | clunky | ✅ + filter target |
| Per-frame entity snapshot (10Hz position broadcast) | ✅ + `sendsPerSecondLimit` | ✘ 1024B cap |
| Payload > ~1KB | ✅ (~100KB cap) | ✘ silently dropped |

**Ownership APIs:**

| Scenario | API |
|---|---|
| First joiner claims at construction | `claimOwnership: true` in SyncEntity constructor |
| Cooperative handoff (another player lets me move their piece) | `requestOwnership(onSuccess, onError)` |
| Competitive grab (first to pick up wins) | `tryClaimOwnership(onSuccess, onError)` |
| Release | `tryRevokeOwnership(onSuccess?, onError?)` |
| Privileged session-wide action | `SessionController.isHost() === true` |
| "Did I spawn this entity?" | `syncEntity.networkRoot.locallyCreated` |
| "Can I write to this entity's storage right now?" | `syncEntity.doIOwnStore()` / `canIModifyStore()` |
| "Am I the device actively driving / interacting with this entity (e.g. should I run local UX cues — halo, drag preview, snap-target highlight — for it)?" | `syncEntity.doIOwnStore()` (same call, broader semantic — see §10 "Local UX cues must be doIOwnStore-gated") |

**Picking the gate for an *interactive* object — and the anti-pattern that broke a real Lens:**
- **Host-only, session-wide content → `isHost()`.** One host spawns the shared world (a coin-hunter host generating all 50 coins), seeds the layout, arbitrates turns; peers don't each spawn it. Canonical recipe: §6.3 / `HostOnlySpawner.ts`. (Choosing `isHost()` vs `doIOwnStore()` for *writes / authority* is covered by §10's "Host gating" pitfall.)
- **An object each player controls (their own draggable pouch / paddle / cursor / piece) → that object IS the owned entity.** Per-player-spawn it (§6.4) with `claimOwnership: true` (or give it a `claimOwnership: true` SyncEntity), and gate its `Interactable.enabled` (and its writes) on **its own** `doIOwnStore()`.
- **Anti-pattern — never gate object A's interactivity on object B's claimed ownership.** A real failure this skill now guards against: a player's slingshot was made draggable based on whether they'd claimed a *separate* tower, routed through name-matching + a mirrored `ownerConn` StorageProperty — a chain of indirections that each broke independently (wrong-instance lookups, dropped / late StorageProperty, phase coupling). Make the controlled object **be** the owned entity and gate it on its own ownership, not another object's.

## §9 — Cross-references to other skills

specs-sync-kit teaches the network plumbing. Visuals come from the visual-authoring skills.

| Need | Skill | Iteration semantics |
|---|---|---|
| Buttons, Text styling, Frames, Slider, ScrollWindow, FlexLayout / GridLayout | `ls-clad:specs-build-ui` | Re-invoke regenerates `.ts` (triggers recompile) |
| Material Icon textures | `ls-clad:icon-selector` | Overwrites on re-invoke |
| Figma-sourced images (one-shot dev-mode import) | Not active in `ls-clad`; import manually or use project-specific asset tooling | Per-asset import |
| Procedural 3D meshes (GLB) | `ls-clad:build-mesh` | Overwrites on re-invoke |
| Procedural sound effects | `ls-clad:build-sfx` | Overwrites on re-invoke |
| Hand-gesture interactions (swipe, pinch-throw, spring-grab) | `ls-clad:specs-interaction-recipes` | n/a |
| TypeScript / `@input` / scripting conventions | `ls-clad:lens-api` | n/a |
| Lifecycle decorators (`@bindStartEvent`, `@bindUpdateEvent`) | Not active in `ls-clad`; use plain Lens API event binding patterns from `ls-clad:lens-api` | n/a |
| Bumping bundled UIKit / SIK to current | `ls-clad:update-lens-packages` | Updates package versions in place |
| Custom shaders (glass, refraction, outline, glow) | _Not covered — hand-authored `.mat` asset_ | n/a |

## §10 — Common pitfalls

**Lens Studio Preview ≠ real hardware — quick decoder** (before "fixing" flaky multiplayer behavior, check whether it's a simulator artifact; reset both panes between runs):

| Symptom in two-pane Preview | Real bug? | What's happening / where |
|---|---|---|
| `isHost()` wrong, or both panes think they're host | No — testing flow | `MULTIPLAYER` auto-rejoins a sticky session on single-pane refresh. Use `START_MENU` + reset both panes. (isHost pitfall below.) |
| State / ownership "leaks" across runs | No | Sticky two-pane session — reset both panes together. (startMode pitfall.) |
| Countdown drifts between panes | No | `getServerTimeInSeconds()` is per-pane local in mock. Owner broadcasts the value. (server-time pitfall.) |
| "Host requires authentication" warning | No | Expected OAuth fallback to the mocked session. Ignore in Preview. (warning pitfall.) |

All of the above are reliable on real Specs hardware; the fixes are testing-flow, not code.

- **Bogus API names** — `manualNumber` / `autoOrWorldPosition` / `instantiator.destroyAll()` don't exist. Correct: `manualInt` / `manualFloat` / `manualDouble`, `forPosition(transform, PropertyType.Location)`, and `syncEntity.destroy()` (per-entity).
- **`StorageProperty<string>` doesn't compile** in SyncKit v1.3.6064068+. Use `StorageProperty<StorageTypes.string>`.
- **`setPendingValue` from a non-owner is silently dropped.** Check `doIOwnStore()` first, or route writes through `sendEvent` to the owner (see §6.5 Scoreboard).
- **`currentValue` is `null` for a joining user inside `notifyOnReady`** — the value hasn't replicated yet. Use `currentOrPendingValue`.
- **Two SyncEntities on one SceneObject conflict** — e.g., `new SyncEntity(this)` plus a sibling `SyncTransform` component. `tryClaimOwnership` targets the wrong store and silently fails. Place separate concerns on separate SceneObjects, or use the SyncTransform's own SyncEntity (see `ManipulatablePiece.ts`).
- **`StorageProperty.forTextText` (and any `auto*` StorageProperty) requires a SyncEntity with a clear owner.** Auto properties poll their getter every tick and broadcast whenever the value diverges from `currentValue` (`StorageProperty.ts:261-321`) — if no device owns the store, every device broadcasts and last-write-wins thrashes (Device A's "Alice" gets clobbered by Device B's prefab-default "Player"). The canonical pattern is `Examples/StorageProperty/TextStoragePropertyExample.ts`: construct the SyncEntity with `claimOwnership: true`, gate writes on `doIOwnStore()`, and only the owner mutates the underlying `Text.text`. If you need to attach a `forTextText` to a *shared* prefab leaf whose SyncEntity is already owned by another component (e.g., `SyncTransform`'s `claimOwnership:false` entity), DON'T — prefer one-shot `customDataStore` on the NetworkRoot (see §6.2 for the working pattern), or put the text-sync component on a *separate child SceneObject* with its own claimed SyncEntity (mind the "two SyncEntities on one SceneObject" caveat — they must be on different SceneObjects).
- **`Instantiator.instantiate(undefined, opts)` crashes the Instantiator** at `Components/Instantiator.ts` with `TypeError: undefined is not a function`. Caused by an unwired `@input ObjectPrefab`. Two rules: (a) avoid `@input ObjectPrefab` on a spawner script when the prefab is the only Inspector wiring on that SceneObject — use `requireAsset("PrefabName")` instead (asset must live at `Assets/Resources/<PrefabName>.prefab`). (b) `@input ObjectPrefab` is fine when the same SceneObject also has an Instantiator component whose `Prefabs` array references the same prefab — both wirings live in the same Inspector pane, so forgetting one means forgetting the other (visible failure, not silent).
- **Sibling-component lookups inside `onAwake` may return `null`.** Awake order between sibling components is undefined. Defer to `createEvent("OnStartEvent")` for `getComponent(SyncTransform.getTypeName())` etc. The same risk applies to **cross-singleton `.instance` lookups inside `notifyOnReady` chains** — on the host, `SessionController.notifyOnReady` and an owned `syncEntity.notifyOnReady` (`claimOwnership: true`) can both fire synchronously inside `onAwake`, before sibling singletons (`NetworkEventBus.instance`, `SyncedTimer.instance`, etc.) have run their own `onAwake`. Symptom: a controller wired through `SessionController.notifyOnReady(() => syncEntity.notifyOnReady(() => bindStuff()))` finds `OtherSingleton.instance === null` and aborts. **Fix:** wrap the entire notifyOnReady chain inside `createEvent("OnStartEvent").bind(...)` so the chain only starts after every component's `onAwake` has fired.
- **Forgetting to disable the bundled `Examples` SceneObject** (§2 step 4) — bundled sample content renders on top of your scene at session-ready.
- **Custom objects placed outside `Colocated World / EnableOnReady` get deleted on prefab revert** during package updates (verbatim warning in `resources/docs/release-notes.mdx`). Keep custom content under `Colocated World / EnableOnReady`.
- **Late joiners miss `sendEvent` history but DO receive current StorageProperty values.** Realtime Store snapshots replicate to joiners, so scores and game state are immediately visible. Events are NOT replayed. Use StorageProperty for state joiners must see; use events for one-shot signals only.
- **Calling `Instantiator.instantiate` before `instantiator.notifyOnReady`** — silently no-ops. Always wrap.
- **`Physics.BodyComponent` is NOT a substitute for `Physics.ColliderComponent` on SIK-grabbable prefabs.** Both expose a collision shape, but SIK's Interactable raycast targets `ColliderComponent` specifically — a body-only object silently fails to register as a pinch target, so `onTriggerStart` / `onManipulationStart` never fire and the block "can't be moved" with no error in the logs. The trap is `BoxPhysicsObjectPreset` (and the other `*PhysicsObjectPreset` presets): they ship a `BodyComponent` with the right shape, so they *look* correct in the Inspector but break interaction. Use `BoxMeshObjectPreset` (mesh visual only) + a manually-added `ColliderComponent` with the matching shape type, or — if you need a physics body too — add the `ColliderComponent` **alongside** the body. The Collectible and ManipulatablePiece recipe headers both call out `Physics.ColliderComponent` explicitly; treat that requirement as load-bearing, not advisory.
- **The `ColliderComponent.shape` type must match the visual mesh — Sphere on a Box visual silently misses pinches.** The Collectible and ManipulatablePiece recipe text says "Box or Sphere" — that's the API surface, not the empirical guidance. In Lens Studio 5.21 + SIK 0.18.0 a freshly-added `ColliderComponent` defaults to `shape: Sphere` with `fitVisual: true`; on a Box mesh the resulting bounding sphere doesn't cover the cube's corners, and the SIK pinch raycast frequently misses ("no hover, no drag, no errors"). Always set `shape.type = Box` explicitly when the visual is a Box mesh; use `Sphere` only when the visual is itself a sphere. `setProperty` on `shape.type` via scene-graphql is read-only in the current Lens Studio, so the practical escape hatch is to YAML-edit the prefab's `Shape: !<Sphere>` block to `Shape: !<Box>` with `Size: {x:1, y:1, z:1}` and let Lens Studio's file watcher reimport.
- **`setCanTranslate(false)` blocks SIK's Idle→Active state transition; cooperative grab cannot bootstrap.** `InteractableManipulation.hasActiveCapabilities()` is `enabled && (canTranslate() || canRotate() || canScale())`. Pre-grab there are 0 triggering interactors, so `canRotate()` and `canScale()` both return false (they require ≥1 interactor; `canRotate` requires 2 or Direct-targeting; `canScale` requires 2). The capability set collapses to `enabled && canTranslate()`. If you call `setCanTranslate(false)`, the Idle→Active transition is gated off and `onManipulationStart` never fires — the cooperative-grab handoff that should call `requestOwnership` never gets a chance to start. The ManipulatablePiece recipe's older `setDraggable(doIOwnStore())` pattern hit this bug when the SyncEntity started unowned (e.g., Instantiator spawn with `claimOwnership:false`, or SyncTransform's default `claimOwnership:false`). **Fix:** leave `setCanTranslate(true)` always; gate ownership at the handler level (`onManipulationStart` checks `doIOwnStore()` before deciding to `requestOwnership`; `onManipulationEnd` calls `tryRevokeOwnership` only if owned). The §7 ManipulatablePiece recipe was updated to this pattern after live testing.
- **`Interactable.enabled` and `setCanTranslate` are independent gates — use them for different purposes.** `setCanTranslate` controls SIK's manipulation capability and is part of the Idle→Active gate above (so disabling it triggers the chicken-and-egg). `Interactable.enabled` is the raycast-level gate: when false, SIK's pinch raycast skips the object entirely (no hover, no `onManipulationStart`). For per-turn or per-player gating where you want to prevent BOTH hovering and dragging on disallowed devices (e.g., turn-based games — only the current-turn player can interact), poll `this.interactable.enabled = isMyTurn()` each frame. That blocks the raycast on off-turn devices without affecting capability bits, so the chicken-and-egg is avoided. Never reach for `setCanTranslate(false)` as a "disable interaction" knob — it has the wrong semantics for that use case.
- **`SessionController.getServerTimeInSeconds()` is not consistent across Lens Studio Preview panes in mocked multiplayer.** Each pane uses its own local clock as the server-time stand-in, so timing-sensitive logic that relies on `getServerTimeInSeconds()` as a *sync anchor* (e.g., a `endsAt - now` timer computation done independently on each device) drifts between panes — different panes display different remaining values for the same shared deadline. On real Specs hardware with a real Connected Lens server, the clock IS consistent and these recipes work as-is. To make timer-style recipes work in Preview testing too, have the owner broadcast the canonical value via a `manualFloat` StorageProperty (with `sendsPerSecondLimit` set, ~4/sec is plenty for HUD display) and have non-owners read it directly instead of recomputing locally. The §7 SyncedTimer recipe was updated to this pattern after live testing.
- **Don't freeze the player list at host startup — subscribe to `onUserJoinedSession` and append late joiners.** If you snapshot `SessionController.getUsers()` once at the host's `onSyncReady` (a common turn-rotation pattern: cache a sorted connectionId list, use `turnIndex % cachedList.length`), only the users connected at that exact moment will be in the rotation. Late-joining users get silently dropped — the host's snapshot doesn't update, so their `connectionId` is never assignable to a turn. **Fix:** register `SessionController.getInstance().onUserJoinedSession.add(() => …)` on the host's `onSyncReady`, and on each join, re-scan `getUsers()` and **append** (don't re-sort) any unseen connectionIds to the list, then `setPendingValue` the JSON-encoded list back to the shared StorageProperty. Append preserves the rotation order for already-mid-game players — re-sorting would shift turn indices mid-game and produce wrong-player turns. The §6.2 NameTagController.applyTeamFromCurrentUsers uses the same `onUserJoinedSession` pattern for team color reassignment.
- **`SyncTransform` with `Position/Rotation = Location` requires the spawned object's parent chain to include the `LocatedAtComponent`.** The `LocatedAtComponent` ships on `ColocatedWorld [CONFIGURE_ME]` inside the SyncKit prefab. `getLocationTransform` (`SpectaclesSyncKit.lspkg/Core/StorageProperty.ts`) walks the spawned SceneObject's parents looking for it; if the spawn lands outside `ColocatedWorld`'s subtree the call throws `Could not find LocatedAtComponent for Location sync'd object <PrefabName>` at SyncTransform's `__initialize`, immediately inside `Instantiator.instantiate`. The default `Instantiator` config (`Spawn As Children: false`, `Spawn Under Parent: null`) puts spawned prefabs at scene root — outside `ColocatedWorld` — so any Location-mode SyncTransform on the prefab crashes the first time it spawns. Fix: on the spawner SceneObject's `Instantiator`, set `Spawn As Children: true` AND wire `Spawn Under Parent` to the spawner SceneObject (or any ancestor under `Colocated World [CONFIGURE_ME]`). Setting `Spawn As Children: true` *without* wiring `Spawn Under Parent` throws a different error first: `Input spawnUnderParent was not provided for the object <SpawnerName>` (from the Instantiator's generated `_c.js` `@input` validator). Both inputs must be wired together. The §6.2 Name tag recipe is the canonical example; §6.3 Host-only-spawn doesn't need this only because its prefab (e.g. CoinPrefab) has no SyncTransform — but if you add Location-mode sync to any spawned prefab, the same Instantiator config applies.
- **Forgetting `addStorageProperty(prop)`** — declaring `StorageProperty.manualInt(...)` doesn't sync it. Either call `addStorageProperty` per prop, or pass a `StoragePropertySet` to the SyncEntity constructor.
- **Rate-limit exceedance** — 100 KB per message, 350 messages per 5-second window per session. Use `prop.sendsPerSecondLimit = N` on chatty properties; batch transient events.
- **`SyncTransform` settings can't change at runtime** — once initialized, it runs with its Inspector config. For runtime-controllable transform sync, hand-roll with `StorageProperty.forPosition` (see §6.1 manual variant).
- **No per-user private state in SyncKit.** All Realtime Store data — StorageProperty values AND GeneralDataStore keys — is visible to every connected client. There is no built-in encryption or per-user gating. Hidden-information games (poker hands, hidden roles in werewolf, secret choices in rock-paper-scissors before reveal) need to keep that state local and only sync the *visible* outcomes.
- **Team assignment by `getUsers().length` parity is fragile under player churn.** Example: A joins (count=1 → red), B joins (count=2 → blue), C joins (count=3 → red). B leaves → count=2. D joins (count=3 → red). Result: 3 red, 0 blue. For balanced teams, route assignment through a host-owned "team registry" SyncEntity (one `manualString` per slot, host fills the first empty slot on `onUserJoinedSession`).
- **`Persist` persistence mode is not supported on Specs.** SyncEntities can't survive past the last user leaving the session. Use `"Session"` (default) or `"Owner"` (auto-destroy when owner leaves). There's no cross-session persistence today.
- **RealtimeStore is last-write-wins per key** — `store.putString("foo", "A")` then `store.putString("foo", "B")` → only "B" replicates. For append-only patterns (chat history, stroke segments), use one SyncEntity per item via Instantiator, OR maintain a JSON-array `manualString` prop owned by one device and route appends through `sendEvent` to that owner.
- **Prefer `StorageProperty.manualString` over `sendEvent` for anything that resembles broadcast/state — `sendEvent` data has a ~1024-byte ceiling and oversized messages are silently discarded.** Reach for `sendEvent` only for true fire-and-forget signals (SFX cue, particle burst, "high five" reaction) where a late joiner genuinely shouldn't replay it. Symptom when you cross the line: log line *"Message at path 'CamPlat.LensCore.Scn.Multiplayer.Session' with format string 'String match data received: %s' was discarded due to overly large arguments size: <N> bytes (limit: 1024)"*, and peers never receive the event even though `sendEvent` itself doesn't throw. Cause: the runtime serializes `sendEvent` data through a debug-printable argument channel with a tighter cap than StorageProperty's transport. Fix: register a `StorageProperty.manualString` on the SyncEntity's `StoragePropertySet`; host writes via `prop.setPendingValue(json)`, peers subscribe via `prop.onAnyChange.add(...)`. StorageProperty's per-message ceiling is much larger (~100KB) AND late-joiners receive the current snapshot automatically (per the §10 entry above, `sendEvent` history doesn't replay). Set `prop.sendsPerSecondLimit = 10` (or appropriate) to stay under the 350 messages / 5s rate limit. Belt-and-suspenders: still encode compactly — array-of-arrays `[[id, x, z], ...]` instead of array-of-objects, integer-rounded coordinates, drop redundant fields (constant `y`), numeric IDs instead of `"Entity_" + random`.
- **Local script state (handle arrays, dynamically-spawned SceneObjects, animation timers) is per-device — NOT synced.** Symptom: peer's screen shows none of your enemies/towers/projectiles even though HP and score numbers update correctly. Cause: SyncKit only replicates `StorageProperty` values and `sendEvent` payloads. Anything created via `createSceneObject` / pushed into a local `this.entities` array lives only on the device that created it. Pick the sync mechanism by **data shape**, not by complexity preference. **(1) Static placements drawn from a known table** (placed towers on a fixed grid, claimed pickups in a fixed set) — one `StorageProperty<StorageTypes.string>` holding a JSON array of indices, e.g. `[0, 3, 7]`. Tiny payload, trivially reconciled (each device builds a visual at the slot's known position). No rotation, no ownership semantics, but obviously correct. **(2) Dynamic positions driven by one authoritative simulator** (enemies, projectiles, particles whose motion the host computes) — a `manualString` StorageProperty carrying a compact JSON snapshot of all entity positions, throttled to ~10Hz via `prop.sendsPerSecondLimit`. Host writes the snapshot each tick; non-hosts reconcile local follower visuals against it. Position-only and host-authoritative, but scales to many entities and naturally handles late-joiners (they get the current snapshot on join). Encoding tips in the §10 entry about `sendEvent` payload caps. **(3) Per-entity rotation, ownership transfer, or full state** (player avatars, draggable game pieces, anything a player should "own") — `Instantiator` + a prefab carrying `SyncTransform` + per-entity StorageProperties. Heaviest setup (prefab asset + `Spawn As Children: true` + `Spawn Under Parent` Inspector wiring — see the Location-mode parent pitfall above), but the only option that supports the full spectrum: rotation, scale, claim/transfer, per-entity props. **Rule of thumb:** start with the slot-list pattern; escalate to the broadcast snapshot when positions change continuously; escalate again to `Instantiator + SyncTransform` only when you need rotation, ownership transfer, or per-entity props.
- **`startMode` on `SessionControllerComponent`: `START_MENU` is the canonical mode. Use `MULTIPLAYER` only as a temporary debug knob and revert before any handoff or hand-off-equivalent (verification pass, screenshot, recording, share).** The three values: **`START_MENU`** (prefab default; shows the Solo/Multiplayer chooser at session start; **the only mode that exercises the path a real Snapchatter will see** — they get a fresh role choice per run, and the Lens code's `onConnected` / `onHostUpdated` / `EnableOnReady` timing is the path that needs to actually work); **`MULTIPLAYER`** (skips the menu, auto-joins; convenient for fast iteration *only* — but this is the path where `isHost()` gets confused if you refresh one pane while the other stays connected (see the isHost pitfall below) — test host-dependent logic in `START_MENU` with both panes reset); **`OFF`** (no session — rare; single-device development without connected-lens semantics). **Important asymmetries between the two modes — code that works in `MULTIPLAYER` can be silently broken in `START_MENU`** (mode-asymmetry timing detailed in §4 Mode-asymmetry warning + the EnableOnReady-timing pitfall below): the fix is the host-gate pitfall's `doIOwnStore()` recipe + a per-frame retry in `UpdateEvent` to converge. **Two-pane Preview session-stickiness:** resetting only one pane leaves the other connected and host bookkeeping does NOT reset — reset both panes together (full detail in the isHost pitfall below). **scene-graphql writes are in-memory:** if you change `startMode` via `setProperty(<sessionControllerComponentId>, "startMode", ...)` to flip between modes for testing, the value lives in editor memory until Lens Studio autosaves or you Cmd+S. A preview-reset before the save persists will show the old value. Either save explicitly or accept that scene-graphql `startMode` flips are session-scoped, not project-scoped. **Package-reinstall revert:** `startMode` snaps back to the prefab default `"START_MENU"` after any SyncKit reinstall, file-watcher reimport, or package version bump — convenient when you want it (you're back to the shipping mode for free), surprising when you don't (yesterday's `MULTIPLAYER` quick-iteration setup is gone after a package update). **Recommended workflow:** keep `START_MENU` as the project's persisted value at all times. For agent testing, write your code so the verification path *exercises START_MENU* — have the agent or verifier simulate the Multiplayer button-click via `ls-clad:specs-preview-interaction`. If you must temporarily flip to `MULTIPLAYER` (e.g., one-off no-interaction screenshot), do it via scene-graphql AND immediately flip back; never let the project ship in `MULTIPLAYER`.
- **Destroy-on-damage: callers still hold handles to entities whose `sceneObject` got torn down by a mutation call earlier in the same frame.** Symptom: `Exception in HostFunction: Object is null` deep in a `.getWorldPosition()` / `.getTransform()` chain, traced one or two frames after a method like `target.takeDamage(...)` or `enemy.die()`. Cause: the mutation calls `sceneObject.destroy()`, but the JS handle is still in the caller's `this.enemies` / `this.targets` array with a now-stale `.sceneObject` reference. The next line that reads `handle.sceneObject.getTransform()` crashes. Fix: cache all positional state from the target *before* the mutation call. Pattern: `const targetWorld = target.worldPosition(); target.takeDamage(...); this.spawnImpactAt(targetWorld);`. Belt: prune dead handles from the array immediately (`alive=false` then filter) so they can't be re-targeted on a subsequent step.
- **Host gating: choose `syncEntity.doIOwnStore()` vs `SessionController.isHost()` by scope, not by reflex.** Both primitives have legitimate uses; the difference is scope (per-entity vs. session-wide) and reliability profile.
  - **Decision rule.** *Do you have a `claimOwnership: true` SyncEntity for this concern?* → **YES:** `syncEntity.doIOwnStore()` on that entity. Per-entity ownership; **reliable in both mock-preview modes AND on real hardware.** Use this for ~90% of game-state writes ("am I the writer for this round's state?", "should I award score deltas?", "should I emit clearStrokes events?"). → **NO:** `SessionController.isHost() === true`. Session-wide; reliable on real hardware. **In two-pane Preview, isHost() only gets confused via the `MULTIPLAYER` single-pane-refresh flow (below); `START_MENU` + resetting both panes is clean.** For per-entity authority prefer `doIOwnStore()` regardless.
  - **When `isHost()` is still the right primitive even though `doIOwnStore()` exists:**
    - You have no SyncEntity yet (very early init / setup phase before any claim is constructed).
    - Your gate is session-wide, not entity-scoped — e.g., show "You are the host" in UI text, emit a one-time session-start analytics event, choose which pane renders the lobby's "host settings" panel.
    - Your SyncEntity is `claimOwnership: false` (shared/unowned — e.g. `SyncTransform`'s default entity). `doIOwnStore()` returns `false` for everyone in that case, so it can't gate. Either restructure to give the concern its own claimed entity, or fall back to `isHost()`.
    - Your code only runs on real Specs hardware — `isHost()` is reliable there; the mock-preview caveats below don't apply.
    - **In all these cases, compare with `=== true`, not a truthy check.** `isHost()` returns `boolean | null` — `null` until host is determined, and a truthy check on `null` is `false`, so the race window goes unnoticed.
  - **`isHost()` in two-pane Preview is a *testing-flow* artifact, not an API problem (corrected after live testing):**
    - **The real cause is `MULTIPLAYER` mode + single-pane refresh.** In `MULTIPLAYER` each pane auto-joins on load/refresh. Refresh ONE pane while the OTHER is still connected and the refreshed pane silently re-joins the *same live* session as a returning user; host bookkeeping doesn't reset, so election is confused — both panes can briefly read `isHost() === true`, or the host sticks to the stale pane. **Fix: reset BOTH panes together** (Reset Preview applies to all) so the session starts clean.
    - **`START_MENU` is the clean path for host.** Joining happens only on the manual Multiplayer tap, so a refresh drops the pane back to the menu instead of silently re-joining a stale session. `isHost()` is simply `null` / not-yet-meaningful until that pane taps in and election completes — then it is correct. This is **timing, not a persistent failure**: don't gate an `init()`-time latch on `isHost()` (the pane hasn't joined yet); re-check after join or on `onHostUpdated`.
    - **On real Specs hardware** `isHost()` is reliable; everything above is specific to the Lens Studio two-pane mock.
    - **Mitigations:** reset both panes together; subscribe to `SessionController.onHostUpdated` and re-check at the point of action rather than at `init()`. Use `doIOwnStore()` on a `claimOwnership: true` SyncEntity for *per-entity* authority (it's unambiguous in both modes) — but `isHost()` is the right, reliable tool for genuinely *session-wide* host actions (e.g. the §6.3 coin-hunter host spawning all 50 coins) once you test with the clean flow above.
- **Gate ownership on `doIOwnStore()` alone — don't AND it with a mirrored StorageProperty.** A real failure: a draggable object was gated `enabled = doIOwnStore() && ownerConnProp.currentOrPendingValue === myConnId`. The mirrored property replicates late (and a non-owner write to it is silently dropped — see the `setPendingValue` pitfall above), so the AND rarely held and the object stayed inert. `doIOwnStore()` is already the authoritative, immediately-correct per-entity answer; a second mirrored signal only makes the gate *harder* to satisfy, never safer.
- **`Instantiator.instantiate(prefab, {claimOwnership: false})` leaves the NetworkRoot unowned, so a later leaf-entity claim "succeeds" but never sticks.** Symptom: the prefab's own script does `new SyncEntity(this, props, /*claimOwnership*/ false)` and later `tryClaimOwnership()`; the **success callback fires** (you log "claimed!") yet `doIOwnStore()` stays `false` on every device and `setPendingValue` writes are silently dropped. Cause: with the spawn itself unowned, the leaf claim can't establish authority. Fix: spawn with `claimOwnership: true` — the spawner owns the NetworkRoot, and the leaf is still independently claimable later (exactly what the §6.6 Collectible recipe does). Search anchor: *tryClaimOwnership onSuccess fires but doIOwnStore() stays false.*
- **Local UX cues (hover halos, drag previews, snap-target highlights) must be gated on `doIOwnStore()` — remote mirrors drift via SyncTransform and will light spurious cues.** A common pattern when building draggable game pieces is to show a visual cue on the would-snap target while the piece is held — a halo around the nearest matching slot, a scaled-up "this is where it'll land" indicator. The natural place to drive this is from the piece's `UpdateEvent`, calling some local hit-test function each frame. The trap: that `UpdateEvent` runs on EVERY device, not just the one dragging the piece. Remote devices receive the piece's position via `SyncTransform` (sampled at ~10Hz) and run the same hover detection on their local view — which drifts a few cm from the dragging device's view because of sampling + ownership transitions. The remote devices end up lighting DIFFERENT halos than the dragger sees, and those halos can persist past the snap commit (because the next frame's hover detection on the remote re-lights them). Worse, "fixing it" by clearing halos on slot-index change only fixes the moment-of-snap — the next frame's `UpdateEvent` on the remote mirror re-lights a halo based on its drifted position. **Rule:** ANY local-only UX cue driven by a dragged shared piece must be gated by `if (this.syncEntity.doIOwnStore())`. The cube's owner is the device actively interacting with it; halos are *for* that user, not for remote spectators. Spectators see the piece move via SyncTransform — that's sufficient cross-device feedback. The same applies to magnetic-snap-during-drag, target highlighting, and any other "show me where this is heading" cue. See the `SnapToSlotPiece.ts` recipe header for the working pattern.
- **Slot-anchored position bypasses the SyncTransform race at snap commit.** When a draggable shared piece commits a snap, the natural code path on the owner is: (1) `setWorldPosition(targetPos)`, (2) `slotIndexProp.setPendingValue(N)` to mark the slot filled, (3) `tryRevokeOwnership` to let the next player grab. `SyncTransform` broadcasts position at ~10Hz, NOT at the moment of `setWorldPosition`. The just-set snapped position may not reach remotes before step (3) revokes ownership. Worse, a stale mid-drag `SyncTransform` message from BEFORE the snap can arrive on the remote AFTER `slotIndex` already changed — overwriting the snapped position with the old drag position. Symptom: both devices show "Placed: N/M" matching (because `filledSlotsJson` and `slotIndex` both replicate reliably via StorageProperty), but the cubes appear in different positions on different devices. **Fix:** treat the discrete `slotIndex` StorageProperty as the authoritative position source. On `slotIndex.onAnyChange`, every device locally looks up the slot's world position (from its own target list, identical across devices) and `setWorldPosition`s the piece there. The cube's WORLD POSITION is now derived from the slot index on every device, not transmitted via SyncTransform. SyncTransform still handles smooth mid-drag motion, but the final snapped pose is determined by the discrete state property. Belt-and-suspenders: in the piece's `UpdateEvent`, if `slotIndex >= 0 && !isBeingManipulated && drift > threshold`, re-snap to the slot's world position — corrects any stale SyncTransform message arriving after the slot change. See the `SnapToSlotPiece.ts` recipe.
- **Reset-style host-arbitrated state changes (clear-all-pieces) rely on the StorageProperty `onAnyChange` path, not local events.** A common multiplayer pattern: the host owns a top-level state (`currentLevel: manualInt`, `selectedCharacter: manualInt`, `gamePhase: manualString`). When that state flips to a "reset" value (-1, `"none"`, etc.), every device must tear down all derived entities (pieces, ghosts, placed items). The trap: the host-side code reads "the state changed → clean up locally," which works ONLY on the host. Remote devices observe the change via the `onAnyChange` handler on the StorageProperty — that's the canonical signal for every device. Each entity (e.g. each placed piece) should subscribe to the host's state property in its `onSyncReady` and, when the state changes to the reset value, the OWNING device of the entity calls `syncEntity.destroy()`. The `doIOwnStore()` guard is mandatory — non-owners shouldn't call destroy (that's the network's job to cascade). For ghost / blueprint visuals that are local-only (not networked entities), the local controller can scrub its own state on the same `onAnyChange` handler. Symptom of getting it wrong: host's screen clears on reset, remote screens keep showing the old entities. **Don't reach for a parallel local-side `Event<T>` fan-out** ("the owner fires an immediate event for itself to react synchronously"); SyncKit's `onAnyChange` runs on every device including the owner and is the right channel for clear-all-instances semantics. Local events are a workaround for a problem you should solve by using the SyncKit path correctly.
- **`getUsers()` returns the live user count — one entry per connected user (1 pane → 1, 2 panes → 2). Use it for the peer count and for sorted-index role assignment**, recomputing on `onUserJoinedSession` / `onConnected` as peers arrive. The real thing to handle is **late joiners**: one-shot `sendEvent` announces are NOT replayed to a pane that joins later, so if earlier panes broadcast a one-time "I'm here" / role / seed announce in their session-ready callback, a later joiner never hears it. **Fix — presence/announce handshake:** re-broadcast your announce when you receive a *new* peer's announce, so the newcomer learns about everyone already present. That re-broadcast MUST be guarded against the synchronous self-echo (§6.7): add your own id to the dedup `Set` *before* the first broadcast and `return` on already-known ids *before* re-broadcasting, or it recurses into `RangeError: Maximum call stack size exceeded`. Reference: `resources/scripts/TurnTakingGame.ts:113-146`.
- **`SessionController.onUserJoinedSession` does NOT fire for the local user.** Confirmed in `SessionController.ts` `_onUserJoinedSession` / `_trackUser` — the local user is registered in `_onConnected` before this event handler ever runs, so the dedup-by-already-known-user check returns `false` and the event never invokes. **Implication:** if you wire your lobby's "current player count" exclusively to `onUserJoinedSession`, the first joiner's local count stays at 0 even though it should be 1. **Fix:** seed counts from `onConnected` (which delivers `connectionInfo.localUserInfo + externalUsersInfo` together at connection time), then increment via `onUserJoinedSession` for subsequent *remote* arrivals. With the presence-handshake pattern above, "current count" is the size of the presence Set, which is updated by both code paths naturally — no special-casing the local user.
- **Handle players — and especially the host — leaving mid-session.** Documented (`sync-entity.mdx`): a `persistence:"Owner"` entity auto-destroys when its owner leaves; a `persistence:"Session"` entity's *state* survives while ≥1 user remains; `onOwnerUpdated` fires on ownership change; `SessionController.onHostUpdated` fires when the host re-elects (e.g. the host left). Apply by concern:
  - **Per-player visible content** (avatar, name tag, cursor): spawn with `persistence:"Owner"` so it auto-cleans on disconnect. For a departed player's *slice* in a shared store (per-`connectionId` hand pose, team-registry slot), remove it on `SessionController.onUserLeftSession`.
  - **Shared authoritative state** (scores, game phase, team registry): use `persistence:"Session"` so it survives any single departure. But if the **owner** of that entity leaves, the store can be left **writer-less** — non-owner `setPendingValue` is silently dropped (see above), so writes stall. Have a surviving client re-establish a writer: on `onUserLeftSession` / `onHostUpdated`, if `!syncEntity.isStoreOwned()` and you're the surviving authority (e.g. `isHost() === true`), call `tryClaimOwnership()`; react via `onOwnerUpdated` to re-bind.
  - **Host migration:** host-only logic (host-authoritative writes, one-time spawns, arbitration) must re-check on `onHostUpdated`, not only at init — the newly-elected host has to pick up the role. (Same mitigation the host-gating pitfall calls out.)
  - **Caveat:** whether ownership reassigns *automatically* when an owner leaves isn't documented and may differ between mock-preview and real hardware; the robust pattern is the explicit re-claim above, verified on-device.
- **Non-host clients still need a per-frame UI tick for synced countdowns and other rate-varying displays.** Easy footgun: the natural place to compute "remaining seconds = endsAt - getServerTimeInSeconds()" is inside an `UpdateEvent` gated by `if (!this.syncEntity.doIOwnStore()) return` — that's correct for *state transitions* (firing endRound at expiry) but wrong for *UI updates*. The non-owner pane's `applyLocalUI`-equivalent only re-runs when a StorageProperty changes, so its visible timer text freezes between transitions while the owner's counts down. **Fix:** split the UpdateEvent in two — an all-clients section (no owner gate) that refreshes the UI text every frame from the owner-broadcast value (see §7 `SyncedTimer`'s `broadcastRemaining` pattern), and an owner-only section gated by `doIOwnStore()` that handles state transitions. Cross-reference the existing server-time pitfall further up this section: the owner-broadcast value is also what cures the per-pane drift in mock-preview.
- **"Host requires authentication" warning in Lens Studio Preview is expected — not a sync failure.** Every multiplayer-mode preview run emits `W (@QNetworkAccessManager thread) stream N finished with error: "Host requires authentication"` once on session create. Cause: the Connected Lens transport tries to hit the real Snap multiplayer server for OAuth, can't authenticate (no on-device login flow in Lens Studio), and gracefully falls back to the mocked-online session. SyncEntities, networked events, `getServerTimeInSeconds()` (per-pane in mock as noted above), and colocated setup all keep working through this fallback. **Ignore the warning in Preview;** it will resolve on real Specs hardware once the device's Snap account auth flows through. Don't gate sync setup on the absence of this line in your readiness checks.
- **`EnableOnReady` fires at *materially different times* between `START_MENU` and `MULTIPLAYER` modes — scripts under it cannot assume a consistent boot order.** Scripts placed under `Colocated World / EnableOnReady` run their `onAwake` (and any chained `notifyOnReady` callbacks) at the moment that subtree is flipped on. In `MULTIPLAYER` mode that's ~1 s after the Lens loads, simultaneously on every pane. In `START_MENU` mode it's *the moment that pane's user clicks the Multiplayer button on the SyncKit StartMenu* — i.e., panes can boot seconds apart. The second pane joins an already-connected session, and `SessionController.onConnected` / `onHostUpdated` may have already fired on the first pane before the second pane's script even exists, so `onConnected.add(...)` calls in `onAwake` will silently miss those firings. **Fix:** combine event subscriptions with a per-frame retry inside `UpdateEvent`. The retry's gate is the same as the event handler's body (e.g. `if (this.isInitialized) return; if (this.syncEntity?.doIOwnStore() && ...) { initialize() }`). Don't rely on event-only triggers for any logic that needs to fire on the "I am authoritative now" transition.
- **Runtime-preview MCP tools (`QueryRuntimeSceneTool`, `CaptureRuntimeViewTool`, `PreviewInteractTool`) require two separate installs** — a lens-project package AND a Lens-Studio-app ChatTool plugin — and have a screenshot + `scene-graphql` + log fallback when the ChatTool plugin is unavailable. This is verification-toolchain detail, not a SyncKit API: see `resources/docs/debugging.mdx` → "Runtime-preview MCP tools require two separate installs."
