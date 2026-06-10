---
name: specs-lens-perf-attribution
description: Profile and optimize Lens Studio/Specs projects via differential performance sweeps, component toggling, ms/frame attribution, and optimization plans. Use when analyzing Preview performance traces or building simulation harnesses.
user-invocable: true
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Lens Perf Attribution

Attribute Lens Studio Preview frame time to concrete project systems. First make the Lens exercise representative content, then run differential performance captures, then report positive attributed `ms/frame` deltas and optimization actions.

## Hard rules

- Read and follow the Hard Rules in `/lens-studio-field-notes` before touching project files or scene tools.
- Keep the Lens runnable at every sweep stage; do not create broken isolated states.
- Do **not** profile idle Preview and call it representative performance.
- Keep Preview/editor/platform baseline separate from project-attributed work.
- Attribute unclear trace labels by A/B toggles, not by one slice name.
- Report attributed slice time as `ms/frame`. Do not report CPU core-time — Lens Studio Preview performance traces do not expose scheduler/CPU tables.
- Avoid invalid Preview configs, especially `PreviewPanelTool` `inputType=None`, unless the project/build is known to tolerate it.
- Make temporary profiling code and scene toggles reversible; restore the project or document cleanup.

## 1. Prepare a representative exerciser

Before tracing, inventory:

- scene roots, cameras, render targets, render layers, lights, and environment;
- package roots such as SIK, SyncKit, WorldQuery, ML, Remote Services, WebView, audio, networking, storage;
- large renderables, text/UI, gaussian splats/4DGS, VFX, particles, animated/skinned rigs;
- scripts with update loops, timers, polling, network callbacks, or interaction gates;
- user journeys normally activated by gestures, speech, body/person tracking, scanning, movement, network state, or time.

If important systems would be dormant in ordinary Preview, add the smallest deterministic exerciser first. Prefer existing debug triggers, exposed script inputs, timers, or public methods. If necessary, add temporary scripts under `Assets/Scripts/Profiling/` with names such as `PerfSweepDriver` or `ProfilingHarness`. Gate them behind a debug input or remove them after capture.

**Load `references/lens_simulation_harness.md`** when that exerciser must drive journeys gated behind gestures, voice/keyword, body/person tracking, scanning, world/surface detection, network state, or elapsed time — i.e. you have to author a temporary harness script rather than flip an existing toggle. It carries the trigger strategies, a TypeScript harness skeleton, and a validation checklist. Skip it when the Lens already exercises its systems on load.

Confirm before tracing:

- Preview refreshes without script/compiler errors;
- logs show harness markers where relevant;
- screenshot proves representative content/effects are active;
- draw-call/vertex counters look plausible;
- no required dependency was accidentally bypassed.

If a representative exerciser cannot be built safely, stop and explain why instead of under-measuring the Lens.

## 2. Define a differential sweep matrix

Design a project-specific cumulative sweep: start with a runnable minimum baseline, enable dependencies before dependents, name stages after what this Lens contains, and split stages that need finer attribution. Pick a name convention that sorts in execution order (e.g. `00_baseline`, `01_camera`, …).

Categories worth considering when designing the sweep:

- minimum-runnable baseline with project content disabled;
- camera/render backbone and required render targets;
- tracking the Lens depends on (device, world, face, body, hand);
- lighting, sky, shadows, environment;
- package roots actually used (e.g. SIK, SyncKit, WorldQuery, Remote Services);
- input/interaction systems;
- onboarding/hint/debug UI;
- static content (meshes, images, text, gaussian splats/4DGS);
- animation, VFX, particles, animated rigs;
- gameplay/application scripts and update-heavy logic;
- audio, network, ML, persistence;
- full Lens with exerciser enabled.

Add targeted A/B traces when a cumulative delta is ambiguous, such as renderables-on/scripts-off, VFX-only with render dependencies, SIK-on/hand UI-off, package roots with user components disabled, or gaussian-splat group A vs group B.

For every stage, record stage name, enabled roots/components, required dependencies kept on, disabled roots/components, Preview mode/input, harness state, screenshot path, and trace path.

## 3. Capture traces consistently

Capture every performance trace via the `specs-capture-perf-trace` skill. Do not write ad-hoc `ExecuteEditorCode` snippets, call `preview.profiling.startTrace` directly, or run other capture tooling — using the skill is the only supported path.

For each stage:

1. Apply scene/script toggles with Lens Studio tools; batch scene mutations when possible.
2. Refresh/restart Preview, then let the scene settle and the exerciser reach steady state.
3. Invoke `specs-capture-perf-trace` with consistent duration (8–15 s; 10–20 s for triggered interactions) and a `filenamePrefix` matching the stage, e.g. `sweep_<stage>`.
4. Repeat noisy stages or deltas below about `0.10 ms/frame` by re-invoking the skill.
5. Export `.pftrace` to SQLite if needed by the analyzer.

Keep Preview mode, target FPS assumption, input source, and capture duration constant unless a test explicitly measures that setting.

## 4. Analyze traces with bundled tools

Use `scripts/analyze_perfetto_attribution.py` for the default directory-based workflow:

```bash
python3 /path/to/specs-lens-perf-attribution/scripts/analyze_perfetto_attribution.py \
  perfetto_attribution_traces \
  --trace-processor /path/to/trace_processor_shell \
  --project-label "My Lens" \
  --base <minimum-runnable-baseline-stage> \
  --target-fps 30 \
  --warmup-s 2
```

Key options: `--comparisons`, `--include-baseline`, `--include-all-categories`, `--exclude-donut-regex` — run with `--help` for details. Outputs include CSV summaries, a donut chart, `optimization_candidates.md`, and `metrics_compact.json`.

Use `scripts/analyze_perfetto_sweep.py` when the capture order, baseline rows, or labels need to be explicit. **Load `references/manifest.md`** before writing the `sweep_manifest.json` this script consumes — it specifies the required fields (`projectName`, `skipSeconds`, `metric`, `stages` with `label`/`sqlite`/`baseline`) and includes the run command and `.pftrace`→SQLite export command.

Use `scripts/perfetto_sweep_summary.py` for a quick steady-state summary of raw or SQLite traces, and `scripts/donut_chart.py` when you already have a `label,value` CSV.

**Load `references/perfetto_sql.md`** only if you must hand-write trace SQL or a bundled script fails on an unusual export — e.g. it raises `no such table` / `no such column`, the trace has no `Scene Update` slices, or you need to interpret category labels. Normal runs never need it; the scripts already issue this SQL internally.

## 5. Attribute by positive deltas

Build attribution from adjacent cumulative stages and targeted A/B comparisons.

- `delta = enabled_stage_ms_per_frame - baseline_or_previous_stage_ms_per_frame`.
- Use positive deltas for the project-only chart.
- Treat negative deltas as noise/displacement unless repeat traces prove a real optimization.
- Map each contributor back to owning scene roots, scripts, assets, package systems, or materials using sweep notes and changed slice labels.
- Treat generic labels (`ShapeTrack`, `ScnComponent`, `_ngsVfxManager`, `visual component_0`, `ScnRender`, unnamed scripts) as unresolved until differential evidence proves the owner.
- If a label appears in all-off, keep it in Preview/editor baseline unless it grows only when a project subsystem is enabled.
- Report results as attributed slice time (see Hard Rules).

## 6. Chart requirements

Default chart: project-only positive attributed frame-time deltas, Preview/editor baseline excluded. Include baseline only if useful or requested.

Use a wide white donut/pie chart with:

- title: `<Project>: attributed frame-time contributors`;
- outer labels with contributor name, `X.XX ms/f`, and percent;
- center label: `Attributed frame time` and total `X.XX ms/frame`;
- footer: differential attribution from performance traces, positive deltas only, baseline included/excluded, attributed slice time not CPU core-time.

## 7. Produce optimization recommendations

Rank recommendations by measured project-only impact, confidence, effort, and risk:

1. largest positive `ms/frame` delta;
2. owner proven by A/B traces;
3. always-on work before rare one-shot work, unless spikes cause jank;
4. low visual/product risk;
5. small reversible change with a clear validation trace.

Tie each item to concrete Lens actions, such as disabling inactive update loops, gating onboarding UI after completion, reducing VFX spawn/overdraw/render targets, simplifying shaders/materials, lowering splat/mesh/rig complexity, culling offscreen renderables, pooling instead of cloning, throttling queries/network/ML, sharing materials, or merging static renderables only when draw calls are the bottleneck.

If the user explicitly asks for sub-agent investigation, spawn focused explorers/workers for the top measured contributors. Give each contributor's delta, owner evidence, trace labels, allowed files/scene roots, and required output: cause, feasible change, files/components, expected impact, risk, and validation plan.

## 8. Final deliverables

Return a concise report with:

- representative scenario/harness changes and confirmation screenshot;
- trace folder, stage matrix, and comparison method;
- CSV/JSON summaries and chart paths;
- total project-attributed `ms/frame`, plus Preview baseline if measured/included;
- top contributors table with `ms/frame` and percent;
- statement that results are attributed slice time (see Hard Rules);
- prioritized optimization plan with validation traces;
- project state restored, or exact cleanup steps for temporary profiling files/toggles.
