# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

from .event_compaction import compact_remote_object

_NEWLINE_RE = re.compile(r"\r?\n")


def _format_timestamp(timestamp: float) -> str:
    if not timestamp:
        return "-"
    return datetime.fromtimestamp(timestamp / 1000.0, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass
class ConsoleEvent:
    seq: int
    timestamp: float
    level: str
    args: list[dict[str, Any]]
    message: str
    source: Optional[str]
    stack: Optional[list[dict[str, Any]]]

    def to_dict(self) -> dict[str, Any]:
        ts = _format_timestamp(self.timestamp)
        record: dict[str, Any] = {
            "seq": self.seq,
            "ts": None if ts == "-" else ts,
            "source": self.source,
            "level": self.level,
            "message": _NEWLINE_RE.sub(" ", self.message),
        }
        if self.args:
            record["args"] = self.args
        if self.stack:
            record["stack"] = self.stack
        return record


def _basename(url: str) -> str:
    if not url:
        return url
    pos = max(url.rfind("/"), url.rfind("\\"))
    return url[pos + 1 :] if pos >= 0 else url


def _arg_to_message_part(arg: dict[str, Any]) -> str:
    if "value" in arg:
        v = arg["value"]
        if v is None:
            return "null"
        if isinstance(v, bool):
            return "true" if v else "false"
        return str(v)
    if "unrepresentable" in arg and isinstance(arg["unrepresentable"], str):
        return arg["unrepresentable"]
    if "description" in arg and isinstance(arg["description"], str):
        return arg["description"]
    t = arg.get("type", "?")
    sub = arg.get("subtype")
    return f"<{t}:{sub}>" if sub else f"<{t}>"


def _build_stack(stack_trace: Any) -> tuple[Optional[str], Optional[list[dict[str, Any]]]]:
    if not isinstance(stack_trace, dict):
        return None, None
    frames = stack_trace.get("callFrames")
    if not isinstance(frames, list) or not frames:
        return None, None

    top = frames[0] if isinstance(frames[0], dict) else {}
    url = top.get("url", "")
    line = top.get("lineNumber", 0)
    col = top.get("columnNumber", 0)
    source = f"{_basename(url)}:{line}:{col}" if url or line or col else None

    if len(frames) <= 1:
        return source, None

    compacted: list[dict[str, Any]] = []
    for f in frames:
        if not isinstance(f, dict):
            continue
        compacted.append(
            {
                "function": f.get("functionName", ""),
                "url": _basename(f.get("url", "")),
                "line": f.get("lineNumber", 0),
                "col": f.get("columnNumber", 0),
            }
        )
    return source, compacted


def compact_console_event(seq: int, raw: dict[str, Any]) -> ConsoleEvent:
    params = raw.get("params") or {}
    raw_args = params.get("args") or []
    args = [compact_remote_object(a) for a in raw_args]
    message = " ".join(_arg_to_message_part(a) for a in args)
    source, stack = _build_stack(params.get("stackTrace"))
    return ConsoleEvent(
        seq=seq,
        timestamp=float(params.get("timestamp", 0) or 0),
        level=str(params.get("type", "log")),
        args=args,
        message=message,
        source=source,
        stack=stack,
    )


def _stack_from_paused_frames(frames: Any) -> tuple[Optional[str], Optional[list[dict[str, Any]]]]:
    if not isinstance(frames, list) or not frames:
        return None, None
    top = frames[0] if isinstance(frames[0], dict) else {}
    top_loc = top.get("location") or {}
    url = top.get("url", "")
    line = top_loc.get("lineNumber", 0)
    col = top_loc.get("columnNumber", 0)
    source = f"{_basename(url)}:{line}:{col}" if url or line or col else None

    if len(frames) <= 1:
        return source, None

    compacted: list[dict[str, Any]] = []
    for f in frames:
        if not isinstance(f, dict):
            continue
        loc = f.get("location") or {}
        compacted.append(
            {
                "function": f.get("functionName", ""),
                "url": _basename(f.get("url", "")),
                "line": loc.get("lineNumber", 0),
                "col": loc.get("columnNumber", 0),
            }
        )
    return source, compacted


def compact_exception_event(seq: int, raw: dict[str, Any]) -> ConsoleEvent:
    params = raw.get("params") or {}
    data = params.get("data") if isinstance(params.get("data"), dict) else {}
    compacted = compact_remote_object(data) if data else {}
    # Prefer the description (`"TypeError: foo.bar is not a function"`); fall
    # back to a stringified primitive value, then to a generic placeholder.
    message_parts: list[str] = []
    if isinstance(data.get("description"), str):
        message_parts.append(data["description"])
    elif "value" in data:
        message_parts.append(_arg_to_message_part(compacted))
    else:
        message_parts.append("uncaught exception")
    message = message_parts[0]
    source, stack = _stack_from_paused_frames(params.get("callFrames"))
    return ConsoleEvent(
        seq=seq,
        timestamp=float(params.get("timestamp", 0) or 0),
        level="error",
        args=[],
        message=message,
        source=source,
        stack=stack,
    )


# ---------- filter spec ----------


@dataclass
class FilterSpec:
    since: Optional[int] = None


def event_matches(event: ConsoleEvent, spec: FilterSpec) -> bool:
    if spec.since is not None and event.seq <= spec.since:
        return False
    return True


def filter_events(events: Iterable[ConsoleEvent], spec: FilterSpec) -> list[ConsoleEvent]:
    return [e for e in events if event_matches(e, spec)]


# ---------- payload validation helpers ----------


class FilterParseError(ValueError):
    pass


def parse_int(value: Any, field: str, *, allow_negative: bool = False) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise FilterParseError(f'"{field}" must be an integer')
    if not allow_negative and value < 0:
        raise FilterParseError(f'"{field}" must be non-negative')
    return value


_DURATION_RE = re.compile(r"^\s*([0-9]+(?:\.[0-9]+)?)\s*(ms|s|m)?\s*$")


def parse_duration_seconds(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if value < 0:
            raise FilterParseError('"for" must be non-negative')
        return float(value)
    if not isinstance(value, str):
        raise FilterParseError('"for" must be a duration string like "5s"')
    m = _DURATION_RE.match(value)
    if not m:
        raise FilterParseError(f'"for" must be a duration like "5s", "500ms", or "2m" (got: {value!r})')
    n = float(m.group(1))
    unit = m.group(2) or "s"
    factor = {"ms": 0.001, "s": 1.0, "m": 60.0}[unit]
    return n * factor


def parse_pattern(value: Any) -> Optional[re.Pattern[str]]:
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise FilterParseError('"untilPattern" must be a string')
    try:
        return re.compile(value)
    except re.error as e:
        raise FilterParseError(f'"untilPattern" is not a valid regex: {e}')
