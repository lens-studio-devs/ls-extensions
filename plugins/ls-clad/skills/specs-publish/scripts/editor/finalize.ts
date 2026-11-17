// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// publish · FINALIZE (Editor API)
// Generate with `make-eec-script.py --finalize-authorization-uri`, run the printed path,
// then `--cleanup` it. Do NOT read this file and do NOT hand-write the CONFIG.
//
// One execution conditionally merges and PUTs confirmed replacements, then submits. A preview
// replacement first GETs version metadata so unrelated fields survive; a rating-only replacement
// needs no GET. When both preview media and content rating are reused, all metadata calls are skipped.
//
// 1. READ-BACK BEFORE SUBMIT. When metadata is replaced, the PUT response is compared only for
//    fields replaced by this run. Reused fields are never written or compared.
// 2. SUBMIT AT MOST ONCE, from persisted local state. A submitted release returns 404 on
//    /apps/{lensId}/versions/{releaseId} (observed 2026-07-29), so a consumed attempt can never
//    be resolved by asking the backend. The transition is owned by `publish-flow.py
//    submit-begin` / `submit-succeed` and persisted at SUBMIT_STATE_PATH before the POST. A
//    `validating` response remains started and is retried; only `submitted` closes the transition.
// 3. GRANULAR TERMINAL STATE, so a failure is resumable without guessing what landed.
// 4. THE MERGE IS NOT REIMPLEMENTED HERE. `merge-version-metadata` runs via subprocess so the
//    replace-not-append rule stays in one tested place.
//
// Result shapes:
//   { status: "SUBMITTED", lensId, releaseId, releaseVersion, portalUrl, backendStatus, submitState }
//   { status: "SUBMIT_PENDING", lensId, releaseId, retryAfterSeconds, submitState }
//   { status: "ALREADY_SUBMITTED", lensId, releaseId, submitState }        ← idempotent no-op
//   { status: "METADATA_MISMATCH", mismatches: [...], expected, actual }   ← nothing submitted
//   { status: "METADATA_UPDATE_FAILED", reason, message, ... }             ← nothing submitted, retry whole
//   { status: "METADATA_UPDATED_SUBMIT_FAILED", reason, message, submitState, ... }
//   { status: "SUBMIT_FAILED", reason, message, submitState, ... }         ← no metadata mutation landed
//   { status: "ACTION_REQUIRED" | "FAILED", reason, message, ... }

// ===================== CONFIG — replace per call =====================
const LENS_ID: string = "";
const RELEASE_ID: string = "";
const TENANT_ID: string = "";
// Absolute path to publish-flow.py.
const HELPER_PATH: string = "";
// Where the at-most-once submit transition is persisted across invocations.
const SUBMIT_STATE_PATH: string = "";
// Bound to the confirmed plan by Finalize authorization; never infer it from an existing release.
const TARGET_CHANNEL: string = "";
// The confirmed replacements. Empty PREVIEW_UPLOADS preserves existing preview media; an empty
// A non-empty CONTENT_RATING_ASSESSMENT replaces the content rating; SPECS computes the age rating
// from it on save. Leaving it empty preserves the existing rating.
const PREVIEW_UPLOADS: Record<string, unknown>[] = [];
const TILE_UPLOADS: Record<string, unknown>[] = [];
const LEGAL_DOCUMENT_INPUTS: Record<string, unknown> = {};
const CONTENT_RATING_ASSESSMENT: Record<string, unknown> = {};
const CONFIRMED_PLAN_TOKEN: string = "";
const PACKAGE_AUTHORIZATION_TOKEN: string = "";
const REGISTRATION_AUTHORIZATION_TOKEN: string = "";
const FINALIZE_AUTHORIZATION_TOKEN: string = "";
// Session-owned path for the exact operation result. Empty only outside publish-session.py.
const RESULT_PATH: string = "";
// Submits return in well under a second; 180000 was the only value near the RPC ceiling.
const SUBMIT_MAX_WAIT_MS: number = 15000;
// =====================================================================

const SUBMISSION_API_BASE = "https://api.spectacles.com/v1/submission";
const SUBMISSION_CLIENT_HEADER = "X-Specs-Submission-Client";
const SUBMISSION_CLIENT = "clad_specs_publish";
const Network = await import("LensStudio:Network");
const FileSystem = await import("LensStudio:FileSystem");
const { spawnSync } = await import("LensStudio:Subprocess");

function errorToString(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function sendAuthorized(request: any): Promise<any> {
  return new Promise((resolve) => {
    Network.performAuthorizedHttpRequest(request, (response: any) => resolve(response));
  });
}

function helper(operation: string, input: unknown): { ok: boolean; result: any; detail: string } {
  const scratch = FileSystem.TempDir.create();
  const inputPath = `${scratch.path.toString()}/finalize-${operation}.json`;
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
      // Helper input carries no credential; a leftover is harmless.
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
    return {
      ok: false,
      result: null,
      detail: `${operation} produced no JSON (exit ${spawned?.exitCode}): ${stderr.slice(0, 200)}`,
    };
  }
  return { ok: true, result: parsed, detail: "" };
}

async function authorizedJson(
  method: "GET" | "PUT" | "POST",
  path: string,
  body: Record<string, unknown> | null,
): Promise<{ statusCode: number; data: any; rawBody: string }> {
  const request = new Network.HttpRequest();
  request.url = `${SUBMISSION_API_BASE}${path}`;
  request.method =
    method === "PUT"
      ? Network.HttpRequest.Method.Put
      : method === "POST"
        ? Network.HttpRequest.Method.Post
        : Network.HttpRequest.Method.Get;
  request.contentType = "application/json";
  request.headers = {
    Accept: "application/json",
    ...(TENANT_ID ? { "Tenant-Id": TENANT_ID } : {}),
    ...(method === "POST" && path === `/lenses/${LENS_ID}/submit`
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

function readSubmitState(): Record<string, unknown> | null {
  try {
    if (!FileSystem.exists(new Editor.Path(SUBMIT_STATE_PATH))) return null;
    const parsed = JSON.parse(FileSystem.readFile(new Editor.Path(SUBMIT_STATE_PATH)));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
function writeSubmitState(state: unknown): boolean {
  try {
    FileSystem.writeFile(new Editor.Path(SUBMIT_STATE_PATH), JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/** Field-by-field comparison of the PUT read-back against the confirmed plan. */
function recordMismatches(
  path: string,
  expected: Record<string, unknown>,
  actual: Record<string, unknown> | null,
): string[] {
  if (!actual) return [`${path}: missing after the update`];
  const mismatches: string[] = [];
  const expectedKeys = Object.keys(expected).sort();
  const actualKeys = Object.keys(actual).sort();
  if (expectedKeys.join(",") !== actualKeys.join(",")) {
    mismatches.push(`${path} keys: expected [${expectedKeys}], read back [${actualKeys}]`);
  }
  for (const key of expectedKeys) {
    if (actual[key] !== expected[key]) {
      mismatches.push(`${path}.${key}: expected ${String(expected[key])}, read back ${String(actual[key])}`);
    }
  }
  return mismatches;
}

const AGE_RATINGS = new Set(["4+", "9+", "13+", "16+", "18+"]);

function readBackMismatches(version: any, expectedReviewMetadata: any): string[] {
  const mismatches: string[] = [];
  const actualAssets = version?.metadata?.default?.previewAssets ?? {};

  if (expectedReviewMetadata?.contentRatingAssessment) {
    // SPECS computes the rating from the saved answers; none means a backend that predates that.
    const actualRating = version?.reviewMetadata?.targetAgeRating;
    if (!AGE_RATINGS.has(actualRating)) {
      mismatches.push(`targetAgeRating: SPECS did not compute an age rating, read back ${String(actualRating)}`);
    }
    const expectedAssessment = expectedReviewMetadata.contentRatingAssessment;
    const actualAssessment = version?.reviewMetadata?.contentRatingAssessment;
    mismatches.push(
      ...recordMismatches(
        "contentRatingAssessment.severityAnswers",
        expectedAssessment.severityAnswers,
        actualAssessment?.severityAnswers ?? null,
      ),
      ...recordMismatches(
        "contentRatingAssessment.booleanAnswers",
        expectedAssessment.booleanAnswers,
        actualAssessment?.booleanAnswers ?? null,
      ),
    );
  }
  if (PREVIEW_UPLOADS.length > 0) {
    const actualIndexes = Object.keys(actualAssets).sort();
    const expectedIndexes = PREVIEW_UPLOADS.map((entry) => String(entry.previewIndex)).sort();
    if (actualIndexes.join(",") !== expectedIndexes.join(",")) {
      mismatches.push(`previewAssets indexes: expected [${expectedIndexes}], read back [${actualIndexes}]`);
    }
    for (const entry of PREVIEW_UPLOADS) {
      const index = String(entry.previewIndex);
      const actual = actualAssets[index];
      if (!actual) {
        mismatches.push(`previewAssets[${index}]: missing after the update`);
        continue;
      }
      if (actual.url !== entry.url) {
        mismatches.push(`previewAssets[${index}].url: expected ${String(entry.url)}, read back ${String(actual.url)}`);
      }
      if (actual.type !== entry.type) {
        mismatches.push(`previewAssets[${index}].type: expected ${String(entry.type)}, read back ${String(actual.type)}`);
      }
    }
  }
  for (const entry of TILE_UPLOADS) {
    const actual = version?.metadata?.default?.tileAssets?.[String(entry.tileType)]?.urlMap?.png;
    if (actual !== entry.url) mismatches.push(`tileAssets.${entry.tileType}.urlMap.png does not match the confirmed upload`);
  }
  return mismatches;
}

const OPERATION_RESULT = await (async (): Promise<any> => {
try {
  const auth = pluginSystem.findInterface(Editor.IAuthorization);
  if (!auth || !auth.isAuthorized) {
    return {
      status: "ACTION_REQUIRED",
      stage: "finalize",
      reason: auth ? "not_signed_in" : "no_auth_interface",
      message: "Sign in to Lens Studio from the profile menu, then retry.",
    };
  }
  if (
    !LENS_ID ||
    !RELEASE_ID ||
    !HELPER_PATH ||
    !SUBMIT_STATE_PATH ||
    !["production", "beta", "internal"].includes(TARGET_CHANNEL) ||
    !CONFIRMED_PLAN_TOKEN ||
    !PACKAGE_AUTHORIZATION_TOKEN ||
    !REGISTRATION_AUTHORIZATION_TOKEN ||
    !FINALIZE_AUTHORIZATION_TOKEN
  ) {
    return {
      status: "FAILED",
      stage: "finalize",
      reason: "incomplete_config",
      message: "finalize.ts requires complete deterministic release and authorization configuration.",
    };
  }
  // ---- 0. Persisted at-most-once check, before anything else. ----
  const existingSubmitState = readSubmitState();
  if (existingSubmitState && (existingSubmitState.targetChannel ?? "production") !== TARGET_CHANNEL) {
    return {
      status: "FAILED",
      stage: "finalize",
      reason: "submit_state_mismatch",
      message: "The persisted submit state targets a different channel; no metadata was changed.",
    };
  }
  if (
    existingSubmitState &&
    existingSubmitState.state === "succeeded" &&
    existingSubmitState.lensId === LENS_ID &&
    existingSubmitState.releaseId === RELEASE_ID
  ) {
    return {
      status: "ALREADY_SUBMITTED",
      targetChannel: TARGET_CHANNEL,
      stage: "finalize",
      lensId: LENS_ID,
      releaseId: RELEASE_ID,
      submitState: existingSubmitState,
      message: "This release was already submitted; nothing was re-sent.",
      finalizeAuthorizationToken: FINALIZE_AUTHORIZATION_TOKEN,
    };
  }
  if (
    existingSubmitState &&
    (existingSubmitState.lensId !== LENS_ID || existingSubmitState.releaseId !== RELEASE_ID)
  ) {
    return {
      status: "FAILED",
      stage: "finalize",
      reason: "submit_state_mismatch",
      message: "The persisted submit state belongs to a different release; no metadata was changed.",
    };
  }
  // Lens documents are shared by every release. Never write them as version metadata.
  // Check before metadata changes or opening a submit attempt. Session-owned polling
  // is bounded; a pending replacement must not be hidden by an older active URL.
  let legalResponse = await authorizedJson("GET", `/apps/${LENS_ID}/legal-documents`, null);
  const updates = helper("legal-documents-updates", {
    legalDocumentInputs: LEGAL_DOCUMENT_INPUTS,
    response: { httpStatus: legalResponse.statusCode, data: legalResponse.data },
  });
  if (!updates.ok || updates.result?.status !== "LEGAL_DOCUMENT_UPDATES_READY") {
    return { ...(updates.ok ? updates.result : { status: "FAILED", reason: "legal_documents_check_unavailable", message: updates.detail }),
      stage: "finalize", lensId: LENS_ID, releaseId: RELEASE_ID,
      targetChannel: TARGET_CHANNEL, finalizeAuthorizationToken: FINALIZE_AUTHORIZATION_TOKEN };
  }
  for (const update of updates.result.updates) {
    const saved = await authorizedJson("PUT", `/apps/${LENS_ID}/legal-documents`, update);
    if (saved.statusCode < 200 || saved.statusCode >= 300) {
      return { status: "ACTION_REQUIRED", stage: "finalize", reason: "legal_document_save_failed",
        message: "Could not save the confirmed Lens document. Check Lens Settings and permissions before retrying.",
        lensId: LENS_ID, releaseId: RELEASE_ID, targetChannel: TARGET_CHANNEL,
        finalizeAuthorizationToken: FINALIZE_AUTHORIZATION_TOKEN };
    }
  }
  if (updates.result.updates.length) {
    legalResponse = await authorizedJson("GET", `/apps/${LENS_ID}/legal-documents`, null);
  }
  const legal = helper("legal-documents-check", {
    targetChannel: TARGET_CHANNEL,
    response: { httpStatus: legalResponse.statusCode, data: legalResponse.data },
  });
  if (!legal.ok || legal.result?.status !== "LEGAL_DOCUMENTS_READY") {
    return {
      ...(legal.ok ? legal.result : {
        status: "FAILED", reason: "legal_documents_check_unavailable", message: legal.detail,
      }),
      stage: "finalize", lensId: LENS_ID, releaseId: RELEASE_ID,
      targetChannel: TARGET_CHANNEL, finalizeAuthorizationToken: FINALIZE_AUTHORIZATION_TOKEN,
    };
  }

  const hasRatingAssessment = Object.keys(CONTENT_RATING_ASSESSMENT).length > 0;

  const versionPath = `/apps/${LENS_ID}/versions/${RELEASE_ID}`;
  const metadataUpdateRequired = PREVIEW_UPLOADS.length > 0 || TILE_UPLOADS.length > 0 || hasRatingAssessment;
  // A matching started transition is written only after any configured metadata PUT succeeds.
  // On retry, the submit may already have landed and the version GET may therefore return 404.
  const metadataAlreadyUpdated =
    existingSubmitState?.state === "started" &&
    existingSubmitState.lensId === LENS_ID &&
    existingSubmitState.releaseId === RELEASE_ID;
  let metadataUpdated = metadataUpdateRequired && metadataAlreadyUpdated;

  if (metadataUpdateRequired && !metadataAlreadyUpdated) {
    // ---- 1. Read only when replacing previews, so unrelated version metadata survives. ----
    let existingMetadata: Record<string, unknown> = {};
    if (PREVIEW_UPLOADS.length > 0 || TILE_UPLOADS.length > 0) {
      const current = await authorizedJson("GET", versionPath, null);
      if (current.statusCode < 200 || current.statusCode >= 300) {
        return {
          status: "METADATA_UPDATE_FAILED",
          stage: "finalize",
          reason: `http_${current.statusCode}`,
          message: `Could not read the release before updating preview media: HTTP ${current.statusCode}.`,
          httpStatus: current.statusCode,
          bodyPrefix: current.rawBody.slice(0, 600),
        };
      }
      existingMetadata = current.data?.metadata ?? {};
    }

    // ---- 2. Merge only confirmed replacements through the tested helper. ----
    const merged = helper("merge-version-metadata", {
      existingMetadata,
      ...(hasRatingAssessment ? { contentRatingAssessment: CONTENT_RATING_ASSESSMENT } : {}),
      previewUploads: PREVIEW_UPLOADS,
      tileUploads: TILE_UPLOADS,
    });
    if (!merged.ok || merged.result?.status !== "VERSION_UPDATE_READY") {
      return {
        status: "METADATA_UPDATE_FAILED",
        stage: "finalize",
        reason: "merge_failed",
        message: merged.ok ? JSON.stringify(merged.result) : merged.detail,
      };
    }

    // ---- 3. PUT, then read back only the fields this run replaced. ----
    const updated = await authorizedJson("PUT", versionPath, merged.result.body);
    if (updated.statusCode < 200 || updated.statusCode >= 300) {
      return {
        status: "METADATA_UPDATE_FAILED",
        stage: "finalize",
        reason: `http_${updated.statusCode}`,
        message: `The metadata update failed: HTTP ${updated.statusCode}. Nothing was submitted.`,
        httpStatus: updated.statusCode,
        bodyPrefix: updated.rawBody.slice(0, 600),
      };
    }
    const mismatches = readBackMismatches(updated.data, merged.result.body?.reviewMetadata);
    if (mismatches.length > 0) {
      return {
        status: "METADATA_MISMATCH",
        stage: "finalize",
        reason: "read_back_mismatch",
        message: "The updated release does not match the confirmed plan, so it was not submitted.",
        mismatches,
        expected: {
          ...(PREVIEW_UPLOADS.length > 0 ? { previewUploads: PREVIEW_UPLOADS } : {}),
          ...(hasRatingAssessment ? { reviewMetadata: merged.result.body?.reviewMetadata } : {}),
        },
        actual: {
          ...(PREVIEW_UPLOADS.length > 0
            ? { previewAssets: updated.data?.metadata?.default?.previewAssets ?? null }
            : {}),
          ...(hasRatingAssessment ? { reviewMetadata: updated.data?.reviewMetadata ?? null } : {}),
        },
      };
    }
    metadataUpdated = true;
  }

  // ---- 4. Open the submit transition and persist it BEFORE the POST. ----
  const submitBody = {
    releaseId: RELEASE_ID,
    targetChannel: TARGET_CHANNEL,
    wait: true,
    maxWaitMs: SUBMIT_MAX_WAIT_MS,
    pollIntervalMs: 1000,
  };
  const submitPath = `/lenses/${LENS_ID}/submit`;
  const begun = helper("submit-begin", {
    request: { method: "POST", path: submitPath, tenantId: TENANT_ID, body: submitBody },
    lensId: LENS_ID,
    releaseId: RELEASE_ID,
    attemptOrdinal: existingSubmitState ? Number(existingSubmitState.attemptOrdinal ?? 0) + 1 : 1,
    retryReason: existingSubmitState
      ? existingSubmitState.nextRetryReason === "legal_documents_corrected"
        ? "legal_documents_corrected"
        : existingSubmitState.nextRetryReason === "submit_returned_retryable_status"
        ? "submit_returned_retryable_status"
        : "submit_transport_failed"
      : "initial",
    ...(existingSubmitState ? { existingState: existingSubmitState } : {}),
  });
  if (!begun.ok || begun.result?.status !== "SUBMIT_STARTED") {
    return {
      status: begun.ok ? (begun.result?.status ?? "FAILED") : "FAILED",
      stage: "finalize",
      reason: begun.ok ? begun.result?.reason : "submit_begin_unavailable",
      message: begun.ok ? begun.result?.message : begun.detail,
      metadataUpdated,
      ...(begun.ok && begun.result?.details ? { details: begun.result.details } : {}),
    };
  }
  if (!writeSubmitState(begun.result.submitState)) {
    // Refuse to submit rather than submit un-guarded: an unpersisted attempt is exactly the
    // state that cannot be recovered, because the release will 404 on a read afterwards.
    return {
      status: metadataUpdated ? "METADATA_UPDATED_SUBMIT_FAILED" : "SUBMIT_FAILED",
      stage: "finalize",
      reason: "submit_state_unpersistable",
      message: metadataUpdated
        ? `Could not persist the submit transition to ${SUBMIT_STATE_PATH}, so nothing was submitted. The metadata update already landed — retry submit only.`
        : `Could not persist the submit transition to ${SUBMIT_STATE_PATH}, so nothing was submitted.`,
      submitState: begun.result.submitState,
      metadataUpdated,
    };
  }

  // ---- 5. Submit. ----
  const submitted = await authorizedJson("POST", submitPath, submitBody);
  if (submitted.statusCode < 200 || submitted.statusCode >= 300) {
    // Documents can change after the readiness read. Persist a known rejection
    // before allowing correction/retry, keeping any completed metadata PUT intact.
    const rejected = helper("submit-reject-legal-documents", {
      submitState: begun.result.submitState,
      response: { httpStatus: submitted.statusCode, data: submitted.data },
    });
    if (rejected.ok && rejected.result?.reason === "legal_documents_required") {
      if (!writeSubmitState(rejected.result.submitState)) {
        return { status: "FAILED", stage: "finalize", reason: "submit_state_unpersistable",
          message: "Could not persist the legal-document rejection; do not resubmit automatically." };
      }
      return { ...rejected.result, lensId: LENS_ID, releaseId: RELEASE_ID,
        targetChannel: TARGET_CHANNEL, metadataUpdated, httpStatus: submitted.statusCode,
        finalizeAuthorizationToken: FINALIZE_AUTHORIZATION_TOKEN };
    }
    return {
      status: metadataUpdated ? "METADATA_UPDATED_SUBMIT_FAILED" : "SUBMIT_FAILED",
      stage: "finalize",
      reason: `http_${submitted.statusCode}`,
      message: metadataUpdated
        ? `The metadata update landed but submit returned HTTP ${submitted.statusCode}. Retry submit only; never re-PUT.`
        : `Submit returned HTTP ${submitted.statusCode}. No metadata update was required or sent.`,
      httpStatus: submitted.statusCode,
      bodyPrefix: submitted.rawBody.slice(0, 600),
      submitState: begun.result.submitState,
      metadataUpdated,
    };
  }

  const closed = helper("submit-succeed", {
    submitState: begun.result.submitState,
    result: { status: "AUTHORIZED_POST_OK", httpStatus: submitted.statusCode, data: submitted.data },
  });
  if (
    !closed.ok ||
    (closed.result?.status !== "SUBMIT_SUCCEEDED" && closed.result?.status !== "SUBMIT_PENDING")
  ) {
    return {
      status: "FAILED",
      stage: "finalize",
      reason: "submit_result_invalid",
      message: closed.ok
        ? `Submit returned an unexpected success response: ${JSON.stringify(closed.result)}`
        : closed.detail,
      httpStatus: submitted.statusCode,
      submitState: begun.result.submitState,
      metadataUpdated,
    };
  }
  if (!writeSubmitState(closed.result.submitState)) {
    return {
      status: "FAILED",
      stage: "finalize",
      reason: "submit_state_unpersistable",
      message: "The submit response could not be persisted; do not resubmit automatically.",
      httpStatus: submitted.statusCode,
      submitState: begun.result.submitState,
      metadataUpdated,
    };
  }
  if (closed.result.status === "SUBMIT_PENDING") {
    return {
      status: "SUBMIT_PENDING",
      targetChannel: TARGET_CHANNEL,
      stage: "finalize",
      lensId: LENS_ID,
      releaseId: RELEASE_ID,
      releaseVersion: submitted.data?.releaseVersion,
      backendStatus: submitted.data?.status,
      retryAfterSeconds: submitted.data?.retryAfterSeconds,
      submitState: closed.result.submitState,
      metadataUpdated,
      finalizeAuthorizationToken: FINALIZE_AUTHORIZATION_TOKEN,
      message: "Build validation is still in progress; retry submit after the requested delay.",
    };
  }

  return {
    status: "SUBMITTED",
    targetChannel: TARGET_CHANNEL,
    stage: "finalize",
    lensId: LENS_ID,
    releaseId: RELEASE_ID,
    releaseVersion: submitted.data?.releaseVersion,
    portalUrl: submitted.data?.portalUrl,
    backendStatus: submitted.data?.status,
    retryAfterSeconds: submitted.data?.retryAfterSeconds,
    submitState: closed.ok ? closed.result?.submitState : begun.result.submitState,
    previewAssetsVerified: PREVIEW_UPLOADS.length,
    tileAssetsVerified: TILE_UPLOADS.length,
    metadataUpdated,
    finalizeAuthorizationToken: FINALIZE_AUTHORIZATION_TOKEN,
  };
} catch (error) {
  return { status: "FAILED", stage: "finalize", reason: "finalize_threw", message: errorToString(error) };
}
})();

if (RESULT_PATH) {
  try {
    FileSystem.writeFile(new Editor.Path(RESULT_PATH), JSON.stringify(OPERATION_RESULT));
    return { status: "RESULT_PERSISTED", stage: "finalize" };
  } catch {
    // The exact ExecuteEditorCode return remains the recovery source; never resubmit for this.
  }
}
return OPERATION_RESULT;
