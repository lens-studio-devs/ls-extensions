# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from typing import Any

from . import command_dispatch, help_text, verbs
from .auto_session import attach_until_live, ensure_session, resolve_target_id
from .cleanup_force import run_cleanup_force
from .console_events import FilterParseError, parse_duration_seconds
from .daemon import run_attach
from .health_command import run_health
from .install_link import run_install_link
from .json_io import Envelope, emit_stdout, fail
from .send import _emit_cleanup_already_gone, run_send
from .session_metadata import is_process_alive, ping_session, read_metadata

# ---------- argparse setup ----------


def _add_global_flags(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--port", type=int, default=9222, help="debug server port (default: 9222)")
    parser.add_argument("--host", type=str, default="localhost", help="debug server host (default: localhost)")
    parser.add_argument("--verbose", action="store_true", help="Print low-level debugger traffic to stderr")


def _add_wait_flags(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--wait-paused",
        dest="wait_paused",
        action="store_true",
        help=(
            "Block until the lens pauses (a breakpoint is hit or an exception "
            "is thrown), then return. Not the same as `attach` — that blocks "
            "until the daemon/VM is live. Use --wait-paused to wait inside a "
            "debug session for the lens to halt."
        ),
    )
    parser.add_argument(
        "--wait-idle",
        dest="wait_idle",
        type=str,
        default=None,
        metavar="DURATION",
        help=(
            "Block until no debug events arrive for the window (e.g. 500ms, 2s). "
            "Use when you want to wait for the VM to settle after `reload` or "
            "an interaction — neither pattern nor count is known. Composes "
            "with --wait-paused: whichever fires first wins. --timeout is the "
            "absolute ceiling (default 30s). The envelope appends "
            "{events_observed, idle_ms_achieved, waited_ms, stop_reason} after "
            "the verb's own result (stop_reason: 'idle' = window cleared, "
            "'hard_timeout' = --timeout fired first on a VM that never settled)."
        ),
    )
    parser.add_argument(
        "--timeout",
        dest="wait_timeout",
        type=str,
        default=None,
        metavar="DURATION",
        help="Timeout for --wait-paused / --wait-idle (e.g. 5s, 500ms, 2m). Default: 30s.",
    )


def _add_target_flag(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--target",
        dest="target",
        type=str,
        default=None,
        metavar="TITLE_OR_ID",
        help=(
            "Pick a target by exact title (e.g. 'Preview 1') or by raw "
            "target id. Title is tried first; falls back to id match. "
            "Required when more than one target is attached; auto-picked "
            "otherwise."
        ),
    )


def _add_trigger_flags(parser: argparse.ArgumentParser) -> None:
    _add_target_flag(parser)
    _add_wait_flags(parser)


def _parse_duration_ms_or_fail(flag: str, value: str) -> int | None:
    try:
        seconds = parse_duration_seconds(value)
    except FilterParseError as e:
        fail(f"{flag}: {e}")
        return None
    if seconds is None or seconds < 0:
        fail(f"{flag}: must be a non-negative duration like '5s', '500ms'")
        return None
    return int(seconds * 1000)


# Shorthand-payload builders: `cmd -> [(arg_name, payload_key, transform)]`.
# Optional flags whose argparse value is None are skipped.
_SHORTHAND_FIELDS: dict[str, list[tuple[str, str, Any]]] = {
    "eval": [("expression", "expression", None)],
    "set-breakpoint": [
        ("url", "url", None),
        ("line", "line", None),
        ("condition", "condition", None),
        ("reload", "reload", lambda v: True if v else None),
    ],
    "remove-breakpoint": [("breakpointId", "breakpointId", None)],
    "eval-on-frame": [("callFrameId", "callFrameId", None), ("expression", "expression", None)],
    "inspect-host-object": [
        ("expression", "expression", None),
        ("callFrameId", "callFrameId", None),
    ],
    "get-properties": [("objectId", "objectId", None)],
    "pause-on-exceptions": [("state", "state", None)],
    "locals": [("frameIndex", "frameIndex", None)],
    "console-log": [
        ("since", "since", None),
        ("wait_pattern", "waitForPattern", None),
        ("timeout", "timeout", None),
    ],
}

# Shorthands with no per-command fields (just the global flags). A different
# concept from the trigger set: this also includes the no-pause readers
# `backtrace`/`cleanup`.
_NO_FIELD_SHORTHANDS: frozenset[str] = frozenset(
    {
        "pause",
        "resume",
        "step-over",
        "step-into",
        "step-out",
        "reload",
        "backtrace",
        "cleanup",
    }
)

# Trigger verbs that take positionals, so they get an explicit subparser (the
# rest are added in a loop derived from verbs.WAIT_TRIGGER_VERBS). Must stay a
# subset of the canonical set — asserted so a new trigger verb can't silently
# bypass its parser.
_TRIGGER_VERBS_WITH_ARGS: frozenset[str] = frozenset({"eval", "set-breakpoint", "pause-on-exceptions"})
assert _TRIGGER_VERBS_WITH_ARGS <= verbs.WAIT_TRIGGER_VERBS, (
    "_TRIGGER_VERBS_WITH_ARGS drifted from verbs.WAIT_TRIGGER_VERBS"
)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="lsdbg",
        description="Debug a running JavaScript lens.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    # `--host` / `--port` / `--verbose` are top-level globals: they configure
    # the daemon connection, not the verb. Must appear before the verb on the
    # command line (e.g. `lsdbg --host X eval "1+1"`).
    _add_global_flags(parser)
    sub = parser.add_subparsers(dest="command", metavar="<command>")
    sub.required = False  # we print help if missing

    # ----- session commands -----

    p = sub.add_parser(
        "attach",
        help=verbs.description_for("attach"),
        description=(
            "Start a persistent debug session and block until it is genuinely "
            "live — daemon attached, CDP handshake done, VM responsive (the "
            "fresh-attach race cleared). Returns one envelope "
            "{attached, targetId, state} and exits. Idempotent, so it doubles "
            "as the readiness gate: call it instead of hand-rolling sleep/poll "
            "loops. Shorthand verbs auto-attach in the single-target case, so "
            "explicit `attach` is only needed to pre-warm or pick among "
            "multiple previews."
        ),
    )
    _add_target_flag(p)
    p.add_argument(
        "--timeout",
        dest="wait_timeout",
        type=str,
        default=None,
        metavar="DURATION",
        help="Override the default 30s readiness budget for the detached spawn (e.g. 5s, 45s).",
    )

    p = sub.add_parser(
        "install-link",
        help=verbs.description_for("install-link"),
        description=(
            "Symlink $HOME/.local/bin/lsdbg → this wrapper so agents can "
            "invoke bare `lsdbg`. Idempotent; reports `on_path` so you "
            "know whether your shell PATH needs updating. POSIX-only."
        ),
    )

    p = sub.add_parser("list-commands", help=verbs.description_for("list-commands"))
    p.add_argument(
        "--summary",
        action="store_true",
        help=(
            "Emit one line per verb (name, positional, flags, description) "
            "instead of the full JSON catalog. ~22 lines vs ~230. Use for "
            "quick lookup; the default JSON form stays machine-parseable."
        ),
    )

    p = sub.add_parser(
        "health",
        help=verbs.description_for("health"),
        description=(
            "Diagnose preview/session state (does not spawn a daemon). Returns "
            "{session, vm, activity_since_attach, preview} so an empty "
            "console-log can be disambiguated from idle preview / init crash "
            "/ wrong target."
        ),
        epilog=help_text.HEALTH_EPILOG,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument(
        "--raw",
        action="store_true",
        dest="raw_blob",
        help=(
            "Include structurally-null preview fields (playing:'unknown', "
            "last_frame_ts:null, frame_age_ms:null, probe_error:'unsupported'). "
            "Default omits them — result.state carries the actionable answer."
        ),
    )

    # ----- shorthand commands -----

    p = sub.add_parser(
        "eval",
        help=verbs.description_for("eval"),
        epilog=help_text.EVAL_EPILOG,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("expression", type=str)
    _add_trigger_flags(p)

    # No-arg trigger verbs (stepping / resuming / reloading can land a new
    # pause) derive from the canonical set minus those that take positionals
    # (eval / set-breakpoint / pause-on-exceptions, added explicitly). Drift is
    # caught by the assertion below.
    for name in sorted(verbs.WAIT_TRIGGER_VERBS - _TRIGGER_VERBS_WITH_ARGS):
        p = sub.add_parser(name, help=verbs.description_for(name))
        _add_trigger_flags(p)

    # Inspection verbs: read state, never cause a pause. `--target` only.
    p = sub.add_parser(
        "backtrace",
        help=verbs.description_for("backtrace"),
        epilog=help_text.BACKTRACE_EPILOG,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    _add_target_flag(p)

    p = sub.add_parser(
        "set-breakpoint",
        help=verbs.description_for("set-breakpoint"),
        epilog=help_text.SET_BREAKPOINT_EPILOG,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("url", type=str)
    p.add_argument("line", type=int)
    p.add_argument("--condition", type=str, default=None, help="Breakpoint condition (JS expression)")
    p.add_argument("--reload", dest="reload", action="store_true", help="Reload the lens after setting the breakpoint")
    _add_trigger_flags(p)

    p = sub.add_parser("remove-breakpoint", help=verbs.description_for("remove-breakpoint"))
    p.add_argument("breakpointId", type=str)
    _add_target_flag(p)

    p = sub.add_parser("eval-on-frame", help=verbs.description_for("eval-on-frame"))
    p.add_argument("callFrameId", type=str)
    p.add_argument("expression", type=str)
    _add_target_flag(p)

    p = sub.add_parser(
        "inspect-host-object",
        help=verbs.description_for("inspect-host-object"),
        description=(
            "Probe an expression for a stale host-object wrapper "
            "(typeof === 'object' but the native is gone): "
            "{state: 'live'|'dead', typeName?, error?}"
        ),
        epilog=help_text.INSPECT_HOST_OBJECT_EPILOG,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument(
        "expression",
        type=str,
        help="Expression to inspect, e.g. 'this.child' or 'childRef'",
    )
    p.add_argument(
        "callFrameId",
        type=str,
        nargs="?",
        default=None,
        help="Optional: a paused-frame id (from `backtrace`). Omit to evaluate in global scope.",
    )
    _add_target_flag(p)

    p = sub.add_parser("get-properties", help=verbs.description_for("get-properties"))
    p.add_argument("objectId", type=str)
    _add_target_flag(p)

    p = sub.add_parser(
        "pause-on-exceptions",
        help=verbs.description_for("pause-on-exceptions"),
        epilog=help_text.PAUSE_ON_EXCEPTIONS_EPILOG,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("state", type=str, choices=["none", "uncaught", "all"])
    _add_trigger_flags(p)

    p = sub.add_parser(
        "locals",
        help=verbs.description_for("locals"),
        epilog=help_text.LOCALS_EPILOG,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("frameIndex", type=int, nargs="?", default=None)
    _add_target_flag(p)

    p = sub.add_parser(
        "cleanup",
        help=verbs.description_for("cleanup"),
        epilog=help_text.CLEANUP_EPILOG,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    _add_target_flag(p)
    p.add_argument(
        "--all",
        dest="all_targets",
        action="store_true",
        help=(
            "Detach every attached target and shutdown the daemon. "
            "Without --all + multiple targets attached, cleanup returns "
            "the structured multiple_targets error — pick one with "
            "--target or use --all to tear down everything."
        ),
    )
    p.add_argument(
        "--force",
        action="store_true",
        help=(
            "Skip the graceful teardown and terminate the daemon process "
            "directly (SIGTERM, escalating to SIGKILL after 1s). Use when "
            "normal `cleanup` hangs with 'Timed out waiting for response from "
            "lsdbg session' — the target VM has stopped responding."
        ),
    )

    # ----- console verbs -----

    p = sub.add_parser(
        "console-log",
        help=verbs.description_for("console-log"),
        description=(
            "Read buffered console output as NDJSON — one JSON object per event "
            "{seq,ts,source,level,message} (+args/stack when present). `seq` is "
            "the cursor — pass the last line's `seq` back via --since for "
            "everything new. Snapshot by default; --wait-pattern blocks until a "
            "message matches (or --timeout expires)."
        ),
        epilog=help_text.CONSOLE_LOG_EPILOG,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument(
        "--since",
        type=int,
        default=None,
        help="Only events with a `seq` greater than this (the `seq` from a prior line).",
    )
    p.add_argument(
        "--wait-pattern",
        dest="wait_pattern",
        type=str,
        default=None,
        metavar="REGEX",
        help="Block until a message matches this regex (Python re), then return.",
    )
    p.add_argument(
        "--timeout",
        dest="timeout",
        type=str,
        default=None,
        metavar="DURATION",
        help=(
            "Max time to block when --wait-pattern is set (e.g. 5s, 100ms, "
            "2m). Default 30s. Ignored without --wait-pattern."
        ),
    )
    _add_target_flag(p)

    return parser


# ---------- dispatch ----------


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    cmd = args.command

    if cmd is None:
        parser.print_help(sys.stderr)
        return 1

    if cmd == "attach":
        return _do_attach(args)
    if cmd == "install-link":
        return run_install_link()
    if cmd == "list-commands":
        if getattr(args, "summary", False):
            sys.stdout.write(verbs.format_verb_summary() + "\n")
            sys.stdout.flush()
        else:
            emit_stdout(command_dispatch.get_command_list())
        return 0
    if cmd == "health":
        # Skip _run_shorthand: ensure_session() would auto-spawn a daemon
        # and defeat the diagnostic purpose.
        return run_health(args.host, args.port, raw=getattr(args, "raw_blob", False))

    if cmd == "cleanup":
        if getattr(args, "force", False):
            # --force bypasses ensure_session + send to terminate a wedged daemon.
            return run_cleanup_force(args.host, args.port)
        # No live daemon → nothing to tear down. Short-circuit before
        # _run_shorthand, whose ensure_session() would auto-spawn a daemon just
        # to clean it up. Teardown is idempotent: report success, not failure.
        meta = read_metadata(args.host, args.port)
        if meta is None or not is_process_alive(meta.pid) or not ping_session(meta.socketPath):
            _emit_cleanup_already_gone(shorthand=True)
            return 0

    return _run_shorthand(cmd, args)


def _do_attach(args: argparse.Namespace) -> int:
    resolved = resolve_target_id(
        host=args.host,
        port=args.port,
        target_id=args.target,
    )
    if resolved.error:
        # Mirror the daemon dispatch path's structured multiple_targets error so
        # consumers can branch on error.errorCode / error.targets uniformly.
        extra = (
            {"errorCode": "multiple_targets", "targets": resolved.targets}
            if resolved.error_code == "multiple_targets"
            else None
        )
        fail(resolved.error, extra=extra)
        return 1

    if os.environ.get("LSDBG_INTERNAL_FOREGROUND") == "1":
        return asyncio.run(run_attach(args.host, args.port, resolved.target_id, args.verbose))

    timeout_ms: int | None = None
    if args.wait_timeout is not None:
        timeout_ms = _parse_duration_ms_or_fail("--timeout", args.wait_timeout)
        if timeout_ms is None:
            return 1

    ok, state, error = attach_until_live(
        host=args.host,
        port=args.port,
        target_id=resolved.target_id,
        verbose=args.verbose,
        timeout_ms=timeout_ms,
    )
    if not ok:
        fail(error)
        return 1
    payload: dict[str, Any] = {"attached": True, "targetId": resolved.target_id}
    if state is not None:
        payload["state"] = state
    emit_stdout(Envelope.success(payload))
    return 0


def _run_shorthand(cmd: str, args: argparse.Namespace) -> int:
    payload = _build_shorthand_payload(cmd, args)
    if payload is None:
        return 1

    session = ensure_session(args.host, args.port, args.verbose, target=getattr(args, "target", None))
    if not session.ok:
        fail(session.error)
        return 1

    payload_str = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return run_send(args.host, args.port, payload_str, shorthand=True)


def _build_shorthand_payload(cmd: str, args: argparse.Namespace) -> dict[str, Any] | None:
    if cmd not in _SHORTHAND_FIELDS and cmd not in _NO_FIELD_SHORTHANDS:
        fail(f"Unknown command: {cmd}")
        return None

    payload: dict[str, Any] = {"command": cmd, "id": 1}

    for arg_name, payload_key, transform in _SHORTHAND_FIELDS.get(cmd, []):
        raw = getattr(args, arg_name, None)
        if raw is None:
            continue
        value = transform(raw) if transform is not None else raw
        if value is None:
            # Transform can suppress (e.g. `reload` only sets `reload: true`).
            continue
        payload[payload_key] = value

    # `--target` rides on every dispatching verb. Daemon-side routing
    # resolves title-or-id, auto-picks for the single-attached case, and
    # returns a structured `multiple_targets` error otherwise.
    target = getattr(args, "target", None)
    if target:
        payload["target"] = target

    # cleanup --all opts out of the multiple_targets resolution rule by
    # tearing down every attached session before shutting the daemon down.
    if cmd == "cleanup" and getattr(args, "all_targets", False):
        payload["all"] = True

    # Wait flags ride only on trigger verbs (cli._add_trigger_flags); the
    # getattr defaults absorb inspection verbs, whose namespaces lack these
    # attrs, so no waitFor keys leak onto the wire for them.
    if getattr(args, "wait_paused", False):
        payload["waitFor"] = "Debugger.paused"
    wait_idle = getattr(args, "wait_idle", None)
    if wait_idle is not None:
        try:
            seconds = parse_duration_seconds(wait_idle)
        except FilterParseError as e:
            fail(f"--wait-idle: {e}")
            return None
        if seconds is None or seconds <= 0:
            fail("--wait-idle: duration must be positive (e.g. 500ms, 2s)")
            return None
        payload["waitForIdleMs"] = int(seconds * 1000)
    if getattr(args, "wait_timeout", None) is not None:
        wait_timeout_ms = _parse_duration_ms_or_fail("--timeout", args.wait_timeout)
        if wait_timeout_ms is None:
            return None
        payload["waitTimeout"] = wait_timeout_ms

    return payload


if __name__ == "__main__":  # pragma: no cover - convenience for direct invocation
    sys.exit(main())
