#!/usr/bin/env python3
# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

"""Analyze a Lens Studio Preview performance-trace differential attribution sweep.

Input: a directory containing .sqlite performance-trace exports and/or .pftrace files.
Output: CSV summaries, a positive-delta donut chart, and optimization candidates.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import shutil
import sqlite3
import subprocess
import sys
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

LENS_CATEGORIES = (
    "ShapeTrack",
    "ScnCamera",
    "ScnRenderTarget",
    "ScnRenderDrawCall",
    "ScnComponent",
    "ScnVisual",
    "ScnOther",
)
COUNTERS = ("DrawCalls", "RenderedVertices", "MangledVisual")

COLOR_PALETTE = [
    "#4E79A7",
    "#F28E2B",
    "#E15759",
    "#76B7B2",
    "#59A14F",
    "#EDC948",
    "#B07AA1",
    "#FF9DA7",
    "#9C755F",
    "#BAB0AC",
    "#5B8FF9",
    "#61DDAA",
    "#65789B",
    "#F6BD16",
    "#7262FD",
    "#78D3F8",
    "#9661BC",
    "#F6903D",
]


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("trace_dir", type=Path, help="Directory containing .sqlite and/or .pftrace traces")
    p.add_argument("--out-dir", type=Path, default=None, help="Output directory (default: trace_dir)")
    p.add_argument(
        "--trace-processor",
        default=None,
        help="Path to trace_processor_shell/trace_processor for exporting .pftrace to .sqlite",
    )
    p.add_argument("--overwrite-sqlite", action="store_true", help="Re-export .pftrace files even when .sqlite exists")
    p.add_argument("--project-label", default="Lens project", help="Project name for chart/report titles")
    p.add_argument("--title", default=None, help="Chart title override")
    p.add_argument("--warmup-s", type=float, default=2.0, help="Seconds to skip from the start of each trace")
    p.add_argument("--target-fps", type=float, default=30.0, help="FPS used for delta ms/frame normalization")
    p.add_argument("--all-off", default="00_all_off", help="All-off baseline trace name or substring")
    p.add_argument("--camera", default="01_camera", help="Camera-only trace name or substring")
    p.add_argument("--base", default="02", help="Tracking/project backbone base trace name or substring")
    p.add_argument("--full", default="full", help="Full scenario trace name or substring")
    p.add_argument("--comparisons", type=Path, default=None, help="Optional CSV: trace,label,baseline_trace")
    p.add_argument("--include-full-in-donut", action="store_true", help="Include full-scenario deltas in donut")
    p.add_argument("--include-baseline", action="store_true", help="Include all-off Preview baseline as a donut slice")
    p.add_argument(
        "--include-all-categories", action="store_true", help="Sum all slice categories instead of Lens categories only"
    )
    p.add_argument(
        "--min-donut-ms", type=float, default=0.005, help="Minimum positive delta ms/frame included in donut"
    )
    p.add_argument(
        "--max-donut-slices",
        type=int,
        default=14,
        help="Maximum slices before combining remainder as Other; 0 disables",
    )
    p.add_argument("--exclude-donut-regex", default="", help="Regex of labels to omit from donut")
    p.add_argument(
        "--slice-delta-threshold-ms-s",
        type=float,
        default=1.0,
        help="Minimum abs slice delta in ms/s for slice_deltas_vs_base.csv",
    )
    return p.parse_args()


def table_exists(cur: sqlite3.Cursor, name: str) -> bool:
    row = cur.execute(
        "SELECT 1 FROM sqlite_master WHERE name=? AND type IN ('table','view') LIMIT 1", (name,)
    ).fetchone()
    return bool(row)


def pick_table(cur: sqlite3.Cursor, *names: str) -> Optional[str]:
    for name in names:
        if table_exists(cur, name):
            return name
    return None


def rows(cur: sqlite3.Cursor, sql: str, params: Sequence = ()) -> list:
    try:
        return cur.execute(sql, params).fetchall()
    except sqlite3.Error:
        return []


def percentile(vals: Sequence[float], p: float) -> Optional[float]:
    if not vals:
        return None
    xs = sorted(vals)
    k = (len(xs) - 1) * p / 100.0
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return xs[f]
    return xs[f] * (c - k) + xs[c] * (k - f)


def clean_name(stem: str) -> str:
    return re.sub(r"\.(pftrace|sqlite|db)$", "", stem)


def label_from_name(name: str) -> str:
    s = re.sub(r"^\d+[_\- ]*", "", name)
    s = re.sub(r"(_world|_trace|_perfetto)$", "", s, flags=re.I)
    s = s.replace("_", " ").replace("-", " ").strip()
    if not s:
        s = name
    words = []
    for w in s.split():
        up = w.upper()
        if up in {"SIK", "VFX", "ML", "UI", "GPU", "CPU"}:
            words.append(up)
        elif w.lower() in {"ngs"}:
            words.append(w.upper())
        else:
            words.append(w.capitalize())
    return " ".join(words)


def resolve_trace(names: Iterable[str], spec: str, fallbacks: Sequence[str] = ()) -> Optional[str]:
    names = list(names)
    candidates = [spec] + list(fallbacks)
    for c in candidates:
        if c and c in names:
            return c
    lowered = {n.lower(): n for n in names}
    for c in candidates:
        c_low = (c or "").lower()
        for n_low, n in lowered.items():
            if c_low and c_low in n_low:
                return n
    return None


def find_trace_processor(user_path: Optional[str]) -> Optional[str]:
    candidates = []
    if user_path:
        candidates.append(user_path)
    candidates.extend(["/tmp/trace_processor", "trace_processor_shell", "trace_processor"])
    for c in candidates:
        # Resolve to an absolute path: a bare filename that exists only in cwd
        # would otherwise be handed to subprocess, which searches PATH (not cwd)
        # on POSIX and raises FileNotFoundError.
        path = str(Path(c).resolve()) if Path(c).exists() else shutil.which(c)
        if path:
            return str(path)
    return None


def export_pftraces(trace_dir: Path, trace_processor: Optional[str], overwrite: bool) -> None:
    pftraces = sorted(trace_dir.glob("*.pftrace"))
    if not pftraces:
        return
    tp = find_trace_processor(trace_processor)
    if not tp:
        print(
            "[warn] .pftrace files found but no trace processor is available; pass --trace-processor", file=sys.stderr
        )
        return
    for pf in pftraces:
        out = pf.with_suffix(".sqlite")
        if out.exists() and not overwrite:
            continue
        print(f"[export] {pf.name} -> {out.name}")
        subprocess.run([tp, "-e", str(out), str(pf)], check=True)


def trace_bounds(
    cur: sqlite3.Cursor, slice_t: Optional[str], counter_t: Optional[str]
) -> Tuple[Optional[int], Optional[int]]:
    parts = []
    if slice_t:
        parts.append(f"SELECT min(ts) AS lo, max(ts + CASE WHEN dur >= 0 THEN dur ELSE 0 END) AS hi FROM {slice_t}")
    if counter_t:
        parts.append(f"SELECT min(ts) AS lo, max(ts) AS hi FROM {counter_t}")
    if not parts:
        return None, None
    # Aggregate min/max inside each SELECT so the UNION ALL input is one row per
    # table — avoids materializing every slice/counter row into a temp table.
    sql = "SELECT min(lo), max(hi) FROM (" + " UNION ALL ".join(parts) + ")"
    r = rows(cur, sql)
    return (r[0][0], r[0][1]) if r else (None, None)


def counter_frames(
    cur: sqlite3.Cursor,
    counter_t: Optional[str],
    track_t: Optional[str],
    cname: str,
    start_ns: Optional[int] = None,
    end_ns: Optional[int] = None,
) -> List[float]:
    if not counter_t or not track_t:
        return []
    where = "WHERE t.name = ?"
    params: List[object] = [cname]
    if start_ns is not None:
        where += " AND c.ts >= ?"
        params.append(start_ns)
    if end_ns is not None:
        where += " AND c.ts <= ?"
        params.append(end_ns)
    data = rows(
        cur,
        f"""
        SELECT c.ts, c.value
        FROM {counter_t} c JOIN {track_t} t ON t.id = c.track_id
        {where}
        ORDER BY c.ts
    """,
        tuple(params),
    )
    frames: List[float] = []
    curvals: List[float] = []
    for _ts, val in data:
        if val == 0 and curvals:
            frames.append(max(curvals))
            curvals = []
        else:
            curvals.append(float(val))
    if curvals:
        frames.append(max(curvals))
    return frames


def get_metrics(path: Path, include_all_categories: bool, warmup_s: float) -> dict:
    con = sqlite3.connect(path)
    cur = con.cursor()
    slice_t = pick_table(cur, "__intrinsic_slice", "slice")
    counter_t = pick_table(cur, "__intrinsic_counter", "counter")
    track_t = pick_table(cur, "__intrinsic_track", "track")

    start, end = trace_bounds(cur, slice_t, counter_t)
    steady_start = start + int(warmup_s * 1_000_000_000) if start is not None else None
    if steady_start is not None and end is not None and steady_start > end:
        steady_start = start
    duration_s = (
        ((end - steady_start) / 1e9) if steady_start is not None and end is not None and end >= steady_start else 0.0
    )

    scene_durs = []
    if slice_t:
        scene_durs = [
            r[0] / 1e6
            for r in rows(
                cur,
                f"SELECT dur FROM {slice_t} WHERE name='Scene Update' AND dur>=0 AND ts>=? AND ts<=? ORDER BY ts",
                (steady_start or 0, end or 0),
            )
        ]
    frames = len(scene_durs)
    if frames == 0 and slice_t:
        r = rows(
            cur,
            f"SELECT count(*) FROM {slice_t} WHERE depth=0 AND category='ScnCamera' AND ts>=? AND ts<=?",
            (steady_start or 0, end or 0),
        )
        frames = int(r[0][0] or 0) if r else 0
    if frames == 0:
        frames = len(counter_frames(cur, counter_t, track_t, "DrawCalls", steady_start, end))

    category_filter = ""
    params: Tuple = ()
    if not include_all_categories:
        placeholders = ",".join("?" for _ in LENS_CATEGORIES)
        category_filter = f" AND category IN ({placeholders})"
        params = tuple(LENS_CATEGORIES)

    totals: Dict[Tuple[str, str], dict] = {}
    top_components: List[dict] = []
    if slice_t:
        sql = f"""
            SELECT coalesce(category,''), coalesce(name,''), sum(dur)/1e6, count(*), avg(dur)/1e6, max(dur)/1e6
            FROM {slice_t}
            WHERE dur >= 0 AND ts>=? AND ts<=? {category_filter}
            GROUP BY category, name
            ORDER BY sum(dur) DESC
        """
        for cat, name, total, n, avg, mx in rows(cur, sql, (steady_start or 0, end or 0) + params):
            d = {
                "total_ms": float(total or 0),
                "count": int(n or 0),
                "avg_ms": float(avg or 0),
                "max_ms": float(mx or 0),
            }
            totals[(cat or "", name or "")] = d
            if len(top_components) < 80:
                top_components.append({"cat": cat or "", "name": name or "", **d})

    counters = {}
    for cname in COUNTERS:
        vals = counter_frames(cur, counter_t, track_t, cname, steady_start, end)
        if vals:
            counters[cname] = {
                "frames": len(vals),
                "avg": sum(vals) / len(vals),
                "p95": percentile(vals, 95),
                "max": max(vals),
            }

    con.close()
    return {
        "name": clean_name(path.stem),
        "file": path.name,
        "warmup_s": warmup_s,
        "duration_s": duration_s,
        "frames": frames,
        "scene_update_avg_ms": (sum(scene_durs) / len(scene_durs)) if scene_durs else None,
        "scene_update_p95_ms": percentile(scene_durs, 95) if scene_durs else None,
        "scene_update_max_ms": max(scene_durs) if scene_durs else None,
        "totals": totals,
        "counters": counters,
        "top_components": top_components,
    }


def total_attr_ms(m: dict) -> float:
    return sum(v["total_ms"] for v in m["totals"].values())


def attr_ms_per_s(m: dict) -> float:
    return total_attr_ms(m) / m["duration_s"] if m["duration_s"] else 0.0


def key_ms_per_s(m: dict, key: Tuple[str, str]) -> float:
    return m["totals"].get(key, {}).get("total_ms", 0.0) / m["duration_s"] if m["duration_s"] else 0.0


def write_trace_summary(out_dir: Path, metrics: Dict[str, dict], target_fps: float) -> None:
    with (out_dir / "trace_summary.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "trace",
                "file",
                "warmup_s",
                "steady_duration_s",
                "frames",
                "fps",
                "attributed_total_ms",
                "attr_ms_per_s",
                "attr_ms_per_actual_frame",
                f"attr_ms_per_{target_fps:g}fps_frame",
                "scene_update_avg_ms",
                "scene_update_p95_ms",
                "scene_update_max_ms",
                "drawcalls_avg",
                "rendered_vertices_avg",
            ]
        )
        for name in sorted(metrics):
            m = metrics[name]
            total = total_attr_ms(m)
            fps = m["frames"] / m["duration_s"] if m["duration_s"] else 0.0
            w.writerow(
                [
                    name,
                    m["file"],
                    round(float(m.get("warmup_s") or 0), 3),
                    round(m["duration_s"], 3),
                    m["frames"],
                    round(fps, 2),
                    round(total, 3),
                    round(attr_ms_per_s(m), 3),
                    round(total / m["frames"], 4) if m["frames"] else "",
                    round(attr_ms_per_s(m) / target_fps, 4) if target_fps else "",
                    "" if m["scene_update_avg_ms"] is None else round(m["scene_update_avg_ms"], 4),
                    "" if m["scene_update_p95_ms"] is None else round(m["scene_update_p95_ms"], 4),
                    "" if m["scene_update_max_ms"] is None else round(m["scene_update_max_ms"], 4),
                    round(m["counters"].get("DrawCalls", {}).get("avg", 0), 2),
                    round(m["counters"].get("RenderedVertices", {}).get("avg", 0), 2),
                ]
            )


def write_top_slices(out_dir: Path, metrics: Dict[str, dict]) -> None:
    with (out_dir / "top_slices_by_trace.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "trace",
                "rank",
                "category",
                "name",
                "total_ms",
                "ms_per_s",
                "ms_per_actual_frame",
                "count",
                "avg_ms",
                "max_ms",
            ]
        )
        for name in sorted(metrics):
            m = metrics[name]
            for i, row in enumerate(m["top_components"], 1):
                w.writerow(
                    [
                        name,
                        i,
                        row["cat"],
                        row["name"],
                        round(row["total_ms"], 3),
                        round(row["total_ms"] / m["duration_s"], 3) if m["duration_s"] else 0,
                        round(row["total_ms"] / m["frames"], 4) if m["frames"] else "",
                        row["count"],
                        round(row["avg_ms"], 4),
                        round(row["max_ms"], 3),
                    ]
                )


def load_comparison_csv(path: Path, names: Iterable[str]) -> List[Tuple[str, str, str]]:
    out = []
    with path.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            trace = resolve_trace(names, row.get("trace", ""))
            base = resolve_trace(names, row.get("baseline_trace", ""))
            if trace and base:
                out.append((trace, row.get("label") or label_from_name(trace), base))
    return out


def build_comparisons(
    args: argparse.Namespace, metrics: Dict[str, dict]
) -> Tuple[List[Tuple[str, str, str]], Optional[str], Optional[str], Optional[str], Optional[str]]:
    names = sorted(metrics)
    off = resolve_trace(names, args.all_off, ("all_off", "all-off", "off"))
    camera = resolve_trace(names, args.camera, ("camera_only", "camera-only", "camera"))
    base = resolve_trace(names, args.base, ("tracking_base", "device_tracking", "world_tracking", "base"))
    full = resolve_trace(names, args.full, ("full", "scenario"))
    if args.comparisons:
        return load_comparison_csv(args.comparisons, names), off, camera, base, full
    comps: List[Tuple[str, str, str]] = []
    if off and camera and off != camera:
        comps.append((camera, "Camera only", off))
    if camera and base and camera != base:
        comps.append((base, label_from_name(base), camera))
    skip = {x for x in (off, camera, base) if x}
    if full and not args.include_full_in_donut:
        skip.add(full)
    default_base = base or off
    if default_base:
        for name in names:
            if name in skip:
                continue
            comps.append((name, label_from_name(name), default_base))
    return comps, off, camera, base, full


def write_differentials(
    out_dir: Path,
    metrics: Dict[str, dict],
    comps: List[Tuple[str, str, str]],
    target_fps: float,
    slice_threshold: float,
) -> List[dict]:
    diff_rows: List[dict] = []
    slice_rows: List[dict] = []
    for trace, label, base in comps:
        if trace not in metrics or base not in metrics or trace == base:
            continue
        m = metrics[trace]
        b = metrics[base]
        delta_s = attr_ms_per_s(m) - attr_ms_per_s(b)
        row = {
            "trace": trace,
            "label": label,
            "baseline_trace": base,
            "delta_attributed_ms_per_s": delta_s,
            "delta_attributed_ms_per_frame": delta_s / target_fps if target_fps else 0.0,
            "trace_attr_ms_per_frame": attr_ms_per_s(m) / target_fps if target_fps else 0.0,
            "baseline_attr_ms_per_frame": attr_ms_per_s(b) / target_fps if target_fps else 0.0,
        }
        diff_rows.append(row)
        keys = set(m["totals"]).union(b["totals"])
        tmp = []
        for key in keys:
            ms = key_ms_per_s(m, key)
            bs = key_ms_per_s(b, key)
            d = ms - bs
            if abs(d) >= slice_threshold:
                cat, name = key
                tmp.append(
                    (
                        abs(d),
                        {
                            "trace": trace,
                            "label": label,
                            "baseline_trace": base,
                            "category": cat,
                            "name": name,
                            "ms_per_s": ms,
                            "baseline_ms_per_s": bs,
                            "delta_ms_per_s": d,
                            "delta_ms_per_frame": d / target_fps if target_fps else 0.0,
                            "max_ms": m["totals"].get(key, {}).get("max_ms", 0.0),
                            "count": m["totals"].get(key, {}).get("count", 0),
                        },
                    )
                )
        for _abs_d, sr in sorted(tmp, key=lambda x: x[0], reverse=True)[:100]:
            slice_rows.append(sr)
    with (out_dir / "differential_attribution.csv").open("w", newline="", encoding="utf-8") as f:
        fields = [
            "trace",
            "label",
            "baseline_trace",
            "delta_attributed_ms_per_s",
            "delta_attributed_ms_per_frame",
            "trace_attr_ms_per_frame",
            "baseline_attr_ms_per_frame",
        ]
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in diff_rows:
            w.writerow({k: (round(v, 4) if isinstance(v, float) else v) for k, v in r.items()})
    with (out_dir / "slice_deltas_vs_base.csv").open("w", newline="", encoding="utf-8") as f:
        fields = [
            "trace",
            "label",
            "baseline_trace",
            "category",
            "name",
            "ms_per_s",
            "baseline_ms_per_s",
            "delta_ms_per_s",
            "delta_ms_per_frame",
            "max_ms",
            "count",
        ]
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in slice_rows:
            w.writerow({k: (round(v, 4) if isinstance(v, float) else v) for k, v in r.items()})
    return diff_rows


def maybe_combine_slices(items: List[Tuple[str, float]], max_slices: int) -> List[Tuple[str, float]]:
    if max_slices <= 0 or len(items) <= max_slices:
        return items
    keep = items[: max_slices - 1]
    other = sum(v for _l, v in items[max_slices - 1 :])
    if other > 0:
        keep.append(("Other positive deltas", other))
    return keep


def generate_donut(
    out_dir: Path, args: argparse.Namespace, metrics: Dict[str, dict], diff_rows: List[dict], off: Optional[str]
) -> Optional[Path]:
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except Exception as e:
        print(f"[warn] matplotlib unavailable; skipping chart: {e}", file=sys.stderr)
        return None
    exclude = re.compile(args.exclude_donut_regex, re.I) if args.exclude_donut_regex else None
    items: List[Tuple[str, float]] = []
    if args.include_baseline and off and off in metrics:
        items.append(
            (
                "All-off baseline / Preview host",
                attr_ms_per_s(metrics[off]) / args.target_fps if args.target_fps else 0.0,
            )
        )
    for r in diff_rows:
        label = r["label"]
        val = r["delta_attributed_ms_per_frame"]
        if val <= args.min_donut_ms:
            continue
        if exclude and exclude.search(label):
            continue
        items.append((label, val))
    items = sorted(items, key=lambda x: x[1], reverse=True)
    items = maybe_combine_slices(items, args.max_donut_slices)
    if not items:
        print("[warn] no positive deltas for donut chart", file=sys.stderr)
        return None
    total = sum(v for _l, v in items)
    labels = [lbl for lbl, _v in items]
    values = [v for _l, v in items]
    colors = COLOR_PALETTE[:]
    while len(colors) < len(values):
        colors.extend(COLOR_PALETTE)
    colors = colors[: len(values)]
    fig, ax = plt.subplots(figsize=(16, 10), dpi=160, facecolor="white")
    ax.set_position([0.06, 0.12, 0.62, 0.76])
    wedges, _ = ax.pie(
        values,
        startangle=90,
        counterclock=False,
        colors=colors,
        wedgeprops={"width": 0.42, "edgecolor": "white", "linewidth": 2.2},
    )
    ax.set(aspect="equal")
    ax.text(0, 0.12, "Attributed\nframe time", ha="center", va="center", fontsize=18, weight="bold", color="#222")
    ax.text(0, -0.16, f"{total:.2f} ms/frame", ha="center", va="center", fontsize=13, color="#555")
    ax.text(
        0,
        -0.34,
        "baseline included" if args.include_baseline else "project-only\nPreview baseline excluded",
        ha="center",
        va="center",
        fontsize=9,
        color="#777",
    )
    for wedge, label, val in zip(wedges, labels, values):
        ang = (wedge.theta1 + wedge.theta2) / 2.0
        x = math.cos(math.radians(ang))
        y = math.sin(math.radians(ang))
        ha = "left" if x >= 0 else "right"
        x_text = 1.36 if x >= 0 else -1.36
        y_text = 1.16 * y
        pct = val / total * 100.0 if total else 0.0
        text = f"{label}\n{val:.2f} ms/f · {pct:.1f}%"
        ax.annotate(
            text,
            xy=(0.82 * x, 0.82 * y),
            xytext=(x_text, y_text),
            ha=ha,
            va="center",
            fontsize=10,
            color="#202124",
            arrowprops={
                "arrowstyle": "-",
                "color": "#9AA0A6",
                "lw": 0.9,
                "shrinkA": 0,
                "shrinkB": 0,
                "connectionstyle": "arc3,rad=0.15",
            },
        )
    title = args.title or f"{args.project_label}: attributed frame-time contributors"
    fig.text(0.055, 0.94, title, fontsize=22, fontweight="bold", ha="left", color="#111")
    footer_baseline = "Preview baseline included." if args.include_baseline else "Preview baseline excluded."
    fig.text(
        0.055,
        0.035,
        "Source: performance sweep traces + differential attribution. Positive deltas only; "
        f"{footer_baseline} Values are attributed slice ms/frame, not CPU core-time.",
        fontsize=9,
        color="#6E6E6E",
        ha="left",
    )
    out = out_dir / "positive_differential_donut.png"
    fig.savefig(out, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return out


def recommendation_for(label: str, top_slice_text: str) -> str:
    text = f"{label} {top_slice_text}".lower()
    label_text = label.lower()
    if any(x in label_text for x in ["camera", "render camera"]):
        return "Remove extra cameras/layers, reduce render passes, and cull objects from cameras that do not need them."
    if any(x in label_text for x in ["mesh", "visual", "draw", "body static", "vertices", "skinned"]):
        return (
            "Merge/static-batch visuals where possible, share materials, "
            "reduce vertices/skinning, and hide inactive visuals."
        )
    if any(x in label_text for x in ["tracking", "sik", "gesture", "ml"]):
        return (
            "Gate tracking/ML/interaction systems to active windows, "
            "reduce concurrent detectors, and avoid idle per-frame polling."
        )
    if any(x in label_text for x in ["script", "controller", "logic"]):
        return (
            "Throttle UpdateEvent work, cache lookups/material refs, "
            "replace polling with events/timers, and remove debug logging."
        )
    if any(x in text for x in ["vfx", "particle", "ngs", "render target", "render_target"]):
        return (
            "Reduce VFX/particle counts, lifetimes, overdraw, and render-target passes; pause/disable when not visible."
        )
    if any(x in text for x in ["draw", "visual", "mesh", "vertices", "skinned"]):
        return (
            "Merge/static-batch visuals where possible, share materials, "
            "reduce vertices/skinning, and hide inactive visuals."
        )
    if any(x in text for x in ["tracking", "shape", "objecttracking", "sik", "gesture", "ml"]):
        return (
            "Gate tracking/ML/interaction systems to active windows, "
            "reduce concurrent detectors, and avoid idle per-frame polling."
        )
    if any(x in text for x in ["script", "component", "controller", "update"]):
        return (
            "Throttle UpdateEvent work, cache lookups/material refs, "
            "replace polling with events/timers, and remove debug logging."
        )
    if any(x in text for x in ["camera", "render"]):
        return "Remove extra cameras/layers, reduce render passes, and cull objects from cameras that do not need them."
    return "Inspect the top slice deltas, then reduce always-on work first and gate this subsystem when inactive."


def write_optimization_candidates(out_dir: Path, diff_rows: List[dict]) -> None:
    slice_by_trace: Dict[str, List[dict]] = {}
    slice_csv = out_dir / "slice_deltas_vs_base.csv"
    if slice_csv.exists():
        with slice_csv.open(newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                if float(r.get("delta_ms_per_s") or 0) > 0:
                    slice_by_trace.setdefault(r["trace"], []).append(r)
    positives = [r for r in diff_rows if r["delta_attributed_ms_per_frame"] > 0.005]
    positives.sort(key=lambda r: r["delta_attributed_ms_per_frame"], reverse=True)
    total = sum(r["delta_attributed_ms_per_frame"] for r in positives)
    lines = [
        "# Optimization candidates from performance-trace attribution",
        "",
        f"Positive attributed project deltas total: **{total:.2f} ms/frame**.",
        "",
        "These are starting points. Validate each optimization with a follow-up trace.",
        "",
    ]
    for i, r in enumerate(positives, 1):
        slices = slice_by_trace.get(r["trace"], [])[:5]
        slice_text = (
            "; ".join(
                f"{s['category']}:{s['name']} +{float(s['delta_ms_per_frame']):.2f} ms/f "
                f"max {float(s['max_ms']):.2f} ms"
                for s in slices
            )
            or "no large individual slice delta above threshold"
        )
        pct = (r["delta_attributed_ms_per_frame"] / total * 100.0) if total else 0.0
        lines.extend(
            [
                f"## {i}. {r['label']} — {r['delta_attributed_ms_per_frame']:.2f} ms/frame ({pct:.1f}%)",
                "",
                f"Comparison: `{r['trace']}` over `{r['baseline_trace']}`.",
                f"Top changed slices: {slice_text}.",
                f"Recommended focus: {recommendation_for(r['label'], slice_text)}",
                "",
            ]
        )
    if not positives:
        lines.append(
            "No positive deltas were found. Repeat noisy traces or check that systems were actually enabled/exercised."
        )
    (out_dir / "optimization_candidates.md").write_text("\n".join(lines), encoding="utf-8")


def write_compact_json(out_dir: Path, metrics: Dict[str, dict], diff_rows: List[dict]) -> None:
    compact = {}
    for k, m in metrics.items():
        compact[k] = {kk: vv for kk, vv in m.items() if kk not in {"totals"}}
        compact[k]["attributed_total_ms"] = total_attr_ms(m)
        compact[k]["attr_ms_per_s"] = attr_ms_per_s(m)
    (out_dir / "metrics_compact.json").write_text(
        json.dumps({"traces": compact, "differentials": diff_rows}, indent=2), encoding="utf-8"
    )


def main() -> int:
    args = parse_args()
    trace_dir = args.trace_dir.resolve()
    out_dir = (args.out_dir or trace_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    if not trace_dir.exists():
        raise SystemExit(f"trace_dir does not exist: {trace_dir}")
    export_pftraces(trace_dir, args.trace_processor, args.overwrite_sqlite)
    sqlite_files = sorted(list(trace_dir.glob("*.sqlite")) + list(trace_dir.glob("*.db")))
    if not sqlite_files:
        raise SystemExit(f"no .sqlite/.db files found in {trace_dir}")
    metrics = {clean_name(p.stem): get_metrics(p, args.include_all_categories, args.warmup_s) for p in sqlite_files}
    write_trace_summary(out_dir, metrics, args.target_fps)
    write_top_slices(out_dir, metrics)
    comps, off, _camera, _base, _full = build_comparisons(args, metrics)
    diff_rows = write_differentials(out_dir, metrics, comps, args.target_fps, args.slice_delta_threshold_ms_s)
    chart = generate_donut(out_dir, args, metrics, diff_rows, off)
    write_optimization_candidates(out_dir, diff_rows)
    write_compact_json(out_dir, metrics, diff_rows)
    print(f"Analyzed {len(metrics)} traces in {trace_dir}")
    print(f"Wrote: {out_dir / 'trace_summary.csv'}")
    print(f"Wrote: {out_dir / 'differential_attribution.csv'}")
    print(f"Wrote: {out_dir / 'optimization_candidates.md'}")
    if chart:
        print(f"Wrote: {chart}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
