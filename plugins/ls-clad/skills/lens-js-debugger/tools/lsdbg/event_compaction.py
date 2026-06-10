# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import re
from typing import Any, Optional

# Hermes async desugaring synthesizes `?anon_<step>_<fn>` closures whose
# `this` is the stepper, not the component, and whose locals scope is empty.
_ASYNC_STEPPER_NAME = re.compile(r"^\?anon_\d+_\w+$")


def is_async_stepper_frame_name(name: str) -> bool:
    return bool(_ASYNC_STEPPER_NAME.match(name))


def frame_has_native_frame_below(paused_event: dict[str, Any], target_call_frame_id: str) -> bool:
    params = paused_event.get("params") or {}
    frames = params.get("callFrames") or []
    for pos, frame in enumerate(frames):
        if frame.get("callFrameId", "") != target_call_frame_id:
            continue
        try:
            hermes_idx = int(target_call_frame_id)
        except (TypeError, ValueError):
            return False
        return hermes_idx != pos
    return False


def compact_remote_object(obj: Any) -> dict[str, Any]:
    if not isinstance(obj, dict):
        return {"type": "undefined"}
    compact: dict[str, Any] = {"type": obj.get("type", "undefined")}
    if "subtype" in obj:
        compact["subtype"] = obj["subtype"]
    if "value" in obj:
        compact["value"] = obj["value"]
    elif "unserializableValue" in obj:
        compact["unrepresentable"] = obj["unserializableValue"]
    if "objectId" in obj:
        compact["objectId"] = obj["objectId"]
    if "description" in obj and "value" not in obj and "unserializableValue" not in obj:
        compact["description"] = obj["description"]
    return compact


def extract_exception_text(data: Any) -> Optional[str]:
    if not isinstance(data, dict):
        return None
    text = data.get("description")
    if text is None:
        text = data.get("value")
    if text is None:
        return None
    return text if isinstance(text, str) else str(text)


def _compact_paused(
    event: dict[str, Any],
    script_id_to_url: Optional[dict[str, str]] = None,
) -> dict[str, Any]:
    params = event.get("params", {}) or {}
    frames_out: list[dict[str, Any]] = []
    for frame in params.get("callFrames", []) or []:
        url = frame.get("url", "")
        location = frame.get("location") or {}
        script_id = location.get("scriptId", "")
        if not url and script_id and script_id_to_url:
            url = script_id_to_url.get(script_id, "")
        function_name = frame.get("functionName", "") or "<anonymous>"
        f: dict[str, Any] = {
            "callFrameId": frame.get("callFrameId", ""),
            "function": function_name,
            "url": url,
        }
        if is_async_stepper_frame_name(function_name):
            f["asyncFrame"] = True
        if script_id:
            f["scriptId"] = script_id
        if "location" in frame:
            # `generatedLine` is the 1-based compiled (.js) line. `editorLine`
            # starts equal to it and is overwritten with the source line by
            # source-map enrichment when a map resolves, so `editorLine` always
            # matches the file the agent is reading.
            gen_line = location.get("lineNumber", 0) + 1
            f["editorLine"] = gen_line
            f["generatedLine"] = gen_line
            if "columnNumber" in location:
                f["column"] = location["columnNumber"]
        frames_out.append(f)
    out: dict[str, Any] = {
        "method": "Debugger.paused",
        "reason": params.get("reason", "other"),
        "frames": frames_out,
    }
    # On an exception pause, inline the thrown message so `--wait-paused`
    # consumers see *what* threw without a follow-up `health`/eval.
    if out["reason"] == "exception":
        text = extract_exception_text(params.get("data"))
        if text:
            out["exceptionText"] = text
    return out


def compact_event(
    event: dict[str, Any],
    script_id_to_url: Optional[dict[str, str]] = None,
) -> dict[str, Any]:
    method = event.get("method", "")
    if method == "Debugger.paused" and "params" in event:
        return _compact_paused(event, script_id_to_url)

    if "sessionId" in event:
        copy = dict(event)
        copy.pop("sessionId", None)
        return copy

    return event
