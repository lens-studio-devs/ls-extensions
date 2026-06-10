# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Optional

Category = Literal["session", "cdp", "pseudo", "console"]


# The four flags a *trigger* verb accepts via cli._add_trigger_flags.
# Kept here (not just in cli.py) so the catalog can advertise them on the
# verbs that use them — agents reading `list-commands --summary` were burned
# by the previous "globally accepted but invisible in catalog" drift. Only
# trigger verbs (see WAIT_TRIGGER_VERBS) take the wait flags; every other
# dispatching verb takes `--target` only and lists it in its own `flags`.
SHORTHAND_GLOBAL_FLAGS: tuple[str, ...] = ("--target", "--wait-paused", "--wait-idle", "--timeout")


@dataclass(frozen=True)
class VerbDef:
    name: str
    category: Category
    description: str
    cdp_method: Optional[str] = None  # only set for category == "cdp"
    positional: tuple[str, ...] = field(default=())
    flags: tuple[str, ...] = field(default=())


VERB_CATALOG: tuple[VerbDef, ...] = (
    # ----- session: handled in cli.py, not over the socket -----
    VerbDef(
        "attach",
        "session",
        "Start a debug session and block until the VM is live — idempotent, so it "
        "doubles as the readiness gate. Returns {attached, targetId, state}.",
        flags=("--target", "--timeout"),
    ),
    VerbDef("list-commands", "session", "List available high-level commands", flags=("--summary",)),
    VerbDef(
        "install-link",
        "session",
        "Symlink $HOME/.local/bin/lsdbg → this wrapper so agents can invoke `lsdbg` bare",
    ),
    # ----- cdp: dispatched via command_dispatch.COMMAND_TABLE -----
    VerbDef(
        "eval",
        "cdp",
        "Evaluate a JS expression (global scope while running; auto-evaluates "
        "in the top frame when paused so `this`/closures resolve — envelope "
        "carries autoFramed:true)",
        cdp_method="Runtime.evaluate",
        positional=("expression",),
    ),
    VerbDef("pause", "cdp", "Pause execution", cdp_method="Debugger.pause"),
    VerbDef("resume", "cdp", "Resume execution", cdp_method="Debugger.resume"),
    VerbDef("step-over", "cdp", "Step over the current line", cdp_method="Debugger.stepOver"),
    VerbDef("step-into", "cdp", "Step into the next call", cdp_method="Debugger.stepInto"),
    VerbDef("step-out", "cdp", "Step out of the current function", cdp_method="Debugger.stepOut"),
    VerbDef("reload", "cdp", "Reload the lens", cdp_method="Page.reload"),
    VerbDef(
        "set-breakpoint",
        "cdp",
        "Set a breakpoint (partial filenames resolved)",
        cdp_method="Debugger.setBreakpointByUrl",
        positional=("url", "line"),
        flags=("--condition", "--reload"),
    ),
    VerbDef(
        "remove-breakpoint",
        "cdp",
        "Remove a breakpoint",
        cdp_method="Debugger.removeBreakpoint",
        positional=("breakpointId",),
        flags=("--target",),
    ),
    VerbDef(
        "eval-on-frame",
        "cdp",
        "Evaluate in a specific call frame (when paused)",
        cdp_method="Debugger.evaluateOnCallFrame",
        positional=("callFrameId", "expression"),
        flags=("--target",),
    ),
    VerbDef(
        "get-properties",
        "cdp",
        "Inspect object properties",
        cdp_method="Runtime.getProperties",
        positional=("objectId",),
        flags=("--target",),
    ),
    VerbDef(
        "pause-on-exceptions",
        "cdp",
        'Pause mode: "none" | "uncaught" | "all"',
        cdp_method="Debugger.setPauseOnExceptions",
        positional=("state",),
    ),
    # ----- pseudo: answered server-side in the attach daemon -----
    VerbDef("backtrace", "pseudo", "Show call stack when paused", flags=("--target",)),
    VerbDef("locals", "pseudo", "Show local variables (when paused)", positional=("frameIndex",), flags=("--target",)),
    VerbDef(
        "inspect-host-object",
        "pseudo",
        (
            "Probe an expression for a stale host-object wrapper "
            "(typeof === 'object' but the underlying native is gone): "
            "{state: 'live'|'dead', typeName?, error?}. "
            "Optional callFrameId targets a specific paused frame; otherwise "
            "auto-targets the top frame when paused (autoFramed:true), or "
            "evaluates in global scope while running."
        ),
        positional=("expression", "callFrameId"),
        flags=("--target",),
    ),
    VerbDef(
        "cleanup",
        "pseudo",
        "Reset pause-on-exceptions, remove session breakpoints, and tear down the daemon",
        flags=("--target", "--all", "--force"),
    ),
    VerbDef(
        "health",
        "pseudo",
        "Diagnose preview/session state — returns {session, vm, "
        "activity_since_attach, preview} so agents can disambiguate an "
        "empty console-log from idle preview / init crash / wrong target",
        flags=("--raw",),
    ),
    # ----- console: read the daemon's console-event ring buffer -----
    VerbDef(
        "console-log",
        "console",
        (
            "Read the selected target's console output as NDJSON — one JSON "
            "object per event {seq,ts,source,level,message} (+args/stack when "
            "present). `seq` is the cursor — pass the last line's `seq` back via "
            "--since for only-newer. Snapshot by default; --wait-pattern blocks "
            "until a message matches (or --timeout fires). Per-target: --target "
            "picks a preview when several are attached."
        ),
        flags=(
            "--since",
            "--wait-pattern",
            "--timeout",
            "--target",
        ),
    ),
)


# Trigger verbs — the only ones that pick up the wait flags in
# SHORTHAND_GLOBAL_FLAGS, because they can *cause* a pause or VM activity
# worth waiting on (cli._add_trigger_flags adds all four). Every other
# dispatching/inspection verb takes `--target` only — listed in its own
# `flags` tuple — since "block until the lens pauses" is meaningless for a
# verb that just reads state (backtrace, locals, …) or can't trigger one
# (remove-breakpoint).
# Canonical trigger-verb set — the single source of truth. cli.py derives its
# parser groups from this (and asserts no drift), so a new trigger verb only
# needs adding here.
WAIT_TRIGGER_VERBS: frozenset[str] = frozenset(
    {
        "eval",
        "pause",
        "resume",
        "step-over",
        "step-into",
        "step-out",
        "reload",
        "set-breakpoint",
        "pause-on-exceptions",
    }
)


def accepts_shorthand_globals(v: VerbDef) -> bool:
    return v.name in WAIT_TRIGGER_VERBS


def _verb_to_dict(v: VerbDef) -> dict[str, Any]:
    out: dict[str, Any] = {"command": v.name, "category": v.category}
    if v.cdp_method is not None:
        out["cdpMethod"] = v.cdp_method
    if v.positional:
        out["positional"] = list(v.positional)
    if v.flags:
        out["flags"] = list(v.flags)
    if accepts_shorthand_globals(v):
        out["acceptsShorthandGlobals"] = True
    if v.description:
        out["description"] = v.description
    return out


def get_verb_catalog() -> list[dict[str, Any]]:
    return [_verb_to_dict(v) for v in sorted(VERB_CATALOG, key=lambda x: x.name)]


def verb_names() -> set[str]:
    return {v.name for v in VERB_CATALOG}


_DESCRIPTION_BY_NAME: dict[str, str] = {v.name: v.description for v in VERB_CATALOG}


def description_for(name: str) -> str:
    # Single source for argparse `help=` so the subcommand list, list-commands
    # --summary, and the JSON catalog can't drift. Fuller per-verb prose lives in
    # the subparser's description=/epilog=, not here.
    return _DESCRIPTION_BY_NAME.get(name, "")


def format_verb_summary() -> str:
    sorted_verbs = sorted(VERB_CATALOG, key=lambda x: x.name)
    # Reserve a column for the `*` marker so the args/desc columns still align.
    name_width = max(len(v.name) for v in sorted_verbs) + 1
    lines: list[str] = []
    for v in sorted_verbs:
        marked = v.name + ("*" if accepts_shorthand_globals(v) else " ")
        parts: list[str] = [marked.ljust(name_width)]
        if v.positional:
            parts.append(" ".join(f"<{p}>" for p in v.positional))
        if v.flags:
            parts.append("[" + " ".join(v.flags) + "]")
        parts.append("— " + v.description)
        lines.append("  ".join(parts))
    lines.append("")
    lines.append("* also accepts: " + " ".join(SHORTHAND_GLOBAL_FLAGS))
    return "\n".join(lines)
