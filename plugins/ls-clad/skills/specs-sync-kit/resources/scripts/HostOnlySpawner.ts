// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// HostOnlySpawner.ts — host-only one-shot spawn of N objects.
//
// What "host" means: SessionController.isHost() returns true for exactly
// one user per session (typically the first joiner who completed mapping).
// The result is consistent across all devices. Use this when exactly one
// user should run a privileged action: initial layout, spawning shared
// props, arbitrating turns, seeding game state.
//
// The `=== true` comparison is critical: isHost() returns boolean | null
// (null until host determined). A truthy check would treat null as "not
// host" during the race window. Instantiator.notifyOnReady chains off
// SessionController readiness, so isHost should be resolved by the time
// this fires, but the explicit `=== true` closes the race window at no
// cost.
//
// Place at: Assets/Scripts/HostOnlySpawner.ts, on a SceneObject under
// "Colocated World [CONFIGURE_ME] / EnableOnReady" that also holds an
// Instantiator component (with the target prefab in the Prefabs array).

import {Instantiator} from "SpectaclesSyncKit.lspkg/Components/Instantiator"
import {SessionController} from "SpectaclesSyncKit.lspkg/Core/SessionController"

const NUM_ITEMS = 50
const HALF_WIDTH_CM = 200
const MAX_HEIGHT_CM = 200
const DEPTH_NEAR_CM = 100
const DEPTH_FAR_CM = 400

@component
export class HostOnlySpawner extends BaseScriptComponent {
  @input instantiator: Instantiator
  @input itemPrefab: ObjectPrefab

  onAwake(): void {
    this.instantiator.notifyOnReady(() => this.onReady())
  }

  private onReady(): void {
    if (SessionController.getInstance().isHost() !== true) {
      print("[HostOnlySpawner] not the host — skipping spawn.")
      return
    }
    if (!this.itemPrefab) {
      print("[HostOnlySpawner] itemPrefab is null — wire it in the Inspector.")
      return
    }

    for (let i = 0; i < NUM_ITEMS; i++) {
      this.instantiator.instantiate(this.itemPrefab, {
        claimOwnership: true,
        persistence: "Session",
        worldPosition: this.randomPos(),
        onError: (err: string) =>
          print("[HostOnlySpawner] spawn failed: " + err),
      })
    }
    print("[HostOnlySpawner] spawned " + NUM_ITEMS + " items.")
  }

  private randomPos(): vec3 {
    return new vec3(
      (Math.random() - 0.5) * 2 * HALF_WIDTH_CM,
      Math.random() * MAX_HEIGHT_CM,
      -(Math.random() * (DEPTH_FAR_CM - DEPTH_NEAR_CM) + DEPTH_NEAR_CM),
    )
  }
}
