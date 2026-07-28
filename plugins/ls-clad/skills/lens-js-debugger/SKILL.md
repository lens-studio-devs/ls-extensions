---
name: lens-js-debugger
description: Debug a running JS Lens. Use when you need to evaluate expressions, set breakpoints, pause/resume execution, or inspect runtime state in a Lens Studio preview or on a Specs device.
user-invocable: true
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Lens JS Debug — Quick Reference

The grammar lives in the CLI: **`lsdbg list-commands --summary`** is the authoritative verb list
(no session needed), and **`lsdbg <verb> --help`** carries each verb's response shape + gotchas.
Failures self-describe — branch on `error.errorCode` / `error.recovery`; a successful-but-caveated
result carries `hint` / `hintCode`.

<a id="wrapper-location"></a>
The CLI wrapper is `<skill-dir>/scripts/lsdbg`. Run it once with `install-link` to put a bare `lsdbg`
on `$PATH` (the examples assume that); until then, invoke by absolute path. **Never** stash the path
in a shell variable — each Bash call is a fresh shell, so `$LSDBG` comes back empty.

## Happy path (single preview)

Most bugs need exactly this loop:

    lsdbg attach                                         # readiness gate; blocks until live
    lsdbg console-log                                    # did the repro print / throw?
    lsdbg set-breakpoint "Bug.ts" 14 --reload --wait-paused
    lsdbg eval "this.speed"                              # paused → auto-frames the top frame
    lsdbg resume                                         # → {"ok": true}
    lsdbg cleanup --all                                  # tear down when done

`attach` **is** the readiness gate — it blocks through a cold boot until the VM is live, then returns
`{attached, targetId, state}`. Do not hand-roll `sleep`/poll loops. Shorthand verbs auto-attach in
the single-target case, so explicit `attach` is only needed to pre-warm or to pick among multiple
targets (`--target "<title>"`, or a pre-attach `health` to list them).

## When to use

- A **JavaScript Lens** (SnapHermes / Hermes VM) where you must evaluate expressions, set
  breakpoints, step, or inspect runtime state — and the bug only reproduces while **running**
  (init crash, missing-`await`, callback wiring, runtime data shape).
- **Profiling JS CPU hot spots** in a running lens (`profile-start` / `profile-stop` →
  self-time-ranked hot functions) when the lens is slow or janky.

**Not for:** C++ runtime / non-JS scripting (the JS debugger can't reach those); pure static
analysis (read the source instead).

## Gotchas that bite first

- **Init-time breakpoints need `--reload`** — `onAwake` / top-level code already ran before attach
  (`set-breakpoint --help`).
- **Exceptions are invisible to `console-log` until you opt in** — `pause-on-exceptions
  {uncaught|all}`; only catches synchronous throws, not Promise rejections (`pause-on-exceptions
  --help`).
- **`eval` is global scope while running** — vars inside `@component` / callbacks / async fns are
  invisible. Once paused, frame-less `eval` / `inspect-host-object` auto-frame the top frame (envelope
  carries `autoFramed: true`); pass a `callFrameId` from `backtrace` to target another frame
  (`eval --help`).
- **Async frames** — `this` is the Hermes stepper closure, not the component (a member reads as
  `undefined`, masquerading as missing wiring).
- **Synthetic taps** can't be dispatched from the debugger — if the lens-studio MCP is enabled use
  its `InjectPreviewGesture`, else `eval` the bound handler as a standalone function, else ask the
  user to interact (then confirm the pause with `health`).

<a id="cross-cutting-rules"></a>
## Cross-cutting rules (not in any single `--help`)

- **One JSON envelope per verb** on stdout; exit `0` on `ok:true`, `1` on `ok:false` — branch on the
  envelope, not the exit code. **`console-log` is the exception**: NDJSON, one event per line.
- **Wait flags (`--wait-paused`) ride the same command that triggers the pause** (the `*`-marked verbs
  in `--summary`). A follow-up `--wait-paused` hangs — the pause already fired and isn't replayed.
  `--wait-paused` emits **two** stdout objects: the command envelope, then the compacted
  `Debugger.paused` — read the second for the pause site. Passing a wait flag to an inspection verb or
  `health` is a hard error.
- **Multi-target:** the daemon multiplexes N previews; every dispatching verb takes `--target
  "<title>"` (or raw id). With several attached and no `--target`, the call is refused with
  `error.errorCode == "multiple_targets"` (+ `error.targets`). `console-log` is per-target; `health`
  is daemon-wide.
- **Read `editorLine`** (1-based, matches editor / `Read` / grep / IDE gutters) wherever a line
  appears. Breakpoint *input* line semantics (1-based `.ts`/`.tsx`, 0-based `.js`) are in
  `set-breakpoint --help`.

<a id="diagnose-empty-console-log"></a>
## Diagnose an empty `console-log` / a pause that never fired

`health`'s `result.state` collapses the "why nothing happened" outcomes — read it first:

| `state` | What's true | Next step |
|---|---|---|
| `paused` | halted at a breakpoint or throw | read `vm.pause_reason` / `vm.exception_text`; `backtrace` / `locals` / `eval-on-frame`, then `resume` |
| `init_throw` | threw in `onAwake` / top-level | read `activity_since_attach.last_exception_ts`; fix init code |
| `healthy_running` | VM alive and executing; the watched path just isn't running | widen the breakpoint, add a `console.log`, or `eval` |
| `preview_idle` | user hasn't pressed Play (or hit end-of-timeline) | ask the user to press Play, or `reload` |
| `wrong_target` | stale / torn-down session | re-attach |
| `ambiguous` | no positive nor negative signal | wait briefly, re-call `health`; if still ambiguous, escalate |

Pre-attach (no daemon), `health` answers with `result.status`: `booting` (LS coming up / not attached)
vs `no_session` (LS not running or no Lens). Derivation is canonical in `_derive_health_state`
(`tools/lsdbg/daemon_commands.py`).

## Deep dives

- **Per-verb response shapes, recipes, gotchas** → `lsdbg <verb> --help`
- **Recovery** — wedged daemon, cleanup partial-failure, symptom → fix matrix →
  [references/recovery.md](references/recovery.md)
