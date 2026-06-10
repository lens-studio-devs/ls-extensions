<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Sweep manifest format

Use this with `scripts/analyze_perfetto_sweep.py` after exporting each performance trace to SQLite. Prefer this manifest workflow when the capture order, baseline rows, or labels need to be explicit.

```json
{
  "projectName": "Example Lens",
  "skipSeconds": 2.0,
  "metric": "all-depth",
  "stages": [
    {
      "label": "Interactive Preview baseline / all project roots off",
      "sqlite": "sweep_00_baseline.sqlite",
      "baseline": true
    },
    {
      "label": "Camera + render targets",
      "sqlite": "sweep_01_camera.sqlite"
    },
    {
      "label": "WorldDust VFX",
      "sqlite": "sweep_02_worlddust.sqlite"
    },
    {
      "label": "Full representative Lens",
      "sqlite": "sweep_99_full.sqlite"
    }
  ]
}
```

Fields:

- `projectName`: chart/report title prefix.
- `skipSeconds`: warmup skipped from each trace before frame averages are computed.
- `metric`: `all-depth` or `top-level`. Use `all-depth` for attribution charts unless nested double-counting is severe.
- `stages`: cumulative, runnable stages in capture order. SQLite paths may be absolute or relative to the manifest file.
- `baseline`: marks the Preview/editor baseline row. If omitted, the first stage is treated as baseline.

Run:

```bash
python3 /path/to/specs-lens-perf-attribution/scripts/analyze_perfetto_sweep.py \
  --manifest perfetto_traces/sweep_manifest.json \
  --out-dir perfetto_traces/analysis
```

Trace export example:

```bash
trace_processor_shell sweep_00_baseline.pftrace -e sweep_00_baseline.sqlite
```

If `trace_processor_shell` is not on `PATH`, use the project-local or downloaded Perfetto trace processor binary. Request approval before downloading tools from the network.
