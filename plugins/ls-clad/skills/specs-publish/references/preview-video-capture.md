<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Auto-generated preview video capture

Use this flow only for `auto_video`. It requests 20 seconds from the intended Lens Studio Preview renderer and keeps a result the store accepts (15–30 seconds), producing either a validated 1080×1440 video, a 1080×1440 image derived from static footage, or a 1080×1440 Preview screenshot fallback. The limits come from [preview-images.schema.json](../scripts/schemas/preview-images.schema.json). The recording is simulated Lens Studio preview footage, not on-device Specs capture; say so in the confirmation.

Use Preview's hidden/beta `recordVideo(durationMs)` Editor API first. It captures renderer output directly, without editor chrome, window occlusion, Accessibility automation, or a save dialog. The agent orchestrates only the session-returned native recorder path, one two-frame visual decision, and—when requested—one direct-to-disk `CapturePanelScreenshotTool` screenshot. `publish-session.py` owns every local path, configured result, recorder-result parse, normalization, structural probe, frame extraction, cleanup, static-frame selection, recovery decision, and screenshot normalization through `preview-media-flow.py`.

Do not create a preview directory or config, invoke `make-eec-script.py`, run the normalizer/driver directly, or carry a media path into `prepare`. The session interface is:

1. `prepare-preview-video --state-handle` → `PREVIEW_SCRIPT_READY`.
2. In the same orchestration scope, execute `previewScriptPath`, then call `record-preview-video --state-handle`.
3. `PUBLISH_PREVIEW_READY` is final. `INSPECTION_READY` requires one two-frame parent view and one `decide-preview-video`. `PREVIEW_COMPATIBILITY_READY` and `PREVIEW_SCREENSHOT_REQUIRED` follow the exceptional branches below.
4. Run the screenshot flow with the requested image count in [preview-image-capture.md](preview-image-capture.md): a store listing needs at least one image, and `prepare` returns `preview_images_required` without it.
5. Call `prepare --state-handle`; it consumes the retained media and review input automatically.

Keep `scripts/preview/record-preview-video.sh` only as a compatibility fallback when the Editor API capability check proves that `recordVideo` is absent before a recording starts. That fallback presses the native **Record Video** control. Never use it after an Editor API recording was attempted, because that would make a second recording.

## Prerequisites

Primary Editor API path:

- Lens Studio open on the intended project with exactly one Preview panel.
- `ExecuteEditorCode` available.
- `ffmpeg` and `ffprobe` available for store-shape normalization and validation.
- A fresh staging directory writable by Lens Studio.

Compatibility toolbar fallback only:

- macOS with `osascript`.
- Accessibility permission for the terminal/agent host.
- GUI execution outside any restricted sandbox, requested through the runtime's approval mechanism on the first fallback launch.

Do not use desktop capture, Preview interaction tools, Start/replay activation, hand choreography, runtime-scene queries, or camera movement.

## Reset before recording

The pinned Editor script calls `preview.refresh()` before `recordVideo`. Both methods are exported on the same `IPreviewPanel` JS binding, so once the `recordVideo` capability gate passes, `refresh` is part of that panel contract. The reset resumes the Preview; it does not press Start. Measured on the same project and native recorder, the reset is the difference between a usable video and a discarded static clip:

| | `static` | `changedFraction` | outcome |
|---|---|---:|---|
| no reset | `true` | 0.000003 | `AUTO_IMAGE_READY`, downgraded |
| after `refresh` | `false` | 0.031179 | `VIDEO_READY` |

`refresh()` is asynchronous, and an in-flight `recordVideo` is correctly cancelled if the reset lands after capture begins. The script therefore allows the reset to settle for 1.5 seconds before starting the fixed recording window. Do not make a separate Preview-panel refresh call on the primary path.

## Capture through the Editor API (default)

After the package availability/build-version guard succeeds, call `prepare-preview-video`. The session creates the fresh staging directory and this driver config internally:

```json
{
  "recorderScript": "<skill-dir>/scripts/preview/record-preview-video.sh",
  "outputDir": "<generatedPreviewMediaTempDir>"
}
```

The driver still carries `recorderScript` because it owns inspection and the compatibility fallback. The Editor API records first to `<generatedPreviewMediaTempDir>/preview-native.mp4`; normalization writes `preview-video.mp4`, and the driver reads `recorder-result.json`.

Pass the session-returned `previewScriptPath` to `ExecuteEditorCode` with a timeout comfortably above 20 seconds. In the same orchestration scope call `record-preview-video`; it consumes the persisted result and cleans the configured script. Never paste the script as inline `code` or pass its result through model-authored JSON.

The pinned script verifies the open project and output directory, requires exactly one Preview panel, capability-gates `recordVideo`, calls `preview.refresh()`, allows the asynchronous reset to settle for 1.5 seconds, waits for `recordVideo(20_000)`, and saves through `Video.save(Editor.Path)`. The settle is required because `recordVideo` correctly cancels if the reset lands after recording starts. It never sends `toMp4Bytes()` through MCP.

Branch on the Editor result:

- `EDITOR_VIDEO_READY` — `record-preview-video` normalizes and inspects internally, including consuming the normalizer's terminal result when normalization fails.
- `EDITOR_RECORDING_UNAVAILABLE` with `reason: "record_video_api_unavailable"` — no recording started. Use the compatibility toolbar fallback below.
- `CAPTURE_SCREENSHOT` — do not invoke the toolbar recorder. Execute the exactly-once screenshot boundary.
- `FAILED` — surface the pinned script's reason. This is reserved for project, configuration, or staging failures before native capture begins. Once the native capture boundary begins, any refresh, recording, or save exception returns `CAPTURE_SCREENSHOT` instead.

If the Editor RPC itself times out after recording was invoked, do not call either recorder again. If `preview-native.mp4` exists and is non-empty, run the same normalization and inspection command. Otherwise execute the exactly-once screenshot boundary. **Never make a second recording.**

The inspect result is one of:

- `AUTO_IMAGE_READY` — static footage, already resolved to the staged image. Done; no worker, no frame reads.
- `INSPECTION_READY` — real motion; inspect its `midpointPath` and `nearEndPath` together in one parent visual call, then make the single `decide` call. Two frames do not justify a worker handoff.
- `CAPTURE_SCREENSHOT` — normalization failed or footage was rejected. Execute the exactly-once screenshot boundary.
- `ACTION_REQUIRED` with `ffmpeg_missing` — apply the normal ffmpeg correction and retry the whole capture once.

Keep the two-frame decision in the parent. Inspect both returned paths together in one parent visual call and call session `decide-preview-video` exactly once; do not reread the skill, rediscover tools, rerun the recorder, or re-inspect. Two frames do not justify a worker handoff.

## Compatibility toolbar fallback

Use this only when the pinned Editor script returns `EDITOR_RECORDING_UNAVAILABLE` before starting a recording.

Require session `PREVIEW_COMPATIBILITY_READY`, then run its returned exact `command` as one foreground shell call with GUI/unsandboxed authority. It records through `record-preview-video.sh`, inspects, and writes one result into the session. Then call `record-preview-compatibility --state-handle`; do not parse or carry its output yourself. The underlying commands are joined with `;` rather than `&&` so recorder failures become driver-owned screenshot fallbacks.

If the runtime cannot run a foreground shell call, dispatch the returned command verbatim to a compatibility worker. The worker must launch the exact foreground recorder command as its first tool call and within 25 seconds. If the shell returns a retained session handle, the worker's next tool call uses the runtime's session-join primitive with that exact handle and repeats only that bounded join until exit. It does not poll the readiness file, detach the shell, or reason about PIDs; `record-preview-video.sh` owns readiness, stop/save, encoding, and terminal logging. This compatibility worker owns only the recorder command; the parent owns any two-frame decision.

Unsupported OS, Accessibility failure, an already-active recording, or GUI automation failure routes directly to the exactly-once screenshot boundary. Do not ask the user to record or activate the Lens.

## Driver transitions

The session runs `preview-media-flow.py inspect` exactly once after either recorder path:

- `AUTO_IMAGE_READY` — the driver measured the two frames and proved there is no progression. Return it unchanged immediately; do not read the frames and do not call `decide`. With the reset above, this means the Lens genuinely does not start itself—it returns to its own menu and stays there. Without a reset it meant something weaker: the preview was merely stale, parked in whatever state a previous run left. Do not read a static result as proof the Lens has nothing to show.
- `INSPECTION_READY` — inspect both `midpointPath` and `nearEndPath`, then call the generated `decide` command once:
  - `--decision video` only when both frames are safe, faithful, show active Lens content beyond a startup/replay screen, and contain meaningful progression.
  - `--decision image --frame midpoint|near_end` when both frames are safe and faithful but materially static. Prefer the clearer frame; when equivalent, use `near_end`.
  - `--decision screenshot` for unsafe/private, misleading, debug/test, startup/replay-only, corrupt, or otherwise unpublishable video.
- `CAPTURE_SCREENSHOT` — execute the exactly-once screenshot boundary.
- `ACTION_REQUIRED` / `FAILED` — return the driver's result. Do not reconstruct local recovery logic.

The session `decide-preview-video` result is final:

- `PUBLISH_PREVIEW_READY` with video — the session copies it out of capture staging as `source: "auto_video"`; continue without carrying its path through the model.
- `PUBLISH_PREVIEW_READY` with image — the session copies it out of capture staging as `source: "auto_image"`; continue without another question or promotional-video build.
- `CAPTURE_SCREENSHOT` — execute the one screenshot boundary.

For either successful media result, use the copied path for confirmation and preserve that exact path as a retained session artifact. `complete` may delete capture staging after building the promotional video, but it keeps the rendered artifact for 30 days so the run's earlier attachment remains viewable. A later `begin-context` prunes expired publish-owned artifacts; cancellation or terminal failure cleanup removes the artifact immediately.

A midpoint-only check is insufficient. Never claim the video shows a startup/replay screen unless `INSPECTION_READY` returned both encoded frame paths and both were inspected. Never make a second recording.

## Exactly-once screenshot boundary

When the driver or Editor script returns `CAPTURE_SCREENSHOT`, use one durable orchestration scope:

1. Pass the returned `screenshotRequest.arguments` unchanged to the fully-qualified `CapturePanelScreenshotTool`. It contains `pluginId: "Snap.Plugin.Gui.PreviewPanel"`, the session-owned `outputPath`, and `maxDimension: 1920`.
2. Require success and the returned path to equal that `outputPath`, then call `stage-preview-screenshot --state-handle` in this same scope and require `PUBLISH_PREVIEW_READY`.

The tool writes rendered Preview pixels directly to disk; never omit `outputPath`, expose/stringify/store/load base64, reconstruct image bytes, or hand fallback work to another parent turn. A static, startup, replay, or start-button screenshot is acceptable as the current Preview state. Only a corrupt, editor/debug, unsafe/private, or misleading screenshot may require a manually saved **Preview screenshot** path or cancellation. Never ask for a video.

## Worker deadline recovery

A compatibility toolbar worker, used only when the runtime cannot run its foreground shell, has a 90-second deadline. Record `captureDeadlineMs` from a monotonic clock at dispatch. Join through consecutive bounded waits: compute `remainingMs = max(0, captureDeadlineMs - monotonicNowMs)` and wait for `min(runtimeMaxWaitMs, remainingMs)`. A wait timeout while budget remains is not a capture timeout; wait again without status/list calls, chat, follow-ups, or unrelated work. Interrupt once only when the deadline passes, then run session recovery:

```bash
python3 "<skill-dir>/scripts/publish/publish-session.py" record-preview-compatibility \
  --state-handle "$handle" --reason worker_timeout
```

`INSPECTION_READY` follows the same visual decision and records `capture: "recovered_after_worker_timeout"`. `CAPTURE_SCREENSHOT` permits the parent recovery scope to execute the exactly-once screenshot boundary. Do not relaunch either recorder. Join before preview-dependent rating, moderation, media rendering, and confirmation.

## Result rules

- Clean progression → `VIDEO_READY`.
- Clean mostly-static footage → `AUTO_IMAGE_READY` with `reason: "mostly_static_video"`, either from the driver's measurement or from an explicit `--decision image`.
- Recorder failure or rejected video → driver-owned `CAPTURE_SCREENSHOT`, then `AUTO_IMAGE_READY`.
- `ffmpeg_missing` → exceptional install correction; retry the whole capture once. On repeat, request a manually saved Preview screenshot or cancel.
- Missing Editor API → one toolbar fallback, only when no Editor recording started.
- Unsupported toolbar fallback or permission failure → screenshot fallback.

Keep the entire operation under `Preparing preview media…`. Never ask the user to tap **Record Video**, demonstrate the Lens, save a recording, activate Preview, or provide a video path.

## The captured video is silent, and that is not a bug

Both `recordVideo` and the toolbar control use Lens Studio's same H.264 MP4 recorder. The normalizer and toolbar fallback encode with `-an` on purpose, and the reason is a property of Lens Studio itself rather than of either script.

**The recorder captures microphone input, never the Lens's audio output.** In the Lens Studio source, `VideoRecorder::start` always creates the writer with a default 44.1 kHz `AudioInfo`—the comment there reads "to activate audio recording"—so a recording always carries an audio track. The only samples ever written to it come from `PreviewWorker::processAudio`, which is reached from `processAudioFrame` on the `frameReady` signal of `mAudioInput`, an `Input::IAudioFrameProvider`. That is the *input* pipeline. A Lens's own `AudioComponent` playback is never routed into it, so the music you hear in the Preview panel cannot reach the file by this path.

Measured on a Lens whose looping music bed was demonstrably playing and confirmed by ear: mean and max volume −91.0 dB, the 16-bit noise floor, every sample in one histogram bucket. Lens Studio's own CI artifact for `QG_ComplexPreviewTest.RecordVideoProducesFinalizedVideo` measures identically, and no Preview test asserts anything about audio.

So `-an` discards nothing of the Lens—and it also **prevents publishing room audio**. Because the track is wired to the microphone, a developer with a live mic would otherwise mux whatever their room picked up into store preview media. Dropping `-an` would inflate the file about tenfold (measured 4.1 MB vs 411 KB for the same 12 s capture) *and* open that path. Do not do it.

Real Lens audio would require a loopback capture device, which is a user-level install and out of scope here. Store preview media is generally auditioned muted anyway; when audio genuinely matters, the promotional video sources it from a project asset — see `references/promotional-video.md`.
