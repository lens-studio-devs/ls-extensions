// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// MultiStatePlayerLabel.ts — extended per-player label with multi-prop state.
//
// Extends the basic name-tag pattern (NameTagController.ts) with
// additional state props: userName (string), statusText (string),
// availability (int — e.g., 0=offline, 1=busy, 2=available), pingState
// (bool — flashing indicator). Demonstrates mixed-type sync via
// addStorageProperty on a shared SyncEntity, with per-prop onAnyChange
// listeners.
//
// SyncEntity ownership: like NameTagController, this script shares the
// SyncEntity provided by the prefab's SyncTransform component via
// SyncEntity.getSyncEntityOnSceneObject — one SyncEntity per SceneObject.
//
// Use this when a single Text label isn't enough (e.g., "Alice —
// available — typing…", or game-lobby cards showing status pips).
//
// Prefab requirements:
//   - Text components: userNameText, statusTextText (both @input)
//   - SyncTransform (Sync Settings: Position = Location, Rotation =
//     Location) — provides the SyncEntity this script shares.
//   - Optional: a "ping" indicator SceneObject toggled by pingState
//   - This script
//
// Lookup and prop construction happen in OnStartEvent (not onAwake)
// because sibling-component awake order is undefined.
//
// Place at: Assets/Scripts/MultiStatePlayerLabel.ts. Pair with
// NameTagSpawner.ts (or its sibling avatar spawner) that knows to
// instantiate this prefab.

import {SessionController} from "SpectaclesSyncKit.lspkg/Core/SessionController"
import {StorageProperty} from "SpectaclesSyncKit.lspkg/Core/StorageProperty"
import {StorageTypes} from "SpectaclesSyncKit.lspkg/Core/StorageTypes"
import {SyncEntity} from "SpectaclesSyncKit.lspkg/Core/SyncEntity"

export const AVAILABILITY_OFFLINE = 0
export const AVAILABILITY_BUSY = 1
export const AVAILABILITY_AVAILABLE = 2

@component
export class MultiStatePlayerLabel extends BaseScriptComponent {
  @input userNameText: Text
  @input statusTextText: Text
  @input pingIndicator: SceneObject

  private userNameProp: StorageProperty<StorageTypes.string>
  private statusProp: StorageProperty<StorageTypes.string>
  private availabilityProp: StorageProperty<StorageTypes.int>
  private pingStateProp: StorageProperty<StorageTypes.bool>
  private syncEntity: SyncEntity

  // External observers for the availability prop. Availability is an
  // application concept (lobby badges, status pips, etc.) with no
  // built-in renderer in this recipe — callers register here to react.
  // Without this, setAvailability writes are synced over the network
  // but invisible to any peer because the prop is private.
  private availabilityListeners: Array<(value: number) => void> = []
  // Tracks whether onReady has run. Lens Studio's sibling component
  // initialization order is undefined, so external observers commonly
  // register addAvailabilityListener AFTER this component's onReady
  // executes. The flag lets addAvailabilityListener honor its docstring
  // promise — fire once on first ready with the current value — even
  // for late registrations.
  private isReady = false

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.init())
  }

  private init(): void {
    this.syncEntity = SyncEntity.getSyncEntityOnSceneObject(this.sceneObject)
    if (!this.syncEntity) {
      print("[MultiStatePlayerLabel] no SyncEntity on SceneObject — ensure SyncTransform is attached.")
      return
    }

    this.userNameProp = StorageProperty.manualString("userName", "Player")
    this.statusProp = StorageProperty.manualString("statusText", "")
    this.availabilityProp = StorageProperty.manualInt("availability", AVAILABILITY_AVAILABLE)
    this.pingStateProp = StorageProperty.manualBool("pingState", false)

    this.syncEntity.addStorageProperty(this.userNameProp)
    this.syncEntity.addStorageProperty(this.statusProp)
    this.syncEntity.addStorageProperty(this.availabilityProp)
    this.syncEntity.addStorageProperty(this.pingStateProp)

    // onAnyChange fires on every device including the writer, so
    // repaints happen everywhere consistently.
    this.userNameProp.onAnyChange.add((v: string) => this.renderUserName(v))
    this.statusProp.onAnyChange.add((v: string) => this.renderStatus(v))
    this.pingStateProp.onAnyChange.add((v: boolean) => this.renderPingIndicator(v))
    // No built-in renderer for availability — fan out to external
    // observers registered via addAvailabilityListener. Iterate over
    // a snapshot so a listener calling removeAvailabilityListener
    // mid-fire doesn't skip the next entry.
    this.availabilityProp.onAnyChange.add((v: number) => {
      for (const l of this.availabilityListeners.slice()) l(v)
    })

    this.syncEntity.notifyOnReady(() => this.onReady())
  }

  private onReady(): void {
    // Initial render from currentOrPendingValue (currentValue may be
    // null for the very first joiner).
    this.renderUserName(this.userNameProp.currentOrPendingValue ?? "Player")
    this.renderStatus(this.statusProp.currentOrPendingValue ?? "")
    this.renderPingIndicator(this.pingStateProp.currentOrPendingValue ?? false)
    // Notify external observers of the initial availability value so a
    // late joiner gets the current state, not just future changes.
    const initialAvail = this.availabilityProp.currentOrPendingValue ?? AVAILABILITY_AVAILABLE
    this.isReady = true
    // Snapshot before iterating in case a listener unregisters itself
    // mid-fire (see also the onAnyChange handler in init).
    for (const l of this.availabilityListeners.slice()) l(initialAvail)

    // Use networkRoot.locallyCreated (true only on the device that
    // called instantiate()) instead of syncEntity.doIOwnStore(). The
    // shared SyncTransform SyncEntity is constructed with
    // claimOwnership:false, so doIOwnStore() returns false on every
    // device — Instantiator's claimOwnership flag claims the NetworkRoot,
    // not the per-component SyncEntity. `locallyCreated` is the correct
    // "this device spawned this prefab" gate.
    if (!this.syncEntity.networkRoot?.locallyCreated) return

    // Spawner-only: seed the userName from the local user's displayName.
    const name = SessionController.getInstance().getLocalUserName() ?? "Player"
    this.userNameProp.setPendingValue(name)
  }

  // Public mutators (spawner-only — see onReady for why). Non-spawners
  // must route through sendEvent or via host-arbitrated state.
  public setStatus(text: string): void {
    if (!this.syncEntity?.networkRoot?.locallyCreated) return
    this.statusProp.setPendingValue(text)
  }

  public setAvailability(value: number): void {
    if (!this.syncEntity?.networkRoot?.locallyCreated) return
    this.availabilityProp.setPendingValue(value)
  }

  public setPing(active: boolean): void {
    if (!this.syncEntity?.networkRoot?.locallyCreated) return
    this.pingStateProp.setPendingValue(active)
  }

  // Public — read current availability (returns AVAILABILITY_AVAILABLE
  // as the default if not yet synced).
  public getAvailability(): number {
    return this.availabilityProp?.currentOrPendingValue ?? AVAILABILITY_AVAILABLE
  }

  // Register an observer for availability changes. Fires on each
  // change AND once on first ready with the current value (so callers
  // get late-joiner state without a separate query). Late registrations
  // — after onReady has already run — get the current value immediately
  // via the isReady gate, since their cb would otherwise miss the
  // one-shot fan-out inside onReady.
  public addAvailabilityListener(cb: (value: number) => void): void {
    this.availabilityListeners.push(cb)
    if (this.isReady) {
      cb(this.getAvailability())
    }
  }

  // Unregister a previously-added availability listener. Call this from
  // the registering component's onDestroy (or equivalent cleanup hook)
  // so a long-lived MultiStatePlayerLabel doesn't keep invoking the
  // callback against destroyed state after the caller's lifecycle ends.
  // Idempotent — calling with a never-registered cb is a silent no-op.
  public removeAvailabilityListener(cb: (value: number) => void): void {
    const idx = this.availabilityListeners.indexOf(cb)
    if (idx !== -1) {
      this.availabilityListeners.splice(idx, 1)
    }
  }

  private renderUserName(v: string): void {
    if (this.userNameText) this.userNameText.text = v
  }

  private renderStatus(v: string): void {
    if (this.statusTextText) this.statusTextText.text = v
  }

  private renderPingIndicator(v: boolean): void {
    if (this.pingIndicator) this.pingIndicator.enabled = v
  }
}
