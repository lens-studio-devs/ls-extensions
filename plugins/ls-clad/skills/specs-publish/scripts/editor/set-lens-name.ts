// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// publish · SET LENS NAME (Editor API)
// Assigns a confirmed generated name only when the intended open project has
// no name or Lens Studio's default "Untitled" placeholder, then saves and
// verifies that Lens Studio retained it.
//
// HOW TO RUN: do NOT read this file, and do NOT hand-write the CONFIG consts.
// Run `make-eec-script.py` against it — it JSON-encodes each value (a bare
// quote or a Windows backslash otherwise corrupts the emitted TypeScript), keeps the
// declarations' type annotations, and prints a unique temp path. Pass that path to
// ExecuteEditorCode as `path`, then delete it. Never edit this file on disk.
//
// Result shapes:
//   { status: "LENS_NAME_SET", projectPath, lensName, alreadySet }
//   { status: "FAILED", reason, message, ... }

// ===================== CONFIG — replace per call =====================
const LENS_NAME = "";
const EXPECTED_PROJECT_PATH = "";
// =====================================================================

const FileSystem = await import("LensStudio:FileSystem");

function errorToString(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function isDefaultLensName(value: string): boolean {
  return value.trim().toLowerCase() === "untitled";
}
function failed(reason: string, message: string, extra: Record<string, unknown> = {}): any {
  return { status: "FAILED", stage: "lens_name", reason, message, ...extra };
}

try {
  const project = pluginSystem.findInterface(Editor.Model.IModel).project;
  const projectPath = project.projectFile.toString();
  const configuredProjectPath = EXPECTED_PROJECT_PATH.trim();
  if (!configuredProjectPath) {
    return failed("missing_expected_project_path", "Set EXPECTED_PROJECT_PATH before assigning a Lens name.", {
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
    return failed("wrong_project_open", "Lens Studio has a different project open. Refusing to assign the Lens name.", {
      projectPath,
      expectedProjectPath: configuredProjectPath,
    });
  }

  const configuredLensName = LENS_NAME.trim();
  if (!configuredLensName) {
    return failed("missing_lens_name", "Set LENS_NAME to the confirmed Lens name before running this script.", {
      projectPath,
    });
  }
  if (isDefaultLensName(configuredLensName)) {
    return failed("default_lens_name", "Generate a descriptive Lens name instead of the default \"Untitled\".", {
      projectPath,
      lensName: configuredLensName,
    });
  }
  if (!Editor.Model.MetaInfo.isLensNameValid(configuredLensName)) {
    return failed("invalid_lens_name", "Lens Studio rejected the proposed Lens name.", {
      projectPath,
      lensName: configuredLensName,
    });
  }

  const metaInfo = project.metaInfo;
  const currentLensName = String(metaInfo.lensName || "").trim();
  if (currentLensName && !isDefaultLensName(currentLensName)) {
    if (currentLensName === configuredLensName) {
      return {
        status: "LENS_NAME_SET",
        stage: "lens_name",
        projectPath,
        lensName: currentLensName,
        alreadySet: true,
      };
    }
    return failed("lens_name_already_set", "The project already has a different Lens name.", {
      projectPath,
      lensName: currentLensName,
    });
  }

  metaInfo.lensName = configuredLensName;
  project.metaInfo = metaInfo;
  project.save();

  const committedLensName = String(project.metaInfo.lensName || "").trim();
  if (committedLensName !== configuredLensName) {
    return failed("lens_name_not_set", "Lens Studio did not retain the confirmed Lens name after saving.", {
      projectPath,
      lensName: committedLensName,
    });
  }

  return {
    status: "LENS_NAME_SET",
    stage: "lens_name",
    projectPath,
    lensName: committedLensName,
    alreadySet: false,
  };
} catch (error) {
  return failed("set_lens_name_failed", errorToString(error), { stack: (error as any)?.stack });
}
