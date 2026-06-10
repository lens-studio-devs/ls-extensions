#!/usr/bin/env python3
# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

"""Parse /specs-lens-perf-attribution output into a queue of optimization candidates.

Reads:
  <attribution-dir>/differential_attribution.csv
  <attribution-dir>/slice_deltas_vs_base.csv
  <attribution-dir>/optimization_candidates.md   (optional, for source_line)
  <attribution-dir>/metrics_compact.json         (optional, for cross-check)

Writes:
  <attribution-dir>/candidates.json — array of candidate dicts ordered by
  predicted impact (descending). Each row:
    {
      "candidate_id":        str,
      "category":            str,   # one of the taxonomy keys (see SKILL.md references)
      "predicted_delta_ms":  float, # delta_attributed_ms_per_frame
      "stage_label":         str,   # trace name (the cumulative stage)
      "baseline_trace":      str,
      "top_slices":          [{category, name, delta_ms_per_frame, max_ms, count}],
      "recipe_hint":         str,   # human-readable focus from optimization_candidates.md
      "source_line":         str    # "optimization_candidates.md:NN" if found
    }
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path
from typing import Dict, List, Optional

CATEGORY_KEYS = (
    "camera/render",
    "mesh/visual/draw",
    "tracking/ML/gesture",
    "script/component/logic",
    "VFX/particle",
    "generic",
)


def classify(label: str, top_slice_text: str) -> str:
    """Return one of CATEGORY_KEYS. Mirrors specs-lens-perf-attribution's recommendation_for() so that
    candidate categories match the recipes documented in references/recommendation_taxonomy.md."""
    text = f"{label} {top_slice_text}".lower()
    label_text = label.lower()
    if any(x in label_text for x in ("camera", "render camera")):
        return "camera/render"
    if any(x in label_text for x in ("mesh", "visual", "draw", "body static", "vertices", "skinned")):
        return "mesh/visual/draw"
    if any(x in label_text for x in ("tracking", "sik", "gesture", "ml")):
        return "tracking/ML/gesture"
    if any(x in label_text for x in ("script", "controller", "logic")):
        return "script/component/logic"
    if any(x in text for x in ("vfx", "particle", "ngs", "render target", "render_target")):
        return "VFX/particle"
    if any(x in text for x in ("draw", "visual", "mesh", "vertices", "skinned")):
        return "mesh/visual/draw"
    if any(x in text for x in ("tracking", "shape", "objecttracking", "sik", "gesture", "ml")):
        return "tracking/ML/gesture"
    if any(x in text for x in ("script", "component", "controller", "update")):
        return "script/component/logic"
    if any(x in text for x in ("camera", "render")):
        return "camera/render"
    return "generic"


def slug(label: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")
    return base or "candidate"


def parse_diff_csv(path: Path) -> List[dict]:
    rows: List[dict] = []
    with path.open(newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            try:
                delta = float(r.get("delta_attributed_ms_per_frame") or 0.0)
            except (TypeError, ValueError):
                delta = 0.0
            rows.append(
                {
                    "trace": r["trace"],
                    "label": r["label"],
                    "baseline_trace": r["baseline_trace"],
                    "delta_attributed_ms_per_frame": delta,
                }
            )
    return rows


def parse_slice_csv(path: Path) -> Dict[str, List[dict]]:
    """Group slice rows by trace name, sorted by abs(delta_ms_per_frame) descending."""
    by_trace: Dict[str, List[dict]] = {}
    if not path.exists():
        return by_trace
    with path.open(newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            try:
                d = float(r.get("delta_ms_per_frame") or 0.0)
                m = float(r.get("max_ms") or 0.0)
                c = int(float(r.get("count") or 0))
            except (TypeError, ValueError):
                d, m, c = 0.0, 0.0, 0
            by_trace.setdefault(r["trace"], []).append(
                {
                    "category": r.get("category", ""),
                    "name": r.get("name", ""),
                    "delta_ms_per_frame": d,
                    "max_ms": m,
                    "count": c,
                }
            )
    for trace in by_trace:
        by_trace[trace].sort(key=lambda s: abs(s["delta_ms_per_frame"]), reverse=True)
    return by_trace


def parse_candidates_md(path: Path) -> Dict[str, int]:
    """Return {trace_label: 1-based source-line-number}. The md uses headers like
    '## 1. <label> — 1.82 ms/frame (12.3%)'. We index by the label text (post the
    leading 'N. ' and pre the em-dash)."""
    out: Dict[str, int] = {}
    if not path.exists():
        return out
    header_re = re.compile(r"^##\s+\d+\.\s+(.+?)\s+—\s+")
    with path.open(encoding="utf-8") as f:
        for i, line in enumerate(f, 1):
            m = header_re.match(line)
            if m:
                out[m.group(1).strip()] = i
    return out


def recipe_hint_from_md(path: Path, label: str) -> Optional[str]:
    """Return the 'Recommended focus: ...' text for the labelled section."""
    if not path.exists():
        return None
    rec_re = re.compile(r"^Recommended focus:\s*(.+)$", re.M)
    header_re = re.compile(
        r"^##\s+\d+\.\s+" + re.escape(label) + r"\s+—\s+.+?$\n([\s\S]*?)(?=^##\s+\d+\.|\Z)",
        re.M,
    )
    text = path.read_text(encoding="utf-8")
    sec = header_re.search(text)
    if not sec:
        return None
    rec = rec_re.search(sec.group(1))
    return rec.group(1).strip() if rec else None


def build_candidates(attribution_dir: Path, min_delta_ms: float, top_n_slices: int = 5) -> List[dict]:
    diff_csv = attribution_dir / "differential_attribution.csv"
    slice_csv = attribution_dir / "slice_deltas_vs_base.csv"
    md = attribution_dir / "optimization_candidates.md"

    if not diff_csv.exists():
        raise SystemExit(f"missing input: {diff_csv}")

    diff_rows = parse_diff_csv(diff_csv)
    slices_by_trace = parse_slice_csv(slice_csv)
    line_by_label = parse_candidates_md(md)

    positives = [r for r in diff_rows if r["delta_attributed_ms_per_frame"] >= min_delta_ms]
    positives.sort(key=lambda r: r["delta_attributed_ms_per_frame"], reverse=True)

    candidates: List[dict] = []
    for r in positives:
        top = slices_by_trace.get(r["trace"], [])[:top_n_slices]
        slice_text = "; ".join(f"{s['category']}:{s['name']}" for s in top)
        category = classify(r["label"], slice_text)
        cid = f"{slug(category.split('/')[0])}-{slug(r['label'])}-{round(r['delta_attributed_ms_per_frame'] * 100):04d}"
        candidates.append(
            {
                "candidate_id": cid,
                "category": category,
                "predicted_delta_ms": round(r["delta_attributed_ms_per_frame"], 4),
                "stage_label": r["trace"],
                "baseline_trace": r["baseline_trace"],
                "top_slices": top,
                "recipe_hint": recipe_hint_from_md(md, r["label"]) or "",
                "source_line": (
                    f"optimization_candidates.md:{line_by_label[r['label']]}" if r["label"] in line_by_label else ""
                ),
            }
        )
    return candidates


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("attribution_dir", type=Path)
    p.add_argument("--min-delta-ms", type=float, default=0.20)
    p.add_argument("--top-n-slices", type=int, default=5)
    p.add_argument("--out", type=Path, default=None, help="Output path (default: <attribution_dir>/candidates.json)")
    args = p.parse_args()

    attribution_dir = args.attribution_dir.resolve()
    if not attribution_dir.exists():
        raise SystemExit(f"attribution_dir does not exist: {attribution_dir}")

    candidates = build_candidates(attribution_dir, args.min_delta_ms, args.top_n_slices)
    out = args.out or (attribution_dir / "candidates.json")
    out.write_text(json.dumps(candidates, indent=2), encoding="utf-8")
    print(f"Wrote {len(candidates)} candidates to {out}", file=sys.stderr)
    by_cat: Dict[str, int] = {}
    for c in candidates:
        by_cat[c["category"]] = by_cat.get(c["category"], 0) + 1
    for cat in CATEGORY_KEYS:
        if cat in by_cat:
            print(f"  {cat}: {by_cat[cat]}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
