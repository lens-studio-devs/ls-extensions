// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// text-to-3d · AUTHORIZED REQUEST (Editor API) — used to CREATE a job and to POLL it.
// Sends an authenticated request to the SPECS text-to-3D inference API through Lens
// Studio's authorized HTTP: the credential is attached from the signed-in Lens Studio
// session (via request.authorization / performAuthorizedHttpRequest), so there is NO
// API key to handle, store, or commit.
//
// HOW TO RUN: read this file, set the CONFIG values for THIS call in the copy you pass
// to ExecuteEditorCode, then send the rest unchanged. Do NOT edit the file on disk.
//
//   Create (POST):  METHOD = "POST"; REQUEST_PATH = "/v1/generations";
//                   BODY = { prompt, /* + output_quality/preview_quality/reconstruction_quality/seed/style/negative_prompt if set */ }
//   Poll   (GET):   METHOD = "GET";  REQUEST_PATH = `/v1/generations/${jobId}`; BODY = {}
//
// Result shapes (branch on `status`):
//   { status: "OK", httpStatus, data }                       ← data is the job object; read data.status, data.job_id, data.asset_url
//   { status: "ACTION_REQUIRED", reason, message, ... }      ← sign in / access; fix, then retry the same call
//   { status: "FAILED", reason, message, httpStatus?, bodyPrefix?, retryable? }

// ===================== CONFIG — replace per call =====================
const METHOD: string = "POST";         // "POST" to create, "GET" to poll status
const REQUEST_PATH: string = "/v1/generations"; // create: "/v1/generations"; poll: `/v1/generations/${jobId}`
const BODY: Record<string, unknown> = {};
// =====================================================================

const API_BASE = "https://api.specs.com/v1/inference/text-to-3d";
const STARTED_AT = Date.now();
const Network = await import("LensStudio:Network");

function responseBody(response: any): string {
  try {
    return response && response.body ? response.body.toString() : "";
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
function requestUrl(): string {
  if (/^https?:\/\//i.test(REQUEST_PATH)) {
    return REQUEST_PATH;
  }
  const normalizedPath = REQUEST_PATH.startsWith("/") ? REQUEST_PATH : `/${REQUEST_PATH}`;
  return `${API_BASE}${normalizedPath}`;
}
function sendAuthorized(request: any): Promise<any> {
  return new Promise((resolve) => {
    Network.performAuthorizedHttpRequest(request, (response: any) => resolve(response));
  });
}

try {
  const auth = pluginSystem.findInterface(Editor.IAuthorization);
  if (!auth) {
    return { status: "ACTION_REQUIRED", reason: "no_auth_interface", message: "Lens Studio authorization is unavailable. Sign in to Lens Studio, then retry." };
  }
  if (!auth.isAuthorized) {
    return { status: "ACTION_REQUIRED", reason: "not_signed_in", message: "Sign in to Lens Studio, then retry." };
  }

  const url = requestUrl();
  const request = new Network.HttpRequest();
  request.url = url;
  request.method = METHOD === "GET" ? Network.HttpRequest.Method.Get : Network.HttpRequest.Method.Post;
  request.contentType = "application/json";
  request.headers = { Accept: "application/json" };
  if (METHOD !== "GET") {
    request.body = JSON.stringify(BODY);
  }

  const response = await sendAuthorized(request);
  const rawBody = responseBody(response);
  const json = parseJson(rawBody);
  const code = response?.statusCode ?? 0;

  if (!response || response.error || code < 200 || code >= 300) {
    // The API returns a `{ "detail": ... }` error envelope — a string, or a validation-error array on 422.
    const detail = json && json.detail;
    const message =
      (typeof detail === "string" && detail) ||
      (detail ? JSON.stringify(detail) : "") ||
      `Request returned HTTP ${code}.`;
    const meta = { reason: `http_${code}`, message, httpStatus: code, requestPath: REQUEST_PATH, bodyPrefix: rawBody.slice(0, 1000), elapsedMs: Date.now() - STARTED_AT };
    if (code === 401) {
      return { status: "ACTION_REQUIRED", ...meta, reason: "not_signed_in", message: "Authorization rejected (401). Sign in to Lens Studio, then retry." };
    }
    if (code === 403) {
      return { status: "ACTION_REQUIRED", ...meta, reason: "forbidden", message: "Forbidden (403). Check account access for the inference API." };
    }
    // 422 (validation), 404 (unknown job), 413 (image too large), 400 (bad JSON) won't pass on retry; only
    // transient classes are retryable.
    const retryable =
      !response || !!response.error || code === 408 || code === 429 || code === 500 || code === 502 || code === 504;
    return { status: "FAILED", ...meta, retryable };
  }

  return { status: "OK", httpStatus: code, data: json, requestPath: REQUEST_PATH, elapsedMs: Date.now() - STARTED_AT };
} catch (error) {
  return { status: "FAILED", reason: "exception", message: errorToString(error), retryable: true, stack: error instanceof Error ? error.stack : undefined };
}
