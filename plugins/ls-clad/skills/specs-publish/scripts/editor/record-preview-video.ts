// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// publish · RECORD PREVIEW VIDEO (Editor API)
// Records twenty seconds of the intended project's Preview renderer and saves the
// native MP4 to a fresh staging path. The public binding is hidden/beta and is
// therefore capability-gated through a structural `any` cast instead of a
// LensStudio:Preview type that is absent from released editor.d.ts files.
//
// HOW TO RUN: publish-session.py generates a configured copy, passes that path
// to ExecuteEditorCode, and records the persisted result without transporting
// the video result through model-authored JSON.
//
// Result shapes:
//   { status: "EDITOR_VIDEO_READY", path, bytes, durationMs }
//   { status: "EDITOR_RECORDING_UNAVAILABLE", reason, message }
//   { status: "CAPTURE_SCREENSHOT", reason, message }
//   { status: "FAILED", reason, message, ... }

// ===================== CONFIG — replace per call =====================
const OUTPUT_PATH = "";
const EXPECTED_PROJECT_PATH = "";
const DURATION_MS_TEXT = "20000";
const RESULT_PATH = "";
// =====================================================================

const PREVIEW_PLUGIN_ID = "Snap.Plugin.Gui.PreviewPanel";
const RETAINED_TIMEOUTS_KEY = "__specsPublishRecordVideoTimeouts";
const FileSystem = await import("LensStudio:FileSystem");

function errorToString(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failed(reason: string, message: string, extra: Record<string, unknown> = {}): any {
  return { status: "FAILED", stage: "preview_video", reason, message, ...extra };
}

function screenshot(reason: string, message: string): any {
  return { status: "CAPTURE_SCREENSHOT", stage: "preview_video", reason, message };
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    // Lens Studio cancels a timeout when its ScriptObject handle is collected.
    // Retain it globally until the callback fires, matching Core ChatTools' sleep helper.
    const globalState = globalThis as any;
    const retainedTimeouts = (globalState[RETAINED_TIMEOUTS_KEY] ??= []) as Timeout[];
    const timeout = setTimeout(() => {
      const index = retainedTimeouts.indexOf(timeout);
      if (index >= 0) retainedTimeouts.splice(index, 1);
      resolve();
    }, durationMs);
    retainedTimeouts.push(timeout);
  });
}

const OPERATION_RESULT = await (async () => {
let screenshotFallbackEligible = false;

try {
  const project = pluginSystem.findInterface(Editor.Model.IModel).project;
  const projectPath = project.projectFile.toString();
  const configuredProjectPath = EXPECTED_PROJECT_PATH.trim();
  if (!configuredProjectPath) {
    return failed("missing_expected_project_path", "Set EXPECTED_PROJECT_PATH before recording Preview.", {
      projectPath,
    });
  }

  const expectedProjectPath = new Editor.Path(configuredProjectPath);
  if (!FileSystem.exists(expectedProjectPath) || !FileSystem.isFile(expectedProjectPath)) {
    return failed("expected_project_missing", "The expected Lens Studio project file is missing or unreadable.", {
      projectPath,
      expectedProjectPath: configuredProjectPath,
    });
  }
  if (FileSystem.realPath(project.projectFile).toString() !== FileSystem.realPath(expectedProjectPath).toString()) {
    return failed("wrong_project_open", "Lens Studio has a different project open. Refusing to record Preview.", {
      projectPath,
      expectedProjectPath: configuredProjectPath,
    });
  }

  const configuredOutputPath = OUTPUT_PATH.trim();
  if (!configuredOutputPath) {
    return failed("missing_output_path", "Set OUTPUT_PATH before recording Preview.", { projectPath });
  }
  const outputPath = new Editor.Path(configuredOutputPath);
  if (outputPath.extension.toLowerCase() !== "mp4") {
    return failed("invalid_output_path", "OUTPUT_PATH must end in .mp4.", { projectPath });
  }
  if (!FileSystem.exists(outputPath.parent) || !FileSystem.isDirectory(outputPath.parent)) {
    return failed("output_directory_missing", "The Preview recording output directory does not exist.", {
      projectPath,
    });
  }
  if (FileSystem.exists(outputPath)) {
    return failed("output_already_exists", "The Preview recording output path must be fresh.", { projectPath });
  }
  const durationMs = Number(DURATION_MS_TEXT);
  if (!Number.isInteger(durationMs) || durationMs < 250 || durationMs > 30_000) {
    return failed("invalid_duration", "DURATION_MS_TEXT must be an integer from 250 through 30000.", {
      projectPath,
    });
  }

  const dock = pluginSystem.findInterface(Editor.Dock.IDockManager);
  const previewPanels = dock.panels.filter((panel: IPanelPlugin) => panel.id === PREVIEW_PLUGIN_ID);
  if (previewPanels.length === 0) {
    return screenshot("no_preview_panel", "Open the Lens Studio Preview panel before capturing preview media.");
  }
  if (previewPanels.length !== 1) {
    return screenshot(
      "multiple_preview_panels",
      "Automatic video capture requires exactly one Preview panel so the intended renderer is unambiguous.",
    );
  }

  const preview = previewPanels[0] as any;
  if (typeof preview.recordVideo !== "function") {
    return {
      status: "EDITOR_RECORDING_UNAVAILABLE",
      stage: "preview_video",
      reason: "record_video_api_unavailable",
      message: "This Lens Studio build does not expose Preview.recordVideo.",
    };
  }

  // From this point onward, native Preview capture owns the attempt. Any
  // runtime failure must fall back to the exactly-once Preview screenshot
  // boundary rather than asking the user to repair or retry recording.
  screenshotFallbackEligible = true;

  // `refresh` and `recordVideo` are exported on the same IPreviewPanel JS
  // binding, so the recordVideo capability gate above also guarantees refresh.
  preview.refresh();
  // Refresh is asynchronous and recordVideo cancels when a reset lands during
  // capture, so allow it to settle before starting the fixed recording window.
  await sleep(1_500);

  const video = await preview.recordVideo(durationMs);
  if (!video || typeof video.save !== "function") {
    return screenshot(
      "recorded_video_save_unavailable",
      "Lens Studio recorded Preview but did not expose a filesystem-capable Video.save handle.",
    );
  }
  video.save(outputPath);
  if (!FileSystem.exists(outputPath) || !FileSystem.isFile(outputPath)) {
    return screenshot("recorded_video_missing", "Lens Studio did not save the recorded Preview MP4.");
  }
  const bytes = FileSystem.size(outputPath);
  if (bytes <= 0) {
    return screenshot("recorded_video_empty", "Lens Studio saved an empty Preview MP4.");
  }

  return {
    status: "EDITOR_VIDEO_READY",
    stage: "preview_video",
    projectPath,
    path: outputPath.toString(),
    bytes,
    durationMs,
    recorder: "lens_studio_record_video_api",
  };
} catch (error) {
  const message = errorToString(error);
  const normalized = message.toLowerCase();
  if (
    normalized.includes("preview rendering is paused") ||
    normalized.includes("recording is already in progress") ||
    normalized.includes("recording was cancelled")
  ) {
    return screenshot("preview_recording_unavailable", message);
  }
  if (screenshotFallbackEligible) {
    return screenshot("preview_recording_failed", message);
  }
  return failed("record_video_failed", message, { stack: (error as any)?.stack });
}
})();

if (RESULT_PATH) {
  try {
    FileSystem.writeFile(new Editor.Path(RESULT_PATH), JSON.stringify(OPERATION_RESULT));
    return { status: "RESULT_PERSISTED", stage: "preview_video" };
  } catch {
    // ExecuteEditorCode still returns the exact result for the documented recovery path.
  }
}
return OPERATION_RESULT;
