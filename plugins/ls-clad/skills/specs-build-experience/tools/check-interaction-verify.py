#!/usr/bin/env python3
# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0
"""
Deterministic pass/fail for the interaction-verify gate.

The build agent DRIVES each interaction and RECORDS raw measurements into
`.clad/steps/interaction-verify.json` (schema in
`references/interaction-verify.md`). This script COMPUTES the verdict by
arithmetic over that artifact — so "pass" is calculated, not narrated, and a
1%-size speck cannot be rationalised into "a faint low-relief tile" (the failure
mode: an orchestrator grading its own play-through talks itself past an invisible
mark).

Checks, per interaction:
  - completeness  : required fields present (else fail; a missing row is not a skip)
  - size (per axis): measured_cm[i]/expected_aabb_cm[i] within [MIN_RATIO, MAX_RATIO]
                     on every axis. Per-axis catches a collapsed speck (all axes tiny)
                     AND a gross orientation flip (axes swapped). Coarse visibility band,
                     NOT precise sizing (that is bootstrap-refit's job).
  - placement     : worldPosition within PLACE_TOL_CM of expected_anchor ("landed at
                     its anchor", not sub-cm precision).
  - visible       : Layer-2 capture result; must be true (null = Layer 2 not run yet).

Does NOT judge cause. worldScale/worldRotation are recorded for diagnosis but are
never pass/fail inputs — reading worldScale~=100 as "oversize" is the exact
false-flag the pipeline exists to avoid (100 is the normal m->cm import).

A light ruler-sanity warning flags the classic broken-ruler signature (a perfect
~20cm or ~100cm cube on an object whose expected size is nothing like that), which
means an AiPreviewAgentInspect package with the world-AABB and small-object-clamp fixes
is probably not provisioned and the reading is UNVERIFIED rather than a real pass.

Usage:
  check-interaction-verify.py <path to interaction-verify.json>
Exit code: 0 = every interaction passed (or the set is empty / vacuous); 1 = any
fail/incomplete/unverified; 2 = artifact missing or unreadable. Writes verdict/reason
back into each row and prints a summary table.
"""

import json
import math
import sys

MIN_RATIO = 0.5  # measured must be >= half of expected on every axis
MAX_RATIO = 2.0  # ... and <= twice expected
PLACE_TOL_CM = 5.0  # coarse "landed at its anchor" tolerance
RULER_EPS = 0.02  # cube-ness / roundness tolerance for the broken-ruler heuristic


def _vec3(v):
    if not isinstance(v, (list, tuple)) or len(v) != 3:
        return None
    try:
        return [float(v[0]), float(v[1]), float(v[2])]
    except (TypeError, ValueError):
        return None


def _looks_like_broken_ruler(measured, expected):
    """Classic phantom signature: a near-perfect ~20cm or ~100cm cube that does not
    match the expected size — the unfixed MIN_EXTENT clamp / transform-AABB fallback."""
    mx = max(abs(x) for x in measured) or 1e-9
    cubeish = all(abs(abs(a) - mx) / mx < RULER_EPS for a in measured)
    if not cubeish:
        return False
    for suspect in (20.0, 100.0):
        if all(abs(abs(a) - suspect) < suspect * RULER_EPS for a in measured):
            # a real object legitimately this size + cubic is rare; only warn when
            # expected is clearly different
            if any(abs(e - suspect) > suspect * 0.25 for e in expected):
                return True
    return False


def check_row(row, idx):
    # The caller labels each row on print (row["interaction"] / interaction[idx]);
    # check_row returns the reason unprefixed to avoid a doubled label.
    measured = _vec3(row.get("measured_cm"))
    expected = _vec3(row.get("expected_aabb_cm"))
    pos = _vec3(row.get("worldPosition"))
    anchor = _vec3(row.get("expected_anchor"))

    if measured is None or expected is None:
        return "fail", "incomplete: measured_cm / expected_aabb_cm missing or malformed"
    if any(e <= 0 for e in expected):
        return "fail", f"incomplete: expected_aabb_cm has a non-positive axis {expected}"

    if _looks_like_broken_ruler(measured, expected):
        return "unverified", (
            f"broken-ruler signature: measured {measured} is a round cube unlike expected "
            f"{expected} — an AiPreviewAgentInspect with the world-AABB and small-object-clamp "
            f"fixes is likely not provisioned; "
            f"reading is unreliable, not a pass"
        )

    ratios = [measured[i] / expected[i] for i in range(3)]
    if any(r < MIN_RATIO or r > MAX_RATIO for r in ratios):
        axes = "xyz"
        bad = ", ".join(
            f"{axes[i]}={measured[i]:.3g}cm vs {expected[i]:.3g}cm ({ratios[i]:.2f}x)"
            for i in range(3)
            if ratios[i] < MIN_RATIO or ratios[i] > MAX_RATIO
        )
        return "fail", f"size out of band [{MIN_RATIO}x,{MAX_RATIO}x]: {bad}"

    if pos is not None and anchor is not None:
        d = math.sqrt(sum((pos[i] - anchor[i]) ** 2 for i in range(3)))
        if d > PLACE_TOL_CM:
            return "fail", f"misplaced: {d:.1f}cm from anchor (tol {PLACE_TOL_CM}cm)"

    visible = row.get("visible", None)
    if visible is False:
        return "fail", "Layer-2 capture: not visible (renders empty/black despite correct size)"
    if visible is None:
        return "fail", "Layer-2 visual sign-off not run (visible is null) — data passed; capture required"

    return "pass", "size within band, placed at anchor, visible"


def main():
    if len(sys.argv) != 2:
        print("usage: check-interaction-verify.py <interaction-verify.json>", file=sys.stderr)
        sys.exit(2)
    path = sys.argv[1]
    try:
        with open(path) as fp:
            data = json.load(fp)
    except (OSError, ValueError) as e:
        print(f"cannot read {path}: {e}", file=sys.stderr)
        sys.exit(2)

    rows = data.get("interactions")
    if not isinstance(rows, list):
        print("artifact missing 'interactions' array", file=sys.stderr)
        sys.exit(2)

    if len(rows) == 0:
        print("interaction-verify: no interactions to verify (static/effect lens) — PASS (vacuous)")
        sys.exit(0)

    any_bad = False
    print(f"interaction-verify: {len(rows)} interaction(s)")
    for i, row in enumerate(rows):
        verdict, reason = check_row(row, i)
        row["verdict"] = verdict
        row["reason"] = reason
        if verdict != "pass":
            any_bad = True
        mark = {"pass": "PASS", "fail": "FAIL", "unverified": "UNVERIFIED"}[verdict]
        print(f"  [{mark}] {row.get('interaction') or f'interaction[{i}]'}: {reason}")

    with open(path, "w") as fp:
        json.dump(data, fp, indent=2)

    sys.exit(1 if any_bad else 0)


if __name__ == "__main__":
    main()
