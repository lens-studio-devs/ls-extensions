#!/usr/bin/env python3

# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

"""Pick the project's own music bed for the promotional video, or report that there isn't one.

The promotional video used to be silent unless the publish request happened to supply a music
file, and the preview video cannot supply audio: Lens Studio's native "Record Video" writes a
correctly-formed AAC track and fills it with silence (measured at mean/max volume -91.0 dB, i.e.
the 16-bit noise floor, on a Lens whose music bed was demonstrably playing). So a project audio
asset is the only route to a promotional video that sounds like the Lens.

Choosing that asset is a judgement this script makes mechanically rather than leaving to the
model, which cannot hear the files and would be guessing from names:

  * A music bed is *long*. SFX cues in a real project run well under three seconds (fire, UI
    click, explosion); a bed loops for tens of seconds. `MIN_MUSIC_SECONDS` separates them.
  * A music bed is *audible*. A silent-but-well-formed audio file is exactly the failure this
    whole feature exists to work around, so a candidate that is silent is rejected rather than
    passed on to produce a promotional video that reports `hasMusic: true` and plays nothing.
  * Ties break on the relative path, so the same project always yields the same choice.

`NO_MUSIC` is a normal outcome, not a failure — including when ffprobe is missing. This is a
convenience default for an artifact that is never uploaded, so it must never fail a publish or
raise a question. Every unsuitable outcome exits 0 with a `reason`.

Usage:

    python3 find-promotional-music.py --project <.esproj path or project directory>

Output, one JSON object:

    {"status": "MUSIC_FOUND", "path": "...", "durationSeconds": 36.6, "maxVolumeDb": -0.4,
     "consideredCount": 5, "rejected": [{"path": "...", "reason": "too_short"}]}
    {"status": "NO_MUSIC", "reason": "no_audio_assets" | "no_assets_dir" | "all_rejected" |
                                     "ffprobe_missing" | "project_not_found", "message": "..."}
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

# A cue is short and a bed is long; 10s sits in the wide empty gap between them.
MIN_MUSIC_SECONDS = 10.0
# Above this peak the file is audible. Digital silence measures about -91 dB, so this is a
# generous margin: it rejects silence without rejecting a quiet mix.
SILENCE_CEILING_DB = -50.0
# Bound the loudness scan; the opening seconds settle audibility for any real bed.
ANALYSIS_SECONDS = 30
AUDIO_SUFFIXES = {".wav", ".mp3", ".m4a", ".aac", ".ogg", ".flac", ".aiff", ".aif"}


def result(payload: dict[str, Any]) -> int:
    print(json.dumps(payload, sort_keys=True))
    return 0


def no_music(reason: str, message: str) -> int:
    return result({"status": "NO_MUSIC", "stage": "find_promotional_music", "reason": reason, "message": message})


def duration_of(path: Path) -> float | None:
    try:
        completed = subprocess.run(
            ["ffprobe", "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    raw = completed.stdout.strip().rstrip(",")
    try:
        return float(raw)
    except ValueError:
        return None


def max_volume_db(path: Path) -> float | None:
    """Peak level over the first `ANALYSIS_SECONDS`, or None when it cannot be measured.

    `volumedetect` reports at ffmpeg's info log level, so this must NOT pass `-v error` — doing
    so silently discards the very line being parsed and makes every file look unmeasurable.
    """
    try:
        completed = subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-nostats",
                "-t",
                str(ANALYSIS_SECONDS),
                "-i",
                str(path),
                "-map",
                "0:a:0",
                "-af",
                "volumedetect",
                "-f",
                "null",
                "-",
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    match = re.search(r"max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB", completed.stderr)
    return float(match.group(1)) if match else None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--project", required=True, help="Path to the .esproj file or the project directory.")
    args = parser.parse_args()

    project = Path(args.project).expanduser()
    if not project.exists():
        return no_music("project_not_found", f"no such project path: {project}")
    project_dir = project.parent if project.is_file() else project
    assets = project_dir / "Assets"
    if not assets.is_dir():
        return no_music("no_assets_dir", f"no Assets directory under {project_dir}")

    found = sorted(p for p in assets.rglob("*") if p.is_file() and p.suffix.lower() in AUDIO_SUFFIXES)
    if not found:
        return no_music("no_audio_assets", f"no audio assets under {assets}")

    if shutil.which("ffprobe") is None or shutil.which("ffmpeg") is None:
        return no_music("ffprobe_missing", "ffmpeg/ffprobe are required to measure candidate audio")

    candidates: list[tuple[float, str, Path, float]] = []
    rejected: list[dict[str, Any]] = []
    for path in found:
        relative = str(path.relative_to(project_dir))
        seconds = duration_of(path)
        if seconds is None:
            rejected.append({"path": relative, "reason": "unreadable"})
            continue
        if seconds < MIN_MUSIC_SECONDS:
            rejected.append({"path": relative, "reason": "too_short", "durationSeconds": round(seconds, 2)})
            continue
        peak = max_volume_db(path)
        if peak is None:
            rejected.append({"path": relative, "reason": "no_audio_stream"})
            continue
        if peak <= SILENCE_CEILING_DB:
            rejected.append({"path": relative, "reason": "silent", "maxVolumeDb": peak})
            continue
        candidates.append((seconds, relative, path, peak))

    if not candidates:
        return no_music(
            "all_rejected",
            f"none of the {len(found)} audio asset(s) is a usable music bed "
            f"(need ≥{MIN_MUSIC_SECONDS:g}s and a peak above {SILENCE_CEILING_DB:g} dB)",
        )

    # Longest wins; the relative path breaks ties so the choice is reproducible.
    seconds, relative, path, peak = max(candidates, key=lambda item: (item[0], item[1]))
    return result(
        {
            "status": "MUSIC_FOUND",
            "stage": "find_promotional_music",
            "path": str(path),
            "projectRelativePath": relative,
            "durationSeconds": round(seconds, 2),
            "maxVolumeDb": peak,
            "consideredCount": len(found),
            "candidateCount": len(candidates),
            "rejected": rejected,
        }
    )


if __name__ == "__main__":
    sys.exit(main())
