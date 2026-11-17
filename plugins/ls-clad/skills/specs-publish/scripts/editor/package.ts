// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// publish · PACKAGE (Editor API)
// Generate with `make-eec-script.py --package-authorization-uri`, run the printed path,
// then `--cleanup` it. Do NOT read this file and do NOT hand-write the CONFIG.
//
// Applies any token-bound Build Version update, saves the project, waits for background
// tasks, then exports a PRODUCTION-signed SPK to <project>/.export/<name>.spk and returns
// its base64 SHA-256 checksum. This is the
// expensive phase — run it once and reuse the cached result; never re-export after a
// backend-only prompt (org/category/account).
//
// NOTE: SPK export deliberately uses LensStudio:Engine + LensStudio:Spk. These modules
// may be hidden from public Support/editor.d.ts builds, so import them through a
// non-literal specifier and treat them as runtime-checked internal APIs.
//
// Result shapes:
//   { status: "EXPORTED", packagePath, cleanupPath, checksum, packageBytes,
//     packageId, packageVersion, lensName, projectPath, generatedPackage: true,
//     planToken, packageAuthorizationToken }
//   { status: "ACTION_REQUIRED", reason, message, ... }   ← ask the user, then retry
//   { status: "FAILED", reason, message, stack? }
//
// Runtime note: ExecuteEditorCode's JS runtime does NOT fire setTimeout callbacks. Do not
// introduce setTimeout-based sleeps in this script — they hang forever. exporter.exportLens()
// is synchronous; whenAllCompleted() drains follow-on tasks. That's the full ordering signal.

// ===================== CONFIG — replace per call =====================
const PACKAGE_AUTHORIZATION: Record<string, unknown> = {};
// Session-owned path for the exact operation result. Empty only outside publish-session.py.
const RESULT_PATH: string = "";
// =====================================================================

const importEditorModule = async (name: string): Promise<any> => await import("LensStudio:" + name);

const FileSystem = await import("LensStudio:FileSystem");
const Crypto = await import("LensStudio:Crypto");
const EngineApi: any = await importEditorModule("Engine");
const SpkApi: any = await importEditorModule("Spk");

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
function isValidPackageVersion(value: string): boolean {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  return Boolean(match && match.slice(1).every((component) => Number(component) <= 4294967295));
}
function comparePackageVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] < rightParts[index] ? -1 : 1;
    }
  }
  return 0;
}
function actionRequired(reason: string, message: string, extra: Record<string, unknown> = {}): any {
  return { status: "ACTION_REQUIRED", stage: "package", reason, message, ...extra };
}
function failed(reason: string, message: string, extra: Record<string, unknown> = {}): any {
  return { status: "FAILED", stage: "package", reason, message, ...extra };
}
function bytesToBase64(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triplet = (a << 16) | (b << 8) | c;
    output += alphabet[(triplet >> 18) & 63];
    output += alphabet[(triplet >> 12) & 63];
    output += i + 1 < bytes.length ? alphabet[(triplet >> 6) & 63] : "=";
    output += i + 2 < bytes.length ? alphabet[triplet & 63] : "=";
  }
  return output;
}
function createProductionSpkPacker(signingKey: Editor.Path): any {
  // SpkPacker's signature has varied across Lens Studio versions — try two-arg, then one-arg.
  try {
    return new SpkApi.SpkPacker(signingKey, false);
  } catch (twoArgError) {
    try {
      return new SpkApi.SpkPacker(signingKey);
    } catch (oneArgError) {
      throw new Error(
        `Could not create production SPK packer. twoArg=${errorToString(twoArgError)}; oneArg=${errorToString(oneArgError)}`,
      );
    }
  }
}
async function waitForProjectTasks(): Promise<any | null> {
  try {
    const taskManager = pluginSystem.findInterface(Task.ITaskManager);
    await taskManager.whenAllCompleted();
    return null;
  } catch (taskError) {
    return actionRequired("pending_tasks_unavailable", "Could not wait for Lens Studio background tasks before export.", {
      error: errorToString(taskError),
    });
  }
}
async function packageDigest(packagePath: Editor.Path): Promise<{ checksum: string; packageBytes: number }> {
  const packageBytes = FileSystem.readBytes(packagePath);
  const checksum = bytesToBase64(await Crypto.subtle.digest("SHA-256", packageBytes));
  return { checksum, packageBytes: packageBytes.length };
}

const OPERATION_RESULT = await (async (): Promise<any> => {
try {
  const expectedPlanToken = String(PACKAGE_AUTHORIZATION.planToken ?? "").trim();
  const expectedPackageId = String(PACKAGE_AUTHORIZATION.packageId ?? "").trim();
  const expectedPackageVersion = String(PACKAGE_AUTHORIZATION.packageVersion ?? "").trim();
  const expectedLensName = String(PACKAGE_AUTHORIZATION.lensName ?? "").trim();
  const expectedProjectPath = String(PACKAGE_AUTHORIZATION.projectPath ?? "").trim();
  const buildVersionMutation: any = PACKAGE_AUTHORIZATION.buildVersionMutation;
  const packageAuthorizationToken = String(PACKAGE_AUTHORIZATION.authorizationToken ?? "").trim();
  if (
    !/^[0-9a-f]{64}$/.test(expectedPlanToken) ||
    !expectedPackageId ||
    !isValidPackageVersion(expectedPackageVersion) ||
    !expectedLensName ||
    !expectedProjectPath ||
    !buildVersionMutation ||
    !["assign", "keep_existing"].includes(String(buildVersionMutation.action ?? "")) ||
    !/^[0-9a-f]{64}$/.test(packageAuthorizationToken)
  ) {
    return failed(
      "incomplete_config",
      "Package requires a valid deterministic authorization. Generate this script with make-eec-script.py.",
    );
  }

  const auth = pluginSystem.findInterface(Editor.IAuthorization);
  if (!auth) {
    return actionRequired("no_auth_interface", "Lens Studio authorization is unavailable. Sign in to Lens Studio, then retry.");
  }
  if (!auth.isAuthorized) {
    return actionRequired("not_signed_in", "Sign in to Lens Studio, then retry.");
  }

  const project = pluginSystem.findInterface(Editor.Model.IModel).project;
  const projectPath = project.projectFile.toString();
  const projectText = FileSystem.readFile(project.projectFile);
  // Match discovery's live identity, including edits that have not been saved yet.
  const packageId = String(project.metaInfo.packageId ?? readProjectScalar(projectText, "packageId")).trim();
  const packageVersion = String(project.metaInfo.buildVersion ?? readProjectScalar(projectText, "packageVersion")).trim();
  const lensName = oneLine(stripYamlScalarQuotes(project.metaInfo.lensName) || readProjectScalar(projectText, "lensName"));
  if (!packageId || !lensName) {
    const message =
      !packageId && !lensName
        ? "The project needs a package ID and a Lens name before it can be submitted."
        : !packageId
          ? "The project needs a package ID before it can be submitted."
          : "The project needs a Lens name before it can be submitted.";
    return actionRequired(
      "missing_submission_metadata",
      message,
      { projectPath, packageId, lensName },
    );
  }
  const mutationAction = String(buildVersionMutation.action);
  if (!isValidPackageVersion(packageVersion) && mutationAction !== "assign") {
    return actionRequired("invalid_package_version", "Rebuild the publish plan to confirm a valid Build Version.");
  }
  const mutationCurrentVersion = String(buildVersionMutation.currentBuildVersion ?? "").trim();
  const mutationTargetVersion = String(buildVersionMutation.buildVersion ?? "").trim();
  const mutationProjectPath = String(buildVersionMutation.projectPath ?? "").trim();
  const mutationIsValid =
    mutationAction === "keep_existing" ||
    (mutationAction === "assign" &&
      typeof buildVersionMutation.currentBuildVersion === "string" &&
      isValidPackageVersion(mutationTargetVersion) &&
      (!isValidPackageVersion(mutationCurrentVersion) ||
        comparePackageVersions(mutationTargetVersion, mutationCurrentVersion) > 0) &&
      mutationTargetVersion === expectedPackageVersion &&
      mutationProjectPath === expectedProjectPath);
  const versionMatchesAuthorization =
    mutationAction === "assign"
      ? packageVersion === mutationCurrentVersion || packageVersion === mutationTargetVersion
      : packageVersion === expectedPackageVersion;
  if (
    !mutationIsValid ||
    projectPath !== expectedProjectPath ||
    packageId !== expectedPackageId ||
    !versionMatchesAuthorization ||
    lensName !== expectedLensName
  ) {
    return actionRequired(
      "package_authorization_mismatch",
      "The project submission identity changed after confirmation. Re-run preflight and confirm the updated publish plan.",
      {
        projectPath,
        expected: {
          packageId: expectedPackageId,
          packageVersion: expectedPackageVersion,
          lensName: expectedLensName,
          projectPath: expectedProjectPath,
        },
        actual: { packageId, packageVersion, lensName, projectPath },
      },
    );
  }

  const previousPackageVersion = packageVersion;
  if (mutationAction === "assign" && packageVersion === mutationCurrentVersion) {
    const metaInfo = project.metaInfo;
    if (typeof metaInfo.buildVersion !== "string") {
      return actionRequired("build_version_api_unavailable", "This Lens Studio build does not expose metaInfo.buildVersion.");
    }
    metaInfo.buildVersion = mutationTargetVersion;
    project.metaInfo = metaInfo;
  }
  // Persist only after checking confirmation, then verify the identity before export.
  project.save();

  const committedProjectText = FileSystem.readFile(project.projectFile);
  const committedPackageId = oneLine(readProjectScalar(committedProjectText, "packageId"));
  const committedPackageVersion = oneLine(readProjectScalar(committedProjectText, "packageVersion"));
  const committedLensName = oneLine(
    stripYamlScalarQuotes(project.metaInfo.lensName) || readProjectScalar(committedProjectText, "lensName"),
  );
  if (
    committedPackageId !== expectedPackageId ||
    committedPackageVersion !== expectedPackageVersion ||
    committedLensName !== expectedLensName
  ) {
    return failed(
      "build_version_not_committed",
      "Lens Studio did not retain the confirmed Package Build Version and submission identity before export.",
      {
        projectPath,
        expected: {
          packageId: expectedPackageId,
          packageVersion: expectedPackageVersion,
          lensName: expectedLensName,
        },
        actual: {
          packageId: committedPackageId,
          packageVersion: committedPackageVersion,
          lensName: committedLensName,
        },
      },
    );
  }

  const signingKey = project.metaInfo.spkProductionKeyPath;
  if (!signingKey || signingKey.isEmpty || !FileSystem.exists(signingKey)) {
    return actionRequired(
      "no_prod_signing_key",
      "This project needs a production signing key before export. Generate or add one (reusing an existing key is fine) in Project Settings > SPK Settings.",
      { projectPath },
    );
  }

  const preExportTaskFailure = await waitForProjectTasks();
  if (preExportTaskFailure) {
    return preExportTaskFailure;
  }

  const exportDir = project.projectDirectory.appended(new Editor.Path(".export"));
  if (!FileSystem.exists(exportDir)) {
    FileSystem.createDir(exportDir, { recursive: true });
  }

  const packagePath = exportDir.appended(new Editor.Path(`${project.projectFile.fileNameBase}.spk`));
  const strategy = new EngineApi.Lens.Export.Strategy();
  strategy.type = EngineApi.Lens.Export.Type.ClientLens;
  strategy.packer = createProductionSpkPacker(signingKey);

  const exportOptions = new EngineApi.ExportOptions();
  exportOptions.skipSizeCalculation = true;

  const engine = EngineApi.create(project.cacheDirectory);
  const exporter = engine.createExporter();
  exporter.exportLens(project.scene, packagePath, project.metaInfo, strategy, exportOptions);
  const postExportTaskFailure = await waitForProjectTasks();
  if (postExportTaskFailure) {
    return postExportTaskFailure;
  }

  if (!FileSystem.exists(packagePath)) {
    return failed("package_missing_after_export", "Lens Studio export returned but the expected package file was not created.", {
      packagePath: packagePath.toString(),
    });
  }

  // exporter.exportLens() is synchronous and writes the SPK in full before returning;
  // the post-export whenAllCompleted() above drains any follow-on tasks. No sleep needed
  // (and setTimeout() callbacks don't fire inside ExecuteEditorCode's JS runtime).
  const digest = await packageDigest(packagePath);

  return {
    status: "EXPORTED",
    stage: "package",
    projectPath,
    packagePath: packagePath.toString(),
    cleanupPath: packagePath.toString(),
    packageId: committedPackageId,
    lensName: committedLensName,
    signingKeyPath: signingKey.toString(),
    generatedPackage: true,
    packageBytes: digest.packageBytes,
    checksum: digest.checksum,
    packageVersion: committedPackageVersion,
    previousPackageVersion,
    buildVersionUpdated: mutationAction === "assign" && previousPackageVersion !== committedPackageVersion,
    planToken: expectedPlanToken,
    packageAuthorizationToken,
  };
} catch (error) {
  return failed("exception", errorToString(error), { stack: error instanceof Error ? error.stack : undefined });
}
})();

if (RESULT_PATH) {
  try {
    FileSystem.writeFile(new Editor.Path(RESULT_PATH), JSON.stringify(OPERATION_RESULT));
    return { status: "RESULT_PERSISTED", stage: "package" };
  } catch {
    // The exact ExecuteEditorCode return remains the recovery source; never re-export for this.
  }
}
return OPERATION_RESULT;
