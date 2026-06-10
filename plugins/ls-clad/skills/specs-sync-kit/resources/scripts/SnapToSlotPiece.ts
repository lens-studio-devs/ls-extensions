// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// SnapToSlotPiece.ts — extends ManipulatablePiece with slot-locking semantics.
//
// Pattern: ManipulatablePiece + a discrete "which slot am I in?" StorageProperty
// + a release-time snap-to-nearest-target search. Use this when a draggable
// shared piece should lock to one of N discrete target positions when released
// near them (Lego-like building, jigsaw puzzles, Sokoban-style placement,
// inventory slots, board-game pieces snapping to grid intersections).
//
// What this adds on top of ManipulatablePiece:
//   1. A `slotIndex` StorageProperty (`manualInt`, default -1 = free).
//   2. On release, search local target list for nearest matching candidate
//      within SNAP_RADIUS_CM; if found, set slotIndex and snap position.
//   3. Per-frame `Interactable.enabled = !isPlaced` gate so placed pieces
//      can't be re-grabbed until slotIndex flips back to -1 (e.g. by a reset).
//   4. Optional owner-gated hover preview (halo glow on the would-snap target).
//      MUST be gated on `doIOwnStore()` — see "Hover must be owner-only" below.
//   5. Slot-anchored position derivation on EVERY device. When slotIndex
//      changes via SyncKit, every device locally moves the piece to that
//      slot's world position. This is the authoritative position source —
//      bypasses SyncTransform's sampling race around the ownership handoff
//      that happens at commit time.
//
// Why slot-anchored position, not SyncTransform alone:
//   The snap commit sequence on the owner is (a) setWorldPosition, (b)
//   slotIndexProp.setPendingValue(N), (c) tryRevokeOwnership. SyncTransform
//   broadcasts position at ~10Hz; the new snapped position may not reach
//   remotes before ownership is revoked. Worse, a stale mid-drag SyncTransform
//   message can land on the remote AFTER slotIndex changed and overwrite the
//   snapped position. The discrete slotIndex StorageProperty is reliable; use
//   it as the authoritative anchor and derive position locally on every device.
//
// Hover must be owner-only:
//   The hover halo is a local UX cue for the player dragging the piece.
//   Remote devices (mirror copies of someone else's drag) follow the piece's
//   position via SyncTransform, which drifts slightly from the owner's view.
//   If hover runs on remote mirrors too, they light up DIFFERENT halos based
//   on their drift-different position. Gate hover detection on
//   `this.syncEntity.doIOwnStore()` — only the dragger's device touches halo
//   state. See SKILL.md §10 "Local UX cues must be doIOwnStore-gated".
//
// Target list:
//   The recipe is target-list-shape-agnostic. You supply a `findNearestTarget`
//   callback that returns `{ slotIndex, worldPosition } | null` based on the
//   piece's current world position. For a typical setup with N pre-spawned
//   target SceneObjects (e.g. blueprint ghost cubes, board squares), maintain
//   an array on a controller and pass a callback that scans + color-matches +
//   excludes-already-filled-slots.
//
// Prefab requirements (extends ManipulatablePiece's requirements):
//   - RenderMeshVisual, Physics.ColliderComponent (Box matching visual), SIK
//     Interactable, SIK InteractableManipulation (Translate enabled),
//     SyncTransform (Position = Location).
//   - This script.
//   - Optional: an AudioComponent for snap SFX.
//
// Composition: instantiate via Instantiator from a spawner (e.g. PersistentSpawner)
// with `Spawn As Children: true` AND `Spawn Under Parent` set to a SceneObject
// inside ColocatedWorld's subtree (see §10 LocatedAtComponent pitfall).
//
// Reset semantics: when the host clears the game state (e.g. character
// selection → -1), the upstream controller should call
// `syncEntity.destroy()` on each piece this device owns (gate on
// `doIOwnStore()`). Don't destroy non-owned pieces — the network will
// cascade the destroy when each owner does its own teardown.
//
// Place at: Assets/Scripts/SnapToSlotPiece.ts.

import {Interactable}
  from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {InteractableManipulation}
  from "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation"
import {StorageProperty} from "SpectaclesSyncKit.lspkg/Core/StorageProperty"
import {StorageTypes} from "SpectaclesSyncKit.lspkg/Core/StorageTypes"
import {SyncEntity} from "SpectaclesSyncKit.lspkg/Core/SyncEntity"

// A snap target. Caller-defined; the recipe only needs the slot's stable
// integer index (becomes the slotIndex StorageProperty value) and its
// current world position. Use a stable index even when target SceneObjects
// move — it's the cross-device identifier.
export type SnapTarget = {
  slotIndex: number
  worldPosition: vec3
}

// Caller-supplied predicates. Both run on the OWNING device only.
export interface SnapTargetSource {
  // Return the best matching target within snap radius, or null. Caller
  // applies any per-piece filters (color match, type match, occupancy).
  findNearestTarget(pieceWorldPosition: vec3, radiusCm: number): SnapTarget | null

  // Look up a slot by its index — used by every device to derive position
  // when slotIndex changes via SyncKit. Returns null if the slot is unknown
  // on this device (e.g. character not yet selected).
  getTargetByIndex(slotIndex: number): SnapTarget | null
}

const SNAP_RADIUS_CM = 8.0

@component
export class SnapToSlotPiece extends BaseScriptComponent {
  // The caller wires this to a controller that knows how to find / resolve
  // targets. We don't use @input here because the target source is typically
  // a singleton-like controller set programmatically.
  public targetSource: SnapTargetSource | null = null

  private syncEntity!: SyncEntity
  // `StorageProperty<StorageTypes.int>` — NOT `StorageProperty<number>`.
  // Since SyncKit v1.3.6064068+, primitive type names don't satisfy the
  // StorageTypes generic constraint. See SKILL.md §10.
  private slotIndexProp!: StorageProperty<StorageTypes.int>
  private interactable: Interactable | null = null
  private manipulation: InteractableManipulation | null = null
  private isBeingManipulated: boolean = false

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.init())
  }

  private init(): void {
    // Share SyncTransform's SyncEntity (avoid two-SyncEntities-on-one-SceneObject;
    // see SKILL.md §10).
    const e = SyncEntity.getSyncEntityOnSceneObject(this.sceneObject)
    if (!e) {
      print("[SnapToSlotPiece] no SyncEntity — ensure SyncTransform is attached.")
      return
    }
    this.syncEntity = e

    // slotIndex defaults to -1 (free). Becomes ≥0 when locked into a target.
    this.slotIndexProp = StorageProperty.manualInt("slotIndex", -1)
    this.syncEntity.addStorageProperty(this.slotIndexProp)

    this.interactable = this.sceneObject.getComponent(Interactable.getTypeName()) as Interactable | null
    this.manipulation = this.sceneObject.getComponent(InteractableManipulation.getTypeName()) as InteractableManipulation | null

    this.syncEntity.notifyOnReady(() => this.onReady())

    // Per-frame Interactable.enabled gate (placed → not grabbable; see SKILL.md §10
    // "Interactable.enabled and setCanTranslate are independent gates").
    this.createEvent("UpdateEvent").bind(() => this.tick())
  }

  private onReady(): void {
    // Slot-anchored position: on EVERY device, when slotIndex flips to a
    // valid slot, locally move the piece to that slot's world position.
    // This is the authoritative position source — see file header.
    this.slotIndexProp.onAnyChange.add((newSlot: number) => {
      if (newSlot >= 0 && this.targetSource) {
        const t = this.targetSource.getTargetByIndex(newSlot)
        if (t) this.sceneObject.getTransform().setWorldPosition(t.worldPosition)
      }
    })

    // Handler-level ownership gating (canTranslate stays true — see
    // ManipulatablePiece.ts header for the SIK Idle→Active chicken-and-egg).
    if (this.manipulation) {
      this.manipulation.onManipulationStart.add(() => this.onGrab())
      this.manipulation.onManipulationEnd.add(() => this.onRelease())
    }
  }

  private onGrab(): void {
    this.isBeingManipulated = true

    if (!this.syncEntity.doIOwnStore()) {
      // Cooperative grab — request ownership. The local drag during the
      // brief unowned window is harmless because SyncTransform broadcasts
      // only from the owner.
      this.syncEntity.requestOwnership(
        undefined,
        (err) => {
          print("[SnapToSlotPiece] ownership request failed: " + err)
          this.isBeingManipulated = false
        },
      )
    }

    // If this piece was placed, mark the slot free as we lift it.
    // `currentOrPendingValue` is `number | null`; narrow with typeof before comparing.
    const currentSlot = this.slotIndexProp.currentOrPendingValue
    if (typeof currentSlot === "number" && currentSlot >= 0 && this.syncEntity.doIOwnStore()) {
      this.slotIndexProp.setPendingValue(-1)
    }
  }

  private onRelease(): void {
    this.isBeingManipulated = false

    if (!this.syncEntity.doIOwnStore()) return  // not ours to commit
    if (!this.targetSource) {
      this.syncEntity.tryRevokeOwnership()
      return
    }

    // Release-time snap search.
    const myPos = this.sceneObject.getTransform().getWorldPosition()
    const target = this.targetSource.findNearestTarget(myPos, SNAP_RADIUS_CM)
    if (target) {
      // Position update via slotIndex's onAnyChange (runs on every device,
      // including this owner — anchors to the slot's authoritative position).
      this.slotIndexProp.setPendingValue(target.slotIndex)
    }

    // Release so other players can grab next.
    this.syncEntity.tryRevokeOwnership()
  }

  private tick(): void {
    if (!this.interactable || !this.slotIndexProp) return

    const slot = this.slotIndexProp.currentOrPendingValue
    const isPlaced = typeof slot === "number" && slot >= 0

    // Per-frame Interactable.enabled gate. Mid-drag stays enabled (manipulation
    // would otherwise abort); otherwise enabled = !isPlaced.
    if (this.isBeingManipulated) {
      this.interactable.enabled = true
    } else {
      this.interactable.enabled = !isPlaced
    }

    // Hover preview hook — owner-only. Subclass / caller can override
    // updateHoverPreview() to light up the would-snap target visually. The
    // gating on doIOwnStore() prevents remote mirrors from lighting halos
    // based on their drift-different view of the piece's position.
    const ownsThisPiece = this.syncEntity && this.syncEntity.doIOwnStore()
    if (!isPlaced && ownsThisPiece && this.targetSource) {
      this.updateHoverPreview()
    } else {
      this.clearHoverPreview()
    }
  }

  // Override or augment in a subclass / via a sibling component if you want
  // a hover halo, scale pulse, or other visual cue while dragging. Default
  // is a no-op so the recipe stays minimal — the caller decides what "show
  // me where this will snap" looks like.
  protected updateHoverPreview(): void {
    /* override me — call this.targetSource.findNearestTarget(...) and apply
       a local visual effect to the result. Owner-only by construction. */
  }

  protected clearHoverPreview(): void {
    /* override me — undo whatever updateHoverPreview lit up. Called when
       the piece is placed, not held, or ownership transferred away. */
  }
}
