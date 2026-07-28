// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// publish · AUTHORIZED REQUEST (Editor API) — used for category lookup, register, metadata updates, and submit.
// Sends an authenticated request to the Specs submission API through Lens Studio's authorized
// HTTP, retries across API bases, and classifies the result so the skill knows whether to
// proceed, prompt the user, or fail.
//
// HOW TO RUN: do NOT read this file, and do NOT hand-write the CONFIG consts.
// Run `make-eec-script.py` against it — it JSON-encodes each value (a bare
// quote or a Windows backslash otherwise corrupts the emitted TypeScript), keeps the
// declarations' type annotations, and prints a unique temp path. Pass that path to
// ExecuteEditorCode as `path`, then delete it. Never edit this file on disk.
//
//   Categories:           REQUEST_PATH = "/categories"
//                         REQUEST_METHOD = "GET"
//                         BODY = {}
//   Publish (register):   REQUEST_PATH = "/lenses/publish"
//                         REQUEST_METHOD = "POST"
//                         BODY = { pkgId, name, spkChecksum, /* +orgId/categoryId/semanticVersion if set */ }
//   Preview upload:       REQUEST_PATH = "/apps/upload"
//                         REQUEST_METHOD = "POST"
//                         BODY = { appId, versionId, contentType: "prv", checksum, checksumAlgo, previewIndex, fileType }
//   Preview metadata:     REQUEST_PATH = `/apps/${lensId}/versions/${releaseId}`
//                         REQUEST_METHOD = "PUT"
//                         BODY = { metadata: { ...existingMetadata, default: { ...existingMetadata.default, previewAssets } } }
//   Age rating metadata:  REQUEST_PATH = `/apps/${lensId}/versions/${releaseId}`
//                         REQUEST_METHOD = "PUT"
//                         BODY = { reviewMetadata: { targetAgeRating } }
//   Submit:               REQUEST_PATH = `/lenses/${lensId}/submit`
//                         REQUEST_METHOD = "POST"
//                         BODY = { releaseId, wait: true, maxWaitMs: 180000, pollIntervalMs: 1000 }
//   TENANT_ID: set to the chosen orgId once known, else "".
//
// Result shapes:
//   { status: "AUTHORIZED_POST_OK", httpStatus, data, ... }   ← legacy success name for GET/POST/PUT; inspect data
//   { status: "ACTION_REQUIRED", reason, message, ... }       ← ask the user, then retry
//   { status: "FAILED", reason, message, httpStatus?, apiBaseUrl?, bodyPrefix?, ... }

// ===================== CONFIG — replace per call =====================
const REQUEST_PATH = "/lenses/publish";
const REQUEST_METHOD = "POST";
const BODY: Record<string, unknown> = {};
const TENANT_ID = "";
const EXTRA_HEADERS: Record<string, string> = {};
// =====================================================================

const SUBMISSION_API_BASES = [
  "https://api.spectacles.com/v1/submission",
];
const STARTED_AT = Date.now();
const Network = await import("LensStudio:Network");

function responseBody(response: any): string {
  try {
    return response.body ? response.body.toString() : "";
  } catch (_error) {
    return "";
  }
}
function parseJson(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch (_error) {
    return null;
  }
}
function errorToString(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function actionRequired(reason: string, message: string, extra: Record<string, unknown> = {}): any {
  return { status: "ACTION_REQUIRED", stage: "authorized_post", reason, message, ...extra };
}
function failed(reason: string, message: string, extra: Record<string, unknown> = {}): any {
  return { status: "FAILED", stage: "authorized_post", reason, message, ...extra };
}
function requestMethod(): any {
  switch (REQUEST_METHOD.toUpperCase()) {
    case "GET":
      return Network.HttpRequest.Method.Get;
    case "POST":
      return Network.HttpRequest.Method.Post;
    case "PUT":
      return Network.HttpRequest.Method.Put;
    default:
      throw new Error(`Unsupported REQUEST_METHOD: ${REQUEST_METHOD}. Use GET, POST, or PUT.`);
  }
}
function isRetryableApiResponse(response: any): boolean {
  if (!response || response.error) {
    return true;
  }
  return response.statusCode === 404 || response.statusCode === 502 || response.statusCode === 503 || response.statusCode === 504;
}
function requestUrls(): string[] {
  if (/^https?:\/\//i.test(REQUEST_PATH)) {
    return [REQUEST_PATH];
  }
  const normalizedPath = REQUEST_PATH.startsWith("/") ? REQUEST_PATH : `/${REQUEST_PATH}`;
  return SUBMISSION_API_BASES.map((base) => `${base}${normalizedPath}`);
}
function requestMetadata(url: string): Record<string, unknown> {
  const base = SUBMISSION_API_BASES.find((candidate) => url.startsWith(candidate)) || "";
  return { requestPath: REQUEST_PATH, requestMethod: REQUEST_METHOD, url, ...(base ? { apiBaseUrl: base } : {}) };
}
function sendAuthorized(request: any): Promise<any> {
  return new Promise((resolve) => {
    Network.performAuthorizedHttpRequest(request, (response: any) => resolve(response));
  });
}
function apiError(response: any, rawBody: string, json: any, meta: Record<string, unknown>): any {
  const rawReason =
    typeof json?.code === "string"
      ? json.code
      : typeof json?.error === "string"
        ? json.error
        : `http_${response?.statusCode ?? 0}`;
  const reason = rawReason === "Forbidden" ? "FORBIDDEN" : rawReason;
  const message =
    typeof json?.message === "string"
      ? json.message
      : typeof json?.error === "string"
        ? json.error
        : `Authorized request returned HTTP ${response?.statusCode ?? 0}.`;
  const actionReasons = new Set([
    "CATEGORY_REQUIRED",
    "CATEGORY_INVALID",
    "FORBIDDEN",
    "INVALID_REQUEST",
    "ORG_AMBIGUOUS",
    "ORG_REQUIRED",
    "PKG_ID_REQUIRED",
    "PKG_ID_UNAVAILABLE",
    "SPECS_ACCOUNT_REQUIRED",
  ]);
  return {
    status:
      actionReasons.has(reason) ||
      response?.statusCode === 400 ||
      response?.statusCode === 401 ||
      response?.statusCode === 403 ||
      response?.statusCode === 409
        ? "ACTION_REQUIRED"
        : "FAILED",
    stage: "authorized_post",
    reason,
    message,
    details: json?.details,
    httpStatus: response?.statusCode,
    bodyPrefix: rawBody.slice(0, 1000),
    ...meta,
  };
}

try {
  const auth = pluginSystem.findInterface(Editor.IAuthorization);
  if (!auth) {
    return actionRequired("no_auth_interface", "Lens Studio authorization is unavailable. Sign in to Lens Studio, then retry.");
  }
  if (!auth.isAuthorized) {
    return actionRequired("not_signed_in", "Sign in to Lens Studio, then retry.");
  }

  let lastResponse: any = undefined;
  let lastMeta: Record<string, unknown> = {};
  for (const url of requestUrls()) {
    const request = new Network.HttpRequest();
    request.url = url;
    request.method = requestMethod();
    request.contentType = "application/json";
    request.headers = {
      Accept: "application/json",
      ...(TENANT_ID ? { "Tenant-Id": TENANT_ID } : {}),
      ...EXTRA_HEADERS,
    };
    if (REQUEST_METHOD.toUpperCase() !== "GET") {
      request.body = JSON.stringify(BODY);
    }

    const response = await sendAuthorized(request);
    lastResponse = response;
    lastMeta = requestMetadata(url);
    if (!isRetryableApiResponse(response)) {
      break;
    }
  }

  const rawBody = responseBody(lastResponse);
  const json = parseJson(rawBody);
  if (!lastResponse || lastResponse.error || lastResponse.statusCode < 200 || lastResponse.statusCode >= 300) {
    return apiError(lastResponse, rawBody, json, lastMeta);
  }

  return {
    status: "AUTHORIZED_POST_OK",
    stage: "authorized_post",
    httpStatus: lastResponse.statusCode,
    data: json,
    bodyPrefix: rawBody.slice(0, 1000),
    elapsedMs: Date.now() - STARTED_AT,
    ...lastMeta,
  };
} catch (error) {
  return failed("exception", errorToString(error), {
    stack: error instanceof Error ? error.stack : undefined,
    elapsedMs: Date.now() - STARTED_AT,
  });
}
