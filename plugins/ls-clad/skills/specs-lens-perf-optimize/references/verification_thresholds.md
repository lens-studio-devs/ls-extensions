<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Verification thresholds

The orchestrator decides keep-or-revert for each candidate using four signals: visual SSIM, color-histogram cosine, harness marker arrival, and measured ms/frame delta. All four must pass for the candidate to be committed. Any one failing under autonomous mode triggers an immediate revert with no user prompt.

## Visual parity — SSIM (primary)

Computed per harness marker (`idle`, `interaction`, `climax`) by `scripts/visual_diff.py` against the matching baseline screenshot in `<attribution_dir>/baseline_frames/`.

| Per-marker SSIM | Outcome |
|-----------------|---------|
| `>= 0.92` (configurable via `parity-threshold`) | Pass for that marker. |
| `0.85 <= ssim < 0.92` | Fail under autonomous mode — auto-revert. |
| `< 0.85` | Hard revert regardless of mode. |

The candidate passes the visual gate only when **all three markers** pass. A single failing marker fails the whole candidate.

If a baseline marker screenshot is missing (the original sweep never produced one), skip that marker comparison and require the remaining markers to pass. Record the missing marker in the report.

**Track how many marker comparisons actually ran.** If *zero* markers were compared (e.g. the baseline produced no screenshots at all), do NOT treat the gate as passed — "no visual evidence" is not "visual parity passed." Treat it as a hard revert (or hard stop) and surface it: a baseline with zero usable markers is a setup error that must be fixed before optimization can proceed.

## Visual parity — histogram cosine (secondary)

A color-histogram cosine guards against SSIM blind spots (uniform color shifts, large hue rotations that preserve structure).

| Per-marker histogram cosine | Outcome |
|----------------------------|---------|
| `>= 0.97` | Pass. |
| `< 0.97` | Fail — auto-revert. |

Both SSIM and histogram cosine must pass per marker. Per-marker pass propagates to candidate pass only if all three markers pass.

## Visual parity — perceptual hash (tertiary, informational)

`scripts/visual_diff.py` also computes a 64-bit perceptual hash (pHash) Hamming distance between baseline and post-fix. This is **not** part of the keep-or-revert gate — it goes into the report for human review only. Distances over 12 typically indicate a noticeable visual shift even when SSIM and histogram pass.

## Experiential parity — harness markers

The `PerfAttributionHarness` (with the `frameMarkers` extension installed at run start) emits one log line per marker:

```
[PerfHarness] marker:idle t_ms=2148
[PerfHarness] marker:interaction t_ms=5021
[PerfHarness] marker:climax t_ms=8503
```

Pass conditions (all required):

- Every baseline marker present in the post-fix run.
- Per-marker post-fix arrival time `<= baseline_arrival * 1.25` (25 % tolerance for measurement noise).
- No new ERROR or WARN line in the post-fix log that did not exist in the baseline log (substring match on the message body, ignoring timestamps). Before diffing, **normalize each log line**: strip volatile timestamps and replace source-file line-number references with a placeholder. Match a `:<digits>` token only when it immediately follows a source filename — i.e. anchored on a `.ts`/`.js`/`.cpp`/`.h` extension (e.g. `script.ts:123` → `script.ts:<L>`), including mid-line forms like `[path/to/script.ts:123]`. Anchoring on the extension keeps the normalization from masking behaviorally-meaningful `:digits` such as ports (`localhost:8080`) or IDs (`Job:12345`). A fix that shifts line numbers must not register as a new error — only genuinely new error *content* triggers a revert.

Any failure → auto-revert.

## Performance — measured ms/frame delta

Computed by the closing `perf-attribution-runner` call (mode `targeted` or `full-sweep` depending on candidate-predicted impact and the `revalidation` argument).

| Measured delta vs. predicted | Outcome |
|-----------------------------|---------|
| `delta_ms > 0` AND `delta_ms >= 0.5 * predicted_delta_ms` | Pass — commit. |
| `delta_ms > 0` AND `delta_ms < 0.5 * predicted_delta_ms` | Fail (under-delivered) — auto-revert. |
| `delta_ms <= 0` | Fail (regression) — auto-revert. |

The 50 % rule guards against recipes that touch the right slice but don't move the needle — almost always a sign the wrong sub-target was edited.

## Combined gate (orchestrator pseudocode)

```python
def decide_keep(parity, experiential_ok, delta_ms, candidate, args):
    compared = 0  # markers actually compared against a baseline
    for marker in ("idle", "interaction", "climax"):
        p = (parity or {}).get(marker)   # tolerate a missing marker key (no KeyError)
        if not p:                        # None / absent -> baseline missing this marker
            continue
        ssim = p.get("ssim")
        if ssim is None:                 # malformed entry -> can't trust it; treat as not-compared
            continue
        compared += 1
        # Check the HARD floor (0.85) first so it is reachable and reported
        # distinctly; the parity_threshold (default 0.92) is the softer gate.
        if ssim < 0.85:
            return False, f"hard revert ssim<0.85 at {marker}"
        if ssim < args.parity_threshold:
            return False, f"soft revert ssim<{args.parity_threshold} at {marker}"
        hist = p.get("histogram_cosine")
        if hist is not None and hist < 0.97:
            return False, f"histogram<0.97 at {marker}"
    if compared == 0:
        # No marker had a usable baseline to compare against — "no visual evidence"
        # must NOT count as "visual parity passed". A baseline with zero usable
        # markers is a setup error; surface it and hard-revert (or hard-stop).
        return False, "hard revert: no baseline markers to compare — baseline setup error"
    if not experiential_ok:
        return False, "experiential markers missing or delayed"
    # delta_ms is None when called as the FAST visual+experiential pre-gate
    # (before re-measurement); skip the performance checks in that case.
    if delta_ms is not None:
        if delta_ms <= 0:
            return False, "regression"
        predicted = (candidate or {}).get("predicted_delta_ms", 0.0)   # tolerate a missing field
        if predicted and delta_ms < 0.5 * predicted:
            return False, "under-delivered"
    return True, "ok"


# "Critical" reasons are setup/severe failures — a hard visual break (ssim<0.85)
# or a baseline with no comparable markers. The orchestrator hard-STOPs the run
# on these rather than just counting them toward the 3-consecutive-revert cap.
def is_critical(reason):
    return reason.startswith("hard revert")
```

## Per-iteration artifacts

`<attribution_dir>/parity/` contains, per iteration:

- `parity_<candidate_id>.json` — the raw scores per marker plus the keep/revert decision and reason.
- `parity_<candidate_id>.png` — a side-by-side PNG (baseline | post-fix) for each marker, stacked vertically. Useful for human review of borderline cases.

These survive revert (cleanup is scoped to `Assets/`, not `attribution_dir/`).

## Calibration notes

- The `0.92` SSIM default is tuned for Specs Preview at 1280×960 with deterministic harness state. On lower-resolution Preview captures, lower to `0.90`.
- The `0.97` histogram threshold is intentionally tight — color shifts of more than a few percent are almost always real visual regressions.
- The `0.5 * predicted` performance floor balances "the recipe worked" against "the trace is noisy." Tighten to `0.7` if you trust the attribution highly; loosen to `0.3` for highly variable projects.
- A candidate that fails parity but passes performance often indicates the recipe was applied to the wrong slice — review `notes` in the worker's report before tightening thresholds.
