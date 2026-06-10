<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Recovery & troubleshooting

<a id="connection-refused"></a>
## `Connection refused` / `Connection lost` — stop, do not retry

Both strings are session-fatal — **stop immediately on either** and report to
the user. The failing envelope carries `error.errorCode` + `error.recovery`
with the exact next step (`connection_refused` = the daemon died, reload the
Lens to re-create the target; `connection_lost`, code `-32002`, = the Lens
Studio host crashed or disconnected).

`Connection lost` envelopes are enriched with diagnostics so an agent can
distinguish a host crash from a transient drop (`error.recovery` branches on
`hostAlive`):

```json
{
  "ok": false,
  "error": {
    "code": -32002,
    "message": "Connection lost",
    "hostPid": 90929,
    "hostAlive": false,
    "lastEventSeq": 1247,
    "lsLogPath": "~/Library/Logs (search for Lens Studio or DiagnosticReports)"
  }
}
```

- **`hostPid`** — PID of the process that was listening on the debug port
  at attach time (macOS only via `lsof`; omitted on other platforms or
  when the lookup failed).
- **`hostAlive`** — whether that PID is still running. `false` means LS
  exited; `true` means the connection dropped but the process is still up
  (rare — usually points at a connection-layer issue, not a crash).
- **`lastEventSeq`** — the daemon-wide seq of the last debug event the
  buffer saw before the drop. Lets an agent correlate the disconnect
  with the last event it knows about; `-1` means the drop happened
  before any event landed.
- **`lsLogPath`** — platform-canonical hint at where Lens Studio crash
  logs live. The daemon does **not** read these — it's a pointer for
  the agent / user to follow up.

## Symptoms → fixes

| Symptom | First thing to try | Deep-dive |
|---|---|---|
| Bash prints `permission denied:` (no path, trailing colon) or `: command not found` when invoking lsdbg | You're invoking an empty `$LSDBG`. Don't use the env var — call the wrapper by its absolute path: `<skill-dir>/scripts/lsdbg`. | [SKILL.md#wrapper-location](../SKILL.md) |
| You're tempted to background `lsdbg attach` + poll for readiness | Don't. Call `lsdbg attach` directly — it blocks until live (30s default; `--timeout` to override). No sleep/poll needed. | [#manual-session](#manual-session) below |
| `lsdbg health` returns `{"result": {"status": "booting"}}` | A debug target exists but no live session yet (LS still coming up, or not attached). `lsdbg attach --target …` — it blocks until live — then act on the returned `state`. Distinct from `no_session` (no target at all) | [SKILL.md#diagnose-empty-console-log](../SKILL.md#diagnose-empty-console-log) |
| `lsdbg cleanup` returns `result.timedOut: [...]` alongside `daemon: "stopped"` | See cleanup section — safe to proceed; re-attach on the next verb | [#cleanup](#cleanup) below |
| `lsdbg cleanup` returns `result.failed: [id, …]` alongside `daemon: "stopped"` | See cleanup section — safe to proceed | [#cleanup](#cleanup) below |
| `lsdbg cleanup` returns `alreadyGone: true` | The daemon was already dead — this is success (exit 0); proceed | [#cleanup](#cleanup) below |
| Breakpoint "set" but never fires; `--wait-paused` times out | First: check `result.resolved` on the `set-breakpoint` envelope — `false` means line-offset / source-map mismatch. If `true`: most likely init-time code that already ran (re-issue with `--reload`), bp on a conditional branch, or async chain died upstream | `lsdbg set-breakpoint --help` |
| An `eval-on-frame` returns `type !== "object"` (often `"number"`) on an async frame | Hermes handed back a stale stack slot. Step once and re-inspect, or fall back to `locals <frameIndex>` on a parent frame | `lsdbg eval-on-frame --help` |
| `locals` returns a binding tagged `state: "uninitialized"` | TDZ slot: the binding exists in scope but the PC is before its declaration. Step past the declaration (or set the breakpoint one line later) before reading the value | `lsdbg locals --help` |
| `console-log` returns empty and you can't tell why | Call `lsdbg health` and branch on `result.state` — see the health-state table in `SKILL.md` | [SKILL.md#diagnose-empty-console-log](../SKILL.md#diagnose-empty-console-log) |
| `console-log --wait-pattern` prints nothing | The deadline expired before any matching message arrived (empty output = timed out). Call `lsdbg health` next — `healthy_running` means the Lens is fine and the pattern just didn't trigger (widen the regex / lengthen `--timeout` / re-trigger the action). Other states point at the real cause | [SKILL.md#diagnose-empty-console-log](../SKILL.md#diagnose-empty-console-log) |
| `lsdbg health` returns `preview.playing: "unknown"` | Probe unavailable on this LS build (e.g. v5.22+) **or** the probe-read eval collapsed. `result.state` is still authoritative — `vm_responsive: true` flips it to `healthy_running` via the Date.now() fallback even when `playing` can't be measured | [SKILL.md#diagnose-empty-console-log](../SKILL.md#diagnose-empty-console-log) |
| `console-log` is empty even though the Lens prints things | Pre-attach output is invisible. Set a bp on the print line with `--reload` and read `console-log` after pause | `lsdbg console-log --help` |
| `console-log --since <number>` skips older lines you expected | The 1000-entry FIFO rolled past that number (the events aged out). Re-fetch sooner / pass a more recent `--since` to avoid the gap | `lsdbg console-log --help` |
| An `editorLine` disagrees by one with a count you did by hand | `editorLine` is 1-based; you're likely counting 0-based, or comparing against a `.js` breakpoint *input* line (0-based). Trust `editorLine` for editor/grep comparison | `lsdbg set-breakpoint --help` |
| Later `--wait-paused` hangs although you saw the Lens pause | The pause already fired during an earlier verb's roundtrip and was discarded (it does not get replayed onto the next connection). Use `--wait-paused` on the **same** command that triggers the pause (`set-breakpoint --reload --wait-paused`, `resume --wait-paused`, etc.) | [SKILL.md#response--failure-contract](../SKILL.md) |

<a id="manual-session"></a>
## Manual session: `attach`

Manual `attach` is for explicit control (multiple targets, scripting, debugging the daemon itself).
See [SKILL.md](../SKILL.md) for the core rule (blocks until live; shorthand auto-attaches).

Two call shapes:

    lsdbg attach                              # auto-pick when there's exactly one target
    lsdbg attach --target "Preview 1"         # target title or raw id (pre-attach `health` lists them)

`--timeout 45s` / `--timeout 5s` overrides the 30s default.
`preview_idle` counts as live — attach never blocks on the user pressing Play.
If already attached to a *different* target, it errors with `run 'lsdbg cleanup' first`
— it never silently hijacks the existing daemon.

The daemon **survives stdin EOF** and persists across processes — any subsequent `lsdbg` from a new
agent reuses the live session transparently; nothing to re-discover by hand.

<a id="cleanup"></a>
## Cleanup: end of session

Breakpoints **persist across reloads** until removed, and `pause-on-exceptions`
stays wherever you last set it. The daemon also keeps an event buffer (up to
1000 entries) feeding `backtrace`/`health`/the wait scans, cleared only when
the daemon dies. At session end:

    lsdbg cleanup                # remove session breakpoints, reset pause-on-exceptions, tear down daemon
    lsdbg cleanup --all          # same, across every attached session → {daemon, sessions:[...]}
    lsdbg cleanup --force        # escape hatch: SIGTERM/SIGKILL the daemon, no graceful teardown

The daemon tracks breakpoint IDs as they're set (via `set-breakpoint`) and
discards them on `remove-breakpoint`. `cleanup` only removes those it knows
about — breakpoints carried over from a prior dead session are *not* tracked
and survive. The daemon shuts down unconditionally so the event buffer
doesn't bleed stale script-parsed / console noise into the next session.

Response shape (single target): `{daemon: "stopped", breakpointsRemoved: N}`,
with two optional arrays that surface partial failure:

- `failed: [id, …]` — the debugger returned an error for that `removeBreakpoint`
  (most often a stale id Hermes had already dropped). The daemon still exited
  cleanly.
- `timedOut: [...]` — the debugger took longer than the per-call 2-second budget
  (target VM stopped responding mid-reload / post-crash). Daemon still exited.

Both arrays mean "the daemon stopped, but these specific ops are uncertain" —
safe to proceed; re-attach on the next verb. `cleanup --all` returns
`{daemon: "stopped", sessions: [...]}` — one entry per session, **always**,
even with a single target. And against an already-dead daemon, `cleanup`
reports idempotent success `{daemon: "stopped", alreadyGone: true}` (exit 0),
not a connection error — so teardown never false-fails.

<a id="wedged-daemon"></a>
## Recovering from a wedged daemon

If `lsdbg cleanup` returns `Timed out waiting for response from lsdbg session`
on stderr (or any other verb does), the daemon is alive but stuck in a debug
roundtrip — the VM stopped responding. **Don't `pkill Lens Studio`.**
Instead:

    lsdbg cleanup --force        # SIGTERM the daemon, escalate to SIGKILL after 1s

`--force` skips the graceful teardown entirely — it reads the daemon PID from session
metadata, signals it directly, and unlinks the socket + metadata files so the
next verb spawns a fresh daemon. The response is
`{detached: true, killed: true|false, pid, method}` where `method` is the
signal that took (`SIGTERM` / `SIGKILL` / `TerminateProcess` on Windows). If
`killed: false` came back with exit code 1, the process is owned by a
different user or otherwise unkillable — fall back to `kill -9 <pid>` (the
PID is in the stderr message).

<a id="stale-build-auto-respawn"></a>
## Stale-build auto-respawn

The daemon stamps its build ID into session metadata at startup. On a plugin
upgrade, an existing daemon keeps the old code in memory and would reject new
verbs with `unknown command: …`. The CLI detects the mismatch on every
shorthand invocation, tears the old daemon down, and spawns a fresh one
transparently — this is visible as one info line on stderr noting that any
session-scoped state (breakpoints, pause-on-exceptions) was reset.

If you see `unknown command: …` after an upgrade, the auto-respawn should
have already kicked in — run `lsdbg cleanup` and retry. If the error
persists, the auto-restart logic in `auto_session.py` couldn't detect the
version mismatch (rare).
