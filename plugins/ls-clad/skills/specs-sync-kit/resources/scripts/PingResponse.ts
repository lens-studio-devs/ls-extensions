// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// PingResponse.ts — targeted peer-to-peer RPC with response.
//
// Send ping_request with a target connectionId payload; the target
// (and only the target) replies with ping_response. Demonstrates the
// dual-event RPC handshake idiom: filter on MessageInfo.senderConnectionId
// for the response, filter on payload.target for the request.
//
// Distinct from "broadcast event, filter by target" idiom:
//   - This file: target replies. The original sender knows when the
//     target acknowledged. Useful for "are you there?", "join my team?",
//     "wave back" gestures.
//   - Broadcast-with-target-filter: target acts on the message but
//     doesn't reply. Used for damage events, "kick from team", one-way
//     notifications.
//
// Place at: Assets/Scripts/PingResponse.ts, attach to ONE SceneObject
// under "Colocated World [CONFIGURE_ME] / EnableOnReady". Other scripts
// access via PingResponse.instance.

import {SessionController} from "SpectaclesSyncKit.lspkg/Core/SessionController"
import {SyncEntity} from "SpectaclesSyncKit.lspkg/Core/SyncEntity"

const PING_REQUEST_EVENT = "ping_request"
const PING_RESPONSE_EVENT = "ping_response"

// How long a pending reply stays in the map before we give up and
// prune it. Without this timeout, unanswered pings (target disconnected,
// dropped response, target listener not ready, etc.) would leak
// callbacks indefinitely.
const PENDING_REPLY_TIMEOUT_SEC = 5

interface PingRequestPayload {
  target: string // target connectionId
  requestId: string
  message?: string
}

interface PingResponsePayload {
  requestId: string
  message?: string
}

type IncomingPingHandler = (
  fromConnectionId: string,
  message: string,
) => string // return value becomes the response message
type PingReplyHandler = (
  fromConnectionId: string,
  message: string,
) => void

@component
export class PingResponse extends BaseScriptComponent {
  public static instance: PingResponse | null = null

  private readonly syncEntity = new SyncEntity(this, null, true, "Session")

  private incomingHandlers: IncomingPingHandler[] = []
  // Map requestId → handler so the original sender can resolve the
  // response to its specific call.
  private pendingReplies: Map<string, PingReplyHandler> = new Map()
  // Parallel map of requestId → timeout event so we can call
  // removeEvent on both cleanup paths (timeout fires AND early
  // reply). Without removeEvent, every sendPing call would leak a
  // DelayedCallbackEvent onto the component's permanent event list.
  private pendingTimeouts: Map<string, DelayedCallbackEvent> = new Map()
  // sendPing called before the SyncEntity reaches notifyOnReady would
  // otherwise emit a silently-dropped sendEvent (per sync-entity.mdx),
  // pendingReplies retains the cb until the 5s timeout prunes it, and
  // the caller's cb never fires. Queue the wire payload here and flush
  // it inside setup() — same pattern NetworkEventBus.pendingEmits uses.
  private isReady = false
  private pendingPings: Array<{
    requestId: string
    target: string
    message: string
  }> = []

  onAwake(): void {
    PingResponse.instance = this
    this.syncEntity.notifyOnReady(() => this.setup())
  }

  private setup(): void {
    this.syncEntity.onEventReceived.add(PING_REQUEST_EVENT, (msg) =>
      this.onRequest(msg),
    )
    this.syncEntity.onEventReceived.add(PING_RESPONSE_EVENT, (msg) =>
      this.onResponse(msg),
    )
    // Flush pings that were queued before the SyncEntity was ready.
    // pendingReplies / pendingTimeouts entries for these were already
    // set up at sendPing time, so we only need to emit the wire
    // payload now.
    this.isReady = true
    for (const p of this.pendingPings) {
      this.syncEntity.sendEvent(PING_REQUEST_EVENT, {
        target: p.target,
        requestId: p.requestId,
        message: p.message,
      } as PingRequestPayload)
    }
    this.pendingPings = []
  }

  // Send a ping to a specific user. cb fires when (and if) the target
  // replies. Multiple in-flight pings to the same target are OK — each
  // gets a unique requestId.
  public sendPing(
    targetConnectionId: string,
    message: string,
    cb: PingReplyHandler,
  ): void {
    const requestId = this.makeRequestId()
    this.pendingReplies.set(requestId, cb)
    if (this.isReady) {
      this.syncEntity.sendEvent(PING_REQUEST_EVENT, {
        target: targetConnectionId,
        requestId,
        message,
      } as PingRequestPayload)
    } else {
      // Queue until the SyncEntity is ready. sendEvent before
      // notifyOnReady is silently dropped per sync-entity.mdx, so
      // emitting now would let the 5s timeout prune the entry and the
      // caller's cb would never fire. Flush happens in setup().
      this.pendingPings.push({
        requestId,
        target: targetConnectionId,
        message,
      })
    }

    // Prune the pending entry after a timeout so unanswered pings don't
    // leak callbacks (target disconnected, dropped response, missing
    // listener, etc.). If the reply arrives before the timeout, the
    // entry is already removed in onResponse() and the delete is a
    // silent no-op. The caller's `cb` never fires for a timed-out
    // request — wrap in your own timeout if you need to react to "no
    // reply" on the caller side.
    //
    // createEvent attaches the event to the component permanently; we
    // call removeEvent in both cleanup paths so the event list doesn't
    // grow with every sendPing call.
    const timeout = this.createEvent("DelayedCallbackEvent")
    timeout.bind(() => {
      this.pendingReplies.delete(requestId)
      this.pendingTimeouts.delete(requestId)
      // If the timeout fires before setup() flushes the queue (slow
      // notifyOnReady exceeding PENDING_REPLY_TIMEOUT_SEC), the entry
      // is still in pendingPings and would otherwise be sent to the
      // target when setup() eventually runs — a ghost ping the caller
      // already abandoned. Splice it out here. findIndex returns -1
      // when setup() already drained the queue; splice no-ops.
      const queuedIdx = this.pendingPings.findIndex((p) => p.requestId === requestId)
      if (queuedIdx !== -1) {
        this.pendingPings.splice(queuedIdx, 1)
      }
      this.removeEvent(timeout)
    })
    timeout.reset(PENDING_REPLY_TIMEOUT_SEC)
    this.pendingTimeouts.set(requestId, timeout)
  }

  // Register a handler for incoming pings. The return value becomes
  // the response message back to the sender.
  public addIncomingHandler(handler: IncomingPingHandler): void {
    this.incomingHandlers.push(handler)
  }

  // Unregister a previously-added incoming-ping handler. Call this from
  // the registering component's onDestroy so a long-lived PingResponse
  // singleton doesn't keep invoking the handler against destroyed
  // state. Idempotent — calling with a never-registered handler is a
  // silent no-op.
  public removeIncomingHandler(handler: IncomingPingHandler): void {
    const idx = this.incomingHandlers.indexOf(handler)
    if (idx !== -1) {
      this.incomingHandlers.splice(idx, 1)
    }
  }

  private onRequest(msg: {
    data?: PingRequestPayload
    senderConnectionId: string
  }): void {
    const data = msg.data
    if (!data || typeof data.target !== "string") return
    // Filter: only the target processes this request.
    const localId = SessionController.getInstance().getLocalUserInfo()?.connectionId
    if (data.target !== localId) return

    let responseMessage = ""
    // Snapshot before fan-out so a handler that calls
    // removeIncomingHandler (or registers another) mid-fire doesn't
    // skip the next entry.
    for (const h of this.incomingHandlers.slice()) {
      const result = h(msg.senderConnectionId, data.message ?? "")
      if (result) responseMessage = result
    }

    this.syncEntity.sendEvent(PING_RESPONSE_EVENT, {
      requestId: data.requestId,
      message: responseMessage,
    } as PingResponsePayload)
  }

  private onResponse(msg: {
    data?: PingResponsePayload
    senderConnectionId: string
  }): void {
    const data = msg.data
    if (!data || typeof data.requestId !== "string") return
    const handler = this.pendingReplies.get(data.requestId)
    if (!handler) return
    this.pendingReplies.delete(data.requestId)
    // Cancel the pending timeout event for this requestId so it
    // doesn't accumulate on the component's event list and so its
    // orphan delete doesn't fire later.
    const timeout = this.pendingTimeouts.get(data.requestId)
    if (timeout) {
      this.pendingTimeouts.delete(data.requestId)
      this.removeEvent(timeout)
    }
    handler(msg.senderConnectionId, data.message ?? "")
  }

  private makeRequestId(): string {
    return (
      (SessionController.getInstance().getLocalUserInfo()?.connectionId ?? "x") +
      "-" +
      Math.random().toString(36).slice(2, 10)
    )
  }
}
