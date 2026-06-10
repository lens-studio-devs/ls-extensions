<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Harness contract — frameMarkers extension

`/specs-lens-perf-optimize` extends the project's existing `PerfAttributionHarness` (installed by `/specs-lens-perf-attribution` — see its `references/lens_simulation_harness.md`) with a small **reversible** addition: a `frameMarkers` array of named time offsets that fire deterministic `print(...)` lines so the orchestrator can capture screenshots at consistent moments.

This file describes:

1. What the extension looks like.
2. Where it's added and how it's removed.
3. Why it's safe to skip projects that don't have the base harness.

## The extension

The existing harness is a `ScriptComponent` named `PerfAttributionHarness` with `@input enabledForProfiling: boolean` and a `fire()` method that triggers a target script's method. `/specs-lens-perf-attribution` documents the skeleton at `Assets/Scripts/Profiling/PerfAttributionHarness.ts`.

The orchestrator appends three things to the existing class (between an explicit start and end marker comment, so the removal step can find them exactly):

```ts
  // <perf-optimize-frame-markers BEGIN>
  @input frameMarkerNames: string[] = ["idle", "interaction", "climax"];
  @input frameMarkerOffsetsSeconds: number[] = [2.0, 5.0, 8.0];

  private _markerEvents: DelayedCallbackEvent[] = [];

  private scheduleFrameMarkers(): void {
    // Guard on `=== false`, not `!`: on an older harness without the
    // `enabledForProfiling` input the property reads `undefined`, and `!undefined`
    // would wrongly skip the markers. `=== false` only suppresses them when the
    // input is explicitly off, so an older harness still fires markers. The
    // `(this as any)` cast is required so this reference still COMPILES on an
    // older harness class that doesn't declare the field (otherwise TS errors and
    // RecompileTypeScriptTool fails).
    if ((this as any).enabledForProfiling === false) return;
    // Iterate the shorter of the two arrays so a names/offsets length mismatch
    // can't schedule markers at offset 0 (which would fire them all at t=0 and
    // break the orchestrator's screenshot timing).
    const count = Math.min(this.frameMarkerNames.length, this.frameMarkerOffsetsSeconds.length);
    for (let i = 0; i < count; i++) {
      const name = this.frameMarkerNames[i];
      const offset = this.frameMarkerOffsetsSeconds[i];
      const ev = this.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
      ev.bind(() => {
        // getTime() is absolute seconds since lens start — log the actual arrival
        // time so the orchestrator can detect markers that fired late. Use
        // Math.floor, not `| 0`: the bitwise op coerces the value to a 32-bit
        // signed int, which silently truncates/wraps for large millisecond values.
        const now = Math.floor(getTime() * 1000);
        print(`[PerfHarness] marker:${name} t_ms=${now}`);
      });
      ev.reset(offset);
      this._markerEvents.push(ev);
    }
  }
  // <perf-optimize-frame-markers END>
```

It also patches the `onAwake` hook to call `this.scheduleFrameMarkers()` after the existing `this.schedule()` call. The patch is a single-line addition wrapped in the same `BEGIN/END` markers.

The names and offsets are deliberate:

- Three markers (`idle`, `interaction`, `climax`) cover a typical harness arc: dormant Lens, mid-interaction state, peak content state.
- Default offsets (2 s, 5 s, 8 s) match the harness's default `delaySeconds=1.0` plus the typical 8–10 s capture window. The orchestrator can override via the `frameMarkerOffsetsSeconds` input if a project's exerciser runs longer.

## When the orchestrator installs the extension

Phase 2 (Branch + baseline), step 1 — after creating the new branch and **before** spawning the first `perf-attribution-runner` call.

The orchestrator uses `Edit` to patch the harness file (it knows the path from `scene-graphql` discovery). The patch is idempotent: if the `// <perf-optimize-frame-markers BEGIN>` marker is already present (e.g. an earlier interrupted run), the orchestrator skips the install step.

## When the orchestrator removes the extension

Phase 5 — after the closing full-sweep runner has returned, before `report_writer.py`.

Removal is a textual match on the `BEGIN/END` markers:

```bash
python3 -c "
import re, sys
path = sys.argv[1]
src = open(path, encoding='utf-8').read()
# Both injected pieces — the scheduleFrameMarkers() method AND the onAwake call
# site — are wrapped in their own BEGIN/END marker pairs, so this single regex
# removes everything. Do NOT add a separate global re.sub for
# 'this.scheduleFrameMarkers();' — that would be redundant here and could clobber
# an identically-named call elsewhere in the user's project.
out = re.sub(r'[ \\t]*// <perf-optimize-frame-markers BEGIN>.*?// <perf-optimize-frame-markers END>[ \\t]*\\n?', '', src, flags=re.S)
open(path, 'w', encoding='utf-8').write(out)
" Assets/Scripts/Profiling/PerfAttributionHarness.ts
```

After removal, the orchestrator runs `RecompileTypeScriptTool` once to confirm the project compiles cleanly. If it doesn't (e.g. the user's project had inline edits to the harness during the run), surface the error and leave the file as-is for the user to inspect.

## Why scoped removal

The orchestrator's revert (`git reset --hard <pre_iteration_sha>` + `git clean -fd Assets/`) reverts mid-loop file changes, but the harness extension was installed at the START of Phase 2, before any iteration began. That means it's at the run's base commit — every iteration revert preserves it, which is what we want (markers must persist across iterations for screenshot comparisons to be valid).

At the end of the run, the orchestrator explicitly removes the extension by textual marker match — NOT via `git reset` (which would also unwind every kept commit). Removal is committed as a final cleanup commit on the same branch:

```
chore(perf-harness): remove frameMarkers extension

Reverses the extension installed at the start of /specs-lens-perf-optimize.
```

The final cleanup commit is intentional — it leaves a clean diff on the new branch: extension installed (commit 1), N performance fixes (commits 2..N+1), extension removed (commit N+2). Reviewers see only the perf fixes plus the bookending harness commits.

## Failure modes

| Failure | Detection | Recovery |
|---------|-----------|----------|
| `BEGIN` marker found but no `END` | Pre-install scan | Surface to user; do not install over a half-installed extension. |
| Install would duplicate an existing `scheduleFrameMarkers` | Grep for the function name | Skip install; assume the previous run left it in place; reuse. |
| Markers never fire in baseline run | `perf-attribution-runner` Phase 4 timeout | Stop. The harness didn't reach the marker offsets — likely the target script's trigger failed. Surface; user fixes harness inputs. |
| Removal regex doesn't match | Phase 5 cleanup | Surface to user with the file path. User can hand-remove. The final report is still written. |

## Why this is safe to skip if the base harness is missing

The `/specs-lens-perf-optimize` preflight (SKILL.md §1) hard-stops when `PerfAttributionHarness` is missing — pointing the user back at `/specs-lens-perf-attribution` to install it. That means by the time this extension is applied, the base harness is known-good. The extension only adds reading from two new `@input` arrays and one extra method call; if `enabledForProfiling=false`, no markers fire and the harness behaves exactly as before.

## Backwards compatibility

If the user's harness was installed by an older version of `/specs-lens-perf-attribution` and doesn't have `@input enabledForProfiling`, the extension still applies — it adds two new `@input` arrays that the user can configure in the Inspector. Because the injected guard tests `(this as any).enabledForProfiling === false` (not `!this.enabledForProfiling`), an older harness where the property is `undefined` still fires the markers — the orchestrator calls `scheduleFrameMarkers()` in `onAwake` and the markers fire regardless. The `(this as any)` cast is also what keeps the injection **compiling** on an older harness class that never declared `enabledForProfiling` (a bare `this.enabledForProfiling` would be a TS error and fail `RecompileTypeScriptTool`).

Surface this version mismatch in the report header so the user knows what changed.
