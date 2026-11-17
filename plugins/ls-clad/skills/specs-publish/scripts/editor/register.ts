// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// publish · REGISTER (Editor API)
// Generate with `make-eec-script.py`, run the printed path, then `--cleanup` it. Do NOT read
// this file and do NOT hand-write the CONFIG.
//
// One execution replaces: the `/lenses/publish` POST, the `registration-succeed` persist step,
// one `/apps/upload` POST per preview asset, and the complete concurrent byte transfer.
// The signed manifest moves directly from this script to `upload-all.py` over subprocess stdin;
// it never enters the model context, argv, or a file.
//
// AT MOST ONCE. `/lenses/publish` is a create. `make-eec-script.py` accepts only a complete
// REGISTRATION_AUTHORIZED result, then verifies its token and guarded request before filling
// this CONFIG. Both a started and a succeeded state count as a consumed attempt.
// Preview-upload registration is NOT a create: repeating it only mints another signed URL.
//
// Result shapes:
//   { status: "REGISTERED_AND_UPLOADED", registrationState, lensId, releaseId, releaseVersion,
//     portalUrl, isNew, previewUploads: [{previewIndex, type, url}] }
//   { status: "REGISTRATION_SUCCEEDED", registrationState }   ← registered, but a non-`needs_uploads`
//                                                               backend status; inspect and stop
//   { status: "ACTION_REQUIRED", reason, message, details?, ... }
//   { status: "FAILED", reason, message, ... }

// ===================== CONFIG — replace per call =====================
const REQUEST_PATH: string = "/lenses/publish";
const REQUEST_METHOD: string = "POST";
const TENANT_ID: string = "";
const BODY: Record<string, unknown> = {};
const REGISTRATION_STARTED: Record<string, unknown> = {};
const CONFIRMED_PLAN_TOKEN: string = "";
const PACKAGE_AUTHORIZATION_TOKEN: string = "";
const REGISTRATION_AUTHORIZATION_TOKEN: string = "";
// Session-owned path for the exact operation result. Empty only outside publish-session.py.
const RESULT_PATH: string = "";
// Absolute path to publish-flow.py, so this script can reuse the tested helpers.
const HELPER_PATH: string = "";
// Absolute path to upload-all.py. Its only input is the signed manifest on subprocess stdin.
const UPLOAD_HELPER_PATH: string = "";
// Absolute path to the exported SnapOS Package, and its base64 SHA-256.
const SPK_PATH: string = "";
const SPK_CHECKSUM: string = "";
// Confirmed preview set. Accepts the confirmed plan's own asset shape, so
// `confirmedPlan.previewMediaAssets` can be passed through unchanged:
//   [{ previewIndex, type | fileType, checksum, path }]
// The plan calls it `type`. Requiring `fileType` alone meant a pass-through produced an empty
// string, and the whole register failed after the release draft had already been created.
const PREVIEW_ASSETS: Record<string, unknown>[] = [];
const TILE_ASSETS: Record<string, unknown>[] = [];
// =====================================================================

const SUBMISSION_API_BASE = "https://api.spectacles.com/v1/submission";
const SUBMISSION_CLIENT_HEADER = "X-Specs-Submission-Client";
const SUBMISSION_CLIENT = "clad_specs_publish";
const Network = await import("LensStudio:Network");
const FileSystem = await import("LensStudio:FileSystem");
const SubprocessModule = await import("LensStudio:Subprocess");
const { spawnSync } = SubprocessModule;

const ACTION_REASONS = new Set([
  "CATEGORY_INVALID",
  "CATEGORY_REQUIRED",
  "FORBIDDEN",
  "INVALID_REQUEST",
  "ORG_AMBIGUOUS",
  "ORG_REQUIRED",
  "PKG_ID_REQUIRED",
  "PKG_ID_UNAVAILABLE",
  "SPECS_ACCOUNT_REQUIRED",
]);

function errorToString(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function sendAuthorized(request: any): Promise<any> {
  return new Promise((resolve) => {
    Network.performAuthorizedHttpRequest(request, (response: any) => resolve(response));
  });
}

/** Run one publish-flow.py operation. Its stdout is the single source of truth. */
function helper(operation: string, input: unknown): { ok: boolean; result: any; detail: string } {
  if (!HELPER_PATH) {
    return { ok: false, result: null, detail: "HELPER_PATH is not configured" };
  }
  // publish-flow.py takes --json <file>; a temp file for helper INPUT is fine — it never
  // holds a signed URL, only identity and checksums the caller already has.
  const scratch = FileSystem.TempDir.create();
  const inputPath = `${scratch.path.toString()}/register-${operation}.json`;
  try {
    FileSystem.writeFile(new Editor.Path(inputPath), JSON.stringify(input));
  } catch (error) {
    return { ok: false, result: null, detail: `could not stage helper input: ${errorToString(error)}` };
  }
  let spawned: any = null;
  try {
    spawned = spawnSync("python3", [HELPER_PATH, operation, "--json", inputPath], { timeout: 30000 } as any);
  } catch (error) {
    return { ok: false, result: null, detail: `${operation} failed to start: ${errorToString(error)}` };
  } finally {
    try {
      FileSystem.remove(new Editor.Path(inputPath));
    } catch {
      // A leftover helper input is harmless; it carries no credential.
    }
  }
  const stdout = spawned?.stdout ? spawned.stdout.toString() : "";
  const stderr = spawned?.stderr ? spawned.stderr.toString() : "";
  let parsed: any = null;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    parsed = null;
  }
  if (parsed === null) {
    return { ok: false, result: null, detail: `${operation} produced no JSON (exit ${spawned?.exitCode}): ${stderr.slice(0, 200)}` };
  }
  return { ok: true, result: parsed, detail: "" };
}

function asciiJsonLine(value: unknown): string {
  return `${JSON.stringify(value).replace(/[\u007f-\uffff]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  )}\n`;
}

function consumedRegistrationState(state: any): Record<string, unknown> {
  return {
    state: "succeeded",
    fingerprint: state?.fingerprint,
    attemptOrdinal: state?.attemptOrdinal,
    retryReason: state?.retryReason,
  };
}

/** Feed credentials directly to the uploader and return only its credential-free result. */
async function uploadAll(manifest: Record<string, unknown>): Promise<{ ok: boolean; result: any; detail: string }> {
  if (!UPLOAD_HELPER_PATH) {
    return { ok: false, result: null, detail: "UPLOAD_HELPER_PATH is not configured" };
  }
  return await new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let process: any = null;
    const connections: any[] = [];
    const finish = (value: { ok: boolean; result: any; detail: string }) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    try {
      process = SubprocessModule.Subprocess.create(
        "python3",
        [UPLOAD_HELPER_PATH],
        { timeout: 660000 } as any,
      );
      connections.push(
        process.stdout.connect((data: Editor.Buffer) => {
          stdout += data.toString();
        }),
        process.stderr.connect((data: Editor.Buffer) => {
          stderr += data.toString();
        }),
        process.onStart.connect(() => {
          try {
            let remaining = asciiJsonLine(manifest);
            while (remaining.length > 0) {
              const written = process.stdin.write(remaining);
              if (written <= 0) {
                throw new Error("uploader stdin accepted zero bytes");
              }
              remaining = remaining.slice(written);
            }
          } catch (error) {
            process.kill();
            finish({ ok: false, result: null, detail: `could not feed upload manifest: ${errorToString(error)}` });
          }
        }),
        process.onError.connect((errorCode: number) => {
          finish({ ok: false, result: null, detail: `upload helper process error ${errorCode}` });
        }),
        process.onExit.connect((exitCode: number) => {
          let parsed: any = null;
          try {
            parsed = JSON.parse(stdout);
          } catch {
            parsed = null;
          }
          if (parsed === null) {
            finish({
              ok: false,
              result: null,
              detail: `upload helper produced no JSON (exit ${exitCode}): ${stderr.slice(0, 300)}`,
            });
            return;
          }
          finish({ ok: true, result: parsed, detail: "" });
        }),
      );
      process.start();
    } catch (error) {
      finish({ ok: false, result: null, detail: `upload helper failed to start: ${errorToString(error)}` });
    }
  });
}

async function authorizedJson(
  method: string,
  path: string,
  body: Record<string, unknown> | null,
): Promise<{ statusCode: number; data: any; rawBody: string }> {
  const request = new Network.HttpRequest();
  request.url = `${SUBMISSION_API_BASE}${path}`;
  request.method = method === "POST" ? Network.HttpRequest.Method.Post : Network.HttpRequest.Method.Get;
  request.contentType = "application/json";
  request.headers = {
    Accept: "application/json",
    ...(TENANT_ID ? { "Tenant-Id": TENANT_ID } : {}),
    ...(method === "POST" && path === REQUEST_PATH
      ? { [SUBMISSION_CLIENT_HEADER]: SUBMISSION_CLIENT }
      : {}),
  };
  if (body !== null) {
    request.body = JSON.stringify(body);
  }
  const response = await sendAuthorized(request);
  const rawBody = response?.body ? response.body.toString() : "";
  let data: any = null;
  try {
    data = JSON.parse(rawBody);
  } catch {
    data = null;
  }
  return { statusCode: response?.statusCode ?? 0, data, rawBody };
}

function classify(path: string, statusCode: number, data: any, rawBody: string): Record<string, unknown> {
  const rawReason =
    typeof data?.code === "string" ? data.code : typeof data?.error === "string" ? data.error : `http_${statusCode}`;
  const reason = rawReason === "Forbidden" ? "FORBIDDEN" : rawReason;
  const actionable =
    ACTION_REASONS.has(reason) || statusCode === 400 || statusCode === 401 || statusCode === 403 || statusCode === 409;
  return {
    status: actionable ? "ACTION_REQUIRED" : "FAILED",
    stage: "register",
    reason,
    message:
      typeof data?.message === "string"
        ? data.message
        : typeof data?.error === "string"
          ? data.error
          : `${path} returned HTTP ${statusCode}.`,
    httpStatus: statusCode,
    requestPath: path,
    bodyPrefix: rawBody.slice(0, 1000),
    ...(data?.details ? { details: data.details } : {}),
  };
}

const OPERATION_RESULT = await (async (): Promise<any> => {
try {
  const auth = pluginSystem.findInterface(Editor.IAuthorization);
  if (!auth || !auth.isAuthorized) {
    return {
      status: "ACTION_REQUIRED",
      stage: "register",
      reason: auth ? "not_signed_in" : "no_auth_interface",
      message: "Sign in to Lens Studio from the profile menu, then retry.",
    };
  }
  if (
    !CONFIRMED_PLAN_TOKEN ||
    !PACKAGE_AUTHORIZATION_TOKEN ||
    !REGISTRATION_AUTHORIZATION_TOKEN ||
    !HELPER_PATH ||
    !UPLOAD_HELPER_PATH ||
    !SPK_PATH ||
    !SPK_CHECKSUM
  ) {
    return {
      status: "FAILED",
      stage: "register",
      reason: "incomplete_config",
      message:
        "register.ts requires deterministic plan, Package, helper, path, and checksum configuration.",
    };
  }

  // ---- 1. The create. At most once; the generator already fingerprinted it. ----
  const registered = await authorizedJson(REQUEST_METHOD, REQUEST_PATH, BODY);
  if (registered.statusCode < 200 || registered.statusCode >= 300) {
    return classify(REQUEST_PATH, registered.statusCode, registered.data, registered.rawBody);
  }

  // ---- 2. Persist the succeeded transition through the tested helper. ----
  const succeeded = helper("registration-succeed", {
    registrationState: REGISTRATION_STARTED,
    result: {
      status: "AUTHORIZED_POST_OK",
      httpStatus: registered.statusCode,
      requestPath: REQUEST_PATH,
      requestMethod: REQUEST_METHOD,
      data: registered.data,
    },
  });
  if (!succeeded.ok) {
    // The create landed. Surface enough to recover without POSTing again.
    return {
      status: "FAILED",
      stage: "register",
      reason: "registration_succeed_unavailable",
      message: `The release registered but the succeeded transition could not be persisted: ${succeeded.detail}`,
      backendData: registered.data,
    };
  }
  const registrationState = succeeded.result?.registrationState ?? null;
  const data = registered.data ?? {};
  if (data.status !== "needs_uploads") {
    return { ...succeeded.result, backendStatus: data.status };
  }

  const lensId = String(data.lensId ?? "");
  const releaseId = String(data.releaseId ?? "");
  const spkTarget = data?.uploads?.spk ?? null;
  if (!lensId || !releaseId || !spkTarget?.url) {
    return {
      status: "FAILED",
      stage: "register",
      reason: "incomplete_registration_response",
      message: "The registration response is missing lensId, releaseId, or the SnapOS Package upload target.",
      registrationState,
    };
  }

  // ---- 3. Register a signed target per confirmed preview asset. Not a create. ----
  const previewTargets: Record<string, unknown>[] = [];
  for (const asset of [...PREVIEW_ASSETS, ...TILE_ASSETS]) {
    const previewIndex = asset.tileType ? undefined : Number(asset.previewIndex);
    const failedAsset = asset.tileType ? { failedTileType: asset.tileType } : { failedPreviewIndex: previewIndex };
    const built = helper(asset.tileType ? "tile-upload-body" : "preview-upload-body", {
      ...(asset.tileType ? { tileType: asset.tileType } : { previewIndex }),
      appId: lensId,
      versionId: releaseId,
      checksum: String(asset.checksum ?? ""),
      fileType: String(asset.fileType ?? asset.type ?? ""),
      path: String(asset.path ?? ""),
    });
    if (!built.ok || built.result?.status !== "REQUEST_READY") {
      return {
        status: "FAILED",
        stage: "register",
        reason: "preview_upload_body_failed",
        ...failedAsset,
        message: built.ok ? JSON.stringify(built.result) : built.detail,
        registrationState,
        lensId,
        releaseId,
      };
    }
    const request = built.result.request;
    const upload = await authorizedJson("POST", request.path, request.body);
    if (upload.statusCode < 200 || upload.statusCode >= 300) {
      return {
        ...classify(request.path, upload.statusCode, upload.data, upload.rawBody),
        registrationState,
        lensId,
        releaseId,
        ...failedAsset,
      };
    }
    const headers = upload.data?.requiredHeaders ?? upload.data?.headers ?? {};
    previewTargets.push({
      ...(asset.tileType ? { tileType: asset.tileType } : { previewIndex }),
      type: String(asset.fileType ?? asset.type ?? ""),
      path: String(asset.path ?? ""),
      checksum: String(asset.checksum ?? ""),
      url: upload.data?.url,
      headers,
    });
  }

  // ---- 4. One manifest, straight into upload-all.py's stdin in this execution. ----
  const uploads: Record<string, unknown>[] = [
    { label: "spk", filePath: SPK_PATH, url: spkTarget.url, headers: spkTarget.headers ?? {}, checksum: SPK_CHECKSUM },
    ...previewTargets.map((target) => ({
      label: target.tileType ? `tile:${target.tileType}` : `preview:${target.previewIndex}`,
      filePath: target.path,
      url: target.url,
      headers: target.headers,
      checksum: target.checksum,
    })),
  ];

  const uploaded = await uploadAll({ uploads });
  if (!uploaded.ok) {
    return {
      status: "FAILED",
      stage: "upload",
      reason: "upload_helper_failed",
      message: uploaded.detail,
      registrationState,
      lensId,
      releaseId,
      previewTargets: previewTargets.map((target) => ({
        ...(target.tileType ? { tileType: target.tileType } : { previewIndex: target.previewIndex }),
        type: target.type,
      })),
    };
  }
  if (uploaded.result?.status !== "UPLOADS_DONE") {
    return {
      ...uploaded.result,
      registrationState,
      lensId,
      releaseId,
      previewTargets: previewTargets.map((target) => ({
        ...(target.tileType ? { tileType: target.tileType } : { previewIndex: target.previewIndex }),
        type: target.type,
      })),
    };
  }

  const uploadResults = Array.isArray(uploaded.result.uploads) ? uploaded.result.uploads : [];
  const mediaUploads = previewTargets.map((target) => {
    const label = target.tileType ? `tile:${target.tileType}` : `preview:${target.previewIndex}`;
    const uploadResult = uploadResults.find((entry: any) => entry?.label === label);
    return {
      ...(target.tileType ? { tileType: target.tileType } : { previewIndex: target.previewIndex, type: target.type }),
      url: String(uploadResult?.downloadUrl ?? ""),
    };
  });
  if (mediaUploads.some((entry) => !entry.url)) {
    return {
      status: "FAILED",
      stage: "upload",
      reason: "upload_result_incomplete",
      message: "Every uploaded preview must return a download URL.",
      registrationState,
      lensId,
      releaseId,
    };
  }

  return {
    status: "REGISTERED_AND_UPLOADED",
    stage: "register",
    registrationState: consumedRegistrationState(registrationState),
    lensId,
    releaseId,
    releaseVersion: data.releaseVersion,
    portalUrl: data.portalUrl,
    isNew: data.isNew,
    previewUploads: mediaUploads.filter((entry) => !("tileType" in entry)),
    tileUploads: mediaUploads.filter((entry) => "tileType" in entry),
    planToken: CONFIRMED_PLAN_TOKEN,
    packageAuthorizationToken: PACKAGE_AUTHORIZATION_TOKEN,
    registrationAuthorizationToken: REGISTRATION_AUTHORIZATION_TOKEN,
  };
} catch (error) {
  return { status: "FAILED", stage: "register", reason: "register_threw", message: errorToString(error) };
}
})();

if (RESULT_PATH) {
  try {
    FileSystem.writeFile(new Editor.Path(RESULT_PATH), JSON.stringify(OPERATION_RESULT));
    return { status: "RESULT_PERSISTED", stage: "register" };
  } catch {
    // The exact ExecuteEditorCode return remains the recovery source; never re-register for this.
  }
}
return OPERATION_RESULT;
