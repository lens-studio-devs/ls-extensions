# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import json
import sys
from typing import Any

from .recovery import RECOVERY, classify


class Envelope:
    @staticmethod
    def success(result: Any, caller_id: Any = None, warning: str = "") -> dict[str, Any]:
        obj: dict[str, Any] = {"ok": True, "result": result}
        if caller_id is not None:
            obj["id"] = caller_id
        if warning:
            obj["warning"] = warning
        return obj

    @staticmethod
    def error(
        message: str,
        code: int = -1,
        caller_id: Any = None,
        warning: str = "",
        extra: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        error_obj: dict[str, Any] = {"message": message, "code": code}
        # `extra` carries diagnostic fields that don't belong on every error
        # (Connection-lost enrichment in particular: hostPid / hostAlive /
        # lastEventSeq / lsLogPath). Merged into the inner `error` block so
        # they ride alongside the canonical `message` and `code` and agents
        # can read them off `env.error.hostPid` without a separate path.
        if extra:
            error_obj.update(extra)
        # Attach a recovery hint at the moment of failure. errorCode may already
        # ride on `extra` (e.g. multiple_targets); otherwise classify off the
        # message/code. Unknown failures get neither field — recovery is opt-in
        # per known errorCode.
        error_code = error_obj.get("errorCode") or classify(message, code)
        if error_code:
            error_obj["errorCode"] = error_code
            if "recovery" not in error_obj and error_code in RECOVERY:
                error_obj["recovery"] = RECOVERY[error_code]
        obj: dict[str, Any] = {"ok": False, "error": error_obj}
        if caller_id is not None:
            obj["id"] = caller_id
        if warning:
            obj["warning"] = warning
        return obj


def emit_stdout(obj: Any) -> None:
    sys.stdout.write(json.dumps(obj, indent=2, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def emit_stderr(text: str) -> None:
    sys.stderr.write(text + "\n")
    sys.stderr.flush()


def encode_line(obj: Any) -> bytes:
    return (json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def fail(message: str, code: int = -1, caller_id: Any = None, extra: dict[str, Any] | None = None) -> None:
    emit_stdout(Envelope.error(message, code=code, caller_id=caller_id, extra=extra))
    emit_stderr(message)
