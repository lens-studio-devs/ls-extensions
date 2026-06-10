// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// MaterialColorSync.ts — automatic material color sync.
//
// Uses StorageProperty.forMeshVisualBaseColor — the owner writes the
// material color locally, SyncKit polls and replicates, peers' setter
// applies the received color back to their local material. No manual
// setPendingValue.
//
// Set `clone: true` if multiple instances share the same source
// material — without it, all instances would share state because they
// share the material asset. With clone, each instance gets its own
// material copy applied back to the visual.
//
// Place at: Assets/Scripts/MaterialColorSync.ts, attach to a SceneObject
// with a RenderMeshVisual under "Colocated World [CONFIGURE_ME] /
// EnableOnReady".

import {StorageProperty} from "SpectaclesSyncKit.lspkg/Core/StorageProperty"
import {StoragePropertySet} from "SpectaclesSyncKit.lspkg/Core/StoragePropertySet"
import {StorageTypes} from "SpectaclesSyncKit.lspkg/Core/StorageTypes"
import {SyncEntity} from "SpectaclesSyncKit.lspkg/Core/SyncEntity"

@component
export class MaterialColorSync extends BaseScriptComponent {
  @input visual: RenderMeshVisual

  // If multiple SceneObjects share the same source material asset,
  // set this true so each instance gets a unique cloned material applied.
  @input cloneMaterial: boolean = false

  private colorProperty: StorageProperty<StorageTypes.vec4>
  private syncEntity: SyncEntity

  onAwake(): void {
    // Construct in onAwake so @input visual is wired.
    this.colorProperty = StorageProperty.forMeshVisualBaseColor(
      this.visual,
      this.cloneMaterial,
    )
    this.syncEntity = new SyncEntity(
      this,
      new StoragePropertySet([this.colorProperty]),
      true,
      "Session",
    )
  }

  // Owner-only: change the color. Owner write → forMeshVisualBaseColor
  // polls → replicates → peers' setter applies it back.
  //
  // If you want ANY user to be able to change the color (e.g. multiplayer
  // paint), don't call setColor directly from non-owners. Instead, route
  // the request through a networked event to the owner (same pattern as
  // Scoreboard.addScore in resources/scripts/Scoreboard.ts):
  //   - Non-owner: this.syncEntity.sendEvent("setColor", { color })
  //   - Owner-side handler: onEventReceived.add("setColor", msg => {
  //       if (this.syncEntity.doIOwnStore())
  //         this.visual.mainMaterial.mainPass.baseColor = msg.data.color
  //     })
  // The owner then applies the write and forMeshVisualBaseColor replicates
  // to everyone else.
  public setColor(color: vec4): void {
    if (!this.syncEntity.doIOwnStore()) {
      print("[MaterialColorSync] not owner — color change ignored. See file comment for the routing pattern if any user should be able to change color.")
      return
    }
    this.visual.mainMaterial.mainPass.baseColor = color
  }
}
