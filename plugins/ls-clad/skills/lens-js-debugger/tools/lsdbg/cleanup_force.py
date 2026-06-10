# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

from .json_io import Envelope, emit_stdout, fail
from .poll import poll_until
from .session_metadata import (
    is_process_alive,
    read_metadata,
    remove_metadata,
    socket_path,
)

SIGTERM_GRACE_S = 1.0
SIGKILL_GRACE_S = 0.5
KILL_POLL_INTERVAL_S = 0.05


def _wait_for_dead(pid: int, timeout_s: float) -> bool:
    result = poll_until(
        lambda: True if not is_process_alive(pid) else None,
        timeout_ms=int(timeout_s * 1000),
        interval_ms=int(KILL_POLL_INTERVAL_S * 1000),
    )
    return bool(result)


def run_cleanup_force(host: str, port: int) -> int:
    meta = read_metadata(host, port)
    if meta is None:
        # No session metadata, but there may still be a leftover socket
        # file from a crashed daemon — unlink it so a fresh `attach` doesn't
        # fail with EADDRINUSE on the AF_UNIX bind.
        _unlink_socket_file(host, port)
        emit_stdout(
            Envelope.success(
                {
                    "detached": True,
                    "killed": False,
                    "reason": "no session metadata",
                }
            )
        )
        return 0

    pid = meta.pid
    killed = False
    method: str = "none"

    if pid > 0 and is_process_alive(pid):
        method, killed = _terminate_pid(pid)
        if not killed:
            fail(f"failed to terminate lsdbg daemon (pid {pid}); manual recovery: kill -9 {pid}")
            return 1

    # Always unlink artifacts — leftover files would confuse the next
    # `ensure_session` probe (stale metadata → "Connection refused" loops).
    _unlink_socket_file(host, port)
    remove_metadata(host, port)

    result: dict[str, Any] = {
        "detached": True,
        "killed": killed,
        "pid": pid,
    }
    if method != "none":
        result["method"] = method
    emit_stdout(Envelope.success(result))
    return 0


def _terminate_pid(pid: int) -> tuple[str, bool]:
    if sys.platform == "win32":  # pragma: no cover — Windows path
        from .session_metadata import _win_terminate_process

        _win_terminate_process(pid)
        killed = _wait_for_dead(pid, SIGTERM_GRACE_S + SIGKILL_GRACE_S)
        return "TerminateProcess", killed

    import signal as _signal

    try:
        os.kill(pid, _signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        # Already gone or not ours — treat as "not alive" rather than failure.
        return "SIGTERM", not is_process_alive(pid)

    if _wait_for_dead(pid, SIGTERM_GRACE_S):
        return "SIGTERM", True

    # SIGTERM didn't take — escalate.
    try:
        os.kill(pid, _signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        return "SIGKILL", not is_process_alive(pid)
    killed = _wait_for_dead(pid, SIGKILL_GRACE_S)
    return "SIGKILL", killed


def _unlink_socket_file(host: str, port: int) -> None:
    if sys.platform == "win32":
        return
    try:
        Path(socket_path(host, port)).unlink()
    except FileNotFoundError:
        pass
    except OSError:
        pass
