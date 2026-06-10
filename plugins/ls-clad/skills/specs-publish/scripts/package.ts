// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// publish · PACKAGE (Editor API)
// Run AS-IS via ExecuteEditorCode — zero config, no edits needed.
//
// Saves the project, waits for background tasks, then exports a PRODUCTION-signed SPK to
// <project>/.export/<name>.spk and returns its base64 SHA-256 checksum. This is the
// expensive phase — run it once and reuse the cached result; never re-export after a
// backend-only prompt (org/category/account).
//
// NOTE: SPK export deliberately uses LensStudio:Engine + LensStudio:Spk. These modules
// may be hidden from public Support/editor.d.ts builds, so import them through a
// non-literal specifier and treat them as runtime-checked internal APIs.
//
// Result shapes:
//   { status: "EXPORTED", packagePath, cleanupPath, checksum, packageBytes,
//     packageId, lensName, projectPath, generatedPackage: true }
//   { status: "ACTION_REQUIRED", reason, message, ... }   ← ask the user, then retry
//   { status: "FAILED", reason, message, stack? }
//
// Runtime note: ExecuteEditorCode's JS runtime does NOT fire setTimeout callbacks. Do not
// introduce setTimeout-based sleeps in this script — they hang forever. exporter.exportLens()
// is synchronous; whenAllCompleted() drains follow-on tasks. That's the full ordering signal.

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

try {
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
  const packageId = oneLine(readProjectScalar(projectText, "packageId"));
  const lensName = oneLine(stripYamlScalarQuotes(project.metaInfo.lensName) || readProjectScalar(projectText, "lensName"));
  if (!packageId || !lensName) {
    return actionRequired(
      "missing_submission_metadata",
      "The project needs a package ID and a lens name before it can be submitted.",
      { projectPath, packageId, lensName },
    );
  }

  const signingKey = project.metaInfo.spkProductionKeyPath;
  if (!signingKey || signingKey.isEmpty || !FileSystem.exists(signingKey)) {
    return actionRequired(
      "no_prod_signing_key",
      "This project needs a production signing key before export. Generate or add one (reusing an existing key is fine) in Project Settings > SPECS Settings.",
      { projectPath },
    );
  }

  project.save();
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
    packageId,
    lensName,
    signingKeyPath: signingKey.toString(),
    generatedPackage: true,
    packageBytes: digest.packageBytes,
    checksum: digest.checksum,
  };
} catch (error) {
  return failed("exception", errorToString(error), { stack: error instanceof Error ? error.stack : undefined });
}
