#!/usr/bin/env python3
# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0
"""Store tile boundary: validate reuse state and local screenshots and stage PNG primary/center-fill crops.

prepare({tileAssetsState, previewMediaAssets, sourcePath?, outputDir})
returns {status: TILE_ASSETS_READY, tileAssets, sourcePath?}; errors raise ValueError.
No uploads or project mutations. Requires ffmpeg, already used by preview staging.
"""

import base64
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

DIMENSIONS = {"primary": (1056, 1056), "default": (504, 672), "square": (504, 504), "hero": (1056, 792)}
MAX_BYTES = json.loads(
    (Path(__file__).resolve().parents[1] / "schemas" / "preview-images.schema.json").read_text(encoding="utf-8")
)["$defs"]["imageBytes"]["maximum"]


def prepare(payload):
    if not isinstance(payload, dict) or set(payload) - {
        "tileAssetsState",
        "previewMediaAssets",
        "sourcePath",
        "outputDir",
    }:
        raise ValueError("Invalid tile preparation input")
    existing = payload.get("tileAssetsState")
    if not isinstance(existing, str) or existing not in {"existing", "missing"}:
        raise ValueError("tileAssetsState must be existing or missing")
    if existing == "existing" and not payload.get("sourcePath"):
        return {"status": "TILE_ASSETS_READY", "tileAssets": []}
    if not isinstance(payload.get("outputDir"), str) or not payload["outputDir"]:
        raise ValueError("outputDir is required")
    output = Path(payload["outputDir"])
    if not output.is_absolute():
        raise ValueError("outputDir must be absolute")
    if not shutil.which("ffmpeg"):
        raise ValueError("ffmpeg is required to prepare store tiles")
    assets = payload.get("previewMediaAssets", [])
    if not isinstance(assets, list) or any(not isinstance(a, dict) for a in assets):
        raise ValueError("previewMediaAssets must be an array of media objects")
    source = payload.get("sourcePath")
    if source is None:
        source = next(
            (a.get("path") for a in assets if a.get("type") == "image" and a.get("source") == "auto_image"), None
        )
    if source is None:
        raise ValueError("Supply tileSourcePath with a local Lens Studio Preview screenshot to prepare store tiles")
    if not isinstance(source, str) or not Path(source).is_absolute() or not Path(source).is_file():
        raise ValueError("tileSourcePath must name an existing absolute local PNG screenshot path")
    if Path(source).stat().st_size > MAX_BYTES:
        raise ValueError("Tile source exceeds 15 MB")
    with Path(source).open("rb") as screenshot:
        if screenshot.read(8) != b"\x89PNG\r\n\x1a\n":
            raise ValueError("Tile source must be a PNG Lens Studio Preview screenshot")
    output.mkdir(parents=True, exist_ok=True)
    result = []
    for role, size in DIMENSIONS.items():
        target = output / f"{role}.png"
        command = [
            "ffmpeg",
            "-nostdin",
            "-v",
            "error",
            "-y",
            "-protocol_whitelist",
            "file,pipe,data",
            "-i",
            source,
            "-frames:v",
            "1",
        ]
        width, height = size
        command += [
            "-vf",
            f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},setsar=1",
        ]
        command += [str(target)]
        completed = subprocess.run(command, capture_output=True, timeout=60)
        if completed.returncode:
            raise ValueError("Could not decode the preview or crop store tiles; supply a valid preview image")
        data = target.read_bytes()
        if not 0 < len(data) <= MAX_BYTES or not data.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError("Generated tile is not a valid PNG within 15 MB")
        result.append(
            {
                "tileType": role,
                "path": str(target),
                "type": "image",
                "source": "preview_crop",
                "checksum": base64.b64encode(hashlib.sha256(data).digest()).decode(),
                "bytes": len(data),
            }
        )
    return {"status": "TILE_ASSETS_READY", "tileAssets": result, "sourcePath": source}
