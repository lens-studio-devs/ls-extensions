#!/usr/bin/env python3

"""Stage one screenshot, or an automatic pair, as store-ready 3:4 PNGs."""

from __future__ import annotations

import argparse
import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

_spec = importlib.util.spec_from_file_location(
    "preview_contract", Path(__file__).resolve().parents[1] / "schemas" / "preview_contract.py"
)
CONTRACT = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(CONTRACT)
_IMAGE_SCHEMA = CONTRACT.SCHEMA["$defs"]["image"]["properties"]
TARGET_WIDTH = _IMAGE_SCHEMA["width"]["const"]
TARGET_HEIGHT = _IMAGE_SCHEMA["height"]["const"]
MAX_BYTES = CONTRACT.SCHEMA["$defs"]["imageBytes"]["maximum"]


def emit(status: str, **values: Any) -> int:
    print(json.dumps(CONTRACT.validate("stageResult", {"status": status, **values}), separators=(",", ":")))
    return 0 if status in {"SCREENSHOT_READY", "SCREENSHOTS_READY"} else 1


def probe(path: Path) -> dict[str, Any]:
    completed = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=codec_name,width,height",
            "-of",
            "json",
            str(path),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise ValueError(completed.stderr.strip() or "ffprobe could not read the staged screenshot")
    value = json.loads(completed.stdout)
    streams = value.get("streams")
    if not isinstance(streams, list) or len(streams) != 1 or not isinstance(streams[0], dict):
        raise ValueError("staged screenshot must contain exactly one image stream")
    return streams[0]


def stage(input_path: Path, output: Path) -> dict[str, Any]:
    try:
        output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            prefix="preview-screenshot-source-",
            suffix=".image",
            dir=output.parent,
            delete=False,
        ) as temporary:
            temporary_path = Path(temporary.name)
        try:
            if not input_path.is_absolute() or not input_path.is_file():
                raise ValueError("--input must be an existing absolute file path")
            shutil.copyfile(input_path, temporary_path)
            completed = subprocess.run(
                [
                    "ffmpeg",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-i",
                    str(temporary_path),
                    "-vf",
                    (
                        f"scale={TARGET_WIDTH}:{TARGET_HEIGHT}:"
                        "force_original_aspect_ratio=increase,"
                        f"crop={TARGET_WIDTH}:{TARGET_HEIGHT}"
                    ),
                    "-frames:v",
                    "1",
                    str(output),
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            if completed.returncode != 0:
                raise ValueError(completed.stderr.strip() or "ffmpeg could not stage the screenshot")
        finally:
            temporary_path.unlink(missing_ok=True)
        stream = probe(output)
        if (
            stream.get("codec_name") != "png"
            or stream.get("width") != TARGET_WIDTH
            or stream.get("height") != TARGET_HEIGHT
        ):
            raise ValueError("staged screenshot dimensions or format are invalid")
        byte_count = output.stat().st_size
        if byte_count <= 0 or byte_count > MAX_BYTES:
            raise ValueError("staged screenshot size is invalid")
    except (OSError, ValueError, json.JSONDecodeError) as error:
        output.unlink(missing_ok=True)
        raise ValueError(str(error)) from error

    return {
        "path": str(output),
        "width": TARGET_WIDTH,
        "height": TARGET_HEIGHT,
        "bytes": byte_count,
        "source": "auto_image",
        "capture": "lens_studio_preview_panel",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--second-input", type=Path, help="Second capture for the automatic two-image plan.")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        CONTRACT.validate(
            "stageInput",
            {
                "input": str(args.input),
                "output": str(args.output),
                **({"secondInput": str(args.second_input)} if args.second_input is not None else {}),
            },
        )
    except ValueError as error:
        return emit("FAILED", reason="invalid_input", message=str(error))

    if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
        return emit(
            "ACTION_REQUIRED",
            reason="ffmpeg_missing",
            message="ffmpeg and ffprobe are required to stage Preview screenshots.",
        )
    output = args.output
    if not output.is_absolute() or output.name != "preview-image.png":
        return emit(
            "FAILED",
            reason="invalid_output_path",
            message="--output must be an absolute path ending in preview-image.png.",
        )
    inputs = [args.input] if args.second_input is None else [args.input, args.second_input]
    outputs = [output] if args.second_input is None else [output, output.with_name("preview-image-2.png")]
    # Validate the complete batch before writing any output. Two captures may be
    # visually identical for a static Lens, but must be independently saved files.
    if any(not path.is_absolute() or not path.is_file() for path in inputs):
        return emit("FAILED", reason="invalid_input_path", message="Inputs must be existing absolute file paths.")
    if len({path.resolve() for path in inputs}) != len(inputs) or (
        {path.resolve() for path in inputs} & {path.resolve() for path in outputs}
    ):
        return emit(
            "FAILED", reason="invalid_input_path", message="Capture sources and outputs must be separate files."
        )
    try:
        images = [stage(source, target) for source, target in zip(inputs, outputs)]
    except (OSError, ValueError) as error:
        for target in outputs:
            target.unlink(missing_ok=True)
        return emit("FAILED", reason="screenshot_staging_failed", message=str(error))
    if args.second_input is None:
        return emit("SCREENSHOT_READY", **images[0])
    return emit(
        "SCREENSHOTS_READY",
        images=images,
        proposals={
            "previewMediaPlan": "auto_image",
            "previewMedia": [{"path": item["path"], "type": "image", "source": item["source"]} for item in images],
        },
    )


if __name__ == "__main__":
    sys.exit(main())
