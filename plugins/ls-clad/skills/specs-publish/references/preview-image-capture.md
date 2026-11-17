<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Preview image capture

Use the automatic image flow for an explicit auto-image request, or when no preview preference was supplied and discovery cannot reuse existing media. It prepares two Preview screenshots to satisfy the Developer Portal's details-page minimum of two previews with at least one image; store tiles are separate assets. Auto video runs this flow too, right after `PUBLISH_PREVIEW_READY`; the recording (or its image fallback) leads the set and the requested screenshots follow.

## Session-owned capture

After `PUBLISH_CONTEXT_STAGED`, call `publish-session.py prepare-preview-images --state-handle <handle>`. The default is two screenshots. When the user requests exactly one image with an automatic video, wait for `PUBLISH_PREVIEW_READY` and add `--image-count 1`. The session permits one screenshot only with a retained recording or its image fallback; image-only capture requires two. Keep the same session through confirmation and submission.

On `PREVIEW_IMAGE_CAPTURE_REQUIRED`, execute the returned `resetRequest` when present, then the returned `screenshotRequest`, each once and in order. Pass the untouched screenshot result directly to `record-preview-images --json -` as `{stateHandle, result}` on stdin in the same orchestration scope. `--json` takes a file path or `-`, never inline JSON. Retain that result in the scope for an invocation retry; do not reconstruct the receipt or recapture. Dispatch only the next request returned by that operation. The session owns capture order, output paths, receipt validation, normalization, retention, and cleanup; do not construct paths, call the stager separately, or supply preview proposals to `prepare`.

`PUBLISH_PREVIEW_IMAGES_READY` returns the requested retained `images` for visual inspection. Require faithful views of the current Preview with no editor/debug overlays, private content, misleading UI, or clipped essential content. Static, startup, replay, and start-button states are acceptable; two independent captures of a static Lens may look identical. Do not manufacture variation, synthesize interaction, move the camera, or ask the user to activate the Lens. The session's reset does not press Start.

After inspecting every returned image, call session `prepare` with the handle and any unrelated semantic proposals. All returned images are automatically bound into review, confirmation, and upload. The existing user-visible media preview gate must display every selected preview before confirmation. Do not copy staged media into a new session to change the count; select the count before capture.

For a staging failure, retry `record-preview-images` with only `stateHandle`; accepted capture receipts and source files are retained. Do not recapture. For a capture failure, an unsafe/blank/corrupt image, or unavailable tools, use the exceptional correction to request the planned number of manually saved **Preview screenshot** paths or cancel. After a capture/staging failure, pass user-supplied replacement paths as `{stateHandle, manualPaths: [<path>, ...]}` to `record-preview-images`. For a visual rejection after successful staging, cancel this prepared capture session and restart with the supplied images as explicit user media. Never preserve older-release media or substitute an unrelated generated image to bypass a rejected capture.

Keep the operation under `Preparing preview media…`. File-mode capture keeps image bytes out of model/runtime state; never use inline/base64 mode, `CaptureRuntimeViewTool`, or desktop capture.

Boundary schemas: [preview-images.schema.json](../scripts/schemas/preview-images.schema.json). Session design and retry/retention rationale: [preview-image-session.md](preview-image-session.md).

## Store tiles only

When tiles are missing and no automatic image is staged, refresh the Preview and capture one local PNG with `CapturePanelScreenshotTool`, `pluginId: "Snap.Plugin.Gui.PreviewPanel"`, an absolute temporary `outputPath`, and `maxDimension: 1920`. **Capture exactly once.** Inspect it using the criteria above, preserve its captured resolution, and pass its path as `proposals.tileSourcePath`. Do not add it to `previewMedia` or replace reused details-page previews. On failure request a manually saved Preview screenshot or cancel. Keep the source through edits and remove its temporary directory on completion/cancellation; session confirmation uses its retained tile crops.
