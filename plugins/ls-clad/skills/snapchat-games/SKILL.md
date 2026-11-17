---
name: snapchat-games
description: Build a game on a Snapchat (mobile phone) Lens — entry point covering starting templates, self-contained-scene setup, the player character, gameplay logic, asset kits, and a genre map. Routes to the controllable-character + gameplay skills.
user-invocable: true
---
<!--
Copyright 2026 Snap Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Snapchat Games (mobile Lens games)

Entry point for building a **game** on a Snapchat (in-camera, mobile phone) Lens. It owns the cross-cutting setup and a genre map, and routes to the specialist skills for each part. A game is a **self-contained rendered scene**, not an AR/camera effect — see §2.

## §1 — Two ways to start

- **Option 1 · start from a game template (richest — but a *manual* step).** In Lens Studio **Home → New Project**: **Bitmoji Game** (three modes — 3D platformer, 2D side-scroller, and a fixed-camera 3D game — with a player character, assets, and prefabs pre-wired) or **3D Game Example** (a 3D racing base; name may change soon). The Home template gallery **isn't scriptable** (served by an internal Home subsystem — no MCP / Editor-API path), so a person creates the project in the UI; the agent then builds on the opened project. If the template already ships a player character, **it's set up — don't re-install; introspect the scene and build on it**.
- **Option 2 · from scratch (fully automatable).** Set up a self-contained scene (§2), add the player character (§3), install any asset kits you need (§5), and write the game logic (§4).

## §2 — It's a game, not an AR effect

Set the Lens up as a **self-contained scene**: clear the Render Target to a solid color (the camera feed goes unused → the Lens can run more optimized), tracking `none`, the perspective camera's **Device Property = `Aspect`** (device-consistent FOV), and raise the camera **far** clip so distant scenery renders. Full checklist: `snapchat-project-init` §4. (A skybox is an optional extra backdrop, not a substitute for the color clear.)

## §3 — The player character

When the player drives an on-screen character (third-person, side-scroller, platformer, top-down, endless-runner, RPG), use **`snapchat-controllable-character`** — a drop-in **Bitmoji Player Package** (movement Character Controller + follow Camera Controller + on-screen Joystick + Bitmoji avatar) with genre recipes and multiplayer-ready plumbing. Not every game needs it (a racing game, a tap puzzle) — reach for it when a player-driven character is the core.

## §4 — Game logic

Turning "the character moves" into a game — goal / collision / overlap detection, score & win/lose HUD, countdown timers, respawn, tap-to-move, NPCs, endless-runner, level-building — lives in **`../../references/snapchat-gameplay-recipes.md`** (copy-paste templates). Lean on the character's built-in `onCollision*` / `onOverlap*` / `isGrounded()` events before bolting on separate physics; for world colliders / forces / raycasts see `physics`.

## §5 — Assets & kits (installable)

From the Asset Library via `InstallLensStudioPackage` (same path as the player package):

- **`Platformer Ground Kit`** / **`Platformer Obstacles Kit`** — ready-made ground pieces, platforms, obstacles, collectibles, hazards, flags/finish gates. **For a platformer / obstacle-course, reach for these first** — they're the intended art source for the genre and read far richer than hand-built box primitives (a fresh agent left to its own devices tends to hand-roll boxes and never discover them — don't). They're **art/mesh packs (no colliders)**, so add a collider to whatever the character stands on/hits — via the editor/MCP the component type is the **bare `ColliderComponent`** (the *runtime* name `Physics.ColliderComponent` fails at edit-time with *"Unknown entity type"*). *(Labeled v5.0.0 but verified to install + auto-instantiate on LS 5.24.)* Heads-up: install drops a **one-of-each sampler** (a jumble at an offset, e.g. `(0,−250,−800)`), not a ready-to-play layout — disable it and reference its meshes/materials (by UUID) to build your own level.
- **Game Manager · Leaderboard · Turn Based · Game Suite** — game middleware (scoring, leaderboards, turn logic).
- Custom meshes/props via **`/build-mesh`**; size in centimeters relative to the character (a Bitmoji is ~170 cm) and confirm with `GetBoundingBox`.

## §6 — Genre map

> In the "Where" column, **"CC §N"** = a section of the `snapchat-controllable-character` hub; **"§5 kits"** = *this* doc's §5 (Assets & kits). They are different skills — don't conflate the two "§5"s.

| Genre | Camera | Where |
|---|---|---|
| 3D third-person adventure | Third-Person / Orbit | CC §5 |
| 2.5D side-scroller | Follow, side-locked | CC §5 (lock Z + horizontal-only joystick) |
| 3D platformer | keep **Orbit** | **art: `Platformer Ground` + `Obstacles Kit` (§5 kits)** · recipe: CC §5 + gameplay-recipes (colliders, `groundIsZero` false, fall→respawn) |
| Top-down collector | Follow, top-down | CC §5 + gameplay-recipes overlap-pickup + score/timer HUD (§5 kits for collectibles/hazards) |
| Endless runner | behind Follow | gameplay-recipes "Endless runner" (treadmill, tap-jump, swept collision) |
| RPG tap-to-move + NPC | Orbit / Third-Person | gameplay-recipes "Driving movement" (tap-to-move, standalone NPC) |
| Racing / non-character | — | start from the **3D Game Example** template (§1) — not a controllable-character game |

## §7 — Multiplayer

The Bitmoji Player Package is multiplayer-*ready* but ships **no** sync transport; a dedicated Connected-Lenses skill is the planned home for the wiring. Treat mobile multiplayer as an advanced, out-of-scope build for now (`snapchat-controllable-character` §6).

## Cross-references

- Player character → `snapchat-controllable-character` (+ spokes: `snapchat-character-controller`, `snapchat-follow-camera`, `snapchat-screen-input`, `snapchat-bitmoji-avatar`)
- Game-logic recipes → `../../references/snapchat-gameplay-recipes.md`
- Self-contained scene / project setup → `snapchat-project-init`
- Physics (colliders / forces / raycasts) → `physics`
- Building meshes/props → `/build-mesh`
- Installing packages → `ensure-package-installed`
