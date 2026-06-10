---
name: specs-lens-perf-optimize
description: Iteratively apply Lens Studio performance fixes from specs-lens-perf-attribution output. Dispatches workers per recommendation, validates with visual-parity + re-attribution, commits each kept fix on a new branch, stops on a user-defined condition.
user-invocable: true
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Lens Perf Optimize

Consume the output of `/specs-lens-perf-attribution` and drive an iterative optimization loop. For each ranked recommendation: apply a fix, verify visual + experiential parity, re-measure with Perfetto, and either commit (on real improvement) or revert (on regression / under-delivery). Stop when the queue is exhausted or a user-supplied stop condition is hit. End state: a fresh feature branch containing one commit per kept fix and a final report tying each commit to its measured ms/frame gain and parity score.

## Inputs

The skill expects an `attribution-dir` produced by `/specs-lens-perf-attribution`. That directory must already contain:

- `optimization_candidates.md` — ranked recommendation list
- `differential_attribution.csv` — per-trace ms/frame deltas
- `slice_deltas_vs_base.csv` — per-slice deltas for drill-down
- `metrics_compact.json` — structured per-trace metrics

The project must also have the `PerfAttributionHarness` script that `/specs-lens-perf-attribution` installed (or an equivalent reversible exerciser). The skill refuses to start without it — point the user back at `/specs-lens-perf-attribution` if missing.

## Arguments

Pass as `key=value` on invocation. Only `attribution-dir` is required.

| Argument | Default | Purpose |
|----------|---------|---------|
| `attribution-dir` | (required) | Output directory from `/specs-lens-perf-attribution`. |
| `max-iterations` | `12` | Hard cap on optimization iterations. |
| `target-ms-per-frame` | unset | Stop when total project-attributed ms/frame drops to or below this value. |
| `improvement-target-ms` | unset | Stop after cumulative ms/frame improvement reaches this value. |
| `min-delta-ms` | `0.20` | Skip candidates whose predicted impact is below this ms/frame. |
| `parity-threshold` | `0.92` | SSIM soft-revert gate (default 0.92). Hard floor 0.85 and histogram gate 0.97 are constant. See `references/verification_thresholds.md`. |
| `wall-clock-budget-min` | `90` | Stop after this many wall-clock minutes (any iteration in flight finishes first). |
| `revalidation` | `targeted` | `targeted` (2-trace re-run) or `full-sweep`. Auto-escalates to `full-sweep` on the final iter and any candidate predicted > 1.0 ms. |
| `branch-name` | `perf/specs-lens-perf-optimize/<YYYYMMDD-HHMM>` | Override the auto-generated branch name. |

Read `references/stop_conditions.md` for the arbitration order when multiple conditions are set.

## Hard rules

- Refuse to start unless the working tree is clean (`git status --porcelain` empty). The skill commits and reverts repeatedly; uncommitted work will be lost.
- Always create a new branch forked off the current `HEAD`. Never commit directly to the user's current branch.
- One commit per kept fix. Never amend. Never push.
- Auto-revert (no user prompt) when SSIM < parity-threshold, when an experiential marker is missing or > 25 % delayed, when the build fails to compile, or when the measured delta is below 50 % of the candidate's predicted impact.
- Revert with `git reset --hard <pre-iteration-sha>` && `git clean -fd Assets/` (scoped — `attribution-dir` survives). Confirm `git status --porcelain` is empty; hard-stop if dirty. See `references/iteration_protocol.md` Revert sequence.
- Never delegate `git commit` to a sub-agent. Sub-agents propose; the orchestrator commits.
- Keep the `PerfAttributionHarness` reversible. The temporary `frameMarkers` extension this skill installs (see `references/harness_contract.md`) is committed as a dedicated setup commit in §2 and removed in a matching cleanup commit in §5 — it is never folded into a per-fix commit, and it is always gone by the end of the run.
- Cap consecutive reverts at 3 — assume the recipe library has drifted from the project and stop.

## 1. Preflight

1. Verify MCP via `/check-mcp-connection`. Stop if down.
2. Verify `git status --porcelain` is empty. Stop with the path and `git status -s` output if not.
3. Read `<attribution-dir>/{optimization_candidates.md, differential_attribution.csv, slice_deltas_vs_base.csv, metrics_compact.json}`. Stop if any is missing.
4. Run `python3 scripts/parse_attribution.py <attribution-dir> --min-delta-ms <min-delta-ms>` (default `0.20`) to produce an ordered candidate list (`candidates.json` in the attribution dir). Each row: `{candidate_id, category, predicted_delta_ms, stage_label, top_slices[], recipe_hint, source_line}`.
5. Query the scene via the `scene-graphql` MCP tool for `PerfAttributionHarness`. If absent, stop with: "PerfAttributionHarness not found — run /specs-lens-perf-attribution first." (Tool naming, deferred schemas, and ask/spawn semantics: see `lens-studio-field-notes` Hard Rule 2 / Cross-runtime orchestration.)
6. Resolve the Perfetto trace processor: prefer `$PERFETTO_TRACE_PROCESSOR`, fall back to `which trace_processor_shell`. If neither resolves and the attribution dir contains any `.pftrace` rather than `.sqlite`, stop with the resolution instructions.

## 2. Branch + baseline

1. Capture `pre_run_sha = git rev-parse HEAD`.
2. Create the branch: `git switch -c "<branch-name>"`.
3. Spawn the `perf-attribution-runner` agent with `mode=baseline`. The agent:
   - Injects the `frameMarkers` extension into `PerfAttributionHarness` (see `references/harness_contract.md`).
   - Runs the full sweep manifest from the attribution dir.
   - Captures one screenshot per harness marker (`idle`, `interaction`, `climax`) into `<attribution-dir>/baseline_frames/`.
   - Returns JSON: `{status, trace_dir, ms_per_frame, top_slices[], screenshot_paths[], log_path}`.
   - **Guard:** if `status != "ok"` (baseline capture failed — compile error, harness misconfig, MCP disconnect), STOP and surface the error. Do NOT proceed with a null/partial baseline: every later step depends on a valid `baseline.ms_per_frame` and `screenshot_paths`.
4. Commit the harness extension as a dedicated setup commit (see `references/harness_contract.md` §When the orchestrator installs the extension for idempotency and commit message).
5. Compare the baseline ms/frame against `metrics_compact.json`. If the delta exceeds 10 %, warn but proceed — measurement drift is recorded in the final report.
6. Initialize the run state from the baseline before entering the loop:
   `state = { start_ms: baseline.ms_per_frame, current_ms: baseline.ms_per_frame, cum_saved_ms: 0.0, consecutive_reverts: 0, iter: 0, log: [] }`.

## 3. Plan queue

The candidate list from `scripts/parse_attribution.py` is already filtered by `min-delta-ms` and sorted descending by predicted impact. For each candidate, look up the concrete recipe in `references/recommendation_taxonomy.md` keyed by `category`. Drop candidates whose recipe is `unsupported` — and for each dropped one, append a record to `state.log` (e.g. `{candidate, keep: false, status: "unsupported", reason}`) so it appears in the final report rather than vanishing silently (the report is generated solely from `state.log`).

## 4. Iteration loop

For each remaining candidate (in order): apply the fix via `perf-fix-applicator`; run fast gates (visual parity via `scripts/visual_diff.py` + experiential markers from `post_log`); if both pass, re-measure with `perf-attribution-runner`; keep (commit via `commit_helper.py`) if `delta_ms >= 0.5 * predicted_delta_ms` and `delta_ms > 0`, otherwise revert. See `references/iteration_protocol.md` for the full loop contract, JSON schemas, `revert_and_log` / `record_revert` helper, commit-message template, and revert sequence.

Auto-stop guards (besides user-supplied): queue exhausted; MCP unreachable; git tree dirty unexpectedly; 3 consecutive reverts; wall-clock budget elapsed.

## 5. Closing full-sweep + report

Whether the loop exited via stop condition or queue exhaustion, always:

1. Run `perf-attribution-runner` once more in `mode=full-sweep`; capture its result as `final` (e.g. `final = {status, ms_per_frame, trace_dir, ...}`) to record the end-state ms/frame. **Check `final.status` first:** if it is not `"ok"` (compile/run/MCP failure in the combined end state), do NOT use `final.ms_per_frame` — write the report from the iteration log with the final measurement marked unavailable (see step 3) and note the failure in the summary, rather than passing a null/garbage value downstream.
2. Remove the `frameMarkers` extension and commit cleanup (see `references/harness_contract.md` §When the orchestrator removes the extension).
3. Run `python3 scripts/report_writer.py --log <state.log.json> --baseline <state.start_ms> --out <attribution-dir>/perf_optimization_report.md`, adding `--final <final.ms_per_frame>` **only when `final.status == "ok"`** (omit it otherwise so the report records the end-state as unavailable instead of crashing on a null).
4. Print the summary table to stdout: baseline ms/f, final ms/f, cumulative saved, iterations attempted/kept, wall-clock, stop reason, branch name, commit range.

## 6. Final deliverables

- A new branch `<branch-name>` containing one commit per kept fix, all forked off the user's prior `HEAD`.
- `<attribution-dir>/perf_optimization_report.md` — the per-iteration table with `idx | category | candidate | predicted_ms | measured_ms | cum_ms | SSIM | hist_cos | markers | status | commit_sha | trace_dir`.
- `<attribution-dir>/parity/` — `parity_<id>.json` + `parity_<id>.png` (side-by-side thumb) for every iteration attempted.
- Console summary table.
- No `git push` — the user reviews and pushes themselves.
