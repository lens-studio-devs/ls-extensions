# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone
from typing import Any, Iterator, Optional

from .console_events import (
    ConsoleEvent,
    FilterParseError,
    FilterSpec,
    compact_console_event,
    compact_exception_event,
    event_matches,
    filter_events,
    parse_duration_seconds,
    parse_int,
    parse_pattern,
)
from .daemon_state import DEFAULT_CONSOLE_LOG_TIMEOUT_S, _BlockingLogState, _TaggedEvent
from .json_io import Envelope, emit_stderr, emit_stdout
from .ts_resolve import ScriptInfo


def _utc_iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ----------------------------------------------------------------------
# CDP event fan-out + buffer bookkeeping
# ----------------------------------------------------------------------


class EventsMixin:
    async def _on_cdp_event(self, event: dict[str, Any]) -> None:
        if event.get("method") == "lsdbg.disconnected":
            emit_stderr("WebSocket disconnected")
            emit_stdout({"event": "lsdbg.disconnected"})
            self.shutdown_event.set()  # type: ignore[attr-defined]
            return

        # Route this event to the TargetSession whose page_session_id
        # matches the envelope's sessionId. Without this, an event for
        # session B that arrives while the daemon was last serving a
        # command for session A lands in A's buffers (the @property
        # forwarding on AttachDaemon reads _active_target_id). Setting
        # the per-task contextvar here keeps event handling isolated
        # from concurrent command dispatch.
        from .daemon import active_target_var

        token = None
        sess = self._session_for_event(event)  # type: ignore[attr-defined]
        if sess is not None:
            token = active_target_var.set(sess.target_id)
        try:
            await self._on_cdp_event_for_session(event)
        finally:
            if token is not None:
                active_target_var.reset(token)

    async def _on_cdp_event_for_session(self, event: dict[str, Any]) -> None:
        seq = self.next_seq  # type: ignore[attr-defined]
        self.next_seq += 1  # type: ignore[attr-defined]
        self.event_buffer.append(_TaggedEvent(seq, event))  # type: ignore[attr-defined]

        method = event.get("method", "")

        # Persist scriptParsed metadata before anything else — the ring
        # buffer it also lands in can roll over, but the script-URL maps
        # backtrace/breakpoint/locals features rely on must not.
        if method == "Debugger.scriptParsed":
            params = event.get("params") or {}
            script_id = params.get("scriptId", "")
            if script_id:
                self.parsed_scripts[script_id] = (  # type: ignore[attr-defined]
                    params.get("url", ""),
                    params.get("sourceMapURL", ""),
                )

        # Health counters first so short-lived bursts leave a footprint
        # even if they roll out of the ring buffer.
        self._record_health_event(method)

        # `--wait-for-idle` resets on any CDP event flowing through here.
        # No cancel/recreate — the polling loop in `_wait_idle_timer_loop`
        # re-reads `last_event_monotonic` on each wake.
        if self.waiting_idle_clients:  # type: ignore[attr-defined]
            now = time.monotonic()
            for idle_state in self.waiting_idle_clients.values():  # type: ignore[attr-defined]
                idle_state.events_observed += 1
                idle_state.last_event_monotonic = now

        # Console events fan out BEFORE wait-for so a blocking `console-log`
        # and a `--wait-for Runtime.consoleAPICalled` see the same event.
        if method == "Runtime.consoleAPICalled":
            self._record_console_event(seq, event)
            await self._fanout_to_blocking_log_clients(self.console_buffer[-1])  # type: ignore[attr-defined]

        # Hermes never fires Runtime.exceptionThrown — pause-on-exception
        # is the only channel that carries the exception payload. Surface
        # it as a synthetic level:error ConsoleEvent.
        elif method == "Debugger.paused":
            params = event.get("params") or {}
            if params.get("reason") == "exception":
                self._record_exception_event(seq, event)
                await self._fanout_to_blocking_log_clients(self.console_buffer[-1])  # type: ignore[attr-defined]

        # Stream matching events (compacted) to wait-for clients.
        compacted: Optional[dict[str, Any]] = None
        if isinstance(method, str):
            for writer, state in list(self.waiting_clients.items()):  # type: ignore[attr-defined]
                if state.method == method:
                    if compacted is None:
                        compacted = await self._compact_and_enrich_event(event)  # type: ignore[attr-defined]
                    self._write_line(writer, compacted)  # type: ignore[attr-defined]

            # Same iteration: any wait-state whose method matches gets the
            # sentinel and is removed from the waiters map (matches the C++
            # `checkWaitingClients` flow).
            for writer, state in list(self.waiting_clients.items()):  # type: ignore[attr-defined]
                if state.method == method:
                    state.timer_task.cancel()
                    self.waiting_clients.pop(writer, None)  # type: ignore[attr-defined]
                    # Drop any composing --wait-for-idle entry so its
                    # satisfaction path doesn't write after the sentinel.
                    idle_state = self.waiting_idle_clients.pop(writer, None)  # type: ignore[attr-defined]
                    if idle_state is not None:
                        idle_state.idle_timer_task.cancel()
                        idle_state.hard_deadline_task.cancel()
                    self._write_line(writer, {"__done": True})  # type: ignore[attr-defined]
                    await self._drain(writer)  # type: ignore[attr-defined]

    def _record_health_event(self, method: str) -> None:
        if method == "Runtime.consoleAPICalled":
            self.console_events_seen += 1  # type: ignore[attr-defined]
            self.last_console_ts = _utc_iso_now()  # type: ignore[attr-defined]
            return
        if method == "Debugger.paused":
            self.debugger_pauses_seen += 1  # type: ignore[attr-defined]
            self.last_pause_ts = _utc_iso_now()  # type: ignore[attr-defined]
            return
        if method == "Debugger.scriptParsed":
            self.last_script_parsed_ts = _utc_iso_now()  # type: ignore[attr-defined]
            return
        if method == "Runtime.executionContextCreated":
            self.execution_context_state = "alive"  # type: ignore[attr-defined]
            # Fire-and-forget — we're on the CDP read path.
            asyncio.create_task(
                self._install_frame_probe(),  # type: ignore[attr-defined]
                name="lsdbg.probe.rearm",
            )
            return
        if method in ("Runtime.executionContextDestroyed", "Runtime.executionContextsCleared"):
            self.execution_context_state = "destroyed"  # type: ignore[attr-defined]

    def _record_console_event(self, seq: int, raw: dict[str, Any]) -> None:
        self.console_buffer.append(compact_console_event(seq, raw))  # type: ignore[attr-defined]

    def _record_exception_event(self, seq: int, raw: dict[str, Any]) -> None:
        self.console_buffer.append(compact_exception_event(seq, raw))  # type: ignore[attr-defined]
        self.exceptions_seen += 1  # type: ignore[attr-defined]
        self.last_exception_ts = _utc_iso_now()  # type: ignore[attr-defined]

    async def _fanout_to_blocking_log_clients(self, ev: ConsoleEvent) -> None:
        if not self.blocking_console_clients:  # type: ignore[attr-defined]
            return
        for writer, state in list(self.blocking_console_clients.items()):  # type: ignore[attr-defined]
            if not event_matches(ev, state.spec):
                continue
            state.accumulated.append(ev)
            if state.wait_for_pattern is not None and state.wait_for_pattern.search(ev.message):
                await self._finish_blocking_log_client(writer)  # type: ignore[attr-defined]

    # ---------- event-buffer queries (used by pseudo-command handlers) ----------

    def _iter_parsed_scripts(self) -> Iterator[tuple[str, str, str]]:
        # Reads the persistent map (see TargetSession.parsed_scripts), not
        # the bounded event_buffer — scriptParsed events roll out of the
        # ring buffer but their URLs must stay resolvable for the session's
        # lifetime.
        for script_id, (url, source_map_url) in self.parsed_scripts.items():  # type: ignore[attr-defined]
            yield (url, script_id, source_map_url)

    def _collect_parsed_scripts(self) -> dict[str, str]:
        url_to_id: dict[str, str] = {}
        for url, script_id, _ in self._iter_parsed_scripts():
            if url:
                url_to_id[url] = script_id
        return dict(sorted(url_to_id.items()))

    def _collect_script_id_to_url(self) -> dict[str, str]:
        id_to_url: dict[str, str] = {}
        for url, script_id, _ in self._iter_parsed_scripts():
            if script_id and url:
                id_to_url[script_id] = url
        return id_to_url

    def _collect_script_infos(self) -> list[ScriptInfo]:
        url_to_info: dict[str, ScriptInfo] = {}
        for url, _, smu in self._iter_parsed_scripts():
            if url and smu:
                url_to_info[url] = ScriptInfo(url=url, sourceMapURL=smu)
        return [url_to_info[u] for u in sorted(url_to_info.keys())]

    def _find_last_paused(self) -> Optional[dict[str, Any]]:
        last_paused: Optional[dict[str, Any]] = None
        paused_seq = 0
        resumed_seq = 0
        for tagged in self.event_buffer:  # type: ignore[attr-defined]
            method = tagged.data.get("method", "")
            if method == "Debugger.paused":
                last_paused = tagged.data
                paused_seq = tagged.seq
            elif method == "Debugger.resumed":
                resumed_seq = tagged.seq
        if last_paused is None or resumed_seq > paused_seq:
            return None
        return last_paused


# ----------------------------------------------------------------------
# console-log handler (snapshot + blocking modes)
# ----------------------------------------------------------------------


class ConsoleMixin:
    def _parse_filter_spec(self, parsed: dict[str, Any]) -> FilterSpec:
        return FilterSpec(since=parse_int(parsed.get("since"), "since", allow_negative=True))

    async def _handle_console_log(
        self,
        writer: asyncio.StreamWriter,
        parsed: dict[str, Any],
        caller_id: Any,
    ) -> None:
        try:
            spec = self._parse_filter_spec(parsed)
            wait_for_pattern = parse_pattern(parsed.get("waitForPattern"))
            timeout_seconds = parse_duration_seconds(parsed.get("timeout"))
        except FilterParseError as e:
            await self._error_and_finish(writer, str(e), caller_id)  # type: ignore[attr-defined]
            return

        matched = filter_events(list(self.console_buffer), spec)  # type: ignore[attr-defined]

        # Snapshot path — no --wait-pattern. Return immediately.
        if wait_for_pattern is None:
            await self._emit_console_log_lines(writer, caller_id, matched)
            return

        # Blocking path. Walk the backlog through the same pattern check
        # live events will see, so a match already in the buffer returns
        # synchronously.
        emitted: list[ConsoleEvent] = []
        for ev in matched:
            emitted.append(ev)
            if wait_for_pattern.search(ev.message):
                await self._emit_console_log_lines(writer, caller_id, emitted)
                return

        # Backlog didn't match — register as a blocking client and let the
        # fanout / deadline path emit the lines.
        deadline_s = timeout_seconds if timeout_seconds is not None else DEFAULT_CONSOLE_LOG_TIMEOUT_S
        state = _BlockingLogState(
            spec=spec,
            wait_for_pattern=wait_for_pattern,
            caller_id=caller_id,
            accumulated=emitted,
        )
        self.blocking_console_clients[writer] = state  # type: ignore[attr-defined]
        state.deadline_task = asyncio.create_task(
            self._blocking_log_deadline(writer, deadline_s),
            name="lsdbg.console-log.deadline",
        )

    async def _emit_console_log_lines(
        self,
        writer: asyncio.StreamWriter,
        caller_id: Any,
        events: list[ConsoleEvent],
    ) -> None:
        result: dict[str, Any] = {"lines": [e.to_dict() for e in events]}
        self._write_line(writer, Envelope.success(result, caller_id))  # type: ignore[attr-defined]
        await self._finish_client(writer)  # type: ignore[attr-defined]

    async def _finish_blocking_log_client(self, writer: asyncio.StreamWriter) -> None:
        state = self.blocking_console_clients.pop(writer, None)  # type: ignore[attr-defined]
        if state is None:
            return
        if state.deadline_task is not None:
            state.deadline_task.cancel()
        await self._emit_console_log_lines(writer, state.caller_id, state.accumulated)

    async def _blocking_log_deadline(self, writer: asyncio.StreamWriter, seconds: float) -> None:
        try:
            await asyncio.sleep(seconds)
        except asyncio.CancelledError:
            return
        await self._finish_blocking_log_client(writer)
