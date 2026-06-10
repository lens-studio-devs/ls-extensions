# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

# Per-verb `--help` epilogs. These hold the response-shape and gotcha detail that
# used to live in references/ (console-event-schema.md, response-stream.md,
# breakpoint-resolution.md failure modes) so it enters an agent's context only
# when it runs `lsdbg <verb> --help`. Wired in cli.py with RawDescriptionHelpFormatter.

CONSOLE_LOG_EPILOG = (
    """\
Output is NDJSON — one JSON object per line (parse line-by-line, not as one
document):
  """
    '{"seq":42,"ts":"2026-06-02T14:03:01Z","source":"Bug.js:31:0",'
    '"level":"error","message":"TypeError: x is not a function"}'
    """

Fields:
  seq      daemon-wide cursor; pass the LAST line's seq to --since for newer-only.
           Shared with other debug events, so values are sparse — an opaque
           cursor, not a message counter.
  ts       ISO-8601 UTC, or null when the runtime didn't stamp the event.
  source   "file.js:line:col" of the top frame; often null for plain console.log
           (Hermes attaches no stack trace) — the message text is still intact.
  level    "log" | "warn" | "error" | "info" | ...
  message  args joined with spaces, each object's description substituted;
           embedded newlines collapsed.
  args     present only when the event carried args (compacted objects, each with
           an objectId for get-properties).
  stack    present only for multi-frame stacks: [{function,url,line,col}, ...].

Snapshot vs blocking:
  Default — prints buffered events passing --since, returns immediately.
  --wait-pattern REGEX — returns synchronously if a backlog line already matches;
  otherwise blocks until one arrives or --timeout (default 30s). A match prints
  the accumulated lines ending with it; a timeout prints NOTHING. So non-empty
  output means matched, empty means timed out.

Caveats:
  - Pre-attach output is invisible — the daemon only sees events after attach. To
    capture init-time print(), set a bp on the line with --reload, then read
    console-log after the pause (init code re-runs under the debugger).
  - Per-target: with several previews attached, --target picks whose buffer to
    read (required when more than one is attached).
  - 1000-entry FIFO per target; older lines roll off. A --since cursor older than
    the oldest retained event just returns everything still buffered.
  - Thrown exceptions are NOT reported here on their own — only when the lens
    halts on the throw under `pause-on-exceptions {uncaught|all}`, which
    synthesizes an error-level line from the pause site. Uncaught host-function
    errors you didn't opt into catching stay invisible (VM limitation)."""
)

SET_BREAKPOINT_EPILOG = """\
Envelope is self-verifying — no follow-up call needed:
  breakpointId
  resolved        true|false — did the bp match a real script line? Hermes emits
                  no async breakpointResolved event, so this is the ONLY positive
                  signal. resolved:false (locations:[]) means it will never fire.
  locations[]     {scriptId, editorLine, generatedLine, columnNumber}. editorLine
                  is the source line you'll find on disk; generatedLine is the
                  compiled .js line.
  sourceLocation  {source, line, column} — present only for .ts/.tsx input;
                  echoes the source-map walk so you can confirm where it landed.
  hint/hintCode   actionable note when present (bp-unresolved, bp-init-time).

Filename resolution: pass a partial path; the daemon matches it against loaded
script URLs. Too short → "no script matching" (the error lists loaded URLs); it
matches several → "ambiguous filename" (add a parent dir). .ts/.tsx resolve
through source maps; if the build stripped them you get a no-source-map error —
set the bp on the .js path directly.

Source-map walk (.ts/.tsx): the daemon scans every parsed script's sources[]
for your file, then converts the input line to the compiled .js line. Confirm
via sourceLocation — esp. when sources[] is path-prefixed ("src/Bug.ts" vs the
"Bug.ts" you typed). A line with no executable code (blank/comment) snaps
forward up to 10 lines to the nearest mapping; nothing in that window → error.

When --wait-paused times out, the bp may still be fine. Check result.resolved:
  resolved:false → line-offset / source-map mismatch; fix the URL or line
                   (--reload won't help).
  resolved:true  → armed. Walk the causes in order:
    1. Conditional branch — if locations[0].columnNumber > 0 and the line has
       if / ?: / && / ||, the bp sits on the branch body and fires only when the
       branch runs. Move it to the next always-executed line.
    2. Init-time code (top-level / onAwake) already ran — re-issue with --reload.
    3. Async chain died upstream — Hermes drops unhandled rejections silently.
       Set a bp earlier (the first await after entry), pause, and walk forward
       inspecting shapes. pause-on-exceptions all does NOT catch rejections, only
       synchronous throws.

Line numbering: editorLine is 1-based (matches editor / grep). Breakpoint INPUT
lines are 1-based for .ts/.tsx (source-map resolved), 0-based for .js."""

EVAL_EPILOG = """\
Scope: while running, eval runs in GLOBAL scope — script-local vars inside
@component / callbacks / async fns are invisible (the result comes back undefined
with a hint). Once paused, frame-less eval auto-evaluates in the top frame so
`this` / closures resolve; the envelope carries autoFramed:true and
hintCode:auto-framed-top. Pass a callFrameId (eval-on-frame) to target another
frame.

Lossy numbers: a scalar NaN / Infinity / -0 returns as unrepresentable:"NaN".
But INSIDE an array those collapse to bare null at the VM's return-by-value
boundary before the tool sees them — an array element null may actually be NaN.
Disambiguate with Number.isNaN(...) alongside the value, or get-properties on the
array (each element survives as a RemoteObject with per-element unrepresentable).

Throwing under pause-on-exceptions: if it's armed (uncaught / all) and the eval
body throws, Hermes pauses on the throw and withholds the result until resume.
eval surfaces this as a SECOND stdout object — the compacted Debugger.paused
tagged pausedDuringEval:true, hintCode:eval-paused-on-exception. backtrace /
health to inspect, then resume. A normal eval that returns is unaffected."""

BACKTRACE_EPILOG = """\
Frames: {callFrameId, function, editorLine, generatedLine, column, asyncFrame?,
sourceLocation?}. Frames whose .ts source resolved carry sourceLocation (the
generated .js Cache URL is omitted); unresolved frames keep url."""

LOCALS_EPILOG = """\
{frameIndex, bindings, closures?, hintCode?}. bindings[0] is a synthetic `this`
(tagged synthetic:true, prepended best-effort so you can skip an eval-on-frame
"this") — absent when the this-eval failed or the frame sits above a native
helper. A frame with no own local scope (arrow / async callbacks whose live vars
are all closed-over) is not an error: bindings is [] (plus the synthetic this if
available), hintCode no-own-scope. Closed-over vars appear under closures when
Hermes exposes a closure scope; otherwise reach them with
eval-on-frame <frameId> "<var>" (frame 0 resolves closure vars even when bindings
is empty). A binding tagged state:"uninitialized" is a TDZ slot — step past its
declaration before reading the value."""

INSPECT_HOST_OBJECT_EPILOG = """\
Host-backed wrappers (SceneObject, Component, Texture, ...) keep their JS shell
alive after the native is destroyed: typeof x is still "object" and x === null is
false, but every method/property access throws "Exception in HostFunction: Object
is null". Looks like missing wiring until you probe. The probe calls
(_x).getTypeName() under the hood (present on every host wrapper, side-effect-free).

  {state, typeName?, error?} (+ autoFramed, hintCode when auto-framed):
    live    backed by a native — no lifecycle issue here.
    dead    "...Object is null"            → dangling wrapper (native destroyed,
                                              JS ref never cleared).
            "...getTypeName is not a function" → never a host wrapper at all
                                              (plain JS object / null / primitive).
    unknown introspection failed, liveness UNDETERMINED (not dead) — re-probe
            in-frame (pass a callFrameId) or cross-check with eval.

When paused, auto-targets the top frame (autoFramed:true) so this/closures
resolve and a live member can't read as dead. Pass a callFrameId to probe a
different frame. While running there's no frame: the expr evaluates in global
scope (fine for globalThis-reachable refs, useless for this/closures) — a dead
this-rooted result then rides warningCode:global-scope-this (set a bp and
re-probe in-frame)."""

HEALTH_EPILOG = """\
Live daemon → {state, session, vm, activity_since_attach, preview}; on a throw,
vm.exception_text carries the message. Pre-attach (no daemon) → {status:
"booting"|"no_session", targets?}. Branch on result.state (attached) /
result.status (pre-attach), never the exit code. --raw re-includes the
structurally-null preview fields the default omits."""

CLEANUP_EPILOG = """\
Removes session breakpoints, resets pause-on-exceptions, and tears down the
daemon. Breakpoints persist across reloads until removed; cleanup only removes
the ones THIS session tracked (bps carried over from a dead session survive).
  {daemon:"stopped", breakpointsRemoved:N}, plus optional partial-failure arrays:
    failed:[id,...]   the debugger rejected that removeBreakpoint (usually a stale
                      id Hermes already dropped). Daemon still exited cleanly.
    timedOut:[...]    a call exceeded the 2s budget (VM not responding). Same.
  Both mean "daemon stopped, these ops uncertain" — safe to proceed, re-attach on
  the next verb.
--all → {daemon:"stopped", sessions:[...]} (always, even single-target).
--force → SIGTERM/SIGKILL escape hatch for a wedged daemon. Against an
already-dead daemon, cleanup is idempotent success {alreadyGone:true}, exit 0."""

PAUSE_ON_EXCEPTIONS_EPILOG = """\
{previousState, newState} echoing the transition (CDP itself returns a bare {}).
When newState is uncaught/all a warning reminds you the VM will now HALT on
throws — resume after diagnostics, or pause-on-exceptions none to disarm. While
armed, a thrown exception synthesizes an error-level console-log line from the
pause site (Hermes won't report throws to console otherwise). Does NOT catch
unhandled Promise rejections, only synchronous throws."""
