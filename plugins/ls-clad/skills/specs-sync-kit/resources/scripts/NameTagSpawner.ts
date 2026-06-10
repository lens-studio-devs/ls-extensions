// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// NameTagSpawner.ts — every device spawns its own name tag.
//
// Each device runs `instantiator.instantiate(...)` once when the session
// and Instantiator are both ready. The local user's connectionId/displayName
// ride along in a customDataStore so the spawned controller can identify
// itself for remote peers without a separate handshake.
// `persistence: "Owner"` auto-destroys the tag when this player disconnects.
// `overrideNetworkId` keeps the network ID stable across reconnects so a
// brief disconnect doesn't leave a stale label behind.
//
// Place at: Assets/Scripts/NameTagSpawner.ts, on a SceneObject under
// "Colocated World [CONFIGURE_ME] / EnableOnReady" that also holds an
// Instantiator component (with NameTagPrefab in the Instantiator's Prefabs
// array).

import {Instantiator} from "SpectaclesSyncKit.lspkg/Components/Instantiator"
import {SessionController} from "SpectaclesSyncKit.lspkg/Core/SessionController"

@component
export class NameTagSpawner extends BaseScriptComponent {
  // The Instantiator on the same SceneObject. The prefab is in the
  // Instantiator's Prefabs array (Inspector). We reference the prefab
  // here for the instantiate() call — both Inspector wirings are paired,
  // so forgetting one means forgetting the other (visible failure).
  @input instantiator: Instantiator
  @input nameTagPrefab: ObjectPrefab

  private hasInstantiated = false

  onAwake(): void {
    SessionController.getInstance().notifyOnReady(() => {
      this.instantiator.notifyOnReady(() => this.spawnLocalTag())
    })
  }

  private spawnLocalTag(): void {
    if (this.hasInstantiated) return
    if (!this.nameTagPrefab) {
      print("[NameTagSpawner] nameTagPrefab is null — wire it in the Inspector.")
      return
    }
    const session = SessionController.getInstance()
    const local = session.getLocalUserInfo()
    if (!local) {
      print("[NameTagSpawner] no local user info — skipping spawn.")
      return
    }
    this.hasInstantiated = true

    // Cascade through identity sources — pick the best available name at
    // spawn time and bake it into customDataStore so every peer (and the
    // local controller) reads it from one canonical channel. Matches the
    // "Sync Kit Think Out Loud" HeadLabelObjectManager pattern: in Lens
    // Studio Preview, `getLocalUserName()` / `displayName` can come back
    // empty when the pane has no Snapchatter identity, so userId is the
    // useful next step before any literal fallback.
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
      persistence: "Owner",
      customDataStore: data,
      // connectionId — unique per device per session. Do NOT use userId
      // as the primary: the same Snapchat account on two devices (or
      // two Preview panes in Lens Studio) shares one userId, so a
      // userId-keyed networkId collides — both devices "spawn" against
      // a single shared store, and neither cleanly owns it. With
      // `persistence: "Owner"` the tag auto-destroys on disconnect, so
      // cross-reconnect stability via userId is not needed.
      overrideNetworkId: local.connectionId + "_nameTag",
      onError: (err: string) => {
        print("[NameTagSpawner] instantiate failed: " + err)
        this.hasInstantiated = false
      },
    })
  }
}
