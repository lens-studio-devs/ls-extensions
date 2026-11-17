// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// text-to-3d · AUTHORIZED REQUEST (Editor API) — used to CREATE a job and to POLL it.
// Sends an authenticated request to the SPECS text-to-3D inference API through Lens
// Studio's authorized HTTP: the credential is attached from the signed-in Lens Studio
// session (via request.authorization / performAuthorizedHttpRequest), so there is NO
// API key to handle, store, or commit.
//
// HOW TO RUN: pass this pinned file to ExecuteEditorCode as `{ path, args }`.
// `args` is exactly:
//   { method: "POST" | "GET", requestPath: string, body: Record<string, unknown> }
// Always supply `body`, including `body: {}` for a GET.
//
// Never edit this pinned file on disk.
//
// Result shapes (branch on `status`):
//   { status: "OK", httpStatus, data }                       ← data is the job object; read data.status, data.job_id, data.asset_url
//   { status: "ACTION_REQUIRED", reason, message, ... }      ← sign in / access; fix, then retry the same call
//   { status: "FAILED", reason, message, httpStatus?, bodyPrefix?, retryable? }

const API_BASE = "https://api.specs.com/v1/inference/text-to-3d";
const STARTED_AT = Date.now();

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
function invalidArgs(message: string) {
  return { status: "FAILED", reason: "invalid_args", message, retryable: false };
}
function isBodyObject(value: unknown) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

if (args === null || typeof args !== "object" || Array.isArray(args)) {
  return invalidArgs("Expected args to be a JSON object.");
}

const method = args.method;
const requestPath = args.requestPath;
const hasBody = Object.prototype.hasOwnProperty.call(args, "body");
if (method !== "POST" && method !== "GET") {
  return invalidArgs('Expected args.method to be "POST" or "GET".');
}
if (typeof requestPath !== "string" || requestPath.length === 0) {
  return invalidArgs("Expected args.requestPath to be a non-empty string.");
}
// This script uses Lens Studio's signed-in authorization. Keep that credential scoped
// to the two API routes it owns: never accept a URL, authority, query, fragment, or
// path which could be normalized to another endpoint.
const isCreateRequest = method === "POST" && requestPath === "/v1/generations";
const isPollRequest =
  method === "GET" && /^\/v1\/generations\/[A-Za-z0-9][A-Za-z0-9_-]*$/.test(requestPath);
if (!isCreateRequest && !isPollRequest) {
  return invalidArgs(
    'Expected args.requestPath to be POST /v1/generations or GET /v1/generations/<job-id>.',
  );
}
if (!hasBody) {
  return invalidArgs("Expected args.body to be provided.");
}

const body = args.body;
if (!isBodyObject(body)) {
  return invalidArgs("Expected args.body to be an ordinary JSON object.");
}

const Network = await import("LensStudio:Network");
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

  const url = `${API_BASE}${requestPath}`;
  const request = new Network.HttpRequest();
  request.url = url;
  request.method = method === "GET" ? Network.HttpRequest.Method.Get : Network.HttpRequest.Method.Post;
  request.contentType = "application/json";
  request.headers = { Accept: "application/json" };
  if (method !== "GET") {
    request.body = JSON.stringify(body);
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
    const meta = { reason: `http_${code}`, message, httpStatus: code, requestPath, bodyPrefix: rawBody.slice(0, 1000), elapsedMs: Date.now() - STARTED_AT };
    if (code === 401) {
      return { status: "ACTION_REQUIRED", ...meta, reason: "not_signed_in", message: "Authorization rejected (401). Sign in to Lens Studio, then retry." };
    }
    if (code === 403) {
      return { status: "ACTION_REQUIRED", ...meta, reason: "forbidden", message: "Forbidden (403). Check account access for the inference API." };
    }
    // 422 (validation), 404 (unknown job), 400 (bad JSON) won't pass on retry; only
    // transient classes are retryable.
    const retryable =
      !response || !!response.error || code === 408 || code === 429 || code === 500 || code === 502 || code === 504;
    return { status: "FAILED", ...meta, retryable };
  }

  return { status: "OK", httpStatus: code, data: json, requestPath, elapsedMs: Date.now() - STARTED_AT };
} catch (error) {
  return { status: "FAILED", reason: "exception", message: errorToString(error), retryable: true, stack: error instanceof Error ? error.stack : undefined };
}
