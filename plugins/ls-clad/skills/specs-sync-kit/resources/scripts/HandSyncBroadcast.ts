// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// HandSyncBroadcast.ts — per-connection RealtimeStore broadcast.
//
// Free-for-all unowned shared state where each user writes a key
// suffixed with their own connectionId (e.g., "conn-abc:handPos") and
// every device reads everyone's slices. Use for hand poses, cursor
// positions, per-user broadcasts, drawing strokes — anything where
// "every player publishes their slice; every player reads everyone's
// slices."
//
// Distinct from SyncEntity:
//   - SyncEntity is owned, authoritative, one-writer-at-a-time.
//   - RealtimeStore (this) is unowned, every device can write any key.
//
// Self-echo filtering: SessionController.onRealtimeStoreUpdated fires
// for every write including this device's own. Compare updateInfo
// .updaterInfo.connectionId to the local connectionId to skip self.
//
// Caveat for publisher-visible patterns (e.g. drawing strokes): the
// listener does NOT fire for the local device's own publishes. Hand
// poses don't need it — you already see your own hand from
// HandInputData directly. Drawing does — render locally on publish
// too, e.g. by calling a local renderer right after `publish()`.
// (See SKILL.md §10 "RealtimeStore is last-write-wins" for the
// related append-only pattern.)
//
// Late-joiner state: onRealtimeStoreUpdated only fires for writes that
// happen AFTER subscription. A user who joins mid-session won't see
// other users' existing slices via the listener. Call `readAll(suffix)`
// once after this script is ready to fetch every active user's current
// slice for a given suffix, and render those initial values yourself.
// After that, the listener handles further updates.
//
// Place at: Assets/Scripts/HandSyncBroadcast.ts, attach to ONE
// SceneObject under "Colocated World [CONFIGURE_ME] / EnableOnReady".
// Other scripts access via HandSyncBroadcast.instance.

import {SessionController} from "SpectaclesSyncKit.lspkg/Core/SessionController"

const STORE_ID = "HandSyncBroadcast"

type RemoteWriteListener = (
  connectionId: string,
  suffix: string,
  value: string,
) => void

@component
export class HandSyncBroadcast extends BaseScriptComponent {
  public static instance: HandSyncBroadcast | null = null

  private store: GeneralDataStore | null = null
  private listeners: RemoteWriteListener[] = []

  onAwake(): void {
    HandSyncBroadcast.instance = this
    SessionController.getInstance().notifyOnReady(() => this.setup())
  }

  private setup(): void {
    const session = SessionController.getInstance().getSession()
    if (!session) return

    // Listen for any device's writes to any RealtimeStore in this
    // session. Filter to our store only.
    //
    // Subscribe via SessionController, NOT via `session` — `MultiplayerSession`
    // exposes `onRealtimeStoreUpdated` only as an options callback at
    // session-creation time, not as a subscribable EventWrapper. The
    // subscribable event lives on SessionController, which internally
    // wires the MultiplayerSession options callback through to its own
    // EventWrapper (SpectaclesSyncKit.lspkg/Core/SessionController.ts).
    // Using `session.onRealtimeStoreUpdated.add(...)` here is a silent
    // no-op.
    SessionController.getInstance().onRealtimeStoreUpdated.add(
      (
        _session: MultiplayerSession,
        store: GeneralDataStore,
        key: string,
        updateInfo: ConnectedLensModule.RealtimeStoreUpdateInfo,
      ) => {
        const storeInfo = _session.getRealtimeStoreInfo(store)
        if (!storeInfo || storeInfo.storeId !== STORE_ID) return
        // Late-bind: if createOrFindStore couldn't attach (neither
        // initial scan nor error-recovery tryFindStore saw the
        // winner's store before our error returned), latch onto it
        // now that we're observing an update for our STORE_ID.
        // Without this, publish() and readAll() would silently no-op
        // for the rest of the session. Initial peer-slice state that
        // landed before this late-bind isn't replayed through the
        // listener — callers that need it should follow the
        // late-joiner pattern in the file header and call
        // readAll(suffix) after first attachment.
        if (!this.store) {
          this.store = store
        }
        // Skip self echoes. updaterInfo can be null for server-initiated
        // writes (lease maintenance, store-create handshakes); ?. lets
        // those updates fall through to the listeners as non-self events
        // instead of crashing this handler and silently breaking the
        // listener for the rest of the session. The `localId !==
        // undefined` guard prevents `undefined === undefined` from
        // accidentally filtering server-initiated updates when
        // getLocalUserInfo() returns null (mocked / pre-connection
        // states) — in that case we have no notion of "self" so the
        // safe behavior is always to fan out.
        const localId = SessionController.getInstance().getLocalUserInfo()?.connectionId
        if (localId !== undefined && updateInfo.updaterInfo?.connectionId === localId) return

        const value = store.has(key) ? store.getString(key) : ""
        const [connectionId, ...rest] = key.split(":")
        const suffix = rest.join(":")
        // Snapshot before fan-out so a listener that calls
        // removeRemoteWriteListener (or registers another) mid-fire
        // doesn't skip the next entry.
        for (const l of this.listeners.slice()) l(connectionId, suffix, value)
      },
    )

    this.createOrFindStore()
  }

  private createOrFindStore(): void {
    const session = SessionController.getInstance().getSession()
    if (!session) return

    if (this.tryFindStore(session)) return

    const opts = RealtimeStoreCreateOptions.create()
    opts.persistence = RealtimeStoreCreateOptions.Persistence.Session
    opts.ownership = RealtimeStoreCreateOptions.Ownership.Unowned
    opts.storeId = STORE_ID
    session.createRealtimeStore(
      opts,
      (store: GeneralDataStore) => {
        this.store = store
      },
      (err: string) => {
        // When multiple devices join the session simultaneously, they
        // all fail to find STORE_ID in the initial scan and race to
        // createRealtimeStore for the same storeId. One wins; the
        // others land here. Without recovery, this.store stays null
        // and every publish/readAll silently no-ops. By the time our
        // error fires, the winner's store has typically replicated
        // into allRealtimeStores, so a second scan lets us attach as
        // a late joiner.
        print("[HandSyncBroadcast] create failed (" + err + ") — attempting to recover as joiner.")
        if (!this.tryFindStore(session)) {
          print("[HandSyncBroadcast] could not recover store after create failure — broadcasts will silently no-op.")
        }
      },
    )
  }

  private tryFindStore(session: MultiplayerSession): boolean {
    for (const existing of session.allRealtimeStores) {
      const info = session.getRealtimeStoreInfo(existing)
      if (info && info.storeId === STORE_ID) {
        this.store = existing
        return true
      }
    }
    return false
  }

  // Publish the local user's slice. Key is automatically suffixed with
  // the local connectionId so each user's writes don't collide.
  public publish(suffix: string, value: string): void {
    if (!this.store) return
    const conn = SessionController.getInstance().getLocalUserInfo()?.connectionId
    if (!conn) return
    this.store.putString(conn + ":" + suffix, value)
  }

  // Read everyone's current slice for a suffix. Returns
  // map<connectionId, value>.
  public readAll(suffix: string): Map<string, string> {
    const result = new Map<string, string>()
    if (!this.store) return result
    const session = SessionController.getInstance().getSession()
    if (!session) return result
    for (const user of session.activeUsersInfo) {
      const key = user.connectionId + ":" + suffix
      if (this.store.has(key)) {
        result.set(user.connectionId, this.store.getString(key))
      }
    }
    return result
  }

  public addRemoteWriteListener(cb: RemoteWriteListener): void {
    this.listeners.push(cb)
  }

  // Unregister a previously-added remote-write listener. Call this from
  // the registering component's onDestroy so a long-lived
  // HandSyncBroadcast singleton doesn't keep invoking the callback
  // against destroyed state after the caller's lifecycle ends.
  // Idempotent — calling with a never-registered cb is a silent no-op.
  public removeRemoteWriteListener(cb: RemoteWriteListener): void {
    const idx = this.listeners.indexOf(cb)
    if (idx !== -1) {
      this.listeners.splice(idx, 1)
    }
  }
}
