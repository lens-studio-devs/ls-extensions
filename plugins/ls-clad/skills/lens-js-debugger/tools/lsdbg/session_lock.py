# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import os
import sys
from typing import Optional


class SessionLock:
    def __init__(self) -> None:
        self._fd: Optional[int] = None
        self._win_handle = None  # type: ignore[var-annotated]

    @classmethod
    def try_acquire(cls, path: str) -> "SessionLock":
        lock = cls()
        if sys.platform == "win32":
            lock._acquire_win(path)
        else:
            lock._acquire_posix(path)
        return lock

    def is_locked(self) -> bool:
        if sys.platform == "win32":
            return self._win_handle is not None
        return self._fd is not None

    def close(self) -> None:
        if sys.platform == "win32":
            if self._win_handle is not None:
                import ctypes

                ctypes.windll.kernel32.CloseHandle(self._win_handle)
                self._win_handle = None
        else:
            if self._fd is not None:
                try:
                    os.close(self._fd)
                except OSError:
                    pass
                self._fd = None

    def __del__(self) -> None:  # pragma: no cover - GC fallback
        try:
            self.close()
        except Exception:
            pass

    def __enter__(self) -> "SessionLock":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    # ---------- platform impls ----------

    def _acquire_posix(self, path: str) -> None:
        import fcntl

        fd = os.open(path, os.O_WRONLY | os.O_CREAT, 0o644)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            os.close(fd)
            return  # lock not acquired — is_locked() returns False
        self._fd = fd

    def _acquire_win(self, path: str) -> None:  # pragma: no cover — Windows path
        import ctypes
        from ctypes import wintypes

        GENERIC_WRITE = 0x40000000
        CREATE_ALWAYS = 2
        FILE_ATTRIBUTE_NORMAL = 0x80
        LOCKFILE_EXCLUSIVE_LOCK = 0x00000002
        LOCKFILE_FAIL_IMMEDIATELY = 0x00000001
        INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value

        kernel32 = ctypes.windll.kernel32
        # CreateFileW + the raw Unicode str (ctypes marshals it as LPCWSTR).
        # CreateFileA would interpret bytes as the ANSI code page, corrupting
        # paths under a non-ASCII %TEMP% (e.g. non-ASCII usernames).
        handle = kernel32.CreateFileW(
            path,
            GENERIC_WRITE,
            0,
            None,
            CREATE_ALWAYS,
            FILE_ATTRIBUTE_NORMAL,
            None,
        )
        if handle == INVALID_HANDLE_VALUE or handle is None:
            return

        class _OVERLAPPED(ctypes.Structure):
            _fields_ = [
                ("Internal", ctypes.c_void_p),
                ("InternalHigh", ctypes.c_void_p),
                ("Offset", wintypes.DWORD),
                ("OffsetHigh", wintypes.DWORD),
                ("hEvent", ctypes.c_void_p),
            ]

        ov = _OVERLAPPED()
        ok = kernel32.LockFileEx(
            handle,
            LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY,
            0,
            1,
            0,
            ctypes.byref(ov),
        )
        if not ok:
            kernel32.CloseHandle(handle)
            return
        self._win_handle = handle
