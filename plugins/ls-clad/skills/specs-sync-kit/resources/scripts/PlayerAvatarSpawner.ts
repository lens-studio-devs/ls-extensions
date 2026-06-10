// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// PlayerAvatarSpawner.ts — every device spawns its own per-player avatar.
//
// Pair with PlayerAvatarController.ts on the prefab leaf. Each device
// runs instantiate() once after the chained
// SessionController.notifyOnReady → instantiator.notifyOnReady fires.
// The local user's identity rides along in customDataStore so the
// controller can identify itself on remote peers.
//
// `persistence: "Owner"` auto-destroys the avatar when the player
// disconnects. `overrideNetworkId` keeps the network ID stable across
// brief reconnects.
//
// Place at: Assets/Scripts/PlayerAvatarSpawner.ts, on a SceneObject
// under "Colocated World [CONFIGURE_ME] / EnableOnReady" that also
// holds an Instantiator component (with the avatar prefab in the
// Instantiator's Prefabs array).

import {Instantiator} from "SpectaclesSyncKit.lspkg/Components/Instantiator"
import {SessionController} from "SpectaclesSyncKit.lspkg/Core/SessionController"

@component
export class PlayerAvatarSpawner extends BaseScriptComponent {
  @input instantiator: Instantiator
  @input avatarPrefab: ObjectPrefab

  private hasInstantiated = false

  onAwake(): void {
    SessionController.getInstance().notifyOnReady(() => {
      this.instantiator.notifyOnReady(() => this.spawnLocalAvatar())
    })
  }

  private spawnLocalAvatar(): void {
    if (this.hasInstantiated) return
    if (!this.avatarPrefab) {
      print("[PlayerAvatarSpawner] avatarPrefab is null — wire it in the Inspector.")
      return
    }
    const local = SessionController.getInstance().getLocalUserInfo()
    if (!local) return
    this.hasInstantiated = true

    const data = GeneralDataStore.create()
    data.putString("displayName", local.displayName || "Player")
    data.putString("connectionId", local.connectionId || "")

    this.instantiator.instantiate(this.avatarPrefab, {
      claimOwnership: true,
      persistence: "Owner",
      customDataStore: data,
      // connectionId — unique per device per session. Do NOT use userId
      // as the primary: the same Snapchat account on two devices (or
      // two Preview panes in Lens Studio) shares one userId, so a
      // userId-keyed networkId collides — both devices "spawn" against
      // a single shared store, and neither cleanly owns it. With
      // `persistence: "Owner"` the avatar auto-destroys on disconnect,
      // so cross-reconnect stability via userId is not needed.
      overrideNetworkId: local.connectionId + "_avatar",
      onError: (err: string) => {
        print("[PlayerAvatarSpawner] spawn failed: " + err)
        this.hasInstantiated = false
      },
    })
  }
}
