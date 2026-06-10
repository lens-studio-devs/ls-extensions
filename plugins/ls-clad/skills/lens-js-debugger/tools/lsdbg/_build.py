# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import hashlib
import os
from pathlib import Path

_PACKAGE_DIR = Path(__file__).resolve().parent
_HASH_LENGTH = 7  # git-short-hash convention; collision risk is irrelevant here
_cached: str | None = None


def build_id() -> str:
    global _cached
    if _cached is not None:
        return _cached
    try:
        h = hashlib.sha256()
        # Sort + include filename so renames/additions change the hash.
        for entry in sorted(os.listdir(_PACKAGE_DIR)):
            if not entry.endswith(".py"):
                continue
            path = _PACKAGE_DIR / entry
            with open(path, "rb") as f:
                h.update(entry.encode("utf-8"))
                h.update(b"\0")
                h.update(f.read())
                h.update(b"\0")
        _cached = h.hexdigest()[:_HASH_LENGTH]
    except OSError:
        _cached = ""
    return _cached
