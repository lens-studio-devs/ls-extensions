#!/usr/bin/env python3
# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

"""Format and execute a git commit for one kept /specs-lens-perf-optimize iteration.

Reads:
  --candidate-json <path>   the candidate dict produced by parse_attribution.py
  --measured-json  <path>   the perf-attribution-runner output for this iter
  --parity-json    <path>   the visual_diff.py output for this iter
  --baseline-ms    <float>  current_ms before this iteration
  --iter           <int>    1-based iteration number
  --repo-root      <path>   default cwd
  --tactic         <str>    recipe tactic name (from references/recommendation_taxonomy.md)
  --files-changed  <csv>    comma-separated list of changed files (from worker)
  --short-tactic   <str>    4-10 word human description for the subject line

Stages all currently-modified files in the working tree, then commits with the
templated message from references/iteration_protocol.md. Never amends.

Prints the new commit SHA to stdout.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

CATEGORY_PREFIX = {
    "camera/render": "camera",
    "mesh/visual/draw": "mesh",
    "tracking/ML/gesture": "tracking",
    "script/component/logic": "script",
    "VFX/particle": "vfx",
    "generic": "general",
}


def git(repo: Path, *args: str, check: bool = True) -> str:
    proc = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True)
    if check and proc.returncode != 0:
        sys.stderr.write(proc.stderr)
        raise SystemExit(f"git {' '.join(args)} failed (exit {proc.returncode})")
    return proc.stdout.strip()


def fmt_marker_line(parity: dict, key: str) -> str:
    parts = []
    for m in ("idle", "interaction", "climax"):
        v = parity.get("markers", {}).get(m, {}).get(key)
        parts.append(f"{m} {v:.3f}" if isinstance(v, (int, float)) else f"{m} -")
    return "  ".join(parts)


def fmt_marker_status(parity: dict) -> str:
    parts = []
    for m in ("idle", "interaction", "climax"):
        st = parity.get("markers", {}).get(m, {}).get("status", "?")
        parts.append(f"{m} {st}")
    return "  ".join(parts)


def build_message(
    candidate: dict,
    measured: dict,
    parity: dict,
    baseline_ms: float,
    iteration: int,
    tactic: str,
    short_tactic: str,
    repo_root: Path,
) -> str:
    cat = candidate.get("category", "generic")
    prefix = CATEGORY_PREFIX.get(cat, "general")
    post_ms = float(measured.get("ms_per_frame", 0.0))
    delta = baseline_ms - post_ms
    predicted = float(candidate.get("predicted_delta_ms", 0.0))
    top_slices = candidate.get("top_slices", [])
    top_slice_text = ", ".join(f"{s.get('category', '')}:{s.get('name', '')}" for s in top_slices[:3]) or "—"

    trace_dir = measured.get("trace_dir", "")
    try:
        rel_trace = str(Path(trace_dir).resolve().relative_to(repo_root.resolve()))
    except (ValueError, RuntimeError):
        rel_trace = trace_dir

    avg_ssim = "-"
    ssim_vals = [m.get("ssim") for m in parity.get("markers", {}).values() if isinstance(m.get("ssim"), (int, float))]
    if ssim_vals:
        avg_ssim = f"{sum(ssim_vals) / len(ssim_vals):.3f}"

    subject = f"perf({prefix}): {short_tactic} — saves {delta:.2f} ms/f (SSIM {avg_ssim})"

    body = (
        f"Candidate:        {candidate.get('candidate_id', '')}\n"
        f"Source:           {candidate.get('source_line', '')}\n"
        f"Baseline ms/f:    {baseline_ms:.4f}\n"
        f"Post ms/f:        {post_ms:.4f}\n"
        f"Delta ms/f:       {delta:.4f}   (predicted {predicted:.4f})\n"
        f"Visual SSIM:      {fmt_marker_line(parity, 'ssim')}\n"
        f"Histogram cos:    {fmt_marker_line(parity, 'histogram_cosine')}\n"
        f"Markers:          {fmt_marker_status(parity)}\n"
        f"Top slices:       {top_slice_text}\n"
        f"Recipe:           {tactic}\n"
        f"Trace dir:        {rel_trace}\n"
        f"Iteration:        {iteration}\n"
    )
    return subject + "\n\n" + body


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--candidate-json",
        type=Path,
        required=True,
        help="A single candidate dict, OR the candidates.json array (then also pass --candidate-id).",
    )
    p.add_argument(
        "--candidate-id",
        default=None,
        help="Select this candidate_id when --candidate-json is the candidates.json array.",
    )
    p.add_argument("--measured-json", type=Path, required=True)
    p.add_argument("--parity-json", type=Path, required=True)
    p.add_argument("--baseline-ms", type=float, required=True)
    p.add_argument("--iter", type=int, required=True)
    p.add_argument("--tactic", required=True)
    p.add_argument("--short-tactic", required=True, help="4-10 word human description")
    p.add_argument("--files-changed", default="", help="Comma-separated list of changed files")
    p.add_argument("--repo-root", type=Path, default=Path.cwd())
    args = p.parse_args()

    candidate_data = json.loads(args.candidate_json.read_text(encoding="utf-8"))
    if isinstance(candidate_data, list):
        # parse_attribution.py writes candidates.json as an array; select the row.
        if not args.candidate_id:
            raise SystemExit("--candidate-json is an array; pass --candidate-id to select one candidate")
        candidate = next((c for c in candidate_data if c.get("candidate_id") == args.candidate_id), None)
        if candidate is None:
            raise SystemExit(f"candidate_id {args.candidate_id!r} not found in {args.candidate_json}")
    else:
        candidate = candidate_data
    measured = json.loads(args.measured_json.read_text(encoding="utf-8"))
    parity = json.loads(args.parity_json.read_text(encoding="utf-8"))

    msg = build_message(
        candidate=candidate,
        measured=measured,
        parity=parity,
        baseline_ms=args.baseline_ms,
        iteration=args.iter,
        tactic=args.tactic,
        short_tactic=args.short_tactic,
        repo_root=args.repo_root,
    )

    repo = args.repo_root.resolve()

    # Stage only the files the worker said it changed; fall back to `git add -u` if the list is empty
    files = [f.strip() for f in args.files_changed.split(",") if f.strip()]
    if files:
        git(repo, "add", "--", *files)
    else:
        git(repo, "add", "-u")

    # Commit with -F to avoid escaping problems. Use a temp file rather than
    # repo/.git/...: in a git worktree or submodule, `.git` is a *file* (a
    # `gitdir:` pointer), not a directory, so writing under it would raise
    # NotADirectoryError.
    fd, msg_path = tempfile.mkstemp(prefix="perf_optimize_commit_", suffix=".txt")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(msg)
        git(repo, "commit", "-F", msg_path)
    finally:
        Path(msg_path).unlink(missing_ok=True)
    sha = git(repo, "rev-parse", "HEAD")
    print(sha)
    return 0


if __name__ == "__main__":
    sys.exit(main())
