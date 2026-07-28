# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import asyncio
import dataclasses
import json
import os
import stat
import sys
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any, Optional

from . import command_dispatch
from ._build import build_id
from .cdp_client import CdpClient
from .daemon_commands import CommandsMixin
from .daemon_console import ConsoleMixin, EventsMixin
from .daemon_state import (
    TargetSession,
    _BlockingLogState,  # re-exported
    _TaggedEvent,  # re-exported (test imports use this path)
    _WaitState,  # re-exported
)
from .handshake import enable_domains, perform_handshake
from .json_io import Envelope, emit_stderr, emit_stdout, encode_line
from .probe import PROBE_INSTALL_JS, PROBE_INSTALL_TIMEOUT_S
from .session_lock import SessionLock
from .session_metadata import (
    SessionMetadata,
    is_process_alive,
    lock_path,
    remove_metadata,
    socket_path,
    write_metadata,
)
from .target_discovery import canonical_ls_log_hint, discover_targets, find_listening_pid

# Re-exports — keep `from lsdbg.daemon import _is_pollable, _TaggedEvent`
# working (tests + any future caller that grew comfortable with this path).
__all__ = [
    "AttachDaemon",
    "TargetSession",
    "active_target_var",
    "run_attach",
    "_BlockingLogState",
    "_TaggedEvent",
    "_WaitState",
    "_is_pollable",
]


# Tracks the "active" TargetSession per asyncio task — set by command
# dispatch (_process_line) and by event handling (_on_cdp_event) so the
# @property forwarding on AttachDaemon routes reads/writes to the right
# session. asyncio.Task copies the parent context, so a command coroutine
# and an event-handling coroutine each see their own value without
# clobbering each other under concurrent multi-target work.
active_target_var: ContextVar[Optional[str]] = ContextVar("lsdbg_active_target", default=None)


# Per-target attrs that AttachDaemon forwards to the active TargetSession via
# __getattr__/__setattr__. `target_id` is excluded — it keeps an explicit
# property because its setter re-keys the targets map.
_FORWARDED = frozenset(f.name for f in dataclasses.fields(TargetSession)) - {"target_id"}


# ----------------------------------------------------------------------
# Transport: local socket server + per-client I/O
# ----------------------------------------------------------------------


class _SocketMixin:
    async def _start_socket_server(self) -> None:
        if sys.platform == "win32":
            # TCP loopback on Windows (AF_UNIX is available but ergonomics
            # of path namespacing + leftover socket files are nicer with TCP).
            self.server = await asyncio.start_server(  # type: ignore[attr-defined]
                self._handle_client, host="127.0.0.1", port=0
            )
            assert self.server.sockets is not None  # type: ignore[attr-defined]
            sockname = self.server.sockets[0].getsockname()  # type: ignore[attr-defined]
            actual_port = sockname[1]
            self.socket_artifact = f"tcp:127.0.0.1:{actual_port}"  # type: ignore[attr-defined]
        else:
            path = str(socket_path(self.host, self.port))  # type: ignore[attr-defined]
            # Clear any stale socket file from a previous crashed daemon.
            try:
                os.unlink(path)
            except FileNotFoundError:
                pass
            except OSError:
                pass
            self.server = await asyncio.start_unix_server(self._handle_client, path=path)  # type: ignore[attr-defined]
            self.unix_path = path  # type: ignore[attr-defined]
            self.socket_artifact = path  # type: ignore[attr-defined]

    async def _handle_client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            line_bytes = await reader.readline()
            if not line_bytes:
                return
            raw_line = line_bytes.strip().decode("utf-8", errors="replace")
            if not raw_line:
                return
            await self._process_line(writer, raw_line)  # type: ignore[attr-defined]
            # Client closes after reading the sentinel; wait for that so this
            # coroutine exits cleanly.
            try:
                await reader.read(1)
            except Exception:
                pass
        finally:
            state = self.waiting_clients.pop(writer, None)  # type: ignore[attr-defined]
            if state is not None:
                state.timer_task.cancel()
            blocking = self.blocking_console_clients.pop(writer, None)  # type: ignore[attr-defined]
            if blocking is not None and blocking.deadline_task is not None:
                blocking.deadline_task.cancel()
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass

    async def _finish_client(self, writer: asyncio.StreamWriter) -> None:
        self._write_line(writer, {"__done": True})
        await self._drain(writer)

    def _write_line(self, writer: asyncio.StreamWriter, obj: Any) -> None:
        try:
            writer.write(encode_line(self._tag_with_target(obj)))
        except Exception:
            pass

    def _tag_with_target(self, obj: Any) -> Any:
        if not isinstance(obj, dict):
            return obj
        if "target" in obj:
            return obj
        is_success_envelope = obj.get("ok") is True
        is_raw_event = "method" in obj and "ok" not in obj
        if not (is_success_envelope or is_raw_event):
            return obj
        # Tag with the per-task active target (set by command dispatch and
        # event handling) so a target-B event isn't mislabeled as target A
        # under multi-target work. Fall back to the daemon-wide id, and use
        # `.get()` so a cleared targets map (post `cleanup --all`) is a no-op
        # rather than a KeyError.
        tid = active_target_var.get()
        if tid is None or tid not in self.targets:  # type: ignore[attr-defined]
            tid = self._active_target_id  # type: ignore[attr-defined]
        sess = self.targets.get(tid)  # type: ignore[attr-defined]
        if sess is None or not sess.target_id:
            return obj
        # Copy so callers passing dict literals aren't mutated by the
        # daemon's tagging — keeps test setup predictable.
        tagged = dict(obj)
        tagged["target"] = {"id": sess.target_id, "title": sess.target_title}
        return tagged

    async def _drain(self, writer: asyncio.StreamWriter) -> None:
        try:
            await writer.drain()
        except Exception:
            pass


# ----------------------------------------------------------------------
# Transport: interactive stdin bridge
# ----------------------------------------------------------------------


def _is_pollable(file_obj: Any) -> bool:
    try:
        fd = file_obj.fileno()
        mode = os.fstat(fd).st_mode
    except (OSError, AttributeError, ValueError):
        return False
    if stat.S_ISFIFO(mode) or stat.S_ISSOCK(mode):
        return True
    if stat.S_ISCHR(mode):
        try:
            return os.isatty(fd)
        except OSError:
            return False
    return False


class _StdinMixin:
    async def _bridge_stdin(self) -> None:
        # Preflight skips `connect_read_pipe` when stdin isn't pollable —
        # on macOS, kqueue rejects /dev/null and leaves a half-constructed
        # transport that prints cosmetic tracebacks on shutdown.
        if not _is_pollable(sys.stdin):
            return
        loop = asyncio.get_running_loop()
        try:
            reader = asyncio.StreamReader()
            protocol = asyncio.StreamReaderProtocol(reader)
            await loop.connect_read_pipe(lambda: protocol, sys.stdin)
        except Exception:
            return  # stdin closed / racy between preflight and connect

        while not self.shutdown_event.is_set():  # type: ignore[attr-defined]
            try:
                line_bytes = await reader.readline()
            except Exception:
                return
            if not line_bytes:
                emit_stderr(  # type: ignore[arg-type]
                    f"[lsdbg] stdin closed, session continues on {self.socket_artifact}"  # type: ignore[attr-defined]
                )
                return
            line = line_bytes.strip().decode("utf-8", errors="replace")
            if not line:
                continue
            try:
                parsed = json.loads(line)
            except json.JSONDecodeError:
                parsed = None
            env = await command_dispatch.dispatch_message(
                self.client,  # type: ignore[attr-defined]
                self.page_session_id,  # type: ignore[attr-defined]
                parsed if isinstance(parsed, dict) else None,
                line,
            )
            emit_stdout(env)


class AttachDaemon(
    EventsMixin,
    ConsoleMixin,
    _SocketMixin,
    CommandsMixin,
    _StdinMixin,
):
    def __init__(self, host: str, port: int, target_id: str) -> None:
        self.host = host
        self.port = port

        self.client = CdpClient()
        self.client.set_disconnect_diagnostics(self._disconnect_diagnostics)

        # Per-target state lives in TargetSession; the daemon owns N of them
        # keyed by target_id. For single-target startup we pre-seed one with
        # the caller's target_id so handlers (and tests) can access per-target
        # attrs via the forwarding properties below before _run_locked
        # populates page_session_id / target_title from the handshake.
        self.targets: dict[str, TargetSession] = {}
        self._active_target_id: str = target_id
        self.targets[target_id] = TargetSession(target_id=target_id)

        # Daemon-global: one WebSocket → one browser session id, shared
        # across all attached targets.
        self.browser_session_id = ""

        # Set in `_run_locked`; surfaced via `_disconnect_diagnostics` on
        # Connection-lost envelopes.
        self.host_pid: Optional[int] = None
        self.ls_log_hint: str = canonical_ls_log_hint()

        # Per-writer state, indexed by StreamWriter.
        self.waiting_clients: dict[asyncio.StreamWriter, _WaitState] = {}

        self.server: Optional[asyncio.AbstractServer] = None
        self.socket_artifact: str = ""  # AF_UNIX path, or "tcp:host:port"
        self.unix_path: Optional[str] = None  # POSIX only, unlinked on shutdown

        # Blocking `console-log` clients (--wait-for-pattern / --wait-for-count
        # with --timeout). Snapshot calls never live here — they emit and
        # close synchronously in `_handle_console_log`.
        self.blocking_console_clients: dict[asyncio.StreamWriter, _BlockingLogState] = {}

        self.shutdown_event = asyncio.Event()

    # ---------- per-target state access ----------
    #
    # Handlers read/write through the active TargetSession (resolved per-task
    # via the contextvar in `_current_session`). __getattr__/__setattr__ forward
    # the TargetSession fields in `_FORWARDED` so call sites like
    # `self.console_buffer` / `self.next_seq += 1` route to the right session
    # unchanged. __getattr__ fires only on a normal-lookup miss, so daemon-global
    # attrs and the `target_id` property are unaffected.

    def __getattr__(self, name: str) -> Any:
        if name in _FORWARDED:
            return getattr(self._current_session(), name)
        raise AttributeError(name)

    def __setattr__(self, name: str, value: Any) -> None:
        if name in _FORWARDED:
            setattr(self._current_session(), name, value)
        else:
            object.__setattr__(self, name, value)

    def _current_session(self) -> TargetSession:
        # Per-task contextvar wins so a command coroutine and an event
        # coroutine see independent "active" sessions under concurrent
        # multi-target work. Falls back to the daemon-wide
        # _active_target_id for single-target callers and tests that
        # don't set the contextvar.
        tid = active_target_var.get()
        if tid is None or tid not in self.targets:
            tid = self._active_target_id
        return self.targets[tid]

    def _session_for_event(self, event: dict[str, Any]) -> Optional[TargetSession]:
        sid = event.get("sessionId")
        if not sid:
            return None
        for sess in self.targets.values():
            if sess.page_session_id == sid:
                return sess
        return None

    @property
    def target_id(self) -> str:
        return self._active_target_id

    @target_id.setter
    def target_id(self, value: str) -> None:
        # Re-key the active session if a caller renames the target (e.g.
        # tests that swap target_id post-construction).
        if value == self._active_target_id:
            return
        sess = self.targets.pop(self._active_target_id)
        sess.target_id = value
        self.targets[value] = sess
        self._active_target_id = value

    # ---------- disconnect diagnostics ----------

    def _disconnect_diagnostics(self) -> dict[str, Any]:
        out: dict[str, Any] = {}
        if self.host_pid is not None:
            out["hostPid"] = self.host_pid
            out["hostAlive"] = is_process_alive(self.host_pid)
        # `next_seq` is the *next* slot, so subtract 1 for last-seen.
        out["lastEventSeq"] = self.next_seq - 1
        if self.ls_log_hint:
            out["lsLogPath"] = self.ls_log_hint
        return out

    # ---------- entry point ----------

    async def run(self) -> int:
        lock = SessionLock.try_acquire(str(lock_path(self.host, self.port)))
        if not lock.is_locked():
            emit_stdout(Envelope.error(f"Another attach session is starting for {self.host}:{self.port}"))
            return 1

        try:
            return await self._run_locked()
        finally:
            lock.close()

    async def _run_locked(self) -> int:
        try:
            await self.client.connect(self.host, self.port)
        except (OSError, asyncio.TimeoutError) as e:
            emit_stdout(Envelope.error(f"Failed to connect to CDP server at {self.host}:{self.port} ({e})"))
            return 1

        self.host_pid = find_listening_pid(self.host, self.port)

        hs = await perform_handshake(self.client, self.target_id)
        if not hs.ok:
            emit_stdout(Envelope.error(f"Handshake failed: {hs.error_message}"))
            await self.client.close()
            return 1
        self.browser_session_id = hs.browser_session_id
        self.page_session_id = hs.page_session_id

        # Event handler must register BEFORE enable_domains so the
        # Debugger.scriptParsed flood gets buffered for set-breakpoint
        # URL resolution.
        self.client.set_event_handler(self._on_cdp_event)

        enable_result = await enable_domains(self.client, self.page_session_id)
        if not enable_result.ok:
            emit_stdout(Envelope.error(f"Failed to enable Debugger/Runtime domains: {enable_result.error_message}"))
            await self.client.close()
            return 1

        # enable_domains arms setPauseOnExceptions {uncaught}; mirror that into
        # the tracked state so `previousState` echoes are honest and cleanup
        # resets the auto-armed state instead of leaving it on the VM.
        self.pause_on_exceptions_state = "uncaught"

        discovery = discover_targets(self.host, self.port)
        if discovery.ok:
            for t in discovery.targets:
                if t.get("id") == self.target_id:
                    self.target_title = t.get("title", "") or ""
                    break

        await self._install_frame_probe()

        try:
            await self._start_socket_server()
        except OSError as e:
            emit_stdout(Envelope.error(f"Failed to start local socket server: {e}"))
            await self.client.close()
            return 1

        self.attached_at_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        meta = SessionMetadata(
            pid=os.getpid(),
            host=self.host,
            port=self.port,
            targetId=self.target_id,
            browserSessionId=self.browser_session_id,
            pageSessionId=self.page_session_id,
            socketPath=self.socket_artifact,
            startedAt=self.attached_at_iso,
            build=build_id(),
        )
        write_metadata(meta)

        emit_stdout(
            {
                "browserSessionId": self.browser_session_id,
                "pageSessionId": self.page_session_id,
                "targetId": self.target_id,
                "socket": self.socket_artifact,
            }
        )

        stdin_task = asyncio.create_task(self._bridge_stdin(), name="lsdbg.stdin")
        await self.shutdown_event.wait()

        stdin_task.cancel()
        try:
            await stdin_task
        except (asyncio.CancelledError, Exception):
            pass

        await self._shutdown()
        return 0

    async def _shutdown(self) -> None:
        for state in list(self.waiting_clients.values()):
            state.timer_task.cancel()
        self.waiting_clients.clear()
        for blocking in list(self.blocking_console_clients.values()):
            if blocking.deadline_task is not None:
                blocking.deadline_task.cancel()
        self.blocking_console_clients.clear()

        if self.server is not None:
            self.server.close()
            try:
                await self.server.wait_closed()
            except Exception:
                pass
            self.server = None

        if self.unix_path:
            try:
                os.unlink(self.unix_path)
            except OSError:
                pass

        remove_metadata(self.host, self.port)
        await self.client.close()

    # ---------- frame-tick probe ----------

    async def _install_frame_probe(self) -> None:
        if not self.page_session_id:
            return
        try:
            resp = await self.client.send_command(
                "Runtime.evaluate",
                params={
                    "expression": PROBE_INSTALL_JS,
                    "returnByValue": True,
                    "silent": True,
                },
                session_id=self.page_session_id,
                # Tight budget: LS Internal v5.22+ Runtime.evaluate can hang
                # indefinitely behind a busy main loop; an unbounded await
                # would block all of attach.
                timeout_s=PROBE_INSTALL_TIMEOUT_S,
            )
        except Exception as e:  # pragma: no cover - defensive
            self.probe_installed = False
            self.probe_install_error = f"send failed: {e}"
            return

        if "error" in resp:
            self.probe_installed = False
            self.probe_install_error = resp["error"].get("message", "unknown error")
            return
        # CDP wraps the eval result as `{result: {result: {value: ...}, exceptionDetails?}}`.
        outer = resp.get("result") or {}
        if "exceptionDetails" in outer:
            details = outer["exceptionDetails"]
            text = details.get("text") or (details.get("exception") or {}).get("description") or "eval threw"
            self.probe_installed = False
            self.probe_install_error = text
            return
        inner = outer.get("result") or {}
        kind = inner.get("value")
        if isinstance(kind, str) and (kind == "updateEvent" or kind == "already"):
            self.probe_installed = True
            self.probe_install_error = None
        else:
            # `unsupported` or `error:…` from the probe itself — install
            # "succeeded" in that the eval returned, but the lens VM doesn't
            # expose `script.createEvent`. Surface the reason so `health` can
            # report it.
            self.probe_installed = False
            self.probe_install_error = kind if isinstance(kind, str) else "unknown probe result"


async def run_attach(host: str, port: int, target_id: str) -> int:
    daemon = AttachDaemon(host=host, port=port, target_id=target_id)
    return await daemon.run()
