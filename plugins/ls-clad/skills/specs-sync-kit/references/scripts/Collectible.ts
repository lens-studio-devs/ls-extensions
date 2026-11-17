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
//   - Interactable (InteractionKit) — pinch detection.
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

import {Interactable} from "InteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {SyncEntity} from "SyncKit.lspkg/Core/SyncEntity"
import {Scoreboard} from "./Scoreboard"

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
  }

  private onLocalPinch(): void {
    if (this.isCollecting) return
    this.isCollecting = true
    this.syncEntity.tryClaimOwnership(
      () => {
        const team = Scoreboard.instance?.getLocalTeam() ?? ""
        if (team) Scoreboard.instance!.addScore(team, 1)

        // Brief delay so the score update lands before the destroy.
        // SyncEntity.destroy() destroys the leaf SceneObject and deletes
        // its store, which removes the collectible on every peer.
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
