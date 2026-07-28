---
name: specs-publish
description: >-
  Publish a Specs Lens through preflight, content-rating proposal, project signing-key setup, Lens icon generation, packaging, upload, and review submission. Use for publishing, submitting, releasing, or shipping a Specs Lens.
argument-hint: "[project path | .esproj]"
user-invocable: true
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Publish Lens

**User request:** $ARGUMENTS

Drive a Specs Lens from project → submitted for review. Be mechanical and fast: **carry state forward**, prepare one complete publish plan, ask one confirmation on the healthy path, and run the expensive export **once**. Preserve user-supplied values; propose only missing Lens/store metadata, content-rating answers, category, Lens icon, signing-key action, and preview-media behavior. Generate a new private key or persist generated project metadata only after the consolidated confirmation explicitly approves it. Ask additional questions only for an edit or a recoverable exception (sign-in, project/org ambiguity, moderation finding, invalid backend data, or failed automation) — never just halt.

## Cross-runtime (Claude Code / Cursor / Codex)

Apply this skill's two interactive primitives — the per-phase progress list and `ACTION_REQUIRED` blocking questions — by **intent**, not literal tool name. Tool naming, deferred schemas, and ask/spawn semantics: see `lens-studio-field-notes` Hard Rule 2 / Cross-runtime orchestration.

**Irreversible-submit hard stop:** if no human can answer in this run at all (fully non-interactive), the consolidated confirmation and each exceptional `ACTION_REQUIRED` gate an irreversible submission step or persistent project/private-key mutation, so **STOP and emit the full ordered checklist** of the prepared values and anything the user must fix (with the phase's `reason`/`message`). Never generate a signing key, assign generated metadata, register/upload/submit with unconfirmed values, or silently skip a gate.

### Number every user choice

Prefix every user-facing selection option with a one-based numeric prefix (`1.`, `2.`, `3.`, …), preserving the existing option order and wording. Apply this to static lists, `Done`/`Cancel` confirmations, moderation choices, and dynamically generated backend options; do not number non-choice lists. Prefix backend-provided choices after sorting them in their displayed order; preserve the selected backend ID separately from its numbered label.

Most phases run pinned scripts from this skill's `scripts/` directory. The must-be-exact logic (signing-key setup, Lens icon generation and assignment, production SPK export, authorized API calls) lives there — **run it, don't re-derive it.** Resolve each script by its full path under this skill (`<skill-dir>/scripts/…`): for a `.ts`, pass that path to `ExecuteEditorCode` as `path`; for a `.js`, run it with `node`; for a `.py`, run it with `python3`; for a `.sh`, run it with `bash`. Each script prints or returns one JSON object with a `status`; branch on it. `ACTION_REQUIRED` is an "ask, then retry" checkpoint, not a failure.

**Never `Read` a pinned `.ts` script to paste it into `ExecuteEditorCode` as `code`.** `preflight.ts` alone is ~28 KB; reading it and resending it costs that twice per call, for nothing. `path` makes the tool read the file itself, so the body never enters your context. Read a pinned script only when it has already failed and you are debugging it.

**Only load `ls-clad:editor-api` if a script fails to compile or execute** — these scripts are pre-written and don't need the contract loaded up front. Loading it pre-emptively costs an extra turn (~15–25 s) for no benefit on the happy path. If you do load it, debug per that skill and retry up to 3×.

## Phases & resources

| # | Phase | Does | Run |
|---|-------|------|-----|
| 1 | Discover | Resolve the `.esproj`; read `packageId` + `lensName` | read the project file (no LS needed) |
| 2 | Preflight | Confirm auth/open project, prepare missing metadata + content rating + category + icon + signing-key + preview plans, ask once, apply confirmed project changes, and expose moderation/Commerce Kit checks | `scripts/preflight.ts` + `scripts/set-lens-name.ts` + `scripts/signing-key.js` + `scripts/set-signing-key.ts` + `scripts/generate-lens-icon.py` + `scripts/set-lens-icon.ts` + `scripts/authorized-request.ts` + `scripts/get-preview-rect.ts` / `scripts/record-panel.sh` (auto-video plan only, per `references/preview-video-capture.md`) |
| 3 | Package | Save → export production SPK → checksum | `scripts/package.ts` — **as-is** |
| 4 | Publish | Register with the confirmed category/metadata, upload the SnapOS Package, apply the confirmed preview-media plan, and persist the confirmed age rating | `scripts/authorized-request.ts` (fill CONFIG) + `scripts/upload-spk.sh` + `scripts/upload-file.sh` |
| 5 | Submit | Submit the release for review | `scripts/authorized-request.ts` (fill CONFIG) |
| 6 | Marketing video | **Optional, post-submit.** Offer a shareable cover + preview-video clip with optional music | `scripts/build-marketing-video.sh` + `scripts/render-cover.swift`, per `references/marketing-video.md` |

`preflight.ts`, `package.ts`, and `get-preview-rect.ts` are **zero-config** — pass `path: "<skill-dir>/scripts/<name>.ts"` and nothing else. Run `signing-key.js` and `generate-lens-icon.py` from disk with their documented arguments.

`set-lens-name.ts`, `set-signing-key.ts`, `set-lens-icon.ts`, and `authorized-request.ts` take per-call values in a CONFIG block. Fill it with `scripts/make-eec-script.py`, which prints a temp path to pass as `path` — never edit these files on disk, and never hand-write the `const` lines:

```bash
python3 "<skill-dir>/scripts/make-eec-script.py" "<skill-dir>/scripts/set-lens-name.ts" \
  --set "LENS_NAME=<confirmed name>" --set "EXPECTED_PROJECT_PATH=<confirmed .esproj path>"
```

Pass values **raw** — the helper JSON-encodes them. Pasting them yourself is what breaks: a Lens name containing `"` makes invalid TypeScript, and a Windows path like `C:\Users\me\P.esproj` compiles cleanly while silently becoming `C:UsersmeP.esproj`. Set only what that call needs; anything you omit keeps the placeholder already in the file. A misspelled name fails immediately rather than running with an empty value. Delete the temp file once the call returns.

For object consts (`BODY`, `EXTRA_HEADERS`) use `--json NAME=FILE`, writing that file with your editor tool so free text never passes through the shell. `authorized-request.ts` takes `REQUEST_PATH`, `REQUEST_METHOD`, `BODY`, and optionally `TENANT_ID` / `EXTRA_HEADERS`; `REQUEST_METHOD` is `GET` for discovery, `POST` for register/upload/submit, `PUT` for version or review metadata:

```bash
python3 "<skill-dir>/scripts/make-eec-script.py" "<skill-dir>/scripts/authorized-request.ts" \
  --set "REQUEST_PATH=/lenses/publish" --set "REQUEST_METHOD=POST" --json "BODY=$BODY_JSON_FILE"
```

## Status reporting (visible to the user)

Seed a five-item progress list **before** running Discover so the phases stay visible throughout the run — on Claude Code via `TaskCreate` (see Cross-runtime for runtimes without a task tool):

1. Discover project
2. Preflight
3. Package (export SnapOS Package)
4. Publish (register + upload)
5. Submit for review

**Mark each phase `completed` only — skip the `in_progress` transition.** Phases here run in under a second each, so the intermediate `in_progress` tick doubles the TaskUpdate count for no real visibility gain. If a phase becomes `ACTION_REQUIRED`, *then* flip it to `in_progress` so the user can see it's blocked. On `FAILED`, leave the task `in_progress` and surface the failure in chat — don't mark it completed.

## Speed rules

Lean quiet here.

1. **Don't read the pinned scripts at all.** Every `.ts` in `scripts/` runs by `path`, and every `.js` / `.py` / `.sh` runs from disk, so none of them needs to enter context — not `preflight.ts`, not `package.ts`, not the setters, not `authorized-request.ts`, not `upload-spk.sh` / `upload-file.sh` / `signing-key.js` / `generate-lens-icon.py` / `record-panel.sh` / `build-marketing-video.sh` / `render-cover.swift`. There is no read-ahead batch to prepare; go straight to Preflight. The `.sh` scripts take documented arguments — get those from this skill, not by reading the script. Read a pinned script only to debug one that has already failed. Reference docs are different: read `references/preview-video-capture.md` only when the run stages an auto-generated preview video, and `references/marketing-video.md` only after Submit succeeds and the user opts in.
2. **One three-word label per logical action** — no full sentences, no "Let me…" / "Now I'll…". Emit a label exactly once, immediately before the primary pinned script or API call that performs that action. Do not repeat it for temporary-directory setup, file checks, dimension validation, normalization, moderation inspection, content-rating inspection, inline rendering, output parsing, or cleanup. Use exactly these labels (period included): `Preflight…`, `Assigning Lens name…`, `Checking signing key…`, `Generating signing key…`, `Assigning signing key…`, `Generating Lens icon…`, `Assigning Lens icon…`, `Exporting SnapOS Package…`, `Fetching store categories…`, `Registering release…`, `Uploading SnapOS Package…`, `Preparing preview media…`, `Registering preview media…`, `Uploading preview media…`, `Updating store media…`, `Saving age rating…`, `Submitting for review…`, `Generating marketing video…`. On the healthy path, each applicable label appears at most once. The last applies only to the optional post-submit marketing video. If a failed action is explicitly retried, use `Retrying <action>…` once instead of repeating its original label. Never label preview-media preparation, icon validation, or moderation inspection as **Generating Lens icon…**.
3. **No mid-flow result reports** — phases speak through the progress list (`TaskUpdate` on Claude Code), not chat. Never echo `lensId`, `releaseId`, `checksum`, `packageBytes`, or `spkPath` between phases. The label in rule #2 is the only chat output between phases — no follow-up sentence after the call returns. Allowed in chat (and only when genuinely required): a one-line `ACTION_REQUIRED` prompt the user must answer; a `FAILED` summary with `reason` / `message` / `httpStatus` when a phase errors out; the Discover line **"Submitting `<lensName>` (`<packageId>`)"** once after Discover; one inline rendering of the selected local Lens icon and available local preview media immediately before the consolidated confirmation; the final response after Submit returns `submitted`.
4. **In user-visible text (TaskList, chat, errors), call it a "SnapOS Package" — not "SPK".** "SPK" is correct for internal field names, script names (`upload-spk.sh`), and API protocol keys (`spkChecksum`, `data.uploads.spk`); leave those alone. Only the prose the user reads changes.

## State to carry

Track these as soon as they're known; resolve once, reuse everywhere. **Never re-export after a backend-only prompt** (org/category/account) — the cached SPK + checksum still stand.

- `esprojPath`: absolute `.esproj` path resolved in Discover.
- `packageId`: read from the `.esproj`; never invent it.
- `lensName`, `lensNameNeedsAssignment`: treat blank or trimmed case-insensitive `Untitled` as missing because `Untitled` is Lens Studio's default placeholder. Preserve any other non-empty project value; otherwise propose a validated, human-readable value from the `.esproj` filename and visible local context, then assign it only after confirmation.
- `spkPath`: absolute SPK path returned by package as `packagePath`.
- `cleanupPath`: same as `spkPath`; safe to delete after successful submit when `generatedPackage` is true.
- `generatedPackage`: `true` only for SPKs created by this run (never delete a user-provided SPK).
- `checksum`: base64 SHA-256 of the SPK, returned by package — reuse on every register retry.
- `packageBytes`: SPK size; internal/debug only, never in the final response.
- `signingKeyPlan`, `signingKeyPath`, `signingKeyFingerprint`: preserve a valid assigned key; otherwise plan the supplied key, a valid existing project-local key, or project-local generation only when the default path is missing. Never create a key until confirmation, and never read, print, copy, upload, or delete private-key contents.
- `lensIconDisplayPath`, `generatedLensIconTempDir`, `generatedLensIconPath`, `lensIconNeedsAssignment`, `generatedLensIconReady`, `lensIconPreviewState`: keep the selected Lens icon file path internal for validation and inline rendering. Set `generatedLensIconReady = true` only after one successful `ICON_GENERATED` result and validation. While true and the staged file remains valid, reuse it and never invoke the generator again. Set `lensIconPreviewState = "pending"` whenever `lensIconDisplayPath` is first set or changes; the media preview gate below must resolve it before confirmation. Stage a transient icon only when the project has the placeholder, and delete it immediately after assignment or abort. Never replace or delete an existing project icon.
- `releaseDescription`, `releaseTags`: preserve supplied values; otherwise generate truthful proposals. Treat the consolidated confirmation as their explicit approval.
- `contentRatingAssessment`, `targetAgeRating`, `contentRatingEvidence`, `contentRatingCoverage`: preserve supplied answers; otherwise propose every required Dev Dash answer from locally inspectable release metadata, source/configuration, and selected media by following `references/content-rating.md`. Keep paths and detailed evidence internal. `targetAgeRating` must be one of `4+`, `9+`, `13+`, `16+`, or `18+` and must always be recomputed from the complete proposed assessment.
- `previewMediaAssets`: optional store preview media chosen or generated for this run. Each item tracks `source` (`auto_image`, `auto_video`, `user_image`, `user_video`), absolute `path`, `type` (`image` or `video`), `checksum`, `bytes`, `previewIndex`, upload target, and final `url`.
- `previewMediaPlan`, `previewMediaDisplayPaths`, `generatedPreviewMediaTempDir`, `generatedPreviewMediaPath`, `previewMediaPreviewStates`: keep local media file paths internal for validation and inline rendering. Track each current display path as `"pending"` whenever it is added or changes; the media preview gate below must resolve every entry before confirmation. For an auto-image/auto-video plan or default image fallback, generate and validate the media in a temporary directory before confirmation, render it for approval when supported, upload it only after confirmation, and clean it up after use or abort. If rendering is unavailable, show only the containing preview-media directory or directories, never filenames/full paths.
- `existingReleaseMetadata`: full version metadata read before updating preview media; the version update replaces submitted metadata, so preserve every field you did not intentionally change.
- `orgId`, `orgDisplayName`, `semanticVersion`: only set `orgId` or `semanticVersion` after the user provided or chose it. Set `orgDisplayName` only when the backend returned a name for the chosen organization; otherwise leave it unset. Never invent an organization name.
- `selectableCategories`, `categoryId`, `categoryDisplayName`: keep the filtered, sorted selectable categories returned by `GET /categories`, and resolve the selected category before confirmation. Preserve a valid supplied ID; otherwise propose the closest truthful category from the Lens name, description, tags, and visible local context. Show only the selected display name in the normal confirmation; retain the full list for category edits and backend fallbacks.
- `localModerationInput`, `initialModerationFindings`: derive the moderation input from the current Preflight result plus the exact proposed metadata, selected/staged icon, and supplied/staged preview media. Save initial findings so the post-confirmation pass can identify only new or changed concerns.
- `publishPlanConfirmed`: false until the user chooses **Confirm and submit** for the displayed plan; no planned project mutation, package export, publish registration, upload, or submission may occur while false.
- `lensId`, `releaseId`: returned by publish/register; needed for upload and submit.
- `portalUrl`: returned by publish; surfaced in the final response.
- `uploadExpiresAt`: ISO 8601 expiry from `data.uploads.spk.expiresAt` — re-register if near expiry before uploading.

## 1 · Discover

- Resolve the `.esproj`: use `$ARGUMENTS` if it's a path; else the single `.esproj` in the cwd; else **ask** the user for the project (don't guess among several).
- Read `packageId:` and `lensName:` from the `.esproj` text. If `lensName` is blank or trimmed case-insensitive `Untitled`, treat it as missing and humanize the `.esproj` filename (split separators/camel case, remove generic suffixes only when the result remains meaningful, and title-case conservatively) as the initial proposal; do not edit the file directly. If `packageId` is blank, treat it as an exceptional UI fix because the skill must not invent ownership identifiers.
- Capture optional inputs only if the user supplied them: `orgId`, `categoryId`, `semanticVersion`, `releaseDescription`, `releaseTags`, content-rating answers, preview image/video paths, or a request to auto-generate preview media. Do not prompt for omitted description, tags, content-rating answers, category, icon, signing-key action, or preview-media behavior during Discover; leave them unset for the single-plan preparation below. Never invent an `orgId` or `semanticVersion`.

## 2 · Preflight

Run `scripts/preflight.ts` as-is.

Before branching on any Preflight `status` that includes `projectPath`, canonicalize and compare it with the discovered `esprojPath` (resolve symlinks and `..`, then compare exactly). If they differ, ask the user to open `esprojPath`, then rerun Preflight. **Do not generate or assign an icon, prompt for other project fixes, or continue until the paths match.**

- **`READY`** → keep `packageId`, `lensName`, `projectPath` and prepare the _Single publish confirmation_ below.
- **`ACTION_REQUIRED`** → treat a blank/default-`Untitled` `lensName`, `no_lens_icon`, and `no_prod_signing_key` as plan inputs, not immediate questions: prepare the Lens-name proposal, stage the temporary icon, and record the signing-key action. If `packageId` is also blank, or any unrelated issue remains, resolve it per **Ask, don't stop** before preparing the confirmation. Never present the three plannable items as separate questions unless the user chooses **Edit** or their confirmed automation fails.
- **`FAILED`** → surface `reason` + `message`.

Preflight includes `localAiModerationInput`. Treat it as internal agent context for the local moderation checkpoint. Do not echo project asset paths, including the selected Lens icon path; save the selected available `role: "icon"` path as `lensIconDisplayPath` only for internal validation and optional inline rendering. Preflight reports local image assets independently from Commerce Kit. If Commerce Kit is used, preflight reports product IDs passed to `queryProductDetails(...)` for package-prefix checking before Package.

### Prepare missing Lens name

Preserve a non-empty project Lens name unless it is trimmed case-insensitive `Untitled`. When it is blank or `Untitled`, set `lensNameNeedsAssignment = true` and propose a concise, non-placeholder name from the humanized `.esproj` filename plus visible local context. Do not mutate the project yet. Include the proposal in the consolidated confirmation.

After confirmation, run `scripts/set-lens-name.ts` with `LENS_NAME = lensName` and `EXPECTED_PROJECT_PATH = esprojPath`. Require `LENS_NAME_SET`. The setter validates through `Editor.Model.MetaInfo.isLensNameValid`, replaces only a blank name or Lens Studio's `Untitled` placeholder, refuses a generated `Untitled` value or overwriting any other non-empty name, verifies the active project again at mutation time, saves, and reads the committed value back. Treat `wrong_project_open`, `lens_name_already_set`, `default_lens_name`, or any validation failure as an exceptional prompt/failure; never edit `.esproj` text directly.

### Stage missing Lens icon

Only when Preflight reports `no_lens_icon`, set `lensIconNeedsAssignment = true`. Before creating anything, check the carried state: if `generatedLensIconReady` is true and `generatedLensIconPath` still exists, is readable, and is a 320×320 PNG, reuse it without emitting another generation label or running the generator. Otherwise create one fresh temporary directory with `mktemp -d`, emit **Generating Lens icon…** once, and run the deterministic local generator exactly once:

```bash
python3 "<skill-dir>/scripts/generate-lens-icon.py" \
  --project "<esprojPath>" --lens-name "<lensName>" \
  --output "<generatedLensIconTempDir>/lens-icon.png"
```

Require `ICON_GENERATED`, its returned 320×320 dimensions, and the expected absolute path. Save that path internally as `generatedLensIconPath` and `lensIconDisplayPath`, then set `generatedLensIconReady = true`. File validation, moderation inspection, inline rendering, category fetching, signing-key preparation, and confirmation assembly must reuse this staged file silently; none may call `generate-lens-icon.py` or emit **Generating Lens icon…**. Show **Auto-generate and assign a new Lens icon (no custom Lens icon is currently set)** in the consolidated confirmation; do not call `set-lens-icon.ts` before confirmation. When Preflight reports an existing icon, save its available `localAiModerationInput.assets[]` `role: "icon"` path internally as `lensIconDisplayPath`, set `generatedLensIconReady = false`, show **Use existing Lens icon**, and preserve it without asking or replacing it. Never add a Lens icon file/path row to the confirmation, even when the path is unavailable.

Regenerate only when the user edits the Lens name or icon plan in a way that changes the icon, or when the staged file is missing/invalid. Clean up the superseded temporary directory, set `generatedLensIconReady = false`, emit **Retrying Lens icon…** once, and create one replacement. Do not regenerate merely because Preflight, moderation, category discovery, confirmation rendering, or another helper step runs again.

After confirmation, emit **Assigning Lens icon…** once and run `set-lens-icon.ts` with the staged `ICON_PATH` and `EXPECTED_PROJECT_PATH`; do not generate a replacement first. On `ICON_SET`, set `generatedLensIconReady = false` and delete the temporary file/directory after Lens Studio copies it. On `wrong_project_open`, clean up and ask the user to open `esprojPath`; on any other failure, clean up and use the manual **Project Settings → Lens Icon** fallback. The confirmed generated icon must pass the same final local moderation check as a user-supplied icon.

### Plan missing production signing key

Preserve a valid assigned key. When Preflight reports `no_prod_signing_key`:

- If the publish request supplied an existing key path, validate it before confirmation with `signing-key.js --path`; require `SIGNING_KEY_READY`, save the resolved plan internally, and omit the signing-key row from the confirmation. Treat `SIGNING_KEY_MISSING` or `FAILED` as an exceptional correction before confirmation.
- Otherwise probe the default `<projectRoot>/specs_signing_key.pem` path before confirmation with `signing-key.js --project "<esprojPath>"` (without `--generate`):
  - **`SIGNING_KEY_READY`** → save its path/fingerprint, omit the signing-key row from the confirmation, and do not call `--generate` after confirmation.
  - **`SIGNING_KEY_MISSING`** → save its returned path and show **Auto-generate and assign a new project signing key at `<path>` (no key exists at this path)**. Do not run `--generate` yet.
  - **`FAILED`** → surface the invalid/unreadable existing-path failure as an exceptional correction before confirmation; never replace it.

When Preflight reports a valid key already assigned to the project, omit the signing-key row from the confirmation. Omit the row for every valid existing-key plan; show it only when the plan will auto-generate a new key, because that new private-key creation requires explicit confirmation. Do not add a secrecy, backup, or commit warning.

Choosing **Confirm and submit** is the explicit approval to execute the displayed signing-key plan. After confirmation, run `signing-key.js --generate --project "<esprojPath>"` only for the confirmed **Auto-generate and assign a new project signing key** plan (accept `created: false` concurrency success); for either use-existing plan, reuse the already validated `signingKeyPath` without calling `--generate`. Save the result's path/fingerprint and run `set-signing-key.ts`. Never overwrite, regenerate, print, upload, copy, delete, or silently chmod a private key. If generation/validation/assignment fails, offer the existing-key or manual **Project Settings → SPECS Settings → Signing Key** recovery as an exceptional prompt; do not generate another key.

### Prepare release metadata

Preserve a supplied description/tags before fetching categories; otherwise generate a truthful, non-promotional description of at least 10 characters and 1–3 tags from the Lens name, package ID, project name, and visible local context. Save the results as `releaseDescription` and `releaseTags`. Normalize tags (one leading `#`, case-insensitive dedupe, at most 10) and prefer: `#Outdoors`, `#Active`, `#Offline Mode`, `#Beginner Lenses`, `#Educational`, `#Tabletop`, `#Productivity`, `#Wellness`, `#Holiday`, `#Travel`, `#Creative`, `#World-Based`, `#Watch`, `#Music`, `#Lifestyle`, `#Tools`, `#Developer Tool`, `#Mobile Controller`, `#AI`, `#Snapchat`, `#Voice Input`, `#Location-Based`.

### Fetch and propose category

After `releaseDescription` and `releaseTags` are prepared, run `authorized-request.ts` with:

```ts
const REQUEST_PATH = "/categories";
const REQUEST_METHOD = "GET";
const BODY = {};
const TENANT_ID = "<orgId or ''>";
```

- **`AUTHORIZED_POST_OK`** (the wrapper's legacy success name also applies to GET) → read `data.categories`. Keep entries whose `id` and `displayName` are non-empty, exclude trimmed case-insensitive `featured`, `favorites`, and `favourites`, then sort by ascending `displayOrder` and save the result as `selectableCategories`.
  - If a supplied `categoryId` matches a selectable returned ID, preserve it.
  - Otherwise select the closest truthful match from `lensName`, `releaseDescription`, `releaseTags`, and visible project context. Save its ID and display name for the single confirmation; do not ask a separate category question.
  - If no returned category is plausible or usable, treat it as an exception and ask the user to choose from the sorted list before showing the consolidated confirmation. Never invent an ID.
- **`ACTION_REQUIRED`** → handle per **Ask, don't stop**. If choosing an org resolves the issue, retry the category fetch with `TENANT_ID = orgId`.
- **`FAILED`** → surface the failure and stop before Package.

### Prepare content rating

Read `references/content-rating.md` now. After the preview-media plan below has selected and staged its media, preserve answers supplied in the publish request and auto-propose every missing severity/capability answer from the exact release metadata, selected/staged icon and preview media, locally inspectable project assets and source/configuration/packages, and Preflight moderation/Commerce Kit signals. Do not ask a separate questionnaire on the healthy path. Save the complete result as `contentRatingAssessment`, record short path-free rationales for non-default answers as `contentRatingEvidence`, record any incomplete local inspection as `contentRatingCoverage`, and compute `targetAgeRating` with the reference's exact maximum-rating table.

Require all eight severity answers, all seven top-level capability answers, and each applicable dependent answer. Validate every answer and require `targetAgeRating` to be one of `4+`, `9+`, `13+`, `16+`, or `18+`. Never use an unconfirmed existing release rating as a substitute for the assessment and never silently default to `4+`.

### Single publish confirmation

Assemble the prepared values/actions into the entire plan before Package or any persistent planned mutation:

1. Use `releaseDescription` and `releaseTags` prepared by **Prepare release metadata**.
2. Use the category ID and display name prepared by **Fetch and propose category**. The confirmation, not a separate category picker, approves this proposal. Show only `categoryDisplayName`; do not append the complete category list or backend category IDs. Keep `selectableCategories` cached for **Edit** and backend fallbacks. Display `releaseTags` as a comma-separated list rather than a JSON array.
3. Set `previewMediaPlan` to supplied media paths or an explicit auto-image/auto-video request, and validate available inputs/capabilities with the rules below before showing the confirmation. For supplied media, save every absolute path internally in `previewMediaDisplayPaths` without printing it. For an explicit auto-image/auto-video plan, create a fresh temporary directory and capture the requested media before confirmation at `generatedPreviewMediaPath = <generatedPreviewMediaTempDir>/preview-image.png` or `<generatedPreviewMediaTempDir>/preview-video.mp4`. Capture an auto video per `references/preview-video-capture.md` — its screen-recording flow makes ffmpeg and macOS Screen Recording permission hard prerequisites of that plan, its `ACTION_REQUIRED` results are exceptional corrections before confirmation, and the whole capture stays under the single `Preparing preview media…` label. **auto_video is macOS-only**; on a non-macOS host the script returns `unsupported_os` — do not retry it, and fall back to manual-record or (preferably) the OS-independent `auto_image` plan. When the user set no preview-media input or preference, stage the same auto-generated image as a fallback. Existing store preview media may not be addressable until registration returns `lensId`/`releaseId`; preserve it if found after registration, otherwise use the staged fallback. Keep that unavailable-before-registration detail internal and do not add it as a moderation-coverage row. Generating the fallback early is allowed even if it is later discarded unused. Normalize and validate staged media before confirmation using the **Store preview media plan** rules; auto-generated preview media must be portrait 3:4 (`width / height = 3 / 4`) and no larger than 960×1280, and an auto-generated video additionally at most 30 seconds. Save the staged path internally in `previewMediaDisplayPaths`. If capture, normalization, or validation fails, ask the exceptional correction before confirmation. Never add preview-media file/path rows, and never upload, attach, or replace store media before confirmation.
4. Use the complete proposed assessment from **Prepare content rating** and render every answer in the sectioned Markdown format from `references/content-rating.md`. Put the entire content-rating section after the Lens details, assets, organization, and submission action. Show `targetAgeRating`; include **Content-rating rationale:** only for non-default answers and **Content-rating coverage:** only when inspection was incomplete. Do not print paths or a long evidence audit.
5. Build `localModerationInput` exactly as defined by `references/moderation.md`: start from a copy of the current Preflight `localAiModerationInput`, replace `releaseText` with the proposed Lens name, description, tags, and category display name, replace its `role: "icon"` entry with the selected existing/staged icon when locally available, and append every supplied/staged preview file as `role: "preview_media"`. Apply `references/moderation.md`, save the result as `initialModerationFindings`, and include any finding or incomplete-media-coverage note in this same confirmation under the exact optional labels **Moderation advisory:** and **Moderation coverage:**. Relabel the first choice **Confirm and submit anyway** when there is a finding. Do not open a separate initial moderation question.

### User-visible media preview gate

Resolve this gate immediately before opening the blocking confirmation. The confirmation ask is text-only in some runtimes, so emit all available inline media together in one separate, ordinary user-visible assistant message directly before the ask; do not put media inside the blocking question or assume an image-view tool result is visible to the user.

For `lensIconDisplayPath` and every local image/video in `previewMediaDisplayPaths`, including staged fallback media:

1. If the runtime supports user-visible local media, emit one message using this exact structure, omitting only unavailable sections and repeating the numbered preview-media attachment for each file:

   ```markdown
   ### Publish asset previews

   **Lens icon**

   ![Lens icon](</absolute/path/to/lens-icon.png>)

   **Preview media**

   ![Preview media 1](</absolute/path/to/preview-media-1.png>)
   ```

   Substitute the real path and keep it angle-wrapped inside the hidden Markdown target so spaces render correctly. Never print a path as visible label, caption, or prose. Render images and videos with the runtime's supported local-media attachment syntax. Emit the message directly before the blocking ask with no intervening status text. After the message is actually forwarded to the user, set the corresponding state to `"rendered_to_user"`. A local file read, moderation inspection, image-view call whose result is not forwarded, successful generation/validation, or text claiming the asset was “previewed” does **not** count.
2. If user-visible rendering is unsupported or the emitted render fails, set its state to `"directory_fallback_required"` and include the corresponding fallback row in the confirmation: **Lens icon preview directory:** `<dirname(lensIconDisplayPath)>` and/or **Preview media directory:** `<deduplicated dirname values from previewMediaDisplayPaths>`. Show directories only—never the temporary filename or full file path.

Do not open the confirmation while `lensIconPreviewState` or any current `previewMediaPreviewStates` entry is `"pending"`. Before invoking the blocking ask, assert that every current asset is either `"rendered_to_user"` or `"directory_fallback_required"`, and that every required directory row is present in the ask body. Keep `publishPlanConfirmed = false` if the assertion fails. Omit directory rows only for assets whose state is `"rendered_to_user"`. Do not render unrelated moderation assets.

Present exactly one blocking question with this Markdown body. Keep the section order and blank lines; omit optional bullets or sections only when instructed:

```markdown
## Ready to publish

### Lens details

- **Lens name:** <lensName>
- **Description:** <releaseDescription>
- **Tags:** <comma-separated releaseTags>
- **Category:** <categoryDisplayName>
- **Organization:** <orgDisplayName; omit this bullet when unavailable>

### Assets and submission

- **Lens icon:** <Use existing Lens icon | Auto-generate and assign a new Lens icon (no custom Lens icon is currently set)>
- **Lens icon preview directory:** <containing directory; include only when inline icon rendering is unavailable>
- **Preview media:** <Use supplied preview media | Use this staged auto-generated preview image/video | Preserve existing store preview media if found; otherwise use the staged fallback image>
- **Preview media directory:** <containing directory or directories; include only when inline preview rendering is unavailable>
- **Signing key:** <Auto-generate and assign a new project signing key at path (no key exists at this path); omit for every existing-key plan>
- **Action:** Submit this release for review

<insert the complete sectioned Content rating block from references/content-rating.md here>

### Review advisory

- **Moderation advisory:** <category — field or asset: concise rationale>
- **Moderation coverage:** <concise incomplete-coverage notes>
```

Omit the **Organization** bullet when `orgDisplayName` is unavailable, including the normal single-organization auto-resolution path; never show a generic “automatically resolved” placeholder. Omit the entire **Review advisory** section when both moderation rows are unavailable. Do not collapse content-rating questions onto semicolon-separated lines or move the content-rating section above Lens details or assets.

Options:

1. **Confirm and submit** → set `publishPlanConfirmed = true`; this explicitly approves every displayed generated value/action and the irreversible review submission. Apply the confirmed Lens name, icon, and signing-key actions in that order, rerun Preflight, run final local moderation, then continue through Package → Publish → Submit without metadata/category/preview questions.
2. **Edit** → ask one concise free-form question for the changes, update only the requested values/actions, refresh dependent proposals (for example content rating, icon/category/preview media after a name or media change), reset the preview state of every changed/replaced media path to `"pending"`, and show this same consolidated confirmation again only after the user-visible media preview gate passes. Clean up any superseded staged preview-media directory before regenerating. Do not fan out into one question per field. For a content-rating edit, accept one or more question-label/answer changes, validate them against `references/content-rating.md`, add or remove dependent answers, recompute `targetAgeRating`, and show every answer again. If the requested change is the category, immediately show the selectable categories cached by **Fetch and propose category**, in their filtered/sorted order, as numbered choices with the current category clearly marked. Save the chosen ID and display name, then return to the consolidated confirmation. Refetch `GET /categories` only when the cached list is unavailable or stale, or when the organization changed; apply the same filtering and sorting rules to the refreshed list.
3. **Cancel** → abort without persistent planned mutations and clean up all staged temporary files, including generated preview media.

If no human can answer, print the complete plan and stop. Keep `publishPlanConfirmed = false`. Never interpret the original generic “publish” request as confirmation of generated values, a new private key, or submission.

After confirmation and the planned project setters, rerun Preflight and rebuild `localModerationInput` from the new result with the same final Lens name, `releaseDescription`, `releaseTags`, `categoryDisplayName`, selected icon, and confirmed preview-media files. The moderation checkpoint and `/lenses/publish` must review/use exactly those values. Compare the new findings with `initialModerationFindings`; only a new or changed finding may trigger the exceptional moderation question before Package. Re-evaluate content-rating evidence against the same final inputs. If an answer or `targetAgeRating` would change, do not change it silently: set `publishPlanConfirmed = false`, update the proposal, and show the consolidated confirmation again before Package.

## 3 · Package

Run `scripts/package.ts` as-is. This is the expensive phase — run it **once**.

**If the RPC times out (rare), do not re-export blindly.** The export is synchronous and the timeout lives in `ExecuteEditorCode`, not in the editor itself, so the SPK may already be on disk. Fall back to:

1. `ls "<projectDir>/.export/<projectFileBase>.spk"` — confirm the file exists.
2. Hash it twice ~3s apart with `shasum -a 256` to confirm the file is **stable** (size + digest unchanged between reads). If it's still being written, wait and recheck.
3. Compute the base64 SHA-256 (`shasum -a 256 -b … | awk '{print $1}' | xxd -r -p | base64`) and reuse it as the `checksum`. Set `spkPath`, `cleanupPath`, `packageBytes`, `generatedPackage: true` from disk, then continue to Publish — **don't** re-run `package.ts`.

Only re-run `package.ts` if the SPK is missing or never stabilizes.

- **`EXPORTED`** → save `spkPath` = `packagePath`, plus `cleanupPath`, `checksum`, `packageBytes`, `generatedPackage: true`. Go to Publish.
- **`ACTION_REQUIRED`** (`no_prod_signing_key`, `pending_tasks_unavailable`) → `no_prod_signing_key` means the confirmed signing-key automation did not persist; surface both results and use the exceptional recovery path without creating another key. Handle the other reason per **Ask, don't stop**.

## 4 · Publish (register + upload)

Use the confirmed `categoryId` for the first register request. After **Confirm and submit**, do not fetch categories again unless the backend rejects the confirmed ID as stale/invalid.

**4a — Register.** Run `authorized-request.ts` with:

```ts
const REQUEST_PATH = "/lenses/publish";
const REQUEST_METHOD = "POST";
const BODY = {
  pkgId: "<packageId>",
  name: "<lensName>",
  spkChecksum: "<checksum>",
  categoryId: "<categoryId>",
  // add ONLY if set:
  description: "<releaseDescription>",
  tags: <releaseTags>,
};
// add ONLY if set: orgId, semanticVersion
const TENANT_ID = "<orgId or ''>";
```

- **`AUTHORIZED_POST_OK`** → inspect `data.status`:
  - `needs_uploads` → keep `lensId`, `releaseId`, `portalUrl`, and `data.uploads.spk` (`.url` + `.headers` + `.expiresAt`). Go to 4b.
  - `needs_metadata` → read category fallback options from `data.details.categories`, then apply the fallback flow below.
  - terminal/other → surface the status and useful IDs; don't guess the next mutation.
- **`ACTION_REQUIRED`** → for `CATEGORY_REQUIRED` or `CATEGORY_INVALID`, read category fallback options from `details.categories`, then apply the fallback flow below. Handle other reasons per **Ask, don't stop**, then retry register with the cached SPK + checksum.

For a category fallback, normalize whichever response shape applies: `details.categories` for an error response or `data.details.categories` for successful `needs_metadata`. Filter and sort it with the same selectable-category rules as discovery, ask the user to confirm a replacement category, save the new `categoryId`, and retry register with the **cached** SPK + checksum. If that payload has no usable categories, refetch `GET /categories` with the current `orgId`. Treat the backend response as authoritative if the confirmed category became stale or invalid; do not re-export.

**4b — Upload.**

**Before invoking `upload-spk.sh`, check `uploadExpiresAt`.** If `Date.parse(uploadExpiresAt) - Date.now() < 60_000` (less than ~60 s until the signed URL expires — usually because the user took a long time answering a blocking question between register and here), **re-register first** to get a fresh upload target. Reuse the cached SPK + checksum on the re-register; do not re-export. If `uploadExpiresAt` is absent (older backend), skip the check.

Then run `scripts/upload-spk.sh` with:

```bash
SPK_PATH="<spkPath>" UPLOAD_URL="<data.uploads.spk.url>" \
UPLOAD_HEADERS_JSON='<data.uploads.spk.headers as JSON>' SPK_CHECKSUM="<checksum>" \
bash scripts/upload-spk.sh
```

Pass the upload URL and headers directly as environment variables. Do not write presigned upload URLs, upload headers, checksums, or SPK paths to temp files just to work around quoting.

- **`UPLOAD_DONE`** → apply the confirmed _Store preview media plan_ below, persist the confirmed age rating, then go to Submit.
- **`ERROR: SnapOS Package checksum changed since publish registration`** → the exported SnapOS Package changed after registration. Rerun Package once, then rerun Register with the new checksum and upload URL. Do not reuse the old upload URL.

### Store preview media plan

Do not ask another preview-media question. Read the current version metadata (or use a returned full metadata object), then apply the confirmed `previewMediaPlan`:

1. If the original request supplied preview image/video paths, use exactly those confirmed files. Do not auto-generate additional media.
2. If the original request explicitly requested auto-generated media, reuse exactly the staged, confirmed `generatedPreviewMediaPath`; do not capture or generate it again.
3. Otherwise, if `existingReleaseMetadata.default.previewAssets` contains any image or video, preserve it, do not upload the staged fallback, and clean up its unused preview-media output directory.
4. Otherwise reuse exactly the staged, confirmed fallback image at `generatedPreviewMediaPath`; do not capture or generate it again. Add it as `type: "image"`, `source: "auto_image"`.

Validate supplied/created media before registering uploads:

- The file exists and is readable.
- Keep at most 8 images and 2 videos. If the user supplies more, ask which ones to keep.
- Keep each file at or under 100 MB.
- For videos, verify duration is 30 seconds or less when a local probe tool is available; if duration cannot be checked, warn once and ask whether to continue with that file.
- For auto-generated media, verify exact 3:4 orientation and maximum 960×1280 dimensions after normalization; an auto-generated video's `VIDEO_READY` result already reports validated dimensions and duration, so do not re-probe it.

Submit does not attach preview image/video payloads. Store preview media must be uploaded and patched into release metadata first.

For each selected preview file:

1. Compute its base64 SHA-256 checksum and byte size, then assign a zero-based `previewIndex`.
2. Register a preview upload with `authorized-request.ts`:

```ts
const REQUEST_METHOD = "POST";
const REQUEST_PATH = "/apps/upload";
const BODY = {
  appId: "<lensId>",
  versionId: "<releaseId>",
  contentType: "prv",
  expireIn: 3600,
  checksum: "<previewChecksum>",
  checksumAlgo: "SHA256",
  previewIndex: <zeroBasedPreviewIndex>,
  fileType: "<image|video>",
};
const TENANT_ID = "<orgId or ''>";
```

3. Save the returned signed URL and required headers on the matching `previewMediaAssets` entry. Backends may name the upload headers `data.requiredHeaders` or `data.headers`; use whichever is present. The upload endpoint does not return the final content URL; derive it from the presigned upload URL using the same shape as Dev Dash:

```ts
const previewS3Key = new URL(data.url).pathname.slice(1);
const previewDownloadUrl = `/v1/apps/content/download?key=${encodeURIComponent(previewS3Key)}`;
```

4. Upload the file bytes with `upload-file.sh`:

```bash
FILE_PATH="<previewPath>" UPLOAD_URL="<data.url>" \
UPLOAD_HEADERS_JSON='<data.requiredHeaders or data.headers as JSON>' FILE_CHECKSUM="<previewChecksum>" \
bash scripts/upload-file.sh
```

The upload script also prints `downloadUrl`; it should match the derived `previewDownloadUrl`. Uploads do not automatically attach themselves to the release metadata. After all preview files return `UPLOAD_DONE`, read the current version metadata (or use an already returned full metadata object for this version), merge only the preview asset changes, then PUT the full metadata object through the version update endpoint:

```ts
const REQUEST_METHOD = "PUT";
const REQUEST_PATH = `/apps/${lensId}/versions/${releaseId}`;
const BODY = {
  metadata: {
    ...existingReleaseMetadata,
    default: {
      ...existingReleaseMetadata.default,
      previewAssets: {
        ...existingReleaseMetadata.default?.previewAssets,
        [previewIndex]: { url: "<previewDownloadUrl>", type: "<image|video>" },
      },
    },
  },
};
// metadata.default.previewAssets must include every preview asset that should remain visible.
const TENANT_ID = "<orgId or ''>";
```

The version update endpoint replaces the submitted metadata object. Preserve `description`, `tags`, localized metadata, and every existing field unless the user explicitly changed it during this publish run. After successfully attaching a generated preview **image**, delete only `generatedPreviewMediaTempDir`. For a generated preview **video**, retain `generatedPreviewMediaTempDir` through Submit so phase 6 can reuse `generatedPreviewMediaPath`; clean it up only after the marketing-video decision/build no longer needs the source. If the flow exits before phase 6, clean up the retained generated-video directory before returning. Never delete supplied media.

### Persist confirmed age rating

After the confirmed preview-media plan is complete, emit **Saving age rating…** once and run `authorized-request.ts` with the confirmed, recomputed `targetAgeRating`:

```ts
const REQUEST_METHOD = "PUT";
const REQUEST_PATH = `/apps/${lensId}/versions/${releaseId}`;
const BODY = {
  reviewMetadata: {
    targetAgeRating: "<targetAgeRating>",
  },
};
const TENANT_ID = "<orgId or ''>";
```

Require `AUTHORIZED_POST_OK`. The endpoint performs a partial review-metadata merge, so omitted privacy-policy and declared-permission fields remain unchanged. On `ACTION_REQUIRED` or `FAILED`, surface the result and do not submit. Never persist the individual questionnaire answers and never send an empty, unconfirmed, or out-of-range rating.

## 5 · Submit

Do not send preview image, preview video, or content-rating fields to this endpoint. The submit endpoint only transitions the chosen release into review; store media and `reviewMetadata.targetAgeRating` must already be persisted before this step.

Run `authorized-request.ts` with:

```ts
const REQUEST_PATH = `/lenses/<lensId>/submit`;
const REQUEST_METHOD = "POST";
const BODY = { releaseId: "<releaseId>", wait: true, maxWaitMs: 180000, pollIntervalMs: 1000 };
const TENANT_ID = "<orgId or ''>";
```

- **`AUTHORIZED_POST_OK`** → inspect `data.status`:
  - `submitted` → if `generatedPackage`, `rm -f "<cleanupPath>"` **and** `rmdir "$(dirname "<cleanupPath>")" 2>/dev/null || true` to remove the now-empty `.export/` directory (`rmdir` is non-destructive — it leaves the dir alone if the user has other files there). Never delete a user-provided SPK. Report success.
  - `validating` → report `retryAfterSeconds` and `data.wait`; don't start your own polling loop unless asked.
  - other → report the status and the next required action.

## 6 · Marketing video (optional, post-submit)

Only after Submit returns `submitted`. This is an optional, non-uploaded local deliverable — it never gates or blocks the (already complete) submission. Follow `references/marketing-video.md`: offer the one blocking question defined there (cover + preview video; no music by default, or the user supplies their own track). **Do not generate music.** On decline, or if no human can answer in a non-interactive run, skip silently and go straight to the Final response.

If the user opts in, add a sixth **Generate marketing video** task to the progress list at that point (it is not part of the initial five-item seed). Reuse this run's preview video and — when locally available — the selected `lensIconDisplayPath`; emit `Generating marketing video…` once and run `scripts/build-marketing-video.sh` as documented. Marketing video is **macOS-only** (the cover renders via CoreText); on a non-macOS host the script returns `unsupported_os` — don't offer or attempt it, just proceed to the Final response. A `FAILED` marketing-video build is a non-fatal follow-up (the release is already submitted) — report it and still give the normal success Final response. On every phase-6 exit — decline, non-interactive skip, unsupported OS, no usable source video, build success, or build failure — delete a retained `generatedPreviewMediaTempDir` only after the source video is no longer needed. Never delete a user-supplied preview video.

## Local moderation preflight (advisory)

Read `references/moderation.md` while preparing the single confirmation and follow its derived-input contract. The initial pass must inspect the exact proposed release metadata and every locally available selected/staged icon and preview-media file. A clear initial finding belongs in the consolidated confirmation; change option 1 to **Confirm and submit anyway** and state that the review queue remains authoritative.

After confirmation and the planned setters, rerun Preflight, rebuild the derived input with the same final metadata and confirmed media, and rerun moderation before Package. A finding already shown and explicitly approved does not require a second question; only a new/different finding is an exceptional prompt with **Fix and recheck**, **Submit anyway**, and **Cancel**. If the original request asks for checks only/no submit, stop after reporting the result instead of showing the publish confirmation.

Do not duplicate policy outside `references/moderation.md`. While moderation is active, do not make unconfirmed edits to source files, assets, product IDs, Lens metadata, icons, signing keys, or project settings.

## Ask, don't stop

**Present every `ACTION_REQUIRED` prompt as a blocking question** using your runtime's ask facility, and wait for the answer (see Cross-runtime above). Don't substitute a vague free-form "let me know" and stall — give the user a clear reply contract (the option labels below). **If no human can answer in this run at all**, do not guess: STOP and emit the ordered checklist of what's needed — these are irreversible submit gates (see Cross-runtime).

Two exceptional prompt shapes (the normal publish-plan confirmation is defined above):

1. **User fixes something in Lens Studio UI** (project mismatch, sign-in needed, MCP unavailable, or a manual fallback after automatic Lens icon / signing-key setup fails). Ask one question with two options: **1. Done** (they completed the action — sleep 2s via Bash, then rerun the failing phase once) and **2. Cancel** (abort the publish; report the reason). Include the exact UI path.
2. **User picks from a list** (a user-requested category edit, `CATEGORY_REQUIRED`, `CATEGORY_INVALID`, `needs_metadata`, low-confidence category discovery, or `ORG_AMBIGUOUS`). For categories, reuse the cached selectable `data.categories[]` for an edit, or normalize fallback options from error `details.categories[]` / successful `data.details.categories[]`; exclude Featured/Favorites/Favourites and sort by `displayOrder`. Refetch `GET /categories` only if the edit cache is unavailable or stale, the organization changed, or a backend fallback contains no usable categories. For orgs, use `details.orgs[]`; save the chosen entry's ID as `orgId` and its name as `orgDisplayName`. Label choices with `"<one-based position>. <displayName>"`, clearly mark the current category for an edit, save the chosen ID and display name, and return to the consolidated confirmation unless this is a stale-category retry after Package.

If the same `ACTION_REQUIRED` reason returns after one retry, stop with the reason, `message`, and any `details` payload — don't loop.

| Reason | Shape | Ask the user to… | Then |
|--------|-------|------------------|------|
| `not_signed_in`, `no_auth_interface` | UI fix | sign in from the Lens Studio profile menu | rerun preflight |
| MCP / `ExecuteEditorCode` unavailable | UI fix | open/reconnect Lens Studio with the project — if `/mcp` shows `lens-studio` failed, choose **Reconnect**, not **Authenticate** | retry the same code |
| project mismatch (you detected) | UI fix | open the discovered `.esproj` | rerun preflight |
| `no_prod_signing_key` | consolidated plan | display keep/reuse/generate action in the single confirmation; ask separately only if confirmed automation fails | rerun preflight/package |
| `no_lens_icon` | consolidated plan | stage generation, display it in the single confirmation, and assign only after approval | rerun preflight |
| blank/default-`Untitled` Lens name | consolidated plan | propose/confirm a non-placeholder name, then run `set-lens-name.ts` | rerun preflight |
| blank package ID, `PKG_ID_REQUIRED`, `PKG_ID_UNAVAILABLE` | UI fix | set a package ID they own | rerun preflight/package |
| `no_screen_recording_permission`, `panel_offscreen`, `ffmpeg_missing` (auto-video capture) | UI fix | apply the matching fix from `references/preview-video-capture.md` | retry the capture once; on repeat, use its manual-record fallback |
| `unsupported_os` (auto-video / marketing on non-macOS) | route, don't retry | n/a — auto-video capture and marketing video are macOS-only | fall back to `auto_image` or manual-record for the preview; skip the marketing video |
| `INVALID_REQUEST` | UI fix or plan edit | correct the backend-identified field | rerun the relevant phase |
| `SPECS_ACCOUNT_REQUIRED` | UI fix | link/create their Specs account (open `details.setupUrl`) | retry the current category-fetch/register call, cached SPK |
| `ORG_REQUIRED` | UI fix | create/join an org (open `details.setupUrl`) | retry the current category-fetch/register call, cached SPK |
| `ORG_AMBIGUOUS` | pick from list | pick which org owns the submission from `details.orgs` | retry the current category-fetch/register call with `orgId` + `TENANT_ID` |
| proactive category selection | consolidated plan | auto-propose the closest truthful selectable category and display it for confirmation | first register includes `categoryId` |
| `CATEGORY_REQUIRED`, `CATEGORY_INVALID`, `needs_metadata` | pick from list | pick from error `details.categories` or successful `data.details.categories`, with `GET /categories` as the empty-payload fallback | retry register with `categoryId` |
| `FORBIDDEN` | pick from list (or UI fix) | pick another listed org, switch accounts, or get access | retry the current category-fetch/register call |

For **`FAILED`**, surface `stage`, `reason`, `message`, `httpStatus`, `apiBaseUrl`, and `bodyPrefix` when present — backend validation messages are usually the fastest path to a fix.

## Final response

One short message. Report `<lensName>` submitted, plus `packageId` and `portalUrl` (when present), and `releaseVersion` only when the API returned one. **Do not** recap the phases — the TaskList is the status display. **Do not** mention SPK cleanup, file paths, or any other internal mechanics. Keep `spkPath`, `checksum`, `packageBytes`, `lensId`, and `releaseId` out unless the user asks for debug detail. If a marketing video was produced, add one line with its absolute path (the sole file-path exception, since it's a deliverable the user must locate) and offer to move it (e.g. to `~/Downloads`).
