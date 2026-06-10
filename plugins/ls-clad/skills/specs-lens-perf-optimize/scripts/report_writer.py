#!/usr/bin/env python3
# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

"""Render perf_optimization_report.md from the orchestrator's running log.

Reads:
  --log <path>          JSON list of iteration records produced by the orchestrator.
                        Each record:
                          {
                            "iter": int,
                            "candidate": {candidate_id, category, predicted_delta_ms,
                                          stage_label, top_slices[]},
                            "tactic": str,
                            "parity": <visual_diff.py output> | null,
                            "measured": <perf-attribution-runner output> | null,
                            "delta_ms": float | null,
                            "cum_ms": float,
                            "status": "kept" | "reverted" | "skipped" | "unsupported"
                                      | "compile_failed" | "unresolved" | "error",
                            "reason": str,
                            "commit_sha": str | null,
                            "trace_dir": str | null,
                            "wall_ms": int
                          }
  --baseline <float>    state.start_ms
  --final    <float>    closing full-sweep ms/frame (optional; omit on a hard stop)
  --branch   <str>      branch name
  --commit-range <str>  e.g. "abc1234..def5678"
  --stop-reason  <str>
  --wall-clock-min <float>
  --out      <path>     output path for perf_optimization_report.md

Also prints a compact summary table to stdout for the user.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import List

HEADERS = (
    "#",
    "category",
    "candidate",
    "pred ms",
    "meas ms",
    "cum ms",
    "SSIM",
    "hist",
    "markers",
    "status",
    "sha",
    "trace dir",
)


def avg(xs: list) -> str:
    xs = [x for x in xs if isinstance(x, (int, float))]
    if not xs:
        return "-"
    return f"{sum(xs) / len(xs):.3f}"


def row_for(rec: dict) -> List[str]:
    cand = rec.get("candidate", {})
    parity = rec.get("parity") or {}
    markers = parity.get("markers") or {}
    ssim_avg = avg([m.get("ssim") for m in markers.values()])
    hist_avg = avg([m.get("histogram_cosine") for m in markers.values()])
    marker_status = (
        "/".join(markers.get(k, {}).get("status", "-")[:2] for k in ("idle", "interaction", "climax")) or "-"
    )
    measured = rec.get("measured") or {}
    return [
        str(rec.get("iter", "?")),
        cand.get("category", "-")[:18],
        cand.get("candidate_id", "-")[:30],
        f"{cand.get('predicted_delta_ms', 0.0):.2f}",
        f"{measured.get('ms_per_frame', 0.0):.2f}" if measured else "-",
        f"{rec.get('cum_ms', 0.0):.2f}",
        ssim_avg,
        hist_avg,
        marker_status,
        rec.get("status", "-"),
        (rec.get("commit_sha") or "-")[:7],
        rec.get("trace_dir", "-") or "-",
    ]


def markdown_table(rows: List[List[str]]) -> str:
    lines = ["| " + " | ".join(HEADERS) + " |"]
    lines.append("| " + " | ".join(["---"] * len(HEADERS)) + " |")
    for r in rows:
        lines.append("| " + " | ".join(r) + " |")
    return "\n".join(lines)


def text_table(rows: List[List[str]]) -> str:
    widths = [max(len(str(c)) for c in [h] + [r[i] for r in rows]) for i, h in enumerate(HEADERS)]
    out = []
    out.append("  ".join(str(h).ljust(widths[i]) for i, h in enumerate(HEADERS)))
    out.append("  ".join("-" * w for w in widths))
    for r in rows:
        out.append("  ".join(str(c).ljust(widths[i]) for i, c in enumerate(r)))
    return "\n".join(out)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--log", type=Path, required=True)
    p.add_argument("--baseline", type=float, required=True)
    p.add_argument(
        "--final",
        type=float,
        default=None,
        help="Final ms/frame; omit when the closing sweep was skipped (e.g. a hard stop).",
    )
    p.add_argument("--branch", default="")
    p.add_argument("--commit-range", default="")
    p.add_argument("--stop-reason", default="queue exhausted")
    p.add_argument("--wall-clock-min", type=float, default=0.0)
    p.add_argument("--out", type=Path, required=True)
    args = p.parse_args()

    records: List[dict] = json.loads(args.log.read_text(encoding="utf-8"))

    kept = sum(1 for r in records if r.get("status") == "kept")
    reverted = sum(1 for r in records if r.get("status") not in ("kept", "skipped", "unsupported"))
    skipped = sum(1 for r in records if r.get("status") in ("skipped", "unsupported"))
    have_final = args.final is not None
    saved = (args.baseline - args.final) if have_final else None
    saved_pct = (saved / args.baseline * 100.0) if (have_final and args.baseline) else None

    rows = [row_for(r) for r in records]

    body = []
    body.append("# specs-lens-perf-optimize report")
    body.append("")
    body.append(f"- Baseline:  {args.baseline:.2f} ms/frame (project-attributed)")
    if have_final:
        pct = f"{saved_pct:.1f}%" if saved_pct is not None else "n/a"  # saved_pct is None when baseline == 0
        body.append(f"- Final:     {args.final:.2f} ms/frame")
        body.append(f"- Saved:     {saved:.2f} ms/frame ({pct})")
    else:
        body.append("- Final:     (unavailable — closing full-sweep skipped on hard stop)")
        body.append("- Saved:     (unavailable)")
    body.append(f"- Iterations attempted: {len(records)} (kept {kept}, reverted {reverted}, skipped {skipped})")
    body.append(f"- Wall-clock: {args.wall_clock_min:.1f} min")
    body.append(f"- Branch:    {args.branch or '(unset)'}")
    body.append(f"- Range:     {args.commit_range or '(unset)'}")
    body.append(f"- Stop:      {args.stop_reason}")
    body.append("")
    body.append("## Iterations")
    body.append("")
    body.append(markdown_table(rows))
    body.append("")
    body.append("## Per-iteration reasons")
    body.append("")
    for r in records:
        body.append(
            f"- **#{r.get('iter')}** `{r.get('candidate', {}).get('candidate_id', '?')}` "
            f"({r.get('status', '?')}): {r.get('reason', '')}"
        )
    body.append("")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("\n".join(body), encoding="utf-8")

    # Stdout summary
    print(f"Baseline:    {args.baseline:.2f} ms/frame")
    if have_final:
        pct = f"{saved_pct:.1f}%" if saved_pct is not None else "n/a"
        print(f"Final:       {args.final:.2f} ms/frame")
        print(f"Saved:       {saved:.2f} ms/frame ({pct})")
    else:
        print("Final:       (unavailable — closing full-sweep skipped on hard stop)")
        print("Saved:       (unavailable)")
    print(f"Iterations:  {len(records)} attempted ({kept} kept, {reverted} reverted, {skipped} skipped)")
    print(f"Wall-clock:  {args.wall_clock_min:.1f} min")
    print(f"Branch:      {args.branch}")
    print(f"Range:       {args.commit_range}")
    print(f"Stop:        {args.stop_reason}")
    print(f"Report:      {args.out}")
    print()
    print(text_table(rows))
    return 0


if __name__ == "__main__":
    sys.exit(main())
