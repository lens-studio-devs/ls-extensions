# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import asyncio
from collections import deque
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Optional

from .console_events import ConsoleEvent, FilterSpec

if TYPE_CHECKING:
    pass

MAX_BUFFERED_EVENTS = 1000
DEFAULT_WAIT_TIMEOUT_MS = 30000
# console-log default blocking deadline when --wait-for-* is set but
# --timeout isn't. Same value as DEFAULT_WAIT_TIMEOUT_MS so the agent's
# mental model ("verbs block at most 30s by default") stays uniform.
DEFAULT_CONSOLE_LOG_TIMEOUT_S = 30.0


# Verbatim from LocalSocketServer.cpp — agents key off this exact wording.
SET_BREAKPOINT_HINT = "If targeting init-time code (onAwake, top-level), add --reload flag — that code already ran."

# Surfaced when Debugger.setBreakpointByUrl returns an empty `locations` array.
# Hermes doesn't emit Debugger.breakpointResolved, so `locations` is the only
# synchronous signal the bp actually matched a script line — empty means it
# never will. Wording is agent-targeted, hence the explicit base hint.
SET_BREAKPOINT_UNRESOLVED_HINT = (
    "Breakpoint accepted but did not resolve to any script line "
    "(locations: []) — likely a line-offset / source-map mismatch. "
    "For .ts/.tsx, the line number is 1-based and resolved via source maps; "
    "for .js, it's 0-based and matches CDP directly."
)

# Surfaced on remove-breakpoint when the id wasn't set by this session, so the
# daemon can't confirm Hermes ever held it — the id is most likely stale.
REMOVE_BREAKPOINT_UNTRACKED_HINT = (
    "This breakpoint id was not set by the current session, so the daemon can't "
    "confirm Hermes actually had it — the id is probably stale (e.g. carried over "
    "from a prior session). The removal still returned ok."
)


# Stable string codes that ride alongside the prose `hint` so agents can
# branch on `hintCode` instead of substring-matching the message. Add new
# codes here as new hints are introduced; never reuse a code for a
# different concept.
HINT_CODE_BP_INIT_TIME = "bp-init-time"
HINT_CODE_BP_UNRESOLVED = "bp-unresolved"
HINT_CODE_BP_NOT_TRACKED = "bp-not-tracked"
HINT_CODE_LOCALS_EMPTY = "locals-empty"
HINT_CODE_LOCALS_ALL_TDZ = "locals-all-tdz"
HINT_CODE_LOCALS_NO_OWN_SCOPE = "no-own-scope"
HINT_CODE_WAIT_TIMEOUT_LATE_EVENT = "wait-timeout-late-event"
HINT_CODE_ASYNC_STEPPER_FRAME = "async-stepper-frame"
HINT_CODE_EVAL_NATIVE_FRAME_BELOW = "eval-native-frame-below"
HINT_CODE_AUTO_FRAMED = "auto-framed-top"
# Rides on the Debugger.paused event emitted when an `eval` body throws while
# pause-on-exceptions is armed: the pause is the eval's own throw, not an
# unrelated breakpoint. Agent should `backtrace`/`health`, then `resume`.
HINT_CODE_EVAL_PAUSED_ON_EXCEPTION = "eval-paused-on-exception"
# Emitted as `warningCode` (not `hintCode`) on inspect-host-object when a `this`
# read resolves in global scope; named WARNING_CODE_* to match its use.
WARNING_CODE_GLOBAL_SCOPE_THIS = "global-scope-this"

# NOTE: `async-stepper-frame` and `auto-framed-top` carry hintCode only — the
# prose explanation lives in the skill docs (keyed by code), so eval/
# inspect-host-object responses stay terse. The async-stepper code is now
# attached only when the expression actually reads `this` (see daemon_commands).

# Attached when a global-scope eval/probe (VM not paused, or no frames) reads
# a `this`-rooted expression and comes back dead/undefined — the classic
# false-negative the auto-framing can't fix while the VM is running.
GLOBAL_SCOPE_THIS_WARNING = (
    "evaluated in global scope; `this` is globalThis, not the component — a "
    "live component member can read as undefined/dead here. Pause at a "
    "breakpoint (or pass a callFrameId) to inspect in-frame."
)

# Refused before dispatch — Hermes asserts (Environment::slot OOB) and
# aborts the process if we forward the eval. Crash signature:
# `Debugger::evalInFrame` → `getScopingInfo` reads the interposed native
# frame's saved IP, hands back a scoping index that doesn't match the
# live Environment chain, and the compiled eval bytecode reads a slot
# index >= environment size.
EVAL_NATIVE_FRAME_BELOW_MSG = (
    "eval-on-frame refused: target frame sits above one or more native "
    "(generator/promise) helper frames in Hermes' interpreter stack, "
    "and evaluating there crashes Lens Studio with an Environment::slot "
    "assertion. Use frame 0 (topmost) for eval, or read locals / "
    "get-properties on this frame instead."
)


@dataclass
class _TaggedEvent:
    seq: int
    data: dict[str, Any]


@dataclass
class TargetSession:
    target_id: str = ""
    target_title: str = ""
    page_session_id: str = ""
    attached_at_iso: str = ""

    # Raw CDP event ring buffer + seq counter. Feeds backtrace/locals/health
    # (last Debugger.paused) and the --wait-paused / --wait-idle event scans.
    event_buffer: deque = field(default_factory=lambda: deque(maxlen=MAX_BUFFERED_EVENTS))
    next_seq: int = 0

    # Persistent scriptId -> (url, sourceMapURL), accumulated from every
    # Debugger.scriptParsed. event_buffer is a bounded ring buffer, so the
    # attach-time scriptParsed flood would otherwise roll out under later
    # console/pause traffic — silently dropping script URLs that stack
    # traces, breakpoint resolution, and locals inspection depend on. Never
    # evicted; growth is bounded by total scripts parsed this session.
    parsed_scripts: dict[str, tuple[str, str]] = field(default_factory=dict)

    # Compacted console FIFO. Rolls at MAX_BUFFERED_EVENTS; `console-log`
    # reads it (filtered by `--since`) and renders one line per event.
    console_buffer: deque = field(default_factory=lambda: deque(maxlen=MAX_BUFFERED_EVENTS))

    # BP IDs set this session — `cleanup` walks them on teardown.
    tracked_breakpoints: set = field(default_factory=set)

    # CDP's default pre-call value. Tracked so `pause-on-exceptions` can
    # echo `previousState` and surface the side-effect to agents.
    pause_on_exceptions_state: str = "none"

    # Source-map cache for .ts/.tsx breakpoint resolution, keyed by
    # (script_url, sourceMapURL). Each map is parsed once per daemon
    # lifetime.
    source_map_cache: dict = field(default_factory=dict)

    # Health-verb bookkeeping — counters + ISO-8601 timestamps bumped on
    # each matching event so `health` is O(1).
    console_events_seen: int = 0
    exceptions_seen: int = 0
    debugger_pauses_seen: int = 0
    last_console_ts: Optional[str] = None
    last_exception_ts: Optional[str] = None
    last_script_parsed_ts: Optional[str] = None
    last_pause_ts: Optional[str] = None

    # Execution-context lifecycle for this page session. "unknown" until
    # the first Runtime.executionContext{Created,Destroyed,sCleared} event;
    # some VMs don't emit on first attach so we can't assume "alive".
    execution_context_state: str = "unknown"

    # JS-side frame probe install state. Re-armed on
    # Runtime.executionContextCreated so a JS-only reload doesn't strand
    # `health.preview.playing` at the previous context's value.
    probe_installed: bool = False
    probe_install_error: Optional[str] = None


@dataclass
class _WaitState:
    method: str
    timer_task: asyncio.Task[None]
    # Buffer cursor at the moment we entered wait mode. Lets `_wait_timeout`
    # re-check the buffer just before emitting the timeout error: if the
    # event arrived between the timer firing and the cleanup running (the
    # `waitFor timed out` race observed live), emit the matched event
    # instead, so the agent gets the pause it asked for rather than a
    # spurious timeout.
    since_seq: int = 0


@dataclass
class _WaitIdleState:
    idle_threshold_ms: int
    idle_timer_task: asyncio.Task[None]
    hard_deadline_task: asyncio.Task[None]
    events_observed: int = 0
    started_monotonic: float = 0.0
    last_event_monotonic: float = 0.0


@dataclass
class _BlockingLogState:
    spec: FilterSpec
    wait_for_pattern: Optional[Any]  # re.Pattern but typed Any to avoid the import
    caller_id: Any
    accumulated: list[ConsoleEvent] = field(default_factory=list)
    deadline_task: Optional[asyncio.Task[None]] = None
