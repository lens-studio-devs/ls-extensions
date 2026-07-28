// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// publish · SET SIGNING KEY (Editor API)
// Assigns an existing Ed25519 PKCS#8 PEM to the intended open project, saves,
// and verifies that Lens Studio retained the selected key path.
//
// HOW TO RUN: do NOT read this file, and do NOT hand-write the CONFIG consts.
// Run `make-eec-script.py` against it — it JSON-encodes each value (a bare
// quote or a Windows backslash otherwise corrupts the emitted TypeScript), keeps the
// declarations' type annotations, and prints a unique temp path. Pass that path to
// ExecuteEditorCode as `path`, then delete it. Never edit this file on disk.
//
// Result shapes:
//   { status: "SIGNING_KEY_SET", projectPath, signingKeyPath, alreadySet }
//   { status: "FAILED", reason, message, ... }

// ===================== CONFIG — replace per call =====================
const SIGNING_KEY_PATH = "";
const EXPECTED_PROJECT_PATH = "";
// =====================================================================

const FileSystem = await import("LensStudio:FileSystem");

function errorToString(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function failed(reason: string, message: string, extra: Record<string, unknown> = {}): any {
  return { status: "FAILED", stage: "signing_key", reason, message, ...extra };
}

try {
  const project = pluginSystem.findInterface(Editor.Model.IModel).project;
  const projectPath = project.projectFile.toString();
  const configuredProjectPath = EXPECTED_PROJECT_PATH.trim();
  if (!configuredProjectPath) {
    return failed("missing_expected_project_path", "Set EXPECTED_PROJECT_PATH before assigning a signing key.", {
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
    return failed(
      "wrong_project_open",
      "Lens Studio has a different project open. Refusing to assign the signing key.",
      {
        projectPath,
        expectedProjectPath: configuredProjectPath,
      },
    );
  }

  const configuredKeyPath = SIGNING_KEY_PATH.trim();
  if (!configuredKeyPath) {
    return failed("missing_signing_key_path", "Set SIGNING_KEY_PATH before assigning a signing key.", { projectPath });
  }

  const signingKeyPath = new Editor.Path(configuredKeyPath);
  if (!FileSystem.exists(signingKeyPath) || !FileSystem.isFile(signingKeyPath)) {
    return failed("signing_key_missing", "The selected production signing key is missing or unreadable.", {
      projectPath,
      signingKeyPath: configuredKeyPath,
    });
  }

  const canonicalSigningKeyPath = FileSystem.realPath(signingKeyPath).toString();
  const canonicalSigningKey = new Editor.Path(canonicalSigningKeyPath);
  const metaInfo = project.metaInfo;
  const currentSigningKeyPath = metaInfo.spkProductionKeyPath;
  if (
    currentSigningKeyPath &&
    !currentSigningKeyPath.isEmpty &&
    FileSystem.exists(currentSigningKeyPath) &&
    FileSystem.isFile(currentSigningKeyPath)
  ) {
    const canonicalCurrentPath = FileSystem.realPath(currentSigningKeyPath).toString();
    if (canonicalCurrentPath === canonicalSigningKeyPath) {
      return {
        status: "SIGNING_KEY_SET",
        stage: "signing_key",
        projectPath,
        signingKeyPath: canonicalSigningKeyPath,
        alreadySet: true,
      };
    }
    return failed("signing_key_already_set", "The project already has a different valid production signing key.", {
      projectPath,
      signingKeyPath: currentSigningKeyPath.toString(),
    });
  }

  metaInfo.spkProductionKeyPath = canonicalSigningKey;
  project.metaInfo = metaInfo;
  project.save();

  const committedPath = project.metaInfo.spkProductionKeyPath;
  if (!committedPath || committedPath.isEmpty || !FileSystem.exists(committedPath)) {
    return failed("signing_key_not_set", "Lens Studio did not retain the selected signing key after saving.", {
      projectPath,
    });
  }
  const canonicalCommittedPath = FileSystem.realPath(committedPath).toString();
  if (canonicalCommittedPath !== canonicalSigningKeyPath) {
    return failed("signing_key_path_changed", "Lens Studio retained a different signing key path after saving.", {
      projectPath,
      signingKeyPath: canonicalCommittedPath,
    });
  }

  return {
    status: "SIGNING_KEY_SET",
    stage: "signing_key",
    projectPath,
    signingKeyPath: canonicalCommittedPath,
    alreadySet: false,
  };
} catch (error) {
  return failed("set_signing_key_failed", errorToString(error), { stack: (error as any)?.stack });
}
