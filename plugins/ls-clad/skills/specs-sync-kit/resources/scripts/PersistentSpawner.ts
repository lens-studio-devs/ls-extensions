// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// PersistentSpawner.ts — on-demand spawn of session-persistent objects with
// optional per-spawn one-shot config via customDataStore.
//
// Pair with a controller component on the prefab leaf that reads its config
// in `notifyOnReady` from `networkRoot.dataStore`. Each call to spawn(...)
// instantiates one networked object with `persistence: "Session"` — the
// object outlives the spawning device's disconnect; it persists until either
// (a) the SyncEntity is explicitly destroyed, or (b) the entire session ends.
//
// Use cases:
//   - Dispenser bins → spawn colored game pieces that any player can grab.
//   - Inventory items → spawn a piece on demand that should outlive the
//     spawner closing the inventory.
//   - Placed pickups, dropped equipment, anything meant to "stay in the world"
//     after the player who put it there moves on or leaves.
//
// Contrast with TransientSpawner.ts:
//   - TransientSpawner uses `persistence: "Owner"` — auto-destroyed when the
//     spawning device disconnects. Correct for ping markers, laser dots,
//     gunshot puffs, emoji reactions — short-lived per-event effects tied
//     to the device that triggered them.
//   - PersistentSpawner uses `persistence: "Session"` — survives the
//     spawner's disconnect; lives until explicitly destroyed or the session
//     ends. Correct for dispensed game pieces, inventory drops, placeable
//     content. THE SPAWNING DEVICE'S OWNERSHIP IS HANDED OFF on disconnect,
//     so the object becomes ownerless but still exists; the next grabber
//     can claim via `tryClaimOwnership` / `requestOwnership`.
//
// Per-spawn config (customDataStore):
//   Many dispenser patterns need per-instance variation: which color is this
//   piece? which prefab variant? which player owns it initially? Pass a
//   `Record<string, number | string>` to spawn() and the recipe writes it
//   into the spawn's `customDataStore` as int / string. The prefab's
//   controller reads it inside `notifyOnReady` via
//   `networkRoot.dataStore.getInt("colorIndex")` etc. — one-shot config,
//   replicated to all peers as part of NetworkRootInfo, no StorageProperty
//   sync needed for these read-once values.
//
// IMPORTANT — DON'T use customDataStore for state that changes after spawn.
//   customDataStore is replicated ONCE at spawn time. Mutations on the
//   spawner side after the fact don't propagate. For values that change
//   during gameplay (current owner, current state, score, position),
//   declare a StorageProperty on the prefab's SyncEntity instead.
//
// Place at: Assets/Scripts/PersistentSpawner.ts, attach to a SceneObject
// under "Colocated World [CONFIGURE_ME] / EnableOnReady" that also holds
// an Instantiator component (with the prefab in the Prefabs array).
//
// Instantiator Inspector config — non-obvious requirement:
//   On the spawner's Instantiator, set `Spawn As Children: true` AND wire
//   `Spawn Under Parent` to a SceneObject under `Colocated World [CONFIGURE_ME]`.
//   Required for any prefab carrying a Location-mode SyncTransform; see
//   SKILL.md §10 "SyncTransform with Position/Rotation = Location requires
//   the spawned object's parent chain to include the LocatedAtComponent".
//
// One PersistentSpawner per prefab. If you have two bins spawning different
// prefabs, instantiate two PersistentSpawner components.

import {Instantiator} from "SpectaclesSyncKit.lspkg/Components/Instantiator"

// `GeneralDataStore` is a Lens Studio global runtime type (declared in
// StudioLib.d.ts) — no import needed.

export type SpawnConfig = Record<string, number | string>

@component
export class PersistentSpawner extends BaseScriptComponent {
  @input instantiator: Instantiator
  @input prefab: ObjectPrefab

  private isReady = false
  // Spawns requested before the instantiator was ready. Flushed once on ready.
  private pendingSpawns: Array<{ pos: vec3; config: SpawnConfig | null }> = []

  onAwake(): void {
    this.instantiator.notifyOnReady(() => {
      this.isReady = true
      for (const q of this.pendingSpawns) this.doSpawn(q.pos, q.config)
      this.pendingSpawns = []
    })
  }

  // Spawn one networked object at worldPosition with optional per-instance
  // config (read from customDataStore by the prefab controller). The
  // returned NetworkRoot reference is the spawner's local handle; remotes
  // get their own NetworkRoot via SyncKit replication. Returns null if the
  // spawn was queued (instantiator not ready) — the caller should not assume
  // synchronous availability.
  public spawn(worldPosition: vec3, config: SpawnConfig | null = null): void {
    if (!this.prefab) {
      print("[PersistentSpawner] prefab is null — wire it in the Inspector.")
      return
    }
    if (!this.isReady) {
      this.pendingSpawns.push({ pos: worldPosition, config })
      return
    }
    this.doSpawn(worldPosition, config)
  }

  private doSpawn(worldPosition: vec3, config: SpawnConfig | null): void {
    const data = config ? this.buildCustomDataStore(config) : undefined

    this.instantiator.instantiate(this.prefab, {
      claimOwnership: true,
      persistence: "Session",  // <-- key difference from TransientSpawner
      worldPosition,
      customDataStore: data,
      onError: (err: string) =>
        print("[PersistentSpawner] spawn failed: " + err),
    })
  }

  private buildCustomDataStore(config: SpawnConfig): GeneralDataStore {
    const store = GeneralDataStore.create()
    for (const key in config) {
      const v = config[key]
      if (typeof v === "number") {
        // Use putInt for whole numbers — putFloat is also available if you
        // need fractional values. The prefab controller must match its
        // getInt/getFloat read to whichever you pick.
        store.putInt(key, v)
      } else if (typeof v === "string") {
        store.putString(key, v)
      }
    }
    return store
  }
}
