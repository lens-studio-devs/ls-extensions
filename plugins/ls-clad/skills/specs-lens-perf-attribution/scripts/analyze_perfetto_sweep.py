#!/usr/bin/env python3
# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

"""Analyze Lens Studio performance sweep SQLite exports and generate attribution charts."""

from __future__ import annotations

import argparse
import csv
import json
import math
import sqlite3
import statistics
from pathlib import Path
from typing import Dict, List, Optional, Tuple


def pct(vals: List[float], q: float) -> float:
    vals = sorted(vals)
    if not vals:
        return 0.0
    k = (len(vals) - 1) * q / 100.0
    f = math.floor(k)
    c = math.ceil(k)
    return vals[f] if f == c else vals[f] * (c - k) + vals[c] * (k - f)


def mean(vals: List[float]) -> float:
    return statistics.mean(vals) if vals else 0.0


# Counters that accumulate during a frame and reset to 0 at the frame boundary.
# Averaging their raw samples (with the 0 resets and intra-frame steps) under-
# reports the per-frame value, so reduce to one peak per frame first.
ACCUMULATING_COUNTERS = {"DrawCalls", "RenderedVertices", "MangledVisual"}


def counter_frame_peaks(values: List[float]) -> List[float]:
    """Segment ts-ordered counter samples on each 0 reset, keeping each frame's max.

    Mirrors counter_frames() in analyze_perfetto_attribution.py.
    """
    frames: List[float] = []
    current: List[float] = []
    for v in values:
        if v == 0 and current:
            frames.append(max(current))
            current = []
        else:
            current.append(float(v))
    if current:
        frames.append(max(current))
    return frames


def table_exists(cur: sqlite3.Cursor, name: str) -> bool:
    row = cur.execute(
        "SELECT 1 FROM sqlite_master WHERE name=? AND type IN ('table','view') LIMIT 1",
        (name,),
    ).fetchone()
    return bool(row)


def pick_table(cur: sqlite3.Cursor, *names: str) -> Optional[str]:
    for name in names:
        if table_exists(cur, name):
            return name
    return None


SOURCE_SQL = {
    "All slices all depths": "dur>=0",
    "Top-level slices": "dur>=0 and parent_id is null",
    "ShapeTrack": "name='ShapeTrack'",
    "Scene Update": "name='Scene Update'",
    "Scene AnimationSystem": "name='Scene AnimationSystem'",
    "Script updates": "category='ScnComponent' and name like 'Component.ScriptComponent update %'",
    "VFX update": "category='ScnComponent' and name like 'Component.VFXComponent update %'",
    "Audio update": "category='ScnComponent' and name like 'Component.AudioComponent update %'",
    "LookAt lateUpdate": "category='ScnComponent' and name like 'Component.LookAtComponent lateUpdate %'",
    "Physics lateUpdate": "category='ScnComponent' and name like 'Physics.ColliderComponent lateUpdate %'",
    "Camera total": "category='ScnCamera'",
    "RenderTarget total": "category='ScnRenderTarget'",
    "Visual total": "category='ScnVisual'",
    "DrawCall total": "category='ScnRenderDrawCall'",
    "ShaderGet total": "category='ScnRenderShaderGet'",
}


def frame_starts(cur: sqlite3.Cursor, slice_t: str, lo_ns: int) -> List[int]:
    starts = [
        r[0] for r in cur.execute(f"select ts from {slice_t} where name='Scene Start' and ts>=? order by ts", (lo_ns,))
    ]
    if len(starts) < 2:
        starts = [
            r[0]
            for r in cur.execute(f"select ts from {slice_t} where name='Scene Update' and ts>=? order by ts", (lo_ns,))
        ]
    return starts


def analyze_stage(stage: dict, skip_seconds: float) -> Dict[str, float | str | int]:
    db = Path(stage["sqlite"])
    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    slice_t = pick_table(cur, "__intrinsic_slice", "slice")
    counter_t = pick_table(cur, "__intrinsic_counter", "counter")
    track_t = pick_table(cur, "__intrinsic_track", "counter_track", "track")
    if not slice_t:
        raise RuntimeError(f"No slice table/view in {db}")

    min_ts, max_ts = cur.execute(
        f"select min(ts), max(ts+case when dur>=0 then dur else 0 end) from {slice_t}"
    ).fetchone()
    if min_ts is None:
        raise RuntimeError(f"No slice data in {db}")
    lo = int(min_ts + skip_seconds * 1_000_000_000)
    starts = frame_starts(cur, slice_t, lo)
    frames = max(0, len(starts) - 1)
    intervals = [(b - a) / 1e6 for a, b in zip(starts, starts[1:])]

    out: Dict[str, float | str | int] = {
        "label": stage["label"],
        "sqlite": str(db),
        "frames": frames,
        "slice_span_s": (max_ts - min_ts) / 1e9,
        "avg_interval_ms": mean(intervals),
        "p95_interval_ms": pct(intervals, 95),
        "fps": 1000.0 / mean(intervals) if intervals and mean(intervals) > 0 else 0.0,
    }

    if frames:
        for name, cond in SOURCE_SQL.items():
            vals = []
            for a, b in zip(starts, starts[1:]):
                vals.append(
                    cur.execute(
                        f"select coalesce(sum(dur),0)/1e6 from {slice_t} where ts>=? and ts<? and {cond}",
                        (a, b),
                    ).fetchone()[0]
                )
            out[name] = mean(vals)
            out[f"{name} p95"] = pct(vals, 95)
    else:
        for name in SOURCE_SQL:
            out[name] = 0.0
            out[f"{name} p95"] = 0.0

    for counter_name in [
        "DrawCalls",
        "RenderedVertices",
        "MangledVisual",
        "TexturesMemory",
        "MeshesMemory",
        "ResourcesMemory",
    ]:
        vals = []
        if counter_t and track_t:
            vals = [
                r[0]
                for r in cur.execute(
                    f"select c.value from {counter_t} c join {track_t} t on t.id=c.track_id "
                    "where t.name=? and c.ts>=? order by c.ts",
                    (counter_name, lo),
                )
            ]
        # Accumulating counters need per-frame peaks; memory gauges are absolute.
        series = counter_frame_peaks(vals) if counter_name in ACCUMULATING_COUNTERS else vals
        out[counter_name] = mean(series)
        out[f"{counter_name} max"] = max(series) if series else 0.0

    conn.close()
    return out


def load_manifest(path: Path) -> dict:
    with path.open(encoding="utf-8") as f:
        manifest = json.load(f)
    if not manifest.get("stages"):
        raise SystemExit("Manifest must contain a non-empty stages array")
    if not any(s.get("baseline") for s in manifest["stages"]):
        manifest["stages"][0]["baseline"] = True
    return manifest


def write_csv(path: Path, rows: List[dict], fields: List[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)


def draw_donut(
    items: List[Tuple[str, float]], total: float, project: str, subtitle: str, footer: str, out: Path
) -> None:
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except Exception as e:  # pragma: no cover
        print(f"Skipping chart {out}: matplotlib unavailable: {e}")
        return

    if not items:
        return
    labels = [x[0] for x in items]
    values = [x[1] for x in items]
    palette = [
        "#9da3aa",
        "#1f77b4",
        "#aec7e8",
        "#ff7f0e",
        "#ffbb78",
        "#2ca02c",
        "#98df8a",
        "#d62728",
        "#ff9896",
        "#9467bd",
        "#c5b0d5",
        "#8c564b",
        "#c49c94",
        "#e377c2",
        "#7f7f7f",
    ]
    colors = [palette[i % len(palette)] for i in range(len(values))]

    fig, ax = plt.subplots(figsize=(16, 10), dpi=160)
    fig.patch.set_facecolor("white")
    wedges, _ = ax.pie(
        values,
        colors=colors,
        startangle=90,
        counterclock=False,
        wedgeprops={"width": 0.34, "edgecolor": "white", "linewidth": 2.0},
        radius=1.0,
    )
    ax.axis("equal")

    for i, w in enumerate(wedges):
        ang = (w.theta1 + w.theta2) / 2.0
        rad = math.radians(ang)
        x = math.cos(rad)
        y = math.sin(rad)
        sx, sy = 0.84 * x, 0.84 * y
        ex, ey = 1.08 * x, 1.08 * y
        lx, ly = 1.32 * x, 1.32 * y
        ha = "left" if x >= 0 else "right"
        p = values[i] / total * 100 if total else 0
        text = f"{labels[i]}\n{values[i]:.2f} ms/f • {p:.1f}%"
        ax.plot([sx, ex, lx * 0.96], [sy, ey, ly], color=colors[i], linewidth=1.2)
        ax.text(lx, ly, text, ha=ha, va="center", fontsize=10.5, color="#111")

    ax.text(0, 0.10, "Attributed\nframe time", ha="center", va="center", fontsize=23, weight="bold")
    ax.text(0, -0.18, f"{total:.2f} ms/frame", ha="center", va="center", fontsize=17, color="#555")
    ax.text(0, -0.34, subtitle, ha="center", va="center", fontsize=11, color="#777")
    fig.text(0.03, 0.955, f"{project}: attributed frame-time contributors", fontsize=28, weight="bold", ha="left")
    fig.text(0.03, 0.035, footer, fontsize=10, color="#666", ha="left")
    plt.subplots_adjust(left=0.04, right=0.96, top=0.88, bottom=0.10)
    out.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(out, bbox_inches="tight")
    plt.close(fig)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--manifest", required=True, type=Path, help="JSON sweep manifest")
    ap.add_argument("--out-dir", type=Path, default=None, help="Output directory (default: manifest directory)")
    args = ap.parse_args()

    manifest = load_manifest(args.manifest)
    out_dir = args.out_dir or args.manifest.parent
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_dir = args.manifest.parent
    for stage in manifest["stages"]:
        sqlite_path = Path(stage["sqlite"])
        if not sqlite_path.is_absolute():
            stage["sqlite"] = str((manifest_dir / sqlite_path).resolve())
    project = manifest.get("projectName", "Lens")
    skip = float(manifest.get("skipSeconds", 2.0))
    metric_name = "Top-level slices" if manifest.get("metric") == "top-level" else "All slices all depths"

    summaries = [analyze_stage(s, skip) for s in manifest["stages"]]
    summary_fields = [
        "label",
        "sqlite",
        "frames",
        "avg_interval_ms",
        "p95_interval_ms",
        "fps",
        "All slices all depths",
        "Top-level slices",
        "ShapeTrack",
        "Scene Update",
        "Script updates",
        "Scene AnimationSystem",
        "Camera total",
        "RenderTarget total",
        "Visual total",
        "DrawCall total",
        "VFX update",
        "Audio update",
        "LookAt lateUpdate",
        "Physics lateUpdate",
        "DrawCalls",
        "RenderedVertices",
    ]
    write_csv(out_dir / "trace_summary.csv", summaries, summary_fields)

    diffs = []
    prev = None
    for stage, summary in zip(manifest["stages"], summaries):
        if prev is None or stage.get("baseline"):
            delta = float(summary[metric_name])
            kind = "baseline"
        else:
            delta = float(summary[metric_name]) - float(prev[metric_name])
            kind = "delta"
        diffs.append(
            {
                "label": summary["label"],
                "kind": kind,
                "delta_ms_per_frame": delta,
                "positive_delta_ms_per_frame": max(0.0, delta),
                "metric": metric_name,
            }
        )
        prev = summary

    total_with_baseline = sum(d["positive_delta_ms_per_frame"] for d in diffs)
    total_project = sum(d["positive_delta_ms_per_frame"] for d in diffs if d["kind"] != "baseline")
    for d in diffs:
        d["pct_with_baseline"] = (
            (d["positive_delta_ms_per_frame"] / total_with_baseline * 100) if total_with_baseline else 0
        )
        d["pct_project_only"] = (
            (d["positive_delta_ms_per_frame"] / total_project * 100) if total_project and d["kind"] != "baseline" else 0
        )

    write_csv(
        out_dir / "differential_attribution.csv",
        diffs,
        [
            "label",
            "kind",
            "metric",
            "delta_ms_per_frame",
            "positive_delta_ms_per_frame",
            "pct_with_baseline",
            "pct_project_only",
        ],
    )

    footer = (
        "Source: performance sweep traces + differential attribution. Positive deltas only. "
        "Values are attributed slice ms/frame, not CPU core-time."
    )
    incl = [(d["label"], d["positive_delta_ms_per_frame"]) for d in diffs if d["positive_delta_ms_per_frame"] > 0.02]
    proj = [
        (d["label"], d["positive_delta_ms_per_frame"])
        for d in diffs
        if d["kind"] != "baseline" and d["positive_delta_ms_per_frame"] > 0.02
    ]
    draw_donut(
        incl,
        sum(v for _, v in incl),
        project,
        "including preview/editor baseline",
        footer,
        out_dir / "attribution_incl_baseline.png",
    )
    draw_donut(
        proj,
        sum(v for _, v in proj),
        project,
        "project-only\npreview baseline excluded",
        footer,
        out_dir / "attribution_project_only.png",
    )

    with (out_dir / "optimization_seed.md").open("w", encoding="utf-8") as f:
        f.write(f"# {project} profiling attribution\n\n")
        f.write(f"Metric: `{metric_name}`; warmup skipped: {skip:.1f}s.\n\n")
        f.write(f"Total including baseline: **{total_with_baseline:.2f} ms/frame**.\n\n")
        f.write(f"Project-only total: **{total_project:.2f} ms/frame**.\n\n")
        f.write(
            "Values are attributed slice ms/frame, not CPU core-time — "
            "Lens Studio Preview performance traces do not expose scheduler/CPU tables.\n\n"
        )
        f.write("## Prioritized project-only contributors\n\n")
        for d in sorted(
            [x for x in diffs if x["kind"] != "baseline" and x["positive_delta_ms_per_frame"] > 0.02],
            key=lambda x: x["positive_delta_ms_per_frame"],
            reverse=True,
        ):
            f.write(
                f"- **{d['label']}**: {d['positive_delta_ms_per_frame']:.2f} ms/frame "
                f"({d['pct_project_only']:.1f}% project-only). "
                "Investigate owned scripts/assets/components in this stage.\n"
            )

    print(f"Wrote {out_dir / 'trace_summary.csv'}")
    print(f"Wrote {out_dir / 'differential_attribution.csv'}")
    print(f"Wrote {out_dir / 'attribution_incl_baseline.png'}")
    print(f"Wrote {out_dir / 'attribution_project_only.png'}")
    print(f"Wrote {out_dir / 'optimization_seed.md'}")


if __name__ == "__main__":
    main()
