# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

from typing import Optional

# errorCode -> "what to do next". Single home for recovery text; Envelope.error
# attaches it automatically whenever an error carries (or is classified into) a
# known errorCode, so the guidance reaches the agent at the moment of failure
# instead of living in SKILL.md / references where it's read up-front and often
# never needed.
RECOVERY: dict[str, str] = {
    "connection_refused": (
        "STOP — the daemon is gone. Reload the lens in Lens Studio to re-create the debug "
        "target, then re-run; the next verb auto-attaches a fresh daemon. Do not retry blind."
    ),
    "connection_lost": (
        "STOP. If error.hostAlive is false the Lens Studio host crashed — ask the user to "
        "restart it, then re-attach. If true (rare), run `lsdbg cleanup --force` and re-attach. "
        "Do not retry blind."
    ),
    "daemon_wedged": (
        "Daemon is stuck on a debug roundtrip (the VM stopped responding). Run "
        "`lsdbg cleanup --force`, then re-attach. Do not pkill Lens Studio."
    ),
    "bp_no_script": (
        "Pass more of the path — the error lists the loaded URLs; a paused backtrace[].url also shows them."
    ),
    "bp_ambiguous": "Add a parent directory to disambiguate (e.g. 'ui/Bug.ts', not 'Bug.ts').",
    "bp_no_source_map": (
        "The build stripped source maps, or the .ts isn't in the loaded .js's `sources`. Set "
        "the breakpoint on the .js path directly (.js input lines are 0-based)."
    ),
    "attach_target_busy": (
        "A different target is already attached. Run `lsdbg cleanup` first, then attach to the one you want."
    ),
    "multiple_targets": (
        "More than one target is attached. Re-issue with --target <title|id> (titles are in "
        "error.targets), or `lsdbg cleanup --all` to tear everything down."
    ),
    "stale_build": (
        "The daemon is running pre-upgrade code. Run `lsdbg cleanup` and retry; the CLI's "
        "auto-respawn normally handles this transparently."
    ),
}

# These couple recovery to the *observable* failure (a stable message fragment or
# the CDP disconnect code) rather than to a call site, so the matrix that used to
# live in references/recovery.md collapses to this one table. When changing a
# failure message, keep its fragment here in sync or the recovery hint drops
# silently.
_CODE_SIGNATURES: dict[int, str] = {-32002: "connection_lost"}
_MESSAGE_SIGNATURES: tuple[tuple[str, str], ...] = (
    ("Connection refused", "connection_refused"),
    ("Timed out waiting for response", "daemon_wedged"),
    ("no script matching", "bp_no_script"),
    ("ambiguous filename", "bp_ambiguous"),
    ("sourceMapURL", "bp_no_source_map"),
    ("no source map listed", "bp_no_source_map"),
    ("already attached to target", "attach_target_busy"),
    ("unknown command:", "stale_build"),
)


def classify(message: str, code: Optional[int] = None) -> Optional[str]:
    if code is not None and code in _CODE_SIGNATURES:
        return _CODE_SIGNATURES[code]
    for fragment, error_code in _MESSAGE_SIGNATURES:
        if fragment in message:
            return error_code
    return None
