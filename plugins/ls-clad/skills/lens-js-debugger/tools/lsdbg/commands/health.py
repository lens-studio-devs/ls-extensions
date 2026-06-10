# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any, Optional

from ..event_compaction import extract_exception_text
from ..json_io import Envelope
from ..probe import (
    FRAME_FRESHNESS_MS,
    PROBE_READ_JS,
    VM_RESPONSIVE_PROBE_JS,
    VM_RESPONSIVE_TIMEOUT_S,
)

# Window for `vm_activity_age_ms` to count as positive liveness.
HEALTH_RECENT_ACTIVITY_MS = 30000


def _derive_health_state(
    *,
    exceptions: int,
    playing: Any,
    vm_responsive: Optional[bool],
    vm_activity_age_ms: Optional[int],
    execution_context: str,
    scripts_parsed: int,
    paused: bool,
) -> str:
    if paused:
        return "paused"
    if exceptions > 0:
        return "init_throw"
    if playing is True:
        return "healthy_running"
    if playing is False:
        return "preview_idle"
    # playing == "unknown"
    if vm_responsive is True:
        return "healthy_running"
    if isinstance(vm_activity_age_ms, int) and vm_activity_age_ms <= HEALTH_RECENT_ACTIVITY_MS:
        return "healthy_running"
    if execution_context == "alive" and scripts_parsed > 0:
        return "healthy_running"
    # Negative signals: definite destruction, or alive-but-empty (a context
    # that came up but never loaded a script — most often a stale target id).
    if execution_context == "destroyed":
        return "wrong_target"
    if execution_context == "alive" and scripts_parsed == 0:
        return "wrong_target"
    # Fall-through: execution_context is "unknown" (we never saw
    # executionContextCreated) and no positive signal — honest leftover,
    # most often a fresh-attach race the caller should re-poll.
    return "ambiguous"


class HealthCommandsMixin:
    async def _handle_health(self, writer: asyncio.StreamWriter, caller_id: Any, raw: bool = False) -> None:
        started_at = self.attached_at_iso or ""  # type: ignore[attr-defined]
        now = datetime.now(timezone.utc)
        uptime_s = 0.0
        if started_at:
            try:
                attached_dt = datetime.strptime(started_at, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
                uptime_s = max(0.0, (now - attached_dt).total_seconds())
            except ValueError:
                uptime_s = 0.0

        paused_event = self._find_last_paused()  # type: ignore[attr-defined]
        paused = paused_event is not None
        pause_reason: Optional[str] = None
        exception_text: Optional[str] = None
        if paused_event is not None:
            params = paused_event.get("params") or {}
            reason = params.get("reason")
            if isinstance(reason, str):
                pause_reason = reason
            if pause_reason == "exception":
                exception_text = extract_exception_text(params.get("data"))

        scripts_parsed = len(self._collect_parsed_scripts())  # type: ignore[attr-defined]

        preview = await self._read_frame_probe()
        # Any path that leaves playing=="unknown" (install failed or
        # read broken) gets the vm_responsive fallback ping.
        if preview.get("playing") == "unknown":
            vm_responsive, vm_rtt_ms = await self._check_vm_responsive()
            preview["vm_responsive"] = vm_responsive
            preview["vm_responsive_rtt_ms"] = vm_rtt_ms
        latest_iso, age_ms = self._compute_last_vm_activity()
        preview["last_vm_activity_ts"] = latest_iso
        preview["vm_activity_age_ms"] = age_ms

        state = _derive_health_state(
            exceptions=self.exceptions_seen,  # type: ignore[attr-defined]
            playing=preview.get("playing"),
            vm_responsive=preview.get("vm_responsive"),
            vm_activity_age_ms=age_ms,
            execution_context=self.execution_context_state,  # type: ignore[attr-defined]
            scripts_parsed=scripts_parsed,
            paused=paused,
        )

        if not raw:
            # Prune structurally-null preview fields (LS v5.22+ drops the
            # frame probe). vm_responsive* stays — it's the actionable
            # signal when the probe is absent.
            if preview.get("playing") == "unknown":
                preview.pop("playing", None)
            if preview.get("last_frame_ts") is None:
                preview.pop("last_frame_ts", None)
            if preview.get("frame_age_ms") is None:
                preview.pop("frame_age_ms", None)
            if preview.get("probe_error") == "unsupported":
                preview.pop("probe_error", None)

        result: dict[str, Any] = {
            "state": state,
            "session": {
                "target_id": self.target_id,  # type: ignore[attr-defined]
                "target_title": self.target_title,  # type: ignore[attr-defined]
                "attached_at": started_at or None,
                "uptime_s": round(uptime_s, 1),
            },
            "vm": {
                "execution_context": self.execution_context_state,  # type: ignore[attr-defined]
                "scripts_parsed": scripts_parsed,
                "paused": paused,
                "pause_reason": pause_reason,
                # The thrown message when paused on an exception — the single
                # most useful datum for init-throw / missing-await bugs. Omitted
                # (not null) when not paused on a throw or when CDP gave no data.
                **({"exception_text": exception_text} if exception_text else {}),
            },
            "activity_since_attach": {
                "console_events": self.console_events_seen,  # type: ignore[attr-defined]
                "exceptions": self.exceptions_seen,  # type: ignore[attr-defined]
                "debugger_pauses": self.debugger_pauses_seen,  # type: ignore[attr-defined]
                "last_console_ts": self.last_console_ts,  # type: ignore[attr-defined]
                "last_exception_ts": self.last_exception_ts,  # type: ignore[attr-defined]
                "last_script_parsed_ts": self.last_script_parsed_ts,  # type: ignore[attr-defined]
            },
            "preview": preview,
        }
        self._write_line(writer, Envelope.success(result, caller_id))  # type: ignore[attr-defined]
        await self._finish_client(writer)  # type: ignore[attr-defined]

    async def _read_frame_probe(self) -> dict[str, Any]:
        if not self.probe_installed:  # type: ignore[attr-defined]
            return {
                "playing": "unknown",
                "last_frame_ts": None,
                "frame_age_ms": None,
                "probe_error": self.probe_install_error,  # type: ignore[attr-defined]
            }
        resp = await self.client.send_command(  # type: ignore[attr-defined]
            "Runtime.evaluate",
            params={"expression": PROBE_READ_JS, "returnByValue": True, "silent": True},
            session_id=self.page_session_id,  # type: ignore[attr-defined]
        )
        if "error" in resp:
            return {
                "playing": "unknown",
                "last_frame_ts": None,
                "frame_age_ms": None,
                "probe_error": resp["error"].get("message", "eval failed"),
            }
        outer = resp.get("result") or {}
        if "exceptionDetails" in outer:
            details = outer["exceptionDetails"]
            text = details.get("text") or (details.get("exception") or {}).get("description") or "eval threw"
            return {
                "playing": "unknown",
                "last_frame_ts": None,
                "frame_age_ms": None,
                "probe_error": text,
            }
        inner = outer.get("result") or {}
        val = inner.get("value")
        if not isinstance(val, dict):
            return {
                "playing": "unknown",
                "last_frame_ts": None,
                "frame_age_ms": None,
                "probe_error": "non-object probe value",
            }
        t = val.get("t")
        now_ms = val.get("now")
        kind = val.get("kind")
        if kind != "updateEvent" or not isinstance(t, (int, float)) or not isinstance(now_ms, (int, float)):
            return {
                "playing": "unknown",
                "last_frame_ts": None,
                "frame_age_ms": None,
                "probe_error": kind if isinstance(kind, str) else "missing probe fields",
            }
        age_ms = max(0, int(now_ms - t))
        # CDP timestamps are ms-since-epoch; render to ISO-8601 UTC so the
        # blob is consistent with attached_at and the other last_*_ts fields.
        last_frame_ts = (
            datetime.fromtimestamp(t / 1000.0, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if t > 0 else None
        )
        return {
            "playing": age_ms <= FRAME_FRESHNESS_MS,
            "last_frame_ts": last_frame_ts,
            "frame_age_ms": age_ms,
        }

    async def _check_vm_responsive(self) -> tuple[bool, Optional[int]]:
        if not self.page_session_id:  # type: ignore[attr-defined]
            return False, None
        loop = asyncio.get_event_loop()
        started = loop.time()
        try:
            resp = await self.client.send_command(  # type: ignore[attr-defined]
                "Runtime.evaluate",
                params={
                    "expression": VM_RESPONSIVE_PROBE_JS,
                    "returnByValue": True,
                    "silent": True,
                },
                session_id=self.page_session_id,  # type: ignore[attr-defined]
                timeout_s=VM_RESPONSIVE_TIMEOUT_S,
            )
        except Exception:  # pragma: no cover - defensive
            return False, None
        rtt_ms = max(0, int((loop.time() - started) * 1000))
        if "error" in resp:
            return False, None
        outer = resp.get("result") or {}
        if "exceptionDetails" in outer:
            return False, None
        inner = outer.get("result") or {}
        val = inner.get("value")
        if not isinstance(val, (int, float)) or isinstance(val, bool):
            return False, None
        return True, rtt_ms

    def _compute_last_vm_activity(self) -> tuple[Optional[str], Optional[int]]:
        candidates = [
            self.last_console_ts,  # type: ignore[attr-defined]
            self.last_exception_ts,  # type: ignore[attr-defined]
            self.last_pause_ts,  # type: ignore[attr-defined]
            self.last_script_parsed_ts,  # type: ignore[attr-defined]
        ]
        iso_values = [t for t in candidates if t]
        if not iso_values:
            return None, None
        # ISO-8601-Z sorts lexicographically == chronologically.
        latest_iso = max(iso_values)
        try:
            latest_dt = datetime.strptime(latest_iso, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        except ValueError:
            return latest_iso, None
        age_ms = max(
            0,
            int((datetime.now(timezone.utc) - latest_dt).total_seconds() * 1000),
        )
        return latest_iso, age_ms
