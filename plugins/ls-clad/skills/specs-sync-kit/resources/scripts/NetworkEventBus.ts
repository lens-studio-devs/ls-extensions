// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// NetworkEventBus.ts — generic networked-event bus for one-shot signals.
//
// Wraps SyncEntity.sendEvent / onEventReceived with a typed listener
// registry. Use for events that don't represent persistent state —
// sound effects, particle bursts, gesture broadcasts, "high five"
// reactions, targeted RPCs.
//
// Targeting idioms:
//   - Broadcast to all (default): sendEvent("name", payload)
//   - Remote-only (skip self echo): sendEvent("name", payload, true)
//   - Targeted (e.g. damage to one player): include `target: connectionId`
//     in the payload and have listeners filter on
//     `data.target === SessionController.getLocalConnectionId()`.
//
// Payload constraints (per resources/docs/networked-events.mdx):
//   - JSON-serializable (primitives, vec2/3/4, quat, plain objects).
//   - ≤100 KB per message; ≤350 messages per 5-second window.
//
// Late joiners DO NOT receive event history. Use StorageProperty for
// state that joiners must see; events for one-shot signals only.
//
// Place at: Assets/Scripts/NetworkEventBus.ts, attach to ONE SceneObject
// under "Colocated World [CONFIGURE_ME] / EnableOnReady". Other scripts
// access it via NetworkEventBus.instance.

import {SyncEntity} from "SpectaclesSyncKit.lspkg/Core/SyncEntity"

type EventListener = (data: unknown, senderConnectionId: string) => void

interface PendingEmit {
  eventName: string
  data: unknown
  remoteOnly: boolean
}

@component
export class NetworkEventBus extends BaseScriptComponent {
  public static instance: NetworkEventBus | null = null

  private readonly syncEntity = new SyncEntity(this, null, true, "Session")
  private readonly listeners: Map<string, EventListener[]> = new Map()
  private readonly knownEventNames: Set<string> = new Set()

  // Emits before the SyncEntity is ready would silently no-op
  // (sync-entity.mdx: "wait until setup has completed before ...
  // sending networked events"). Queue early emits and flush on ready.
  private isReady = false
  private pendingEmits: PendingEmit[] = []

  onAwake(): void {
    NetworkEventBus.instance = this
    this.syncEntity.notifyOnReady(() => {
      this.isReady = true
      for (const p of this.pendingEmits) {
        this.syncEntity.sendEvent(p.eventName, p.data, p.remoteOnly)
      }
      this.pendingEmits = []
    })
  }

  // Register a listener. Multiple listeners per event name are supported.
  // Safe to call before the SyncEntity is ready (per docs,
  // onEventReceived.add can be called pre-setup).
  public on(eventName: string, cb: EventListener): void {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, [])
    }
    this.listeners.get(eventName)!.push(cb)

    // Lazily subscribe to the SyncEntity event the first time anyone
    // listens for this name.
    if (!this.knownEventNames.has(eventName)) {
      this.knownEventNames.add(eventName)
      this.syncEntity.onEventReceived.add(eventName, (msg) => {
        const cbs = this.listeners.get(eventName) ?? []
        // Snapshot before fan-out so a listener that calls off() (or
        // on() with the same event) mid-fire doesn't skip the next
        // entry.
        for (const c of cbs.slice()) c(msg.data, msg.senderConnectionId)
      })
    }
  }

  // Unregister a previously-added listener. Call this from the
  // registering component's onDestroy so the bus doesn't keep invoking
  // the callback against destroyed state. Idempotent — calling with a
  // never-registered cb is a silent no-op. The underlying SyncEntity
  // subscription for the event name stays open even after the last
  // listener is removed (cheap; avoids re-subscribe churn if listeners
  // come and go).
  public off(eventName: string, cb: EventListener): void {
    const cbs = this.listeners.get(eventName)
    if (!cbs) return
    const idx = cbs.indexOf(cb)
    if (idx !== -1) {
      cbs.splice(idx, 1)
    }
  }

  // Send to all peers (and self by default). Safe to call before the
  // SyncEntity is ready — the emit will be queued and flushed on ready.
  public emit(eventName: string, data: unknown = {}): void {
    if (!this.isReady) {
      this.pendingEmits.push({eventName, data, remoteOnly: false})
      return
    }
    this.syncEntity.sendEvent(eventName, data)
  }

  // Send to remote peers only — self does NOT receive the event. Same
  // pre-ready queueing as emit().
  public emitRemoteOnly(eventName: string, data: unknown = {}): void {
    if (!this.isReady) {
      this.pendingEmits.push({eventName, data, remoteOnly: true})
      return
    }
    this.syncEntity.sendEvent(eventName, data, true)
  }
}
