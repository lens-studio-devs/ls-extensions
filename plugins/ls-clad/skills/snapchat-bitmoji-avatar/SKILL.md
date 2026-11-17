---
name: snapchat-bitmoji-avatar
description: Load and display a 3D Bitmoji avatar (current user, a friend, or My AI) on a mobile Snapchat Lens with the Bitmoji 3D component (v10.0.2), incl. quality/shadow/privacy controls. Add a Bitmoji character or set the visual for a controllable character. Standalone-usable. Spoke of snapchat-controllable-character.
user-invocable: false
---
<!--
Copyright 2026 Snap Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Bitmoji Avatar (Bitmoji 3D v10.0.2)

Loads a rigged 3D Bitmoji avatar into the scene — the current user's, a friend's, or My AI's — and is the default character visual for the Bitmoji Player Package. Mature standalone component (Asset Library → "Bitmoji 3D"); usable anywhere you want a Bitmoji, not just for player characters.

Parent/setup context: `snapchat-controllable-character`.

## Import

```ts
import { Bitmoji3D } from "Bitmoji 3D.lsc/Bitmoji 3D";  // folder AND file contain a literal space
```

The player package references it structurally (a `Bitmoji3DComponent` with `downloadAvatar()` / `downloadAvatarForUser()`), so wire it as `@input("Component.ScriptComponent")`.

## `@input` surface (defaults)

> Defaults are a **v10.0.2 snapshot** — illustrative, not authoritative; they drift across versions and the drop-in overrides several (see below). Read the live component for current values; the durable part is the **knob names + meaning**.

| Input | Type | Default | Meaning |
|---|---|---|---|
| `bitmojiType` | enum `BitmojiOwnerType` | `ME` (0) | whose avatar: `NONE(-1)/ME(0)/FRIENDBYINDEX(1)/AI(2)`. (`@input('float')` kept for backwards compat) |
| `friendsComponent` | Component | — | optional custom friends provider (shown when type = My Friend) |
| `friendIndex` | int | 0 | which friend (type = My Friend) |
| `privacyType` | enum | `SAFE` (1) | `None(0)` = more capabilities (sorting, auto-mention); `Safe(1)` = works with Remote Service Modules / Leaderboards / Cloud Storage. Reverts to None if a Friends component is assigned. |
| `autoDownload` | boolean | true | download on start; else call `download()` |
| `mixamoAnimation` | boolean | true | remap the rig to Mixamo joint names (adds a 100× scale-compensation node) |
| `renderOrder` | int | 0 | mesh render order |
| `castShadow` | boolean | true | cast shadows (needs a shadow plane + light shadows) |
| `meshQuality` | number | 0.5 | 0.1–1.0 |
| `textureQuality` | number | 0.5 | 0.1–1.0 |
| `autoMention` | boolean | true | mention the owner in a recorded Snap |
| `materialHolder` | Material | — | material applied to the loaded GLTF |
| `loaderPrefab` | ObjectPrefab | — | shown while downloading (auto-hidden on record/capture) |
| `printDebug/printWarnings/printErrors` | boolean | false/true/true | logging |

Enum note: the class uses `UserPrivacyType { NONE=0, SAFE=1 }` at runtime (the `.d.ts` labels the same values `SnapchatUserType { REGULAR=0, SAFE=1 }`).

## Public API

- `download()` — fire-and-forget download using the current inputs.
- `downloadAvatar(): Promise<void>` — download with current config; awaitable.
- `downloadAvatarForUser(user: SafeSnapchatUser): Promise<void>` — download a specific user's avatar (what `PlayerCharacterInit` calls, passing the local `SafeSnapchatUser` or, for a remote player, the one from the sync session).
- `getAvatar(): SceneObject | null`, `getUser()`, `getSafeUser()`, `getExtras()`.
- `getRenderOrder()/setRenderOrder(n)`, `getShadowsEnabled()/setShadowsEnabled(b)`, `getRenderLayer()/setRenderLayer(layer: LayerSet)`.
- Events: `onDownloaded` (fires with the avatar SceneObject), `onDownloadFailed` — both `EventWrapper`.

## Standalone use (the common case)

Most of the time this is dead simple: add the `Bitmoji 3D` component to a SceneObject, leave **`autoDownload` on** (the default), and on start it loads the current user's avatar — **no code required**. Pick `bitmojiType` (Me / My Friend / My AI) and the quality knobs to taste; subscribe to `onDownloaded` if you need to react once the avatar exists. You do **not** need to drive the download yourself, and (per the earlier fix) if the user has no Bitmoji / isn't signed in it falls back to a default avatar rather than rendering empty.

Drive it manually (`autoDownload` off + call `download()` / `downloadAvatar()` yourself) only when you need to control *when* it loads — e.g. after a menu, or to load a specific user's avatar via `downloadAvatarForUser(...)`.

## Within the Bitmoji Player Package (this spoke's parent)

The player package is a deliberate exception to "autoDownload on": it sets `autoDownload` **off** and lets `PlayerCharacterInit` call `downloadAvatarForUser(...)` itself so it can choose the correct user and time the load (e.g. after ownership is decided in multiplayer). It also configures the component for that flow — **Mixamo remap off** and **mesh/texture quality lowered** for mobile (directional; read the live component for the shipped values). To give the character a **non-Bitmoji** visual instead, leave `bitmoji3D` unset on `PlayerCharacterInit` and put your own mesh under `Player Visuals` (size it in cm — see `snapchat-character-controller`).

## Gotchas

- **Async + destroy-safe.** `downloadAvatar`/`downloadAvatarForUser` return Promises and swallow errors into `onDownloadFailed`. They re-check `isNull(thisObject)` after each await (the host can be destroyed mid-download) and drop a completed load whose host died. Gate avatar-dependent gameplay on `onDownloaded`; handle rejection.
- **Re-entrancy guard.** A second call while `isLoading` warns "Loading in process" and returns; loading a new avatar destroys the previous one first.
- **Runs on start only if** `autoDownload && bitmojiType !== NONE && !isLoading`. In the player package, init drives the load explicitly instead.
- **Centimeter scale + Mixamo fixup.** GLTF instantiation forces meters→cm conversion (avatar arrives in cm). `mixamoAnimation` renames joints and injects a `Hips_SSC_Mixamo` node that scales the root by 0.01 (a hardcoded 100× compensation) — expected; don't "fix" the scale.
- **Loader prefab** auto-hides on `SnapRecordStartEvent`/`SnapImageCaptureEvent` and is skipped while `global.scene.isRecording()`.
- **Privacy:** keep `Safe` if the Lens uses Remote Service Modules / Leaderboards / Cloud Storage; assigning a Friends component forces privacy to None.
- **Local-user avatar falls back to a default Bitmoji — it does not render empty.** With `bitmojiType = Me`, `createOptions` leaves `options.user` unset and the native loader resolves the signed-in user, falling back to a default (random) Bitmoji when the user has none or isn't signed in. The component has no empty/invisible branch; genuine load failures surface via `onDownloadFailed`. So a headless/Preview run still shows a default avatar, not nothing — don't add a placeholder-mesh workaround for a problem that doesn't exist. (Friend/AI selection is a separate path that filters to friends with a Bitmoji; handle an empty friend list there.)
