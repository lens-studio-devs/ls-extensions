// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// SyncedTimer.ts — countdown synchronized across devices.
//
// Owner stores `endsAtServerSeconds` as a manualFloat on a single SyncEntity
// and computes `remaining = endsAt - getServerTimeInSeconds()` locally.
// The owner also broadcasts that remaining value via `broadcastRemaining`
// (manualFloat, rate-limited via sendsPerSecondLimit). Non-owners read the
// broadcast value directly instead of recomputing from getServerTimeInSeconds.
//
// Why the broadcast: on real Spectacles hardware connected to a real server,
// getServerTimeInSeconds() returns a consistent value across devices, so the
// local recompute path agrees with the owner's. BUT in Lens Studio Preview's
// mocked Connected Lens, each pane uses its own local clock as the server-
// time stand-in — two panes' getServerTimeInSeconds() values differ by their
// clock offsets, and the displayed remaining drifts between panes. Reading
// the owner-broadcast value keeps all panes consistent in Preview testing.
// See SKILL.md §10 "getServerTimeInSeconds() is not consistent across Lens
// Studio Preview panes in mocked multiplayer."
//
// onTick fires every frame for any registered listener; onExpire fires once
// when the timer crosses zero. Restart by calling start() again.
//
// Place at: Assets/Scripts/SyncedTimer.ts, attach to ONE SceneObject under
// "Colocated World [CONFIGURE_ME] / EnableOnReady". Other scripts access it
// via SyncedTimer.instance.

import {SessionController} from "SpectaclesSyncKit.lspkg/Core/SessionController"
import {StorageProperty} from "SpectaclesSyncKit.lspkg/Core/StorageProperty"
import {StoragePropertySet} from "SpectaclesSyncKit.lspkg/Core/StoragePropertySet"
import {SyncEntity} from "SpectaclesSyncKit.lspkg/Core/SyncEntity"

@component
export class SyncedTimer extends BaseScriptComponent {
  public static instance: SyncedTimer | null = null

  // Server-time deadline. -1 means "not running." Owner is the source of
  // truth for this value (the canonical recompute reference).
  private readonly endsAtProp = StorageProperty.manualFloat("endsAtServerSeconds", -1)
  // Owner-broadcast remaining seconds. Non-owners read this directly instead
  // of recomputing `endsAt - getServerTimeInSeconds()` locally, because Lens
  // Studio Preview's mocked Connected Lens gives each pane a different
  // local-clock-based server time → the local recompute drifts between
  // panes. On real hardware both paths agree; this broadcast just makes
  // Preview testing consistent too. -1 means "owner hasn't broadcast yet."
  private readonly broadcastRemainingProp = StorageProperty.manualFloat("broadcastRemaining", -1)
  private readonly syncEntity = new SyncEntity(
    this,
    new StoragePropertySet([this.endsAtProp, this.broadcastRemainingProp]),
    true,
    "Session",
  )

  private hasExpired = true
  private tickListeners: Array<(remaining: number) => void> = []
  private expireListeners: Array<() => void> = []

  onAwake(): void {
    SyncedTimer.instance = this
    // Rate-limit the broadcast so we don't blow the per-session 350-message-
    // per-5-second budget. 4/sec gives ~250ms display resolution on non-
    // owners, well below the budget even with other event traffic.
    this.broadcastRemainingProp.sendsPerSecondLimit = 4
    this.createEvent("UpdateEvent").bind(() => this.tick())
    this.endsAtProp.onAnyChange.add(() => {
      // Re-arm expire when a new deadline is set. If server time
      // isn't available yet, leave hasExpired alone — next tick will
      // resolve it once the server time comes online.
      const endsAt = this.endsAtProp.currentOrPendingValue ?? -1
      const now = SessionController.getInstance().getServerTimeInSeconds()
      if (now === null || now === undefined) return
      this.hasExpired = endsAt < 0 || endsAt <= now
    })
  }

  // Owner-only: start a new countdown.
  //
  // If you want ANY user to be able to start the timer (e.g. "any player
  // can start the round"), route the request from non-owners through a
  // networked event to the owner — same pattern as Scoreboard.addScore.
  // Wire it like this:
  //   - In onAwake, register:
  //       this.syncEntity.onEventReceived.add("startTimer", msg => {
  //         if (this.syncEntity.doIOwnStore())
  //           this.startAsOwner(msg.data.durationSec)
  //       })
  //   - In the public start():
  //       if (this.syncEntity.doIOwnStore()) this.startAsOwner(durationSec)
  //       else this.syncEntity.sendEvent("startTimer", { durationSec })
  // where startAsOwner is the body below (sets endsAtProp + hasExpired).
  public start(durationSec: number): void {
    if (!this.syncEntity.doIOwnStore()) {
      print("[SyncedTimer] not owner — cannot start. See file comment for the sendEvent routing pattern if any user should be able to start.")
      return
    }
    // getServerTimeInSeconds() returns `number | null` per
    // session-controller.mdx ("the current server timestamp in seconds,
    // or null if not available"). Falling back to 0 would set the
    // deadline to a tiny absolute timestamp (e.g. `0 + 30` = 30s past
    // epoch), making the timer report "expired" immediately and produce
    // a wrong getRemaining(). Refuse to start until server time lands.
    const now = SessionController.getInstance().getServerTimeInSeconds()
    if (now === null || now === undefined) {
      print("[SyncedTimer] server time not available yet — start ignored. Call again after SessionController.notifyOnReady.")
      return
    }
    this.endsAtProp.setPendingValue(now + durationSec)
    this.hasExpired = false
  }

  // Read remaining seconds. Returns 0 if expired or not running. Owner
  // computes locally from server time; non-owners read the owner's broadcast
  // (consistent across Preview panes in mocked multiplayer — see header).
  // Returns -1 if server time is unavailable ON THE OWNER (caller can treat
  // as "wait"); non-owners always return ≥ 0.
  public getRemaining(): number {
    if (this.syncEntity.doIOwnStore()) {
      return this.computeRemainingLocal()
    }
    const broadcast = this.broadcastRemainingProp.currentOrPendingValue
    if (broadcast === null || broadcast === undefined || broadcast < 0) return 0
    return broadcast
  }

  private computeRemainingLocal(): number {
    const endsAt = this.endsAtProp.currentOrPendingValue ?? -1
    if (endsAt < 0) return 0
    const now = SessionController.getInstance().getServerTimeInSeconds()
    if (now === null || now === undefined) return -1
    return Math.max(0, endsAt - now)
  }

  public addTickListener(cb: (remaining: number) => void): void {
    this.tickListeners.push(cb)
  }

  public addExpireListener(cb: () => void): void {
    this.expireListeners.push(cb)
  }

  public removeTickListener(cb: (remaining: number) => void): void {
    const idx = this.tickListeners.indexOf(cb)
    if (idx !== -1) {
      this.tickListeners.splice(idx, 1)
    }
  }

  public removeExpireListener(cb: () => void): void {
    const idx = this.expireListeners.indexOf(cb)
    if (idx !== -1) {
      this.expireListeners.splice(idx, 1)
    }
  }

  private tick(): void {
    // Owner: compute remaining locally and broadcast it. Non-owners just
    // read the latest broadcast via getRemaining().
    const remaining = this.syncEntity.doIOwnStore()
      ? this.computeRemainingLocal()
      : this.getRemaining()
    // -1 means server time isn't available yet on the owner; freeze the
    // timer for this frame so expire doesn't fire spuriously and
    // listeners don't get a bogus value. Non-owners never see -1.
    if (remaining < 0) return
    // Owner-only: push the canonical remaining into the broadcast prop.
    // Rate limit handled by sendsPerSecondLimit set in onAwake.
    if (this.syncEntity.doIOwnStore()) {
      this.broadcastRemainingProp.setPendingValue(remaining)
    }
    // Active correction: a positive remaining proves the timer is
    // running, so re-arm hasExpired in case the onAnyChange path
    // failed to set it. This catches late-joiners whose initial
    // state replication arrived BEFORE server time became available
    // (the onAnyChange handler early-returns in that case, leaving
    // hasExpired stuck at the initial `true` — without this
    // re-arm, expire would never fire when remaining crosses zero).
    if (remaining > 0) this.hasExpired = false
    // Snapshot before fan-out so a listener that calls removeTickListener
    // (or removeExpireListener in the expire branch) mid-fire — e.g. a
    // one-shot listener that unregisters itself after firing — doesn't
    // skip the next entry.
    for (const l of this.tickListeners.slice()) l(remaining)
    // Re-evaluate remaining instead of using the snapshot. A tickListener
    // may have called start(newDuration), which re-arms hasExpired=false
    // and updates endsAtProp synchronously. Using the snapshot (taken
    // before the listener ran) would see remaining <= 0 even though the
    // timer is now running with newDuration left, spuriously firing the
    // expireListeners on a freshly restarted timer.
    if (!this.hasExpired && this.getRemaining() <= 0) {
      this.hasExpired = true
      for (const l of this.expireListeners.slice()) l()
    }
  }
}
