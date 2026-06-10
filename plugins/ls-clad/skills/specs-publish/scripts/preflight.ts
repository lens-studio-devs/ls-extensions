// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// publish · PREFLIGHT (Editor API)
// Run AS-IS via ExecuteEditorCode — zero config, no edits needed.
//
// Confirms the project is submittable WITHOUT exporting: Lens Studio auth, the open
// project, submission metadata (packageId + lensName), and a production signing key.
// Returns one JSON object the /specs-publish skill branches on.
//
// Result shapes:
//   { status: "READY", projectPath, packageId, lensName, hasProductionKey: true }
//   { status: "ACTION_REQUIRED", reason, message, issues: [{reason, message}, ...], ... }
//     `reason` + `message` mirror the FIRST issue for back-compat; `issues` lists ALL
//     local-fix items found in a single pass so the agent can prompt for everything at
//     once instead of one-at-a-time. Auth/project-state failures still return immediately.
//   { status: "FAILED", reason, message, stack? }

const FileSystem = await import("LensStudio:FileSystem");

function errorToString(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function stripYamlScalarQuotes(value: string | undefined): string {
  return (value ?? "").trim().replace(/^["']/, "").replace(/["']$/, "");
}
function readProjectScalar(text: string, key: string): string {
  const match = text.match(new RegExp(`(?:^|\\n)\\s*${key}:\\s*([^\\r\\n]*)`));
  return stripYamlScalarQuotes(match?.[1]);
}
function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
function actionRequired(reason: string, message: string, extra: Record<string, unknown> = {}): any {
  return { status: "ACTION_REQUIRED", stage: "preflight", reason, message, ...extra };
}
function failed(reason: string, message: string, extra: Record<string, unknown> = {}): any {
  return { status: "FAILED", stage: "preflight", reason, message, ...extra };
}

try {
  const auth = pluginSystem.findInterface(Editor.IAuthorization);
  if (!auth) {
    return actionRequired("no_auth_interface", "Lens Studio authorization is unavailable. Sign in to Lens Studio, then retry.");
  }
  if (!auth.isAuthorized) {
    return actionRequired("not_signed_in", "Sign in to Lens Studio from the profile menu, then retry.");
  }

  const project = pluginSystem.findInterface(Editor.Model.IModel).project;
  const projectPath = project.projectFile.toString();
  const projectText = FileSystem.readFile(project.projectFile);
  const packageId = oneLine(readProjectScalar(projectText, "packageId"));
  const lensName = oneLine(stripYamlScalarQuotes(project.metaInfo.lensName) || readProjectScalar(projectText, "lensName"));

  // Collect ALL local-fix issues in one pass so the agent can prompt for everything at
  // once. Auth/project-state issues above still bail early because nothing else can run.
  const issues: { reason: string; message: string }[] = [];

  // The caller compares projectPath against the .esproj resolved in Discover; a mismatch
  // means the wrong project is open (ask the user to open the right one).
  if (!packageId || !lensName) {
    issues.push({
      reason: "missing_submission_metadata",
      message: "The project needs a package ID and a lens name before it can be submitted.",
    });
  }

  const signingKey = project.metaInfo.spkProductionKeyPath;
  if (!signingKey || signingKey.isEmpty || !FileSystem.exists(signingKey)) {
    issues.push({
      reason: "no_prod_signing_key",
      message: "This project needs a production signing key before export. Generate or add one (reusing an existing key is fine) in Project Settings > SPECS Settings.",
    });
  }

  // isIconSet is false when the project still has the default placeholder icon
  // (Qt resource path under :/Model/Icons/metainfo/...). Submission requires a real icon.
  if (!project.metaInfo.isIconSet) {
    issues.push({
      reason: "no_lens_icon",
      message: "This project needs a lens icon before it can be submitted. Open Project Settings > Lens Icon, then import or generate a lens icon.",
    });
  }

  if (issues.length > 0) {
    // `reason` + `message` mirror the first issue for back-compat with single-reason
    // branching; `issues` lists everything so the agent can present them together.
    return {
      status: "ACTION_REQUIRED",
      stage: "preflight",
      reason: issues[0].reason,
      message: issues[0].message,
      issues,
      projectPath,
      packageId,
      lensName,
    };
  }

  return { status: "READY", stage: "preflight", projectPath, packageId, lensName, hasProductionKey: true };
} catch (error) {
  return failed("exception", errorToString(error), { stack: error instanceof Error ? error.stack : undefined });
}
