<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Exceptions: asking, recovering, and failing

Read this **only** when a phase returns `ACTION_REQUIRED` or `FAILED`. Nothing here applies to a
healthy publish, which is why it is not in the always-loaded skill.

## Ask, don't stop

**Present every `ACTION_REQUIRED` prompt as a blocking question** using your runtime's ask facility, and wait for the answer (see Cross-runtime above). Don't substitute a vague free-form "let me know" and stall — give the user a clear reply contract (the option labels below). **If no human can answer in this run at all**, do not guess: STOP and emit the ordered checklist of what's needed — these are irreversible submit gates (see Cross-runtime).

Two exceptional prompt shapes (the normal publish-plan confirmation is defined above):

1. **User fixes something in Lens Studio UI** (project mismatch, sign-in needed, MCP unavailable, or a manual fallback after automatic Lens icon / signing-key setup fails). Ask one question with two options: **1. Done** (they completed the action — rerun the failing phase once; that phase is the readiness check) and **2. Cancel** (abort the publish; report the reason). Include the exact UI path. Do not use a fixed sleep as a substitute for checking the phase result.
2. **User picks from a list** (a user-requested category edit, `CATEGORY_REQUIRED`, `CATEGORY_INVALID`, `needs_metadata`, low-confidence category discovery, or `ORG_AMBIGUOUS`). For categories, reuse the cached selectable `data.categories[]` for an edit, or normalize fallback options from error `details.categories[]` / successful `data.details.categories[]`; exclude Featured/Favorites/Favourites and sort by `displayOrder`. Rerun `discover.ts` only if the edit cache is unavailable or stale, the organization changed, or a backend fallback contains no usable categories. For orgs, use `details.orgs[]`; save the chosen entry's ID as `orgId` and its name as `orgDisplayName`. Label choices with `"<one-based position>. <displayName>"`, clearly mark the current category for an edit, save the chosen ID and display name, rebuild/freeze the changed plan, and return to the consolidated confirmation. If this happens after Package, refresh `package-authorize` after confirmation but reuse the cached SPK and checksum.

If the same `ACTION_REQUIRED` reason returns after one retry, stop with the reason, `message`, and any `details` payload — don't loop.

| Reason | Shape | Ask the user to… | Then |
|--------|-------|------------------|------|
| `not_signed_in`, `no_auth_interface` | UI fix | sign in from the Lens Studio profile menu | rerun preflight |
| MCP / `ExecuteEditorCode` unavailable | UI fix | open/reconnect Lens Studio with the project using the runtime's MCP connection controls | retry the same pinned or generated script path |
| project mismatch (you detected) | UI fix | open the discovered `.esproj` | rerun preflight |
| `no_prod_signing_key` | consolidated plan | display keep/reuse/generate action in the single confirmation; ask separately only if confirmed automation fails | rerun preflight/package |
| `no_lens_icon` | consolidated plan | stage generation, display it in the single confirmation, and assign only after approval | rerun preflight |
| blank/default-`Untitled` Lens name | consolidated plan | propose/confirm a non-placeholder name, then run `set-lens-name.ts` | rerun preflight |
| `lens_name_too_long` | UI fix | rename the Lens to at most 30 characters in Lens Studio's Project Settings | rerun preflight and rebuild the confirmation |
| blank/invalid package ID (including `mylens`), `PKG_ID_REQUIRED` | consolidated plan | run session discovery to propose and check an ID | confirm before assigning through `set-package-id.ts` |
| `PKG_ID_UNAVAILABLE`, `invalid_package_id` | edit proposal | supply another valid replacement ID (this error concerns an explicit proposal, not the observed invalid ID) | restart context with `--package-id`, recheck availability and rebuild confirmation |
| `package_id_already_set`, `package_identity_changed` | refresh context | preserve a valid current ID or propose a replacement for an invalid ID; rebuild the plan | rerun Preflight and discovery; never overwrite a changed ID using stale confirmation |
| `final_review_required` | automatic recovery | run `prepare-final-review`, execute its fresh Preflight, then `record-final-review` | retry `authorize-package` with only the handle; no new confirmation unless review changed |
| `commerce_package_prefix_mismatch` | UI fix | correct Commerce Kit product IDs to use the confirmed package ID prefix | rerun the fresh Preflight and `record-final-review`; changed source requires a new review and confirmation |
| `package_id_api_unavailable`, `package_id_not_committed` | UI fix | set the confirmed ID in Project Settings → SPK Settings → Package ID, or use a build exposing the API | rerun Preflight and discovery |
| missing/malformed local `packageVersion` | consolidated plan | let discovery check `1.0.0` and use it or the backend’s higher suggestion | include the repair in confirmation; Package assigns and verifies it through the API |
| backend `invalid_package_version` | refresh context | recheck the proposal and backend response | rebuild the plan; never bypass availability validation |
| `build_version_api_unavailable`, `build_version_not_committed` | UI fix | set the confirmed Build Version in Project Settings → SPK Settings or use a build exposing the API | rerun context and rebuild confirmation |
| `package_authorization_mismatch` before Package export | UI fix | restore the confirmed project identity or keep the new value | rerun Preflight + discovery and rebuild the consolidated confirmation; the Package script refuses a Build Version mutation when the pre-mutation project path, Package ID, Lens name, or current version differs |
| `build_version_not_committed` from Package | UI fix | inspect **Project Settings → SPK Settings → Build Version** after the failed save | rerun Preflight + discovery and rebuild the consolidated confirmation from the authoritative project state; never guess whether the save landed |
| `SPK_BUILD_VERSION_NOT_INCREMENTED` when no usable suggestion exists | UI fix | set **Project Settings → SPK Settings → Build Version** to `nextAvailablePkgBuildVersion` or higher | rerun Preflight + availability, rebuild the consolidated confirmation, then Package; preserve unchanged staged preview media and never recapture it |
| `package_version_policy_unavailable` | UI fix | verify Lens availability is reachable for this account | rerun the availability check once; on repeat, stop before confirmation and Package rather than guessing |
| `ffmpeg_missing` (Preview screenshot or auto-video) | UI fix | install ffmpeg, then fully retry the applicable capture from `references/preview-image-capture.md` or `references/preview-video-capture.md` | retry once; on repeat, request a manually saved Preview screenshot path or cancel; never request a video |
| `preview_screenshot_unavailable`, `preview_screenshot_invalid`, `screenshot_staging_failed` | UI fix | provide a manually saved screenshot from the intended Lens Studio Preview, or cancel | never call `CapturePanelScreenshotTool` again; retry only deterministic staging against the retained direct-to-disk source, otherwise use the supplied screenshot path |
| `preview_count_invalid`, `preview_media_limit` | edit proposal | choose 2–10 previews with at least 1 image and at most 3 videos | prepare again with the chosen files |
| `preview_image_invalid`, `preview_video_invalid` | edit proposal | replace the named file: images at least 1080×1440; videos 3:4, at least 1080×1440, and 15–30 seconds | prepare again with the replacement |
| `preview_images_required` (auto video) | automatic recovery | n/a | run the screenshot flow with the requested image count in `references/preview-image-capture.md`, then prepare again |
| `SPK_ICON_MISSING` | UI fix | set a Lens icon in Lens Studio's Project Settings | rerun preflight, then package with a new Build Version and register again |
| `record_video_api_unavailable` (auto-video capture) | compatibility fallback | n/a | no Editor recording started; run the toolbar fallback once per `references/preview-video-capture.md` |
| `accessibility_permission`, `preview_recording_active`, `preview_recording_unavailable` (auto-video capture) | route, don't retry | n/a | discard any partial recording; stage the exactly-once Preview screenshot, switch to `auto_image`, and continue without asking |
| `unsupported_os` (toolbar fallback / promotional video) | route, don't retry | n/a — only the toolbar compatibility recorder and promotional-video generation are macOS-only | stage the exactly-once Preview screenshot when the compatibility recorder is needed; record the promotional-video skip for the successful final response |
| `INVALID_REQUEST` | UI fix or plan edit | correct the backend-identified field | rerun the relevant phase |
| `SPECS_ACCOUNT_REQUIRED` | UI fix | link/create their Specs account (open `details.setupUrl`) | retry `discover.ts` or register, cached SPK |
| `ORG_REQUIRED` | UI fix | create/join an org (open `details.setupUrl`) | retry `discover.ts` or register, cached SPK |
| `ORG_AMBIGUOUS` | pick from list | pick which org owns the submission from `details.orgs` | rerun `discover.ts` with `--set TENANT_ID=<orgId>`, rebuild/confirm the plan, refresh Package authorization, then register with the cached SPK |
| proactive category selection | consolidated plan | auto-propose the closest truthful category from `discover.ts` and display it for confirmation | first register includes `categoryId` |
| `CATEGORY_REQUIRED`, `CATEGORY_INVALID`, `needs_metadata` | pick from list | pick from error `details.categories` or successful `data.details.categories`, with a `discover.ts` rerun as the empty-payload fallback | rebuild/confirm the plan, refresh Package authorization, then retry register with the cached SPK |
| `FORBIDDEN` | pick from list (or UI fix) | pick another listed org, switch accounts, or get access | retry `discover.ts` or the register call |

For **`FAILED`**, surface `stage`, `reason`, `message`, `httpStatus`, `apiBaseUrl`, and `bodyPrefix` when present — backend validation messages are usually the fastest path to a fix.

## Lens legal documents

For `legal_documents_required`, direct the user to the SPECS Developer Portal → this Lens → **Settings → Legal documents**. Ask **1. Done** / **2. Cancel**. Use the registered `portalUrl` when available to locate the Lens; do not construct an internal service URL. The user supplies their Privacy Policy and Terms of Service as existing HTTPS links or text. Do not generate policies, copy another Lens's documents, use legacy `termsAndConditions`, or change the confirmed channel to bypass the requirement. Updating documents affects all Lens versions and channels, so a generic publish confirmation does not authorize changing them.

For `legal_documents_pending`, hosting did not finish within the session's bounded checks. Ask the user to wait for **Hosting complete** in Settings, or fix a failed revision, then choose **1. Done** / **2. Cancel**. For `legal_documents_unavailable`, show the returned HTTP status when present and ask them to verify access to that Lens's Settings; missing/malformed policy data is not an exemption.

After **Done**, repeat `authorize-finalize` → its Editor script → `record-finalize` with the same handle. The script rereads current readiness; a user's Done response alone never overrides it. Do not repeat Package, Register, or uploads, and do not discard the persisted submit state. A legal rejection from the submit API is saved with the specific `legal_documents_corrected` retry reason; that retry preserves completed metadata updates. A timeout, unrelated error, or unrecognized response is not evidence of a legal rejection and must follow the existing submit recovery rules.

If Finalize reports `legal_document_save_failed`, verify Lens Settings and write permission, then retry the same session only after the user resolves the issue. A partially successful save is reused by source equality. `legal_document_changed` means someone saved a different document after confirmation; do not replace it automatically. Review the Lens documents and rebuild confirmation if the intended inputs changed. No release should be submitted while these errors remain.
