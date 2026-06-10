<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Perfetto Trace Analysis Skill

A skill for analyzing Lens Studio `.pftrace` performance traces and produces actionable bottleneck reports — entirely in-chat, without requiring the user to open any external profiling UI. It combines **Automated Anomaly Detection** (surfacing slow frames, shader spikes, and jank patterns) with **Automated Root Cause Analysis** (ranking likely drivers and mapping them to specific scene objects and code paths).

## What problem does it solve?

When developing a Lens, you can profile it on a phone or Spectacles and it produces a `.pftrace` file — a binary recording of everything the device CPU was doing, with nanosecond-precision timestamps and named spans for every operation. These files are large, binary, and not human-readable. This skill analyzes a trace and explains *why the Lens is slow*: which operations are expensive, on which thread, how often they occur, and whether the problem is a consistent bottleneck or occasional spikes.

The two-phase design separates concerns cleanly: Phase 1 handles **Automated Anomaly Detection** (frame budget violations, shader compilation clustering, activation-time hitches, thread hotspots) and **Automated Root Cause Analysis** (confidence-ranked candidates with fix suggestions); Phase 2 provides deep SQL drilling for cases that need call-hierarchy or scheduling data to confirm a root cause.

## How it gets triggered

Auto-triggers when a request mentions:
- `.pftrace` or `.perfetto-trace` file extensions
- "Perfetto", "Mobile Lens Profiler", "Spectacles Monitor"
- "frame drops", "jank", "LAT" (Lens Activation Time)
- "trace performance analysis"

## File layout

```
skills/perfetto-trace-analysis/
├── SKILL.md                        ← Runtime behavior and execution rules
├── README.md                       ← This file (developer documentation)
└── references/
    ├── analyze_lens_trace.py       ← Phase 1: fast analysis script → JSON summary
    ├── trace_server.py             ← Phase 2: persistent interactive SQL server
    ├── sql-recipes.md              ← Phase 2: copy-paste SQL query templates
    └── requirements-perfetto.txt   ← Python deps: perfetto + pandas
```

`SKILL.md` and `README.md` serve different purposes. `SKILL.md` defines how the skill behaves at runtime; this document explains how the skill works for developers.

## Two-phase design

The skill uses a two-phase approach because `.pftrace` files can be very large. Dumping raw trace data into a chat would be both slow and useless. Instead:

- **Phase 1** always runs first. It produces a structured JSON summary in one script execution — fast enough to be the default path.
- **Phase 2** only runs when Phase 1 doesn't give enough detail (e.g. ambiguous thread names, suspected OS scheduling issues, need to drill into call hierarchy).

---

## Phase 1 — Fast structured summary

### What it does

The skill runs `analyze_lens_trace.py` via the Bash tool:

```bash
python3 references/analyze_lens_trace.py /absolute/path/to/file.pftrace
```

The script opens the trace using Google's `perfetto` Python library, which loads the binary file into an in-memory SQLite database queryable with SQL. It then runs a series of targeted queries and prints a single JSON blob to stdout.

### Capture profile detection

Before any frame analysis, the script auto-detects whether the trace is from **Spectacles** or **Mobile Lens Profiler** by scoring keywords found in thread names, slice names, and metadata. For example:
- `"spectacles"` → +55 Spectacles points
- `"lensactivation"` → +15 Mobile points

Whichever side wins by 18+ points determines the profile. This matters because frame budgets differ: Spectacles targets 60fps (16.7ms/frame), mobile targets 30fps (33.3ms/frame).

### SQL queries and what they produce

| Output field | Query approach | What it tells you |
|---|---|---|
| `totalDurationMs` | `MIN(ts)` / `MAX(ts+dur)` on `slice` | How long the captured session was |
| `topSlices` | `GROUP BY name+thread ORDER BY SUM(dur) DESC LIMIT 40` | Recurring expensive operations ranked by total time consumed |
| `threadActivity` | `GROUP BY track ORDER BY SUM(dur) DESC LIMIT 8` | Which threads are busiest; top entry is almost always the main render thread |
| `frameTimingStats` | Depth-0 durations on busiest track (by `track_id`) | p50/p90/p99/max frame times — distinguishes consistent jank from occasional spikes |
| `renderThreads` | Depth-0 `Frame` slices grouped by `track_id` | Per-thread frame stats (count, avg, max); surfaces multiple render threads even when unnamed |
| `lensActivationTimeMs` | Slices matching `%LensActivation%` | How long it took the Lens to become ready after launch |
| `slowFrames` | `depth = 0` slices on render/main threads exceeding the frame budget | Top-level work units that blew the frame time limit |
| `shaderSpikeTiming` | Shader-related slices with `dur > 5ms`, early vs total | Whether shader compilation clusters at startup or persists at runtime |
| `textureAttributions` | Slices matching `%texture%`, `%mesh%` | Expensive texture/mesh operations |
| `fpsEstimate` | Count of `Draw`/`Frame` slices (rough heuristic) | Approximate frame rate |
| `tracks` | `SELECT DISTINCT name FROM track` | Thread/track names in the trace, helps orient Phase 2 |

### The `depth` field

Every slice in a Perfetto trace has a `depth` — its nesting level within its thread:
- `depth = 0` — top-level work, not inside any other span. These represent actual per-frame work units.
- `depth = 1` — work nested inside a top-level span.
- `depth = 2+` — deeper implementation details.

`slowFrames` filters to `depth = 0` specifically to avoid false positives. Without this filter, a deeply nested 20ms child operation would show up as a "slow frame" even though it's just one piece of a frame, not a frame boundary.

`topSlices` uses aggregation (`GROUP BY name + thread`) rather than sorting by individual duration. This is important: sorting by individual duration would surface one-off init slices and bury recurring problems. A slice that runs 300 times at 15ms each (4500ms total) is a much bigger issue than a one-time 500ms startup cost, but the latter would dominate a per-instance sort.

### Output fields on `topSlices`

Each entry in `topSlices` has:
- `totalDurationMs` — sum of all instances (use this to rank importance)
- `avgDurationMs` — average per call (use this to classify severity vs frame budget)
- `maxDurationMs` — worst single instance (use this to identify spikes)
- `callCount` — how many times it ran
- `minDepth` — minimum depth seen for this operation (0 = includes top-level occurrences)
- `trackId` — the track this entry comes from (use in Phase 2 `WHERE s.track_id = ...`)
- `dominantChildHint` _(optional)_ — present when one child accounts for ≥50% of this slice's total cost; contains `childName`, `childTotalMs`, `pctOfParent`. This often surfaces the real bottleneck (e.g. `visual component_0 → get shader`) without needing Phase 2.

### `frameTimingStats` interpretation

| Pattern | Meaning |
|---|---|
| p50 within budget, p90 well over | Occasional spikes — likely GC, background work, or one-off loads |
| p50 consistently over budget | The main path itself is too slow — needs algorithmic optimization |
| Large gap between p90 and p99 | Rare but severe hitches — investigate specific slow frames |

### Early vs late hitches

The script marks every slow frame as `"early"` (within first 500ms of trace) or `"late"` (after). Early hitches point to activation-time issues (shader compilation, ML model load, asset decompression). Late hitches point to interaction-triggered work.

### When the skill stops at Phase 1

If Phase 1 produces enough information to make concrete Lens optimization suggestions, the skill stops here. It does not proceed to Phase 2.

---

## Phase 2 — Deep SQL debugging

### When it runs

Phase 2 only runs when Phase 1 is insufficient, for example:
- Slice names are too generic to identify the real bottleneck
- Need to see the call hierarchy (what's inside a slow top-level operation)
- Suspected OS thread preemption/starvation (needs the `sched` table)
- Low confidence on capture profile detection

### How `trace_server.py` works

The server is launched as a background process:

```bash
python3 -u references/trace_server.py /path/to/file.pftrace
```

The `-u` flag (unbuffered stdout) is mandatory — without it, buffering in the subprocess can prevent output from being flushed, causing the pipe to deadlock.

Once it prints `Ready.` to stderr, communication happens over stdin/stdout using a simple line-based protocol:

1. A single SQL query is written to **stdin** (one line)
2. The server runs it, converts results to CSV using `pandas`, writes lines to **stdout**
3. Server writes `END_OF_QUERY` on its own line to signal completion
4. The LLM reads **stdout** until the sentinel is encountered, then processes the CSV

Example exchange:
```
→ stdin:  SELECT name, SUM(dur)/1e6 AS total_ms FROM slice WHERE depth=0 GROUP BY name ORDER BY total_ms DESC LIMIT 20
← stdout: name,total_ms
          SceneUpdate,4800.2
          RenderFrame,2100.5
          END_OF_QUERY
```

Results are capped at 200 rows by default. This is intentional — it forces targeted queries rather than full table dumps. If truncated, the output includes a `# TRUNCATED` comment with the actual row count.

### `sql-recipes.md`

Pre-written SQL templates for the most common Phase 2 investigations:
- List processes and threads
- Find the main thread by slice density
- Aggregate depth-0 bottlenecks on a specific thread
- Drill into depth-1 children of a slow operation
- Inspect OS scheduling (`sched` table) for preemption

The recommended workflow is hierarchical: start at depth 0 to find which top-level operation is slow → drill into depth 1 inside it → depth 2, etc. This mirrors how you'd investigate in a visual profiler but entirely through SQL.

---

## Python dependencies

Install into the local venv before running either script:

```bash
# From the skill directory — using uv (recommended):
uv venv .venv-perfetto
uv pip install -r references/requirements-perfetto.txt

# Or with plain pip (activate your venv first):
source .venv-perfetto/bin/activate
pip install -r references/requirements-perfetto.txt
```

| Package | Used by | Purpose |
|---|---|---|
| `perfetto>=0.16.0` | Phase 1 + Phase 2 | Loads `.pftrace` into an in-memory SQLite DB; provides `TraceProcessor` |
| `pandas` | Phase 2 only | Converts SQL query results to CSV for the server protocol |

Requires **Python 3.9+**. Create a local virtual environment (e.g. `uv venv .venv-perfetto`) and install deps into it to avoid affecting the system Python. The venv is not committed to the repo.

---

## Maintaining this skill

### Adding new slice name patterns

If you find that important Lens operations aren't surfacing in `topSlices`, check whether their slice names match anything useful. The aggregation query in `analyze_lens_trace.py` captures all slices — the issue is usually that the AI doesn't recognize the name. Update `SKILL.md` with notes on what specific slice names mean in the Lens Studio context.

### Tuning capture profile detection

If the Spectacles/mobile auto-detection is wrong for a new trace type, update the `rules` list in `_infer_capture_profile()` in `analyze_lens_trace.py`. Each rule is a tuple of `(substring, spectacles_points, mobile_points, label)`.

### Adjusting frame budgets

Frame budget thresholds are derived from `captureProfile` in `_analyze_trace()`:
- `slow_frame_budget_ms = 16.67` for Spectacles, `33.3` for mobile
- LAT target is hardcoded at 200ms in `thresholds.latTargetMs`

### Adding new Phase 2 SQL recipes

Add them to `references/sql-recipes.md` and update the Phase 2 section of `SKILL.md` with any new escalation triggers.
