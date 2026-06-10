#!/usr/bin/env python3
# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

"""Render a Lens performance attribution donut chart from label,value CSV.

CSV format:
    label,value
    Gaussian splats,1.86
    SIK/input,0.41
"""

from __future__ import annotations

import argparse
import csv
import math
from pathlib import Path
from typing import List, Optional, Sequence, Tuple


def read_values(path: Path, keep_order: bool) -> List[Tuple[str, float]]:
    values: List[Tuple[str, float]] = []
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        if "label" not in (reader.fieldnames or []) or "value" not in (reader.fieldnames or []):
            raise SystemExit("CSV must contain 'label' and 'value' columns")
        for row in reader:
            label = (row.get("label") or "").strip()
            if not label:
                continue
            try:
                value = float(row.get("value") or 0)
            except ValueError:
                continue
            if value > 0:
                values.append((label, value))
    if not keep_order:
        values.sort(key=lambda x: x[1], reverse=True)
    return values


def render(
    values: Sequence[Tuple[str, float]],
    output: Path,
    title: str,
    subtitle: str,
    center_title: str,
    footer: str,
) -> None:
    if not values:
        raise SystemExit("No positive values to plot")

    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    labels = [v[0] for v in values]
    sizes = [v[1] for v in values]
    total = sum(sizes)
    colors = [
        "#4E79A7",
        "#F28E2B",
        "#E15759",
        "#76B7B2",
        "#59A14F",
        "#EDC948",
        "#B07AA1",
        "#FF9DA7",
        "#9C755F",
        "#BAB0AC",
        "#6B6ECF",
        "#E17C05",
    ]

    fig, ax = plt.subplots(figsize=(16, 10), facecolor="white")
    ax.set_aspect("equal")

    wedges, _ = ax.pie(
        sizes,
        startangle=90,
        counterclock=False,
        colors=colors[: len(sizes)],
        wedgeprops={"width": 0.38, "edgecolor": "white", "linewidth": 3},
        radius=1.0,
    )

    # Left-aligned title and optional subtitle.
    fig.text(0.055, 0.945, title, ha="left", va="top", fontsize=26, fontweight="bold", color="#222222")
    if subtitle:
        fig.text(0.055, 0.905, subtitle, ha="left", va="top", fontsize=13, color="#666666")

    # Center label.
    ax.text(
        0,
        0.08,
        center_title,
        ha="center",
        va="center",
        fontsize=20,
        fontweight="bold",
        color="#222222",
        linespacing=1.1,
    )
    ax.text(0, -0.12, f"{total:.2f} ms/frame", ha="center", va="center", fontsize=15, color="#444444")

    # External labels with leader lines.
    for i, wedge in enumerate(wedges):
        theta = (wedge.theta1 + wedge.theta2) / 2.0
        rad = math.radians(theta)
        x, y = math.cos(rad), math.sin(rad)
        label_radius = 1.35
        label_x = label_radius * (1 if x >= 0 else -1)
        label_y = 1.20 * y
        ha = "left" if x >= 0 else "right"
        pct = sizes[i] / total * 100.0
        text = f"{labels[i]}\n{sizes[i]:.2f} ms/f · {pct:.1f}%"
        ax.annotate(
            text,
            xy=(0.86 * x, 0.86 * y),
            xytext=(label_x, label_y),
            ha=ha,
            va="center",
            fontsize=12,
            color="#222222",
            arrowprops={
                "arrowstyle": "-",
                "color": "#888888",
                "lw": 0.9,
                "shrinkA": 0,
                "shrinkB": 0,
                "connectionstyle": f"angle,angleA=0,angleB={theta}",
            },
        )

    ax.set_xlim(-1.75, 1.75)
    ax.set_ylim(-1.35, 1.35)
    ax.axis("off")

    if footer:
        fig.text(0.055, 0.045, footer, ha="left", va="bottom", fontsize=10.5, color="#777777")

    output.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output, dpi=180, bbox_inches="tight", facecolor="white")
    plt.close(fig)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("contributors_csv", help="CSV with label,value columns")
    parser.add_argument("--title", default="Lens: attributed frame-time contributors")
    parser.add_argument("--subtitle", default="project-only / preview baseline excluded")
    parser.add_argument("--center-title", default="Attributed\nframe time")
    parser.add_argument(
        "--footer",
        default=(
            "Source: performance sweep traces + differential attribution. "
            "Positive deltas only; Preview baseline excluded. "
            "Values are attributed slice ms/frame, not CPU core-time."
        ),
    )
    parser.add_argument("--output", default="attributed_frame_time.png")
    parser.add_argument("--keep-order", action="store_true", help="Preserve CSV order instead of sorting descending")
    args = parser.parse_args(argv)

    values = read_values(Path(args.contributors_csv), keep_order=args.keep_order)
    render(values, Path(args.output), args.title, args.subtitle, args.center_title, args.footer)
    print(f"Wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
