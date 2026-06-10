# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import asyncio
import json
import sys
from typing import TYPE_CHECKING, Any, Awaitable, Callable, Optional

if TYPE_CHECKING:  # pragma: no cover - type-checking only
    from websockets.legacy.client import WebSocketClientProtocol


# All CDP WebSocket connections go through this fixed browser-level target.
# Specific debug targets are reached via Target.attachToTarget after connect.
BROWSER_TARGET_ID = "lensstudio-target"


def _import_websockets():
    try:
        import websockets
        from websockets.exceptions import ConnectionClosed  # noqa: F401
    except ImportError as e:  # pragma: no cover - exercised manually
        raise RuntimeError(
            "lsdbg requires the 'websockets' package. Run "
            "`pip install -r tools/requirements-lsdbg.txt` from the skill directory."
        ) from e
    return websockets


DEFAULT_CONNECT_TIMEOUT_S = 500.0
DEFAULT_COMMAND_TIMEOUT_S = 30.0
PING_INTERVAL_S = 15.0
PONG_TIMEOUT_S = 10.0


EventHandler = Callable[[dict[str, Any]], Awaitable[None] | None]


class CdpClient:
    def __init__(self) -> None:
        self._ws: Optional["WebSocketClientProtocol"] = None
        self._next_id = 1
        self._pending: dict[int, asyncio.Future[dict[str, Any]]] = {}
        self._reader_task: Optional[asyncio.Task[None]] = None
        self._event_handler: Optional[EventHandler] = None
        self._verbose = False
        self._command_timeout_s = DEFAULT_COMMAND_TIMEOUT_S
        self._closed = False  # fail-fast after disconnect
        self._disconnect_diagnostics: Optional[Callable[[], dict[str, Any]]] = None

    # ---------- configuration ----------

    def set_event_handler(self, handler: Optional[EventHandler]) -> None:
        self._event_handler = handler

    def set_verbose(self, verbose: bool) -> None:
        self._verbose = verbose

    def set_command_timeout(self, timeout_s: float) -> None:
        self._command_timeout_s = timeout_s

    def set_disconnect_diagnostics(self, provider: Optional[Callable[[], dict[str, Any]]]) -> None:
        self._disconnect_diagnostics = provider

    # ---------- lifecycle ----------

    async def connect(self, host: str, port: int, timeout_s: float = DEFAULT_CONNECT_TIMEOUT_S) -> None:
        websockets = _import_websockets()
        url = f"ws://{host}:{port}/devtools/page/{BROWSER_TARGET_ID}"
        # max_size=None: heap snapshots / deep getProperties exceed 1 MiB.
        self._ws = await asyncio.wait_for(
            websockets.connect(
                url,
                max_size=None,
                ping_interval=PING_INTERVAL_S,
                ping_timeout=PONG_TIMEOUT_S,
            ),
            timeout=timeout_s,
        )
        self._reader_task = asyncio.create_task(self._read_loop(), name="lsdbg.cdp.reader")

    @property
    def is_connected(self) -> bool:
        return self._ws is not None and not self._closed

    async def close(self) -> None:
        self._closed = True
        if self._reader_task and not self._reader_task.done():
            self._reader_task.cancel()
        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception:
                pass
        self._cancel_all_pending("Connection lost", code=-32002)

    # ---------- sending ----------

    async def send_command(
        self,
        method: str,
        params: Optional[dict[str, Any]] = None,
        session_id: str = "",
        timeout_s: Optional[float] = None,
    ) -> dict[str, Any]:
        if self._ws is None or self._closed:
            return self._disconnect_error(-1, "Not connected")

        msg_id = self._next_id
        self._next_id += 1

        envelope: dict[str, Any] = {"id": msg_id, "method": method}
        if params:
            envelope["params"] = params
        if session_id:
            envelope["sessionId"] = session_id

        future: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
        self._pending[msg_id] = future

        if self._verbose:
            self._log_protocol(">>>", envelope)

        try:
            await self._ws.send(json.dumps(envelope))
        except Exception:  # websockets.ConnectionClosed and any transport issue
            self._pending.pop(msg_id, None)
            return self._disconnect_error(msg_id, "Connection lost")

        effective_timeout = timeout_s if timeout_s is not None else self._command_timeout_s
        try:
            return await asyncio.wait_for(future, timeout=effective_timeout)
        except asyncio.TimeoutError:
            self._pending.pop(msg_id, None)
            return {"id": msg_id, "error": {"code": -32001, "message": "Command timed out"}}

    # ---------- internals ----------

    async def _read_loop(self) -> None:
        assert self._ws is not None
        try:
            async for raw in self._ws:
                await self._dispatch(raw)
        except Exception:  # websockets.ConnectionClosed and any transport issue
            pass
        except asyncio.CancelledError:
            raise
        finally:
            self._closed = True
            self._cancel_all_pending("Connection lost", code=-32002)
            if self._event_handler is not None:
                # Synthetic disconnect event — daemon writes this and exits.
                await self._invoke_event_handler({"method": "lsdbg.disconnected"})

    async def _dispatch(self, raw: bytes | str) -> None:
        text = raw.decode("utf-8") if isinstance(raw, (bytes, bytearray)) else raw
        try:
            msg = json.loads(text)
        except json.JSONDecodeError:
            if self._verbose:
                sys.stderr.write(f"[cdp] <<< {text}\n")
            return

        if self._verbose:
            self._log_protocol("<<<", msg)

        if isinstance(msg, dict) and isinstance(msg.get("id"), int):
            future = self._pending.pop(msg["id"], None)
            if future is not None and not future.done():
                future.set_result(msg)
                return

        # Events (and unmatched responses) flow through the event handler.
        if isinstance(msg, dict):
            await self._invoke_event_handler(msg)

    async def _invoke_event_handler(self, msg: dict[str, Any]) -> None:
        handler = self._event_handler
        if handler is None:
            return
        try:
            result = handler(msg)
            if asyncio.iscoroutine(result):
                await result
        except Exception as e:  # pragma: no cover - defensive
            sys.stderr.write(f"[cdp] event handler raised: {e}\n")

    def _cancel_all_pending(self, reason: str, code: int) -> None:
        if not self._pending:
            return
        pending = self._pending
        self._pending = {}
        # Only -32002 (disconnect) gets diagnostics enrichment.
        extra = self._diagnostics_or_empty() if code == -32002 else {}
        for msg_id, future in pending.items():
            if not future.done():
                err: dict[str, Any] = {"code": code, "message": reason}
                if extra:
                    err.update(extra)
                future.set_result({"id": msg_id, "error": err})

    def _disconnect_error(self, msg_id: int, message: str) -> dict[str, Any]:
        err: dict[str, Any] = {"code": -32002, "message": message}
        extra = self._diagnostics_or_empty()
        if extra:
            err.update(extra)
        return {"id": msg_id, "error": err}

    def _diagnostics_or_empty(self) -> dict[str, Any]:
        provider = self._disconnect_diagnostics
        if provider is None:
            return {}
        try:
            extra = provider()
        except Exception:
            return {}
        return extra if isinstance(extra, dict) else {}

    def _log_protocol(self, direction: str, msg: Any) -> None:
        try:
            pretty = json.dumps(msg, indent=2, ensure_ascii=False)
        except (TypeError, ValueError):
            pretty = str(msg)
        sys.stderr.write(f"[cdp] {direction}\n{pretty}\n")
        sys.stderr.flush()
