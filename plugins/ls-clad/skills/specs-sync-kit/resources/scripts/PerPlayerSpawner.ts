// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// PerPlayerSpawner.ts — every device spawns its own copy of a prefab.
//
// Use when each player should have their own instance of something —
// per-player avatar body, hand reticle, status badge, score chip, etc.
// Each device runs instantiate() once. Inside the spawned prefab's
// controller, gate per-player vs observer logic with doIOwnStore().
//
// `persistence: "Owner"` auto-destroys the instance when that player
// disconnects. `claimOwnership: true` lets each device control its own
// instance.
//
// Place at: Assets/Scripts/PerPlayerSpawner.ts, on a SceneObject under
// "Colocated World [CONFIGURE_ME] / EnableOnReady" that also holds an
// Instantiator component (with the prefab in the Prefabs array).

import {Instantiator} from "SpectaclesSyncKit.lspkg/Components/Instantiator"
import {SessionController} from "SpectaclesSyncKit.lspkg/Core/SessionController"

@component
export class PerPlayerSpawner extends BaseScriptComponent {
  @input instantiator: Instantiator
  @input prefab: ObjectPrefab

  private hasInstantiated = false

  onAwake(): void {
    SessionController.getInstance().notifyOnReady(() => {
      this.instantiator.notifyOnReady(() => this.spawnLocal())
    })
  }

  private spawnLocal(): void {
    if (this.hasInstantiated) return
    if (!this.prefab) {
      print("[PerPlayerSpawner] prefab is null — wire it in the Inspector.")
      return
    }
    this.hasInstantiated = true

    this.instantiator.instantiate(this.prefab, {
      claimOwnership: true,
      persistence: "Owner",
      onError: (err: string) => {
        print("[PerPlayerSpawner] spawn failed: " + err)
        this.hasInstantiated = false
      },
    })
  }
}
