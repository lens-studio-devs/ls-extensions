// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// PlayerAvatarController.ts — per-player avatar that follows the owner's head.
//
// Pair with PlayerAvatarSpawner.ts. The owner runs an UpdateEvent that
// lerps the avatar transform toward WorldCameraFinderProvider's
// position; peers receive the transform via the SyncTransform component
// on the prefab. The lerp smooths jitter and keeps the local avatar
// from being exactly at eye-position (which would clip the camera).
//
// SyncEntity ownership: the prefab leaf already has a SyncEntity from
// the SyncTransform component. We share it (via
// SyncEntity.getSyncEntityOnSceneObject) so we can check
// `networkRoot.locallyCreated` — the "this device spawned this prefab"
// gate. We do NOT use `doIOwnStore()` because SyncTransform constructs
// its SyncEntity with claimOwnership:false, so doIOwnStore() returns
// false on every device. Instantiator's claimOwnership flag claims the
// NetworkRoot, not the per-component SyncEntity.
// This avoids the "two SyncEntities on one SceneObject" anti-pattern.
//
// Prefab requirements:
//   - RenderMeshVisual or similar visible content (the avatar body)
//   - SyncTransform (Sync Settings: Position = Location, Rotation =
//     Location, Sends Per Second = 10–20) — provides the SyncEntity
//     this script shares.
//   - This script
//
// Place at: Assets/Scripts/PlayerAvatarController.ts.

import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {SyncEntity} from "SpectaclesSyncKit.lspkg/Core/SyncEntity"

const FOLLOW_OFFSET_FORWARD_CM = 50 // positive = in front of the user
const LERP_SPEED = 5

@component
export class PlayerAvatarController extends BaseScriptComponent {
  private cameraTransform: Transform =
    WorldCameraFinderProvider.getInstance().getTransform()

  private syncEntity: SyncEntity
  private previousPos: vec3 = vec3.zero()
  // Cached normalized horizontal forward. Used as the offset direction
  // each tick. Updated whenever the camera's projected horizontal forward
  // is non-degenerate; preserved (not zeroed) when the user looks
  // straight up/down so the avatar doesn't snap into the camera.
  // Initial default = world -Z; first non-degenerate tick overwrites it.
  private lastForward: vec3 = new vec3(0, 0, -1)

  onAwake(): void {
    // Defer to OnStartEvent so SyncTransform's SyncEntity is initialized.
    this.createEvent("OnStartEvent").bind(() => this.init())
  }

  private init(): void {
    this.syncEntity = SyncEntity.getSyncEntityOnSceneObject(this.sceneObject)
    if (!this.syncEntity) {
      print("[PlayerAvatarController] no SyncEntity on SceneObject — ensure SyncTransform is attached.")
      return
    }
    this.syncEntity.notifyOnReady(() => this.onReady())
  }

  private onReady(): void {
    if (!this.syncEntity.networkRoot?.locallyCreated) {
      // Peer: passive — SyncTransform on the prefab replicates position.
      return
    }

    // Spawner-only: drive position to follow the camera, offset forward.
    this.previousPos = this.cameraTransform.getWorldPosition()
    this.createEvent("UpdateEvent").bind(() => this.tick())
  }

  private tick(): void {
    // Project the camera's forward onto the horizontal (XZ) plane by
    // constructing a new vec3 with the y component zeroed. Lens
    // Studio's vec3 has no `.mult` method for component-wise
    // multiplication (the production scripts elsewhere in this
    // repo use .uniformScale for scalar multiplication and never
    // do component-wise mult), so calling .mult would throw a
    // TypeError on the very first frame and crash the UpdateEvent.
    //
    // The result must then be normalized — without normalization, the
    // offset distance shrinks with the camera's vertical tilt (and
    // collapses to 0 when the user looks straight up/down), which
    // would put the avatar right at the eye position and clip the
    // camera.
    const f = this.cameraTransform.forward
    const projected = new vec3(f.x, 0, f.z)
    // When the user looks nearly straight up/down, `projected` is
    // near-zero and can't be normalized meaningfully. Keep the previous
    // good forward so the avatar stays in front of where the user was
    // last looking horizontally, instead of snapping into the camera.
    if (projected.length > 0.001) {
      this.lastForward = projected.normalize()
    }
    const target = this.cameraTransform
      .getWorldPosition()
      .add(this.lastForward.uniformScale(FOLLOW_OFFSET_FORWARD_CM))
    const smoothed = vec3.lerp(this.previousPos, target, getDeltaTime() * LERP_SPEED)
    this.sceneObject.getTransform().setWorldPosition(smoothed)
    this.sceneObject.getTransform().setWorldRotation(this.cameraTransform.getWorldRotation())
    this.previousPos = smoothed
  }
}
