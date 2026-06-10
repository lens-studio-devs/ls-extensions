# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Optional

from .cdp_client import CdpClient
from .event_compaction import compact_remote_object as _compact_remote_object
from .json_io import Envelope

# ---------- response transformers ----------


def _is_tdz_property(prop: dict[str, Any]) -> bool:
    if "value" not in prop and "get" not in prop and "set" not in prop:
        return True
    value = prop.get("value")
    if (
        isinstance(value, dict)
        and value.get("type") == "undefined"
        and "subtype" not in value
        and prop.get("writable") is False
        and prop.get("configurable") is False
    ):
        return True
    return False


def _transform_eval(result: dict[str, Any]) -> Any:
    return _compact_remote_object(result.get("result", {}))


# Verbatim from CommandDispatch.cpp — agents key off this exact wording.
_EVAL_UNDEFINED_HINT = (
    "Result is undefined. Note: eval runs in global scope — "
    "script-local variables are not accessible. "
    "Use breakpoint + locals or eval-on-frame instead."
)


def _transform_eval_with_hint(result: dict[str, Any]) -> Any:
    compact = _transform_eval(result)
    if isinstance(compact, dict) and compact.get("type") == "undefined":
        compact["hint"] = _EVAL_UNDEFINED_HINT
    return compact


def _transform_breakpoint(result: dict[str, Any]) -> dict[str, Any]:
    # Hermes doesn't emit Debugger.breakpointResolved — `locations` is the
    # only sync signal that the bp matched a real script line. Empty =
    # accepted but unmatched.
    raw_locations = result.get("locations") or []
    # `generatedLine` is the 1-based compiled (.js) line straight from CDP.
    # `editorLine` starts equal to it (correct for .js-authored lenses) and is
    # overwritten with the source line by the set-breakpoint annotate step when
    # a source map resolves — so `editorLine` always matches the file on disk.
    locations = [
        {
            "scriptId": loc.get("scriptId", ""),
            "editorLine": loc.get("lineNumber", 0) + 1,
            "generatedLine": loc.get("lineNumber", 0) + 1,
            "columnNumber": loc.get("columnNumber", 0),
        }
        for loc in raw_locations
        if isinstance(loc, dict)
    ]
    return {
        "breakpointId": result.get("breakpointId", ""),
        "resolved": bool(locations),
        "locations": locations,
    }


def _transform_get_properties(result: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for prop in result.get("result", []) or []:
        entry: dict[str, Any] = {"name": prop.get("name", "")}
        if _is_tdz_property(prop):
            entry["state"] = "uninitialized"
        elif "value" in prop:
            entry.update(_compact_remote_object(prop["value"]))
        out.append(entry)
    return out


# ---------- command table ----------


@dataclass
class CdpMapping:
    method: str
    params: dict[str, Any]
    transform_response: Optional[Callable[[dict[str, Any]], Any]]


ParamBuilder = Callable[[str, dict[str, Any]], dict[str, Any]]


class BuildError(Exception):
    pass


def _build_eval(command: str, input: dict[str, Any]) -> dict[str, Any]:
    expr = input.get("expression")
    if not isinstance(expr, str):
        raise BuildError(f'{command}: missing required field "expression"')
    return {"expression": expr, "returnByValue": True}


def _build_set_breakpoint(command: str, input: dict[str, Any]) -> dict[str, Any]:
    url = input.get("url")
    if not isinstance(url, str):
        raise BuildError(f'{command}: missing required field "url"')
    line = input.get("line")
    if not isinstance(line, int) or isinstance(line, bool):
        raise BuildError(f'{command}: missing required field "line"')
    params: dict[str, Any] = {
        "url": url,
        "lineNumber": line,
        "columnNumber": input.get("column", 0) if isinstance(input.get("column", 0), int) else 0,
    }
    cond = input.get("condition")
    if isinstance(cond, str):
        params["condition"] = cond
    return params


def _build_remove_breakpoint(command: str, input: dict[str, Any]) -> dict[str, Any]:
    bp = input.get("breakpointId")
    if not isinstance(bp, str):
        raise BuildError(f'{command}: missing required field "breakpointId"')
    return {"breakpointId": bp}


def _build_pause_on_exceptions(command: str, input: dict[str, Any]) -> dict[str, Any]:
    state = input.get("state")
    if not isinstance(state, str):
        raise BuildError(f'{command}: missing required field "state" ("none"|"uncaught"|"all")')
    if state not in {"none", "uncaught", "all"}:
        raise BuildError(f'{command}: "state" must be "none", "uncaught", or "all"')
    return {"state": state}


def _build_eval_on_frame(command: str, input: dict[str, Any]) -> dict[str, Any]:
    cf = input.get("callFrameId")
    if not isinstance(cf, str):
        raise BuildError(f'{command}: missing required field "callFrameId"')
    expr = input.get("expression")
    if not isinstance(expr, str):
        raise BuildError(f'{command}: missing required field "expression"')
    return_by_value = input.get("returnByValue", True)
    if not isinstance(return_by_value, bool):
        return_by_value = True
    params: dict[str, Any] = {
        "callFrameId": cf,
        "expression": expr,
        "returnByValue": return_by_value,
    }
    if isinstance(input.get("generatePreview"), bool):
        params["generatePreview"] = input["generatePreview"]
    if isinstance(input.get("objectGroup"), str):
        params["objectGroup"] = input["objectGroup"]
    return params


def _build_get_properties(command: str, input: dict[str, Any]) -> dict[str, Any]:
    obj_id = input.get("objectId")
    if not isinstance(obj_id, str):
        raise BuildError(f'{command}: missing required field "objectId"')
    own = input.get("ownProperties", True)
    if not isinstance(own, bool):
        own = True
    params: dict[str, Any] = {"objectId": obj_id, "ownProperties": own}
    if isinstance(input.get("generatePreview"), bool):
        params["generatePreview"] = input["generatePreview"]
    return params


@dataclass
class CommandDef:
    cdp_method: str
    build_params: Optional[ParamBuilder] = None
    transform_response: Optional[Callable[[dict[str, Any]], Any]] = None


# Per-verb build/transform hooks. CDP method comes from `VERB_CATALOG`;
# this dict only carries the Python-side hooks. No-param verbs (pause,
# step-*, reload) have no entry.
_TRANSFORMERS: dict[str, tuple[Optional[Callable[..., Any]], Optional[Callable[..., Any]]]] = {
    "eval": (_build_eval, _transform_eval_with_hint),
    "set-breakpoint": (_build_set_breakpoint, _transform_breakpoint),
    "remove-breakpoint": (_build_remove_breakpoint, None),
    "pause-on-exceptions": (_build_pause_on_exceptions, None),
    "eval-on-frame": (_build_eval_on_frame, _transform_eval),
    "get-properties": (_build_get_properties, _transform_get_properties),
}


def _build_command_table() -> dict[str, CommandDef]:
    from .verbs import VERB_CATALOG

    table: dict[str, CommandDef] = {}
    for v in VERB_CATALOG:
        if v.category != "cdp" or v.cdp_method is None:
            continue
        build_fn, transform_fn = _TRANSFORMERS.get(v.name, (None, None))
        table[v.name] = CommandDef(v.cdp_method, build_fn, transform_fn)
    return table


COMMAND_TABLE: dict[str, CommandDef] = _build_command_table()


def build_cdp_mapping(command: str, input: dict[str, Any]) -> CdpMapping:
    cmd_def = COMMAND_TABLE.get(command)
    if cmd_def is None:
        available = ", ".join(sorted(COMMAND_TABLE.keys()))
        raise BuildError(f"unknown command: {command}. Available: {available}")

    if cmd_def.build_params is None:
        return CdpMapping(method=cmd_def.cdp_method, params={}, transform_response=cmd_def.transform_response)

    params = cmd_def.build_params(command, input)
    return CdpMapping(method=cmd_def.cdp_method, params=params, transform_response=cmd_def.transform_response)


def get_command_list() -> list[dict[str, Any]]:
    from .verbs import get_verb_catalog  # lazy: avoid circular import

    return get_verb_catalog()


# ---------- single-shot dispatch ----------


async def dispatch_message(
    client: CdpClient,
    page_session_id: str,
    parsed: dict[str, Any] | None,
    raw_line: str,
) -> dict[str, Any]:
    if parsed is None:
        return Envelope.error("invalid JSON", -1, caller_id=None)

    caller_id = parsed.get("id")
    warning = "" if "id" in parsed else "no 'id' field — responses cannot be correlated"

    command = parsed.get("command")
    if isinstance(command, str):
        try:
            mapping = build_cdp_mapping(command, parsed)
        except BuildError as e:
            return Envelope.error(str(e), -1, caller_id, warning)

        resp = await client.send_command(mapping.method, mapping.params, page_session_id)
        if "error" in resp:
            err = resp["error"] or {}
            # Propagate Connection-lost diagnostics (hostPid / hostAlive /
            # lastEventSeq / lsLogPath) the daemon attached.
            extra = {k: v for k, v in err.items() if k not in ("message", "code")} if isinstance(err, dict) else {}
            return Envelope.error(
                err.get("message", "CDP error") if isinstance(err, dict) else str(err),
                err.get("code", -32000) if isinstance(err, dict) else -32000,
                caller_id,
                warning,
                extra=extra or None,
            )
        result = resp.get("result", {}) or {}
        if mapping.transform_response is not None:
            result = mapping.transform_response(result)
        return Envelope.success(result, caller_id, warning)

    return Envelope.error('unrecognized message: expected a "command" field', -1, caller_id=None)
