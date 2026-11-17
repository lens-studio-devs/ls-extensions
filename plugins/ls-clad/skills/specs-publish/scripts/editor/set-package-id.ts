// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// Replace only the missing or invalid package ID observed before publish confirmation.
// Execute by path with the exact args returned by confirm.projectSetupActions.packageId.
// Input: { projectPath: absolute .esproj path, packageId: confirmed ID, expectedCurrentPackageId: observed ID }.
// Output: PACKAGE_ID_SET (including alreadySet), ACTION_REQUIRED, or FAILED.
const FileSystem = await import("LensStudio:FileSystem");

function result(status: string, reason: string, message: string): any {
  return { status, stage: "package_id", reason, message };
}
function isValidPackageId(value: string): boolean {
  return /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(value) && value.length <= 128;
}

try {
  if (Object.keys(args).sort().join(",") !== "expectedCurrentPackageId,packageId,projectPath" ||
      typeof args.projectPath !== "string" || !args.projectPath.trim() ||
      typeof args.packageId !== "string" ||
      args.packageId.trim() !== args.packageId ||
      !isValidPackageId(args.packageId) ||
      typeof args.expectedCurrentPackageId !== "string" ||
      isValidPackageId(args.expectedCurrentPackageId.trim())) {
    return result("FAILED", "invalid_package_id_input", "Expected a projectPath, a valid confirmed packageId, and the observed missing or invalid expectedCurrentPackageId.");
  }
  const project = pluginSystem.findInterface(Editor.Model.IModel).project;
  const expectedPath = new Editor.Path(args.projectPath);
  if (!FileSystem.exists(expectedPath) || !FileSystem.isFile(expectedPath) ||
      FileSystem.realPath(project.projectFile).toString() !== FileSystem.realPath(expectedPath).toString()) {
    return result("ACTION_REQUIRED", "wrong_project_open", "Open the confirmed project before assigning its package ID.");
  }
  const metaInfo = project.metaInfo;
  // Guard the native property: an unsupported build must never accept a JS-only assignment.
  if (typeof metaInfo.packageId !== "string") {
    return result("ACTION_REQUIRED", "package_id_api_unavailable", "This Lens Studio build does not expose metaInfo.packageId.");
  }
  const current = metaInfo.packageId.trim();
  if (current !== args.packageId && current !== args.expectedCurrentPackageId.trim()) {
    return result("ACTION_REQUIRED", "package_id_already_set", "The project package ID changed after confirmation. Rebuild the publish plan.");
  }
  metaInfo.packageId = args.packageId;
  project.metaInfo = metaInfo;
  project.save();
  const savedText = FileSystem.readFile(project.projectFile);
  const savedId = (savedText.match(/(?:^|\n)\s*packageId:\s*([^\r\n]*)/)?.[1] ?? "")
    .trim().replace(/^["']/, "").replace(/["']$/, "");
  if (project.metaInfo.packageId !== args.packageId || savedId !== args.packageId) {
    return result("FAILED", "package_id_not_committed", "Lens Studio did not retain the confirmed package ID after saving.");
  }
  return { status: "PACKAGE_ID_SET", stage: "package_id", projectPath: project.projectFile.toString(),
    packageId: args.packageId, alreadySet: current === args.packageId };
} catch (error) {
  return result("FAILED", "set_package_id_failed", error instanceof Error ? error.message : String(error));
}
