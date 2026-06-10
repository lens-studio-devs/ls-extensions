# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import asyncio
import json
import re
import time
from typing import Any, Optional

from . import command_dispatch
from .commands.health import (
    HEALTH_RECENT_ACTIVITY_MS,
    HealthCommandsMixin,
    _derive_health_state,
)
from .daemon_state import (
    DEFAULT_WAIT_TIMEOUT_MS,
    EVAL_NATIVE_FRAME_BELOW_MSG,
    GLOBAL_SCOPE_THIS_WARNING,
    HINT_CODE_ASYNC_STEPPER_FRAME,
    HINT_CODE_AUTO_FRAMED,
    HINT_CODE_BP_INIT_TIME,
    HINT_CODE_BP_NOT_TRACKED,
    HINT_CODE_BP_UNRESOLVED,
    HINT_CODE_EVAL_NATIVE_FRAME_BELOW,
    HINT_CODE_EVAL_PAUSED_ON_EXCEPTION,
    HINT_CODE_LOCALS_ALL_TDZ,
    HINT_CODE_LOCALS_EMPTY,
    HINT_CODE_LOCALS_NO_OWN_SCOPE,
    HINT_CODE_WAIT_TIMEOUT_LATE_EVENT,
    REMOVE_BREAKPOINT_UNTRACKED_HINT,
    SET_BREAKPOINT_HINT,
    SET_BREAKPOINT_UNRESOLVED_HINT,
    WARNING_CODE_GLOBAL_SCOPE_THIS,
    _TaggedEvent,
    _WaitIdleState,
    _WaitState,
)
from .event_compaction import (
    compact_event,
    compact_remote_object,
    frame_has_native_frame_below,
    is_async_stepper_frame_name,
)
from .handshake import attach_target, enable_domains
from .json_io import Envelope
from .sourcemap import SourceMap, find_source_location, parse_source_map
from .target_discovery import discover_targets
from .ts_resolve import TsResolveError, default_fetch_map, resolve_ts_breakpoint
from .url_resolve import AmbiguousURL, URLNotFound, resolve_url

# Re-exports — `_derive_health_state` and `HEALTH_RECENT_ACTIVITY_MS` come
# from `commands/health.py`; everything else is defined inline below.
__all__ = [
    "CommandsMixin",
    "CLEANUP_PER_COMMAND_TIMEOUT_S",
    "HEALTH_RECENT_ACTIVITY_MS",
    "LOCALS_ALL_TDZ_HINT",
    "LOCALS_EMPTY_HINT",
    "_derive_health_state",
    "_is_command_timeout",
    "_locals_hint",
]


# ----------------------------------------------------------------------
# Family: lifecycle  (`cleanup`)
# ----------------------------------------------------------------------

# 30s default × N breakpoints blows the client-side 30s socket budget
# against a wedged VM. Tight per-command timeout keeps cleanup responsive.
CLEANUP_PER_COMMAND_TIMEOUT_S = 2.0

# Poll cadence while racing an eval dispatch against the Debugger.paused its
# own throw triggers (pause-on-exceptions armed). Small enough to feel
# instant; the eval response, when it comes, resolves the race on its own.
_EVAL_PAUSE_POLL_INTERVAL_S = 0.02


def _is_command_timeout(resp: dict[str, Any]) -> bool:
    err = resp.get("error") if isinstance(resp, dict) else None
    return isinstance(err, dict) and err.get("code") == -32001


class _LifecycleCommandsMixin:
    async def _handle_cleanup(
        self,
        writer: asyncio.StreamWriter,
        parsed: dict,
        caller_id: Any,
    ) -> None:
        # `cleanup --all` always returns the uniform `{daemon, sessions:[...]}`
        # shape (one entry per session) so agents branch on `sessions` without
        # special-casing the single-target collapse.
        if parsed.get("all") is True:  # type: ignore[attr-defined]
            await self._handle_cleanup_all(writer, caller_id)
            return

        sess = self._current_session()  # type: ignore[attr-defined]
        page_session_id = sess.page_session_id
        target_id = sess.target_id
        is_last_session = len(self.targets) <= 1  # type: ignore[attr-defined]

        if is_last_session:
            # Single-target world: shutdown unconditionally, even if CDP
            # teardown raises mid-flow. A wedged VM that fails to resume
            # mustn't leave a half-cleaned daemon running — the next verb
            # would re-attach to it.
            try:
                removed, failed, timed_out = await self._cleanup_target_cdp(
                    page_session_id, sess.tracked_breakpoints, sess.pause_on_exceptions_state
                )
                result: dict[str, Any] = {"daemon": "stopped", "breakpointsRemoved": removed}
                if failed:
                    result["failed"] = failed
                if timed_out:
                    result["timedOut"] = timed_out
                self._write_line(writer, Envelope.success(result, caller_id))  # type: ignore[attr-defined]
                await self._finish_client(writer)  # type: ignore[attr-defined]
            finally:
                self.shutdown_event.set()  # type: ignore[attr-defined]
            return

        # Multi-target: detach one session, daemon stays alive for siblings.
        # CDP errors here don't trigger shutdown — sibling sessions keep
        # serving their agents.
        from .handshake import detach_target

        removed, failed, timed_out = await self._cleanup_target_cdp(
            page_session_id, sess.tracked_breakpoints, sess.pause_on_exceptions_state
        )
        detach = await detach_target(
            self.client,  # type: ignore[attr-defined]
            self.browser_session_id,  # type: ignore[attr-defined]
            page_session_id,
        )
        # Remove from targets map even if the detach response errored —
        # the LS-side session is gone or we can't talk to it; either way,
        # we shouldn't try to route to it again.
        self.targets.pop(target_id, None)  # type: ignore[attr-defined]
        if self._active_target_id == target_id:  # type: ignore[attr-defined]
            # Reset the daemon-wide fallback to some remaining session so
            # the @property accessors don't dereference a missing key.
            self._active_target_id = next(iter(self.targets.keys()))  # type: ignore[attr-defined]

        result = {
            "daemon": "running",
            "detached": True,
            "targetId": target_id,
            "remainingTargets": [
                {"id": s.target_id, "title": s.target_title}
                for s in self.targets.values()  # type: ignore[attr-defined]
            ],
            "breakpointsRemoved": removed,
        }
        if failed:
            result["failed"] = failed
        if timed_out:
            result["timedOut"] = timed_out
        if not detach.ok:
            result["detachError"] = detach.error_message
        self._write_line(writer, Envelope.success(result, caller_id))  # type: ignore[attr-defined]
        await self._finish_client(writer)  # type: ignore[attr-defined]

    async def _handle_cleanup_all(self, writer: asyncio.StreamWriter, caller_id: Any) -> None:
        from .handshake import detach_target

        # The whole body — including the per-target CDP detach loop — runs
        # under the finally so a CDP error mid-iteration can't skip the
        # unconditional shutdown and strand the daemon in a zombie state.
        try:
            results: list[dict[str, Any]] = []
            for tid in list(self.targets.keys()):  # type: ignore[attr-defined]
                sess = self.targets[tid]  # type: ignore[attr-defined]
                removed, failed, timed_out = await self._cleanup_target_cdp(
                    sess.page_session_id, sess.tracked_breakpoints, sess.pause_on_exceptions_state
                )
                detach = await detach_target(
                    self.client,  # type: ignore[attr-defined]
                    self.browser_session_id,  # type: ignore[attr-defined]
                    sess.page_session_id,
                )
                entry: dict[str, Any] = {
                    "targetId": tid,
                    "title": sess.target_title,
                    "breakpointsRemoved": removed,
                }
                if failed:
                    entry["failed"] = failed
                if timed_out:
                    entry["timedOut"] = timed_out
                if not detach.ok:
                    entry["detachError"] = detach.error_message
                results.append(entry)

            self.targets.clear()  # type: ignore[attr-defined]
            self._write_line(  # type: ignore[attr-defined]
                writer,
                Envelope.success({"daemon": "stopped", "sessions": results}, caller_id),
            )
            await self._finish_client(writer)  # type: ignore[attr-defined]
        finally:
            # Same as the single-session path — shutdown is unconditional.
            self.shutdown_event.set()  # type: ignore[attr-defined]

    async def _cleanup_target_cdp(
        self,
        page_session_id: str,
        tracked_breakpoints: set,
        pause_on_exceptions_state: str = "none",
    ) -> tuple[int, list[str], list[str]]:
        removed = 0
        failed: list[str] = []
        timed_out: list[str] = []

        # Resume first: detaching while paused leaves Hermes holding
        # CodeBlock* pointers into modules that may be freed on the next
        # reload, crashing in getSourceLocation. Resume is a no-op when
        # not paused.
        resp = await self.client.send_command(  # type: ignore[attr-defined]
            "Debugger.resume",
            {},
            page_session_id,
            timeout_s=CLEANUP_PER_COMMAND_TIMEOUT_S,
        )
        if _is_command_timeout(resp):
            timed_out.append("Debugger.resume")

        # Only reset pause-on-exceptions if it was actually armed (auto-armed
        # to `uncaught` at attach, or raised by the agent). Issuing it on a VM
        # that's at `none` makes a wedged VM time out on a command nobody
        # needed, surfacing a spurious `timedOut` entry.
        if pause_on_exceptions_state != "none":
            resp = await self.client.send_command(  # type: ignore[attr-defined]
                "Debugger.setPauseOnExceptions",
                {"state": "none"},
                page_session_id,
                timeout_s=CLEANUP_PER_COMMAND_TIMEOUT_S,
            )
            if _is_command_timeout(resp):
                timed_out.append("Debugger.setPauseOnExceptions")

        for bp in list(tracked_breakpoints):
            resp = await self.client.send_command(  # type: ignore[attr-defined]
                "Debugger.removeBreakpoint",
                {"breakpointId": bp},
                page_session_id,
                timeout_s=CLEANUP_PER_COMMAND_TIMEOUT_S,
            )
            tracked_breakpoints.discard(bp)
            if "error" in resp:
                failed.append(bp)
            else:
                removed += 1

        return (removed, failed, timed_out)


# ----------------------------------------------------------------------
# Family: breakpoints  (`set-breakpoint` URL / source-map resolution)
# ----------------------------------------------------------------------


class _BreakpointCommandsMixin:
    async def _resolve_breakpoint_url(
        self,
        writer: asyncio.StreamWriter,
        parsed: dict[str, Any],
        caller_id: Any,
    ) -> Optional[tuple[str, Optional[dict[str, Any]]]]:
        url = parsed["url"]
        new_raw: Optional[str] = None
        source_echo: Optional[dict[str, Any]] = None

        lower = url.lower()
        if lower.endswith(".ts") or lower.endswith(".tsx"):
            line_val = parsed.get("line")
            if isinstance(line_val, int) and not isinstance(line_val, bool):
                try:
                    # resolve_ts_breakpoint fetches + parses source maps
                    # (file I/O); offload so the event loop stays responsive.
                    loc = await asyncio.to_thread(
                        resolve_ts_breakpoint,
                        url,
                        line_val,
                        self._collect_script_infos(),  # type: ignore[attr-defined]
                        default_fetch_map,
                        self.source_map_cache,  # type: ignore[attr-defined]
                    )
                    col_val = parsed.get("column")
                    source_echo = {
                        "source": url,
                        "line": line_val,
                        "column": col_val if isinstance(col_val, int) and not isinstance(col_val, bool) else 0,
                    }
                    parsed["url"] = loc.url
                    parsed["line"] = loc.line
                    url = loc.url
                    new_raw = json.dumps(parsed, ensure_ascii=False, separators=(",", ":"))
                except TsResolveError as e:
                    await self._error_and_finish(writer, str(e), caller_id)  # type: ignore[attr-defined]
                    return None

        if "://" not in url:
            parsed_urls = list(self._collect_parsed_scripts().keys())  # type: ignore[attr-defined]
            try:
                parsed["url"] = resolve_url(url, parsed_urls)
                new_raw = json.dumps(parsed, ensure_ascii=False, separators=(",", ":"))
            except URLNotFound:
                if parsed_urls:
                    shown = "".join(f"\n  {u}" for u in sorted(parsed_urls)[:20])
                    extra = "" if len(parsed_urls) <= 20 else f"\n  … (+{len(parsed_urls) - 20} more)"
                    loaded = f" loaded scripts:{shown}{extra}"
                else:
                    loaded = " no scripts are loaded yet — has the lens booted?"
                await self._error_and_finish(  # type: ignore[attr-defined]
                    writer,
                    f"no script matching '{url}' found;{loaded}",
                    caller_id,
                )
                return None
            except AmbiguousURL as e:
                candidates = "".join(f"\n  {m}" for m in e.candidates)
                await self._error_and_finish(  # type: ignore[attr-defined]
                    writer,
                    f"ambiguous filename '{url}' matches {len(e.candidates)} scripts:{candidates}",
                    caller_id,
                )
                return None

        raw = new_raw if new_raw is not None else json.dumps(parsed, ensure_ascii=False, separators=(",", ":"))
        return raw, source_echo


# ----------------------------------------------------------------------
# Family: inspection  (`backtrace`, `locals`)
# ----------------------------------------------------------------------

LOCALS_EMPTY_HINT = (
    "no real in-scope block bindings at this PC; "
    "`this` (synthetic) is shown above when available, "
    "and closure-scope vars are surfaced under `closures`. "
    "Use eval-on-frame for globals."
)
LOCALS_ALL_TDZ_HINT = "all bindings are uninitialized (TDZ); the PC is before their declaration sites."
LOCALS_NO_OWN_SCOPE_HINT = (
    "frame has no own local scope (e.g. an arrow/async callback whose live "
    "vars are all closed-over); `bindings` is empty by design. Read the "
    "closed-over vars under `closures`, or eval-on-frame this frame."
)

# Scope types we surface separately under `closures`. We skip:
# - `local` — that's already the primary `bindings` payload.
# - `global` / `script` — would dump hundreds of host globals + module
#   scope; agents would never read it. Use `eval` for globals.
_CLOSURE_SCOPE_TYPES_TO_SKIP: frozenset[str] = frozenset({"local", "global", "script"})


# Matches a `this` identifier token (not `this` embedded in another word, and
# not a property access like `foo.this`). Gates the global-scope warning so it
# doesn't fire on legitimate `globalThis.*` host-object checks.
_THIS_TOKEN = re.compile(r"(?<![\w.$])this(?![\w$])")


def _expr_references_this(expr: str) -> bool:
    return bool(_THIS_TOKEN.search(expr))


def _locals_hint(bindings: list[dict[str, Any]]) -> Optional[tuple[str, str]]:
    if not bindings:
        return (HINT_CODE_LOCALS_EMPTY, LOCALS_EMPTY_HINT)
    if all(isinstance(b, dict) and b.get("state") == "uninitialized" for b in bindings):
        return (HINT_CODE_LOCALS_ALL_TDZ, LOCALS_ALL_TDZ_HINT)
    return None


def _fetch_and_parse_source_map(script_url: str, source_map_url: str) -> SourceMap:
    return parse_source_map(default_fetch_map(script_url, source_map_url))


class _InspectionCommandsMixin:
    async def _load_source_map(self, script_url: str, source_map_url: str) -> Optional[SourceMap]:
        if not source_map_url:
            return None
        key = (script_url, source_map_url)
        sm = self.source_map_cache.get(key)  # type: ignore[attr-defined]
        if sm is not None:
            return sm
        try:
            # Fetch + parse is file I/O plus a potentially large JSON parse;
            # offload so the event loop keeps collecting CDP events. Cache
            # read/write stays on the loop, so no cross-thread map mutation.
            sm = await asyncio.to_thread(_fetch_and_parse_source_map, script_url, source_map_url)
        except (OSError, ValueError, json.JSONDecodeError):
            return None
        self.source_map_cache[key] = sm  # type: ignore[attr-defined]
        return sm

    async def _handle_backtrace(self, writer: asyncio.StreamWriter, caller_id: Any) -> None:
        paused = self._find_last_paused()  # type: ignore[attr-defined]
        if paused is None:
            await self._error_not_paused(writer, caller_id)  # type: ignore[attr-defined]
            return
        compacted = await self._compact_and_enrich_event(paused)
        frames = compacted.get("frames", [])
        env = Envelope.success(frames, caller_id)
        self._write_line(writer, env)  # type: ignore[attr-defined]
        await self._finish_client(writer)  # type: ignore[attr-defined]

    async def _source_location_for(self, url: str, gen_line: int, gen_col: int) -> Optional[tuple[str, int, int]]:
        if not url:
            return None
        infos_by_url = {info.url: info for info in self._collect_script_infos()}  # type: ignore[attr-defined]
        info = infos_by_url.get(url)
        if info is None or not info.sourceMapURL:
            return None
        sm = await self._load_source_map(info.url, info.sourceMapURL)
        if sm is None:
            return None
        loc = find_source_location(sm, gen_line, gen_col)
        if loc is None:
            return None
        source_idx, source_line, source_col = loc
        if not (0 <= source_idx < len(sm.sources)):
            return None
        return (sm.sources[source_idx], source_line + 1, source_col)

    async def _enrich_frames_with_source_location(self, frames: list[dict[str, Any]]) -> None:
        for frame in frames:
            if "editorLine" not in frame:
                continue
            # Frames carry the 1-based generated line in `editorLine`; the
            # source map wants the 0-based generated line, so convert back.
            gen_line = frame.get("editorLine", 1) - 1
            sl = await self._source_location_for(frame.get("url", ""), gen_line, frame.get("column", 0))
            if sl is None:
                continue
            source_name, source_line, source_col = sl
            # Promote the source line into `editorLine` (it now matches the
            # file on disk); the compiled line stays available as `generatedLine`.
            frame["editorLine"] = source_line
            frame["sourceLocation"] = {
                "source": source_name,
                "line": source_line,
                "column": source_col,
            }
            # Drop the generated `.js` Cache URL now that `sourceLocation`
            # points at the file the agent is reading — it was pure noise in
            # the paused-frame payload. Kept (below, untouched) only on frames
            # where no source map resolved, so a location always remains.
            frame.pop("url", None)

    async def _compact_and_enrich_event(self, event: dict[str, Any]) -> dict[str, Any]:
        compacted = compact_event(event, self._collect_script_id_to_url())  # type: ignore[attr-defined]
        frames = compacted.get("frames")
        if isinstance(frames, list):
            await self._enrich_frames_with_source_location(frames)
        return compacted

    async def _handle_locals(
        self,
        writer: asyncio.StreamWriter,
        parsed: dict[str, Any],
        caller_id: Any,
    ) -> None:
        paused = self._find_last_paused()  # type: ignore[attr-defined]
        if paused is None:
            await self._error_not_paused(writer, caller_id)  # type: ignore[attr-defined]
            return
        frame_index = parsed.get("frameIndex", 0)
        if not isinstance(frame_index, int) or isinstance(frame_index, bool):
            frame_index = 0
        call_frames = (paused.get("params") or {}).get("callFrames", []) or []
        if frame_index < 0 or frame_index >= len(call_frames):
            last = len(call_frames) - 1
            await self._error_and_finish(  # type: ignore[attr-defined]
                writer,
                f"frame index {frame_index} out of range (0..{last})",
                caller_id,
            )
            return
        frame = call_frames[frame_index]
        scope_chain = frame.get("scopeChain", []) or []
        call_frame_id = frame.get("callFrameId", "") or ""

        local_object_id = ""
        for scope in scope_chain:
            if scope.get("type") == "local":
                local_object_id = (scope.get("object") or {}).get("objectId", "")
                break

        # A frame with no own `local` scope (arrow/async callbacks whose only
        # live vars are closed-over) is not an error — fall through with empty
        # `bindings` so the closure-scope walk below still surfaces the vars.
        has_own_scope = bool(local_object_id)
        if has_own_scope:
            # Route through the standard get-properties dispatch so TDZ tagging
            # and the rest of the property transformer apply.
            bindings = await self._fetch_scope_bindings(local_object_id)
            if isinstance(bindings, dict):
                # Inner envelope was an error — forward verbatim.
                self._write_line(writer, bindings)  # type: ignore[attr-defined]
                await self._finish_client(writer)  # type: ignore[attr-defined]
                return
        else:
            bindings = []

        # Compute the hint from real bindings BEFORE prepending synthetic `this`.
        hint = _locals_hint(bindings)

        # Prepend synthetic `this` (tagged `synthetic: true`) so callers
        # don't need a follow-up eval-on-frame. Best-effort.
        if call_frame_id:
            this_entry = await self._fetch_synthetic_this(call_frame_id)
            if this_entry is not None:
                bindings = [this_entry] + bindings

        closures: list[dict[str, Any]] = []
        for scope in scope_chain:
            stype = scope.get("type", "") or ""
            if stype in _CLOSURE_SCOPE_TYPES_TO_SKIP:
                continue
            scope_object_id = (scope.get("object") or {}).get("objectId", "")
            if not scope_object_id:
                continue
            scope_bindings = await self._fetch_scope_bindings(scope_object_id)
            if not isinstance(scope_bindings, list) or not scope_bindings:
                continue
            closures.append({"type": stype, "bindings": scope_bindings})

        result: dict[str, Any] = {"frameIndex": frame_index, "bindings": bindings}
        if closures:
            result["closures"] = closures
        if not has_own_scope:
            # Override the generic locals-empty hint: explain *why* it's empty
            # and point at `closures` rather than failing the verb.
            result["hint"] = LOCALS_NO_OWN_SCOPE_HINT
            result["hintCode"] = HINT_CODE_LOCALS_NO_OWN_SCOPE
        elif hint is not None:
            hint_code, hint_text = hint
            result["hint"] = hint_text
            result["hintCode"] = hint_code
        self._write_line(writer, Envelope.success(result, caller_id))  # type: ignore[attr-defined]
        await self._finish_client(writer)  # type: ignore[attr-defined]

    async def _fetch_scope_bindings(self, object_id: str) -> list[dict[str, Any]] | dict[str, Any]:
        payload: dict[str, Any] = {"command": "get-properties", "objectId": object_id, "id": 0}
        line = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        inner = await command_dispatch.dispatch_message(
            self.client,  # type: ignore[attr-defined]
            self.page_session_id,  # type: ignore[attr-defined]
            payload,
            line,
        )
        if not inner.get("ok", False):
            return inner
        result = inner.get("result") or []
        return result if isinstance(result, list) else []

    async def _fetch_synthetic_this(self, call_frame_id: str) -> Optional[dict[str, Any]]:
        paused = self._find_last_paused()  # type: ignore[attr-defined]
        if paused is not None and frame_has_native_frame_below(paused, call_frame_id):
            return None
        try:
            resp = await self.client.send_command(  # type: ignore[attr-defined]
                "Debugger.evaluateOnCallFrame",
                {
                    "callFrameId": call_frame_id,
                    "expression": "this",
                    "returnByValue": False,
                },
                self.page_session_id,  # type: ignore[attr-defined]
            )
        except Exception:
            return None
        if not isinstance(resp, dict) or "error" in resp:
            return None
        cdp_result = resp.get("result") or {}
        if "exceptionDetails" in cdp_result:
            return None
        remote = cdp_result.get("result") or {}
        compact = compact_remote_object(remote) if isinstance(remote, dict) else None
        entry: dict[str, Any] = {"name": "this", "synthetic": True}
        if isinstance(compact, dict):
            entry.update(compact)
        return entry

    def _auto_frame_top(self) -> Optional[dict[str, Any]]:
        paused = self._find_last_paused()  # type: ignore[attr-defined]
        if paused is None:
            return None
        frames = (paused.get("params") or {}).get("callFrames") or []
        if not frames:
            return None
        top = frames[0]
        return top if isinstance(top, dict) else None

    async def _handle_inspect_host_object(
        self,
        writer: asyncio.StreamWriter,
        parsed: dict[str, Any],
        caller_id: Any,
    ) -> None:
        expr = parsed.get("expression")
        if not isinstance(expr, str) or not expr:
            await self._error_and_finish(  # type: ignore[attr-defined]
                writer,
                'inspect-host-object: missing required field "expression"',
                caller_id,
            )
            return
        call_frame_id = parsed.get("callFrameId")
        use_frame = isinstance(call_frame_id, str) and bool(call_frame_id)

        # No explicit frame but the VM is paused → default to the top frame so
        # `this` / closures resolve. Global scope is the false-dead trap.
        auto_framed = False
        auto_frame: Optional[dict[str, Any]] = None
        if not use_frame:
            auto_frame = self._auto_frame_top()
            if auto_frame is not None:
                top_id = auto_frame.get("callFrameId", "")
                if isinstance(top_id, str) and top_id:
                    call_frame_id = top_id
                    use_frame = True
                    auto_framed = True

        if use_frame and not await self._guard_eval_frame_safe(  # type: ignore[attr-defined]
            writer, call_frame_id, caller_id
        ):
            return

        # IIFE captures the value once (no double-eval of side-effecting
        # exprs) and JSON-encodes the result so we get a single string back.
        wrapped = (
            "((_x)=>{"
            "try{var _t=(_x).getTypeName();"
            "return JSON.stringify({state:'live',typeName:_t});}"
            "catch(e){"
            "return JSON.stringify({state:'dead',error:String((e&&e.message)||e)});"
            "}"
            f"}})(({expr}))"
        )

        if use_frame:
            method = "Debugger.evaluateOnCallFrame"
            params: dict[str, Any] = {
                "callFrameId": call_frame_id,
                "expression": wrapped,
                "returnByValue": True,
            }
        else:
            method = "Runtime.evaluate"
            params = {"expression": wrapped, "returnByValue": True}

        resp = await self.client.send_command(method, params, self.page_session_id)  # type: ignore[attr-defined]

        if "error" in resp:
            err = resp["error"] or {}
            self._write_line(  # type: ignore[attr-defined]
                writer,
                Envelope.error(err.get("message", "CDP error"), err.get("code", -32000), caller_id),
            )
            await self._finish_client(writer)  # type: ignore[attr-defined]
            return

        cdp_result = resp.get("result", {}) or {}
        result_payload: dict[str, Any]
        # Eval-itself threw (e.g. undefined variable) → surface as dead.
        if "exceptionDetails" in cdp_result:
            details = cdp_result["exceptionDetails"] or {}
            exc = details.get("exception") or {}
            err_str = exc.get("description") or details.get("text") or "expression threw"
            result_payload = {"state": "dead", "error": err_str}
        else:
            inner = cdp_result.get("result", {}) or {}
            if inner.get("type") == "string" and isinstance(inner.get("value"), str):
                try:
                    parsed_inner = json.loads(inner["value"])
                except (ValueError, TypeError):
                    parsed_inner = None
                if isinstance(parsed_inner, dict):
                    result_payload = parsed_inner
                else:
                    # Probe ran but its return wasn't the expected JSON object.
                    # That's an introspection failure, not a dead object —
                    # `state:"dead"` here would be a false negative (the verb's
                    # whole job is the live/dead verdict). Report "unknown".
                    result_payload = {
                        "state": "unknown",
                        "error": (
                            "inspect-host-object: probe returned non-JSON — "
                            "introspection failed (object liveness undetermined)"
                        ),
                    }
            else:
                # Hermes async-frame quirk: evaluateOnCallFrame may yield a
                # primitive even when the snippet should return a string. The
                # object may well be live — we just couldn't introspect it.
                result_payload = {
                    "state": "unknown",
                    "error": (
                        "inspect-host-object: probe returned a non-string primitive — "
                        "introspection failed (likely an async-stepper frame); "
                        "object liveness undetermined"
                    ),
                }

        # Disclose auto-framing (and the async-stepper caveat), or warn when a
        # global-scope this-read came back dead — so a false negative can't be
        # mistaken for a real destroyed wrapper.
        if auto_framed:
            result_payload["autoFramed"] = True
            if isinstance(call_frame_id, str):
                result_payload["frameId"] = call_frame_id
            # The async-stepper caveat only matters when the probe reads `this`
            # (then `this` is the bogus stepper closure); a closed-over expr
            # resolves correctly, so the warning would mislead. Carry hintCode
            # only — the prose lives in the docs, keyed by code.
            if (
                auto_frame is not None
                and is_async_stepper_frame_name(auto_frame.get("functionName", "") or "")
                and _expr_references_this(expr)
            ):
                result_payload["hintCode"] = HINT_CODE_ASYNC_STEPPER_FRAME
            else:
                result_payload["hintCode"] = HINT_CODE_AUTO_FRAMED
        elif not use_frame and result_payload.get("state") == "dead" and _expr_references_this(expr):
            result_payload["warning"] = GLOBAL_SCOPE_THIS_WARNING
            result_payload["warningCode"] = WARNING_CODE_GLOBAL_SCOPE_THIS

        self._write_line(writer, Envelope.success(result_payload, caller_id))  # type: ignore[attr-defined]
        await self._finish_client(writer)  # type: ignore[attr-defined]


class CommandsMixin(
    _BreakpointCommandsMixin,
    _InspectionCommandsMixin,
    _LifecycleCommandsMixin,
    HealthCommandsMixin,
):
    # ---------- target resolution + inline-attach ----------
    #
    # Multi-target plumbing lives here rather than in the cdp layer because
    # the routing rule is agent-facing — "auto-pick when there's one
    # attached, structured error when many, inline-attach when an agent
    # passes --target X and X isn't yet attached".
    async def _resolve_session_for_command(
        self,
        writer: asyncio.StreamWriter,
        parsed: dict,
        caller_id: Any,
    ) -> Optional[str]:
        target_hint = parsed.get("target")

        if target_hint:
            # Match against currently-attached sessions first (title or id).
            for sess in self.targets.values():  # type: ignore[attr-defined]
                if sess.target_title == target_hint or sess.target_id == target_hint:
                    return sess.target_id

            # Not attached — try to attach inline. resolve_target_id maps
            # title→id, single source of truth for the title-or-id rule.
            from .auto_session import resolve_target_id

            # resolve_target_id fans out to discover_targets (synchronous
            # urllib) — offload so we don't stall the event loop.
            resolved = await asyncio.to_thread(  # type: ignore[attr-defined]
                resolve_target_id, self.host, self.port, target_id=target_hint
            )
            if resolved.error:
                await self._error_and_finish(writer, resolved.error, caller_id)
                return None

            ok, attach_err = await self._attach_target_inline(resolved.target_id)
            if not ok:
                await self._error_and_finish(writer, attach_err, caller_id)
                return None
            return resolved.target_id

        # `cleanup --all` operates on every session, so the active target
        # doesn't matter — pick any (the first attached) and let the
        # handler iterate.
        if parsed.get("all") is True and self.targets:  # type: ignore[attr-defined]
            return next(iter(self.targets.keys()))  # type: ignore[attr-defined]

        # No --target supplied.
        if len(self.targets) == 1:  # type: ignore[attr-defined]
            return next(iter(self.targets.keys()))  # type: ignore[attr-defined]
        if len(self.targets) > 1:  # type: ignore[attr-defined]
            await self._emit_multiple_targets_error(writer, caller_id)
            return None
        # Zero attached should be impossible (daemon startup attaches one)
        # but handle defensively.
        await self._error_and_finish(writer, "no targets attached", caller_id)
        return None

    async def _emit_multiple_targets_error(
        self,
        writer: asyncio.StreamWriter,
        caller_id: Any,
    ) -> None:
        targets_list = [
            {"id": sess.target_id, "title": sess.target_title}
            for sess in self.targets.values()  # type: ignore[attr-defined]
        ]
        # Sort by title for deterministic output (agents may snapshot/diff).
        targets_list.sort(key=lambda t: (t["title"], t["id"]))
        titles_for_msg = ", ".join(f"{t['title']!r}" if t["title"] else t["id"] for t in targets_list)
        await self._error_and_finish(
            writer,
            f"multiple targets attached ({titles_for_msg}) — pass --target to pick one",
            caller_id,
            extra={"errorCode": "multiple_targets", "targets": targets_list},
        )

    async def _attach_target_inline(self, target_id: str) -> tuple[bool, str]:
        if target_id in self.targets:  # type: ignore[attr-defined]
            return (True, "")

        from datetime import datetime, timezone

        from .daemon_state import TargetSession

        attach_result = await attach_target(
            self.client,  # type: ignore[attr-defined]
            self.browser_session_id,  # type: ignore[attr-defined]
            target_id,
        )
        if not attach_result.ok:
            return (False, attach_result.error_message)

        enable_result = await enable_domains(self.client, attach_result.page_session_id)  # type: ignore[attr-defined]
        if not enable_result.ok:
            return (False, f"attached but enable failed: {enable_result.error_message}")

        title = ""
        # discover_targets does a synchronous urllib fetch — offload it so
        # the daemon's event loop keeps servicing CDP events / other clients.
        discovery = await asyncio.to_thread(discover_targets, self.host, self.port)  # type: ignore[attr-defined]
        if discovery.ok:
            for t in discovery.targets:
                if t.get("id") == target_id:
                    title = t.get("title", "") or ""
                    break

        self.targets[target_id] = TargetSession(  # type: ignore[attr-defined]
            target_id=target_id,
            target_title=title,
            page_session_id=attach_result.page_session_id,
            attached_at_iso=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        )
        return (True, "")

    async def _process_line(self, writer: asyncio.StreamWriter, raw_line: str) -> None:
        try:
            parsed = json.loads(raw_line)
        except json.JSONDecodeError:
            await self._error_and_finish(writer, "invalid JSON", caller_id=None)
            return
        if not isinstance(parsed, dict):
            await self._error_and_finish(
                writer,
                'unrecognized message: expected "command" or "method" field',
                caller_id=None,
            )
            return

        command = parsed.get("command")
        caller_id = parsed.get("id")

        # Target resolution must run before any handler. Setting the
        # per-task contextvar (rather than mutating self._active_target_id)
        # keeps command dispatch isolated from concurrent event handling
        # under multi-target — each runs as its own asyncio task with its
        # own copy of the contextvar.
        from .daemon import active_target_var

        resolved_target_id = await self._resolve_session_for_command(writer, parsed, caller_id)
        if resolved_target_id is None:
            return
        active_target_var.set(resolved_target_id)

        # Daemon-side pseudo-commands (no CDP dispatch).
        if command == "list-commands":
            await self._handle_list_commands(writer, caller_id)
            return
        if command == "console-log":
            await self._handle_console_log(writer, parsed, caller_id)  # type: ignore[attr-defined]
            return
        if command == "cleanup":
            await self._handle_cleanup(writer, parsed, caller_id)
            return
        if command == "backtrace":
            await self._handle_backtrace(writer, caller_id)
            return
        if command == "locals":
            await self._handle_locals(writer, parsed, caller_id)
            return
        if command == "inspect-host-object":
            await self._handle_inspect_host_object(writer, parsed, caller_id)
            return
        if command == "health":
            await self._handle_health(writer, caller_id, raw=bool(parsed.get("raw")))
            return

        # Frame-less `eval` while paused → rewrite to `eval-on-frame` against
        # the top frame so `this` / closures resolve. Global-scope eval is the
        # false-dead trap (this===globalThis). Frame 0's scope chain still
        # reaches global, so `globalThis.X=1`-style eval is unaffected. The
        # `_autoFramed` marker rides on `parsed` for annotation only — the
        # eval-on-frame param builder ignores it, so it never reaches CDP.
        if command == "eval":
            auto_frame = self._auto_frame_top()
            if auto_frame is not None:
                top_id = auto_frame.get("callFrameId", "")
                if isinstance(top_id, str) and top_id:
                    parsed["command"] = "eval-on-frame"
                    parsed["callFrameId"] = top_id
                    parsed["_autoFramed"] = True
                    command = "eval-on-frame"
                    raw_line = json.dumps(parsed, ensure_ascii=False, separators=(",", ":"))

        # Pre-dispatch guard: refuse evaluateOnCallFrame against frames
        # with native helpers interposed below — Hermes asserts and
        # aborts the process otherwise.
        if command == "eval-on-frame":
            if not await self._guard_eval_frame_safe(writer, parsed.get("callFrameId"), caller_id):
                return

        # set-breakpoint URL is resolved before CDP dispatch — the caller's
        # `.ts`/partial filename gets turned into a parsed-script URL +
        # 0-based line. On failure the helper emits the error envelope and
        # we bail; on success it returns the re-serialized line and (for
        # `.ts`/`.tsx`) a source-side echo to fold back into the envelope.
        source_echo: Optional[dict[str, Any]] = None
        if command == "set-breakpoint" and isinstance(parsed.get("url"), str):
            resolved = await self._resolve_breakpoint_url(writer, parsed, caller_id)
            if resolved is None:
                return
            raw_line, source_echo = resolved

        await self._dispatch_and_annotate(
            writer,
            parsed,
            raw_line,
            command,
            caller_id,
            source_echo=source_echo,
        )

    # ---------- list-commands (small, no family) ----------

    async def _handle_list_commands(self, writer: asyncio.StreamWriter, caller_id: Any) -> None:
        from .json_io import Envelope

        env = Envelope.success(command_dispatch.get_command_list(), caller_id)
        self._write_line(writer, env)  # type: ignore[attr-defined]
        await self._finish_client(writer)  # type: ignore[attr-defined]

    # ---------- init-time hint gating ----------

    def _lens_past_init(self) -> bool:
        return (
            self.debugger_pauses_seen > 0  # type: ignore[attr-defined]
            or self.console_events_seen > 0  # type: ignore[attr-defined]
        )

    def _will_replay_paused(self, wait_for_method: str, since_seq: int) -> bool:
        if wait_for_method != "Debugger.paused":
            return False
        return self._find_buffered_match("Debugger.paused", since_seq) is not None

    async def _dispatch_eval_watching_for_pause(
        self,
        writer: asyncio.StreamWriter,
        parsed: dict[str, Any],
        raw_line: str,
        since_seq: int,
    ) -> Optional[dict[str, Any]]:
        dispatch_task = asyncio.create_task(
            command_dispatch.dispatch_message(
                self.client,  # type: ignore[attr-defined]
                self.page_session_id,  # type: ignore[attr-defined]
                parsed,
                raw_line,
            )
        )
        paused: Optional[_TaggedEvent] = None
        while not dispatch_task.done():
            paused = self._find_buffered_match("Debugger.paused", since_seq)
            if paused is not None:
                break
            await asyncio.sleep(_EVAL_PAUSE_POLL_INTERVAL_S)

        if paused is None:
            # Eval returned (value, or a caught throw that didn't pause), or it
            # genuinely timed out — same envelope it would have had without us.
            return await dispatch_task

        # The eval's response is withheld until resume; stop awaiting it. Its
        # future is discarded when the post-resume response lands (or on close).
        dispatch_task.cancel()
        event = await self._compact_and_enrich_event(paused.data)
        if isinstance(event, dict):
            event["pausedDuringEval"] = True
            event["hintCode"] = HINT_CODE_EVAL_PAUSED_ON_EXCEPTION
        self._write_line(writer, event)  # type: ignore[attr-defined]
        await self._finish_client(writer)  # type: ignore[attr-defined]
        return None

    # ---------- CDP dispatch + result annotation ----------

    async def _dispatch_and_annotate(
        self,
        writer: asyncio.StreamWriter,
        parsed: dict[str, Any],
        raw_line: str,
        command: Any,
        caller_id: Any,
        source_echo: Optional[dict[str, Any]] = None,
    ) -> None:
        wait_for_method = ""
        wait_for_idle_ms = 0
        wait_timeout_ms = DEFAULT_WAIT_TIMEOUT_MS
        wf = parsed.get("waitFor")
        if isinstance(wf, str):
            wait_for_method = wf
        wfi = parsed.get("waitForIdleMs")
        if isinstance(wfi, int) and not isinstance(wfi, bool) and wfi > 0:
            wait_for_idle_ms = wfi
        wt = parsed.get("waitTimeout")
        if isinstance(wt, int) and not isinstance(wt, bool):
            wait_timeout_ms = wt

        should_reload = bool(command == "set-breakpoint" and parsed.get("reload") is True)

        # Capture cursor before any CDP round-trip so events that land
        # during dispatch are visible to `_enter_wait_mode` — a fast pause
        # could otherwise beat waiter registration and time out.
        dispatch_start_seq: int = self.next_seq  # type: ignore[attr-defined]

        # When pause-on-exceptions is armed, an `eval` whose body throws makes
        # the VM pause *before* the evaluate response returns — Hermes withholds
        # that response until resume, so a plain await would block for the full
        # command timeout and hand the agent an opaque "timed out". Race the
        # dispatch against the throw's own Debugger.paused and surface the pause.
        if (
            command in ("eval", "eval-on-frame")
            and self.pause_on_exceptions_state in ("all", "uncaught")  # type: ignore[attr-defined]
            and not parsed.get("waitFor")
        ):
            env = await self._dispatch_eval_watching_for_pause(writer, parsed, raw_line, dispatch_start_seq)
            if env is None:
                # Eval threw; the pause event was emitted + client finished.
                return
        else:
            env = await command_dispatch.dispatch_message(
                self.client,
                self.page_session_id,
                parsed,
                raw_line,  # type: ignore[attr-defined]
            )

        # Annotate set-breakpoint result. `resolved: false` (empty
        # `locations`) means the bp will never fire — surface the unresolved
        # hint, never the init-time one. The init-time hint is gated on:
        # no --reload, no past-init evidence, no pause riding along in the
        # same envelope.
        if command == "set-breakpoint" and env.get("ok") is True and isinstance(env.get("result"), dict):
            result_dict = env["result"]
            if source_echo is not None:
                result_dict["sourceLocation"] = source_echo
            # Promote each resolved location's `editorLine` to its source line so
            # it matches the file the agent is reading; the compiled line stays
            # under `generatedLine`. Falls back to the requested source line.
            gen_url = parsed.get("url", "")
            for loc in result_dict.get("locations") or []:
                gen_line = loc.get("generatedLine", loc.get("editorLine", 1)) - 1
                sl = await self._source_location_for(gen_url, gen_line, loc.get("columnNumber", 0))
                if sl is not None:
                    loc["editorLine"] = sl[1]
                elif source_echo is not None and isinstance(source_echo.get("line"), int):
                    loc["editorLine"] = source_echo["line"]
            if result_dict.get("resolved") is False:
                result_dict["hint"] = SET_BREAKPOINT_UNRESOLVED_HINT
                result_dict["hintCode"] = HINT_CODE_BP_UNRESOLVED
            elif (
                not should_reload
                and not self._lens_past_init()
                and not self._will_replay_paused(wait_for_method, dispatch_start_seq)
            ):
                result_dict["hint"] = SET_BREAKPOINT_HINT
                result_dict["hintCode"] = HINT_CODE_BP_INIT_TIME
            # Track bp ID for cleanup.
            bp_id = result_dict.get("breakpointId")
            if isinstance(bp_id, str) and bp_id:
                self.tracked_breakpoints.add(bp_id)  # type: ignore[attr-defined]

        if command == "remove-breakpoint" and env.get("ok") is True:
            removed = parsed.get("breakpointId")
            if isinstance(removed, str):
                # `tracked` lets agents distinguish a real session-bp removal
                # from Hermes silently succeeding for an unknown ID.
                if isinstance(env.get("result"), dict):
                    tracked = removed in self.tracked_breakpoints  # type: ignore[attr-defined]
                    env["result"]["tracked"] = tracked
                    if not tracked:
                        env["result"]["hint"] = REMOVE_BREAKPOINT_UNTRACKED_HINT
                        env["result"]["hintCode"] = HINT_CODE_BP_NOT_TRACKED
                self.tracked_breakpoints.discard(removed)  # type: ignore[attr-defined]
        elif command == "pause-on-exceptions" and env.get("ok") is True:
            # CDP returns `{}`; echo the state transition + a warning when
            # the new mode arms a pause footgun. Agents skim past `{}` and
            # miss what they just changed.
            state_in = parsed.get("state")
            if isinstance(env.get("result"), dict) and isinstance(state_in, str):
                previous = self.pause_on_exceptions_state  # type: ignore[attr-defined]
                env["result"]["previousState"] = previous
                env["result"]["newState"] = state_in
                if state_in in ("all", "uncaught"):
                    target = "any throw" if state_in == "all" else "uncaught throws"
                    env["result"]["warning"] = (
                        f"VM will now pause on {target}. Use `resume` after "
                        f"diagnostics, or `pause-on-exceptions none` to disable."
                    )
                self.pause_on_exceptions_state = state_in  # type: ignore[attr-defined]
        elif command == "eval-on-frame" and env.get("ok") is True:
            # Disclose auto-framing (frame-less `eval` rewritten to the top
            # frame) and the Hermes async-stepper caveat: `this` is the closure,
            # not the component — agent needs to escape to a non-async parent.
            target_frame_id = parsed.get("callFrameId", "")
            auto_framed = parsed.get("_autoFramed") is True
            is_async_stepper = False
            if isinstance(target_frame_id, str) and target_frame_id:
                paused = self._find_last_paused()  # type: ignore[attr-defined]
                if paused is not None:
                    for frame in (paused.get("params") or {}).get("callFrames", []) or []:
                        if frame.get("callFrameId") == target_frame_id:
                            is_async_stepper = is_async_stepper_frame_name(frame.get("functionName", "") or "")
                            break
            result = env.get("result")
            if isinstance(result, dict):
                if auto_framed:
                    result["autoFramed"] = True
                    result["frameId"] = target_frame_id
                # The async-stepper caveat (`this` is the bogus stepper closure)
                # only applies when the expression reads `this`; for closed-over
                # vars the eval resolves correctly and the warning misleads.
                # Carry hintCode only — prose lives in the docs, keyed by code.
                expr = parsed.get("expression", "") or ""
                if is_async_stepper and _expr_references_this(expr):
                    result["hintCode"] = HINT_CODE_ASYNC_STEPPER_FRAME
                elif auto_framed:
                    result["hintCode"] = HINT_CODE_AUTO_FRAMED

        self._write_line(writer, env)  # type: ignore[attr-defined]

        if not should_reload or env.get("ok") is not True:
            await self._maybe_enter_wait_modes(
                writer, wait_for_method, wait_for_idle_ms, wait_timeout_ms, dispatch_start_seq
            )
            return

        # Chain Page.reload on successful set-breakpoint --reload. The
        # success envelope from Page.reload is suppressed — `{}` after the
        # set-breakpoint payload looked like a swallowed second response,
        # and the one-verb-one-envelope mental model is the cleaner fix.
        # Errors are still surfaced so an actual reload failure isn't lost.
        reload_line = '{"command":"reload"}'
        reload_env = await command_dispatch.dispatch_message(
            self.client,
            self.page_session_id,
            {"command": "reload"},
            reload_line,  # type: ignore[attr-defined]
        )
        if reload_env.get("ok") is not True:
            self._write_line(writer, reload_env)  # type: ignore[attr-defined]
        await self._maybe_enter_wait_modes(
            writer, wait_for_method, wait_for_idle_ms, wait_timeout_ms, dispatch_start_seq
        )

    # ---------- wait-for ----------

    async def _maybe_enter_wait_modes(
        self,
        writer: asyncio.StreamWriter,
        wait_for_method: str,
        wait_for_idle_ms: int,
        wait_timeout_ms: int,
        since_seq: int,
    ) -> None:
        if not wait_for_method and not wait_for_idle_ms:
            await self._finish_client(writer)  # type: ignore[attr-defined]
            return
        if wait_for_method:
            await self._enter_wait_mode(writer, wait_for_method, wait_timeout_ms, since_seq)
            if writer not in self.waiting_clients:  # type: ignore[attr-defined]
                # Synchronous replay already wrote envelope + sentinel.
                return
        if wait_for_idle_ms:
            self._enter_wait_idle_mode(writer, wait_for_idle_ms, wait_timeout_ms)

    async def _enter_wait_mode(
        self,
        writer: asyncio.StreamWriter,
        method: str,
        timeout_ms: int,
        since_seq: int,
    ) -> None:
        replay = self._find_buffered_match(method, since_seq)
        if replay is not None:
            self._write_line(writer, await self._compact_and_enrich_event(replay.data))  # type: ignore[attr-defined]
            self._write_line(writer, {"__done": True})  # type: ignore[attr-defined]
            await self._drain(writer)  # type: ignore[attr-defined]
            return
        timer_task = asyncio.create_task(self._wait_timeout(writer, timeout_ms), name="lsdbg.wait")
        self.waiting_clients[writer] = _WaitState(  # type: ignore[attr-defined]
            method=method,
            timer_task=timer_task,
            since_seq=since_seq,
        )

    def _find_buffered_match(self, method: str, since_seq: int) -> Optional[_TaggedEvent]:
        for tagged in self.event_buffer:  # type: ignore[attr-defined]
            if tagged.seq < since_seq:
                continue
            if tagged.data.get("method") == method:
                return tagged
        return None

    async def _wait_timeout(self, writer: asyncio.StreamWriter, timeout_ms: int) -> None:
        try:
            await asyncio.sleep(timeout_ms / 1000.0)
        except asyncio.CancelledError:
            return
        state = self.waiting_clients.pop(writer, None)  # type: ignore[attr-defined]
        if state is None:
            return
        # Drop any composing --wait-for-idle entry so its satisfaction path
        # doesn't write after we emit the timeout envelope + sentinel.
        idle_state = self.waiting_idle_clients.pop(writer, None)  # type: ignore[attr-defined]
        if idle_state is not None:
            idle_state.idle_timer_task.cancel()
            idle_state.hard_deadline_task.cancel()
        # Final buffer re-check: pause notifications can land between the
        # timer firing and this cleanup running. Surface the event rather
        # than a spurious timeout.
        late = self._find_buffered_match(state.method, state.since_seq)
        if late is not None:
            self._write_line(writer, await self._compact_and_enrich_event(late.data))  # type: ignore[attr-defined]
            self._write_line(writer, {"__done": True})  # type: ignore[attr-defined]
            await self._drain(writer)  # type: ignore[attr-defined]
            return
        # Genuine timeout. Attach a hint pointing the agent at `health` —
        # if `vm.paused == true` the event arrived even later and the pause
        # is real; otherwise the bp / wait was wrong.
        self._write_line(
            writer,
            {  # type: ignore[attr-defined]
                "ok": False,
                "error": {"message": "waitFor timed out", "code": -32001},
                "hint": (
                    f"call `health` next; if `vm.paused == true` the {state.method} "
                    "event arrived after this timer fired and the pause is real."
                ),
                "hintCode": HINT_CODE_WAIT_TIMEOUT_LATE_EVENT,
            },
        )
        self._write_line(writer, {"__done": True})  # type: ignore[attr-defined]
        await self._drain(writer)  # type: ignore[attr-defined]

    # ---------- wait-for-idle ----------

    def _enter_wait_idle_mode(
        self,
        writer: asyncio.StreamWriter,
        idle_ms: int,
        hard_timeout_ms: int,
    ) -> None:
        now = time.monotonic()
        idle_timer_task = asyncio.create_task(
            self._wait_idle_timer_loop(writer),
            name="lsdbg.wait-idle.timer",
        )
        hard_deadline_task = asyncio.create_task(
            self._wait_idle_hard_deadline(writer, hard_timeout_ms),
            name="lsdbg.wait-idle.deadline",
        )
        self.waiting_idle_clients[writer] = _WaitIdleState(  # type: ignore[attr-defined]
            idle_threshold_ms=idle_ms,
            idle_timer_task=idle_timer_task,
            hard_deadline_task=hard_deadline_task,
            events_observed=0,
            started_monotonic=now,
            last_event_monotonic=now,
        )

    async def _wait_idle_timer_loop(self, writer: asyncio.StreamWriter) -> None:
        while True:
            state = self.waiting_idle_clients.get(writer)  # type: ignore[attr-defined]
            if state is None:
                return
            elapsed_ms = (time.monotonic() - state.last_event_monotonic) * 1000.0
            if elapsed_ms >= state.idle_threshold_ms:
                await self._wait_idle_satisfied(writer, "idle")
                return
            remaining_s = (state.idle_threshold_ms - elapsed_ms) / 1000.0
            try:
                await asyncio.sleep(remaining_s)
            except asyncio.CancelledError:
                return

    async def _wait_idle_hard_deadline(self, writer: asyncio.StreamWriter, timeout_ms: int) -> None:
        try:
            await asyncio.sleep(timeout_ms / 1000.0)
        except asyncio.CancelledError:
            return
        await self._wait_idle_satisfied(writer, "hard_timeout")

    async def _wait_idle_satisfied(self, writer: asyncio.StreamWriter, stop_reason: str) -> None:
        state = self.waiting_idle_clients.pop(writer, None)  # type: ignore[attr-defined]
        if state is None:
            return
        # We're called *from* one of these tasks (timer loop or hard
        # deadline). Cancelling the running task would deliver a
        # CancelledError at the next await — `_finish_client`'s drain —
        # truncating the response. Cancel only the sibling.
        current = asyncio.current_task()
        if state.idle_timer_task is not current:
            state.idle_timer_task.cancel()
        if state.hard_deadline_task is not current:
            state.hard_deadline_task.cancel()
        wait_for_state = self.waiting_clients.pop(writer, None)  # type: ignore[attr-defined]
        if wait_for_state is not None:
            wait_for_state.timer_task.cancel()
        waited_ms = int((time.monotonic() - state.started_monotonic) * 1000)
        result: dict[str, Any] = {
            "events_observed": state.events_observed,
            "waited_ms": waited_ms,
            "stop_reason": stop_reason,
        }
        if stop_reason == "idle":
            result["idle_ms_achieved"] = state.idle_threshold_ms
        self._write_line(writer, Envelope.success(result))  # type: ignore[attr-defined]
        await self._finish_client(writer)  # type: ignore[attr-defined]

    # ---------- error helpers ----------

    async def _error_and_finish(
        self,
        writer: asyncio.StreamWriter,
        message: str,
        caller_id: Any,
        *,
        extra: Optional[dict[str, Any]] = None,
    ) -> None:
        self._write_line(writer, Envelope.error(message, -1, caller_id, extra=extra))  # type: ignore[attr-defined]
        await self._finish_client(writer)  # type: ignore[attr-defined]

    async def _error_not_paused(self, writer: asyncio.StreamWriter, caller_id: Any) -> None:
        # Exact message is keyed off by agents; don't drift it.
        await self._error_and_finish(writer, "not paused — no Debugger.paused event in buffer", caller_id)

    async def _guard_eval_frame_safe(self, writer: asyncio.StreamWriter, call_frame_id: Any, caller_id: Any) -> bool:
        if not isinstance(call_frame_id, str) or not call_frame_id:
            return True
        paused = self._find_last_paused()  # type: ignore[attr-defined]
        if paused is None:
            return True
        if not frame_has_native_frame_below(paused, call_frame_id):
            return True
        await self._error_and_finish(
            writer,
            EVAL_NATIVE_FRAME_BELOW_MSG,
            caller_id,
            extra={"errorCode": HINT_CODE_EVAL_NATIVE_FRAME_BELOW},
        )
        return False
