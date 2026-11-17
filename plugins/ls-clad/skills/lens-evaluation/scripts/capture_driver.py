#!/usr/bin/env python3
"""Deterministic lens capture — steps 2+3 of the capture procedure, via STRICT MCP API calls.

The agent does step 1 (plan: how to start the experience, viewpoint, duration) and writes a config;
this script executes it identically in every environment, with a method fallback chain:

    M3 recordVideo (macOS only)  ->  M2 runtime-view burst  ->  M1 panel burst

A method is abandoned ONLY on MECHANICAL failure (transport drop, tool error, no file, 0 frames);
the first mechanically-successful method wins. Frames are then normalised to <= max_dim on the
longest edge (aspect preserved) and assembled into a GIF. Everything is timed, and a machine-readable
capture_result.json lets the agent's step 4 judge content (frozen frames / bad viewpoint) and, if
needed, re-enter at the next method via --start-method.

  python3 capture_driver.py <project_dir> [--config capture_config.json]
      config "timeline": [{"t": ms, "op": shot|burst|record|pinch|gesture|editor_code|move_camera|wait, ...}]
      runs every op at its time with no agent in the loop (see references/capture-procedure.md)
                            [--start-method M3|M2|M1] [--frames 10] [--max 640] [--fps 3]
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import platform
import shutil
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mcp_client import MCP  # noqa: E402

PREVIEW_PANEL = "Snap.Plugin.Gui.PreviewPanel"

# M3 = recordVideo through the checked-in editor action scripts/editor/record-video.ts ({path, args}).
# Two workarounds stay until the platform bugs are fixed:
#   - recordVideo takes the MCP server down on Linux/Xvfb -> M3 is gated off on Linux
#     (method_gate below), and a `record` op there is served as an equivalent burst.
#   - recordVideo only captures motion after preview.refresh(), which resets placement-gated
#     lenses -> the action records WITHOUT refresh, and a frozen clip falls back to M2 -> M1 bursts.
# Remove each workaround once recordVideo is fixed for that case.
RECORD_ACTION = Path(__file__).resolve().parent / "editor" / "record-video.ts"
METHODS = ("M3", "M2", "M1")
RECORD_FAILURES = (
    "invalid_args",
    "no_preview_panel",
    "record_video_api_unavailable",
    "no_save_handle",
    "record_video_failed",
)


def method_gate(requested: list | None, host: str, start: str | None = None) -> list[str]:
    """Method order for this host: M3 is never used on Linux; unknown names are dropped;
    --start-method re-enters the chain lower down. Falls back to M2 -> M1 when nothing is left."""
    order = [x for x in (requested or list(METHODS)) if x in METHODS]
    if host == "Linux":
        order = [x for x in order if x != "M3"]
    if start in order:
        order = order[order.index(start) :]
    return order or ["M2", "M1"]


PHASES: list[dict] = []


def phase(name: str):
    PHASES.append({"phase": name, "start": time.time(), "end": None})
    print(f"\n=== {name} ===", flush=True)


def endphase():
    if PHASES and PHASES[-1]["end"] is None:
        PHASES[-1]["end"] = time.time()


def _reset_action() -> str:
    here = Path(__file__).resolve()
    cand = here.parents[2] / "reset-preview-environment/actions/survey-and-reset.ts"
    if not cand.is_file():
        raise FileNotFoundError(f"reset-preview-environment action not found next to this skill: {cand}")
    return str(cand)


MEDIA = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".mp4": "video/mp4"}


def emit_manifest(result: dict, frames_dir: Path) -> Path:
    """Copy the retained timeline frames into ``frames_dir`` and write a DRAFT capture_manifest.json there with
    every machine-measurable field filled (path, media_type, width, height, sha256, bytes, at_seconds, phase,
    source, capture_origin, sample_interval_seconds, ...). Judgment fields are left for the evaluator:
    ``viewpoint`` and ``state`` are empty (the contract rejects empty strings, so an unfinished draft fails
    validation), ``role`` is a default guess, ``limitations`` is empty, and ``primary_artifact_ids`` is empty."""
    frames_dir.mkdir(parents=True, exist_ok=True)
    arts = []
    for step in result.get("timeline_run") or []:
        frames = step.get("frames") or []
        fps = step.get("fps") or 0
        multi = len(frames) > 1
        for k, src in enumerate(frames):
            srcp = Path(src)
            if not srcp.is_file():
                continue
            dst = frames_dir / srcp.name
            shutil.copyfile(srcp, dst)
            dims = png_dims(dst) or ""
            w, _, h = dims.partition("x")
            arts.append(
                {
                    "id": dst.stem,
                    "path": str(dst.resolve()),
                    "media_type": MEDIA.get(dst.suffix.lower(), "image/png"),
                    # M1/M2 frames show the running lens (original Phase B evidence); M3 frames come from a recording
                    "source": "preview_recording" if step.get("method") == "M3" else "preview_panel",
                    "role": "motion_frame" if multi else "progression",
                    "phase": "B2",
                    "scenario_id": None,
                    "at_seconds": round(step["t_actual_s"] + (k / fps if multi and fps else 0), 3),
                    "viewpoint": "",
                    "state": "",
                    "width": int(w) if w.isdigit() else 0,
                    "height": int(h) if h.isdigit() else 0,
                    "sha256": hashlib.sha256(dst.read_bytes()).hexdigest(),
                    "bytes": dst.stat().st_size,
                    "derived_from": [],
                    "sample_interval_seconds": round(1 / fps, 4) if multi and fps else None,
                    "playback_fps": None,
                    "limitations": [],
                    "capture_origin": "requested",
                }
            )
    manifest = {
        "schema_version": 1,
        "run_id": frames_dir.name,
        "frames_dir": str(frames_dir.resolve()),
        "status": "complete" if arts else "unavailable",
        "artifacts": arts,
        "primary_artifact_ids": [],
        "limitations": [] if arts else ["the capture timeline retained no frames"],
    }
    path = frames_dir / "capture_manifest.json"
    path.write_text(json.dumps(manifest, indent=1))
    return path


def png_dims(p: Path) -> str:
    try:
        import struct

        h = p.open("rb").read(33)
        if h[:8] == b"\x89PNG\r\n\x1a\n":
            w, ht = struct.unpack(">II", h[16:24])
            return f"{w}x{ht}"
        if h[:3] == b"GIF":
            w, ht = struct.unpack("<HH", h[6:10])
            return f"{w}x{ht}"
        if h[:2] == b"\xff\xd8":  # jpeg: walk SOF
            d = p.read_bytes()
            i = 2
            while i < len(d) - 9:
                if d[i] != 0xFF:
                    i += 1
                    continue
                mk = d[i + 1]
                if mk in (0xC0, 0xC1, 0xC2):
                    ht, w = struct.unpack(">HH", d[i + 5 : i + 9])
                    return f"{w}x{ht}"
                i += 2 + struct.unpack(">H", d[i + 2 : i + 4])[0]
    except Exception:
        pass
    return "?"


def uniq(files: list[Path]) -> int:
    return len({hashlib.sha256(f.read_bytes()).hexdigest() for f in files if f.is_file()})


SH_TIMEOUT_S = 180  # normalisation / GIF / contact sheet; a stuck ffmpeg must not hang the run
MISSING_BINS: set[str] = set()  # binaries (e.g. ffmpeg) absent on this host — recorded in capture_result.json


def sh(cmd: list[str]) -> int:
    t = time.time()
    try:
        rc = subprocess.run(cmd, capture_output=True, timeout=SH_TIMEOUT_S).returncode
    except subprocess.TimeoutExpired:
        print(f"  [sh] timed out after {SH_TIMEOUT_S}s: {Path(cmd[0]).name}", flush=True)
        return 124
    except OSError as e:
        # A missing binary (measured on CI: no ffmpeg) must DEGRADE, not crash the capture: frames
        # already on disk stay valid, normalisation/GIF are skipped, and the gap is recorded.
        MISSING_BINS.add(Path(cmd[0]).name)
        print(f"  [{time.time() - t:6.2f}s] MISSING BINARY {cmd[0]} ({e.strerror}); skipping", flush=True)
        return 127
    print(f"  [{time.time() - t:6.2f}s] rc={rc} {Path(cmd[0]).name} {' '.join(cmd[1:4])}…", flush=True)
    return rc


def alive(m: MCP) -> bool:
    """Is the Lens Studio MCP server still answering? recordVideo can take it down, after which
    falling back to another capture method is pointless (connection refused)."""
    try:
        return bool(m.list_tools())
    except Exception:
        return False


def try_reconnect(m: MCP, attempts: int = 3, delay: float = 5.0) -> bool:
    """A dropped session may recover if Lens Studio itself is still up: re-handshake and re-probe."""
    for i in range(attempts):
        time.sleep(delay)
        try:
            m.session = None
            m.initialize()
            if alive(m):
                print(f"  MCP recovered after {i + 1} attempt(s)", flush=True)
                return True
        except Exception:
            pass
    return False


def images_from(resp) -> list[tuple[str, str]]:
    """Inline image blocks (mimeType, base64) from a tool result — how M2 gets bytes to disk."""
    out = []
    for b in ((resp or {}).get("result") or {}).get("content", []) or []:
        if (
            isinstance(b, dict)
            and b.get("data")
            and (b.get("type") == "image" or str(b.get("mimeType", "")).startswith("image/"))
        ):
            out.append((b.get("mimeType") or "image/png", b["data"]))
    return out


def exec_op(m: MCP, step: dict) -> None:
    """Execute ONE plan op with a strict API call. Shared by the start sequence and the timeline."""
    op = step.get("op")
    why = step.get("why") or ""
    if op == "wait":
        ms = int(step.get("ms", 500))
        print(f"  wait {ms}ms ({why})", flush=True)
        time.sleep(ms / 1000)
    elif op in ("inject_gesture", "gesture"):
        m.call("InjectPreviewGesture", step.get("args") or {}, timeout=60)
    elif op in ("preview_interact", "pinch"):
        m.call("PreviewInteractTool", step.get("args") or {}, timeout=120)
    elif op == "editor_code":
        r = m.call(
            "ExecuteEditorCode",
            ({"code": step["code"]} if step.get("code") else {"path": step["path"], "args": step.get("args") or {}}),
            timeout=180,
        )
        print("   ->", m.text(r)[:200])
    elif op == "move_camera":
        m.call("MovePreviewCamera", {"commands": step.get("commands") or []}, timeout=60)
    elif op == "verify_enabled":
        r = m.call("QueryRuntimeSceneTool", {"query": "{ sceneRoots { uniqueId name enabled } }", "timeoutMs": 8000})
        ok = f'"name":"{step.get("name")}","enabled":true' in m.text(r).replace(" ", "")
        print(f"   verify {step.get('name')} enabled={ok}")
    else:
        print(f"  (unknown op {op!r}, skipped)")


def run_start_sequence(m: MCP, actions: list[dict]) -> None:
    """Execute the agent's step-1 plan (config ops) with strict API calls."""
    for step in actions:
        exec_op(m, step)


def primary_panel_title(reply_text: str) -> str | None:
    """Exact title of the primary visible Preview panel (index 0) in a `listPreviews` reply."""
    try:
        d = json.loads(reply_text)
        previews = (d.get("data") or d).get("previews") or []
    except (json.JSONDecodeError, AttributeError):
        return None
    return next((p.get("title") for p in previews if isinstance(p, dict) and p.get("index") == 0), None)


# ---------------------------------------------------------------- capture methods
def do_m3(m: MCP, out: Path, a) -> dict:
    """recordVideo -> mp4 -> sampled frames. Real footage at the target fps where it works (macOS)."""
    res = {"method": "M3", "ok": False, "mechanical_error": None, "frames": [], "gif": None, "mp4": None}
    mp4 = out / "m3_record.mp4"
    args = {"outPath": str(mp4), "ms": int(a.record_ms)}
    if m.preview_name:
        args["previewTitle"] = m.preview_name
    r = m.call(
        "ExecuteEditorCode", {"path": str(RECORD_ACTION), "args": args}, timeout=max(180, a.record_ms / 1000 + 120)
    )
    txt = m.text(r)
    print("  ->", txt[:240])
    if m.log and m.log[-1]["error"]:
        res["mechanical_error"] = f"transport/tool: {m.log[-1]['error'][:160]}"
        return res
    if any(k in txt for k in RECORD_FAILURES):
        res["mechanical_error"] = f"api: {txt[:160]}"
        return res
    if not (mp4.exists() and mp4.stat().st_size > 0):
        res["mechanical_error"] = "no mp4 written"
        return res
    res["mp4"] = str(mp4)
    scale = f"scale=w={a.max}:h={a.max}:force_original_aspect_ratio=decrease:flags=lanczos"
    sh(["ffmpeg", "-y", "-i", str(mp4), "-vf", f"fps={a.fps},{scale}", str(out / "m3_frame_%02d.png")])
    frames = sorted(out.glob("m3_frame_*.png"))
    if not frames:
        res["mechanical_error"] = "mp4 produced no sampled frames"
        return res
    res["frames"] = [str(f) for f in frames]
    gif = out / "m3_record.gif"
    sh(["ffmpeg", "-y", "-framerate", str(a.fps), "-pattern_type", "glob", "-i", str(out / "m3_frame_*.png"), str(gif)])
    res["gif"] = str(gif) if gif.is_file() else None
    res["ok"] = True
    return res


def do_m2(m: MCP, out: Path, a, uid, C, S, stamps: list) -> dict:
    """Runtime-view burst; images come back INLINE -> collected in memory -> written after."""
    res = {"method": "M2", "ok": False, "mechanical_error": None, "frames": [], "gif": None}
    args = {"detail": "high", "timeoutMs": 8000}
    if uid:
        args.update({"uniqueIds": [uid], "distance": max(S) * 0.6})
    else:
        args.update({"center": {"x": C[0], "y": C[1], "z": C[2]}, "distance": max(S) * 3})
    mem: list[tuple[str, str]] = []
    interval = 1.0 / a.fps
    for _ in range(a.frames):
        t0 = time.time()
        r = m.call("CaptureRuntimeViewTool", dict(args), timeout=60)
        if m.log and m.log[-1]["error"] and not mem:
            res["mechanical_error"] = f"transport/tool: {m.log[-1]['error'][:160]}"
            return res
        imgs = images_from(r)
        if imgs:
            mem.append(imgs[0])
        stamps.append(time.time())
        slack = interval - (time.time() - t0)
        if slack > 0:
            time.sleep(slack)
    if not mem:
        res["mechanical_error"] = "no inline images returned"
        return res
    files = []
    for i, (mime, b64) in enumerate(mem):
        ext = "jpg" if ("jpeg" in mime or "jpg" in mime) else "png"
        fp = out / f"m2_runtime_{i:02d}.{ext}"
        fp.write_bytes(base64.b64decode(b64))
        files.append(fp)
    scale = f"scale=w={a.max}:h={a.max}:force_original_aspect_ratio=decrease:flags=lanczos"
    for fp in files:  # normalise dimensions in place
        tmp = fp.with_suffix(".norm.png")
        if sh(["ffmpeg", "-y", "-i", str(fp), "-vf", scale, str(tmp)]) == 0 and tmp.exists():
            fp.unlink()
            tmp.rename(fp.with_suffix(".png"))
    files = sorted(out.glob("m2_runtime_*.png")) or files
    res["frames"] = [str(f) for f in files]
    sh(
        [
            "ffmpeg",
            "-y",
            "-framerate",
            str(a.fps),
            "-pattern_type",
            "glob",
            "-i",
            str(out / "m2_runtime_*.png"),
            str(out / "m2_runtime.gif"),
        ]
    )
    res["gif"] = str(g) if (g := out / "m2_runtime.gif").exists() else None  # None when ffmpeg is absent
    res["ok"] = True
    return res


def do_m1(m: MCP, out: Path, a, poses, C, stamps: list) -> dict:
    """Panel screenshots + a deliberately subtle orbit (the panel only repaints on invalidation)."""
    res = {"method": "M1", "ok": False, "mechanical_error": None, "frames": [], "gif": None}
    interval = 1.0 / a.fps
    for p in poses:
        t0 = time.time()
        m.call(
            "MovePreviewCamera",
            {
                "commands": [
                    {"action": "setPosition", "x": p["x"], "y": p["y"], "z": p["z"]},
                    {"action": "lookAt", "x": C[0], "y": C[1], "z": C[2]},
                ]
            },
            timeout=60,
        )
        m.call(
            "CapturePanelScreenshotTool",
            {
                "pluginId": PREVIEW_PANEL,
                "outputPath": str(out / f"m1_panel_{p['i']:02d}.png"),
                "maxDimension": a.max,
            },
            timeout=60,
        )
        stamps.append(time.time())
        slack = interval - (time.time() - t0)
        if slack > 0:
            time.sleep(slack)
    files = sorted(out.glob("m1_panel_*.png"))
    if not files:
        res["mechanical_error"] = "no panel frames written"
        return res
    res["frames"] = [str(f) for f in files]
    sh(
        [
            "ffmpeg",
            "-y",
            "-framerate",
            str(a.fps),
            "-pattern_type",
            "glob",
            "-i",
            str(out / "m1_panel_*.png"),
            str(out / "m1_panel.gif"),
        ]
    )
    res["gif"] = str(g) if (g := out / "m1_panel.gif").exists() else None  # None when ffmpeg is absent
    res["ok"] = True
    return res


# ---------------------------------------------------------------- timeline mode (no agent in the loop)
def _claim(out: Path, r_: dict, tag: str) -> list[str]:
    """Rename a capture op's fixed-name frames (m2_runtime_*, m1_panel_*, m3_frame_*) to a per-op
    prefix so the next capture op can reuse those names; per-op gif/mp4 are renamed too."""
    moved: list[str] = []
    for k, f in enumerate(r_.get("frames") or []):
        src = Path(f)
        if src.is_file():
            dst = out / f"{tag}_{k:02d}{src.suffix}"
            src.rename(dst)
            moved.append(str(dst))
    for key in ("gif", "mp4"):
        p = r_.get(key)
        if p and Path(p).is_file():
            Path(p).rename(out / f"{tag}{Path(p).suffix}")
    r_["frames"] = moved
    r_["gif"] = None
    return moved


def _frozen(r_: dict) -> bool:
    files = [Path(p) for p in r_.get("frames") or []]
    return len(files) >= 2 and uniq(files) <= 1


def _needs_fallback(r_: dict, op: str) -> bool:
    """A capture method's result is unusable: it failed, came back frozen, or (for a burst or record)
    produced fewer than 2 frames, e.g. one frame before a dropped connection."""
    return not r_["ok"] or _frozen(r_) or (op != "shot" and len(r_.get("frames") or []) < 2)


def run_timeline(
    m: MCP, out: Path, a, tl: list[dict], uid, C, S, poses: list[dict], result: dict, order: list[str]
) -> None:
    """Execute a timed op list with NO agent in the loop: every op runs at its `t` (ms from timeline
    start). Plan ops (editor_code / pinch / gesture / move_camera / verify_enabled / wait) go through
    exec_op; capture ops reuse the M3/M2/M1 machinery:
      shot   -> 1 frame           burst -> `frames` @ `fps`        record -> `ms` of real footage (M3)
    A burst cascades M2 -> M1 on mechanical failure or frozen output; `record` uses M3 only where the
    platform gate allows (never on Linux) and otherwise, or when the clip fails or comes
    back frozen, degrades to an equivalent burst. Frames from
    every capture op are kept in timeline order for ONE gif + a contact sheet. `order` is the method
    order from method_gate (host gate, method_order, --start-method): a method not in it is skipped."""
    tl = sorted(tl, key=lambda st: float(st.get("t", 0)))
    T = time.time()
    frames_all: list[str] = []
    runlog: list[dict] = []
    m2_stamps: list = []
    m1_stamps: list = []
    for i, step in enumerate(tl):
        op = step.get("op")
        t_plan = float(step.get("t", 0)) / 1000.0
        slack = T + t_plan - time.time()
        if slack > 0:
            time.sleep(slack)
        t_act = time.time() - T
        ok, err, got, r_ = True, None, [], None
        tag = f"tl{i:02d}_{(step.get('label') or op or 'op').replace(' ', '_')}"
        try:
            if op in ("shot", "burst", "record"):
                # ponytail: reuse do_m* by overriding the shared Namespace for this op instead of
                # threading per-op params through three functions; restored right after.
                keep = (a.frames, a.fps, a.record_ms)
                a.frames = 1 if op == "shot" else int(step.get("frames", a.frames))
                a.fps = float(step.get("fps", a.fps))
                a.record_ms = int(step.get("ms", a.record_ms))
                try:
                    r_ = None
                    if op == "record" and "M3" in order:
                        r_ = do_m3(m, out, a)
                        if _needs_fallback(r_, op):
                            why = r_["mechanical_error"] or f"frozen or {len(r_['frames'])}-frame clip"
                            print(f"  -> record: M3 {why}; degrading to a burst", flush=True)
                            _claim(out, r_, tag + "_m3rej")
                            result["attempted"].append({**r_, "op": op, "op_index": i})
                            r_ = None
                    if r_ is None and op == "record":  # an equivalent burst: M3 not in order, or it failed
                        a.frames = max(2, int(a.record_ms / 1000.0 * a.fps))
                    if r_ is None and "M2" in order:
                        r_ = do_m2(m, out, a, uid, C, S, m2_stamps)
                        if _needs_fallback(r_, op) and "M1" in order:
                            why = r_["mechanical_error"] or f"frozen or {len(r_['frames'])}-frame output"
                            print(f"  -> {op}: M2 {why}; falling back to M1", flush=True)
                            _claim(out, r_, tag + "_m2rej")
                            result["attempted"].append({**r_, "op": op, "op_index": i})
                            r_ = None
                    if r_ is None and "M1" in order:
                        # M1 only repaints on camera invalidation: reuse main()'s subtle orbit poses
                        poses_n = [{**poses[k % len(poses)], "i": k} for k in range(a.frames)]
                        r_ = do_m1(m, out, a, poses_n, C, m1_stamps)
                    if r_ is None:  # the method order leaves nothing that can serve this op
                        r_ = {
                            "method": None,
                            "ok": False,
                            "gif": None,
                            "frames": [],
                            "mechanical_error": f"no method in {order} can capture a {op}",
                        }
                finally:
                    a.frames, a.fps, a.record_ms = keep
                got = _claim(out, r_, tag)
                files = [Path(p) for p in got]
                r_.update(
                    {
                        "op": op,
                        "op_index": i,
                        "frame_count": len(files),
                        "unique_frames": uniq(files),
                        "dims": png_dims(files[0]) if files else None,
                    }
                )
                if r_["ok"] and len(files) >= 2 and r_["unique_frames"] <= 1:
                    r_["ok"] = False
                    r_["mechanical_error"] = "degenerate output: all frames identical"
                if r_["ok"] and op != "shot" and len(files) < 2:  # e.g. one frame before a dropped connection
                    r_["ok"] = False
                    r_["mechanical_error"] = f"degenerate output: {len(files)} frame(s) for a {op}"
                result["attempted"].append(r_)
                if r_["ok"] and not result.get("chosen"):
                    result["chosen"] = r_["method"]
                ok, err = r_["ok"], r_["mechanical_error"]
            else:
                exec_op(m, step)
        except Exception as e:  # a crashing op must not kill the timeline
            ok, err = False, f"{type(e).__name__}: {e}"[:200]
        frames_all += got
        runlog.append(
            {
                "i": i,
                "op": op,
                "label": step.get("label"),
                "t_planned_s": round(t_plan, 3),
                "t_actual_s": round(t_act, 3),
                "late_s": round(max(0.0, t_act - t_plan), 3),
                "ok": ok,
                "frames": got,
                "fps": float(step.get("fps", a.fps)),
                "method": r_.get("method") if r_ else None,
                "error": err,
            }
        )
        print(
            f"  [{t_act:7.2f}s] {op:<10} planned={t_plan:6.2f}s frames={len(got):2d}"
            f"{'' if ok else '  ERR ' + str(err)}",
            flush=True,
        )
    result["timeline_run"] = runlog
    result["frames"] = frames_all
    if frames_all:  # one ordered gif + one contact sheet across ALL capture ops (ffmpeg-guarded)
        lst = out / "_frames.txt"
        lst.write_text("".join(f"file '{p}'\n" for p in frames_all))
        sh(
            [
                "ffmpeg",
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-r",
                str(a.fps),
                "-i",
                str(lst),
                "-vf",
                f"scale=w={a.max}:h={a.max}:force_original_aspect_ratio=decrease",
                str(out / "timeline.gif"),
            ]
        )
        n = len(frames_all)
        cols = min(5, n)
        rows = -(-n // cols)
        sh(
            [
                "ffmpeg",
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(lst),
                "-frames:v",
                "1",
                "-vf",
                f"scale=320:-2,tile={cols}x{rows}",
                str(out / "contact_sheet.png"),
            ]
        )
        result["gif"] = str(g) if (g := out / "timeline.gif").exists() else None
        result["contact_sheet"] = str(c) if (c := out / "contact_sheet.png").exists() else None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("project")
    ap.add_argument("--config")
    ap.add_argument("--subject", default="")
    ap.add_argument("--frames", type=int, default=10)
    ap.add_argument("--max", type=int, default=640)
    ap.add_argument("--fps", type=float, default=3.0)
    ap.add_argument("--record-ms", type=int, default=5000)
    ap.add_argument(
        "--frames-dir",
        help="eval_frames/<run_id>: copy the retained frames here and write a draft capture_manifest.json "
        "with the machine fields filled (the evaluator adds viewpoint/state/role/limitations)",
    )
    ap.add_argument(
        "--start-method", choices=["M3", "M2", "M1"], default="M3", help="re-enter the chain here (step-4 fallback)"
    )
    a = ap.parse_args()

    proj = Path(a.project)
    out = proj / "capture_driver"
    out.mkdir(exist_ok=True)
    for f in out.glob("*"):
        if f.is_file():
            f.unlink()

    T0 = time.time()
    m = MCP(str(proj))
    result: dict = {"t0": T0, "attempted": [], "chosen": None}

    try:
        phase("0-initialize")
        m.initialize()
        # M3 records the visible panel, so every preview tool targets it instead of the tools' default.
        m.preview_name = primary_panel_title(m.text(m.call("PreviewPanelTool", {"action": "listPreviews"}, timeout=30)))
        result["preview_name"] = m.preview_name
        endphase()

        cfg_path = Path(a.config) if a.config else (proj / "capture_config.json")
        cfg = json.loads(cfg_path.read_text()) if cfg_path.is_file() else {}
        if cfg:
            print(f"  config: {cfg_path}")
            a.subject = cfg.get("subject", a.subject)
            a.frames = int(cfg.get("frames", a.frames))
            a.max = int(cfg.get("max_dim", a.max))
            a.fps = float(cfg.get("fps", a.fps))
            a.record_ms = int(cfg.get("record_ms", a.record_ms))
        else:
            print(f"  (no config at {cfg_path})")

        phase("1-reset")
        if cfg.get("skip_reset"):
            print("  skipped per config (a reset would undo the started state)")
        else:
            m.call("ExecuteEditorCode", {"path": _reset_action(), "args": {"cameraNames": ["Camera", "Main Camera"]}})
        endphase()

        phase("1b-start sequence (agent plan)")
        run_start_sequence(m, cfg.get("start_actions") or [])
        endphase()

        phase("2-locate subject + bounds")
        uid = None
        r = m.call("QueryRuntimeSceneTool", {"query": "{ sceneRoots { uniqueId name enabled } }", "timeoutMs": 8000})
        (out / "_subject_query.json").write_text(m.text(r))
        try:
            for o in (json.loads(m.text(r)).get("data") or {}).get("sceneRoots") or []:
                if a.subject and a.subject.lower() in (o.get("name") or "").lower():
                    uid = o.get("uniqueId")
                    print(f"  subject={o.get('name')} uid={uid}")
                    break
        except Exception as e:
            print(f"  (root parse failed: {e})")
        C = S = None
        if uid:
            bq = '{ sceneObject(uniqueId: "%s") { name enabled childCount bounds { min max } } }' % uid
            rb = m.call("QueryRuntimeSceneTool", {"query": bq, "timeoutMs": 8000})
            (out / "_bbox.json").write_text(m.text(rb))
            try:
                so = (json.loads(m.text(rb)).get("data") or {}).get("sceneObject") or {}
                b = so.get("bounds") or {}
                mn, mx = b.get("min"), b.get("max")
                if mn and mx:
                    C = [(mn["x"] + mx["x"]) / 2, (mn["y"] + mx["y"]) / 2, (mn["z"] + mx["z"]) / 2]
                    S = [mx["x"] - mn["x"], mx["y"] - mn["y"], mx["z"] - mn["z"]]
                    print(
                        f"  enabled={so.get('enabled')} children={so.get('childCount')} "
                        f"C={[round(v, 1) for v in C]} S={[round(v, 1) for v in S]}"
                    )
            except Exception as e:
                print(f"  (bounds parse failed: {e})")
        if C is None:
            C, S = [0.0, 0.0, -100.0], [40.0, 30.0, 8.0]
            print("  no bounds -> default framing")
        endphase()

        phase("3-framing (closed form)")
        fov = math.radians(60.0)
        d = 1.6 * max(S[0], S[1]) / (2 * math.tan(fov / 2))
        base = [C[0], C[1], C[2] + d]
        rv = [base[0] - C[0], base[1] - C[1], base[2] - C[2]]
        poses = []
        for i in range(a.frames):
            yaw = math.radians(1.5 * math.sin(2 * math.pi * i / a.frames))
            pitch = math.radians(0.5 * math.sin(4 * math.pi * i / a.frames))
            x = rv[0] * math.cos(yaw) + rv[2] * math.sin(yaw)
            z = -rv[0] * math.sin(yaw) + rv[2] * math.cos(yaw)
            y = rv[1] + math.tan(pitch) * math.hypot(x, z)
            poses.append({"i": i, "x": round(C[0] + x, 3), "y": round(C[1] + y, 3), "z": round(C[2] + z, 3)})
        (out / "_poses.json").write_text(json.dumps({"C": C, "S": S, "d": d, "base": base, "poses": poses}, indent=1))
        # frame the subject before any capture
        m.call(
            "MovePreviewCamera",
            {
                "commands": [
                    {"action": "setPosition", "x": base[0], "y": base[1], "z": base[2]},
                    {"action": "lookAt", "x": C[0], "y": C[1], "z": C[2]},
                ]
            },
            timeout=60,
        )
        endphase()

        # ---- step 2: method fallback chain, abandoning a method only on MECHANICAL failure ----
        # Order is configurable; on Linux M3 is gated off regardless of the config.
        host = platform.system()
        result["host"] = host
        order = method_gate(cfg.get("method_order"), host, a.start_method)
        if host == "Linux" and "M3" in (cfg.get("method_order") or METHODS):
            print("  [gate] Linux host: M3 recordVideo disabled (takes the MCP server down here)")
        print(f"  host={host} | method order: {order}")
        if cfg.get("timeline"):
            phase("4-timeline (code-driven, no agent in the loop)")
            run_timeline(m, out, a, cfg["timeline"], uid, C, S, poses, result, order)
            endphase()
            order = []  # the timeline did the capturing; skip the legacy single-burst chain
        m1_stamps: list = []
        m2_stamps: list = []
        for meth in order:
            phase(f"4-capture {meth}")
            if not alive(m):
                print("  MCP server not answering before this method — attempting recovery", flush=True)
                if not try_reconnect(m):
                    result["server_down_after"] = result["attempted"][-1]["method"] if result["attempted"] else None
                    print("  MCP server is down; aborting the chain (further methods cannot succeed)", flush=True)
                    result["attempted"].append(
                        {
                            "method": meth,
                            "ok": False,
                            "frames": [],
                            "mechanical_error": "mcp_server_down (not attempted)",
                            "frame_count": 0,
                            "unique_frames": 0,
                            "dims": None,
                        }
                    )
                    endphase()
                    break
            try:
                if meth == "M3":
                    r_ = do_m3(m, out, a)
                elif meth == "M2":
                    r_ = do_m2(m, out, a, uid, C, S, m2_stamps)
                else:
                    r_ = do_m1(m, out, a, poses, C, m1_stamps)
            except Exception as e:
                # A crash INSIDE a method must cascade to the next method, not kill the whole chain
                # (measured on CI: M2 wrote all 10 frames, then died on a missing ffmpeg and the run
                # reported attempted=[] / chosen=None). Frames it already wrote stay on record.
                r_ = {
                    "method": meth,
                    "ok": False,
                    "gif": None,
                    "mechanical_error": f"crash: {type(e).__name__}: {e}"[:200],
                    "frames": [str(p) for p in sorted(out.glob(f"{meth.lower()}_*")) if p.suffix in (".png", ".jpg")],
                }
            endphase()
            files = [Path(p) for p in r_["frames"]]
            r_.update(
                {"frame_count": len(files), "unique_frames": uniq(files), "dims": png_dims(files[0]) if files else None}
            )
            # Strengthened cascade: a method that returned but produced EMPTY/DEGENERATE output
            # (fewer than 2 frames, or every frame byte-identical — i.e. frozen, no motion) is
            # demoted to a mechanical failure so the next method is tried. M1's camera orbit in
            # particular turns a frozen burst into distinct viewpoints, so falling a frozen M3/M2 capture
            # through to M1 is the right recovery. (Zero frames / transport drops are already
            # caught inside each do_mX.)
            if r_["ok"] and (r_["frame_count"] < 2 or r_["unique_frames"] <= 1):
                r_["ok"] = False
                r_["mechanical_error"] = (
                    f"degenerate output: {r_['frame_count']} frames, {r_['unique_frames']} unique (frozen / no motion)"
                )
            result["attempted"].append(r_)
            if r_["ok"]:
                result["chosen"] = meth
                print(
                    f"  -> {meth} OK: {r_['frame_count']} frames, {r_['unique_frames']} unique, {r_['dims']}",
                    flush=True,
                )
                break
            print(f"  -> {meth} MECHANICAL FAILURE: {r_['mechanical_error']}; falling back", flush=True)
    finally:
        # always write the logs, even if a phase blew up
        endphase()
        total = time.time() - T0
        import statistics as st

        lines = [
            f"CAPTURE DRIVER — total {total:.1f}s | chosen={result.get('chosen')}",
            "",
            f"{'t+s':>8} {'dur_s':>7}  tool",
            "-" * 62,
        ]
        for c in m.log:
            lines.append(
                f"{c['start'] - T0:8.2f} {c['dur']:7.2f}  {c['tool']}"
                f"{'  ERROR ' + (c['error'] or '')[:60] if c['error'] else ''}"
            )
        lines += ["", f"{'phase':<44} {'dur_s':>8}", "-" * 54]
        for p in PHASES:
            if p["end"]:
                lines.append(f"{p['phase']:<44} {p['end'] - p['start']:8.2f}")
        lines += [""]
        produced = {at["method"]: at.get("frame_count") or 0 for at in result["attempted"]}
        for label, stamps in (("M1", locals().get("m1_stamps") or []), ("M2", locals().get("m2_stamps") or [])):
            # only report a rate when frames actually landed: failing calls return instantly and the
            # interval padding would otherwise fabricate a perfect-looking fps
            gaps = [b - a2 for a2, b in zip(stamps, stamps[1:])]
            if len(stamps) >= 2 and produced.get(label, 0) > 0 and st.median(gaps) > 0:
                lines.append(
                    f"{label} achieved: {produced[label]} frames | median {st.median(gaps):.2f}s/frame "
                    f"({1 / st.median(gaps):.2f} fps)"
                )
            elif stamps:
                lines.append(f"{label} achieved: 0 frames written ({len(stamps)} calls attempted) — no rate")
        for at in result["attempted"]:
            lines.append(
                f"{at['method']}: ok={at['ok']} frames={at.get('frame_count')} "
                f"unique={at.get('unique_frames')} dims={at.get('dims')} "
                f"err={at.get('mechanical_error')}"
            )
        exec_total = sum(c["dur"] for c in m.log)
        lines += ["", f"MCP calls: {len(m.log)} | exec {exec_total:.1f}s | overhead {total - exec_total:.1f}s"]
        (out / "timeline.txt").write_text("\n".join(lines))
        result.update(
            {"total_s": round(total, 2), "phases": PHASES, "calls": m.log, "missing_binaries": sorted(MISSING_BINS)}
        )
        if a.frames_dir:
            result["manifest_draft"] = str(emit_manifest(result, Path(a.frames_dir)))
        (out / "capture_result.json").write_text(json.dumps(result, indent=1))
        print("\n".join(lines[-10:]))
        print(f"\nwrote {out}/timeline.txt + capture_result.json")


if __name__ == "__main__":
    main()
