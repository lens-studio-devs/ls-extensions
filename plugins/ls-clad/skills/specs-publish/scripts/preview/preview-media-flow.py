#!/usr/bin/env python3

"""Deterministic state machine for automatic Specs preview media."""

from __future__ import annotations

import argparse
import json
import shlex
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

CAPTURE_BUDGET_SECONDS = 90
RECORDER_LAUNCH_LIMIT_SECONDS = 25

# Static-footage fast path.
#
# A Lens whose Preview sits on a start menu cannot produce motion: the capture
# protocol forbids activating Start or replay, so the recording is 20 static
# seconds by construction. Detecting that with a model vision round-trip costs
# two frame reads plus a `decide` call for a result that is already determined
# by the pixels, so `inspect` measures it directly instead.
#
# Two metrics, because either one alone is wrong:
#   meanLumaDiff    — mean luma of the frame difference. Catches global drift,
#                     but a small fast object on a large static background barely
#                     moves the mean, so it cannot be used alone.
#   changedFraction — fraction of pixels whose luma moved more than
#                     STATIC_LUMA_NOISE_FLOOR. Catches localized motion, and the
#                     noise floor keeps codec ringing in a genuinely static clip
#                     from registering as change.
#
# The thresholds are deliberately tight, so the decision is fail-safe: anything
# short of near-identical frames falls through to the model's existing two-frame
# judgment. A false "moving" only forgoes the speedup; a false "static" would
# throw away real footage.
STATIC_LUMA_NOISE_FLOOR = 24
STATIC_MEAN_LUMA_DIFF = 1.0
STATIC_CHANGED_FRACTION = 0.0005
SUCCESS_STATUSES = {
    "WORKER_TASK_READY",
    "CAPTURE_COMMAND_READY",
    "INSPECTION_READY",
    "CAPTURE_SCREENSHOT",
    "VIDEO_READY",
    "AUTO_IMAGE_READY",
}


def emit(status: str, **values: Any) -> int:
    print(json.dumps({"status": status, **values}, separators=(",", ":")))
    return 0 if status in SUCCESS_STATUSES else 1


@dataclass(frozen=True)
class FlowPaths:
    config: Path
    recorder: Path
    output_dir: Path
    video: Path
    ready: Path
    log: Path
    image_source: Path
    image_output: Path
    midpoint: Path
    near_end: Path
    state: Path
    inspection_script: Path
    stager_script: Path


def require_absolute_file(value: Any, field: str, expected_name: str) -> Path:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{field} must be a non-empty absolute path")
    path = Path(value)
    if not path.is_absolute() or path.name != expected_name:
        raise ValueError(f"{field} must be an absolute path ending in {expected_name}")
    try:
        resolved = path.resolve(strict=True)
    except OSError as error:
        raise ValueError(f"{field} does not exist: {path}") from error
    if not resolved.is_file():
        raise ValueError(f"{field} must be a file")
    return resolved


def load_paths(config_path: Path) -> FlowPaths:
    try:
        config = json.loads(config_path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"invalid config: {error}") from error
    if not isinstance(config, dict):
        raise ValueError("config must contain one JSON object")
    removed_fields = sorted(
        {
            "previewName",
            "queryTool",
            "interactTool",
            "inspectionScript",
            "stagerScript",
            "outputPath",
            "readyPath",
            "logPath",
            "imageSourcePath",
            "imageOutputPath",
        }.intersection(config)
    )
    if removed_fields:
        raise ValueError(
            "preview-media-flow derives generated paths and rejects legacy fields: " + ", ".join(removed_fields)
        )
    recorder = require_absolute_file(
        config.get("recorderScript"),
        "recorderScript",
        "record-preview-video.sh",
    )
    output_dir_value = config.get("outputDir")
    if not isinstance(output_dir_value, str) or not output_dir_value:
        raise ValueError("outputDir must be a non-empty absolute path")
    output_dir = Path(output_dir_value)
    if not output_dir.is_absolute():
        raise ValueError("outputDir must be an absolute path")
    try:
        output_dir = output_dir.resolve(strict=True)
    except OSError as error:
        raise ValueError("outputDir must already exist") from error
    if not output_dir.is_dir():
        raise ValueError("outputDir must be a directory")

    script_dir = Path(__file__).resolve().parent
    return FlowPaths(
        config=config_path.resolve(),
        recorder=recorder,
        output_dir=output_dir,
        video=output_dir / "preview-video.mp4",
        ready=output_dir / "recorder.ready",
        log=output_dir / "recorder-result.json",
        image_source=output_dir / "preview-source.jpg",
        image_output=output_dir / "preview-image.png",
        midpoint=output_dir / "preview-midpoint.png",
        near_end=output_dir / "preview-near-end.png",
        state=output_dir / "preview-flow-state.json",
        inspection_script=script_dir / "prepare-preview-video-inspection.py",
        stager_script=script_dir / "stage-preview-screenshot.py",
    )


def command(*parts: str | Path) -> str:
    return " ".join(shlex.quote(str(part)) for part in parts)


def recorder_command(paths: FlowPaths) -> str:
    return " ".join(
        [
            f"OUTPUT_PATH={shlex.quote(str(paths.video))}",
            f"READY_PATH={shlex.quote(str(paths.ready))}",
            f"LOG_PATH={shlex.quote(str(paths.log))}",
            "DURATION_SECONDS=20",
            "bash",
            shlex.quote(str(paths.recorder)),
        ]
    )


def inline_capture_command(paths: FlowPaths) -> str:
    """One shell command that records and then inspects.

    The recorder's stdout is discarded because it already tees its terminal result
    to LOG_PATH, which is what `inspect` reads. That leaves exactly one JSON object
    on stdout — the inspect result — so a caller can run the whole capture as a
    single foreground shell call and branch on that.

    The two commands are joined with `;` and not `&&`: `inspect` must run whatever
    the recorder's exit status was, so that a recorder failure becomes a driver-owned
    CAPTURE_SCREENSHOT rather than an unhandled shell error.
    """
    driver = Path(__file__).resolve()
    return "; ".join(
        [
            f"{recorder_command(paths)} >/dev/null 2>&1",
            command("python3", driver, "inspect", "--config", paths.config),
        ]
    )


def build_worker_prompt(paths: FlowPaths) -> str:
    driver = Path(__file__).resolve()
    inspect_command = command("python3", driver, "inspect", "--config", paths.config)
    decide_prefix = command("python3", driver, "decide", "--config", paths.config)
    screenshot_command = command(
        "python3",
        driver,
        "screenshot",
        "--config",
        paths.config,
        "--input",
        paths.image_source,
    )
    lines = [
        "Execute passive preview-media protocol v4 silently; return one compact JSON result.",
        f"Budget {CAPTURE_BUDGET_SECONDS}s. Launch within {RECORDER_LAUNCH_LIMIT_SECONDS}s.",
        "Do not read skills, inspect schemas, discover tools, interact with Preview, or move its camera.",
        (
            "FIRST TOOL CALL: use the runtime's direct foreground shell primitive with GUI/unsandboxed "
            f"authority to run: `{recorder_command(paths)}`"
        ),
        (
            "Never wrap the recorder in a nested orchestration/evaluation call. Use a short yield. If the "
            "direct shell call returns a retained session handle, NEXT TOOL CALL: use the runtime's session-join "
            "primitive with that exact handle; repeat only that bounded join until exit. Never poll readiness "
            "or use &."
        ),
        f"Then run `{inspect_command}` once, regardless of recorder exit text.",
        (
            "If that returns AUTO_IMAGE_READY, the footage was already measured as static; return it "
            "unchanged immediately. Do not read frames and do not call decide — the state file is gone "
            "and a decide call would fail."
        ),
        (
            "On INSPECTION_READY, inspect midpointPath and nearEndPath. Run exactly one "
            f"`{decide_prefix} --decision <video|image|screenshot> [--frame <midpoint|near_end>]`: "
            "video only for safe active progression; image for safe mostly-static footage; screenshot otherwise."
        ),
        "Return VIDEO_READY or AUTO_IMAGE_READY unchanged.",
        (
            "On CAPTURE_SCREENSHOT, use one durable orchestration scope: call CapturePanelScreenshotTool "
            "exactly once with "
            f'{{"pluginId":"Snap.Plugin.Gui.PreviewPanel","outputPath":"{paths.image_source}",'
            '"maxDimension":1920}; require success and its returned path to match outputPath; run '
            f"`{screenshot_command}` and return its result."
        ),
        (
            "Never omit outputPath, expose/store/load base64, reconstruct image bytes, recapture, "
            "ask for video, return "
            "AUTO_IMAGE_FALLBACK_REQUIRED, or call QueryRuntimeSceneTool, PreviewInteractTool, "
            "CaptureRuntimeViewTool, MovePreviewCamera, or any broad tool-registry discovery."
        ),
        (
            "A static/start/replay screenshot is acceptable. Only corrupt, editor/debug, unsafe/private, or "
            "misleading screenshots may require a manually saved screenshot or cancellation."
        ),
    ]
    return "\n".join(lines)


def read_terminal_result(log_path: Path) -> dict[str, Any] | None:
    try:
        lines = [line.strip() for line in log_path.read_text().splitlines() if line.strip()]
    except OSError:
        return None
    for line in reversed(lines):
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict) and isinstance(value.get("status"), str):
            return value
    return None


def run_json(arguments: list[str]) -> dict[str, Any]:
    try:
        completed = subprocess.run(
            arguments,
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError as error:
        raise ValueError(str(error)) from error
    try:
        result = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise ValueError(completed.stderr.strip() or "helper returned invalid JSON") from error
    if not isinstance(result, dict) or not isinstance(result.get("status"), str):
        raise ValueError("helper returned an invalid result")
    return result


def clean_generated(paths: FlowPaths, *, keep_video: bool = False) -> None:
    for path in (
        paths.midpoint,
        paths.near_end,
        paths.image_source,
        paths.image_output,
        paths.state,
    ):
        path.unlink(missing_ok=True)
    if not keep_video:
        paths.video.unlink(missing_ok=True)


def write_state(paths: FlowPaths, inspection: dict[str, Any], capture: str) -> None:
    state = {
        "videoPath": inspection["videoPath"],
        "midpointPath": inspection["midpointPath"],
        "nearEndPath": inspection["nearEndPath"],
        "width": inspection["width"],
        "height": inspection["height"],
        "durationSeconds": inspection["durationSeconds"],
        "bytes": paths.video.stat().st_size,
        "capture": capture,
    }
    paths.state.write_text(json.dumps(state, separators=(",", ":")))


def signalstats_yavg(first: Path, second: Path, *, binarize: bool) -> float | None:
    """Mean luma of the difference of two frames, optionally binarized against the
    noise floor first so the result is the changed-pixel fraction times 255."""
    chain = ["[0:v][1:v]blend=difference", "format=gray"]
    if binarize:
        chain.append(f"lutyuv=y='if(gt(val,{STATIC_LUMA_NOISE_FLOOR}),255,0)'")
    chain += ["signalstats", "metadata=print:file=-"]
    try:
        proc = subprocess.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-nostdin",
                "-i",
                str(first),
                "-i",
                str(second),
                "-filter_complex",
                ",".join(chain),
                "-f",
                "null",
                "-",
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if proc.returncode != 0:
        return None
    values = [line.rsplit("=", 1)[1].strip() for line in proc.stdout.splitlines() if "lavfi.signalstats.YAVG=" in line]
    if not values:
        return None
    try:
        return float(values[-1])
    except ValueError:
        return None


def frame_motion(paths: FlowPaths) -> dict[str, Any] | None:
    """Deterministic motion metrics between the two authoritative frames, or None
    when they cannot be measured — in which case the caller must fall through to
    the model's two-frame decision rather than guessing."""
    mean_diff = signalstats_yavg(paths.midpoint, paths.near_end, binarize=False)
    if mean_diff is None:
        return None
    changed = signalstats_yavg(paths.midpoint, paths.near_end, binarize=True)
    if changed is None:
        return None
    changed_fraction = changed / 255
    return {
        "meanLumaDiff": round(mean_diff, 4),
        "changedFraction": round(changed_fraction, 6),
        "static": mean_diff <= STATIC_MEAN_LUMA_DIFF and changed_fraction <= STATIC_CHANGED_FRACTION,
    }


def select_static_frame(
    paths: FlowPaths,
    state: dict[str, Any],
    frame: str,
    *,
    reason: str,
    motion: dict[str, Any] | None = None,
) -> int:
    """Promote one extracted frame to the staged auto-image and clean up. Shared by
    the driver's static fast path and the model's explicit `--decision image`, so
    both produce a byte-identical result."""
    selected = paths.midpoint if frame == "midpoint" else paths.near_end
    if not selected.is_file():
        return emit("FAILED", reason="selected_frame_missing")
    try:
        shutil.copyfile(selected, paths.image_output)
        byte_count = paths.image_output.stat().st_size
    except OSError as error:
        paths.image_output.unlink(missing_ok=True)
        return emit("FAILED", reason="image_selection_failed", message=str(error))
    paths.video.unlink(missing_ok=True)
    paths.midpoint.unlink(missing_ok=True)
    paths.near_end.unlink(missing_ok=True)
    paths.image_source.unlink(missing_ok=True)
    paths.state.unlink(missing_ok=True)
    extra: dict[str, Any] = {"motion": motion} if motion is not None else {}
    return emit(
        "AUTO_IMAGE_READY",
        reason=reason,
        path=str(paths.image_output),
        width=state["width"],
        height=state["height"],
        bytes=byte_count,
        source="auto_image",
        capture=state.get("capture", "lens_studio_native"),
        selectedFrame=frame,
        **extra,
    )


def inspect(paths: FlowPaths, *, recovery: bool) -> int:
    terminal = read_terminal_result(paths.log)
    if terminal is None or terminal.get("status") != "VIDEO_READY":
        reason = terminal.get("reason") if terminal else "terminal_result_missing"
        if reason == "ffmpeg_missing":
            return emit(
                "ACTION_REQUIRED",
                reason="ffmpeg_missing",
                message="ffmpeg and ffprobe are required for automatic preview media.",
            )
        clean_generated(paths)
        return emit("CAPTURE_SCREENSHOT", reason=reason or "recorder_failed")

    try:
        terminal_path = Path(str(terminal["path"])).resolve(strict=True)
        expected_path = paths.video.resolve(strict=True)
    except (KeyError, OSError):
        clean_generated(paths)
        return emit("CAPTURE_SCREENSHOT", reason="video_missing")
    if terminal_path != expected_path:
        clean_generated(paths)
        return emit("CAPTURE_SCREENSHOT", reason="video_path_mismatch")

    try:
        result = run_json(
            [
                "python3",
                str(paths.inspection_script),
                "--video",
                str(paths.video),
                "--output-dir",
                str(paths.output_dir),
            ]
        )
    except ValueError as error:
        clean_generated(paths)
        return emit("CAPTURE_SCREENSHOT", reason="inspection_failed", message=str(error))
    if result["status"] != "FRAMES_READY":
        clean_generated(paths)
        return emit("CAPTURE_SCREENSHOT", reason=str(result.get("reason") or "inspection_failed"))

    capture = "recovered_after_worker_timeout" if recovery else "lens_studio_native"
    try:
        write_state(paths, result, capture)
    except (KeyError, OSError, TypeError, ValueError) as error:
        clean_generated(paths)
        return emit("CAPTURE_SCREENSHOT", reason="inspection_state_failed", message=str(error))
    # Static fast path: when the pixels already prove there is no progression, the
    # model's two-frame decision cannot reach a different conclusion, so resolve to
    # the auto-image here and save the worker a vision round-trip plus a `decide`
    # call. `near_end` matches the frame the reference tells the model to prefer
    # when the two frames are equivalent.
    motion = frame_motion(paths)
    if motion is not None and motion["static"]:
        try:
            state = read_state(paths)
        except ValueError:
            state = {"capture": capture}
        return select_static_frame(
            paths,
            state,
            "near_end",
            reason="mostly_static_video",
            motion=motion,
        )

    return emit(
        "INSPECTION_READY",
        midpointPath=result["midpointPath"],
        nearEndPath=result["nearEndPath"],
        width=result["width"],
        height=result["height"],
        durationSeconds=result["durationSeconds"],
        capture=capture,
        motion=motion,
    )


def read_state(paths: FlowPaths) -> dict[str, Any]:
    try:
        state = json.loads(paths.state.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError("inspect must succeed before decide") from error
    if not isinstance(state, dict):
        raise ValueError("preview flow state is invalid")
    for field in ("videoPath", "midpointPath", "nearEndPath", "width", "height", "durationSeconds", "bytes"):
        if field not in state:
            raise ValueError(f"preview flow state is missing {field}")
    return state


def decide(paths: FlowPaths, decision: str, frame: str | None) -> int:
    try:
        state = read_state(paths)
    except ValueError as error:
        return emit("FAILED", reason="invalid_preview_flow_state", message=str(error))
    if decision == "screenshot":
        clean_generated(paths)
        return emit("CAPTURE_SCREENSHOT", reason="video_rejected")
    if decision == "video":
        for path in (paths.midpoint, paths.near_end, paths.image_source, paths.image_output, paths.state):
            path.unlink(missing_ok=True)
        return emit(
            "VIDEO_READY",
            path=state["videoPath"],
            width=state["width"],
            height=state["height"],
            durationSeconds=state["durationSeconds"],
            bytes=state["bytes"],
            recorder="lens_studio_native",
            capture=state.get("capture", "lens_studio_native"),
        )
    if frame not in {"midpoint", "near_end"}:
        return emit("FAILED", reason="frame_required", message="image decision requires --frame")
    return select_static_frame(paths, state, frame, reason="mostly_static_video")


def stage_screenshot(paths: FlowPaths, input_path: Path) -> int:
    try:
        result = run_json(
            [
                "python3",
                str(paths.stager_script),
                "--input",
                str(input_path),
                "--output",
                str(paths.image_output),
            ]
        )
    except ValueError as error:
        return emit("FAILED", reason="screenshot_staging_failed", message=str(error))
    if result["status"] != "SCREENSHOT_READY":
        print(json.dumps(result, separators=(",", ":")))
        return 1
    if input_path == paths.image_source:
        input_path.unlink(missing_ok=True)
    return emit(
        "AUTO_IMAGE_READY",
        reason="video_fallback_screenshot",
        path=result["path"],
        width=result["width"],
        height=result["height"],
        bytes=result["bytes"],
        source="auto_image",
        capture="lens_studio_preview_panel",
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="operation", required=True)
    for operation in ("worker-task", "capture-command", "inspect"):
        operation_parser = subparsers.add_parser(operation)
        operation_parser.add_argument("--config", type=Path, required=True)
        if operation == "inspect":
            operation_parser.add_argument("--recovery", action="store_true")
    decide_parser = subparsers.add_parser("decide")
    decide_parser.add_argument("--config", type=Path, required=True)
    decide_parser.add_argument("--decision", choices=("video", "image", "screenshot"), required=True)
    decide_parser.add_argument("--frame", choices=("midpoint", "near_end"))
    screenshot_parser = subparsers.add_parser("screenshot")
    screenshot_parser.add_argument("--config", type=Path, required=True)
    screenshot_parser.add_argument("--input", type=Path, required=True)
    args = parser.parse_args()

    try:
        paths = load_paths(args.config)
    except ValueError as error:
        return emit("FAILED", reason="invalid_preview_flow_config", message=str(error))
    if args.operation == "worker-task":
        return emit(
            "WORKER_TASK_READY",
            protocolVersion=4,
            captureMode="passive",
            budgetSeconds=CAPTURE_BUDGET_SECONDS,
            recorderLaunchLimitSeconds=RECORDER_LAUNCH_LIMIT_SECONDS,
            prompt=build_worker_prompt(paths),
        )
    if args.operation == "capture-command":
        # Inline capture: the caller runs this one command itself instead of
        # spawning a worker. A worker only earns its cost when a model must look
        # at frames, and the static fast path means that is now the exception.
        return emit(
            "CAPTURE_COMMAND_READY",
            protocolVersion=4,
            captureMode="inline",
            budgetSeconds=CAPTURE_BUDGET_SECONDS,
            recorderLaunchLimitSeconds=RECORDER_LAUNCH_LIMIT_SECONDS,
            command=inline_capture_command(paths),
        )
    if args.operation == "inspect":
        return inspect(paths, recovery=args.recovery)
    if args.operation == "decide":
        return decide(paths, args.decision, args.frame)
    input_path = args.input
    if not input_path.is_absolute() or not input_path.is_file():
        return emit("FAILED", reason="preview_screenshot_invalid")
    return stage_screenshot(paths, input_path.resolve())


if __name__ == "__main__":
    sys.exit(main())
