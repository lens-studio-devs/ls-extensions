---
name: reset-preview-environment
description: Reset the Lens Studio preview to a clean state before scene generation. Captures a baseline log timestamp. Use before any scene generation task or when starting fresh.
user-invocable: true
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Reset Preview Environment

Use the path-backed actions in this skill rather than editing inline `ExecuteEditorCode` constants.
Pass per-call values as structured runtime `args`.

## Step 1: Survey and reset

Delegate to `editor-api-specialist` to call `ExecuteEditorCode` with the absolute `path` to `actions/survey-and-reset.ts`. Pass the camera names as ordinary JSON data, for example:

```json
{ "cameraNames": ["Camera", "Main Camera"] }
```

The action resets the first matching scene camera to position and Euler rotation `(0, 0, 0)`, then returns the root-object survey. Do not edit action constants. If no configured camera is present, report the warning and continue.

## Step 2: Verify a clean preview

Capture the preview your later checks will use (pass the same `previewName` they will) using `CapturePanelScreenshotTool` with `pluginId: "Snap.Plugin.Gui.PreviewPanel"`. A clean preview shows only the default virtual environment. If extra 3D meshes, UI, images, or text remain, identify the responsible top-level parents where possible and have `editor-api-specialist` call the absolute `path` to `actions/disable-scene-objects.ts`:

```json
{ "objectNames": ["<top-level-object-name-1>", "<top-level-object-name-2>"] }
```

The explicit object-name array is invocation data, not source substitution. Re-capture and inspect after each call, for at most five iterations. If the preview remains unclean, warn the user and list the visible content.

## Step 3: Baseline logs

Call `ExecuteEditorCode` with the absolute `path` to `actions/get-log-file.ts`. It returns `{ ok: true, logPath }`. Read that path and record its current file length as the baseline offset for entries generated during subsequent scene work.

## Completion

Report the camera reset result, whether cleanup was required, disabled object names, screenshot iteration count, and log baseline timestamp. Do not disable permanent environment setup such as lighting rigs, skybox, device camera feeds, or tracking nodes. The reset is idempotent.
