// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// publish · DISCOVER (Editor API)
// The normal publish session generates a configured copy with RESULT_PATH. Direct execution
// remains the zero-config diagnostic/recovery path.
//
// One execution replaces the configured `authorized-request.ts` calls and their
// `make-eec-script.py` generations: it reads the open project's package identity, gets the
// combined publish context, and fetches categories only when the effective listing has no
// reusable category (or an explicit category override requested them).
//
// It deliberately does NOT apply the package build-version guard. That comparison is
// fail-closed and lives in `publish-flow.py version-guard`, where it is unit-tested; a second
// implementation here could not be tested outside Lens Studio and would be free to drift.
// Pass `availability.data` from this result straight to that helper. Carry
// `storeListingReuse` into the deterministic frozen plan unchanged.
//
// TENANT_ID and FORCE_CATEGORY_FETCH are retry/override configs. Leave both empty for the first
// call. Set FORCE_CATEGORY_FETCH to "true" only when the user explicitly supplied or requested a
// replacement category while publish-context reports an existing category.
// PACKAGE_ID_NONCE is session-owned so retries retain the same missing/invalid-ID proposal;
// PROPOSED_PACKAGE_ID is an explicit missing/invalid-ID override. Neither changes the project.
//
// Result shapes:
//   { status: "DISCOVERED", projectPath, packageId, currentPackageId, packageVersion,
//     publishContext: { data }, availability: { data }, storeListingReuse,
//     categories, selectableCategories, calls: [...] }
//   { status: "ACTION_REQUIRED", reason, message, failedCall, details?, ... }
//   { status: "FAILED", reason, message, failedCall?, ... }

// ===================== CONFIG — only for the ORG_AMBIGUOUS retry =====================
const TENANT_ID: string = "";
const FORCE_CATEGORY_FETCH: string = "";
const PACKAGE_ID_NONCE: string = "";
const PROPOSED_PACKAGE_ID: string = "";
const RESULT_PATH: string = "";
// =====================================================================================

const SUBMISSION_API_BASE = "https://api.spectacles.com/v1/submission";
const FileSystem = await import("LensStudio:FileSystem");
const Network = await import("LensStudio:Network");

// Category buckets that are never a developer's own choice.
const EXCLUDED_CATEGORY_NAMES = new Set(["featured", "favorites", "favourites"]);

// Backend codes that mean "ask the user", not "give up".
const ACTION_REASONS = new Set([
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
function sendAuthorized(request: any): Promise<any> {
  return new Promise((resolve) => {
    Network.performAuthorizedHttpRequest(request, (response: any) => resolve(response));
  });
}

interface CallOutcome {
  label: string;
  path: string;
  statusCode: number;
  elapsedMs: number;
  ok: boolean;
  data: any;
  rawBody: string;
}

async function authorizedGet(label: string, path: string): Promise<CallOutcome> {
  const startedAt = Date.now();
  const request = new Network.HttpRequest();
  request.url = `${SUBMISSION_API_BASE}${path}`;
  request.method = Network.HttpRequest.Method.Get;
  request.contentType = "application/json";
  request.headers = {
    Accept: "application/json",
    ...(TENANT_ID ? { "Tenant-Id": TENANT_ID } : {}),
  };
  const response = await sendAuthorized(request);
  const rawBody = response?.body ? response.body.toString() : "";
  let data: any = null;
  try {
    data = JSON.parse(rawBody);
  } catch {
    data = null;
  }
  const statusCode = response?.statusCode ?? 0;
  return {
    label,
    path,
    statusCode,
    elapsedMs: Date.now() - startedAt,
    ok: statusCode >= 200 && statusCode < 300,
    data,
    rawBody,
  };
}

function callFailure(call: CallOutcome): Record<string, unknown> {
  const json = call.data;
  const rawReason =
    typeof json?.code === "string"
      ? json.code
      : typeof json?.error === "string"
        ? json.error
        : `http_${call.statusCode}`;
  const reason = rawReason === "Forbidden" ? "FORBIDDEN" : rawReason;
  const message =
    typeof json?.message === "string"
      ? json.message
      : typeof json?.error === "string"
        ? json.error
        : `Discovery call ${call.label} returned HTTP ${call.statusCode}.`;
  const actionable =
    ACTION_REASONS.has(reason) ||
    call.statusCode === 400 ||
    call.statusCode === 401 ||
    call.statusCode === 403 ||
    call.statusCode === 409;
  return {
    status: actionable ? "ACTION_REQUIRED" : "FAILED",
    stage: "discover",
    reason,
    message,
    failedCall: call.label,
    httpStatus: call.statusCode,
    requestPath: call.path,
    apiBaseUrl: SUBMISSION_API_BASE,
    bodyPrefix: call.rawBody.slice(0, 1000),
    ...(json?.details ? { details: json.details } : {}),
  };
}

/** Filter and sort exactly as the confirmation and Register expect. */
function selectableCategories(raw: any): { id: string; displayName: string; displayOrder: number }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (entry: any) =>
        entry &&
        typeof entry.id === "string" &&
        entry.id.length > 0 &&
        typeof entry.displayName === "string" &&
        entry.displayName.length > 0 &&
        !EXCLUDED_CATEGORY_NAMES.has(entry.displayName.trim().toLowerCase()),
    )
    .map((entry: any) => ({
      id: entry.id,
      displayName: entry.displayName,
      displayOrder: typeof entry.displayOrder === "number" ? entry.displayOrder : Number.MAX_SAFE_INTEGER,
    }))
    .sort((left, right) => left.displayOrder - right.displayOrder || left.id.localeCompare(right.id));
}

const OPERATION_RESULT = await (async (): Promise<any> => {
try {
  const auth = pluginSystem.findInterface(Editor.IAuthorization);
  if (!auth) {
    return {
      status: "ACTION_REQUIRED",
      stage: "discover",
      reason: "no_auth_interface",
      message: "Lens Studio authorization is unavailable. Sign in to Lens Studio, then retry.",
    };
  }
  if (!auth.isAuthorized) {
    return {
      status: "ACTION_REQUIRED",
      stage: "discover",
      reason: "not_signed_in",
      message: "Sign in to Lens Studio from the profile menu, then retry.",
    };
  }

  const project = pluginSystem.findInterface(Editor.Model.IModel).project;
  const projectPath = project.projectFile.toString();
  const projectText = FileSystem.readFile(project.projectFile);
  // Use live metadata so an unsaved user edit is never mistaken for an empty ID.
  const currentPackageId = String(project.metaInfo.packageId ?? readProjectScalar(projectText, "packageId")).trim();
  // Lens Studio's default "mylens" is invalid, as are other non-publishable IDs.
  const currentIdIsValid = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(currentPackageId) && currentPackageId.length <= 128;
  let packageId = currentIdIsValid ? currentPackageId : "";
  if (PROPOSED_PACKAGE_ID && currentIdIsValid && PROPOSED_PACKAGE_ID !== currentPackageId) {
    return { status: "ACTION_REQUIRED", stage: "discover", reason: "package_id_already_set",
      message: "The project already has a valid package ID. Publishing preserves valid existing IDs.", projectPath };
  }
  if (!packageId) {
    if (!PROPOSED_PACKAGE_ID && !/^[a-f0-9]{16}$/.test(PACKAGE_ID_NONCE)) {
      return { status: "ACTION_REQUIRED", stage: "discover", reason: "PKG_ID_REQUIRED",
        message: "Run begin-context to prepare a package ID for confirmation.", projectPath };
    }
    const slug = project.projectFile.fileNameBase.toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_").replace(/^[^a-z]+/, "").slice(0, 60) || "mylens";
    packageId = PROPOSED_PACKAGE_ID || `com.lens.${slug}.p${PACKAGE_ID_NONCE}`;
  }
  if (packageId.trim() !== packageId ||
      !/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(packageId) || packageId.length > 128) {
    return { status: "ACTION_REQUIRED", stage: "discover", reason: "invalid_package_id",
      message: "Package ID must contain at least two lowercase dot-separated segments, each starting with a letter, and at most 128 characters.",
      projectPath, packageId };
  }
  const currentPackageVersion = String(project.metaInfo.buildVersion ?? readProjectScalar(projectText, "packageVersion")).trim();
  const versionParts = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(currentPackageVersion);
  const currentVersionIsValid = Boolean(versionParts && versionParts.slice(1).every((part) => Number(part) <= 4294967295));
  // Check a replacement with the backend before proposing it; never mutate during discovery.
  const packageVersion = currentVersionIsValid ? currentPackageVersion : "1.0.0";

  const calls: CallOutcome[] = [];

  const publishContextPath =
    `/lenses/publish-context?pkgId=${encodeURIComponent(packageId)}` +
    `&pkgBuildVersion=${encodeURIComponent(packageVersion)}`;
  const publishContext = await authorizedGet("publish_context", publishContextPath);
  calls.push(publishContext);
  if (!publishContext.ok) {
    return { ...callFailure(publishContext), projectPath, packageId, packageVersion };
  }

  const availabilityData = publishContext.data?.availability;
  const storeListingReuse = publishContext.data?.storeListingReuse;
  if (!availabilityData || typeof availabilityData !== "object" || !storeListingReuse) {
    return {
      status: "FAILED",
      stage: "discover",
      reason: "invalid_publish_context",
      message: "The publish-context response omitted availability or store-listing reuse data.",
      failedCall: "publish_context",
      projectPath,
      packageId,
      packageVersion,
    };
  }

  const legalDocuments = publishContext.data?.legalDocuments;
  if (!legalDocuments || typeof legalDocuments !== "object") {
    return { status: "ACTION_REQUIRED", stage: "discover", reason: "legal_documents_unavailable",
      message: "Update the publish service to return legal-document readiness, then retry discovery." };
  }
  if (legalDocuments.requiredForPublicChannels === null) {
    return { status: "ACTION_REQUIRED", stage: "discover", reason: "legal_documents_unavailable",
      message: "Publish context did not resolve organization policy or return organization choices. Update the publish service and retry discovery." };
  }

  // Older responses must not be interpreted as a Lens with missing tiles.
  if (storeListingReuse.status === "available" &&
      !["existing", "missing"].includes(storeListingReuse.fields?.tileAssets)) {
    return {
      status: "ACTION_REQUIRED",
      stage: "discover",
      reason: "publish_context_tiles_unavailable",
      message: "The publish service must return storeListingReuse.fields.tileAssets. Update the service, then retry discovery.",
      projectPath,
      packageId,
      packageVersion,
    };
  }

  const categoryIsReusable =
    storeListingReuse.status === "available" && storeListingReuse.fields?.category === "existing";
  const shouldFetchCategories = FORCE_CATEGORY_FETCH === "true" || !categoryIsReusable;
  let rawCategories: any[] = [];
  if (shouldFetchCategories) {
    const categories = await authorizedGet("categories", "/categories");
    calls.push(categories);
    if (!categories.ok) {
      return { ...callFailure(categories), projectPath, packageId, packageVersion };
    }
    rawCategories = categories.data?.categories ?? [];
  }

  return {
    status: "DISCOVERED",
    stage: "discover",
    projectPath,
    packageId,
    currentPackageId,
    currentPackageVersion,
    packageVersion,
    publishContext: { data: publishContext.data },
    // Hand this straight to `publish-flow.py version-guard` as `availabilityResponse`.
    availability: { data: availabilityData },
    storeListingReuse,
    categories: rawCategories,
    selectableCategories: selectableCategories(rawCategories),
    calls: calls.map((call) => ({
      label: call.label,
      statusCode: call.statusCode,
      elapsedMs: call.elapsedMs,
    })),
  };
} catch (error) {
  return {
    status: "FAILED",
    stage: "discover",
    reason: "discover_threw",
    message: errorToString(error),
  };
}
})();

if (RESULT_PATH) {
  try {
    FileSystem.writeFile(new Editor.Path(RESULT_PATH), JSON.stringify(OPERATION_RESULT));
    return { status: "RESULT_PERSISTED", stage: "discover" };
  } catch {
    // ExecuteEditorCode still returns the exact result for the documented recovery path.
  }
}
return OPERATION_RESULT;
