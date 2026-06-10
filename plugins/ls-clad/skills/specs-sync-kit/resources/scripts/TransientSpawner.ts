// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// TransientSpawner.ts — spawn-stream-fade pattern, spawner side.
//
// Pair with TransientController.ts on the prefab leaf. The local device
// spawns the object on a trigger; the owner (the local device) controls
// its fade and self-destruction. `persistence: "Owner"` ensures the
// object disappears for everyone if the spawner disconnects mid-fade.
//
// Used for short-lived per-event objects: laser-pointer dots, gunshot
// puffs, ping markers, reaction emojis, particle bursts.
//
// Place at: Assets/Scripts/TransientSpawner.ts, attach to a SceneObject
// under "Colocated World [CONFIGURE_ME] / EnableOnReady" that also holds
// an Instantiator component (with the prefab in the Prefabs array).
//
// One TransientSpawner per effect prefab — a scene with laser dots AND
// gunshot puffs needs two spawners (different prefabs). Calling scripts
// reference each spawner via @input, NOT a global singleton:
//
//   @input laserSpawner: TransientSpawner
//   @input puffSpawner: TransientSpawner
//
//   onPinch() { this.laserSpawner.spawn(this.hitPoint) }
//
// (Earlier versions of this recipe exposed a static `instance` accessor;
// that singleton silently broke multi-effect scenes because the last
// spawner to onAwake would overwrite earlier ones. @input wiring is
// the per-prefab pattern used by Collectible, MultiStatePlayerLabel,
// PlayerAvatarController, and TransientController in this skill.)

import {Instantiator} from "SpectaclesSyncKit.lspkg/Components/Instantiator"

@component
export class TransientSpawner extends BaseScriptComponent {
  @input instantiator: Instantiator
  @input prefab: ObjectPrefab

  // Cache the instantiator's ready state so we register notifyOnReady
  // exactly once. Without this, every spawn() call before ready would
  // queue a fresh callback on the instantiator's listener list, and
  // every spawn() call after ready would do an immediate-fire roundtrip
  // through notifyOnReady — both wasteful, and the pre-ready case
  // accumulates listeners unboundedly.
  private isReady = false
  // Spawns requested before the instantiator was ready. Flushed once.
  private pendingSpawns: vec3[] = []

  onAwake(): void {
    this.instantiator.notifyOnReady(() => {
      this.isReady = true
      for (const pos of this.pendingSpawns) this.doSpawn(pos)
      this.pendingSpawns = []
    })
  }

  // Spawn an instance at worldPosition. Returns immediately; the
  // spawned controller drives its own fade + destroy. Spawns issued
  // before the instantiator is ready are queued and flushed on ready.
  public spawn(worldPosition: vec3): void {
    if (!this.prefab) {
      print("[TransientSpawner] prefab is null — wire it in the Inspector.")
      return
    }
    // this.isReady is set inside instantiator.notifyOnReady, which itself
    // chains on SessionController readiness — so this gate covers both
    // "session ready" and "instantiator ready" without an extra check.
    // Adding an earlier getIsReady() guard would silently drop pre-ready
    // spawns instead of queueing them, defeating the pendingSpawns queue
    // entirely.
    if (!this.isReady) {
      this.pendingSpawns.push(worldPosition)
      return
    }
    this.doSpawn(worldPosition)
  }

  private doSpawn(worldPosition: vec3): void {
    this.instantiator.instantiate(this.prefab, {
      claimOwnership: true,
      persistence: "Owner",
      worldPosition,
      onError: (err: string) =>
        print("[TransientSpawner] spawn failed: " + err),
    })
  }
}
