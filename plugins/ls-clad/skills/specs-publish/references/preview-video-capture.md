<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Auto-generated preview video capture

How the `auto_video` preview-media plan produces its staged mp4. Read this only when the plan includes an auto-generated video; the auto-image path does not use it. The result is a store-ready file at `<generatedPreviewMediaTempDir>/preview-video.mp4` — portrait 3:4, 720×960, 30 fps, silent, ≤30 s, ≤100 MB — which then flows through the normal preview-media gate → confirmation → upload machinery unchanged.

The capture is an OS-level screen recording of the Preview panel region (`scripts/record-panel.sh`), cropped and encoded with ffmpeg, while a choreography drives the lens through the Lens Studio MCP. There is no scriptable recorder in the Lens Studio Editor API — do not invent an `ExecuteEditorCode` recording API. The footage shows the **simulated preview environment**, not on-device Specs capture; state that plainly in the confirmation when the plan includes an auto video.

This whole flow stays under the single `Preparing preview media…` label — rect resolution, recording, choreography, encoding, and validation emit no additional labels or chat.

## Prerequisites (hard, for the auto_video plan only)

- **macOS only.** Automated screen capture uses `screencapture`, `swift` (CoreGraphics), and `osascript`, none of which exist on Windows/Linux. On a non-macOS host the script returns `ACTION_REQUIRED` / `unsupported_os` immediately — **do not retry it**; instead fall back to the **manual-record** rung below, or switch the preview plan to `auto_image` (which is OS-independent). The rest of publishing works on any OS; only this auto_video capture is macOS-bound.
- macOS with `screencapture`, `swift` (Xcode Command Line Tools), and `ffmpeg`/`ffprobe`. The script preflights all of these; ffmpeg — optional elsewhere in this skill — is a hard prerequisite here.
- Screen Recording permission for the terminal app (one-time TCC grant, preflighted).
- Lens Studio open with the project, MCP connected, Preview panel fully contained within one connected display (not partly off-screen or straddling displays). **The recording captures that whole display and crops to the panel**, so the panel must stay unoccluded — no windows on top, no notifications — for the full duration. Tell the user to keep that display clear and hands-off before recording starts: a window raised over the panel mid-capture silently records that window's contents instead of the lens. After every capture, verify a sample frame actually shows only the intended preview before staging the file, and delete the output immediately if it captured anything else.

## Capture procedure

1. **Resolve the panel rect.** Pass `scripts/get-preview-rect.ts` to `ExecuteEditorCode` as `path` — zero-config, so don't read the file. `RECT_READY` → keep `rect`; `FAILED` (`no_preview_panel`, `no_workspace`) → exceptional UI-fix prompt (open the Preview panel / project), then retry once. Re-derive the rect immediately before each recording — panel geometry changes whenever the user moves or resizes anything.

2. **Plan the choreography** — what creates on-screen motion during the recording. Pick the first that applies:
   - **None, if the lens animates itself** (ideal): a lens with intrinsic motion (moving/animated content, reactive behaviors) needs no choreography — just record it playing. This is the most faithful preview. Check the scene first; only add choreography when the lens would otherwise look static.
   - **Camera-orbit (default choreography, no LEAF):** drive the `MovePreviewCamera` MCP tool with beats ~3 s apart, e.g. reset → orbit yaw +40 → orbit yaw −80 → orbit yaw +40 pitch +15 → move forward 40 → move back 40 → reset, with `distance` ≈ 150 scaled to the content's bounding box so the subject stays framed. This adds apparent motion to a static lens using only the built-in camera — no packages, and nothing that isn't real lens content ends up on screen.
   - **LEAF demo scenario (opt-in only):** use **only** when the user explicitly asks for simulated interaction footage, and LEAF is installed. A no-assertion scenario drives LEAF's hand interactors (`specs-leaf-write-scenarios` to author, `specs-leaf-run-in-preview` to run); the scenario **resets the scene at start**, so begin recording first and let the reset land on camera, run scenarios serially, and pass `parameters: {"__leaf__log_level": "ERROR"}` so the on-screen `RUNS:`/status logger doesn't photobomb the frame. **Caveat — do not use for a default store preview:** LEAF's hand is a *simulated test interactor*, not content a real user sees in the published lens, so a store preview showing it is misleading. Prefer it only for internal interaction demos.

   Size the choreography to fit inside the recording: total beats ≤ `DURATION_SECONDS − 4` (the script spends ~1 s activating Lens Studio before recording starts, and the first/last frames should be settled).

3. **Record in the background while driving the lens.**

   ```bash
   PANEL_RECT_JSON='<rect JSON from step 1>' \
   OUTPUT_PATH="<generatedPreviewMediaTempDir>/preview-video.mp4" \
   DURATION_SECONDS=20 \
   bash "<skill-dir>/scripts/record-panel.sh"
   ```

   Start it in the background (on Claude Code: `run_in_background`; otherwise `… &` with output redirected to a log file), wait ~3 s for activation + recording start, run the choreography in the foreground, then wait for the script and parse its one-line JSON. The script blocks for the full duration plus encode time (~duration + 10 s). It activates Lens Studio, records the panel's display for `DURATION_SECONDS` (clamped 5–28 s), converts the point-space rect to capture pixels (Retina scale), center-crops to 3:4, and encodes 720×960 / 30 fps / no audio.

4. **Branch on the result.**
   - **`VIDEO_READY`** → the mp4 at `path` is validated by construction (720×960 3:4, ≤30 s, ≤100 MB — within the auto-generated-media limits). Record it in `previewMediaAssets` as `type: "video"`, `source: "auto_video"`, and track the path in `previewMediaDisplayPaths` for the media preview gate. If `upscaled: true`, the panel's native 3:4 crop was smaller than 720×960 and the output is soft — offer one retry after enlarging the Lens Studio window / Preview panel; don't loop.
   - **`ACTION_REQUIRED`** → exceptional correction before confirmation (UI-fix shape: **1. Done** / **2. Cancel**), then retry once — **except `unsupported_os`, which is not retryable**:
     - `unsupported_os` → the host isn't macOS. Do **not** retry. Tell the user auto-video capture is macOS-only, then either take the manual-record fallback or switch the preview plan to `auto_image`.
     - `no_screen_recording_permission` → System Settings → Privacy & Security → Screen Recording → enable the terminal app, then **fully restart** the terminal app.
     - `panel_offscreen` → the Preview panel is not fully contained within one connected display (it is partly off-screen, straddles displays, or is stranded on a disconnected display). Ask the user to move the Lens Studio window fully onto one display. If it isn't reachable, save the project (`Editor.Model.IModel` → `model.project.save()` via `ExecuteEditorCode`), quit Lens Studio, run `defaults delete "com.snap.Lens Studio" "mainWindow.geometry"` (keep `mainWindow.state` — it holds the panel layout), and relaunch with the project.
     - `ffmpeg_missing` → `brew install ffmpeg`.
   - **`FAILED`** → surface `reason` + `message`. If the same failure repeats after one retry, use the manual-record fallback — don't loop.

## Manual-record fallback (last rung)

When OS recording can't be made to work (permission refused, headless, persistent capture failures): stage everything (project open, choreography ready), then ask the user to record via **Project Settings → Preview media → record** (UI-fix prompt), run the choreography while they record, and take the resulting file path as a **user-supplied** video (`source: "user_video"`). Validate it with `ffprobe` against the Store preview media plan rules before use.

## Audio

No backend captures lens audio. If the user asks for a soundtrack, generate one with `/build-music` and mux it as an ffmpeg post step before staging — never claim the recording carries live lens audio.
