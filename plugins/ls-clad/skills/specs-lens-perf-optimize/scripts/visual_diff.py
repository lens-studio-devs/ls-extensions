#!/usr/bin/env python3
# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

"""Compute visual parity scores between a baseline screenshot bundle and a post-fix bundle.

Per harness marker (idle | interaction | climax) computes:
  - SSIM (structural similarity)         — primary parity score
  - color-histogram cosine similarity    — secondary parity score
  - perceptual hash hamming distance     — informational (not gated)

Writes:
  - <out>.json with per-marker scores and an aggregate keep/revert verdict
  - <thumb>.png with side-by-side (baseline | post-fix) for each marker, stacked vertically

Inputs:
  --before <dir>   directory containing marker_idle.png, marker_interaction.png, marker_climax.png
  --after  <dir>   same shape
  --out    <path>  json output path
  --thumb  <path>  png output path (optional)
  --ssim-threshold        default 0.92  (passes if all markers >= this)
  --ssim-hard-threshold   default 0.85  (hard revert below this)
  --hist-threshold        default 0.97  (passes if all markers >= this)

Exits 0 always (orchestrator parses the verdict from the JSON output).
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

try:
    from PIL import Image
except ImportError:
    print("error: Pillow is required (pip install Pillow)", file=sys.stderr)
    sys.exit(2)

MARKERS = ("idle", "interaction", "climax")


def load_grayscale(path: Path, size: Tuple[int, int] = (256, 256)) -> Optional[list]:
    """Return a flat list of normalized grayscale floats, or None if file missing."""
    if not path.exists():
        return None
    # Close the source file handle: Image.open is lazy and leaks the fd otherwise.
    with Image.open(path) as src:
        img = src.convert("L").resize(size, getattr(Image, "Resampling", Image).BILINEAR)
    return list(img.getdata())


def load_rgb(path: Path, size: Tuple[int, int] = (256, 256)) -> Optional[Image.Image]:
    if not path.exists():
        return None
    # Close the source file handle: Image.open is lazy and leaks the fd otherwise.
    with Image.open(path) as src:
        return src.convert("RGB").resize(size, getattr(Image, "Resampling", Image).BILINEAR)


def ssim_from_pixels(a: List[int], b: List[int]) -> float:
    """Single-channel SSIM mean. Implements the Wang-Bovik formulation over the whole image
    (no per-window aggregation). Adequate for parity checks on resized 256×256 captures."""
    if not a or not b or len(a) != len(b):
        return 0.0
    n = len(a)
    mu_a = sum(a) / n
    mu_b = sum(b) / n
    var_a = sum((x - mu_a) ** 2 for x in a) / n
    var_b = sum((x - mu_b) ** 2 for x in b) / n
    cov_ab = sum((a[i] - mu_a) * (b[i] - mu_b) for i in range(n)) / n
    L = 255.0
    c1 = (0.01 * L) ** 2
    c2 = (0.03 * L) ** 2
    num = (2 * mu_a * mu_b + c1) * (2 * cov_ab + c2)
    den = (mu_a**2 + mu_b**2 + c1) * (var_a + var_b + c2)
    if den == 0:
        return 1.0 if num == 0 else 0.0
    return num / den


def histogram_cosine(a: Image.Image, b: Image.Image) -> float:
    """Cosine similarity between flattened normalized RGB histograms (8 bins per channel)."""

    def hist8(img: Image.Image) -> List[float]:
        h = [0] * (8 * 8 * 8)
        for r, g, bl in img.getdata():
            h[(r // 32) * 64 + (g // 32) * 8 + (bl // 32)] += 1
        s = sum(h) or 1
        return [v / s for v in h]

    ha = hist8(a)
    hb = hist8(b)
    dot = sum(x * y for x, y in zip(ha, hb))
    na = math.sqrt(sum(x * x for x in ha))
    nb = math.sqrt(sum(x * x for x in hb))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def phash_hamming(a: Image.Image, b: Image.Image) -> int:
    """64-bit perceptual hash hamming distance. Uses a simple 8×8 average-hash variant."""

    def ahash(img: Image.Image) -> int:
        small = img.convert("L").resize((8, 8), getattr(Image, "Resampling", Image).BILINEAR)
        px = list(small.getdata())
        avg = sum(px) / 64
        bits = 0
        for i, p in enumerate(px):
            if p > avg:
                bits |= 1 << i
        return bits

    h = ahash(a) ^ ahash(b)
    return bin(h).count("1")


def make_thumb(before: Image.Image, after: Image.Image, out_path: Path, label: str) -> None:
    w, h = before.size
    canvas = Image.new("RGB", (w * 2 + 4, h + 16), (32, 32, 32))
    canvas.paste(before, (0, 16))
    canvas.paste(after, (w + 4, 16))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path)


def compute(args: argparse.Namespace) -> dict:
    before_dir = Path(args.before)
    after_dir = Path(args.after)
    thumb_marker_paths: List[Path] = []

    per_marker: Dict[str, dict] = {}
    aggregate_pass = True
    hard_revert = False
    fail_reason = None

    for marker in MARKERS:
        before_path = before_dir / f"marker_{marker}.png"
        after_path = after_dir / f"marker_{marker}.png"

        before_missing = not before_path.exists()
        after_missing = not after_path.exists() or (after_dir / f"marker_{marker}.missing").exists()

        if before_missing and after_missing:
            per_marker[marker] = {
                "status": "both_missing",
                "ssim": None,
                "histogram_cosine": None,
                "phash_hamming": None,
            }
            continue
        if before_missing:
            per_marker[marker] = {
                "status": "baseline_missing",
                "ssim": None,
                "histogram_cosine": None,
                "phash_hamming": None,
            }
            continue
        if after_missing:
            per_marker[marker] = {"status": "post_missing", "ssim": 0.0, "histogram_cosine": 0.0, "phash_hamming": 64}
            aggregate_pass = False
            hard_revert = True
            fail_reason = fail_reason or f"post-fix marker {marker} missing"
            continue

        gray_a = load_grayscale(before_path)
        gray_b = load_grayscale(after_path)
        rgb_a = load_rgb(before_path)
        rgb_b = load_rgb(after_path)
        if gray_a is None or gray_b is None or rgb_a is None or rgb_b is None:
            per_marker[marker] = {"status": "load_error", "ssim": 0.0, "histogram_cosine": 0.0, "phash_hamming": 64}
            aggregate_pass = False
            fail_reason = fail_reason or f"could not load {marker}"
            continue

        s = ssim_from_pixels(gray_a, gray_b)
        h = histogram_cosine(rgb_a, rgb_b)
        ph = phash_hamming(rgb_a, rgb_b)

        marker_pass = True
        marker_reason = None
        if s < args.ssim_hard_threshold:
            marker_pass = False
            hard_revert = True
            marker_reason = f"ssim<{args.ssim_hard_threshold} (hard)"
        elif s < args.ssim_threshold:
            marker_pass = False
            marker_reason = f"ssim<{args.ssim_threshold}"
        if h < args.hist_threshold:
            marker_pass = False
            marker_reason = (marker_reason + "; " if marker_reason else "") + f"histogram<{args.hist_threshold}"

        if not marker_pass:
            aggregate_pass = False
            fail_reason = fail_reason or f"{marker}: {marker_reason}"

        per_marker[marker] = {
            "status": "ok" if marker_pass else "fail",
            "ssim": round(s, 4),
            "histogram_cosine": round(h, 4),
            "phash_hamming": ph,
            "reason": marker_reason,
        }

        if args.thumb:
            thumb_path = Path(args.thumb).with_name(Path(args.thumb).stem + f"_{marker}.png")
            make_thumb(rgb_a, rgb_b, thumb_path, marker)
            thumb_marker_paths.append(thumb_path)

    scored = sum(1 for m in per_marker.values() if m.get("status") in ("ok", "fail"))
    if scored == 0:
        # No marker had usable before+after frames — "no visual evidence" must NOT
        # pass vacuously. Force a hard revert so the orchestrator stops/reverts.
        aggregate_pass = False
        hard_revert = True
        fail_reason = fail_reason or "no markers compared (no usable baseline/post frames)"

    verdict = {
        "pass": aggregate_pass and not hard_revert,
        "hard_revert": hard_revert,
        "markers_compared": scored,
        "reason": fail_reason or "all markers passed",
        "markers": per_marker,
        "thresholds": {
            "ssim": args.ssim_threshold,
            "ssim_hard": args.ssim_hard_threshold,
            "histogram_cosine": args.hist_threshold,
        },
        "thumbs": [str(p) for p in thumb_marker_paths],
    }
    return verdict


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--before", required=True, help="Directory with baseline marker_*.png")
    p.add_argument("--after", required=True, help="Directory with post-fix marker_*.png")
    p.add_argument("--out", required=True, help="JSON output path")
    p.add_argument("--thumb", default=None, help="PNG output path prefix (one thumb per marker)")
    p.add_argument("--ssim-threshold", type=float, default=0.92)
    p.add_argument("--ssim-hard-threshold", type=float, default=0.85)
    p.add_argument("--hist-threshold", type=float, default=0.97)
    args = p.parse_args()

    verdict = compute(args)
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(verdict, indent=2), encoding="utf-8")
    print(json.dumps({"pass": verdict["pass"], "reason": verdict["reason"]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
