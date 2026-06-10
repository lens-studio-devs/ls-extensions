# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
from dataclasses import dataclass, field
from typing import Any, Optional

from ._build import build_id
from .json_io import emit_stderr
from .poll import poll_until
from .send import capture_result
from .session_metadata import (
    is_process_alive,
    log_path,
    parse_socket_path,
    ping_session,
    read_metadata,
    remove_metadata,
    socket_path,
    terminate_process,
)
from .target_discovery import discover_targets

SPAWN_POLL_INTERVAL_MS = 200
# Cold Lens Studio boots open the daemon socket only after the full CDP
# handshake + enable_domains + frame-probe install — routinely >10s. The
# ceiling is the default budget for both explicit `attach` and the shorthand
# auto-attach path; `attach --timeout` overrides it.
SPAWN_MAX_WAIT_MS = 30000
# Re-poll cadence while clearing the fresh-attach `ambiguous` health state.
ATTACH_LIVENESS_POLL_INTERVAL_MS = 300


@dataclass
class EnsureResult:
    ok: bool
    error: str


@dataclass
class ResolveResult:
    target_id: str
    error: str
    # When the failure is "more than one preview attached", `error_code` is
    # "multiple_targets" and `targets` lists {id, title} — so the caller can
    # emit the same structured error the daemon dispatch path does, instead of
    # a bare plaintext message.
    error_code: str = ""
    targets: list[dict[str, Any]] = field(default_factory=list)


def resolve_target_id(
    host: str,
    port: int,
    target_id: Optional[str] = None,
) -> ResolveResult:
    if target_id:
        # Fall back to raw target_id if discovery fails — keeps the
        # hand-typed-id escape hatch working.
        discovery = discover_targets(host, port)
        if discovery.ok and discovery.targets:
            for t in discovery.targets:
                if (t.get("id") or "") == target_id:
                    return ResolveResult(target_id=target_id, error="")
            title_matches = [t for t in discovery.targets if (t.get("title") or "") == target_id]
            if len(title_matches) == 1:
                tid = title_matches[0].get("id", "") or ""
                if tid:
                    return ResolveResult(target_id=tid, error="")
            if len(title_matches) > 1:
                available = [t.get("title", "") for t in discovery.targets]
                return ResolveResult(
                    target_id="",
                    error=(
                        f"multiple targets share title {target_id!r}; available titles: {json.dumps(available)} "
                        "— use --target with a CDP id to pick one"
                    ),
                )
            # Discovery returned targets but neither id nor title matched —
            # surface what's available so the caller can fix the request.
            available = [t.get("title", "") for t in discovery.targets]
            return ResolveResult(
                target_id="",
                error=(f"no target with id-or-title {target_id!r}; available titles: {json.dumps(available)}"),
            )
        return ResolveResult(target_id=target_id, error="")

    discovery = discover_targets(host, port)
    if not discovery.ok:
        return ResolveResult(target_id="", error=f"target discovery failed: {discovery.error}")
    if not discovery.targets:
        return ResolveResult(
            target_id="",
            error="no debug targets found — is a lens loaded in LensStudio?",
        )

    if len(discovery.targets) > 1:
        targets = [{"id": t.get("id", "") or "", "title": t.get("title", "") or ""} for t in discovery.targets]
        targets.sort(key=lambda t: (t["title"], t["id"]))
        titles = ", ".join(f"{t['title']!r}" if t["title"] else t["id"] for t in targets)
        return ResolveResult(
            target_id="",
            error=f"multiple targets attached ({titles}) — pass --target to pick one",
            error_code="multiple_targets",
            targets=targets,
        )

    tid = discovery.targets[0].get("id", "") or ""
    if not tid:
        return ResolveResult(target_id="", error="target has no id field")
    return ResolveResult(target_id=tid, error="")


def _check_and_cleanup_session(
    host: str,
    port: int,
    required_target_id: Optional[str] = None,
) -> tuple[bool, str]:
    meta = read_metadata(host, port)
    if meta is None:
        return (False, "")

    if is_process_alive(meta.pid) and ping_session(meta.socketPath):
        current_build = build_id()
        if current_build and meta.build and current_build != meta.build:
            emit_stderr(
                f"info: lsdbg daemon was stale "
                f"(build {meta.build} → {current_build}); "
                f"re-attached transparently. Note: any breakpoints set "
                f"in the old session are gone — re-set them if needed."
            )
        elif current_build and not meta.build:
            # Pre-build-tracking daemon — treat as stale.
            emit_stderr(
                f"info: lsdbg daemon predates build tracking "
                f"(current build {current_build}); re-attached "
                f"transparently. Note: any breakpoints set in the old "
                f"session are gone — re-set them if needed."
            )
        else:
            if required_target_id is None or meta.targetId == required_target_id:
                return (True, "")
            return (
                True,
                (f"a session is already attached to target {meta.targetId!r} — run 'lsdbg cleanup' first"),
            )

    if is_process_alive(meta.pid):
        terminate_process(meta.pid)
        time.sleep(0.1)
    remove_metadata(host, port)
    return (False, "")


def spawn_and_wait(
    host: str,
    port: int,
    target_id: str,
    verbose: bool,
    timeout_ms: Optional[int] = None,
) -> EnsureResult:
    effective_timeout_ms = SPAWN_MAX_WAIT_MS if timeout_ms is None else max(timeout_ms, 0)
    proc, spawn_error = _spawn_attach(host=host, port=port, target_id=target_id, verbose=verbose)
    if spawn_error:
        return EnsureResult(ok=False, error=spawn_error)

    if _wait_for_socket(host, port, timeout_ms=effective_timeout_ms):
        return EnsureResult(ok=True, error="")

    return EnsureResult(
        ok=False,
        error=_diagnose_spawn_failure(host, port, proc, effective_timeout_ms),
    )


def ensure_session(
    host: str,
    port: int,
    verbose: bool = False,
    target: Optional[str] = None,
) -> EnsureResult:
    handled, _ = _check_and_cleanup_session(host, port)
    if handled:
        return EnsureResult(ok=True, error="")

    resolved = resolve_target_id(host, port, target_id=target)
    if resolved.error:
        return EnsureResult(ok=False, error=resolved.error)

    return spawn_and_wait(host=host, port=port, target_id=resolved.target_id, verbose=verbose)


def attach_wait_session(
    host: str,
    port: int,
    target_id: str,
    verbose: bool = False,
    timeout_ms: Optional[int] = None,
) -> EnsureResult:
    handled, err = _check_and_cleanup_session(host, port, required_target_id=target_id)
    if handled:
        if err:
            return EnsureResult(ok=False, error=err)
        return EnsureResult(ok=True, error="")
    return spawn_and_wait(
        host=host,
        port=port,
        target_id=target_id,
        verbose=verbose,
        timeout_ms=timeout_ms,
    )


def attach_until_live(
    host: str,
    port: int,
    target_id: str,
    verbose: bool = False,
    timeout_ms: Optional[int] = None,
) -> tuple[bool, Optional[str], str]:
    effective_timeout_ms = SPAWN_MAX_WAIT_MS if timeout_ms is None else max(timeout_ms, 0)
    deadline = time.monotonic() + effective_timeout_ms / 1000.0

    result = attach_wait_session(
        host=host,
        port=port,
        target_id=target_id,
        verbose=verbose,
        timeout_ms=effective_timeout_ms,
    )
    if not result.ok:
        return (False, None, result.error)

    def _decisive_state() -> Optional[str]:
        blob = capture_result(host, port, '{"command":"health","id":1}')
        if not isinstance(blob, dict):
            return None
        state = blob.get("state")
        if isinstance(state, str) and state != "ambiguous":
            return state
        return None

    remaining_ms = max(0, int((deadline - time.monotonic()) * 1000))
    state = poll_until(
        _decisive_state,
        timeout_ms=remaining_ms,
        interval_ms=ATTACH_LIVENESS_POLL_INTERVAL_MS,
    )
    if state is None:
        # Never cleared `ambiguous` in budget — read once more so the envelope
        # carries whatever the daemon reports rather than nothing.
        blob = capture_result(host, port, '{"command":"health","id":1}')
        state = blob.get("state") if isinstance(blob, dict) else None
    return (True, state, "")


def _spawn_attach(host: str, port: int, target_id: str, verbose: bool) -> tuple[Optional[subprocess.Popen], str]:
    env = os.environ.copy()
    package_dir = os.path.dirname(os.path.abspath(__file__))  # .../tools/lsdbg/
    tools_dir = os.path.dirname(package_dir)  # .../tools/
    existing = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = tools_dir + (os.pathsep + existing if existing else "")
    env["LSDBG_INTERNAL_FOREGROUND"] = "1"

    # --host / --port / --verbose are top-level globals (sit before the
    # verb). Earlier they hung off each subparser; placing them after
    # `attach` now produces "unrecognized arguments" — see
    # test_spawn_attach_argv_parses_against_real_parser.
    args = [sys.executable, "-m", "lsdbg", "--host", host, "--port", str(port)]
    if verbose:
        args.append("--verbose")
    args.extend(["attach", "--target", target_id])

    log_file_path = log_path(host, port)
    # Truncate any prior log so we don't tail stale lines on retry.
    try:
        log_fh = open(log_file_path, "wb")
    except OSError as e:
        return (None, f"failed to open daemon log {log_file_path}: {e}")

    kwargs: dict[str, object] = {
        "stdin": subprocess.DEVNULL,
        "stdout": log_fh,
        "stderr": log_fh,
        "env": env,
        "close_fds": True,
    }
    if sys.platform == "win32":  # pragma: no cover - Windows path
        DETACHED_PROCESS = 0x00000008
        CREATE_NEW_PROCESS_GROUP = 0x00000200
        kwargs["creationflags"] = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    else:
        kwargs["start_new_session"] = True

    try:
        proc = subprocess.Popen(args, **kwargs)  # type: ignore[arg-type]
    except OSError as e:
        log_fh.close()
        return (None, f"failed to spawn 'lsdbg attach' process: {e}")
    # Popen has dup2'd the fd into the child; parent can close immediately.
    log_fh.close()
    return (proc, "")


def _wait_for_socket(host: str, port: int, timeout_ms: int = SPAWN_MAX_WAIT_MS) -> bool:
    interval_s = SPAWN_POLL_INTERVAL_MS / 1000.0

    def _attempt() -> bool:
        meta = read_metadata(host, port)
        candidate = meta.socketPath if meta and meta.socketPath else str(socket_path(host, port))
        try:
            family, address = parse_socket_path(candidate)
        except ValueError:
            return False
        try:
            with socket.socket(family, socket.SOCK_STREAM) as sock:
                sock.settimeout(interval_s)
                sock.connect(address)
                return True
        except OSError:
            return False

    return bool(
        poll_until(
            _attempt,
            timeout_ms=timeout_ms,
            interval_ms=SPAWN_POLL_INTERVAL_MS,
        )
    )


_LOG_TAIL_MAX_BYTES = 4096


def _read_log_tail(host: str, port: int) -> str:
    try:
        data = log_path(host, port).read_bytes()
    except (FileNotFoundError, OSError):
        return ""
    if not data:
        return ""
    if len(data) > _LOG_TAIL_MAX_BYTES:
        data = data[-_LOG_TAIL_MAX_BYTES:]
    return data.decode("utf-8", errors="replace").strip()


def _diagnose_spawn_failure(
    host: str,
    port: int,
    proc: Optional[subprocess.Popen],
    timeout_ms: int,
) -> str:
    child_exit = proc.poll() if proc is not None else None
    if child_exit is not None:
        head = f"attach daemon exited early (code {child_exit}) before socket was ready"
    else:
        head = f"attach session did not start within {timeout_ms}ms (child still running)"

    tail = _read_log_tail(host, port)
    if tail:
        return f"{head}; child log tail:\n{tail}"
    return f"{head}; child log is empty ({log_path(host, port)})"
