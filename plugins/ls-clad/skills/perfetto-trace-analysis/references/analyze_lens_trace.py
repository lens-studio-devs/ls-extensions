# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

"""
Parse Lens Studio profiler (Perfetto) trace and output JSON summary for AI.
Shipped with the ls-clad perfetto-trace-analysis skill (Phase 1 CLI).
"""
import json
import os
import shutil
import sys
import tempfile


def _load_trace_processor():
    try:
        from perfetto.trace_processor import TraceProcessor
        return TraceProcessor
    except ImportError:
        from perfetto.trace_processor.api import TraceProcessor as TP  # type: ignore[no-redef]

        return TP


def _row_val(row, key, default=None):
    """Get value from Perfetto query Row (attribute access; Row is not subscriptable)."""
    return getattr(row, key, default)


def _phase_from_ts(ts_ns, trace_start_ns, early_threshold_ns):
    """Return 'early' if slice is in first 500ms of trace, else 'late'."""
    if ts_ns is None or trace_start_ns is None:
        return None
    delta_ns = ts_ns - trace_start_ns
    return "early" if delta_ns < early_threshold_ns else "late"


def _percentile(sorted_list, p):
    """Return the p-th percentile from a sorted list (0–100), using floor/nearest-rank (not interpolated)."""
    if not sorted_list:
        return None
    idx = int(len(sorted_list) * p / 100)
    idx = min(idx, len(sorted_list) - 1)
    return sorted_list[idx]


def _infer_capture_profile(tp) -> dict:
    """
    Best-effort auto-detect Spectacles vs mobile Lens Profiler from strings in the trace.
    Tune keyword weights / lists after testing real .pftrace files from both setups.
    """
    blob_parts = []
    query_errors = []

    def _add_rows(query: str, attr: str = "name") -> None:
        try:
            for row in tp.query(query):
                v = _row_val(row, attr)
                if v:
                    blob_parts.append(str(v))
        except Exception as e:
            query_errors.append(f"{query[:50]}: {e}")

    _add_rows("SELECT name FROM track WHERE name IS NOT NULL LIMIT 400", "name")
    _add_rows("SELECT DISTINCT name FROM slice WHERE name IS NOT NULL LIMIT 600", "name")
    _add_rows("SELECT name FROM thread WHERE name IS NOT NULL LIMIT 200", "name")
    # Optional metadata (schema varies by trace version)
    for q in (
        "SELECT name, string_value FROM metadata WHERE name IS NOT NULL OR string_value IS NOT NULL LIMIT 80",
        "SELECT key, string_value FROM meta WHERE key IS NOT NULL OR string_value IS NOT NULL LIMIT 80",
    ):
        try:
            for row in tp.query(q):
                for col in ("name", "key", "string_value", "value"):
                    v = _row_val(row, col)
                    if v:
                        blob_parts.append(str(v))
        except Exception as e:
            query_errors.append(f"{q[:50]}: {e}")

    blob = " ".join(blob_parts).lower()

    # (substring, spectacles_points, mobile_points, label for signals)
    # Avoid shorter keys that are prefixes of longer ones (e.g. "spectacle" ⊂ "spectacles").
    rules = [
        ("spectacles", 55, 0, "spectacles"),
        ("logic touch", 40, 0, "logic_touch"),
        ("tracker touch", 40, 0, "tracker_touch"),
        ("lens power", 30, 0, "lens_power"),
        ("tracker power", 22, 0, "tracker_power"),
        ("lensactivation", 0, 15, "lensactivation"),
        ("lens_activation", 0, 15, "lens_activation"),
        ("lens activation", 0, 12, "lens_activation_space"),
        ("activationtime", 0, 35, "activationtime"),
        ("mobile lens", 0, 38, "mobile_lens"),
        ("lens profiler", 5, 28, "lens_profiler"),
        ("send to snapchat", 0, 20, "send_snapchat"),
    ]

    spec_score = 0
    mob_score = 0
    signals: list[str] = []

    for sub, sp, mp, label in rules:
        if sub in blob:
            spec_score += sp
            mob_score += mp
            if sp > 0 or mp > 0:
                signals.append(label)

    margin = 18
    if spec_score >= mob_score + margin:
        profile = "spectacles"
    elif mob_score >= spec_score + margin:
        profile = "mobile"
    else:
        profile = "mobile"
        signals.append("default_mobile_ambiguous")

    diff = abs(spec_score - mob_score)
    if diff >= 55:
        confidence = "high"
    elif diff >= 28:
        confidence = "medium"
    else:
        confidence = "low"

    result = {
        "captureProfile": profile,
        "captureProfileConfidence": confidence,
        "captureProfileSignals": sorted(set(signals))[:25],
        "captureProfileScores": {"spectacles": spec_score, "mobile": mob_score},
    }
    if query_errors:
        result["captureProfileQueryErrors"] = query_errors
    return result


def main() -> int:
    if len(sys.argv) < 2:
        out = {"error": "Usage: analyze_lens_trace.py <trace_file_path>"}
        print(json.dumps(out))
        return 1

    trace_path = sys.argv[1]
    if not trace_path or trace_path.strip() == "":
        out = {"error": "Trace file path is required."}
        print(json.dumps(out))
        return 1

    trace_path = os.path.abspath(os.path.expanduser(trace_path.strip()))
    if not os.path.isfile(trace_path):
        out = {"error": f"Trace file not found: {trace_path}"}
        print(json.dumps(out))
        return 1

    # Trace Processor can fail on paths with spaces/parentheses; copy to temp if needed
    needs_temp = " " in trace_path or "(" in trace_path or ")" in trace_path
    temp_path = None
    if needs_temp:
        fd, temp_path = tempfile.mkstemp(suffix=".pftrace", prefix="trace_")
        os.close(fd)
        try:
            shutil.copy2(trace_path, temp_path)
            trace_path = temp_path
        except Exception as e:
            if os.path.isfile(temp_path):
                try:
                    os.remove(temp_path)
                except OSError as cleanup_err:
                    print(f"Warning: could not remove temp file {temp_path}: {cleanup_err}", file=sys.stderr)
            out = {"error": f"Could not copy trace to temp path: {e}"}
            print(json.dumps(out))
            return 1

    try:
        TraceProcessor = _load_trace_processor()
    except ImportError as e:
        if temp_path and os.path.isfile(temp_path):
            try:
                os.remove(temp_path)
            except OSError as cleanup_err:
                print(f"Warning: could not remove temp file {temp_path}: {cleanup_err}", file=sys.stderr)
        out = {
            "error": (
                "perfetto package not installed. From the perfetto-trace-analysis skill directory, run: "
                "pip install -r references/requirements-perfetto.txt "
                f"({e})"
            )
        }
        print(json.dumps(out))
        return 1

    tp = None
    try:
        tp = TraceProcessor(trace=trace_path)
        summary = _analyze_trace(tp)
        print(json.dumps(summary, indent=2))
        return 0
    except Exception as e:
        out = {"error": str(e)}
        print(json.dumps(out))
        return 1
    finally:
        if tp is not None:
            try:
                tp.close()
            except Exception as e:
                print(f"Warning: tp.close() failed: {e}", file=sys.stderr)
        if temp_path and os.path.isfile(temp_path):
            try:
                os.remove(temp_path)
            except Exception as e:
                print(f"Warning: could not remove temp file {temp_path}: {e}", file=sys.stderr)


def _analyze_trace(tp) -> dict:
    """Query trace and build summary dict."""
    profile_info = _infer_capture_profile(tp)
    capture_profile = profile_info["captureProfile"]
    slow_frame_budget_ms = 16.67 if capture_profile == "spectacles" else 33.3
    slow_frame_budget_ns = int(round(slow_frame_budget_ms * 1_000_000))
    fps_upper_limit = 121 if capture_profile == "spectacles" else 61

    summary = {
        "lensActivationTimeMs": None,
        "fpsEstimate": None,
        "totalDurationMs": None,
        "slowFrames": [],
        "topSlices": [],
        "threadActivity": [],
        "frameTimingStats": None,
        "tracks": [],
        "textureAttributions": [],
        "notes": [],
        **profile_info,
        "slowFrameBudgetMs": round(slow_frame_budget_ms, 2),
    }

    trace_start_ns = None
    try:
        # Get trace start and total duration
        start_row = list(tp.query("SELECT MIN(ts) as trace_start_ns FROM slice WHERE dur > 0"))
        if start_row:
            trace_start_ns = _row_val(start_row[0], "trace_start_ns")
        dur_row = list(tp.query("SELECT MAX(ts + dur) - MIN(ts) as span_ns FROM slice WHERE dur > 0"))
        if dur_row:
            span = _row_val(dur_row[0], "span_ns")
            if span is not None:
                summary["totalDurationMs"] = round(span / 1_000_000, 2)
    except Exception as e:
        summary["notes"].append(f"Could not determine trace duration: {e}")

    EARLY_PHASE_MS = 500  # First 500ms = activation/load phase
    EARLY_PHASE_NS = EARLY_PHASE_MS * 1_000_000

    try:
        # Aggregate slices by name+track_id to find cumulative bottlenecks.
        # Group by t.id (not t.name) so unnamed tracks are not merged together.
        # Sorting by total time (not individual duration) surfaces recurring expensive
        # operations that a per-instance sort would bury under one-off init slices.
        agg_query = """
            SELECT s.name, t.id as track_id, t.name as track_name,
                   COUNT(*) as call_count,
                   SUM(s.dur) as total_dur_ns,
                   CAST(AVG(s.dur) AS INTEGER) as avg_dur_ns,
                   MAX(s.dur) as max_dur_ns,
                   MIN(s.depth) as min_depth
            FROM slice s
            JOIN track t ON s.track_id = t.id
            WHERE s.dur > 0
            GROUP BY s.name, t.id
            ORDER BY total_dur_ns DESC
            LIMIT 40
        """
        rows = list(tp.query(agg_query))
        for r in rows:
            total_ns = _row_val(r, "total_dur_ns") or 0
            avg_ns = _row_val(r, "avg_dur_ns") or 0
            max_ns = _row_val(r, "max_dur_ns") or 0
            summary["topSlices"].append({
                "name": _row_val(r, "name") or "(unnamed)",
                "trackId": _row_val(r, "track_id"),
                "trackName": _row_val(r, "track_name") or "(unnamed)",
                "callCount": _row_val(r, "call_count") or 0,
                "totalDurationMs": round(total_ns / 1_000_000, 2),
                "avgDurationMs": round(avg_ns / 1_000_000, 2),
                "maxDurationMs": round(max_ns / 1_000_000, 2),
                "minDepth": _row_val(r, "min_depth"),
            })
    except Exception as e:
        summary["notes"].append(f"Could not query slices: {e}")

    # Quick dominant-child peek for top hotspot slices.
    # One batch self-join catches cases where a slice's cost is driven by a single known child
    # (e.g. visual component_0 → get shader) without requiring Phase 2.
    # Scoped by (name, track_id) to avoid cross-track aggregation when the same slice name
    # appears on multiple threads.
    try:
        top_entries = [
            (s["name"], s.get("trackId"))
            for s in summary["topSlices"][:5]
            if s["name"] != "(unnamed)" and s.get("trackId") is not None
        ]
        if top_entries:
            pair_clauses = " OR ".join(
                f"(p.name = '{n.replace(chr(39), chr(39)+chr(39))}' AND p.track_id = {tid})"
                for n, tid in top_entries
            )
            child_query = f"""
                SELECT p.name AS parent_name,
                       p.track_id AS parent_track_id,
                       c.name AS child_name,
                       SUM(c.dur) AS child_total_ns,
                       COUNT(*) AS child_count
                FROM slice c
                JOIN slice p ON c.parent_id = p.id
                WHERE ({pair_clauses}) AND c.dur > 0
                GROUP BY p.name, p.track_id, c.name
                ORDER BY p.name, p.track_id, child_total_ns DESC
                LIMIT 150
            """
            child_rows = list(tp.query(child_query))
            parent_children: dict = {}
            for r in child_rows:
                key = (_row_val(r, "parent_name") or "", _row_val(r, "parent_track_id"))
                if key not in parent_children:
                    parent_children[key] = []
                parent_children[key].append({
                    "name": _row_val(r, "child_name") or "(unnamed)",
                    "totalMs": round((_row_val(r, "child_total_ns") or 0) / 1_000_000, 2),
                    "callCount": _row_val(r, "child_count") or 0,
                })
            for s in summary["topSlices"]:
                key = (s["name"], s.get("trackId"))
                children = parent_children.get(key)
                if not children:
                    continue
                top_child = children[0]
                parent_total = s["totalDurationMs"]
                if parent_total > 0 and top_child["totalMs"] / parent_total >= 0.5:
                    s["dominantChildHint"] = {
                        "childName": top_child["name"],
                        "childTotalMs": top_child["totalMs"],
                        "pctOfParent": round(top_child["totalMs"] / parent_total * 100, 1),
                    }
    except Exception as e:
        summary["notes"].append(f"Could not compute child hints: {e}")

    try:
        # Thread activity: group by t.id so unnamed tracks are not merged together.
        # Busiest track by totalDurationMs is almost always the main render thread.
        thread_query = """
            SELECT t.id as track_id, t.name as track_name,
                   COUNT(*) as slice_count,
                   SUM(s.dur) as total_dur_ns,
                   MAX(s.dur) as max_dur_ns
            FROM slice s
            JOIN track t ON s.track_id = t.id
            WHERE s.dur > 0
            GROUP BY t.id
            ORDER BY total_dur_ns DESC
            LIMIT 8
        """
        thread_rows = list(tp.query(thread_query))
        for r in thread_rows:
            total_ns = _row_val(r, "total_dur_ns") or 0
            summary["threadActivity"].append({
                "trackId": _row_val(r, "track_id"),
                "trackName": _row_val(r, "track_name") or "(unnamed)",
                "sliceCount": _row_val(r, "slice_count") or 0,
                "totalDurationMs": round(total_ns / 1_000_000, 2),
                "maxDurationMs": round((_row_val(r, "max_dur_ns") or 0) / 1_000_000, 2),
            })
    except Exception as e:
        summary["notes"].append(f"Could not query thread activity: {e}")

    # Frame timing distribution for the busiest thread (p50 / p90 / p99 of depth-0 slices).
    # Use track_id (not track name) to avoid matching all unnamed tracks at once.
    # p50 vs p90 gap reveals whether jank is consistent or spike-based.
    main_track_id = summary["threadActivity"][0].get("trackId") if summary["threadActivity"] else None
    if main_track_id is not None:
        try:
            # LIMIT without ORDER BY gives an unbiased (insertion-order) sample.
            ft_query = f"""
                SELECT s.dur FROM slice s
                WHERE s.track_id = {main_track_id} AND s.depth = 0
                  AND s.dur > 1000000
                  AND s.dur < 2000000000
                LIMIT 5000
            """
            ft_rows = [_row_val(r, "dur") for r in tp.query(ft_query) if _row_val(r, "dur")]
            if ft_rows:
                ft_rows_sorted = sorted(ft_rows)
                main_track_name = summary["threadActivity"][0]["trackName"]
                summary["frameTimingStats"] = {
                    "threadName": main_track_name,
                    "trackId": main_track_id,
                    "sampleCount": len(ft_rows_sorted),
                    "p50Ms": round(_percentile(ft_rows_sorted, 50) / 1_000_000, 2),
                    "p90Ms": round(_percentile(ft_rows_sorted, 90) / 1_000_000, 2),
                    "p99Ms": round(_percentile(ft_rows_sorted, 99) / 1_000_000, 2),
                    "maxMs": round(ft_rows_sorted[-1] / 1_000_000, 2),
                    "minMs": round(ft_rows_sorted[0] / 1_000_000, 2),
                }
        except Exception as e:
            summary["notes"].append(f"Could not compute frame timing stats: {e}")

    # Detect candidate render threads: tracks that have depth-0 'Frame' slices.
    # Surfaces multiple render threads even when they have no name in the trace.
    try:
        rt_query = """
            SELECT s.track_id,
                   COUNT(*) as frame_count,
                   SUM(s.dur) as total_dur_ns,
                   CAST(AVG(s.dur) AS INTEGER) as avg_dur_ns,
                   MAX(s.dur) as max_dur_ns
            FROM slice s
            WHERE s.name LIKE 'Frame' AND s.depth = 0
              AND s.dur > 1000000 AND s.dur < 2000000000
            GROUP BY s.track_id
            ORDER BY frame_count DESC
            LIMIT 5
        """
        rt_rows = list(tp.query(rt_query))
        if rt_rows:
            track_id_to_name = {
                t["trackId"]: t["trackName"]
                for t in summary["threadActivity"]
                if t.get("trackId") is not None
            }
            render_threads = []
            for r in rt_rows:
                tid = _row_val(r, "track_id")
                render_threads.append({
                    "trackId": tid,
                    "trackName": track_id_to_name.get(tid, "(unnamed)"),
                    "frameCount": _row_val(r, "frame_count") or 0,
                    "avgFrameMs": round((_row_val(r, "avg_dur_ns") or 0) / 1_000_000, 2),
                    "maxFrameMs": round((_row_val(r, "max_dur_ns") or 0) / 1_000_000, 2),
                    "totalMs": round((_row_val(r, "total_dur_ns") or 0) / 1_000_000, 2),
                })
            summary["renderThreads"] = render_threads
            if len(render_threads) > 1:
                summary["notes"].append(
                    f"Found {len(render_threads)} render-like threads (depth-0 'Frame' slices). "
                    "frameTimingStats covers only the busiest; use renderThreads[*].trackId in "
                    "Phase 2 to drill each thread separately."
                )
    except Exception as e:
        summary["notes"].append(f"Could not detect render threads: {e}")

    lat_confirmed = False
    try:
        # Look for Lens Activation Time (Snap-specific naming may vary)
        lat_query = """
            SELECT name, ts, dur FROM slice
            WHERE (name LIKE '%LensActivation%' OR name LIKE '%Lens Activation%'
                   OR name LIKE '%lens_activation%' OR name LIKE '%ActivationTime%')
              AND dur > 0
            ORDER BY ts ASC
            LIMIT 5
        """
        lat_rows = list(tp.query(lat_query))
        if lat_rows:
            summary["lensActivationTimeMs"] = round(_row_val(lat_rows[0], "dur", 0) / 1_000_000, 2)
            summary["notes"].append("LAT found via slice name match.")
            lat_confirmed = True
        else:
            # Fallback: first large slice after trace start (often load/init).
            # Not reliable enough to drive latSeverity — lat_confirmed stays False.
            # Use plain integer literals — Perfetto SQL does not accept Python-style underscores in numbers.
            fallback = """
                SELECT name, dur FROM slice
                WHERE dur > 50000000
                ORDER BY ts ASC
                LIMIT 1
            """
            fallback_rows = list(tp.query(fallback))
            if fallback_rows:
                fallback_dur = _row_val(fallback_rows[0], "dur")
                if fallback_dur and fallback_dur > 0:
                    summary["lensActivationTimeMs"] = round(fallback_dur / 1_000_000, 2)
                    summary["notes"].append("LAT approximated from first long slice.")
    except Exception as e:
        summary["notes"].append(f"Could not determine lens activation time: {e}")

    try:
        # Texture/mesh attributions (Snap draw call format from Mobile Profiler case study)
        attr_query = """
            SELECT name, ts, dur FROM slice
            WHERE (name LIKE '%texture%' OR name LIKE '%With texture%'
                   OR name LIKE '%mesh%' OR name LIKE '%With mesh%')
              AND dur > 0
            ORDER BY dur DESC
            LIMIT 20
        """
        attr_rows = list(tp.query(attr_query))
        for r in attr_rows:
            summary["textureAttributions"].append({
                "name": _row_val(r, "name") or "(unnamed)",
                "durationMs": round(_row_val(r, "dur", 0) / 1_000_000, 2),
            })
    except Exception as e:
        summary["notes"].append(f"Could not query texture attributions: {e}")

    try:
        # FPS estimate: count frames in a time window, or use slice-based heuristic
        fps_query = """
            SELECT COUNT(*) as n FROM slice
            WHERE (name LIKE '%Draw%' OR name LIKE '%Frame%')
              AND dur > 0 AND dur < 50000000
        """
        fps_rows = list(tp.query(fps_query))
        if fps_rows and summary.get("totalDurationMs") and summary["totalDurationMs"] > 0:
            n = _row_val(fps_rows[0], "n")
            # Rough heuristic: frames ~ draws in trace
            summary["fpsEstimate"] = round(
                n / (summary["totalDurationMs"] / 1000), 1
            ) if n else None
            if summary["fpsEstimate"] is not None and (summary["fpsEstimate"] < 15 or summary["fpsEstimate"] > fps_upper_limit):
                summary["notes"].append("FPS estimate may be unreliable (raw heuristic).")
    except Exception as e:
        summary["notes"].append(f"Could not estimate FPS: {e}")

    try:
        # Restrict slow frames to render/main threads to avoid false positives from
        # background or init threads with long depth-0 slices that aren't frame work.
        # Prefer renderThreads track IDs (detected via 'Frame' slices); fall back to
        # the busiest track if renderThreads is empty.
        _slow_track_ids = [
            rt["trackId"] for rt in summary.get("renderThreads", [])
            if rt.get("trackId") is not None
        ]
        if not _slow_track_ids and main_track_id is not None:
            _slow_track_ids = [main_track_id]
        _track_filter = (
            f"AND s.track_id IN ({', '.join(str(t) for t in _slow_track_ids)})"
            if _slow_track_ids else ""
        )
        slow_query = f"""
            SELECT s.name, s.dur, s.ts, t.name as track_name FROM slice s
            JOIN track t ON s.track_id = t.id
            WHERE s.dur > {slow_frame_budget_ns} AND s.depth = 0
              {_track_filter}
            ORDER BY s.dur DESC
        """
        slow_rows = list(tp.query(slow_query))
        for r in slow_rows:
            ts_val = _row_val(r, "ts")
            phase = _phase_from_ts(ts_val, trace_start_ns, EARLY_PHASE_NS)
            summary["slowFrames"].append({
                "name": _row_val(r, "name") or "(unnamed)",
                "trackName": _row_val(r, "track_name") or "(unnamed)",
                "durationMs": round(_row_val(r, "dur", 0) / 1_000_000, 2),
                "phase": phase,
            })
    except Exception as e:
        summary["notes"].append(f"Could not detect slow frames: {e}")

    try:
        # Distinct track names (helps discover schema)
        track_query = "SELECT DISTINCT name FROM track LIMIT 50"
        tracks = [_row_val(r, "name") for r in tp.query(track_query) if _row_val(r, "name")]
        summary["tracks"] = tracks[:20]
    except Exception as e:
        summary["notes"].append(f"Could not query tracks: {e}")

    # Shader spike timing: checks whether compilation spikes cluster at startup (warmup problem)
    # or persist throughout the trace (sustained cost). Distinguishes the two failure modes.
    if trace_start_ns is not None:
        try:
            early_window_ns = 2_000_000_000  # first 2 seconds
            shader_spike_query = f"""
                SELECT COUNT(*) AS total_spikes,
                       SUM(CASE WHEN ts - {trace_start_ns} < {early_window_ns} THEN 1 ELSE 0 END) AS early_spikes
                FROM slice
                WHERE (name LIKE '%get shader%' OR name LIKE '%shader compile%'
                       OR name LIKE '% shader%')
                  AND dur > 5000000
            """
            sr = list(tp.query(shader_spike_query))
            if sr:
                total_spikes = _row_val(sr[0], "total_spikes") or 0
                early_spikes = _row_val(sr[0], "early_spikes") or 0
                if total_spikes > 0:
                    early_frac = early_spikes / total_spikes
                    summary["shaderSpikeTiming"] = {
                        "totalSpikesOver5ms": total_spikes,
                        "earlySpikesOver5ms": early_spikes,
                        "earlyFraction": round(early_frac, 2),
                        "interpretation": (
                            "startup-clustered" if early_frac > 0.8
                            else "mostly-steady" if early_frac < 0.3
                            else "mixed"
                        ),
                    }
        except Exception as e:
            summary["notes"].append(f"Could not compute shader spike timing: {e}")

    # Enrich with thresholds, severity, and suggested actions
    summary["thresholds"] = {
        "latTargetMs": 200,
        "frameBudget60fpsMs": 16.7,
        "frameBudget30fpsMs": 33.3,
        "slowFrameDetectionBudgetMs": summary["slowFrameBudgetMs"],
    }
    _longest = max((s["durationMs"] for s in summary["slowFrames"]), default=None)
    if _longest is None:
        _longest = summary["topSlices"][0]["maxDurationMs"] if summary["topSlices"] else None
    summary["longestFrameMs"] = _longest
    _sf_budget = summary["slowFrameBudgetMs"]
    summary["slowFrameCount"] = {
        "over30fpsBudget": sum(1 for s in summary["slowFrames"] if s["durationMs"] > 33.3 and _sf_budget < 33.3),
        "over60fpsBudget": sum(1 for s in summary["slowFrames"] if s["durationMs"] > 16.7 and _sf_budget < 16.67),
        "overPrimaryBudget": sum(1 for s in summary["slowFrames"] if s["durationMs"] > _sf_budget),
    }
    if summary.get("lensActivationTimeMs") is not None and lat_confirmed:
        lat = summary["lensActivationTimeMs"]
        if lat <= 200:
            summary["latSeverity"] = "ok"
            summary["latLabel"] = f"LAT {lat}ms is within typical target (<200ms)"
        elif lat <= 400:
            summary["latSeverity"] = "warning"
            summary["latLabel"] = f"LAT {lat}ms is above target (200–400ms range)"
        else:
            summary["latSeverity"] = "critical"
            summary["latLabel"] = f"LAT {lat}ms is critically high (>400ms)"
    if summary.get("fpsEstimate") is not None and (
        summary["fpsEstimate"] < 15 or summary["fpsEstimate"] > fps_upper_limit
    ):
        summary["fpsEstimateUnreliable"] = True

    # Severity labels for topSlices use avgDurationMs (per-call cost) so recurring
    # operations are classified accurately even when their individual runs look cheap.
    budget_ms = summary["slowFrameBudgetMs"]
    for s in summary["topSlices"]:
        avg_d = s["avgDurationMs"]
        max_d = s["maxDurationMs"]
        count = s["callCount"]
        total_d = s["totalDurationMs"]
        if avg_d > 33.3 and budget_ms < 33.3:
            s["severity"] = "over30fpsBudget"
            s["label"] = f"avg {avg_d}ms/call exceeds 30fps budget (33.3ms); max {max_d}ms; {count} calls"
        elif avg_d > 16.7 and budget_ms < 16.67:
            s["severity"] = "over60fpsBudget"
            s["label"] = f"avg {avg_d}ms/call exceeds 60fps budget (16.7ms); max {max_d}ms; {count} calls"
        elif avg_d > budget_ms:
            s["severity"] = "overPrimaryBudget"
            s["label"] = f"avg {avg_d}ms/call exceeds {budget_ms}ms budget; {count} calls total {total_d}ms"
        else:
            s["severity"] = "ok"
            s["label"] = f"avg {avg_d}ms/call; {count} calls; total {total_d}ms"

    budget_ms = summary["slowFrameBudgetMs"]
    for s in summary["slowFrames"]:
        d = s["durationMs"]
        if d > 33.3 and budget_ms < 33.3:
            # Frame exceeds 30fps budget on a higher-fps device (e.g. Spectacles 60fps)
            s["severity"] = "over30fpsBudget"
            s["label"] = f"{d}ms exceeds 30fps budget (33.3ms)"
        elif d > budget_ms:
            s["severity"] = "overPrimaryBudget"
            s["label"] = f"{d}ms exceeds {budget_ms}ms frame budget"
        else:
            s["severity"] = "ok"
            s["label"] = f"{d}ms within {budget_ms}ms frame budget"
    early_count = sum(1 for s in summary["slowFrames"] if s.get("phase") == "early")
    late_count = sum(1 for s in summary["slowFrames"] if s.get("phase") == "late")
    summary["earlyHitchCount"] = early_count
    summary["lateHitchCount"] = late_count
    summary["slowFrames"] = summary["slowFrames"][:20]
    summary["timingInterpretation"] = (
        "Hitches in the first 500ms suggest activation-time issues; "
        "hitches later in the trace may be interaction-related."
    )

    if capture_profile == "spectacles":
        summary["captureContext"] = (
            "Spectacles: traces from Spectacles Monitor / Perfetto focus on device runtime (power, thermals, "
            "frame timing). Use Snap Spectacles docs for budgets (e.g. ~60 FPS / ~16.7ms frame time on overlay). "
            "Environment (lighting, features, ambient temperature) affects tracking and throttling—see "
            "Environment Setup Guidance. Assume captureProfile is heuristic until validated on your trace."
        )
        summary["spectaclesDocLinks"] = [
            {
                "title": "Optimizing Lens Performance",
                "url": "https://developers.snap.com/spectacles/best-practices/performance-optimization/optimizing-lens-performance",
            },
            {
                "title": "Environment Setup Guidance",
                "url": "https://developers.snap.com/spectacles/best-practices/performance-optimization/environment-setup-guidance",
            },
            {
                "title": "Lens Performance Overlay",
                "url": "https://developers.snap.com/spectacles/best-practices/profiling/lens-performance-overlay",
            },
            {
                "title": "Spectacles Monitor (incl. Perfetto)",
                "url": "https://developers.snap.com/spectacles/best-practices/profiling/spectacles-monitor",
            },
        ]
    else:
        # Mobile Lens Profiler: lens is sent to device with profiling; trace begins at lens launch.
        summary["captureContext"] = (
            "Mobile Lens Profiler traces typically start when the lens is pushed to the device with "
            "profiling enabled—the beginning of the file reflects lens open and activation. "
            "Do not ask the user whether the trace 'starts at open'; assume activation unless they "
            "say they reproduced a hitch only after interacting later."
        )

    if profile_info.get("captureProfileConfidence") == "low":
        summary["notes"].append(
            "captureProfile auto-detect had low confidence—verify against known capture device or tune "
            "heuristics in analyze_lens_trace.py (_infer_capture_profile)."
        )

    summary["suggestedActions"] = _build_suggested_actions(summary)
    return summary


def _build_suggested_actions(summary: dict) -> list:
    """Hints for the AI—do not require opening ui.perfetto.dev or any external Perfetto UI."""
    actions = []
    if summary.get("captureProfile") == "spectacles":
        actions.append(
            "Spectacles: prioritize power/thermal and 60 FPS frame budget per Snap Spectacles docs; "
            "use spectaclesDocLinks. Consider environment (lighting, visual features, ambient temp) if "
            "tracking or throttling dominate."
        )
    if summary.get("lensActivationTimeMs") is not None:
        actions.append(
            "If LAT or early-phase slices are high, focus on activation load (ML, shaders, face/camera "
            "work on first frames)—the trace already starts at lens launch when using Send with Lens Profiler."
        )
    slow_count = summary.get("slowFrameCount", {}).get("overPrimaryBudget", 0)
    if slow_count > 0:
        actions.append(
            "Use topSlices (totalDurationMs to find recurring bottlenecks, avgDurationMs for per-call cost) "
            "and slowFrames (depth-0 spans on render/main threads exceeding frame budget) to infer CPU vs GPU-ish work from slice "
            "names (e.g. Scene Update, ML, draw). Check frameTimingStats p50 vs p90 gap: a large gap means "
            "spikes rather than a consistently slow path."
        )
    top = summary.get("topSlices", [])[:3]
    component_like = [s for s in top if "component" in (s.get("name") or "").lower()]
    if component_like:
        actions.append(
            "What in your scene might map to the heavy slice(s) "
            "(post effect, 3D object, particle/VFX, body/face mesh, etc.)?"
        )
    if summary.get("textureAttributions"):
        max_tex = max((t["durationMs"] for t in summary["textureAttributions"]), default=0)
        if max_tex > 5:
            actions.append(
                "Are you loading large textures at runtime? Texture deserialization "
                "appears notable in this trace."
            )
    if not actions:
        actions.append(
            "Optional: did you reproduce the hitch only after a specific tap or gesture? "
            "(Trace still starts at launch; late-phase slices then point to that interaction.)"
        )
    return actions[:3]


if __name__ == "__main__":
    sys.exit(main())
