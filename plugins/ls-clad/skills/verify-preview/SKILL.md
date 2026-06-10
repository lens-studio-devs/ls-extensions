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
3. **Drive one interaction** for interactive Lenses — PreviewInteractTool or InjectPreviewGesture — then capture again and compare. `unknown_command` means the Lens lacks `AgentInteractScript` (the MCP layer auto-installs only the inspect side); setup in `specs-preview-interaction`. That's an infrastructure gap, not a feature failure.
4. **Check logs** with RunAndCollectLogsTool for runtime errors — a visually empty scene is often a script crash, not a rendering issue.
5. **Report findings with the captures as evidence** — per-expectation verdicts, each backed by an image or a quoted log line.

## Blind spots and hygiene

- **Animated content lies in a single frame** — capture at 2+ timestamps before judging motion.
- **Prefer object-framed captures** when checking one object; scene-wide shots hide small defects.
- **Never re-Read a stale capture.** After any change, re-capture; old image files are not evidence.
- **Under context pressure**, delegate a batch of captures to a generic ad-hoc subagent that runs the captures and reports back paths plus observations — there is no standing verifier agent.
