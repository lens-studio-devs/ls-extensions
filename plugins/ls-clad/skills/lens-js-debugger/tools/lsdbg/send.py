# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import json
import socket
import sys

from .console_events import FilterParseError, parse_duration_seconds
from .daemon_state import DEFAULT_CONSOLE_LOG_TIMEOUT_S
from .json_io import Envelope, emit_stderr, emit_stdout
from .poll import poll_until
from .session_metadata import parse_socket_path, read_metadata, socket_path

CONNECT_RETRY_INTERVAL_MS = 200
CONNECT_MAX_WAIT_MS = 5000


def run_send(
    host: str,
    port: int,
    payload_str: str,
    shorthand: bool,
) -> int:
    try:
        _early = json.loads(payload_str)
        command_name = _early.get("command") if isinstance(_early, dict) else None
    except json.JSONDecodeError:
        command_name = None

    meta = read_metadata(host, port)
    if meta is not None and meta.socketPath:
        socket_artifact = meta.socketPath
    else:
        socket_artifact = str(socket_path(host, port))

    try:
        family, address = parse_socket_path(socket_artifact)
    except ValueError as e:
        emit_stdout(Envelope.error(str(e)))
        return 1

    sock = _connect_with_retry(family, address)
    if sock is None:
        if command_name == "cleanup":
            # Teardown against an already-dead daemon: nothing to clean, so
            # report success rather than a connect error. Cleanup is meant to
            # be idempotent — a false failure here forces agents into a manual
            # process kill.
            _emit_cleanup_already_gone(shorthand)
            return 0
        emit_stdout(
            Envelope.error(
                f"Failed to connect to lsdbg session at {socket_artifact} after "
                f"{CONNECT_MAX_WAIT_MS // 1000}s. Is 'lsdbg attach' running?"
            )
        )
        return 1

    try:
        sock.sendall(payload_str.encode("utf-8") + b"\n")
    except OSError as e:
        if command_name == "cleanup":
            _emit_cleanup_already_gone(shorthand)
            sock.close()
            return 0
        emit_stdout(Envelope.error(f"Failed to send payload to daemon: {e}"))
        sock.close()
        return 1

    # 30s default; extended for waitFor / waitForIdleMs (server timeout +
    # 5s grace); extended for blocking console-log to (timeout + 5s grace)
    # so the client doesn't time out before the server's deadline fires.
    client_timeout_s: float | None = 30.0
    # console-log returns `result.lines` (formatted strings); shorthand mode
    # prints them as plaintext rather than emitting the JSON envelope.
    render_lines = False
    try:
        parsed = json.loads(payload_str)
        has_wait_for = isinstance(parsed, dict) and isinstance(parsed.get("waitFor"), str)
        wait_idle = parsed.get("waitForIdleMs") if isinstance(parsed, dict) else None
        has_wait_idle = isinstance(wait_idle, int) and not isinstance(wait_idle, bool)
        if has_wait_for or has_wait_idle:
            server_timeout_ms = parsed.get("waitTimeout", 30000)
            if isinstance(server_timeout_ms, int) and not isinstance(server_timeout_ms, bool):
                client_timeout_s = (server_timeout_ms + 5000) / 1000.0
        if isinstance(parsed, dict) and parsed.get("command") == "console-log":
            render_lines = True
            is_blocking = parsed.get("waitForPattern") is not None
            if is_blocking:
                # Parse duration string ("5s"/"100ms"/"2m") to seconds. On
                # bad input the server will reject the request anyway, so
                # fall back to the 30s default (matches the server's
                # implicit deadline when --timeout is omitted).
                try:
                    server_seconds = parse_duration_seconds(parsed.get("timeout"))
                except FilterParseError:
                    server_seconds = None
                deadline_s = server_seconds if server_seconds is not None else DEFAULT_CONSOLE_LOG_TIMEOUT_S
                client_timeout_s = deadline_s + 5.0
    except json.JSONDecodeError:
        pass

    return _read_until_done(
        sock,
        shorthand=shorthand,
        timeout_s=client_timeout_s,
        render_lines=render_lines,
    )


def capture_result(host: str, port: int, payload_str: str, timeout_s: float = 10.0) -> dict | None:
    meta = read_metadata(host, port)
    socket_artifact = meta.socketPath if (meta is not None and meta.socketPath) else str(socket_path(host, port))
    try:
        family, address = parse_socket_path(socket_artifact)
    except ValueError:
        return None

    sock = _connect_with_retry(family, address)
    if sock is None:
        return None

    try:
        sock.sendall(payload_str.encode("utf-8") + b"\n")
    except OSError:
        sock.close()
        return None

    try:
        sock.settimeout(timeout_s)
        buffer = b""
        while True:
            try:
                chunk = sock.recv(65536)
            except (socket.timeout, OSError):
                return None
            if not chunk:
                return None
            buffer += chunk
            while True:
                nl = buffer.find(b"\n")
                if nl < 0:
                    break
                line = buffer[:nl].strip()
                buffer = buffer[nl + 1 :]
                if not line:
                    continue
                try:
                    obj = json.loads(line.decode("utf-8", errors="replace"))
                except json.JSONDecodeError:
                    continue
                if not isinstance(obj, dict):
                    continue
                if obj.get("__done") is True:
                    return None
                if "ok" in obj:
                    if obj.get("ok"):
                        result = obj.get("result")
                        return result if isinstance(result, dict) else {}
                    return None
    finally:
        try:
            sock.close()
        except OSError:
            pass


def _emit_cleanup_already_gone(shorthand: bool) -> None:
    result = {"daemon": "stopped", "alreadyGone": True}
    emit_stdout(result if shorthand else Envelope.success(result))


def _connect_with_retry(family: int, address: object) -> socket.socket | None:
    interval_s = CONNECT_RETRY_INTERVAL_MS / 1000.0

    def _attempt() -> socket.socket | None:
        try:
            sock = socket.socket(family, socket.SOCK_STREAM)
            sock.settimeout(interval_s)
            sock.connect(address)
            sock.settimeout(None)
            return sock
        except OSError:
            try:
                sock.close()  # type: ignore[possibly-unbound]
            except Exception:
                pass
            return None

    return poll_until(
        _attempt,
        timeout_ms=CONNECT_MAX_WAIT_MS,
        interval_ms=CONNECT_RETRY_INTERVAL_MS,
    )


def _read_until_done(
    sock: socket.socket,
    shorthand: bool,
    timeout_s: float | None,
    render_lines: bool = False,
) -> int:
    sock.settimeout(timeout_s)
    buffer = b""
    exit_code = 0
    saw_first_response = False

    try:
        while True:
            try:
                chunk = sock.recv(65536)
            except socket.timeout:
                emit_stdout(Envelope.error("Timed out waiting for response from lsdbg session"))
                return 1
            except KeyboardInterrupt:
                # Ctrl-C during a long-running verb (blocking console-log,
                # --wait-paused / --wait-idle) is the normal exit.
                return 0
            except OSError as e:
                if not saw_first_response:
                    emit_stdout(Envelope.error(f"Connection error while reading response: {e}"))
                    return 1
                # Dropped mid-stream — surface what we have.
                break

            if not chunk:
                # Socket closed cleanly without sentinel — process any
                # remainder then exit.
                break

            buffer += chunk
            while True:
                nl = buffer.find(b"\n")
                if nl < 0:
                    break
                line = buffer[:nl].strip()
                buffer = buffer[nl + 1 :]
                if not line:
                    continue
                saw_first_response = True

                done, line_exit_code = _process_line(line, shorthand=shorthand, render_lines=render_lines)
                if line_exit_code != 0:
                    exit_code = line_exit_code
                if done:
                    return exit_code
    finally:
        try:
            sock.close()
        except OSError:
            pass

    return exit_code


def _process_line(line: bytes, shorthand: bool, render_lines: bool = False) -> tuple[bool, int]:
    try:
        obj = json.loads(line.decode("utf-8", errors="replace"))
    except json.JSONDecodeError:
        # Echo unrecognized lines so nothing gets silently swallowed.
        sys.stdout.write(line.decode("utf-8", errors="replace") + "\n")
        sys.stdout.flush()
        return False, 0

    if isinstance(obj, dict) and obj.get("__done") is True:
        return True, 0

    if shorthand and isinstance(obj, dict) and "ok" in obj:
        if obj.get("ok"):
            result = obj.get("result", {})
            # console-log prints its `lines` as NDJSON — one JSON object per
            # line. Empty result → empty stdout, which for a --wait-pattern
            # call means the deadline expired with no match.
            if render_lines:
                lines = result.get("lines", []) if isinstance(result, dict) else []
                if lines:
                    sys.stdout.write("\n".join(json.dumps(line, ensure_ascii=False) for line in lines) + "\n")
                    sys.stdout.flush()
                return False, 0
            # Trigger verbs (resume/pause/step-*/reload) return an empty
            # result; emit an explicit `{"ok": true}` so the agent gets a
            # positive success signal instead of a bare `{}` it must interpret
            # against absence-of-error. Print `{}` rather than suppress: empty
            # stdout means "command never reached here" per response-stream.md.
            emit_stdout({"ok": True} if result == {} else result)
            return False, 0
        else:
            err = obj.get("error", {}) or {}
            emit_stderr(err.get("message", "unknown error"))
            return False, 1

    # Wait-for streaming events (e.g. the Debugger.paused emitted alongside a
    # --wait-paused envelope) carry `method`, not `ok` — pass through as-is.
    emit_stdout(obj)
    return False, 0
