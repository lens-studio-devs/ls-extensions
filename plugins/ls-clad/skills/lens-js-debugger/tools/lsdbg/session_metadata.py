# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import errno
import json
import os
import socket
import sys
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Optional

# ---------- paths ----------


def _tmp() -> Path:
    return Path(tempfile.gettempdir())


def metadata_path(host: str, port: int) -> Path:
    return _tmp() / f"lsdbg-{host}-{port}.json"


def socket_path(host: str, port: int) -> Path:
    return _tmp() / f"lsdbg-{host}-{port}.sock"


def lock_path(host: str, port: int) -> Path:
    return _tmp() / f"lsdbg-{host}-{port}.lock"


def log_path(host: str, port: int) -> Path:
    return _tmp() / f"lsdbg-{host}-{port}.log"


# ---------- metadata schema ----------


@dataclass
class SessionMetadata:
    pid: int
    host: str
    port: int
    targetId: str
    browserSessionId: str
    pageSessionId: str
    # POSIX: AF_UNIX path. Windows: "tcp:host:port" URI.
    socketPath: str
    startedAt: str
    # Short hash of the lsdbg package source — drives stale-daemon detection.
    build: str = ""


def write_metadata(meta: SessionMetadata) -> None:
    path = metadata_path(meta.host, meta.port)
    path.write_text(json.dumps(asdict(meta), indent=2) + "\n", encoding="utf-8")


def read_metadata(host: str, port: int) -> Optional[SessionMetadata]:
    path = metadata_path(host, port)
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None
    except OSError:
        return None

    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return None

    if not isinstance(data.get("pid"), int) or data["pid"] <= 0:
        return None
    if not isinstance(data.get("host"), str) or not data["host"]:
        return None
    if not isinstance(data.get("port"), int) or data["port"] <= 0:
        return None
    if not isinstance(data.get("socketPath"), str) or not data["socketPath"]:
        return None

    return SessionMetadata(
        pid=data["pid"],
        host=data["host"],
        port=int(data["port"]),
        targetId=data.get("targetId", "") or "",
        browserSessionId=data.get("browserSessionId", "") or "",
        pageSessionId=data.get("pageSessionId", "") or "",
        socketPath=data["socketPath"],
        startedAt=data.get("startedAt", "") or "",
        build=data.get("build", "") or "",
    )


def remove_metadata(host: str, port: int) -> None:
    try:
        metadata_path(host, port).unlink()
    except FileNotFoundError:
        pass
    except OSError:
        pass


# ---------- process control ----------


def is_process_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if sys.platform == "win32":
        return _win_is_process_alive(pid)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        # EPERM means the process exists (we just can't signal it).
        return True
    except OSError as e:
        if e.errno == errno.ESRCH:
            return False
        return True
    return True


def terminate_process(pid: int) -> None:
    if pid <= 0:
        return
    if sys.platform == "win32":
        _win_terminate_process(pid)
        return
    import signal as _signal

    try:
        os.kill(pid, _signal.SIGTERM)
    except (ProcessLookupError, PermissionError, OSError):
        pass


def _win_is_process_alive(pid: int) -> bool:  # pragma: no cover — Windows path
    import ctypes
    from ctypes import wintypes

    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    STILL_ACTIVE = 259

    kernel32 = ctypes.windll.kernel32
    handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not handle:
        return False
    try:
        code = wintypes.DWORD()
        ok = kernel32.GetExitCodeProcess(handle, ctypes.byref(code))
        return bool(ok) and code.value == STILL_ACTIVE
    finally:
        kernel32.CloseHandle(handle)


def _win_terminate_process(pid: int) -> None:  # pragma: no cover — Windows path
    import ctypes

    PROCESS_TERMINATE = 0x0001
    kernel32 = ctypes.windll.kernel32
    handle = kernel32.OpenProcess(PROCESS_TERMINATE, False, pid)
    if not handle:
        return
    try:
        kernel32.TerminateProcess(handle, 1)
    finally:
        kernel32.CloseHandle(handle)


# ---------- socket ping ----------


def ping_session(socket_path_value: str, connect_timeout: float = 1.0, read_timeout: float = 2.0) -> bool:
    family, address = parse_socket_path(socket_path_value)
    try:
        sock = socket.socket(family, socket.SOCK_STREAM)
        sock.settimeout(connect_timeout)
        sock.connect(address)
    except OSError:
        return False
    try:
        sock.sendall(b'{"command":"list-commands","id":"ping"}\n')
        sock.settimeout(read_timeout)
        data = b""
        # Read until we see any newline (one full envelope) or timeout.
        try:
            while b"\n" not in data:
                chunk = sock.recv(4096)
                if not chunk:
                    break
                data += chunk
        except socket.timeout:
            return False
        return b'"ok"' in data
    except OSError:
        return False
    finally:
        try:
            sock.close()
        except OSError:
            pass


def parse_socket_path(value: str) -> tuple[int, object]:
    if value.startswith("tcp:"):
        rest = value[len("tcp:") :]
        host, _, port_str = rest.rpartition(":")
        if not host or not port_str.isdigit():
            raise ValueError(f"invalid tcp socket path: {value!r}")
        return socket.AF_INET, (host, int(port_str))
    # POSIX AF_UNIX
    return socket.AF_UNIX, value
