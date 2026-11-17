#!/usr/bin/env python3

"""Audit a publish transcript for the high-impact orchestration invariants.

This is an offline regression tool, not part of the healthy publish path. It
checks the parent JSONL transcript after a controlled forward test.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

# A 10-second native recording costs ~17 s of recorder wall time on its own, and
# spawn plus the escalated-permission approval round trip routinely adds 15-20 s
# before the worker's first command runs. Keep these in sync with SKILL.md.
CAPTURE_BUDGET_MS = 90_000
RECORDER_LAUNCH_LIMIT_MS = 25_000
CAPTURE_DISPATCH_LIMIT_MS = 5_000
YIELDED_JOIN_LIMIT_MS = 5_000


def parse_timestamp(value: str) -> float:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000


def record_timeline_ms(records: list[dict[str, Any]]) -> list[float]:
    """One timestamp per record, forward-filled over records that carry none.

    A live Claude Code transcript is not the controlled shape this tool was written against: real
    sessions interleave compaction and summary records with no `timestamp` key at all, and indexing
    one directly raised KeyError on every real transcript. Records are chronological, so an
    untimestamped record inherits the previous one's time. That keeps the timeline monotonic and
    keeps every downstream latency comparison doing arithmetic on floats rather than None.
    """
    timeline: list[float] = []
    last = 0.0
    for record in records:
        raw = record.get("timestamp")
        if raw is not None:
            try:
                last = parse_timestamp(str(raw))
            except (TypeError, ValueError):
                pass
        timeline.append(last)
    # A leading run of untimestamped records would otherwise sit at 0.0, decades before the rest,
    # which would blow every elapsed-time budget. Pull them up to the first real timestamp.
    first_real = next((ms for ms in timeline if ms > 0.0), 0.0)
    return [ms if ms > 0.0 else first_real for ms in timeline]


def compact(value: Any) -> str:
    if isinstance(value, str):
        return value
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def contains_status(value: Any, status: str) -> bool:
    """Match a structured status value without matching protocol prose."""

    def nested_values(candidate: Any, *, depth: int = 0) -> Any:
        if depth > 8:
            return
        yield candidate
        if isinstance(candidate, dict):
            for child in candidate.values():
                yield from nested_values(child, depth=depth + 1)
        elif isinstance(candidate, list):
            for child in candidate:
                yield from nested_values(child, depth=depth + 1)
        elif isinstance(candidate, str):
            try:
                decoded = json.loads(candidate)
            except (json.JSONDecodeError, TypeError):
                return
            yield from nested_values(decoded, depth=depth + 1)

    return any(isinstance(candidate, dict) and candidate.get("status") == status for candidate in nested_values(value))


# Live Claude Code records carry tool calls under message.content[] blocks, not under the controlled
# `payload` envelope this tool was written against. Translating at load time means every reader and
# every detector below keeps working on one shape.
#
# Only the names the detectors cannot already recognise need an alias: `Bash` already satisfies
# is_direct_shell_call, and an MCP name like mcp__lens-studio__ExecuteEditorCode already contains
# "executeeditorcode". `Task` is the spawn primitive and would otherwise look like an ordinary call.
REAL_TOOL_NAME_ALIASES = {"task": "agent"}


def tool_result_output(block: dict[str, Any]) -> Any:
    """The text of a tool_result block, parsed as JSON when it is JSON."""
    content = block.get("content")
    if isinstance(content, list):
        text = " ".join(part.get("text", "") for part in content if isinstance(part, dict))
    else:
        text = content if isinstance(content, str) else compact(content)
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return text


def normalize_live_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Expand live-transcript tool calls and results into synthetic `payload` records.

    Each original record is kept so prose checks still see assistant text, and one synthetic record
    is appended per tool_use / tool_result block. An assistant turn may carry several tool_use
    blocks, and expanding them individually preserves both their order and the fact that they shared
    one turn.
    """
    if any(isinstance(record.get("payload"), dict) for record in records):
        return records  # already the controlled shape
    normalized: list[dict[str, Any]] = []
    for record in records:
        normalized.append(record)
        message = record.get("message")
        content = message.get("content") if isinstance(message, dict) else None
        if not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict):
                continue
            timestamp = record.get("timestamp")
            if block.get("type") == "tool_use":
                name = str(block.get("name") or "")
                normalized.append(
                    {
                        "timestamp": timestamp,
                        "payload": {
                            "type": "function_call",
                            "name": REAL_TOOL_NAME_ALIASES.get(name.casefold(), name),
                            "arguments": compact(block.get("input") or {}),
                            "call_id": str(block.get("id") or ""),
                        },
                    }
                )
            elif block.get("type") == "tool_result":
                normalized.append(
                    {
                        "timestamp": timestamp,
                        "payload": {
                            "type": "function_call_output",
                            "call_id": str(block.get("tool_use_id") or ""),
                            "output": tool_result_output(block),
                        },
                    }
                )
    return normalized


def tool_call(record: dict[str, Any]) -> tuple[str, str] | None:
    payload = record.get("payload")
    if not isinstance(payload, dict):
        return None
    if payload.get("type") not in {
        "function_call",
        "custom_tool_call",
        "mcp_tool_call",
        "mcpToolCall",
    }:
        return None
    name = str(payload.get("name") or payload.get("tool") or "")
    namespace = str(payload.get("namespace") or payload.get("server") or "")
    arguments = payload.get("arguments", payload.get("input", {}))
    return f"{namespace}.{name}".strip("."), compact(arguments)


def tool_call_id(record: dict[str, Any]) -> str:
    payload = record.get("payload")
    if not isinstance(payload, dict):
        return ""
    return str(payload.get("call_id") or payload.get("callId") or payload.get("id") or "")


def tool_output(record: dict[str, Any]) -> tuple[str, Any] | None:
    payload = record.get("payload")
    if not isinstance(payload, dict):
        return None
    if payload.get("type") not in {
        "function_call_output",
        "custom_tool_call_output",
        "mcp_tool_call_output",
        "mcpToolCallOutput",
    }:
        return None
    call_id = str(payload.get("call_id") or payload.get("callId") or "")
    if not call_id:
        return None
    return call_id, payload.get("output", payload.get("result"))


def decoded_values(value: Any, *, depth: int = 0) -> Any:
    """Yield structured values nested inside tool-output JSON strings."""
    if depth > 8:
        return
    yield value
    if isinstance(value, dict):
        for child in value.values():
            yield from decoded_values(child, depth=depth + 1)
    elif isinstance(value, list):
        for child in value:
            yield from decoded_values(child, depth=depth + 1)
    elif isinstance(value, str):
        try:
            decoded = json.loads(value)
        except (json.JSONDecodeError, TypeError):
            return
        yield from decoded_values(decoded, depth=depth + 1)


def prepared_confirmation(value: Any) -> dict[str, Any] | None:
    for candidate in decoded_values(value):
        if not isinstance(candidate, dict) or candidate.get("status") != "PUBLISH_SESSION_PREPARED":
            continue
        confirmation = candidate.get("confirmation")
        if isinstance(confirmation, dict):
            return confirmation
    return None


def assistant_message_text(record: dict[str, Any]) -> str:
    """Return only ordinary assistant prose, never text nested in tool calls/results."""
    payload = record.get("payload")
    if isinstance(payload, dict) and payload.get("type") == "message" and payload.get("role") == "assistant":
        content = payload.get("content")
    elif record.get("type") == "assistant" and isinstance(record.get("message"), dict):
        content = record["message"].get("content")
    else:
        return ""
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    return "\n".join(
        str(block.get("text") or block.get("output_text") or block.get("input_text") or "")
        for block in content
        if isinstance(block, dict) and block.get("type") in {"text", "output_text", "input_text"}
    )


def argument_object(arguments: str) -> dict[str, Any]:
    try:
        value = json.loads(arguments)
    except (json.JSONDecodeError, TypeError):
        return {}
    return value if isinstance(value, dict) else {}


def is_spawn(name: str, arguments: str, worker_kind: str) -> bool:
    tool_name = name.casefold().replace("-", "_").rsplit(".", 1)[-1]
    if tool_name not in {"spawn_agent", "spawn_worker", "create_subagent", "agent"}:
        return False
    normalized = arguments.lower().replace("-", "_").replace(" ", "_")
    if worker_kind == "capture":
        return any(
            token in normalized
            for token in ("capture_preview", "preview_capture", "preview_video_capture", "preview_video_decision")
        )
    return "promotional" in normalized or "promotion_video" in normalized


def is_promotional_build_call(name: str, arguments: str) -> bool:
    return is_publish_session_call(arguments, "build-promotional") or is_publish_session_call(arguments, "complete")


def is_raw_promotional_component_call(name: str, arguments: str) -> bool:
    return any(
        component in arguments
        for component in (
            "build-promotional-video.sh",
            "build-promotional-video.py",
            "find-promotional-music.py",
        )
    )


def is_submit_call(name: str, arguments: str) -> bool:
    normalized = arguments.lower()
    submit_endpoint = re.search(r"/submit(?=[?/\"'\s;)]|$)", normalized) is not None
    return (
        "finalize.ts" in normalized
        or submit_endpoint
        or (
            "publish-session.py authorize-finalize" in normalized and "publish-session.py record-finalize" in normalized
        )
    )


def is_package_call(name: str, arguments: str) -> bool:
    normalized = normalized_script_arguments(arguments)
    if "publish-session.py authorize-package" in normalized and "publish-session.py record-package" in normalized:
        return True
    return "package.ts" in arguments and (
        "executeeditorcode" in name.lower() or "functions.exec" in name.lower() or "path" in arguments.lower()
    )


def is_direct_shell_call(name: str) -> bool:
    normalized = name.casefold().replace("-", "_")
    return any(
        normalized.endswith(token) for token in ("exec_command", "bash", "shell", "run_shell", "run_terminal_cmd")
    )


def is_session_join_call(name: str) -> bool:
    normalized = name.casefold().replace("-", "_")
    return any(normalized.endswith(token) for token in ("write_stdin", "join_session", "wait_session", "poll_session"))


def is_worker_wait_call(name: str) -> bool:
    normalized = name.casefold().replace("-", "_")
    return any(normalized.endswith(token) for token in ("wait_agent", "wait_worker", "join_agent", "join_worker"))


def is_publish_flow_call(arguments: str, operation: str) -> bool:
    """Return whether the operation was executed, not merely described by --schema.

    The operation is the first positional argument after publish-flow.py.  Matching the
    operation name anywhere in the tool arguments made `--schema version-guard` look like a
    successful guard execution and hid real publish-flow omissions in live transcripts.
    """
    normalized = normalized_script_arguments(arguments)
    return (
        re.search(
            rf"publish-flow\.py[\"']?\s+{re.escape(operation)}(?=[\s\"';)|&]|$)",
            normalized,
        )
        is not None
    )


def is_publish_session_call(arguments: str, operation: str) -> bool:
    normalized = normalized_script_arguments(arguments)
    return (
        re.search(
            rf"publish-session\.py[\"']?\s+{re.escape(operation)}(?=[\s\"';)|&]|$)",
            normalized,
        )
        is not None
    )


def is_editor_script_call(arguments: str, script_name: str) -> bool:
    normalized = normalized_script_arguments(arguments)
    return re.search(rf"(?:^|[/\\]){re.escape(script_name)}(?=[\"'\s;)}}]|$)", normalized) is not None


def is_worker_message_call(name: str) -> bool:
    tool_name = name.casefold().replace("-", "_").rsplit(".", 1)[-1]
    return tool_name in {
        "spawn_agent",
        "spawn_worker",
        "create_subagent",
        "agent",
        "followup_task",
        "send_message",
    }


def is_preview_screenshot_call(name: str, arguments: str) -> bool:
    if is_worker_message_call(name):
        return False
    return preview_screenshot_call_count(name, arguments) > 0


def preview_screenshot_call_count(name: str, arguments: str) -> int:
    screenshot_action = r'["\']?action["\']?\s*:\s*["\']screenshot["\']'
    if "CapturePanelScreenshotTool" in name:
        return 1
    if "PreviewPanelTool" in name:
        return int(bool(re.search(screenshot_action, arguments)))
    calls = re.findall(
        r"(?:tools\.)?[A-Za-z0-9_]*(CapturePanelScreenshotTool|PreviewPanelTool)\s*\(([^)]*)\)",
        arguments,
    )
    return sum(
        tool == "CapturePanelScreenshotTool"
        or bool(re.search(screenshot_action, values))
        or "screenshotRequest" in values
        for tool, values in calls
    )


def screenshot_writes_to_disk(name: str, arguments: str) -> bool:
    """Recognize the pinned request or an explicit file-backed panel capture."""
    if "CapturePanelScreenshotTool" in name:
        values = argument_object(arguments)
        path = values.get("outputPath")
        return (
            values.get("pluginId") == "Snap.Plugin.Gui.PreviewPanel"
            and isinstance(path, str)
            and Path(path).is_absolute()
        )
    if "CapturePanelScreenshotTool" not in arguments:
        return False
    return "screenshotRequest.arguments" in arguments or bool(
        re.search(r"[\"']?pluginId[\"']?\s*:\s*[\"']Snap\.Plugin\.Gui\.PreviewPanel[\"']", arguments)
        and re.search(r"[\"']?outputPath[\"']?\s*:\s*[\"']/[^\"']+[\"']", arguments)
    )


def execute_editor_uses_inline_code(name: str, arguments: str) -> bool:
    if "executeeditorcode" in name.casefold():
        return "code" in argument_object(arguments)
    return (
        re.search(
            (
                r"executeeditorcode\s*\(\s*\{"
                r"(?:(?!\}\s*\)).){0,2000}?"
                r"(?:[\"']?code[\"']?)\s*:"
            ),
            arguments,
            flags=re.IGNORECASE | re.DOTALL,
        )
        is not None
    )


def yielded_cell_id(output: Any) -> str | None:
    match = re.search(r"Script running with cell ID ([^\s]+)", compact(output))
    return match.group(1) if match is not None else None


def wait_cell_id(arguments: str) -> str | None:
    value = argument_object(arguments).get("cell_id")
    return str(value) if value is not None else None


def returned_session_id(output: Any) -> str | None:
    match = re.search(
        (
            r"""["'](?:session_id|sessionId|session_handle|sessionHandle)["']\s*:\s*"""
            r"""(?:"([^"]+)"|'([^']+)'|(\d+))"""
        ),
        compact(output),
    )
    if match is None:
        return None
    return next((value for value in match.groups() if value is not None), None)


def written_session_id(arguments: str) -> str | None:
    values = argument_object(arguments)
    for key in ("session_id", "sessionId", "session_handle", "sessionHandle"):
        if key in values:
            return str(values[key])
    return None


def append_yield_join_violations(
    violations: list[dict[str, Any]],
    calls: list[dict[str, Any]],
    *,
    source: str,
    timing_tolerance_ms: int,
) -> None:
    for position, call in enumerate(calls):
        cell_id = yielded_cell_id(call.get("output"))
        if cell_id is None:
            continue
        next_call = calls[position + 1] if position + 1 < len(calls) else None
        if (
            next_call is None
            or not next_call["name"].endswith("wait")
            or wait_cell_id(next_call["arguments"]) != cell_id
        ):
            violations.append(
                {
                    "code": "yielded_exec_not_joined",
                    "message": (
                        f"A yielded {source} orchestration scope ({cell_id}) was not joined "
                        "by the immediately following retained-execution wait."
                    ),
                }
            )
            continue
        delay_ms = max(0, next_call["timestampMs"] - call["outputTimestampMs"])
        if delay_ms > YIELDED_JOIN_LIMIT_MS + timing_tolerance_ms:
            violations.append(
                {
                    "code": "yielded_exec_join_delayed",
                    "message": (
                        f"The yielded {source} orchestration scope ({cell_id}) waited "
                        f"{delay_ms:.0f} ms before its retained-execution wait; the limit is "
                        f"{YIELDED_JOIN_LIMIT_MS} ms."
                    ),
                }
            )


def is_register_call(arguments: str) -> bool:
    return (
        (
            "publish-session.py authorize-registration" in normalized_script_arguments(arguments)
            and "register.ts" in arguments
            and "publish-session.py record-registration" in normalized_script_arguments(arguments)
        )
        or (
            "registration-authorize" in arguments
            and "register.ts" in arguments
            and "--registration-authorization-uri" in arguments
        )
        or ("/lenses/publish" in arguments and ("spkChecksum" in arguments or "spk_checksum" in arguments))
    )


def normalized_script_arguments(arguments: str) -> str:
    """Expose script text nested in a JSON-encoded tool argument object."""
    return arguments.replace('\\"', '"')


def has_registration_state(arguments: str) -> bool:
    arguments = normalized_script_arguments(arguments)
    if is_publish_session_call(arguments, "authorize-registration") and is_publish_session_call(
        arguments, "record-registration"
    ):
        return True
    persisted_state_count = len(
        re.findall(
            r"""store\(\s*["']specsPublishRegistration["']""",
            arguments,
        )
    )
    legacy_inline_state = (
        persisted_state_count >= 2
        and re.search(r"state\s*:\s*[\"']started[\"']", arguments) is not None
        and re.search(r"state\s*:\s*[\"']succeeded[\"']", arguments) is not None
    )
    coded_state = (
        "publish-flow.py" in arguments
        and ("registration-begin" in arguments or "registration-authorize" in arguments)
        and (
            "registration-succeed" in arguments
            or ("REGISTRATION_STARTED" in arguments and "--confirmed-plan-uri" in arguments)
            or "--registration-authorization-uri" in arguments
        )
        and persisted_state_count >= 2
    )
    return legacy_inline_state or coded_state


def operation_precedes(arguments: str, operation: str, token: str) -> bool:
    operation_index = arguments.find(operation)
    token_match = re.search(token, arguments)
    token_index = token_match.start() if token_match is not None else -1
    return operation_index >= 0 and token_index > operation_index


def has_durable_plan_state(call: dict[str, Any], operation: str) -> bool:
    arguments = normalized_script_arguments(call["arguments"])
    store_token = r"""store\(\s*["']specsPublishPlan["']"""
    load_token = r"""load\(\s*["']specsPublishPlan["']\s*\)"""
    load_match = re.search(load_token, arguments)
    load_index = load_match.start() if load_match is not None else -1
    if operation == "freeze-plan":
        return operation_precedes(arguments, operation, store_token)
    if operation == "render-confirmation":
        confirmation_store = r"""store\(\s*["']specsPublishConfirmation["']"""
        return (
            load_index >= 0
            and load_index < arguments.find(operation)
            and operation_precedes(arguments, operation, confirmation_store)
        )
    if operation == "confirm-plan":
        return (
            load_index >= 0
            and load_index < arguments.find(operation)
            and operation_precedes(arguments, operation, store_token)
        )
    if operation == "package-authorize":
        version_load = re.search(r"load\(\s*[\"']specsPublishVersionPolicy[\"']\s*\)", arguments)
        return (
            load_index >= 0
            and load_index < arguments.find(operation)
            and version_load is not None
            and version_load.start() < arguments.find(operation)
        )
    return False


def has_semantic_version_value(arguments: str) -> bool:
    return (
        re.search(
            r"(?:[\"']semanticVersion[\"']|\bsemanticVersion)\s*:\s*[\"']?\d+\.\d+\.\d+",
            arguments,
        )
        is not None
    )


def audit(
    records: list[dict[str, Any]],
    *,
    expect_local_preview_video: bool,
    semantic_version_supplied: bool,
    capture_budget_ms: int,
    timing_tolerance_ms: int,
    capture_worker_records: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    timeline_ms = record_timeline_ms(records)
    outputs_by_call_id: dict[str, Any] = {}
    output_timestamps_by_call_id: dict[str, float] = {}
    for index, record in enumerate(records):
        parsed_output = tool_output(record)
        if parsed_output is not None:
            call_id, output = parsed_output
            outputs_by_call_id[call_id] = output
            output_timestamps_by_call_id[call_id] = timeline_ms[index]

    calls: list[dict[str, Any]] = []
    record_texts: list[dict[str, Any]] = []
    for index, record in enumerate(records):
        record_texts.append(
            {
                "index": index,
                "timestampMs": timeline_ms[index],
                "text": compact(record),
            }
        )
        parsed = tool_call(record)
        if parsed is None:
            continue
        name, arguments = parsed
        call_id = tool_call_id(record)
        call_timestamp_ms = timeline_ms[index]
        calls.append(
            {
                "index": index,
                "timestampMs": call_timestamp_ms,
                "name": name,
                "arguments": arguments,
                "output": outputs_by_call_id.get(call_id),
                "outputTimestampMs": output_timestamps_by_call_id.get(call_id, call_timestamp_ms),
            }
        )

    violations: list[dict[str, Any]] = []
    checks: dict[str, str] = {}
    run_interrupted = any(
        (isinstance(record.get("payload"), dict) and record["payload"].get("type") == "turn_aborted")
        or "<turn_aborted>" in compact(record)
        for record in records
    )
    compilation_failures = [
        call
        for call in calls
        if ("ExecuteEditorCode" in call["arguments"] or "executeeditorcode" in call["name"].casefold())
        and (
            contains_status(call["output"], "Compilation Failed")
            or (
                "Compilation Failed" in compact(call["output"])
                and re.search(r"\berror TS\d+", compact(call["output"])) is not None
            )
        )
    ]
    first_compilation_failure_index = (
        min(call["index"] for call in compilation_failures) if compilation_failures else None
    )
    terminal_before_package = (first_compilation_failure_index is not None or run_interrupted) and not any(
        is_package_call(call["name"], call["arguments"]) for call in calls
    )
    if compilation_failures:
        violations.append(
            {
                "code": "editor_script_compilation_failed",
                "message": "A configured Lens Studio Editor script failed TypeScript compilation.",
                "details": {
                    "callIndexes": [call["index"] for call in compilation_failures],
                },
            }
        )
    if run_interrupted:
        violations.append(
            {
                "code": "publish_run_interrupted",
                "message": "The publish turn was interrupted before reaching a terminal result.",
            }
        )
    checks["editorCompilation"] = "checked"
    append_yield_join_violations(
        violations,
        calls,
        source="parent",
        timing_tolerance_ms=timing_tolerance_ms,
    )
    checks["yieldedExecJoin"] = "checked"
    forbidden_camera_calls = [
        {"source": "parent", **call}
        for call in calls
        if "MovePreviewCamera" in call["name"]
        or re.search(r"(?:tools\.)?[A-Za-z0-9_]*MovePreviewCamera\s*\(", call["arguments"])
    ]
    forbidden_interactive_calls = [
        {"source": "parent", **call}
        for call in calls
        if any(
            tool_name in call["name"] or tool_name in call["arguments"]
            for tool_name in (
                "QueryRuntimeSceneTool",
                "PreviewInteractTool",
                "CaptureRuntimeViewTool",
            )
        )
    ]

    broad_tool_discovery_calls = [
        call for call in calls if "ALL_TOOLS" in call["arguments"] and not is_worker_message_call(call["name"])
    ]
    if broad_tool_discovery_calls:
        violations.append(
            {
                "code": "broad_tool_discovery_forbidden",
                "message": "Publish must resolve exact tools instead of enumerating the full tool registry.",
            }
        )
    checks["broadToolDiscovery"] = "prohibited"

    publish_skill_reads = [
        call
        for call in calls
        if re.search(r"specs-publish/SKILL\.md", call["arguments"])
        and re.search(r"(?:cat|sed|head|tail|wc\s+-l)", call["arguments"])
    ]
    skill_read_violation = any(re.search(r"\b(?:wc\s+-l|head)\b", call["arguments"]) for call in publish_skill_reads)
    sed_ranges: list[tuple[int, int]] = []
    for call in publish_skill_reads:
        match = re.search(
            r"""sed\s+-n\s+["']?(\d+),(\d+|\$)p["']?.{0,240}specs-publish/SKILL\.md""",
            call["arguments"],
        )
        if match is not None:
            end = sys.maxsize if match.group(2) == "$" else int(match.group(2))
            sed_ranges.append((int(match.group(1)), end))
        elif re.search(r"\bcat\b", call["arguments"]):
            if len(publish_skill_reads) > 1:
                skill_read_violation = True
        elif re.search(r"\btail\b", call["arguments"]):
            tail_match = re.search(r"\btail\s+-n\s+\+(\d+)", call["arguments"])
            if tail_match is None:
                skill_read_violation = True
            else:
                sed_ranges.append((int(tail_match.group(1)), sys.maxsize))
        else:
            skill_read_violation = True
    for previous, current in zip(sed_ranges, sed_ranges[1:]):
        if current[0] <= previous[1]:
            skill_read_violation = True
            break
    if skill_read_violation:
        violations.append(
            {
                "code": "publish_skill_reread",
                "message": ("The publish skill must be read once without wc/head/fixed-range rereads."),
            }
        )
    checks["publishSkillRead"] = "checked"

    premature_progress_calls = [
        call
        for call in calls
        if "update_plan" in call["arguments"]
        and re.search(r"""status\s*["']?\s*:\s*["']in_progress["']""", call["arguments"])
        and not any(
            item["index"] < call["index"] and contains_status(item["text"], "ACTION_REQUIRED") for item in record_texts
        )
    ]
    if premature_progress_calls:
        violations.append(
            {
                "code": "healthy_phase_in_progress_update",
                "message": (
                    "Publish phases should remain pending and transition directly to completed; "
                    "use in_progress only after ACTION_REQUIRED."
                ),
            }
        )
    checks["progressUpdates"] = "checked"

    screenshot_calls = [call for call in calls if is_preview_screenshot_call(call["name"], call["arguments"])]
    screenshot_call_count = sum(
        preview_screenshot_call_count(call["name"], call["arguments"]) for call in screenshot_calls
    )
    pair_requested = any(
        is_publish_session_call(call["arguments"], "prepare-preview-images")
        and contains_status(call.get("output"), "PREVIEW_IMAGE_CAPTURE_REQUIRED")
        for call in calls
    )
    # Auto video takes the screenshot pair after its recording, which may itself end in one
    # fallback screenshot.
    video_fallback_requested = any(contains_status(call.get("output"), "PREVIEW_SCREENSHOT_REQUIRED") for call in calls)
    screenshot_limit = 2 + int(video_fallback_requested) if pair_requested else 1
    if screenshot_call_count > screenshot_limit:
        violations.append(
            {
                "code": "preview_screenshot_recaptured",
                "message": (
                    f"The Preview screenshot tool was called {screenshot_call_count} times; "
                    f"the selected flow permits {screenshot_limit} capture(s)."
                ),
            }
        )
    base64_screenshot_calls = [
        call for call in screenshot_calls if not screenshot_writes_to_disk(call["name"], call["arguments"])
    ]
    if base64_screenshot_calls:
        violations.append(
            {
                "code": "preview_screenshot_base64_tool_forbidden",
                "message": (
                    "Store screenshots must use CapturePanelScreenshotTool with the Preview panel pluginId "
                    "and an explicit outputPath; inline/base64 capture is forbidden."
                ),
            }
        )
    non_atomic_screenshot_calls = [
        call
        for call in screenshot_calls
        if "CapturePanelScreenshotTool" in call["arguments"]
        and (
            not any(
                operation in call["arguments"] for operation in ("stage-preview-screenshot", "record-preview-images")
            )
            or not screenshot_writes_to_disk(call["name"], call["arguments"])
        )
    ]
    if non_atomic_screenshot_calls:
        violations.append(
            {
                "code": "preview_screenshot_staging_not_atomic",
                "message": (
                    "CapturePanelScreenshotTool capture and its session record/staging operation must run "
                    "from the returned screenshotRequest in one orchestration scope."
                ),
            }
        )
    screenshot_pty_calls = [
        call
        for call in calls
        if (
            "--base64-stdin" in call["arguments"]
            or (
                "stage-preview-screenshot.py" in call["arguments"]
                and re.search(r"(?:tty\s*[=:]\s*true|write_stdin|\\\\u000[34])", call["arguments"])
            )
        )
    ]
    if screenshot_pty_calls:
        violations.append(
            {
                "code": "preview_screenshot_pty_staging_forbidden",
                "message": (
                    "Preview screenshots must be transferred through an in-scope binary/file-write "
                    "primitive, not a PTY/stdin/control-character session."
                ),
            }
        )
    checks["previewScreenshotTransfer"] = "checked"

    inline_editor_calls = [call for call in calls if execute_editor_uses_inline_code(call["name"], call["arguments"])]
    if inline_editor_calls:
        violations.append(
            {
                "code": "execute_editor_inline_code",
                "message": (
                    "Publish ExecuteEditorCode calls must use pinned or generated script paths, never inline code."
                ),
                "details": {"callIndexes": [call["index"] for call in inline_editor_calls]},
            }
        )
    checks["executeEditorInput"] = "path_only"

    package_calls = [call for call in calls if is_package_call(call["name"], call["arguments"])]
    session_calls = {
        operation: [call for call in calls if is_publish_session_call(call["arguments"], operation)]
        for operation in (
            "begin-context",
            "stage-context",
            "prepare",
            "confirm",
            "authorize-package",
            "record-package",
            "authorize-registration",
            "record-registration",
            "authorize-finalize",
            "record-finalize",
            "build-promotional",
            "complete",
        )
    }
    session_lifecycle = all(
        session_calls[operation] for operation in ("stage-context", "prepare", "confirm", "authorize-package")
    )
    flow_calls = {
        operation: [call for call in calls if is_publish_flow_call(call["arguments"], operation)]
        for operation in ("freeze-plan", "render-confirmation", "confirm-plan", "package-authorize")
    }
    if terminal_before_package and not (session_lifecycle or all(flow_calls.values())):
        checks["codedPlanLifecycle"] = "not_applicable_after_terminal_failure"
    elif session_lifecycle and not session_calls["begin-context"]:
        violations.append(
            {
                "code": "context_session_bridge_missing",
                "message": (
                    "Healthy publish context capture must use begin-context and persisted Editor results; "
                    "do not transport Preflight/discovery JSON through model code."
                ),
            }
        )
    elif session_lifecycle and not (
        session_calls["begin-context"][0]["index"]
        <= session_calls["stage-context"][0]["index"]
        < session_calls["prepare"][0]["index"]
        < session_calls["confirm"][0]["index"]
        < session_calls["authorize-package"][0]["index"]
    ):
        violations.append(
            {
                "code": "coded_plan_lifecycle_out_of_order",
                "message": (
                    "The publish session must begin-context -> stage-context -> prepare -> "
                    "confirm -> authorize-package."
                ),
            }
        )
    elif not session_lifecycle and not all(flow_calls.values()):
        violations.append(
            {
                "code": "coded_plan_lifecycle_missing",
                "message": ("The publish must freeze, render, confirm, and authorize Package through publish-flow.py."),
            }
        )
    elif not session_lifecycle and not (
        flow_calls["freeze-plan"][0]["index"]
        < flow_calls["render-confirmation"][0]["index"]
        < flow_calls["confirm-plan"][0]["index"]
        < flow_calls["package-authorize"][0]["index"]
    ):
        violations.append(
            {
                "code": "coded_plan_lifecycle_out_of_order",
                "message": (
                    "The coded plan lifecycle must be freeze -> render-confirmation -> confirm -> package-authorize."
                ),
            }
        )
    if (
        not session_lifecycle
        and all(flow_calls.values())
        and not all(
            has_durable_plan_state(flow_calls[operation][0], operation)
            for operation in ("freeze-plan", "render-confirmation", "confirm-plan", "package-authorize")
        )
    ):
        violations.append(
            {
                "code": "publish_plan_state_missing",
                "message": (
                    "The complete coded plan result must be stored after freeze, loaded and "
                    "rendered from durable state, overwritten after confirm, then loaded unchanged "
                    "with the version-policy result for Package."
                ),
            }
        )
    if session_lifecycle:
        context_arguments = normalized_script_arguments(session_calls["stage-context"][0]["arguments"])
        confirm_arguments = normalized_script_arguments(session_calls["confirm"][0]["arguments"])
        if not (
            re.search(r"store\(\s*[\"']specsPublishSession[\"']", context_arguments)
            and re.search(r"load\(\s*[\"']specsPublishSession[\"']\s*\)", confirm_arguments)
        ):
            violations.append(
                {
                    "code": "publish_plan_state_missing",
                    "message": "The opaque publish-session handle must be stored before and loaded after confirmation.",
                }
            )
        prepared = prepared_confirmation(session_calls["prepare"][0].get("output"))
        if prepared is not None:
            preview_markdown = prepared.get("previewMessageMarkdown")
            confirmation_markdown = prepared.get("confirmationMarkdown")
            visible_text = "\n".join(
                assistant_message_text(record)
                for index, record in enumerate(records)
                if session_calls["prepare"][0]["index"] < index < session_calls["confirm"][0]["index"]
            )
            required_blocks = [
                block for block in (preview_markdown, confirmation_markdown) if isinstance(block, str) and block
            ]
            if required_blocks and not all(block in visible_text for block in required_blocks):
                violations.append(
                    {
                        "code": "confirmation_not_user_visible",
                        "message": (
                            "Emit the prepared preview and confirmation as ordinary assistant messages; "
                            "text nested in an orchestration/tool result is not user-visible."
                        ),
                    }
                )
        checks["confirmationVisibility"] = "checked_when_prepare_output_available"
        if any(
            token in context_arguments
            for token in ("preflightResult", "discoverResult", "base64", "btoa", "TextEncoder")
        ):
            violations.append(
                {
                    "code": "context_result_transport_forbidden",
                    "message": (
                        "stage-context must consume session-persisted results by handle; "
                        "do not encode or reconstruct Editor results."
                    ),
                }
            )
    refrozen_confirmation_calls = [
        call
        for call in calls
        if is_publish_flow_call(call["arguments"], "freeze-plan")
        and is_publish_flow_call(call["arguments"], "confirm-plan")
    ]
    if refrozen_confirmation_calls:
        violations.append(
            {
                "code": "publish_plan_refrozen_during_confirmation",
                "message": (
                    "Confirmation must load the already-frozen plan; freeze-plan and "
                    "confirm-plan cannot run in the same post-confirmation scope."
                ),
                "details": {"callIndexes": [call["index"] for call in refrozen_confirmation_calls]},
            }
        )
    reprepared_confirmation_calls = [
        call
        for call in calls
        if is_publish_session_call(call["arguments"], "prepare")
        and is_publish_session_call(call["arguments"], "confirm")
    ]
    if reprepared_confirmation_calls:
        violations.append(
            {
                "code": "publish_plan_refrozen_during_confirmation",
                "message": (
                    "Confirmation must use the existing session handle; prepare and confirm cannot share a scope."
                ),
                "details": {"callIndexes": [call["index"] for call in reprepared_confirmation_calls]},
            }
        )
    for phase in ("package", "registration", "finalize"):
        authorize_calls = session_calls[f"authorize-{phase}"]
        record_calls = session_calls[f"record-{phase}"]
        if (
            authorize_calls
            and record_calls
            and not ({call["index"] for call in authorize_calls}.intersection(call["index"] for call in record_calls))
        ):
            violations.append(
                {
                    "code": f"{phase}_session_scope_split",
                    "message": (
                        f"The authorize-{phase} -> configured Editor path -> record-{phase} chain "
                        "must stay in one orchestration scope."
                    ),
                }
            )
    unauthorized_package_calls = [
        call
        for call in package_calls
        if not (
            (
                is_publish_session_call(call["arguments"], "authorize-package")
                and is_publish_session_call(call["arguments"], "record-package")
            )
            or (
                is_publish_flow_call(call["arguments"], "package-authorize")
                and "--package-authorization-uri" in call["arguments"]
            )
        )
    ]
    if unauthorized_package_calls:
        violations.append(
            {
                "code": "package_authorization_missing",
                "message": ("Package must be generated from PACKAGE_AUTHORIZED in the same orchestration scope."),
                "details": {"callIndexes": [call["index"] for call in unauthorized_package_calls]},
            }
        )
    finalize_calls = [
        call
        for call in calls
        if "finalize.ts" in call["arguments"]
        or (
            is_publish_session_call(call["arguments"], "authorize-finalize")
            and is_publish_session_call(call["arguments"], "record-finalize")
        )
    ]
    unauthorized_finalize_calls = [
        call
        for call in finalize_calls
        if not (
            (
                is_publish_session_call(call["arguments"], "authorize-finalize")
                and is_publish_session_call(call["arguments"], "record-finalize")
            )
            or (
                is_publish_flow_call(call["arguments"], "finalize-authorize")
                and "--finalize-authorization-uri" in call["arguments"]
            )
        )
    ]
    if unauthorized_finalize_calls:
        violations.append(
            {
                "code": "finalize_authorization_missing",
                "message": "Finalize must be generated from FINALIZE_AUTHORIZED in the same orchestration scope.",
                "details": {"callIndexes": [call["index"] for call in unauthorized_finalize_calls]},
            }
        )
    checks.setdefault("codedPlanLifecycle", "checked")

    discover_calls = [call for call in calls if is_editor_script_call(call["arguments"], "discover.ts")]
    required_coded_operations = ["version-guard"]
    if not session_lifecycle:
        required_coded_operations.extend(["review-fingerprint", "registration-authorize", "finalize-authorize"])
    if expect_local_preview_video:
        required_coded_operations.extend(["preview-upload-body", "merge-version-metadata"])
    coded_inside_editor_script = {
        "preview-upload-body": "register.ts",
        "merge-version-metadata": "finalize.ts",
    }
    missing_coded_operations = []
    for operation in required_coded_operations:
        direct_call = any(is_publish_flow_call(call["arguments"], operation) for call in calls)
        if operation == "version-guard" and session_calls["stage-context"]:
            direct_call = True
        editor_script = coded_inside_editor_script.get(operation)
        embedded_call = editor_script is not None and any(
            is_editor_script_call(call["arguments"], editor_script) for call in calls
        )
        if operation == "preview-upload-body" and session_calls["record-registration"]:
            embedded_call = True
        if operation == "merge-version-metadata" and session_calls["record-finalize"]:
            embedded_call = True
        if not direct_call and not embedded_call:
            missing_coded_operations.append(operation)
    if missing_coded_operations and not terminal_before_package:
        violations.append(
            {
                "code": "coded_publish_operation_missing",
                "message": ("Missing deterministic publish operation(s): " + ", ".join(missing_coded_operations) + "."),
            }
        )
    checks["codedPublishOperations"] = (
        "not_applicable_after_terminal_failure" if missing_coded_operations and terminal_before_package else "checked"
    )
    legacy_availability_calls = [
        call
        for call in calls
        if is_publish_flow_call(call["arguments"], "availability-request") or "/apps/availability" in call["arguments"]
    ]
    if legacy_availability_calls:
        violations.append(
            {
                "code": "legacy_availability_path_forbidden",
                "message": "Use discover.ts publish-context; availability-request and /apps/availability are obsolete.",
            }
        )
    version_guard_calls = [
        call
        for call in calls
        if is_publish_flow_call(call["arguments"], "version-guard")
        or is_publish_session_call(call["arguments"], "stage-context")
    ]
    successful_version_guard_calls = [
        call
        for call in version_guard_calls
        if contains_status(call["output"], "VERSION_POLICY_OK")
        or contains_status(call["output"], "PUBLISH_CONTEXT_STAGED")
    ]
    checks["availabilityGuardScope"] = "checked"
    if version_guard_calls and not successful_version_guard_calls and not terminal_before_package:
        violations.append(
            {
                "code": "package_version_guard_not_successful",
                "message": "version-guard did not return VERSION_POLICY_OK before confirmation and Package.",
            }
        )
    if successful_version_guard_calls:
        first_version_guard = successful_version_guard_calls[0]
        confirm_calls = session_calls["confirm"] if session_lifecycle else flow_calls["confirm-plan"]
        if (confirm_calls and first_version_guard["index"] > confirm_calls[0]["index"]) or (
            package_calls and first_version_guard["index"] > package_calls[0]["index"]
        ):
            violations.append(
                {
                    "code": "package_version_check_too_late",
                    "message": (
                        "The publish-context package build-version check must pass before confirmation and Package."
                    ),
                }
            )
    checks["packageVersionCheckOrder"] = "checked"

    action_required_observed = any(contains_status(item["text"], "ACTION_REQUIRED") for item in record_texts)
    project_setter_observed = any(
        is_editor_script_call(call["arguments"], script_name)
        for call in calls
        for script_name in ("set-lens-name.ts", "set-signing-key.ts", "set-lens-icon.ts")
    )
    repeated_healthy_steps: dict[str, list[dict[str, Any]]] = {
        "preflight.ts": [
            call
            for call in calls
            if is_editor_script_call(call["arguments"], "preflight.ts")
            and "script error" not in compact(call.get("output")).casefold()
        ],
        "discover.ts": [
            call for call in discover_calls if "script error" not in compact(call.get("output")).casefold()
        ],
        "collect-review-input.py": [
            call
            for call in calls
            if is_editor_script_call(call["arguments"], "collect-review-input.py")
            and "script error" not in compact(call.get("output")).casefold()
        ],
    }
    duplicate_steps: dict[str, list[int]] = {}
    for script_name, script_calls in repeated_healthy_steps.items():
        allowed = 1
        if script_name in {"preflight.ts", "collect-review-input.py"} and project_setter_observed:
            allowed = 2
        if script_name == "discover.ts" and action_required_observed:
            allowed = 2
        if len(script_calls) > allowed:
            duplicate_steps[script_name] = [call["index"] for call in script_calls]
    if duplicate_steps:
        violations.append(
            {
                "code": "healthy_publish_step_repeated",
                "message": (
                    "Healthy publish preparation must reuse carried state instead of rerunning "
                    "preflight, discovery, or review collection."
                ),
                "details": duplicate_steps,
            }
        )
    checks["healthyStepReuse"] = "checked"

    forbidden_plan_files = [
        call
        for call in calls
        if re.search(
            r"(?:confirmed|frozen)[-_]?(?:publish[-_]?)?plan[^\s\"']*\.json",
            normalized_script_arguments(call["arguments"]),
            flags=re.IGNORECASE,
        )
    ]
    if forbidden_plan_files:
        violations.append(
            {
                "code": "publish_plan_file_forbidden",
                "message": (
                    "Frozen and confirmed plan results must cross turns only through "
                    "specsPublishPlan durable state, never temporary JSON files."
                ),
                "details": {"callIndexes": [call["index"] for call in forbidden_plan_files]},
            }
        )
    checks["publishPlanFiles"] = "prohibited"
    # One session operation derives all promotional inputs and invokes the component scripts after
    # submission. This removes a model-authored reconstruction turn while retaining strict ordering.
    promotional_builds = [call for call in calls if is_promotional_build_call(call["name"], call["arguments"])]
    raw_promotional_calls = [
        call
        for call in calls
        if is_raw_promotional_component_call(call["name"], call["arguments"])
        and not is_promotional_build_call(call["name"], call["arguments"])
    ]
    submit_calls = [call for call in calls if is_submit_call(call["name"], call["arguments"])]
    promotional_violations: list[dict[str, Any]] = []
    if raw_promotional_calls:
        promotional_violations.append(
            {
                "code": "promotional_session_bypassed",
                "message": (
                    "Promotional-video preparation must use publish-session.py complete; "
                    "do not invoke its music finder, driver, or renderer directly."
                ),
                "details": {"callIndexes": [call["index"] for call in raw_promotional_calls]},
            }
        )
    if expect_local_preview_video and terminal_before_package:
        checks["promotionalVideo"] = "not_applicable_after_terminal_failure"
    elif expect_local_preview_video:
        if not promotional_builds:
            promotional_violations.append(
                {
                    "code": "promotional_video_missing",
                    "message": "A local preview video was expected, but the promotional video was never built.",
                }
            )
        elif session_calls["record-finalize"] and (
            promotional_builds[0]["index"] < session_calls["record-finalize"][-1]["index"]
        ):
            promotional_violations.append(
                {
                    "code": "promotional_build_before_submit",
                    "message": "The promotional video must be built only after Submit returns submitted.",
                }
            )
        elif submit_calls and promotional_builds[0]["index"] < submit_calls[-1]["index"]:
            promotional_violations.append(
                {
                    "code": "promotional_build_before_submit",
                    "message": "The promotional video must be built only after Submit returns submitted.",
                }
            )
        violations.extend(promotional_violations)
        checks["promotionalVideo"] = "pass" if not promotional_violations else "checked"
    else:
        checks["promotionalVideo"] = "not_applicable"
        violations.extend(promotional_violations)

    register_calls = [call for call in calls if is_register_call(call["arguments"])]
    session_registration_lifecycle = bool(
        session_calls["authorize-registration"]
        and session_calls["record-registration"]
        and session_calls["authorize-registration"][0]["index"] == session_calls["record-registration"][0]["index"]
    )
    register_results = [
        item
        for item in record_texts
        if "/lenses/publish" in item["text"]
        and "requestPath" in item["text"]
        and "httpStatus" in item["text"]
        and "needs_uploads" in item["text"]
    ]
    if session_registration_lifecycle:
        checks["registrationState"] = "session_owned"
        for call in register_calls:
            if contains_status(call["output"], "AUTHORIZED_POST_OK") and not contains_status(
                call["output"], "REGISTRATION_SUCCEEDED"
            ):
                violations.append(
                    {
                        "code": "registration_result_not_committed",
                        "message": (
                            "The registration API succeeded, but the same scope did not finish "
                            "the REGISTRATION_SUCCEEDED transition and persist its complete state."
                        ),
                    }
                )
            if not semantic_version_supplied and has_semantic_version_value(call["arguments"]):
                violations.append(
                    {
                        "code": "semantic_version_invented",
                        "message": (
                            "The registration body contains semanticVersion although the "
                            "forward-test request did not supply one."
                        ),
                    }
                )
    elif not register_calls and not register_results and terminal_before_package:
        checks["registrationState"] = "not_applicable_after_terminal_failure"
    elif not register_calls and not register_results:
        violations.append(
            {
                "code": "registration_call_missing",
                "message": "No /lenses/publish registration call was found.",
            }
        )
    elif register_calls:
        for call in register_calls:
            if not has_registration_state(call["arguments"]):
                violations.append(
                    {
                        "code": "registration_state_missing",
                        "message": (
                            "The registration scope must persist both started and succeeded "
                            "specsPublishRegistration states."
                        ),
                    }
                )
            if contains_status(call["output"], "AUTHORIZED_POST_OK") and not contains_status(
                call["output"], "REGISTRATION_SUCCEEDED"
            ):
                violations.append(
                    {
                        "code": "registration_result_not_committed",
                        "message": (
                            "The registration API succeeded, but the same scope did not finish "
                            "the REGISTRATION_SUCCEEDED transition and persist its complete state."
                        ),
                    }
                )
            if not semantic_version_supplied and has_semantic_version_value(call["arguments"]):
                violations.append(
                    {
                        "code": "semantic_version_invented",
                        "message": (
                            "The registration body contains semanticVersion although the "
                            "forward-test request did not supply one."
                        ),
                    }
                )
    else:
        for result in register_results:
            enclosing_calls = [
                call
                for call in calls
                if call["index"] < result["index"] and result["timestampMs"] - call["timestampMs"] <= 120_000
            ]
            if not any(has_registration_state(call["arguments"]) for call in enclosing_calls):
                violations.append(
                    {
                        "code": "registration_state_missing",
                        "message": (
                            "The observed /lenses/publish result has no enclosing scope that "
                            "persists both started and succeeded specsPublishRegistration states."
                        ),
                    }
                )
                break
        if not semantic_version_supplied and any(
            has_semantic_version_value(call["arguments"])
            for call in calls
            if register_results[0]["timestampMs"] - call["timestampMs"] <= 120_000
            and call["timestampMs"] <= register_results[-1]["timestampMs"]
        ):
            violations.append(
                {
                    "code": "semantic_version_invented",
                    "message": (
                        "The registration scope contains semanticVersion although the "
                        "forward-test request did not supply one."
                    ),
                }
            )
    checks.setdefault("registrationState", "checked")
    checks["semanticVersion"] = "checked"

    parent_decision_calls = [
        call
        for call in calls
        if re.search(
            r"preview-media-flow\.py(?:[\"']|\s)+decide\b",
            normalized_script_arguments(call["arguments"]),
        )
    ]
    parent_image_calls = [
        call
        for call in calls
        if call["name"].casefold().endswith("view_image") or re.search(r"tools\.view_image\s*\(", call["arguments"])
    ]
    decision_frame_reads = {
        frame: sum(call["arguments"].count(frame) for call in parent_image_calls)
        for frame in ("preview-midpoint.png", "preview-near-end.png")
    }
    if parent_decision_calls:
        if len(parent_decision_calls) != 1:
            violations.append(
                {
                    "code": "capture_decision_count_invalid",
                    "message": "The parent must call preview-media-flow.py decide exactly once.",
                }
            )
        if any(count != 1 for count in decision_frame_reads.values()):
            violations.append(
                {
                    "code": "capture_decision_frames_incomplete",
                    "message": "The parent must inspect each generated preview decision frame exactly once.",
                    "details": decision_frame_reads,
                }
            )
        checks["capturePreviewDriver"] = "parent_decision_checked"

    capture_spawns = [call for call in calls if is_spawn(call["name"], call["arguments"], "capture")]
    if capture_spawns:
        spawn = capture_spawns[0]
        spawn_arguments = argument_object(spawn["arguments"])
        spawn_is_decision = any(
            marker in spawn["arguments"] for marker in ("preview_video_decision", "Decide one preview-media outcome")
        )
        if spawn_is_decision:
            violations.append(
                {
                    "code": "capture_decision_worker_forbidden",
                    "message": "Inspect the two decision frames in the parent; do not spawn a decision worker.",
                }
            )
        if "fork_turns" in spawn_arguments and str(spawn_arguments.get("fork_turns")) != "1":
            violations.append(
                {
                    "code": "capture_trusted_context_missing",
                    "message": (
                        "The capture worker must preserve the immediately preceding trusted "
                        "user turn authorizing preview-video recording."
                    ),
                }
            )
        if not successful_version_guard_calls or successful_version_guard_calls[0]["index"] > spawn["index"]:
            violations.append(
                {
                    "code": "capture_started_before_version_guard",
                    "message": "Auto-video capture must start only after the package-version guard passes.",
                }
            )
        else:
            successful_guard = successful_version_guard_calls[0]
            dispatch_delay_ms = max(0, spawn["timestampMs"] - successful_guard["outputTimestampMs"])
            if not spawn_is_decision and dispatch_delay_ms > CAPTURE_DISPATCH_LIMIT_MS + timing_tolerance_ms:
                violations.append(
                    {
                        "code": "capture_dispatch_delayed",
                        "message": (
                            f"The capture worker was dispatched {dispatch_delay_ms:.0f} ms after the version guard; "
                            f"the limit is {CAPTURE_DISPATCH_LIMIT_MS} ms."
                        ),
                    }
                )
        spawn_message = argument_object(spawn["arguments"]).get("message")
        prompt_is_opaque = isinstance(spawn_message, str) and spawn_message.startswith("gAAAA")
        generated_capture_prompt = any(
            marker in spawn["arguments"]
            for marker in ("Execute passive preview-media protocol v4", "Decide one preview-media outcome")
        )
        if not prompt_is_opaque and not generated_capture_prompt:
            violations.append(
                {
                    "code": "capture_generated_task_missing",
                    "message": (
                        "The capture worker must receive the verbatim task generated by "
                        "preview-media-flow.py worker-task."
                    ),
                }
            )
        first_wait = next(
            (call for call in calls if call["index"] > spawn["index"] and is_worker_wait_call(call["name"])),
            None,
        )
        editor_overlap_limit = first_wait["index"] if first_wait is not None else sys.maxsize
        overlapping_editor_calls = [
            call
            for call in calls
            if spawn["index"] < call["index"] < editor_overlap_limit
            and ("ExecuteEditorCode" in call["arguments"] or "executeeditorcode" in call["name"].casefold())
        ]
        if overlapping_editor_calls:
            violations.append(
                {
                    "code": "capture_editor_lane_overlap",
                    "message": (
                        "The parent used ExecuteEditorCode while the capture worker owned "
                        "Lens Studio Preview; only local preparation may overlap capture."
                    ),
                }
            )
        if first_wait is None:
            violations.append(
                {
                    "code": "capture_wait_missing",
                    "message": "A capture worker was spawned, but no bounded worker wait was found.",
                }
            )
        else:
            wait_arguments = argument_object(first_wait["arguments"])
            timeout_ms = wait_arguments.get("timeout_ms", wait_arguments.get("timeoutMs"))
            elapsed_ms = max(0, first_wait["timestampMs"] - spawn["timestampMs"])
            remaining_ms = max(0, capture_budget_ms - elapsed_ms)
            if not isinstance(timeout_ms, (int, float)):
                violations.append(
                    {
                        "code": "capture_wait_timeout_missing",
                        "message": "The capture-worker wait does not expose timeout_ms.",
                    }
                )
            elif timeout_ms > remaining_ms + timing_tolerance_ms:
                violations.append(
                    {
                        "code": "capture_wait_exceeds_remaining_deadline",
                        "message": (
                            f"wait_agent requested {timeout_ms:.0f} ms with only {remaining_ms:.0f} ms remaining."
                        ),
                    }
                )

        # A wait that times out with budget left is not a capture timeout. Killing
        # the worker early discards an in-progress native recording and makes the
        # recovery check structurally unable to find anything.
        interrupt = next(
            (call for call in calls if call["index"] > spawn["index"] and call["name"].endswith("interrupt_agent")),
            None,
        )
        if interrupt is not None:
            interrupt_elapsed_ms = max(0, interrupt["timestampMs"] - spawn["timestampMs"])
            if interrupt_elapsed_ms + timing_tolerance_ms < capture_budget_ms:
                violations.append(
                    {
                        "code": "capture_interrupted_before_deadline",
                        "message": (
                            f"The capture worker was interrupted after {interrupt_elapsed_ms:.0f} ms, "
                            f"inside its {capture_budget_ms} ms budget. Issue consecutive bounded waits "
                            "until the deadline actually passes."
                        ),
                    }
                )
        checks["captureDeadlineWait"] = "checked"
    else:
        checks["captureDeadlineWait"] = "not_applicable"

    manual_video_fallback = any(
        "record video" in item["text"].casefold()
        and "cancel" in item["text"].casefold()
        and (
            "saved file" in item["text"].casefold()
            or "saved path" in item["text"].casefold()
            or "save the file" in item["text"].casefold()
        )
        for item in record_texts
    )
    if manual_video_fallback:
        violations.append(
            {
                "code": "manual_preview_video_forbidden",
                "message": (
                    "Automatic preview-video failure must fall back to a fresh Preview screenshot, "
                    "not a manual video-recording prompt."
                ),
            }
        )
    checks["manualPreviewVideo"] = "prohibited"

    worker_calls: list[dict[str, Any]] = []
    if capture_worker_records is not None:
        worker_outputs_by_call_id: dict[str, Any] = {}
        worker_output_timestamps_by_call_id: dict[str, float] = {}
        worker_timeline_ms = record_timeline_ms(capture_worker_records)
        for index, record in enumerate(capture_worker_records):
            parsed_output = tool_output(record)
            if parsed_output is None:
                continue
            call_id, output = parsed_output
            worker_outputs_by_call_id[call_id] = output
            worker_output_timestamps_by_call_id[call_id] = worker_timeline_ms[index]
        worker_start_ms = min(worker_timeline_ms, default=0)
        for index, record in enumerate(capture_worker_records):
            parsed = tool_call(record)
            if parsed is None:
                continue
            name, arguments = parsed
            call_id = tool_call_id(record)
            call_timestamp_ms = worker_timeline_ms[index]
            worker_calls.append(
                {
                    "index": index,
                    "timestampMs": call_timestamp_ms,
                    "name": name,
                    "arguments": arguments,
                    "output": worker_outputs_by_call_id.get(call_id),
                    "outputTimestampMs": worker_output_timestamps_by_call_id.get(call_id, call_timestamp_ms),
                }
            )
        append_yield_join_violations(
            violations,
            worker_calls,
            source="capture-worker",
            timing_tolerance_ms=timing_tolerance_ms,
        )
        worker_text = compact(capture_worker_records).casefold()
        if "no trusted user request" in worker_text or "untrusted agent history" in worker_text:
            violations.append(
                {
                    "code": "capture_worker_authorization_rejected",
                    "message": (
                        "Preview recording was rejected because the capture worker did not "
                        "inherit the trusted user request."
                    ),
                }
            )

        worker_end_ms = max(worker_timeline_ms, default=worker_start_ms)
        worker_elapsed_ms = max(0, worker_end_ms - worker_start_ms)
        if worker_elapsed_ms > capture_budget_ms + timing_tolerance_ms:
            violations.append(
                {
                    "code": "capture_worker_exceeded_budget",
                    "message": (
                        f"The capture worker ran for {worker_elapsed_ms:.0f} ms; the budget is {capture_budget_ms} ms."
                    ),
                }
            )

        forbidden_camera_calls.extend(
            {"source": "capture_worker", **call}
            for call in worker_calls
            if "MovePreviewCamera" in call["name"]
            or re.search(r"(?:tools\.)?[A-Za-z0-9_]*MovePreviewCamera\s*\(", call["arguments"])
        )
        forbidden_interactive_calls.extend(
            {"source": "capture_worker", **call}
            for call in worker_calls
            if any(
                tool_name in call["name"] or tool_name in call["arguments"]
                for tool_name in (
                    "QueryRuntimeSceneTool",
                    "PreviewInteractTool",
                    "CaptureRuntimeViewTool",
                )
            )
        )

        recorder_calls = [call for call in worker_calls if "record-preview-video.sh" in call["arguments"]]
        if not recorder_calls:
            violations.append(
                {
                    "code": "capture_recorder_missing",
                    "message": "The capture worker never launched record-preview-video.sh.",
                }
            )
        elif recorder_calls:
            recorder_call = recorder_calls[0]
            if not is_direct_shell_call(recorder_call["name"]):
                violations.append(
                    {
                        "code": "capture_recorder_not_direct",
                        "message": (
                            "The capture worker must use the runtime's direct foreground shell "
                            "primitive, not a nested orchestration/evaluation call."
                        ),
                    }
                )
            recorder_session_id = returned_session_id(recorder_call.get("output"))
            if recorder_session_id is not None:
                recorder_position = worker_calls.index(recorder_call)
                next_worker_call = (
                    worker_calls[recorder_position + 1] if recorder_position + 1 < len(worker_calls) else None
                )
                if (
                    next_worker_call is None
                    or not is_session_join_call(next_worker_call["name"])
                    or written_session_id(next_worker_call["arguments"]) != recorder_session_id
                ):
                    violations.append(
                        {
                            "code": "capture_recorder_session_not_joined",
                            "message": (
                                "A retained recorder session must be joined by the immediately "
                                "following runtime session-join call with the same session handle."
                            ),
                        }
                    )
            launch_delay_ms = recorder_call["timestampMs"] - worker_start_ms
            if launch_delay_ms > RECORDER_LAUNCH_LIMIT_MS + timing_tolerance_ms:
                violations.append(
                    {
                        "code": "capture_recorder_started_late",
                        "message": (
                            f"The recorder started after {launch_delay_ms:.0f} ms; "
                            f"the limit is {RECORDER_LAUNCH_LIMIT_MS} ms."
                        ),
                    }
                )

        driver_calls = [call for call in worker_calls if "preview-media-flow.py" in call["arguments"]]
        if not any(
            re.search(r"preview-media-flow\.py(?:[\"']|\s)+inspect\b", call["arguments"]) for call in driver_calls
        ):
            violations.append(
                {
                    "code": "capture_preview_driver_missing",
                    "message": (
                        "The capture worker must hand recorder parsing and inspection to preview-media-flow.py inspect."
                    ),
                }
            )
        if any(
            any(
                legacy_script in call["arguments"]
                for legacy_script in (
                    "prepare-preview-video-inspection.py",
                    "stage-preview-screenshot.py",
                    "recover-preview-video.py",
                )
            )
            for call in worker_calls
        ):
            violations.append(
                {
                    "code": "capture_preview_driver_bypassed",
                    "message": (
                        "The capture worker must not orchestrate preview helper scripts outside preview-media-flow.py."
                    ),
                }
            )
        checks["capturePreviewDriver"] = "checked"

        forbidden_discovery_tokens = (
            "ALL_TOOLS",
            "__type",
            "capabilities",
            "sceneRoots",
            "tool_search",
            "list_tools",
        )
        if any(
            any(token.casefold() in call["arguments"].casefold() for token in forbidden_discovery_tokens)
            for call in worker_calls
        ):
            violations.append(
                {
                    "code": "capture_worker_schema_discovery",
                    "message": (
                        "The generated capture task forbids tool/GraphQL schema discovery and broad scene walks."
                    ),
                }
            )
        startup_claim = any(
            re.search(r"(?:startup|replay)(?:[- ]screen|[- ]only)", item["text"], flags=re.IGNORECASE)
            for item in record_texts
        )
        if startup_claim and not recorder_calls:
            violations.append(
                {
                    "code": "capture_footage_claim_without_recording",
                    "message": (
                        "The transcript classified footage although the capture worker never launched the recorder."
                    ),
                }
            )
        checks["captureWorker"] = "checked"

        worker_screenshot_calls = [
            call for call in worker_calls if is_preview_screenshot_call(call["name"], call["arguments"])
        ]
        worker_screenshot_call_count = sum(
            preview_screenshot_call_count(call["name"], call["arguments"]) for call in worker_screenshot_calls
        )
        if worker_screenshot_call_count > 1:
            violations.append(
                {
                    "code": "preview_screenshot_recaptured",
                    "message": (
                        f"The capture worker called the Preview screenshot tool "
                        f"{worker_screenshot_call_count} times; the fallback is exactly once."
                    ),
                }
            )
        if any(contains_status(record, "AUTO_IMAGE_FALLBACK_REQUIRED") for record in capture_worker_records):
            violations.append(
                {
                    "code": "capture_fallback_not_completed_by_worker",
                    "message": (
                        "A protocol-v4 worker must stage its one screenshot fallback and return "
                        "AUTO_IMAGE_READY instead of handing fallback work to the parent."
                    ),
                }
            )
        checks["workerScreenshotFallback"] = "checked"
    else:
        checks["captureWorker"] = "not_used"
        checks["workerScreenshotFallback"] = "not_applicable"

    parent_deadline_recovery = False
    if capture_spawns:
        spawn = capture_spawns[0]
        deadline_interrupts = [
            call
            for call in calls
            if call["index"] > spawn["index"]
            and call["name"].endswith("interrupt_agent")
            and call["timestampMs"] - spawn["timestampMs"] + timing_tolerance_ms >= capture_budget_ms
        ]
        recovery_calls = [
            call
            for call in calls
            if call["index"] > spawn["index"]
            and "preview-media-flow.py" in call["arguments"]
            and "inspect" in call["arguments"]
            and "--recovery" in call["arguments"]
        ]
        parent_deadline_recovery = bool(
            deadline_interrupts and recovery_calls and recovery_calls[0]["index"] > deadline_interrupts[0]["index"]
        )

    if capture_spawns and screenshot_calls and not parent_deadline_recovery:
        violations.append(
            {
                "code": "capture_fallback_escaped_worker",
                "message": (
                    "When the auto-video worker is available, it owns the screenshot fallback; "
                    "the parent must not call the Preview screenshot tool."
                ),
            }
        )

    fallback_records = [
        item for item, record in zip(record_texts, records) if contains_status(record, "AUTO_IMAGE_FALLBACK_REQUIRED")
    ]
    if fallback_records:
        first_fallback_index = fallback_records[0]["index"]
        activation_prompts = [
            item
            for item in record_texts
            if item["index"] > first_fallback_index
            and re.search(
                r"(?:start|activate).{0,120}Lens Studio Preview.{0,120}(?:reply|done|cancel)",
                item["text"],
                flags=re.IGNORECASE | re.DOTALL,
            )
        ]
        if activation_prompts:
            violations.append(
                {
                    "code": "preview_activation_prompt_after_fallback",
                    "message": (
                        "A static/start-state fallback screenshot must continue to confirmation "
                        "without asking the user to activate the Lens."
                    ),
                }
            )
    checks["fallbackActivationPrompt"] = "prohibited"

    if forbidden_camera_calls:
        violations.append(
            {
                "code": "capture_camera_orbit_forbidden",
                "message": "MovePreviewCamera is prohibited during publish capture.",
                "details": {
                    "calls": [
                        {
                            "source": call["source"],
                            "callIndex": call["index"],
                        }
                        for call in forbidden_camera_calls
                    ]
                },
            }
        )
    checks["captureCameraOrbit"] = "prohibited"

    if forbidden_interactive_calls:
        violations.append(
            {
                "code": "capture_interactive_preview_forbidden",
                "message": (
                    "Interactive Preview MCP calls are prohibited; publish capture is passive native recording."
                ),
                "details": {
                    "calls": [
                        {
                            "source": call["source"],
                            "callIndex": call["index"],
                        }
                        for call in forbidden_interactive_calls
                    ]
                },
            }
        )
    checks["captureInteractivePreview"] = "prohibited"

    return {
        "status": "PASS" if not violations else "FAILED",
        "checks": checks,
        "violations": violations,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit a controlled Specs publish JSONL transcript.")
    parser.add_argument("transcript", type=Path)
    parser.add_argument(
        "--expect-local-preview-video",
        action="store_true",
        help="Require a promotional video, built after Submit.",
    )
    parser.add_argument(
        "--semantic-version-supplied",
        action="store_true",
        help="Allow semanticVersion in the registration body.",
    )
    parser.add_argument("--capture-budget-ms", type=int, default=CAPTURE_BUDGET_MS)
    parser.add_argument("--timing-tolerance-ms", type=int, default=1_000)
    parser.add_argument(
        "--capture-worker-transcript",
        type=Path,
        help="Optionally audit the delegated capture worker JSONL transcript.",
    )
    args = parser.parse_args()

    records: list[dict[str, Any]] = []
    try:
        with args.transcript.open(encoding="utf-8") as transcript:
            for line_number, line in enumerate(transcript, start=1):
                if not line.strip():
                    continue
                value = json.loads(line)
                if not isinstance(value, dict):
                    raise ValueError(f"line {line_number} is not a JSON object")
                records.append(value)
        records = normalize_live_records(records)
    except (OSError, json.JSONDecodeError, ValueError) as error:
        print(
            json.dumps(
                {
                    "status": "FAILED",
                    "checks": {},
                    "violations": [{"code": "transcript_unreadable", "message": str(error)}],
                },
                separators=(",", ":"),
            )
        )
        return 2

    capture_worker_records: list[dict[str, Any]] | None = None
    if args.capture_worker_transcript is not None:
        capture_worker_records = []
        try:
            with args.capture_worker_transcript.open(encoding="utf-8") as transcript:
                for line_number, line in enumerate(transcript, start=1):
                    if not line.strip():
                        continue
                    value = json.loads(line)
                    if not isinstance(value, dict):
                        raise ValueError(f"line {line_number} is not a JSON object")
                    capture_worker_records.append(value)
            capture_worker_records = normalize_live_records(capture_worker_records)
        except (OSError, json.JSONDecodeError, ValueError) as error:
            print(
                json.dumps(
                    {
                        "status": "FAILED",
                        "checks": {},
                        "violations": [{"code": "capture_transcript_unreadable", "message": str(error)}],
                    },
                    separators=(",", ":"),
                )
            )
            return 2

    result = audit(
        records,
        expect_local_preview_video=args.expect_local_preview_video,
        semantic_version_supplied=args.semantic_version_supplied,
        capture_budget_ms=args.capture_budget_ms,
        timing_tolerance_ms=args.timing_tolerance_ms,
        capture_worker_records=capture_worker_records,
    )
    print(json.dumps(result, separators=(",", ":")))
    return 0 if result["status"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
