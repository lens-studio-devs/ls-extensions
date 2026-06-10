// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// UIKitSharedControls.ts — shared UI controls via GeneralDataStore.
//
// Free-for-all unowned shared state where any user can change any
// control and everyone sees the update. Demonstrates the
// RealtimeStore (not SyncEntity) pattern with:
//   - RealtimeStoreCreateOptions.create() → Persistence.Session,
//     Ownership.Unowned.
//   - session.createRealtimeStore + SessionController.onRealtimeStoreUpdated.
//     (Subscribe via SessionController, not session — see note in setup.)
//   - Echo-prevention counter guards so programmatic UI writes (when
//     applying a remote update) don't fire back into the store.
//   - First-vs-joining user seeding: first user populates initial
//     values; joiners read existing values.
//
// Distinct from SyncEntity:
//   - SyncEntity = owned, authoritative state. One writer at a time.
//   - RealtimeStore (this) = unowned, any device writes any key. No
//     ownership arbitration; last-write-wins per key.
//
// This file syncs three RGB sliders + a text input + a button label.
// Generalize the pattern by adding more keys to StoreKey.
//
// Place at: Assets/Scripts/UIKitSharedControls.ts, attach to a
// SceneObject under "Colocated World [CONFIGURE_ME] / EnableOnReady".
// Wire the @input UIKit components in the Inspector.

import {SessionController} from "SpectaclesSyncKit.lspkg/Core/SessionController"

const STORE_ID = "UIKitSharedControls"

const StoreKey = {
  COLOR_R: "COLOR_R",
  COLOR_G: "COLOR_G",
  COLOR_B: "COLOR_B",
  SHARED_TEXT: "SHARED_TEXT",
} as const
type StoreKeyType = (typeof StoreKey)[keyof typeof StoreKey]

// Minimal interface shims for UIKit components — typed as `any` is
// the simplest stable contract across UIKit versions; replace with
// the actual UIKit types in your project for stricter typing.
interface SliderLike {
  currentValue: number
  onValueChange: {add: (cb: (v: number) => void) => void}
}
interface TextInputLike {
  text: string
  onTextChanged: {add: (cb: (t: string) => void) => void}
}
interface ColorTarget {
  mainMaterial: {mainPass: {baseColor: vec4}}
}

@component
export class UIKitSharedControls extends BaseScriptComponent {
  @input sliderR: SliderLike
  @input sliderG: SliderLike
  @input sliderB: SliderLike
  @input textInput: TextInputLike
  @input colorTarget: ColorTarget

  private store: GeneralDataStore | null = null
  private isNewStore = false
  // Idempotency guard for onStoreReady. Three paths can attach this.store
  // and call onStoreReady (createRealtimeStore success, error-recovery
  // tryFindStore, listener late-bind on slow-replication races), and a
  // bad ordering can fire two of them. The flag keeps UI listeners from
  // being wired twice.
  private storeReadyHandled = false

  // Echo-prevention: when we apply a remote update programmatically,
  // bump the guard so the resulting onValueChange / onTextChanged
  // doesn't echo back into the store.
  private sliderGuard: [number, number, number] = [0, 0, 0]
  private textGuard = 0

  onAwake(): void {
    SessionController.getInstance().notifyOnReady(() => this.setup())
  }

  private setup(): void {
    const session = SessionController.getInstance().getSession()
    if (!session) return

    // Subscribe via SessionController, NOT via `session` — `MultiplayerSession`
    // exposes `onRealtimeStoreUpdated` only as an options callback at
    // session-creation time, not as a subscribable EventWrapper. The
    // subscribable event lives on SessionController, which internally
    // routes the MultiplayerSession options callback through to its own
    // EventWrapper. Using `session.onRealtimeStoreUpdated.add(...)` here
    // is a silent no-op (no listener ever fires).
    SessionController.getInstance().onRealtimeStoreUpdated.add(
      (
        _session: MultiplayerSession,
        store: GeneralDataStore,
        key: string,
        updateInfo: ConnectedLensModule.RealtimeStoreUpdateInfo,
      ) => {
        // Late-bind path: if createOrFindStore never managed to attach
        // (the winner's store hadn't replicated by the time our error
        // fired and tryFindStore retried), the first update event for
        // our STORE_ID is our chance to attach. Without this, the
        // eager `store !== this.store` filter below would drop every
        // replicated update for the rest of the session, leaving the
        // UI permanently disconnected.
        if (!this.store) {
          const info = _session.getRealtimeStoreInfo(store)
          if (info && info.storeId === STORE_ID) {
            this.store = store
            this.isNewStore = false
            this.onStoreReady()
          }
          return
        }
        if (store !== this.store) return
        // updaterInfo can be null for server-initiated writes (lease
        // maintenance, store-create handshakes); ?. lets those updates
        // fall through to applyRemoteUpdate instead of crashing this
        // handler and silently breaking the listener for the rest of
        // the session. The `localId !== undefined` guard prevents
        // `undefined === undefined` from accidentally filtering
        // server-initiated updates when getLocalUserInfo() returns null
        // (mocked / pre-connection states) — in that case we have no
        // notion of "self" so the safe behavior is always to fan out.
        const localId = SessionController.getInstance().getLocalUserInfo()?.connectionId
        if (localId !== undefined && updateInfo.updaterInfo?.connectionId === localId) return
        this.applyRemoteUpdate(key as StoreKeyType, store)
      },
    )

    this.createOrFindStore(() => this.onStoreReady())
  }

  private createOrFindStore(onReady: () => void): void {
    const session = SessionController.getInstance().getSession()
    if (!session) return

    if (this.tryFindStore(session)) {
      this.isNewStore = false
      onReady()
      return
    }

    this.isNewStore = true
    const opts = RealtimeStoreCreateOptions.create()
    opts.persistence = RealtimeStoreCreateOptions.Persistence.Session
    opts.ownership = RealtimeStoreCreateOptions.Ownership.Unowned
    opts.storeId = STORE_ID
    session.createRealtimeStore(
      opts,
      (store: GeneralDataStore) => {
        this.store = store
        onReady()
      },
      (err: string) => {
        // When multiple devices join the session at the same time, they
        // all fail to find STORE_ID in the initial scan and race to
        // createRealtimeStore for the same storeId. One device wins;
        // the others get an error back here. Without recovery, their
        // this.store stays null and onReady never fires, so the
        // onRealtimeStoreUpdated handler always early-returns
        // (store !== this.store) and their UI is permanently
        // disconnected. By the time our error fires, the winner's
        // store has typically replicated into our allRealtimeStores,
        // so a second scan lets us attach as a late joiner.
        print("[UIKitSharedControls] create failed (" + err + ") — attempting to recover as joiner.")
        if (this.tryFindStore(session)) {
          this.isNewStore = false
          onReady()
        } else {
          print("[UIKitSharedControls] could not recover store after create failure — UI controls remain unwired.")
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

  private onStoreReady(): void {
    // Idempotency guard — see storeReadyHandled field comment for the
    // three paths that can reach here and the race that can fire two
    // of them. Without this, UI listeners would be wired twice (next
    // user click would double-write to the store).
    if (this.storeReadyHandled) return
    this.storeReadyHandled = true
    // Wire listeners BEFORE populating the UI from the store. If we
    // applyAllFromStore first, each setSliderProgrammatic call
    // increments sliderGuard then assigns slider.currentValue =
    // value, which fires onValueChange. With no listener attached
    // yet, that event evaporates and the guard never decrements —
    // the user's first real interaction would then be silently
    // swallowed by the stale guard. Wiring first means the guard's
    // increment/decrement cycle completes for each programmatic
    // assignment during initialization.
    this.sliderR?.onValueChange.add((v) => this.onSliderChanged(0, v))
    this.sliderG?.onValueChange.add((v) => this.onSliderChanged(1, v))
    this.sliderB?.onValueChange.add((v) => this.onSliderChanged(2, v))
    this.textInput?.onTextChanged.add((t) => this.onTextChanged(t))

    if (this.isNewStore) {
      // First user — seed the store from current UI values. This
      // path doesn't touch the sliders/text, so no onValueChange
      // fires and the pre-wired listeners have nothing to react to.
      this.store!.putFloat(StoreKey.COLOR_R, this.sliderR?.currentValue ?? 0)
      this.store!.putFloat(StoreKey.COLOR_G, this.sliderG?.currentValue ?? 0)
      this.store!.putFloat(StoreKey.COLOR_B, this.sliderB?.currentValue ?? 0)
      this.store!.putString(StoreKey.SHARED_TEXT, this.textInput?.text ?? "")
    } else {
      // Joining user — pull existing values into local UI. Each
      // setSliderProgrammatic assignment fires onValueChange; the
      // now-wired listener sees sliderGuard > 0, decrements, returns.
      // Net guard delta: zero. Echo prevention works as designed.
      this.applyAllFromStore()
    }

    this.applyColor()
  }

  private onSliderChanged(channel: 0 | 1 | 2, value: number): void {
    if (this.sliderGuard[channel] > 0) {
      this.sliderGuard[channel]--
      return
    }
    if (!this.store) return
    const keys = [StoreKey.COLOR_R, StoreKey.COLOR_G, StoreKey.COLOR_B]
    this.store.putFloat(keys[channel], value)
    this.applyColor()
  }

  private onTextChanged(text: string): void {
    if (this.textGuard > 0) {
      this.textGuard--
      return
    }
    if (!this.store) return
    this.store.putString(StoreKey.SHARED_TEXT, text)
  }

  private applyRemoteUpdate(key: StoreKeyType, store: GeneralDataStore): void {
    switch (key) {
      case StoreKey.COLOR_R:
        this.setSliderProgrammatic(0, store.getFloat(key))
        break
      case StoreKey.COLOR_G:
        this.setSliderProgrammatic(1, store.getFloat(key))
        break
      case StoreKey.COLOR_B:
        this.setSliderProgrammatic(2, store.getFloat(key))
        break
      case StoreKey.SHARED_TEXT:
        this.setTextProgrammatic(store.getString(key))
        break
    }
  }

  private applyAllFromStore(): void {
    if (!this.store) return
    if (this.store.has(StoreKey.COLOR_R)) this.setSliderProgrammatic(0, this.store.getFloat(StoreKey.COLOR_R))
    if (this.store.has(StoreKey.COLOR_G)) this.setSliderProgrammatic(1, this.store.getFloat(StoreKey.COLOR_G))
    if (this.store.has(StoreKey.COLOR_B)) this.setSliderProgrammatic(2, this.store.getFloat(StoreKey.COLOR_B))
    if (this.store.has(StoreKey.SHARED_TEXT)) this.setTextProgrammatic(this.store.getString(StoreKey.SHARED_TEXT))
  }

  private setSliderProgrammatic(channel: 0 | 1 | 2, value: number): void {
    const sliders = [this.sliderR, this.sliderG, this.sliderB]
    const slider = sliders[channel]
    if (!slider) return
    // Skip the no-op case: assigning the same value to a UIKit slider
    // does not fire onValueChange, so if we incremented the guard here
    // it would stay positive forever and swallow the next legitimate
    // user-initiated change. Mirrors setTextProgrammatic's pattern.
    if (slider.currentValue === value) return
    this.sliderGuard[channel]++
    const guardAfterIncrement = this.sliderGuard[channel]
    slider.currentValue = value
    // Even when value !== currentValue, UIKit may normalize the input
    // (clamp out-of-range, snap to tick, or treat sub-epsilon float
    // drift as no-change) so the resulting currentValue matches what
    // was already there — no onValueChange fires. Detect this by
    // checking the guard counter, not the slider's resulting value:
    // if the counter is still at the post-increment value, the
    // listener didn't run, so revert. Reading the counter correctly
    // distinguishes "snapped to existing value, no event" from
    // "snapped to a third value, event fired" — only the former
    // should revert.
    if (this.sliderGuard[channel] === guardAfterIncrement) {
      this.sliderGuard[channel]--
    }
    this.applyColor()
  }

  private setTextProgrammatic(text: string): void {
    if (!this.textInput) return
    if (this.textInput.text === text) return
    this.textGuard++
    const guardAfterIncrement = this.textGuard
    this.textInput.text = text
    // Same defense as setSliderProgrammatic: text inputs can normalize
    // assigned values via max-length truncation, allowed-char filtering,
    // or whitespace stripping. If the resulting text matches the prior
    // text, onTextChanged never fires and textGuard would stay stuck.
    if (this.textGuard === guardAfterIncrement) {
      this.textGuard--
    }
  }

  private applyColor(): void {
    if (!this.colorTarget) return
    const r = this.sliderR?.currentValue ?? 0
    const g = this.sliderG?.currentValue ?? 0
    const b = this.sliderB?.currentValue ?? 0
    this.colorTarget.mainMaterial.mainPass.baseColor = new vec4(r, g, b, 1)
  }
}
