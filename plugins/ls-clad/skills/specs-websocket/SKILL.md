---
name: specs-websocket
description: Create real-time WebSocket connections from Specs using the InternetModule. Supports text and binary (Blob) frames. Load when implementing real-time data streaming, custom server communication, live data feeds, or any persistent socket connections.
user-invocable: false
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# WebSocket API — Real-Time Connections

**Requirements:** Lens Studio v5.4+, Spectacles OS v5.059+. Add `InternetModule` to project. Device only (Preview requires Device Type Override = Specs).

> `wss://` (secure) → publishable. `ws://` (insecure) → requires Experimental APIs, testing only.

Reference: `Fetch/`, `AI Playground/` (RSG uses WebSocket internally)

---

## Full WebSocket Component

Lifecycle: declare `@input internetModule: InternetModule` (or `require('LensStudio:InternetModule')`), bind `connect()` to `OnStartEvent` and `disconnect()`/`close()` to `OnDestroyEvent` in `onAwake`. Inside `connect()`, call `createWebSocket(url)`, set `socket.binaryType = 'blob'`, then wire the four handlers — `onopen` / `onmessage` (branch on `event.data instanceof Blob` → `await data.bytes()`/`await data.text()` for binary, else text) / `onclose` (check `event.wasClean`) / `onerror`. Guard every `send()` with `socket?.readyState === WebSocket.OPEN`.

Copy a runnable implementation rather than re-deriving it:
- `resources/scripts/TextEcho.ts` — minimal text + binary echo; complete `connect()`/`onopen`/`onmessage`/`onclose`/`onerror` skeleton plus `reconnect()`/`sendMessage()`/`getConnectionStatus()`.
- `resources/scripts/IMUData.ts` — binary frame → CSV parse driving 3D rotation.

---

## WebSocket States

Always guard `send()` with `this.socket?.readyState === WebSocket.OPEN` (see the send helpers in the reference scripts).

| State | Value | Description |
|-------|-------|-------------|
| `CONNECTING` | 0 | Connection in progress |
| `OPEN` | 1 | Connected, ready to send |
| `CLOSING` | 2 | Closing handshake |
| `CLOSED` | 3 | Connection closed |

---

## JSON Protocol Pattern

```typescript
interface WSMessage {
  type: string
  data?: any
  id?: string
}

public sendJSON(msg: WSMessage): void {
  this.socket.send(JSON.stringify(msg))
}

private onTextMessage(text: string): void {
  const msg = JSON.parse(text) as WSMessage
  switch (msg.type) {
    case "update": this.handleUpdate(msg.data); break
    case "error":  print("[WS] Server error: " + msg.data); break
    case "pong":   print("[WS] Pong received"); break
  }
}
```

---

## Reconnect Pattern

```typescript
private reconnectDelay = 2.0

private onSocketClose(): void {
  print("[WS] Reconnecting in " + this.reconnectDelay + "s...")
  const delay = this.createEvent('DelayedCallbackEvent')
  delay.bind(() => this.connect())
  delay.reset(this.reconnectDelay)
}
```

---

## Known Limitations

- `Blob` does not support `ArrayBuffer` or `Stream`
- `binaryType = 'arraybuffer'` is **not** supported — use `'blob'` for binary
- `extensions`, `protocol`, `bufferedAmount` properties not available
- `ws://` (insecure) requires Experimental APIs enabled
