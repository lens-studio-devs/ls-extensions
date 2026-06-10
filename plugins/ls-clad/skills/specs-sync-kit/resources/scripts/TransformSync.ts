// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// TransformSync.ts — script-driven transform sync for a SceneObject.
//
// When to use:
//   - You need scripted control over WHICH axes sync and WHEN.
//   - Bind position/rotation/scale to colocated coordinates explicitly.
//
// When NOT to use:
//   - For the simple case, attach the SyncTransform component on the
//     SceneObject (Inspector: Sync Settings = Location per axis, Sends
//     Per Second, Use Smoothing). No code required.
//
// Place at: Assets/Scripts/TransformSync.ts, attach to any SceneObject
// under "Colocated World [CONFIGURE_ME] / EnableOnReady". The SyncEntity
// constructor with claimOwnership:true means the first joiner becomes
// the writer; peers receive the synced transform.

import {StorageProperty, PropertyType} from "SpectaclesSyncKit.lspkg/Core/StorageProperty"
import {StoragePropertySet} from "SpectaclesSyncKit.lspkg/Core/StoragePropertySet"
import {StorageTypes} from "SpectaclesSyncKit.lspkg/Core/StorageTypes"
import {SyncEntity} from "SpectaclesSyncKit.lspkg/Core/SyncEntity"

@component
export class TransformSync extends BaseScriptComponent {
  private positionProp: StorageProperty<StorageTypes.vec3>
  private rotationProp: StorageProperty<StorageTypes.quat>
  private syncEntity: SyncEntity

  onAwake(): void {
    // Construct in onAwake — inline class-field initializers run before
    // Lens Studio finishes attaching the script to its SceneObject, so
    // this.getTransform() can return null there and crash forPosition /
    // forRotation. Same deferral MaterialColorSync uses for its @input.
    this.positionProp = StorageProperty.forPosition(
      this.getTransform(),
      PropertyType.Location,
    )
    // PropertyType.Location syncs relative to the co-located coordinate
    // space — the correct choice for colocated multiplayer (matches
    // positionProp above). PropertyType.Local is parent-relative (wrong
    // for colocation), PropertyType.World is Spectacles-world-origin
    // (explicitly not recommended for colocation per
    // storage-properties.mdx). Do not change to PropertyType.Rotation —
    // that's not a documented enum value and would break sync.
    this.rotationProp = StorageProperty.forRotation(
      this.getTransform(),
      PropertyType.Location,
    )
    this.syncEntity = new SyncEntity(
      this,
      new StoragePropertySet([this.positionProp, this.rotationProp]),
      true,
      "Session",
    )
    this.syncEntity.notifyOnReady(() => this.onReady())
  }

  private onReady(): void {
    print("[TransformSync] ready, owner = " + this.syncEntity.doIOwnStore())
  }
}
