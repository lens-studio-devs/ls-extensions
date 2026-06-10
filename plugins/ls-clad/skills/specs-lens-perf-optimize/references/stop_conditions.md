<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Stop conditions

The orchestrator checks all stop conditions at the top of every iteration (before spawning the worker) and once again before spawning the closing full-sweep runner. The first one to match wins; the orchestrator records the matched condition as the `stop_reason` in the final report.

## Conditions (in arbitration order)

The orchestrator evaluates conditions top-to-bottom. The first match exits the loop. Hard-stop conditions cannot be disabled.

| # | Condition | Argument | Default | Hard-stop? | Notes |
|---|-----------|----------|---------|-----------|-------|
| 1 | Git working tree dirty | — | — | yes | Pre-iteration check. If revert + clean left junk, surface and exit. |
| 2 | MCP unreachable | — | — | yes | `ListAllPanels` empty. Surface and exit. |
| 3 | Consecutive reverts | — | `>= 3` | yes | Likely recipe drift from project; surface failing candidate IDs. |
| 4 | Wall-clock budget | `wall-clock-budget-min` | 90 | no | Soft — current iteration finishes first. Default 90 min. |
| 5 | Max iterations | `max-iterations` | 12 | no | Counted by iterations attempted, not kept. |
| 6 | Target ms/frame reached | `target-ms-per-frame` | unset | no | `state.current_ms <= target-ms-per-frame`. |
| 7 | Cumulative improvement reached | `improvement-target-ms` | unset | no | `state.cum_saved_ms >= improvement-target-ms`. |
| 8 | Queue exhausted | — | — | no | All candidates above `min-delta-ms` processed. |

## Behavior on each stop type

### Hard stops (#1–#3)

- Skip the next iteration immediately.
- Skip the closing full-sweep — the project state is already broken or out of touch.
- Run `report_writer.py` with the partial log so the user sees what happened.
- Print the stop reason and a remediation pointer (e.g. "fix git state with `git status -s` and re-run").

### Soft stops (#4–#8)

- The in-flight iteration always finishes (so a kept commit isn't left in a partially-validated state).
- The closing full-sweep always runs to confirm the end-state ms/frame.
- The harness extension is always removed.
- The full final report is written.

## Per-iteration check

Pseudocode at the top of every iteration:

```python
def stop_conditions_met(state, args):
    if git_dirty():
        return True, "git tree dirty after revert"
    if not mcp_reachable():
        return True, "MCP unreachable"
    if state.consec_reverts >= 3:
        return True, "3 consecutive reverts"
    if state.elapsed_min() >= args.wall_clock_budget_min:
        return True, f"wall-clock budget {args.wall_clock_budget_min}min"
    if state.iter >= args.max_iterations:
        return True, f"max iterations {args.max_iterations}"
    if args.target_ms_per_frame is not None and state.current_ms <= args.target_ms_per_frame:
        return True, f"target ms/frame {args.target_ms_per_frame} reached"
    if args.improvement_target_ms is not None and state.cum_saved_ms >= args.improvement_target_ms:
        return True, f"improvement target {args.improvement_target_ms}ms reached"
    return False, None
```

The queue-exhausted check is implicit — when the `for cand in queue` loop runs out of candidates, the loop exits naturally with `stop_reason = "queue exhausted"`.

## Final report integration

`scripts/report_writer.py` reads the `stop_reason` from the orchestrator's running log and prints it in the report header so the reader knows whether the run completed naturally (queue exhausted, target reached) or was cut short (wall-clock, max-iter, hard stop).

Example report headers by stop type:

```
Stop: queue exhausted (8 candidates processed, 5 kept)
Stop: improvement-target 3.00 ms reached (after 4 commits)
Stop: max-iterations 12 (queue had 18 candidates; 6 unprocessed)
Stop: wall-clock budget 90 min (in-flight iteration completed)
Stop: 3 consecutive reverts (candidates: vfx-001, mesh-cluster-007, tracking-gate-002)
Stop: MCP unreachable (after iter 5)
Stop: git tree dirty after revert (run `git status -s`)
```

## What is NOT a stop condition

- A single revert is **not** a stop — the loop continues to the next candidate.
- An under-delivered candidate is **not** a stop — it's a revert.
- A failing visual parity check is **not** a stop — it's a revert.
- Lens Studio crashing/relaunching is **not** explicitly handled — MCP-unreachable will catch it on the next iteration.

## Adding a new stop condition

To add a new condition (e.g. "stop when GPU memory drops below threshold"):

1. Add a row to the table above with the argument name and default.
2. Add the check in the `stop_conditions_met` pseudocode in arbitration order.
3. Add the argument to `SKILL.md` Arguments table.
4. Add the matching `stop_reason` string to `report_writer.py`.

Keep arbitration order consistent across all four files — the order encodes which condition "wins" when several are simultaneously met.
