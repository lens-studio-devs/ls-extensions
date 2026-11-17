#!/usr/bin/env python3

"""Validate a native preview video and extract its two authoritative review frames."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

_DEFS = json.loads(
    (Path(__file__).resolve().parents[1] / "schemas" / "preview-images.schema.json").read_text(encoding="utf-8")
)["$defs"]
TARGET_WIDTH = _DEFS["image"]["properties"]["width"]["const"]
TARGET_HEIGHT = _DEFS["image"]["properties"]["height"]["const"]
DURATION_SECONDS = _DEFS["videoDurationSeconds"]
MAX_BYTES = _DEFS["videoBytes"]["maximum"]


def emit(status: str, **values: Any) -> int:
    print(json.dumps({"status": status, **values}, separators=(",", ":")))
    return 0 if status == "FRAMES_READY" else 1


def probe(video_path: Path) -> tuple[int, int, float] | None:
    try:
        completed = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height:format=duration",
                "-of",
                "json",
                str(video_path),
            ],
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError:
        return None
    if completed.returncode != 0:
        return None
    try:
        value = json.loads(completed.stdout)
        stream = value["streams"][0]
        return int(stream["width"]), int(stream["height"]), float(value["format"]["duration"])
    except (IndexError, KeyError, TypeError, ValueError, json.JSONDecodeError):
        return None


def extract_frame(video_path: Path, timestamp: float, output_path: Path) -> bool:
    try:
        completed = subprocess.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-y",
                "-ss",
                f"{timestamp:.3f}",
                "-i",
                str(video_path),
                "-frames:v",
                "1",
                str(output_path),
            ],
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError:
        return False
    return completed.returncode == 0 and output_path.is_file() and output_path.stat().st_size > 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()

    try:
        video_path = args.video.resolve(strict=True)
        output_dir = args.output_dir.resolve(strict=True)
    except OSError:
        return emit("FAILED", reason="video_or_output_missing")
    if not video_path.is_file() or not output_dir.is_dir():
        return emit("FAILED", reason="video_or_output_invalid")

    dimensions_and_duration = probe(video_path)
    if dimensions_and_duration is None:
        return emit("FAILED", reason="probe_failed")
    width, height, duration = dimensions_and_duration
    if width != TARGET_WIDTH or height != TARGET_HEIGHT:
        return emit("FAILED", reason="invalid_dimensions", width=width, height=height)
    # The store accepts preview videos inside this window.
    if not DURATION_SECONDS["minimum"] <= duration <= DURATION_SECONDS["maximum"]:
        return emit("FAILED", reason="invalid_duration", durationSeconds=round(duration, 3))
    if video_path.stat().st_size > MAX_BYTES:
        return emit("FAILED", reason="too_large", bytes=video_path.stat().st_size)

    midpoint_seconds = duration / 2
    near_end_seconds = max(midpoint_seconds + 0.25, duration - 1)
    near_end_seconds = min(near_end_seconds, duration - 0.1)
    midpoint_path = output_dir / "preview-midpoint.png"
    near_end_path = output_dir / "preview-near-end.png"
    if not extract_frame(video_path, midpoint_seconds, midpoint_path):
        return emit("FAILED", reason="midpoint_extract_failed")
    if not extract_frame(video_path, near_end_seconds, near_end_path):
        midpoint_path.unlink(missing_ok=True)
        return emit("FAILED", reason="near_end_extract_failed")

    return emit(
        "FRAMES_READY",
        videoPath=str(video_path),
        width=width,
        height=height,
        durationSeconds=round(duration, 3),
        midpointSeconds=round(midpoint_seconds, 3),
        midpointPath=str(midpoint_path),
        nearEndSeconds=round(near_end_seconds, 3),
        nearEndPath=str(near_end_path),
    )


if __name__ == "__main__":
    sys.exit(main())
