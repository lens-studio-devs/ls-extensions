# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import json
import subprocess
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Optional


@dataclass
class DiscoveryResult:
    ok: bool
    targets: list[dict[str, Any]]
    error: str


# 500_000 ms in the C++ tool — keep the same generous upper bound. Practical
# discovery completes in milliseconds; this only matters if LensStudio is
# struggling.
DEFAULT_TIMEOUT_S = 500.0


def discover_targets(host: str, port: int, timeout_s: float = DEFAULT_TIMEOUT_S) -> DiscoveryResult:
    url = f"http://{host}:{port}/json/list"
    try:
        with urllib.request.urlopen(url, timeout=timeout_s) as resp:
            body = resp.read().decode("utf-8")
    except urllib.error.URLError as e:
        reason = getattr(e, "reason", e)
        # Mirror the C++ phrasing for connection-refused — agents key off it.
        text = str(reason)
        if "Connection refused" in text or "refused" in text.lower():
            return DiscoveryResult(
                ok=False,
                targets=[],
                error=f"Connection refused at {url} — is LensStudio running with DevTools enabled?",
            )
        return DiscoveryResult(ok=False, targets=[], error=text)
    except TimeoutError:
        return DiscoveryResult(ok=False, targets=[], error="Connection timed out")
    except OSError as e:
        return DiscoveryResult(ok=False, targets=[], error=str(e))

    try:
        data = json.loads(body)
    except json.JSONDecodeError as e:
        return DiscoveryResult(ok=False, targets=[], error=f"Failed to parse response: {e}")

    if not isinstance(data, list):
        return DiscoveryResult(ok=False, targets=[], error="Unexpected response shape (expected JSON array)")

    return DiscoveryResult(ok=True, targets=data, error="")


# `lsof` lookup completes in ~50ms on a healthy machine; a multi-second
# stall almost always means we're racing a Lens Studio crash. Capping the
# budget keeps disconnect diagnostics from blocking the error envelope.
_LSOF_TIMEOUT_S = 2.0


def find_listening_pid(host: str, port: int) -> Optional[int]:
    if sys.platform != "darwin":
        return None
    try:
        result = subprocess.run(
            ["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-Fp"],
            capture_output=True,
            text=True,
            timeout=_LSOF_TIMEOUT_S,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    for line in result.stdout.splitlines():
        if line.startswith("p") and line[1:].isdigit():
            return int(line[1:])
    return None


def canonical_ls_log_hint() -> str:
    if sys.platform == "darwin":
        return "~/Library/Logs (search for Lens Studio or DiagnosticReports)"
    if sys.platform == "win32":
        return "%LOCALAPPDATA%\\Snap Inc\\Lens Studio\\logs"
    if sys.platform.startswith("linux"):
        return "~/.config/Snap Inc/Lens Studio/logs"
    return ""
