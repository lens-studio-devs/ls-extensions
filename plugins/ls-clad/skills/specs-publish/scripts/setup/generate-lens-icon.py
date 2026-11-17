#!/usr/bin/env python3
# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

"""Generate a deterministic, text-free PNG for a missing Lens icon."""

from __future__ import annotations

import argparse
import colorsys
import hashlib
import json
import math
import re
import struct
import zlib
from pathlib import Path

ICON_SIZE = 320


def read_project_scalar(project_text: str, key: str) -> str:
    match = re.search(rf"(?:^|\n)\s*{re.escape(key)}:\s*([^\r\n]*)", project_text)
    if not match:
        return ""
    return match.group(1).strip().strip("\"'").strip()


def rgb_from_hsv(hue: float, saturation: float, value: float) -> tuple[int, int, int]:
    return tuple(round(channel * 255) for channel in colorsys.hsv_to_rgb(hue, saturation, value))


def mix(first: tuple[int, int, int], second: tuple[int, int, int], amount: float) -> tuple[int, int, int]:
    amount = max(0.0, min(1.0, amount))
    return tuple(round(a + (b - a) * amount) for a, b in zip(first, second))


def png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data)) + chunk_type + data + struct.pack(">I", zlib.crc32(chunk_type + data) & 0xFFFFFFFF)
    )


def render_icon(seed_text: str) -> bytes:
    seed = hashlib.sha256(seed_text.encode("utf-8")).digest()
    primary_hue = seed[0] / 255.0
    secondary_hue = (primary_hue + 0.24 + (seed[1] / 255.0) * 0.22) % 1.0
    background_a = rgb_from_hsv(primary_hue, 0.72, 0.88)
    background_b = rgb_from_hsv(secondary_hue, 0.78, 0.55)
    iris = rgb_from_hsv((primary_hue + 0.52) % 1.0, 0.64, 0.72)
    iris_dark = rgb_from_hsv((primary_hue + 0.52) % 1.0, 0.74, 0.30)
    phase = (seed[2] / 255.0) * math.tau

    size = ICON_SIZE
    center = (size - 1) / 2.0
    rows = bytearray()
    for y in range(size):
        rows.append(0)  # PNG filter: None
        ny = (y - center) / size
        for x in range(size):
            nx = (x - center) / size
            diagonal = (x + y) / (2.0 * (size - 1))
            radial = min(1.0, math.hypot(nx, ny) / 0.71)
            color = mix(background_a, background_b, 0.18 + diagonal * 0.72)
            color = mix(color, (8, 12, 28), max(0.0, radial - 0.58) * 0.44)

            distance = math.hypot(nx, ny)
            angle = math.atan2(ny, nx)

            # A clean aperture mark: recognizable at small sizes and free of text/logos.
            if distance < 0.305:
                edge = max(0.0, min(1.0, (0.305 - distance) * size / 4.0))
                color = mix(color, (246, 249, 255), 0.90 * edge)
            if distance < 0.235:
                edge = max(0.0, min(1.0, (0.235 - distance) * size / 4.0))
                color = mix(color, iris, 0.94 * edge)

            blade_radius = 0.148 + 0.027 * math.sin(6.0 * angle + phase)
            if distance < blade_radius:
                edge = max(0.0, min(1.0, (blade_radius - distance) * size / 3.0))
                color = mix(color, iris_dark, 0.88 * edge)
            if distance < 0.068:
                edge = max(0.0, min(1.0, (0.068 - distance) * size / 3.0))
                color = mix(color, (12, 16, 30), 0.94 * edge)

            highlight = math.hypot(nx + 0.072, ny + 0.083)
            if highlight < 0.035:
                edge = max(0.0, min(1.0, (0.035 - highlight) * size / 3.0))
                color = mix(color, (255, 255, 255), 0.86 * edge)

            rows.extend(color)

    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", header)
        + png_chunk(b"IDAT", zlib.compress(bytes(rows), level=9))
        + png_chunk(b"IEND", b"")
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True, type=Path, help="Absolute path to the .esproj file")
    parser.add_argument("--output", required=True, type=Path, help="Fresh temporary .png output path")
    parser.add_argument("--lens-name", default="", help="Confirmed/proposed Lens name override")
    args = parser.parse_args()

    project_path = args.project.expanduser().resolve()
    output_path = args.output.expanduser().resolve()
    if project_path.suffix.lower() != ".esproj" or not project_path.is_file():
        parser.error("--project must point to an existing .esproj file")
    if output_path.suffix.lower() != ".png":
        parser.error("--output must use the .png extension")
    if output_path.exists():
        parser.error("--output must be a fresh path")

    project_text = project_path.read_text(encoding="utf-8")
    lens_name = args.lens_name.strip() or read_project_scalar(project_text, "lensName") or project_path.stem
    package_id = read_project_scalar(project_text, "packageId")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(render_icon(f"{lens_name}\n{package_id}"))

    print(
        json.dumps(
            {
                "status": "ICON_GENERATED",
                "path": str(output_path),
                "width": ICON_SIZE,
                "height": ICON_SIZE,
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
