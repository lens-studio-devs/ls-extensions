<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Iteration protocol

The orchestrator (`/specs-lens-perf-optimize`) drives a serial loop. Each iteration is a strict request/response cycle between the orchestrator and two sub-agents (`perf-attribution-runner` and `perf-fix-applicator`). This file is the contract: input/output JSON shapes, commit-message template, and revert sequence.

> **Cross-runtime note.** The pseudocode below uses `Agent(subagent_type = "ls-clad:<name>", …)` to denote **spawn subagent `<name>` and await its structured result** — that is the Claude Code form. On any runtime, apply it by intent (see `ls-clad:lens-studio-field-notes` → **Cross-runtime orchestration**): spawn via your runtime's facility, or — if it can't spawn the markdown agents (e.g. Codex) — run `ls-clad/agents/<name>.md`'s procedure inline and use its returned JSON. The loop logic is identical regardless of how the sub-step is executed.

## Iteration sequence (orchestrator-side)

```
state {
   start_ms       float   # baseline ms/frame from /specs-lens-perf-attribution
   current_ms     float   # current best-known ms/frame after the last kept commit
   cum_saved_ms   float   # running total of measured savings
   iter           int     # 1-based iteration counter
   log            list    # one entry per attempted candidate (kept or reverted)
   start_ts       int     # unix seconds — for wall-clock budget
   consec_reverts int     # consecutive reverts; auto-stop at 3
}

# record_revert / record_keep append a STABLE-schema entry to state.log:
#   {candidate, keep: bool, reason: str, parity?: obj, delta_ms?: float,
#    trace_dir?: str, details?: str, commit_sha?: str}
# All call sites pass keyword args; absent fields default to null so
# report_writer.py sees one consistent shape.
stop_reason = "queue exhausted"   # default when the loop drains naturally
for cand in queue:
   stopped, reason = stop_conditions_met(state, args)   # returns (bool, reason)
   if stopped:
      stop_reason = reason
      break
   state.iter += 1
   pre_sha = git rev-parse HEAD

   worker_resp = Agent(
      subagent_type = "ls-clad:perf-fix-applicator",
      input_json    = applicator_input(cand, baseline.screenshots, pre_sha)
   )

   if worker_resp.status != "applied":
      record_revert(cand, reason = worker_resp.status, details = worker_resp.notes)
      git reset --hard <pre_sha>
      git clean -fd Assets/
      state.consec_reverts += 1
      if state.consec_reverts >= 3: break
      continue

   # Run the FAST gates first (visual parity + experiential markers). Only
   # spend the expensive re-measurement runner if both pass — matches the
   # canonical loop ordering in specs-lens-perf-optimize/SKILL.md.
   parity = run("python3 scripts/visual_diff.py …")
   experiential_ok = check_markers(worker_resp.post_log, baseline.log_path)

   # decide_keep here covers only the visual+experiential portion (delta unknown
   # yet) — pass delta_ms=None; it returns (ok, reason). A "hard revert ssim<0.85"
   # or "no markers compared" reason is CRITICAL: stop immediately rather than
   # burning the rest of the queue against a broken baseline.
   gate_ok, gate_reason = decide_keep(parity, experiential_ok, delta_ms=None, candidate=cand, args=args)
   if not gate_ok:
      git reset --hard <pre_sha>
      git clean -fd Assets/
      state.consec_reverts += 1
      record_revert(cand, reason = gate_reason, parity = parity)
      if is_critical(gate_reason) or state.consec_reverts >= 3: break   # hard revert / zero markers => immediate hard stop
      continue

   mode = "full-sweep" if cand.predicted_delta_ms > 1.0 else args.revalidation
   measured = Agent(
      subagent_type = "ls-clad:perf-attribution-runner",
      input_json    = runner_input(mode, cand.stage_label, state.iter)
   )

   # Guard the runner result: a crash / trace-processing error gives a null
   # ms_per_frame — do NOT compute delta on it.
   if measured.status != "ok":
      git reset --hard <pre_sha>
      git clean -fd Assets/
      state.consec_reverts += 1
      record_revert(cand, reason = "remeasure failed: " + measured.status, parity = parity)
      if state.consec_reverts >= 3: break
      continue

   # measured.ms_per_frame is always the PROJECT-attributed total (same basis as
   # state.current_ms / the baseline), even in targeted mode: targeted_remeasure.py
   # returns the project-attributed total for the full-scenario stage, not a single
   # stage's time. Both operands are project totals, so the delta is well-defined.
   delta_ms = state.current_ms - measured.ms_per_frame
   keep, reason = decide_keep(parity, experiential_ok, delta_ms, cand, args)

   if keep:
      sha = run("python3 scripts/commit_helper.py …")
      state.current_ms = measured.ms_per_frame
      state.cum_saved_ms += delta_ms
      state.consec_reverts = 0
      record_keep(cand, parity, delta_ms, sha, measured.trace_dir)
   else:
      git reset --hard <pre_sha>
      git clean -fd Assets/
      state.consec_reverts += 1
      record_revert(cand, reason=reason, parity=parity, delta_ms=delta_ms, trace_dir=measured.trace_dir)
      if is_critical(reason) or state.consec_reverts >= 3:
         stop_reason = reason if is_critical(reason) else "3 consecutive reverts"   # every consec_reverts>=3 break sets this
         break

# Closing full-sweep — but NOT on a hard stop caused by a dirty/corrupt tree.
# Measuring a broken project state would produce a meaningless final number,
# so skip the closing sweep on hard stops (dirty tree / 3 consecutive reverts)
# and write the report from the partial log. This matches stop_conditions.md.
if hard_stopped_on_dirty_or_corrupt_state(stop_reason):
   remove_harness_extension()
   run("python3 scripts/report_writer.py --log <log.json> --baseline <state.start_ms> --out <attribution_dir>/perf_optimization_report.md")  # no --final
   print_summary_table(state, final = None)
else:
   final = Agent(subagent_type = "ls-clad:perf-attribution-runner", input_json = runner_input("full-sweep", None, "final"))
   remove_harness_extension()
   run("python3 scripts/report_writer.py --log <log.json> --baseline <state.start_ms> --final <final.ms_per_frame> --out <attribution_dir>/perf_optimization_report.md")
   print_summary_table(state, final)
```

## `perf-fix-applicator` input

```json
{
  "candidate": {
    "candidate_id": "vfx-sparkle-rate-001",
    "category": "VFX/particle",
    "stage_label": "10_vfx",
    "predicted_delta_ms": 0.52,
    "top_slices": [
      { "category": "ScnVisual", "name": "_ngsVfxManager", "max_ms": 1.8 }
    ],
    "source_line": "optimization_candidates.md:42"
  },
  "recipe": {
    "tactic": "reduce-particle-spawn",
    "delegate_skill": null,
    "edit_hints": ["Halve spawn rate on the VFX named in top_slices; prefer config edits."]
  },
  "baseline_screenshots": [
    "<attribution_dir>/baseline_frames/marker_idle.png",
    "<attribution_dir>/baseline_frames/marker_interaction.png",
    "<attribution_dir>/baseline_frames/marker_climax.png"
  ],
  "current_head_sha": "abc1234",
  "attribution_dir": "/abs/path/to/attribution_dir",
  "post_screenshots_out": "<attribution_dir>/iter_3_frames"
}
```

## `perf-fix-applicator` output

```json
{
  "status": "applied",
  "candidate_id": "vfx-sparkle-rate-001",
  "files_changed": ["Assets/Scripts/Game/SparkleSpawner.ts"],
  "scene_mutations": ["VFX/SparkleEmitter: spawnRate 60 -> 30"],
  "post_screenshots": [
    "<attribution_dir>/iter_3_frames/marker_idle.png",
    "<attribution_dir>/iter_3_frames/marker_interaction.png",
    "<attribution_dir>/iter_3_frames/marker_climax.png"
  ],
  "post_log": "<attribution_dir>/iter_3_frames/post.log",
  "missing_markers": [],
  "compile_status": "ok",
  "delegated_skill": null,
  "notes": "Halved sparkle spawn from 60 to 30/s per VFX/particle recipe."
}
```

Failure shapes: `unresolved`, `unsupported`, `compile_failed`, `error` — see `perf-fix-applicator.md`.

## `perf-attribution-runner` input

```json
{
  "mode": "baseline" | "targeted" | "full-sweep",
  "attribution_dir": "/abs/path/to/attribution_dir",
  "harness_path": "Assets/Scripts/Profiling/PerfAttributionHarness.ts",
  "focus_stage": "10_vfx",
  "trace_processor": "/usr/local/bin/trace_processor_shell",
  "screenshots_out": "<attribution_dir>/iter_3_frames"
}
```

## `perf-attribution-runner` output

```json
{
  "status": "ok",
  "mode": "targeted",
  "trace_dir": "<attribution_dir>/run_20260512-1503",
  "ms_per_frame": 14.31,
  "top_slices": [
    { "category": "ScnRenderDrawCall", "name": "tree LODs", "ms_per_frame": 1.78 }
  ],
  "screenshot_paths": [],
  "log_path": "<attribution_dir>/run_20260512-1503/log.txt",
  "missing_markers": [],
  "notes": "trace_processor: /usr/local/bin/trace_processor_shell"
}
```

## Commit message template

Formed by `scripts/commit_helper.py` using a HEREDOC. The orchestrator never assembles commit messages directly — keeps formatting consistent across iterations.

```
perf(<category>): <short tactic> — saves <X.XX> ms/f (SSIM <0.XXX>)

Candidate:        <candidate_id>
Source:           <source_line>
Baseline ms/f:    <state.current_ms before this iter>
Post ms/f:        <measured.ms_per_frame>
Delta ms/f:       <delta>   (predicted <predicted_delta_ms>)
Visual SSIM:      idle <0.XXX>  interaction <0.XXX>  climax <0.XXX>
Histogram cos:    idle <0.XXX>  interaction <0.XXX>  climax <0.XXX>
Markers:          idle <ok>  interaction <ok>  climax <ok>
Top slices:       <slice1>, <slice2>
Recipe:           <tactic>
Trace dir:        <trace_dir relative to repo root>
Iteration:        <state.iter>
```

The `<short tactic>` is a 4–10 word human description pulled from the candidate's recommended action. Categories map to commit-message prefixes one-for-one:

| Category | Prefix |
|----------|--------|
| `camera/render` | `perf(camera)` |
| `mesh/visual/draw` | `perf(mesh)` |
| `tracking/ML/gesture` | `perf(tracking)` |
| `script/component/logic` | `perf(script)` |
| `VFX/particle` | `perf(vfx)` |
| `generic` | `perf(general)` |

## Revert sequence

When a candidate fails any gate, the orchestrator reverts:

```bash
git reset --hard <pre_iteration_sha>
git clean -fd Assets/
```

The `Assets/` scope is deliberate — `<attribution_dir>/parity/`, `<attribution_dir>/iter_<n>_frames/`, and `<attribution_dir>/run_<timestamp>/` survive so the final report can reference them. The orchestrator never runs `git clean -fdx` (which would delete `.gitignored` build outputs), and never runs `git clean` outside `Assets/`.

If the working tree is dirty in a way that survives the revert (e.g. cleanup orphaned a `.meta` file), this is an **immediate hard stop** (stop condition #1 in `stop_conditions.md`): the orchestrator logs it, stops the loop at once, and surfaces it to the user with `git status -s` output. It does NOT continue iterating on a dirty tree — measuring or editing a corrupt state is unsafe, and the `state` object intentionally carries no "consecutive dirty iterations" counter.

## Harness extension lifecycle

The orchestrator installs the `frameMarkers` extension once, at the very start of Phase 2 (before the baseline runner is spawned). It removes the extension once, in Phase 5 (after the closing full-sweep). Workers never touch the extension. The exact install/remove pattern lives in `harness_contract.md`.
