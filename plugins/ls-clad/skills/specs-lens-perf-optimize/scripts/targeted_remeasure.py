#!/usr/bin/env python3
# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

"""Targeted 2-trace re-run of specs-lens-perf-attribution for /specs-lens-perf-optimize.

Given a focus stage (a trace name from the original sweep) and the directory of
existing .sqlite/.pftrace exports + new post-fix traces, invokes the sibling
analyze_perfetto_attribution.py with a --comparisons CSV that pairs only:

    <focus_stage> over <baseline_of_focus_stage>

The result is a metrics_compact.json whose `differentials[]` lists exactly one
row — the orchestrator reads `trace_attr_ms_per_frame` as the new ms/frame for
the project's full scenario stage if `focus_stage` is the full-scenario trace,
or as the new contribution of `focus_stage` over its predecessor otherwise.

Inputs:
  --attribution-dir   directory containing original + post-fix exports
  --focus-stage       trace name (matches the manifest's stage label)
  --baseline-trace    trace name to compare against (predecessor stage)
  --trace-processor   path to trace_processor_shell (optional)
  --target-fps        default 30
  --warmup-s          default 2.0
  --out-dir           where to write the per-call analysis (default
                      <attribution-dir>/targeted_<focus_stage>_<ts>/)

Writes the analyze script's outputs into --out-dir and prints a single line of
JSON: {"ms_per_frame": <float>, "trace_dir": "<out-dir>"}
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ANALYZE_SCRIPT_RELATIVE = "../../specs-lens-perf-attribution/scripts/analyze_perfetto_attribution.py"


def resolve_analyze_script() -> Path:
    here = Path(__file__).resolve().parent
    candidate = (here / ANALYZE_SCRIPT_RELATIVE).resolve()
    if not candidate.exists():
        raise SystemExit(f"could not find analyze_perfetto_attribution.py at {candidate} — check repo layout")
    return candidate


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--attribution-dir", type=Path, required=True)
    p.add_argument("--focus-stage", required=True)
    p.add_argument("--baseline-trace", required=True)
    p.add_argument("--trace-processor", default=None)
    p.add_argument("--target-fps", type=float, default=30.0)
    p.add_argument("--warmup-s", type=float, default=2.0)
    p.add_argument("--out-dir", type=Path, default=None)
    p.add_argument("--project-label", default="Lens project")
    args = p.parse_args()

    attribution_dir = args.attribution_dir.resolve()
    if not attribution_dir.exists():
        raise SystemExit(f"attribution-dir does not exist: {attribution_dir}")

    ts = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    # Sanitize focus_stage for use in a directory name — labels like "Stage 1: Update"
    # contain characters (':', '>') that are illegal in Windows paths and would crash mkdir.
    safe_stage = re.sub(r"[^A-Za-z0-9._-]+", "_", args.focus_stage).strip("_") or "stage"
    out_dir = (args.out_dir or (attribution_dir / f"targeted_{safe_stage}_{ts}")).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    # Build the one-line comparisons CSV (csv module handles commas/quotes in trace names)
    comparisons = out_dir / "comparisons.csv"
    with comparisons.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["trace", "label", "baseline_trace"])
        writer.writerow([args.focus_stage, args.focus_stage, args.baseline_trace])

    analyze = resolve_analyze_script()
    cmd = [
        sys.executable,
        str(analyze),
        str(attribution_dir),
        "--out-dir",
        str(out_dir),
        "--comparisons",
        str(comparisons),
        "--target-fps",
        str(args.target_fps),
        "--warmup-s",
        str(args.warmup_s),
        "--project-label",
        args.project_label,
    ]
    if args.trace_processor:
        cmd += ["--trace-processor", args.trace_processor]
    elif os.environ.get("PERFETTO_TRACE_PROCESSOR"):
        cmd += ["--trace-processor", os.environ["PERFETTO_TRACE_PROCESSOR"]]
    elif shutil.which("trace_processor_shell"):
        cmd += ["--trace-processor", shutil.which("trace_processor_shell")]

    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.stderr.write(proc.stdout)
        sys.stderr.write(proc.stderr)
        raise SystemExit(f"analyze_perfetto_attribution.py failed (exit {proc.returncode})")

    metrics_json = out_dir / "metrics_compact.json"
    if not metrics_json.exists():
        raise SystemExit(f"analyze did not produce {metrics_json}")
    metrics = json.loads(metrics_json.read_text(encoding="utf-8"))
    diffs = metrics.get("differentials", [])
    if not diffs:
        raise SystemExit("targeted analysis produced no differentials — check focus_stage/baseline_trace names")

    # The single differential row tells us the focus stage's project-attributed total ms/frame.
    row = diffs[0]
    ms_per_frame = float(row.get("trace_attr_ms_per_frame", 0.0))
    print(json.dumps({"ms_per_frame": round(ms_per_frame, 4), "trace_dir": str(out_dir)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
