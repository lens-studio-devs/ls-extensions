---
name: lens-log-analysis
description: Lens Studio log format, severity prefixes, and how to interpret RunAndCollectLogsTool's inline result fields. Use when analyzing logs, debugging compilation failures, or reading preview runtime output.
user-invocable: true
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Lens Studio Log Analysis

## TL;DR

`RunAndCollectLogsTool` returns parsed log content **inline** in its result object. You do NOT slice the file with `awk` for normal use — the tool already did the settle-window wait and the severity-filtered partition for you.

```
result = RunAndCollectLogsTool(…)
# Read directly:
result.errors      // array of E/F/W lines, deduped, with (×N) repeat counts
result.prints      // array of script log output (captures print() and console.log/info/warn/error/debug, framed by [Preview N])
result.tail        // ≤16KB chronological D/I context (JS stack traces live here)
result.firstActivityAtMs  // null = lens never ran (strong signal)
```

If `errors` is empty AND `prints` is non-empty AND `firstActivityAtMs` is non-null → **the Lens ran cleanly**. Ship it.

`logFile` and `byteOffset` are always also returned — keep them around for the rare cases where you need to slice older content yourself (see "Fallback" at the bottom). (See Key rules — never `Read` the file directly.)

## Key rules

- **Never `Read` the LS log file directly.** Logs routinely exceed 256 KB and `Read` will reject them. The tool's inline `errors`/`prints`/`tail` fields are the supported path; `Bash awk` is the supported fallback.
- **`RecompileTypeScriptTool: succeeded` does NOT mean the Lens runs.** A scene that crashes at runtime (missing assets, unwired `@input`, runtime exceptions) still returns `succeeded` from Recompile. Always follow with `RunAndCollectLogsTool` and check `errors` + `firstActivityAtMs`.
- **Compile-time TS errors do NOT show up in `errors`.** They're logged at debug level. If `RecompileTypeScriptTool` returned `status: "failed"`, read its own `errors` array directly and stop — do not call `RunAndCollectLogsTool`.
- **`errors` already includes W (warning).** LS surfaces fatal-in-effect diagnostics like `Cannot find asset:` and `Input X was not provided` at W level. The tool partitions on `^[CEWF]` — you do not need to grep further.
- **JS stack traces are in `tail`, not `errors`.** Look for `Stack trace:` followed by `<frame>@<file>:<line>:<col>` lines. The `errors` entry contains the message; `tail` has the frames.
- **`errors[]` rendered timestamp is the first occurrence's.** Under `(×N)` dedup the line head keeps the timestamp of the first firing, not the latest. If you need exact per-firing timing, fall back to `logFile` + `byteOffset`.

## Workflow

1. **Compile first.** Call `RecompileTypeScriptTool`. On `status: "failed"`, read its `errors` and stop.
2. **Run.** Call `RunAndCollectLogsTool` with default settle parameters. Returns the inline result above.
3. **Read fields, in order:**
   - `errors.length > 0` → there are runtime problems. The original level prefix (`E`/`W`/`F`) is at the head of each line so severity is visible inline. Diagnose using "Common error patterns" below.
   - `errors.length == 0 && prints.length > 0` → the Lens ran cleanly. Ship.
   - any empty-result scenario (`firstActivityAtMs == null`, or both arrays empty) → see "Diagnose empty results" below.
4. **`tail` is for context** — chronological D/I-level lines around the activity, with errors/prints already stripped. Use it when you need to see what the engine was doing right before a crash, or to find a JS stack trace's frames.

## Diagnose empty results

When `errors` and `prints` are both empty after a `succeeded` recompile, work this checklist in order:

| Symptom | Diagnosis | Fix |
|---|---|---|
| `firstActivityAtMs: null` | The Lens never started — engine never saw any post-reset activity from your script. | Script not attached to a SceneObject, OR script crashed in module-init before `onAwake`. Check the script is wired to a ScriptComponent and recompile. |
| `firstActivityAtMs` is set, both empty | Script ran but didn't print and didn't error. | Either the script genuinely has no `console.log`/`print()` calls AND no errors (rare for an early-build), OR there's a TS compile error that `RecompileTypeScriptTool` missed (re-run it). |
| `errors` contains `Lens has been reset more than \d+ times in a row` | Reset loop — the script crashes on every load. | Look at `errors` for the actual crash; usually a `TypeError` or missing-asset error appears alongside. |
| `errors` contains `Cannot find asset:` | Built-in or referenced asset doesn't exist. | The path passed to `requireAsset` doesn't resolve. Check spelling and that the file is on disk. |
| `errors` contains `Input X was not provided` | Unwired `@input` declaration referenced before binding. | Either set the `@input` via the inspector, or remove the reference and use `requireAsset` instead. |

## Common error patterns

| In | Pattern | Meaning |
|---|---|---|
| `errors` | `^E .*TypeError: …` | JS runtime — null/undefined access. Stack trace in `tail`. |
| `errors` | `^E .*ReferenceError: …` | JS runtime — undeclared identifier. |
| `errors` | `^W .*Cannot find asset:` | Missing asset path. Fatal-in-effect. (See "Diagnose empty results" for fix.) |
| `errors` | `^W .*Input \w+ was not provided` | Unwired `@input`. (See "Diagnose empty results" for fix.) |
| `errors` | `^E .*Lens has been reset more than \d+ times` | Reset loop — script throws on every onAwake. (See "Diagnose empty results" for fix.) |
| `tail` | `Stack trace:` followed by `@…:N:N` lines | JS stack frames. The first `@…/Assets/…/X.ts:N:N` line is the user-script source location. |

## Tuning the settle window

Defaults (`settleMinMs: 600, settleQuietMs: 200, settleMaxMs: 1500`) work for most Lenses. Only override when:

| Situation | Override |
|---|---|
| Script has a long async `onAwake` (e.g. waits for a remote fetch before printing) | `settleMaxMs: 5000` and raise `settleQuietMs` past the longest expected gap between prints. |
| Script prints every frame (continuous-print) | The settle window will always run to `settleMaxMs`; lower `settleMaxMs` if you don't need that much context. |
| You only need the reset signal, no settle | `settleQuietMs: 0` returns immediately at the reset boundary. Faster, but `onAwake`/`onStart` errors and prints will be missed. |

## When content was capped

| Flag | Means | Read |
|---|---|---|
| `errorsCapped: true` | More than 300 distinct error lines existed. The first 300 are returned (dedup counts still cover all occurrences of those 300). | Earlier errors in the slice. For more, fall back to the file. |
| `printsCapped: true` | More than 200 print lines existed. The first 200 are returned. | Earlier prints in the slice. For more, fall back to the file. |
| `truncated: true` | Any of: `errorsCapped`, `printsCapped`, the ~256 KB head cap, or the ≤16 KB `tail` cap. | The summary flag — check the specific flags above to know which cap hit. |
| `rotated: true` | LS rotated the log between calls; `byteOffset` was reset. | The slice may start mid-stream from the rotation point. |

## Fallback: slicing the file directly

For content beyond the inline caps, or to inspect history older than the current `byteOffset`, slice with `Bash awk` rather than `Read`:

```bash
awk -v off="$BYTE_OFFSET" 'BEGIN{b=0}{b+=length($0)+1;if(b>=off)print}' "$LOG_FILE" \
  | grep -E '^[CEWF] |\[Preview '
```

## Log format (reference)

Each line: `<LEVEL> <HH:MM:SS.mmm> <source_file>:<line> (<@thread>) <function>] <message>`

| Prefix | Severity | Goes to |
|---|---|---|
| `F` / `C` | Fatal / Critical (rare) | `errors` |
| `E` | Error — also where `console.error` lands | `errors` |
| `W` | Warning (fatal-in-effect surfaces here; also where `console.warn` lands) | `errors` |
| `I` | Info — includes script log output (`print()`, `console.log/info/debug`) framed by `[Preview N]` | `prints` (if framed) / `tail` |
| `D` | Debug — includes "TypeScript is not compiled" diagnostic | `tail` |

Example raw line: `E 14:32:01.456 PreviewWorker.cpp:519 (@Es::Preview::PreviewWorker) processFrame] TypeError: Cannot read property 'x' of null`
