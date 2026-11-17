#!/usr/bin/env python3

# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

"""Resolve inputs and build the optional post-submit promotional video in one call."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
FIND_MUSIC = HERE / "find-promotional-music.py"
BUILD_VIDEO = HERE / "build-promotional-video.sh"
GENERATED_PREVIEW_INTERMEDIATES = {
    "preview-native.mp4",
    "preview-midpoint.png",
    "preview-near-end.png",
    "preview-media-config.json",
    "preview-flow-state.json",
    "preview-source.jpg",
    "preview-image.png",
    "recorder-result.json",
    "recorder.ready",
}


def emit(payload: dict[str, Any]) -> int:
    print(json.dumps(payload, separators=(",", ":"), sort_keys=True))
    return 0


def json_result(completed: subprocess.CompletedProcess[str]) -> dict[str, Any] | None:
    for line in reversed(completed.stdout.splitlines()):
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    return None


def cleanup_generated_preview(preview: Path) -> None:
    parent = preview.parent
    if not parent.name.startswith("specs-preview-media."):
        return
    for name in GENERATED_PREVIEW_INTERMEDIATES:
        candidate = parent / name
        if candidate != preview:
            candidate.unlink(missing_ok=True)


def finish(payload: dict[str, Any], preview: Path, cleanup_preview: bool) -> int:
    if cleanup_preview:
        cleanup_generated_preview(preview.resolve())
    return emit(payload)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preview-video", required=True)
    parser.add_argument("--project")
    parser.add_argument("--lens-name", required=True)
    parser.add_argument("--lens-description", default="")
    parser.add_argument("--music")
    parser.add_argument("--icon")
    parser.add_argument("--cleanup-generated-preview", action="store_true")
    args = parser.parse_args()

    preview = Path(args.preview_video).expanduser()
    if not preview.is_absolute() or not preview.is_file():
        return emit(
            {
                "status": "PROMOTIONAL_VIDEO_SKIPPED",
                "stage": "promotional_video",
                "reason": "no_local_preview_video",
            }
        )
    if sys.platform != "darwin":
        return finish(
            {
                "status": "ACTION_REQUIRED",
                "stage": "promotional_video",
                "reason": "unsupported_os",
                "message": "Promotional-video generation is macOS-only.",
            },
            preview,
            args.cleanup_generated_preview,
        )

    music_path: Path | None = None
    music_source = "none"
    if args.music:
        supplied = Path(args.music).expanduser()
        if not supplied.is_absolute() or not supplied.is_file():
            return finish(
                {
                    "status": "FAILED",
                    "stage": "promotional_video",
                    "reason": "music_missing",
                    "message": "The supplied promotional music path is not a readable local file.",
                },
                preview,
                args.cleanup_generated_preview,
            )
        music_path = supplied.resolve()
        music_source = "request"
    elif args.project:
        found = subprocess.run(
            [sys.executable, str(FIND_MUSIC), "--project", args.project],
            check=False,
            capture_output=True,
            text=True,
        )
        music = json_result(found)
        if isinstance(music, dict) and music.get("status") == "MUSIC_FOUND":
            candidate = music.get("path")
            if isinstance(candidate, str) and Path(candidate).is_file():
                music_path = Path(candidate).resolve()
                music_source = "project_asset"

    icon_path: Path | None = None
    if args.icon:
        candidate = Path(args.icon).expanduser()
        if candidate.is_absolute() and candidate.is_file():
            icon_path = candidate.resolve()

    try:
        output_dir = Path(tempfile.mkdtemp(prefix="specs-promotional."))
    except OSError as error:
        return finish(
            {
                "status": "FAILED",
                "stage": "promotional_video",
                "reason": "output_directory_unavailable",
                "message": str(error),
            },
            preview,
            args.cleanup_generated_preview,
        )
    output_path = output_dir / "promotional-video.mp4"
    environment = {
        **os.environ,
        "PREVIEW_VIDEO_PATH": str(preview.resolve()),
        "LENS_NAME": args.lens_name,
        "LENS_DESCRIPTION": args.lens_description,
        "OUTPUT_PATH": str(output_path),
        "COVER_SECONDS": "2",
    }
    if music_path is not None:
        environment["MUSIC_PATH"] = str(music_path)
    if icon_path is not None:
        environment["ICON_PATH"] = str(icon_path)
    try:
        completed = subprocess.run(
            ["bash", str(BUILD_VIDEO)],
            check=False,
            capture_output=True,
            text=True,
            env=environment,
        )
    except OSError as error:
        shutil.rmtree(output_dir, ignore_errors=True)
        return finish(
            {
                "status": "FAILED",
                "stage": "promotional_video",
                "reason": "promotional_build_unavailable",
                "message": str(error),
            },
            preview,
            args.cleanup_generated_preview,
        )
    result = json_result(completed)
    if result is None:
        result = {
            "status": "FAILED",
            "reason": "promotional_build_invalid",
            "message": completed.stderr.strip() or completed.stdout.strip() or f"exit {completed.returncode}",
        }
    result = {
        **result,
        "stage": "promotional_video",
        "promotionalVideoMusicSource": music_source,
    }
    if result.get("status") != "PROMOTIONAL_VIDEO_READY":
        shutil.rmtree(output_dir, ignore_errors=True)
    return finish(result, preview, args.cleanup_generated_preview)


if __name__ == "__main__":
    sys.exit(main())
