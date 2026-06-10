// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// ManipulatablePiece.ts — movable game piece with cooperative ownership transfer.
//
// SyncTransform replicates the piece's position. SIK Manipulatable handles
// the local drag. The cooperative handoff: the local device calls
// requestOwnership on grab (onManipulationStart), and tryRevokeOwnership on
// drop (onManipulationEnd). The entity becomes unowned in the gap so the
// next grabber can claim it cleanly. Without the explicit release,
// requestOwnership is a one-time API per sync-entity.mdx — it silently drops
// when the entity is already owned, and the first grabber would own the
// piece for the rest of the session.
//
// Critical design choice — `setCanTranslate` stays `true` forever; we DO NOT
// gate ownership via canTranslate. SIK's InteractableManipulation has an
// Idle→Active state machine guarded by `hasActiveCapabilities() = enabled &&
// (canTranslate || canRotate || canScale)`. Pre-grab, 0 interactors are
// triggering, so `canRotate()` and `canScale()` both return false (both
// require ≥1 interactor — `canRotate` needs 2 or Direct-targeting; `canScale`
// needs 2). The capability set collapses to `enabled && canTranslate()`. If
// we set `canTranslate=false` while waiting for ownership, the Idle→Active
// gate never opens, `onManipulationStart` never fires, and cooperative grab
// CANNOT bootstrap (chicken-and-egg). This is the trap that earlier versions
// of this recipe fell into — see SKILL.md §10 "setCanTranslate(false) blocks
// SIK's Idle→Active state transition" for the full trace. Gate at the
// handler level: `onGrab` checks `doIOwnStore` before calling
// `requestOwnership`; the local drag during the brief unowned window is
// harmless because SyncTransform broadcasts only from the owner.
//
// Distinct from Collectible.ts's tryClaimOwnership:
//   - Collectible: competitive grab — first claim wins; SyncEntity gets destroyed.
//   - ManipulatablePiece: cooperative handoff — drop releases, next grabber
//     claims; piece persists across owners.
//
// Prefab requirements:
//   - RenderMeshVisual
//   - Physics.ColliderComponent with shape matching the visual mesh (Box for
//     a Box mesh) — required for the SIK pinch raycast. See "Common
//     mistakes" below.
//   - SIK Interactable
//   - SIK Manipulatable (Inspector: enable Translate)
//   - SyncTransform (Sync Settings: Position = Location)
//   - This script
//
// Common mistakes:
//   - Using a `Physics.BodyComponent` (e.g. from `BoxPhysicsObjectPreset`)
//     in place of `Physics.ColliderComponent`. The Body has a collider
//     shape, but SIK's Interactable raycast targets ColliderComponent
//     specifically — a body-only object silently fails to register as a
//     pinch target. `onManipulationStart` never fires. Use
//     `BoxMeshObjectPreset` + a manually-added ColliderComponent.
//   - Using a `Sphere` shape with `fitVisual:true` on a Box visual. The
//     bounding sphere doesn't cover the cube's corners and the raycast
//     frequently misses. Always set `shape.type = Box` when the visual is
//     a Box mesh. See SKILL.md §10 "shape type must match the visual mesh".
//   - Gating with `setCanTranslate(this.syncEntity.doIOwnStore())`. See the
//     chicken-and-egg note above. Gate at the handler level instead.
//
// Per-player / per-turn gating (e.g. turn-based games where only the
// current-turn player can interact): toggle the sibling `Interactable`
// component's `.enabled` flag per frame based on your predicate. That
// blocks the SIK raycast on disallowed devices without affecting
// `hasActiveCapabilities`, so the chicken-and-egg is avoided. See SKILL.md
// §10 "Interactable.enabled and setCanTranslate are independent gates".
//
// Per-piece LOCAL UX cues (hover halos, drag previews, snap-target
// highlights, "this is where it'll land" indicators) — gate these on
// `this.syncEntity.doIOwnStore()`, NOT on `isBeingManipulated` or "any
// free cube". The UpdateEvent that drives such cues runs on EVERY device
// that has a copy of the piece, including remote mirrors of someone
// else's drag. Remote-mirror positions drift via SyncTransform sampling
// (~10Hz), so unowner devices end up lighting different halos than the
// dragger sees — and those halos can persist past the snap commit because
// the next remote UpdateEvent re-lights them. The cube's owner is the
// active interactor; halos are *for* that user, not for remote
// spectators. `doIOwnStore` here serves its broader semantic — "am I the
// device actively driving this entity" — not just the write-gate role
// it plays in StorageProperty mutations. See SKILL.md §10 "Local UX cues
// must be doIOwnStore-gated" for the full failure mode and §8's
// Ownership APIs table for the dual semantic.
//
// Composition with Instantiator: if you spawn this prefab via Instantiator
// (rather than placing one statically under EnableOnReady), ALL of the
// requirements above must live on the PREFAB ASSET, not on a separate scene
// object. Instantiator only replicates the prefab's own components to peer
// devices; sibling-object wiring won't appear on other clients' spawned
// instances. See §6.3 composition note.
//
// Place at: Assets/Scripts/ManipulatablePiece.ts.

import {InteractableManipulation} from "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation"
import {SyncEntity} from "SpectaclesSyncKit.lspkg/Core/SyncEntity"

@component
export class ManipulatablePiece extends BaseScriptComponent {
  @input manipulatable: InteractableManipulation

  private syncEntity: SyncEntity

  onAwake(): void {
    // SyncTransform is a sibling component on this SceneObject. Defer the
    // SyncEntity lookup to OnStartEvent because awake order between sibling
    // components is undefined.
    this.createEvent("OnStartEvent").bind(() => this.init())
  }

  private init(): void {
    // Share SyncTransform's SyncEntity (the one that owns the position
    // prop). getSyncEntityOnSceneObject is the documented retrieval API.
    this.syncEntity = SyncEntity.getSyncEntityOnSceneObject(this.sceneObject)
    if (!this.syncEntity) {
      print("[ManipulatablePiece] no SyncEntity on SceneObject — ensure SyncTransform is attached.")
      return
    }

    this.syncEntity.notifyOnReady(() => this.onReady())
  }

  private onReady(): void {
    // canTranslate stays true forever — DO NOT toggle based on ownership
    // (the SIK Idle→Active gate would block onManipulationStart; see the
    // file header). Ownership is gated at the handler level in onGrab.
    if (this.manipulatable) {
      this.manipulatable.setCanTranslate(true)
      this.manipulatable.onManipulationStart.add(() => this.onGrab())
      this.manipulatable.onManipulationEnd.add(() => this.onRelease())
    }
  }

  private onGrab(): void {
    if (this.syncEntity.doIOwnStore()) return // already mine
    this.syncEntity.requestOwnership(
      undefined,
      (err) => print("[ManipulatablePiece] ownership claim failed: " + err),
    )
  }

  private onRelease(): void {
    if (!this.syncEntity.doIOwnStore()) return // nothing to release
    this.syncEntity.tryRevokeOwnership(
      undefined,
      (err) => print("[ManipulatablePiece] ownership release failed: " + err),
    )
  }
}
