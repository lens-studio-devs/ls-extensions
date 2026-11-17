#!/usr/bin/env python3
# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

"""Normalize an Editor API Preview recording to store-ready video."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

_DEFS = json.loads(
    (Path(__file__).resolve().parents[1] / "schemas" / "preview-images.schema.json").read_text(encoding="utf-8")
)["$defs"]
TARGET_WIDTH = _DEFS["image"]["properties"]["width"]["const"]
TARGET_HEIGHT = _DEFS["image"]["properties"]["height"]["const"]
MIN_SECONDS = _DEFS["videoDurationSeconds"]["minimum"]
MAX_SECONDS = _DEFS["videoDurationSeconds"]["maximum"]
MAX_BYTES = _DEFS["videoBytes"]["maximum"]


def write_result(log_path: Path, status: str, **values: Any) -> int:
    result = {"status": status, **values}
    encoded = json.dumps(result, separators=(",", ":"))
    try:
        log_path.write_text(encoded + "\n")
    except OSError:
        pass
    print(encoded)
    return 0 if status == "VIDEO_READY" else 1


def run(arguments: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(arguments, check=False, capture_output=True, text=True)


def probe(path: Path, *entries: str) -> dict[str, Any]:
    completed = run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            ":".join(entries),
            "-of",
            "json",
            str(path),
        ]
    )
    if completed.returncode != 0:
        raise ValueError(completed.stderr.strip() or "ffprobe failed")
    try:
        value = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise ValueError("ffprobe returned invalid JSON") from error
    if not isinstance(value, dict):
        raise ValueError("ffprobe returned an invalid result")
    return value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--log", type=Path, required=True)
    parser.add_argument("--duration-seconds", type=float, default=20.0)
    args = parser.parse_args()

    input_path = args.input
    output_path = args.output
    log_path = args.log
    if not input_path.is_absolute() or not input_path.is_file():
        return write_result(log_path, "FAILED", reason="native_video_missing", message="Input MP4 is missing.")
    if not output_path.is_absolute() or not output_path.parent.is_dir() or output_path.suffix.lower() != ".mp4":
        return write_result(
            log_path,
            "FAILED",
            reason="invalid_output_path",
            message="Output must be an absolute .mp4 path in an existing directory.",
        )
    if not log_path.is_absolute() or not log_path.parent.is_dir():
        print(json.dumps({"status": "FAILED", "reason": "invalid_log_path"}, separators=(",", ":")))
        return 1
    if input_path.resolve() == output_path.resolve():
        return write_result(
            log_path, "FAILED", reason="input_output_collision", message="Input and output paths must differ."
        )
    if not MIN_SECONDS <= args.duration_seconds <= MAX_SECONDS:
        return write_result(
            log_path,
            "FAILED",
            reason="invalid_duration",
            message=f"Duration must be between {MIN_SECONDS} and {MAX_SECONDS} seconds.",
        )
    if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
        return write_result(
            log_path,
            "ACTION_REQUIRED",
            reason="ffmpeg_missing",
            message="ffmpeg and ffprobe are required to normalize the preview video.",
        )

    try:
        source = probe(input_path, "stream=width,height")
        streams = source.get("streams")
        if not isinstance(streams, list) or not streams:
            raise ValueError("native Preview recording has no video stream")
        source_width = int(streams[0]["width"])
        source_height = int(streams[0]["height"])
        if source_width <= 0 or source_height <= 0:
            raise ValueError("native Preview recording has invalid dimensions")
    except (KeyError, TypeError, ValueError) as error:
        return write_result(log_path, "FAILED", reason="probe_failed", message=str(error))

    if source_width / source_height > 3 / 4:
        native_crop_width, native_crop_height = int(source_height * 3 / 4), source_height
    else:
        native_crop_width, native_crop_height = source_width, int(source_width * 4 / 3)

    output_path.unlink(missing_ok=True)
    encoded = run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-nostdin",
            "-i",
            str(input_path),
            "-vf",
            f"crop='min(iw,ih*3/4)':'min(ih,iw*4/3)',scale={TARGET_WIDTH}:{TARGET_HEIGHT}:flags=lanczos,"
            "fps=30,format=yuv420p",
            "-t",
            f"{args.duration_seconds:g}",
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-movflags",
            "+faststart",
            str(output_path),
        ]
    )
    if encoded.returncode != 0:
        output_path.unlink(missing_ok=True)
        return write_result(
            log_path, "FAILED", reason="encode_failed", message=encoded.stderr.strip() or "ffmpeg failed"
        )

    try:
        result = probe(output_path, "stream=width,height", "format=duration")
        streams = result.get("streams")
        format_result = result.get("format")
        if not isinstance(streams, list) or not streams or not isinstance(format_result, dict):
            raise ValueError("normalized video probe is incomplete")
        width = int(streams[0]["width"])
        height = int(streams[0]["height"])
        duration = float(format_result["duration"])
        byte_count = output_path.stat().st_size
    except (KeyError, OSError, TypeError, ValueError) as error:
        output_path.unlink(missing_ok=True)
        return write_result(log_path, "FAILED", reason="probe_failed", message=str(error))

    if (width, height) != (TARGET_WIDTH, TARGET_HEIGHT):
        output_path.unlink(missing_ok=True)
        return write_result(
            log_path,
            "FAILED",
            reason="encode_failed",
            message=f"Encoded video is {width}x{height}, expected {TARGET_WIDTH}x{TARGET_HEIGHT}.",
        )
    # Lens Studio's hidden/beta recorder can stop several seconds before the
    # requested duration even when it returns a valid video, so the session asks
    # for more than the store minimum and keeps any clip the store accepts.
    lower = MIN_SECONDS
    upper = min(MAX_SECONDS, args.duration_seconds + 1.0)
    if not lower <= duration <= upper:
        output_path.unlink(missing_ok=True)
        return write_result(
            log_path,
            "FAILED",
            reason="duration_out_of_range",
            message=f"Encoded video duration is {duration:.2f}s, expected approximately {args.duration_seconds:.2f}s.",
        )
    if byte_count > MAX_BYTES:
        output_path.unlink(missing_ok=True)
        return write_result(
            log_path,
            "FAILED",
            reason="too_large",
            message=f"Encoded video is {byte_count} bytes, store limit is 100 MB.",
        )

    input_path.unlink(missing_ok=True)
    return write_result(
        log_path,
        "VIDEO_READY",
        path=str(output_path),
        width=width,
        height=height,
        durationSeconds=round(duration, 2),
        bytes=byte_count,
        nativeSourceWidth=source_width,
        nativeSourceHeight=source_height,
        nativeCropWidth=native_crop_width,
        nativeCropHeight=native_crop_height,
        upscaled=native_crop_width < TARGET_WIDTH or native_crop_height < TARGET_HEIGHT,
        recorder="lens_studio_record_video_api",
    )


if __name__ == "__main__":
    sys.exit(main())
