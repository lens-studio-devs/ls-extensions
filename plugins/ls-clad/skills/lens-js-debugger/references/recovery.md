<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Recovery & troubleshooting

<a id="connection-refused"></a>
## `Connection refused` / `Connection lost` — stop, do not retry

Both strings are session-fatal — **stop immediately on either** and report to the user. The failing
envelope's `error.errorCode` + `error.recovery` carry the exact next step (`connection_refused` = the
daemon died, reload the Lens to re-create the target; `connection_lost`, code `-32002`, = the Lens
Studio host crashed or disconnected).

`Connection lost` is enriched so an agent can tell a host crash from a transient drop —
`error.recovery` branches on `hostAlive` (`false` = LS exited; `true` = process up but connection
dropped, rare). `lastEventSeq` is the daemon-wide seq of the last event before the drop, for
correlation (`-1` = dropped before any event):

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

## Symptoms → fixes

| Symptom | First thing to try | Deep-dive |
|---|---|---|
| Bash prints `permission denied:` (no path, trailing colon) or `: command not found` when invoking lsdbg | You're invoking an empty `$LSDBG`. Don't use an env var — call the wrapper by absolute path: `<skill-dir>/scripts/lsdbg`. | [SKILL.md#wrapper-location](../SKILL.md#wrapper-location) |
| You're tempted to background `lsdbg attach` + poll for readiness | Don't. `attach` already blocks until the session is live (default 30s, `--timeout` to override) and returns `{attached, targetId, state}` — call it directly as the gate | [#manual-session](#manual-session) below |
| `lsdbg health` returns `{"result": {"status": "booting"}}` | A target exists but no live session yet (LS still coming up, or not attached). `lsdbg attach --target …` — it blocks until live — then act on the returned `state`. Distinct from `no_session` (no target at all) | [SKILL.md#diagnose-empty-console-log](../SKILL.md#diagnose-empty-console-log) |
| `lsdbg cleanup` returns `result.timedOut: [...]` or `result.failed: [...]` alongside `daemon: "stopped"` | Some teardown ops couldn't reach the VM / were rejected (often a stale bp), but the daemon exited. Safe to proceed — re-attach on the next verb | [#cleanup](#cleanup) below |
| `lsdbg cleanup` returns `alreadyGone: true` | The daemon was already dead — nothing to tear down. Success (exit 0), not a failure; proceed | [#cleanup](#cleanup) below |
| Breakpoint "set" but never fires; `--wait-paused` times out | Check `result.resolved` on the `set-breakpoint` envelope — `false` means line-offset / source-map mismatch. If `true`: most likely init-time code that already ran (re-issue with `--reload`), a conditional branch, or an async chain that died upstream | `lsdbg set-breakpoint --help` |
| An `eval-on-frame` returns `type !== "object"` (often `"number"`) on an async frame | Hermes handed back a stale stack slot. Step once and re-inspect, or fall back to `locals <frameIndex>` on a parent frame | `lsdbg eval-on-frame --help` |
| `locals` returns a binding tagged `state: "uninitialized"` | TDZ slot: the binding exists but the PC is before its declaration. Step past the declaration (or set the bp one line later) before reading | `lsdbg locals --help` |
| `console-log` returns empty and you can't tell why | Call `lsdbg health` and branch on `result.state` | [SKILL.md#diagnose-empty-console-log](../SKILL.md#diagnose-empty-console-log) |
| `console-log --wait-pattern` prints nothing | The deadline expired before a match (empty = timed out). Call `lsdbg health` — `healthy_running` means the Lens is fine and the pattern just didn't trigger (widen the regex / lengthen `--timeout` / re-trigger) | [SKILL.md#diagnose-empty-console-log](../SKILL.md#diagnose-empty-console-log) |
| `lsdbg health` returns `preview.playing: "unknown"` | Probe unavailable on this LS build (e.g. v5.22+) or the probe-read collapsed. `result.state` is still authoritative — `vm_responsive: true` flips it to `healthy_running` even when `playing` can't be measured | [SKILL.md#diagnose-empty-console-log](../SKILL.md#diagnose-empty-console-log) |
| `console-log` is empty even though the Lens prints things | Pre-attach output is invisible. Set a bp on the print line with `--reload` and read `console-log` after pause | `lsdbg console-log --help` |
| `console-log --since <number>` skips older lines | The 1000-entry FIFO rolled past that seq (events aged out). Re-fetch sooner / pass a more recent `--since` | `lsdbg console-log --help` |
| Later `--wait-paused` hangs although you saw the Lens pause | The pause already fired during an earlier verb's roundtrip and was discarded (not replayed). Use `--wait-paused` on the **same** command that triggers the pause | [SKILL.md#cross-cutting-rules](../SKILL.md#cross-cutting-rules) |

<a id="manual-session"></a>
## Manual session: `attach`

Shorthand verbs auto-attach transparently; manual `attach` is for explicit control (multiple targets,
scripting, debugging the daemon itself). It's one call — no backgrounding, no polling — and **blocks
until the session is genuinely live** (default 30s, `--timeout 45s` / `5s` to override). `preview_idle`
counts as live; it never blocks on the user pressing Play.

    lsdbg attach                              # auto-pick when there's exactly one target
    lsdbg attach --target "Preview 1"         # target title or raw id (pre-attach `health` lists them)

If a session is already attached to that same target, it's a no-op success. If it's attached to a
*different* target, it errors with `run 'lsdbg cleanup' first` — never silently hijacks. The daemon
survives stdin EOF and persists across processes, so a later `lsdbg` from any new agent reuses the
live session transparently.

<a id="cleanup"></a>
## Cleanup: end of session

`cleanup` removes session breakpoints, resets pause-on-exceptions, and tears down the daemon (base
shape in `lsdbg cleanup --help`). Recovery-relevant detail:

    lsdbg cleanup                # this session
    lsdbg cleanup --all          # across every attached session → {daemon, sessions:[...]}
    lsdbg cleanup --force        # escape hatch for a wedged daemon (see below)

- Breakpoints **persist across reloads** and are only removed if `cleanup` tracked them (a bp carried
  over from a prior dead session is *not* tracked and survives).
- `failed: [id, …]` / `timedOut: [...]` arrays mean "the daemon stopped, but these specific ops are
  uncertain" (stale id Hermes already dropped / VM stopped responding mid-reload) — safe to proceed,
  re-attach on the next verb.
- Against an already-dead daemon, `cleanup` reports idempotent success
  `{daemon: "stopped", alreadyGone: true}` (exit 0), not a connection error — teardown never
  false-fails.

<a id="wedged-daemon"></a>
## Recovering from a wedged daemon

If a verb returns `Timed out waiting for response from lsdbg session` on stderr, the daemon is alive
but stuck in a debug roundtrip — the VM stopped responding. **Don't `pkill Lens Studio`.** Instead:

    lsdbg cleanup --force        # SIGTERM the daemon, escalate to SIGKILL after 1s

`--force` skips graceful teardown — it reads the daemon PID from session metadata, signals it
directly, and unlinks the socket + metadata files so the next verb spawns a fresh daemon. Response:
`{detached: true, killed: true|false, pid, method}` (`method` = the signal that took). If
`killed: false` with exit code 1, the process is owned by another user / unkillable — fall back to
`kill -9 <pid>` (the PID is in the stderr message).

<a id="stale-build-auto-respawn"></a>
## Stale-build auto-respawn

The daemon stamps its build ID into session metadata at startup. After a plugin upgrade an existing
daemon keeps the old code in memory and would reject new verbs with `unknown command: …`. The CLI
detects the mismatch on every shorthand invocation, tears the old daemon down, and spawns a fresh one
(one info line on stderr noting that session-scoped state — breakpoints, pause-on-exceptions — was
reset).

If `unknown command: …` persists after an upgrade, the auto-respawn in `auto_session.py` couldn't
detect the version mismatch (rare) — run `lsdbg cleanup` and retry.
