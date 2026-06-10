// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// TransientController.ts — spawn-stream-fade pattern, prefab side.
//
// Attached to the leaf of a prefab spawned via TransientSpawner.ts.
// Owner-only: drives a fade by lerping the visual's color alpha from
// 1.0 to 0.0 over fadeDurationSec, then calls syncEntity.destroy() —
// which replicates to all peers via the SyncEntity's destruction event.
// The fade itself is local to each device (visual smoothness on the
// owner; peers see the spawn → destruction without the fade unless the
// prefab also has a SyncMaterials component to replicate baseColor).
//
// Prefab requirements:
//   - RenderMeshVisual (wired to visual @input below)
//   - This script
//
// Do NOT add SyncTransform to the prefab. The spawner's worldPosition
// in InstantiationOptions replicates the spawn position to all peers,
// and transients don't move after spawn. Adding SyncTransform would
// create a second SyncEntity on this SceneObject, conflicting with the
// one this script creates and silently breaking syncEntity.destroy().
// If you need a moving transient (rare), swap this for a different
// pattern that shares SyncTransform's SyncEntity via
// SyncEntity.getSyncEntityOnSceneObject.
//
// Place at: Assets/Scripts/TransientController.ts.

import {SyncEntity} from "SpectaclesSyncKit.lspkg/Core/SyncEntity"

@component
export class TransientController extends BaseScriptComponent {
  @input visual: RenderMeshVisual
  @input fadeDurationSec: number = 0.6

  // claimOwnership:true so the spawner's device wins ownership of this
  // leaf SyncEntity (peer devices' identical constructor calls queue
  // behind the spawner's claim and never fire because the entity
  // destroys before becoming unowned). Without this, doIOwnStore() is
  // false everywhere and the fade never runs.
  //
  // persistence:"Owner" matches the spawn's persistence — if the
  // spawner disconnects mid-fade, the entity auto-destroys for peers.
  private syncEntity: SyncEntity = new SyncEntity(this, null, true, "Owner")
  private elapsed = 0

  onAwake(): void {
    this.syncEntity.notifyOnReady(() => this.onReady())
  }

  private onReady(): void {
    if (!this.syncEntity.doIOwnStore()) return

    this.visual.mainMaterial = this.visual.mainMaterial.clone()

    // Owner runs the fade. Peers just see the synced spawn position
    // and (when we destroy) the synced destruction.
    this.createEvent("UpdateEvent").bind(() => this.fadeStep())
  }

  private fadeStep(): void {
    // After the final destroy() call, the UpdateEvent can still fire
    // one more time before the SceneObject is cleaned up. Guard against
    // re-entry so we don't double-destroy (which is unsafe per
    // sync-entity.mdx's `if (!this.syncEntity.destroyed)` guidance).
    // Also short-circuits the color writes once we're done fading.
    if (this.syncEntity.destroyed) return

    this.elapsed += getDeltaTime()
    const t = Math.min(1, this.elapsed / Math.max(0.001, this.fadeDurationSec))
    const alpha = 1 - t

    const color = this.visual.mainMaterial.mainPass.baseColor
    this.visual.mainMaterial.mainPass.baseColor = new vec4(
      color.x,
      color.y,
      color.z,
      alpha,
    )

    if (t >= 1) {
      this.syncEntity.destroy()
    }
  }
}
