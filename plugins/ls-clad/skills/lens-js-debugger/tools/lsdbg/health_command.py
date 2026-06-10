# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

from .json_io import Envelope, emit_stdout
from .send import run_send
from .session_metadata import is_process_alive, ping_session, read_metadata
from .target_discovery import discover_targets

# Short budget for the booting-vs-no_session target probe. discover_targets
# defaults to a 500s ceiling — far too long for a diagnostic that should
# answer in milliseconds (a refused connection fails fast).
HEALTH_DISCOVERY_TIMEOUT_S = 2.0


def run_health(host: str, port: int, raw: bool = False) -> int:
    meta = read_metadata(host, port)
    daemon_live = meta is not None and is_process_alive(meta.pid) and ping_session(meta.socketPath)
    if not daemon_live:
        # No attached daemon. A CDP target may still exist (Lens Studio
        # booting, or simply not attached yet) — report `booting` so agents
        # polling during startup can tell that apart from nothing-there.
        discovery = discover_targets(host, port, timeout_s=HEALTH_DISCOVERY_TIMEOUT_S)
        if discovery.ok and discovery.targets:
            targets = [{"id": t.get("id", ""), "title": t.get("title", "")} for t in discovery.targets]
            emit_stdout(Envelope.success({"status": "booting", "targets": targets}))
            return 0
        # Same "no_session" envelope shape `status` uses — agents that already
        # branch on `result.status` need no new code.
        emit_stdout(Envelope.success({"status": "no_session"}))
        return 0

    # `raw=true` tells the daemon-side handler to keep structurally-null
    # preview fields (`playing:"unknown"`, `last_frame_ts:null`, etc.). Default
    # is pruned — result.state is what an agent actually branches on.
    payload = '{"command":"health","id":1,"raw":true}' if raw else '{"command":"health","id":1}'
    return run_send(host, port, payload, shorthand=True)
