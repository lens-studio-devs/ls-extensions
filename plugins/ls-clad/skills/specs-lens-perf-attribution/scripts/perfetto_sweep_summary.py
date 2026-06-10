#!/usr/bin/env python3
# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

"""Summarize steady-state Lens Studio performance sweep traces.

Requires the Perfetto Python trace processor bindings:
    python3 -m pip install perfetto

Input may be raw .pftrace/.perfetto-trace files or exported SQLite traces. Raw
traces require Perfetto's Python trace processor bindings; exported SQLite
traces only require Python's sqlite3. The script writes JSON and CSV summaries
with per-frame metrics.
"""

from __future__ import annotations

import argparse
import csv
import glob
import json
import math
import sqlite3
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    from perfetto.trace_processor import TraceProcessor
except Exception as exc:  # pragma: no cover - environment dependent
    TraceProcessor = None  # type: ignore
    IMPORT_ERROR = exc
else:
    IMPORT_ERROR = None


class SQLiteTrace:
    def __init__(self, path: Path):
        self.conn = sqlite3.connect(str(path))
        self.conn.row_factory = sqlite3.Row

    def query(self, query: str) -> List[Dict[str, Any]]:
        return [dict(row) for row in self.conn.execute(query).fetchall()]

    def __enter__(self) -> "SQLiteTrace":
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        self.conn.close()


def is_sqlite_trace(path: Path) -> bool:
    return path.suffix.lower() in {".sqlite", ".sqlite3", ".db"}


def open_trace(path: Path) -> Any:
    if is_sqlite_trace(path):
        return SQLiteTrace(path)
    if TraceProcessor is None:
        raise RuntimeError(
            f"Raw trace {path} requires perfetto.trace_processor, which could not be imported: {IMPORT_ERROR}. "
            "Install with: python3 -m pip install perfetto, or export the trace to SQLite first."
        )
    return TraceProcessor(trace=str(path))  # type: ignore[misc]


def rows(tp: Any, query: str) -> List[Dict[str, Any]]:
    return [dict(r) for r in tp.query(query)]


def one(tp: Any, query: str) -> Dict[str, Any]:
    result = rows(tp, query)
    return result[0] if result else {}


def has_table(tp: Any, name: str) -> bool:
    try:
        rows(tp, f"SELECT 1 FROM {name} LIMIT 1")
        return True
    except Exception:
        return False


def pick_table(tp: Any, *names: str) -> str:
    """Return the first queryable table name from ``names``.

    Lens Studio raw SQLite exports use ``__intrinsic_``-prefixed tables and omit
    the standard Perfetto views; the Perfetto trace processor exposes the
    standard names. Falls back to the last candidate so callers always get a
    name to interpolate."""
    for name in names:
        if has_table(tp, name):
            return name
    return names[-1]


def trace_bounds(tp: Any, slice_t: str) -> tuple[int, int]:
    """Read trace bounds, inferring them from the slice table when the standard
    ``trace_bounds`` table is absent (Lens Studio raw SQLite exports)."""
    if has_table(tp, "trace_bounds"):
        b = one(tp, "SELECT start_ts, end_ts FROM trace_bounds")
        if b.get("start_ts") is not None:
            return int(b["start_ts"]), int(b["end_ts"])
    # Clamp negative/NULL durations to 0 (incomplete traces have dur = -1) so
    # max(ts + dur) can't evaluate to NULL — matches the sibling analyze scripts.
    b = one(
        tp, f"SELECT min(ts) AS start_ts, max(ts + CASE WHEN dur >= 0 THEN dur ELSE 0 END) AS end_ts FROM {slice_t}"
    )
    if b.get("start_ts") is None or b.get("end_ts") is None:
        raise RuntimeError("could not determine trace bounds (empty slice table)")
    return int(b["start_ts"]), int(b["end_ts"])


def qname(name: str) -> str:
    return name.replace("'", "''")


def percentile_expr(column: str, pct: int) -> str:
    # Perfetto TraceProcessor supports percentile in modern builds.
    return f"percentile({column}, {pct})"


def counter_frame_peaks(values: List[float]) -> List[float]:
    """Reduce raw counter samples to one peak per frame.

    DrawCalls/RenderedVertices/MangledVisual accumulate during a frame and reset
    to 0 at the frame boundary; averaging the raw samples (including the 0 resets
    and intra-frame steps) under-reports the per-frame value. Segment on each 0
    reset and keep each segment's max — matching analyze_perfetto_attribution.py.
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


def counter_avg(
    tp: Any,
    counter_name: str,
    start_ns: int,
    end_ns: int,
    counter_t: str = "counter",
    track_t: str = "counter_track",
) -> Optional[float]:
    # Counters are optional and absent from many Lens Studio exports; degrade to
    # None rather than crashing the whole summary if the tables/counter are gone.
    try:
        samples = rows(
            tp,
            f"""
            SELECT c.value AS value
            FROM {counter_t} c
            JOIN {track_t} t ON c.track_id = t.id
            WHERE t.name = '{qname(counter_name)}'
              AND c.ts >= {start_ns}
              AND c.ts <= {end_ns}
            ORDER BY c.ts
            """,
        )
    except Exception:
        return None
    # DrawCalls/RenderedVertices are accumulating counters: average per-frame peaks.
    peaks = counter_frame_peaks([r["value"] for r in samples if r.get("value") is not None])
    if not peaks:
        return None
    return sum(peaks) / len(peaks)


def summarize_slices(tp: Any, where: str, frames: int, slice_t: str = "slice") -> Dict[str, float]:
    result: Dict[str, float] = {}
    for row in rows(
        tp,
        f"""
        SELECT ifnull(name, '<unnamed>') AS name,
               count(*) AS n,
               sum(dur) / 1e6 AS total_ms,
               avg(dur) / 1e6 AS avg_ms,
               max(dur) / 1e6 AS max_ms
        FROM {slice_t}
        WHERE dur > 0 AND {where}
        GROUP BY name
        ORDER BY total_ms DESC
        LIMIT 80
        """,
    ):
        if frames:
            result[str(row["name"])] = float(row.get("total_ms") or 0.0) / frames
    return result


def slice_total_ms_per_frame(tp: Any, where: str, frames: int, slice_t: str = "slice") -> float:
    """Total instrumented ms/frame across ALL matching slices.

    Computed with its own SQL SUM rather than summing summarize_slices(), whose
    LIMIT 80 would truncate the total (and inflate uninstrumented time) on traces
    with more than 80 distinct slice names.
    """
    if not frames:
        return 0.0
    row = one(tp, f"SELECT sum(dur) / 1e6 AS total_ms FROM {slice_t} WHERE dur > 0 AND {where}")
    return float(row.get("total_ms") or 0.0) / frames


def summarize_trace(path: Path, warmup_s: float) -> Dict[str, Any]:
    with open_trace(path) as tp:
        # Lens Studio raw SQLite exports use __intrinsic_ tables and omit the
        # trace_bounds table; resolve table names and infer bounds defensively.
        slice_t = pick_table(tp, "slice", "__intrinsic_slice")
        counter_t = pick_table(tp, "counter", "__intrinsic_counter")
        track_t = pick_table(tp, "counter_track", "__intrinsic_counter_track", "__intrinsic_track", "track")
        start_ts, end_ts = trace_bounds(tp, slice_t)
        steady_start = start_ts + int(warmup_s * 1_000_000_000)

        frame_query = f"""
        WITH su AS (
          SELECT ts,
                 dur,
                 lead(ts) OVER (ORDER BY ts) AS next_ts
          FROM {slice_t}
          WHERE name = 'Scene Update'
          ORDER BY ts
        ), d AS (
          SELECT (next_ts - ts) / 1e6 AS frame_ms,
                 dur / 1e6 AS update_ms
          FROM su
          WHERE next_ts IS NOT NULL
            AND ts >= {steady_start}
            AND next_ts <= {end_ts}
        )
        SELECT count(*) AS frames,
               avg(frame_ms) AS avg_frame_ms,
               {percentile_expr("frame_ms", 95)} AS p95_frame_ms,
               {percentile_expr("frame_ms", 99)} AS p99_frame_ms,
               max(frame_ms) AS max_frame_ms,
               avg(update_ms) AS avg_update_ms,
               max(update_ms) AS max_update_ms
        FROM d
        """
        try:
            frame = one(tp, frame_query)
        except Exception:
            # Fallback for older trace processors without percentile().
            frame = one(
                tp,
                f"""
                WITH su AS (
                  SELECT ts, dur, lead(ts) OVER (ORDER BY ts) AS next_ts
                  FROM {slice_t} WHERE name = 'Scene Update' ORDER BY ts
                ), d AS (
                  SELECT (next_ts - ts) / 1e6 AS frame_ms, dur / 1e6 AS update_ms
                  FROM su
                  WHERE next_ts IS NOT NULL AND ts >= {steady_start} AND next_ts <= {end_ts}
                )
                SELECT count(*) AS frames,
                       avg(frame_ms) AS avg_frame_ms,
                       NULL AS p95_frame_ms,
                       NULL AS p99_frame_ms,
                       max(frame_ms) AS max_frame_ms,
                       avg(update_ms) AS avg_update_ms,
                       max(update_ms) AS max_update_ms
                FROM d
                """,
            )

        frames = int(frame.get("frames") or 0)
        where_common = f"ts >= {steady_start} AND ts <= {end_ts}"
        top = summarize_slices(tp, f"parent_id IS NULL AND {where_common}", frames, slice_t)
        all_slices = summarize_slices(tp, where_common, frames, slice_t)

        # Totals come from independent SQL SUMs so the LIMIT 80 breakdown above
        # never truncates them (which would inflate uninstrumented_or_wait).
        top_sum = slice_total_ms_per_frame(tp, f"parent_id IS NULL AND {where_common}", frames, slice_t)
        all_sum = slice_total_ms_per_frame(tp, where_common, frames, slice_t)
        avg_frame = float(frame.get("avg_frame_ms") or 0.0)
        fps = 1000.0 / avg_frame if avg_frame > 0 else None

        return {
            "file": str(path),
            "trace_duration_s": (end_ts - start_ts) / 1e9,
            "warmup_s": warmup_s,
            "steady_duration_s": max(0.0, (end_ts - steady_start) / 1e9),
            "frames": frames,
            "avg_frame_ms": avg_frame,
            "fps": fps,
            "p95_frame_ms": frame.get("p95_frame_ms"),
            "p99_frame_ms": frame.get("p99_frame_ms"),
            "max_frame_ms": frame.get("max_frame_ms"),
            "avg_scene_update_ms": frame.get("avg_update_ms"),
            "max_scene_update_ms": frame.get("max_update_ms"),
            "top_level_instrumented_ms_per_frame": top_sum,
            "all_depth_instrumented_ms_per_frame": all_sum,
            "uninstrumented_or_wait_ms_per_frame": max(0.0, avg_frame - top_sum),
            "drawcalls_avg": counter_avg(tp, "DrawCalls", steady_start, end_ts, counter_t, track_t),
            "rendered_vertices_avg": counter_avg(tp, "RenderedVertices", steady_start, end_ts, counter_t, track_t),
            "top_level_slices_ms_per_frame": top,
            "all_slices_ms_per_frame": all_slices,
        }


def fmt(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, float):
        if math.isnan(v):
            return ""
        return f"{v:.4f}"
    return str(v)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("trace_dir", help="Directory containing performance traces")
    parser.add_argument(
        "--pattern",
        default="*.pftrace,*.perfetto-trace,*.sqlite,*.sqlite3,*.db",
        help="Comma-separated glob patterns inside trace_dir",
    )
    parser.add_argument("--warmup-s", type=float, default=3.0, help="Seconds to skip from trace start")
    parser.add_argument("--out", help="JSON output path (default: <trace_dir>/summary_steady.json)")
    parser.add_argument("--csv", dest="csv_path", help="CSV output path (default: <trace_dir>/summary_steady.csv)")
    args = parser.parse_args(argv)

    trace_dir = Path(args.trace_dir)
    paths: List[Path] = []
    for pattern in [p.strip() for p in args.pattern.split(",") if p.strip()]:
        paths.extend(Path(p) for p in glob.glob(str(trace_dir / pattern)))
    paths = sorted(set(paths))
    if not paths:
        print(f"ERROR: no traces matched {trace_dir / args.pattern}", file=sys.stderr)
        return 1

    summaries = []
    for path in paths:
        print(f"Summarizing {path}...", file=sys.stderr)
        summaries.append(summarize_trace(path, args.warmup_s))

    out_path = Path(args.out) if args.out else trace_dir / "summary_steady.json"
    csv_path = Path(args.csv_path) if args.csv_path else trace_dir / "summary_steady.csv"
    out_path.write_text(json.dumps(summaries, indent=2, sort_keys=True), encoding="utf-8")

    columns = [
        "file",
        "frames",
        "avg_frame_ms",
        "fps",
        "p95_frame_ms",
        "p99_frame_ms",
        "max_frame_ms",
        "avg_scene_update_ms",
        "top_level_instrumented_ms_per_frame",
        "all_depth_instrumented_ms_per_frame",
        "uninstrumented_or_wait_ms_per_frame",
        "drawcalls_avg",
        "rendered_vertices_avg",
    ]
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        writer.writeheader()
        for summary in summaries:
            writer.writerow({c: fmt(summary.get(c)) for c in columns})

    print(f"Wrote {out_path}")
    print(f"Wrote {csv_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
