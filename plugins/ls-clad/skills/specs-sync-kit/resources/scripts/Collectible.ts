// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// Collectible.ts — per-instance claim-and-destroy pickup.
//
// On local pinch, tryClaimOwnership() serializes destruction through a
// single device. If two players pinched at the same moment, only the
// first claim succeeds; the other's callback never fires, so the
// SceneObject only gets destroyed once.
//
// Prefab requirements (failure modes if missing):
//   - RenderMeshVisual — the visible mesh.
//   - Interactable (SIK) — pinch detection.
//   - Physics.ColliderComponent (Box or Sphere, sized to the mesh) —
//     REQUIRED for pinch raycast hit-testing. Without it, pinches go
//     straight through and onTriggerStart never fires.
//   - This script.
//
// Do NOT add SyncTransform to the collectible prefab. The spawner passes
// worldPosition in InstantiationOptions and the Instantiator replicates
// the spawn position to all peers — collectibles don't move after spawn,
// so no per-frame transform sync is needed. Adding SyncTransform puts a
// second SyncEntity on the same SceneObject, which conflicts with this
// script's SyncEntity and silently breaks tryClaimOwnership.
//
// Place at: Assets/Scripts/Collectible.ts, attached to the leaf SceneObject
// of the collectible prefab.

import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {SyncEntity} from "SpectaclesSyncKit.lspkg/Core/SyncEntity"
import {Scoreboard} from "./Scoreboard"

const DETACH_EVENT = "detach-before-destroy"

@component
export class Collectible extends BaseScriptComponent {
  @input interactable: Interactable

  // Per-instance SyncEntity. claimOwnership:false because Instantiator
  // already claimed the NetworkRoot on the spawner's device; this leaf
  // entity is unowned until tryClaimOwnership succeeds on a collect.
  private syncEntity: SyncEntity = new SyncEntity(this, null, false)

  // Guards against re-entry during the 0.1s destroy delay. Without this,
  // a user who pinches the same coin again before destroy() fires would
  // trigger tryClaimOwnership's immediate-success path (per
  // sync-entity.mdx: "This will also immediately callback with success
  // if the local user already owns it"), credit a second score, and
  // schedule a second destroy on the already-destroyed entity.
  private isCollecting = false

  onAwake(): void {
    this.syncEntity.notifyOnReady(() => this.onReady())
  }

  private onReady(): void {
    if (this.interactable) {
      this.interactable.onTriggerStart.add(() => this.onLocalPinch())
    }

    // Detach this device's local leaf from its NetworkRoot wrapper when
    // the picker broadcasts the detach event. By the time the per-instance
    // store deletion propagates (~0.1s later), every device's leaf is
    // already detached, so the host's NetworkRootInfo.finishSetup
    // child-OnDestroy handler (owner-only — bound when canIModifyStore()
    // is true, which on the spawner side is true because the Instantiator
    // uses claimOwnership:true) sees `child.hasParent() === false` and
    // skips the failing `child.removeParent()` call that would otherwise
    // log "Cannot reparent a SceneObject being destroyed".
    this.syncEntity.onEventReceived.add(DETACH_EVENT, () => {
      if (this.sceneObject.hasParent()) {
        this.sceneObject.removeParent()
      }
    })
  }

  private onLocalPinch(): void {
    if (this.isCollecting) return
    this.isCollecting = true
    this.syncEntity.tryClaimOwnership(
      () => {
        const team = Scoreboard.instance?.getLocalTeam() ?? ""
        if (team) Scoreboard.instance!.addScore(team, 1)

        // Broadcast detach to every device (including the local sender —
        // sendEvent's `onlySendRemote` is false by default). The handler
        // installed in onReady detaches each device's local leaf BEFORE
        // the destroy cascade reaches it, suppressing the warning that
        // fires on the host's finishSetup handler when a non-host
        // pickup's _onRemoteDestroy destroys the still-parented child.
        this.syncEntity.sendEvent(DETACH_EVENT, {})

        // Brief delay so the score update lands AND the detach event
        // propagates to peers before the destroy. Destroying the
        // per-instance SyncEntity deletes its store and (via
        // SyncEntity.destroy → localScript.getSceneObject().destroy())
        // destroys the leaf SceneObject — propagating to peers via
        // _onRemoteDestroy.
        const delay = this.createEvent("DelayedCallbackEvent")
        delay.bind(() => this.syncEntity.destroy())
        delay.reset(0.1)
      },
      (err) => {
        // Claim failed (rare — usually a transient network error).
        // Reset the flag so the user can try the pinch again.
        this.isCollecting = false
        print("[Collectible] claim failed: " + err)
      },
    )
  }
}
