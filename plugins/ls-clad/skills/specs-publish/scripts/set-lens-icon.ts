// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// publish · SET LENS ICON (Editor API)
// Reads a generated external PNG/JPEG, copies it into the open project through
// MetaInfo.setIcon(), saves, and verifies that Lens Studio recognizes the new icon.
//
// HOW TO RUN: do NOT read this file, and do NOT hand-write the CONFIG consts.
// Run `make-eec-script.py` against it — it JSON-encodes each value (a bare
// quote or a Windows backslash otherwise corrupts the emitted TypeScript), keeps the
// declarations' type annotations, and prints a unique temp path. Pass that path to
// ExecuteEditorCode as `path`, then delete it. Never edit this file on disk.
//
// Result shapes:
//   { status: "ICON_SET", projectPath, iconPath, alreadySet }
//   { status: "FAILED", reason, message, ... }

// ===================== CONFIG — replace per call =====================
const ICON_PATH = "";
const EXPECTED_PROJECT_PATH = "";
// =====================================================================

const FileSystem = await import("LensStudio:FileSystem");

function errorToString(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function failed(reason: string, message: string, extra: Record<string, unknown> = {}): any {
  return { status: "FAILED", stage: "lens_icon", reason, message, ...extra };
}

try {
  const project = pluginSystem.findInterface(Editor.Model.IModel).project;
  const projectPath = project.projectFile.toString();
  const configuredProjectPath = EXPECTED_PROJECT_PATH.trim();
  if (!configuredProjectPath) {
    return failed("missing_expected_project_path", "Set EXPECTED_PROJECT_PATH before assigning a Lens icon.", {
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

  const canonicalProjectPath = FileSystem.realPath(project.projectFile).toString();
  const canonicalExpectedProjectPath = FileSystem.realPath(expectedProjectPath).toString();
  if (canonicalProjectPath !== canonicalExpectedProjectPath) {
    return failed("wrong_project_open", "Lens Studio has a different project open. Refusing to assign the Lens icon.", {
      projectPath,
      expectedProjectPath: configuredProjectPath,
    });
  }

  const metaInfo = project.metaInfo;
  if (metaInfo.isIconSet) {
    return {
      status: "ICON_SET",
      stage: "lens_icon",
      projectPath,
      iconPath: metaInfo.iconPath.toString(),
      alreadySet: true,
    };
  }

  const configuredPath = ICON_PATH.trim();
  if (!configuredPath) {
    return failed("missing_icon_path", "Set ICON_PATH to the generated Lens icon before running this script.", {
      projectPath,
    });
  }
  if (!/\.(png|jpe?g)$/i.test(configuredPath)) {
    return failed("unsupported_icon_type", "The generated Lens icon must be a PNG or JPEG file.", { projectPath });
  }

  const externalIconPath = new Editor.Path(configuredPath);
  if (!FileSystem.exists(externalIconPath) || !FileSystem.isFile(externalIconPath)) {
    return failed("icon_file_missing", "The generated Lens icon file is missing or unreadable.", { projectPath });
  }

  // setIcon copies the external file into project-managed metadata storage.
  metaInfo.setIcon(externalIconPath);
  project.metaInfo = metaInfo;
  project.save();

  const committedMetaInfo = project.metaInfo;
  const copiedIconPath = committedMetaInfo.iconPath;
  if (!committedMetaInfo.isIconSet || !copiedIconPath || !FileSystem.exists(copiedIconPath)) {
    return failed("lens_icon_not_set", "Lens Studio did not retain the generated Lens icon after saving.", {
      projectPath,
    });
  }

  return {
    status: "ICON_SET",
    stage: "lens_icon",
    projectPath,
    iconPath: copiedIconPath.toString(),
    alreadySet: false,
  };
} catch (error) {
  return failed("set_lens_icon_failed", errorToString(error), { stack: (error as any)?.stack });
}
