---
name: verify-preview
description: Verify, QA, or screenshot a running Lens in the Lens Studio preview. Capture the runtime view, drive an interaction, check logs, and judge the result inline with full code context. Use when asked to verify a Lens, confirm an edit produces the expected runtime behavior, or observe why the preview looks wrong.
user-invocable: true
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# /verify-preview

Verification runs **inline in the main agent** — you have the code context; use it to judge what you see. The canonical recipe is `lens-studio-field-notes` → **See-and-fix loop**: recompile → log baseline/diff → capture → Read the image and judge it with full code context → fix → re-capture. This skill adds the Lens-specific QA pass for an explicit "verify this lens" request.

## QA pass

1. **Reset first if state is dirty.** Stale interactions, moved cameras, or leftover spawned objects poison the evidence — run `reset-preview-environment`, then re-discover uniqueIds (they change across preview resets; see `preview-inspection`).
2. **Capture the relevant view** with CaptureRuntimeViewTool — object-framed (`uniqueIds`, `isolate`) for a specific object, scene mode for composition. Mechanics and mode selection live in `preview-inspection`.
3. **Drive one interaction** for interactive Lenses — PreviewInteractTool or InjectPreviewGesture — then capture again and compare. `unknown_command` means the Lens lacks `AgentInteractScript` (its automatic install failed); setup in `specs-preview-interaction`. That's an infrastructure gap, not a *feature* failure — **but it is not a pass, either.** If the interaction handler is unavailable (`unknown_command`, or `PreviewInteractTool` returns `success: false` with `reason: interaction_unavailable` / `handler_not_ready`), the Lens's core interaction is **unverified**. Treat it as a finding, not a silent skip: run the one-time setup in `specs-preview-interaction` and retry once; if it still can't be driven, record the interaction as `unverified` (name the reason) and carry that into the verdict in step 5. When the core mechanic sits behind a menu or countdown, drive the Lens deterministically into that state *before* judging — a pass captured in the idle/menu state verifies nothing.
4. **Check logs** with RunAndCollectLogsTool for runtime errors — a visually empty scene is often a script crash, not a rendering issue.
5. **Report findings with the captures as evidence** — per-expectation verdicts, each backed by an image or a quoted log line. A capture is evidence, not a verdict: diff it against a **named intent** you write down *before* capturing (one line, e.g. "door swings outward ~75° in Y"), not against what the code claims — the pre-declared intent is the bar. Iterate on mismatch.
   - **Honest completion status.** For an interactive Lens, lead with the honest verdict and never round up: `verified` only when the expected interaction was actually driven **and** the resulting state change confirmed; `unverified` when it could not be exercised (name the reason — e.g. `interaction_unavailable` / `handler_not_ready`); `failed` when it ran but the state didn't change as expected. "Not a feature failure" is not the same as "verified" — a Lens whose core interaction was never exercised is unverified, not working.

## Blind spots and hygiene

- **Animated content lies in a single frame.** Confirm motion with the cheapest sufficient evidence first: a log line or a `preview-inspection` transform delta, not multiple image captures (capture time + image tokens). If you need visual proof, capture 2+ Preview frames spaced to the animation's duration, not a fixed 1s — a gap longer than a short tween catches only the end state; slow, loop, or use the log signal when it is too brief. Overview `CaptureRuntimeViewTool` freezes sim time, so its frames are pixel-identical regardless of spacing.
- **Prefer object-framed captures** when checking one object; scene-wide shots hide small defects.
- **Never re-Read a stale capture.** After any change, re-capture; old image files are not evidence.
- **Under context pressure**, delegate a batch of captures to a generic ad-hoc subagent that runs the captures and reports back paths plus observations — there is no standing verifier agent.
