---
name: specs-publish
description: >-
  Exclusive route to publish, submit, release, or ship a Specs Lens. Handles target channel, store metadata, ratings, signing/icon setup, previews, packaging, and upload. Do not also load lens-studio-router or verify-preview.
argument-hint: "[project path | .esproj]"
user-invocable: true
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Publish Lens

**User request:** $ARGUMENTS

Drive a Specs Lens from project → submitted to the selected release channel. Be mechanical and fast: **carry state forward**, prepare one complete publish plan, ask one confirmation on the healthy path, and run the expensive export **once**. Preserve user-supplied values except invalid package IDs and invalid Build Versions; propose only a replacement for a missing or invalid package ID (including Lens Studio’s default `mylens`), missing Lens/store metadata, content-rating answers, category, Lens icon, signing-key action, preview-media behavior, and a valid Build Version when the current one is missing, malformed, or rejected. Generate a new private key or persist generated project metadata only after the consolidated confirmation explicitly approves it. Ask additional questions only for an edit or a recoverable exception (sign-in, project/org ambiguity, moderation finding, invalid backend data, or failed automation) — never just halt.

## Target release channel

Use the user's requested release channel: **Public** → `production`, **Beta** → `beta`, **Internal** → `internal`. Default to `production` only when no channel was requested. Pass the value as `proposals.targetChannel` in session `prepare`, or use `prepare --state-handle <handle> --target-channel internal`. The helper validates the enum and displays the channel in the consolidated confirmation; no separate channel question is needed when intent is clear.

Treat **organization only**, **organization-only**, **org only**, and **only within my organization** as requests for the **Internal** channel (`internal`). For example, “publish this Lens for my organization only” sets `proposals.targetChannel` to `internal` and displays **Internal** in the confirmation. Selecting a publishing organization alone does not imply a channel; apply this mapping when the user restricts the audience to that organization.

The channel is bound to the confirmed plan and Finalize authorization. An Edit can change it through `prepare --target-channel <value>` and a new confirmation; omitting it on subsequent edits preserves the prepared channel. Finalize sends it as `targetChannel` on submit and keeps it fixed across retries. If the backend rejects a channel, surface the error; never fall back to Public automatically. Channel availability and audience are controlled by the backend. Unlisted is a separate visibility setting, not a release channel.

## Fast path

Go directly to `publish-session.py begin-context --project <esprojPath>`. Add `--package-id <value>` only when the user supplied an ID for a project whose ID is missing or invalid; otherwise discovery generates a stable per-session proposal. Do not load `lens-studio-router`, enumerate tools, list this skill's files, inspect schemas, or probe arguments. Resolve `ExecuteEditorCode` by its fully-qualified runtime name and run only paths returned by the session.

The healthy outer scopes are: context; optional defaulted build-version plan; optional preview capture; optional two-frame decision + prepare; confirmation; Package (including any confirmed Build Version update); Register; Finalize; complete. Store `{stateHandle, confirmationToken}` under `specsPublishSession` before asking. After the answer, load that value in the confirmation scope; never type either value again.

## Cross-runtime behavior

Apply this skill's two interactive primitives — the per-phase progress list and `ACTION_REQUIRED` blocking questions — by **intent**, not literal tool name. Tool naming, deferred schemas, and ask/spawn semantics: see `lens-studio-field-notes` Hard Rule 2 / Cross-runtime orchestration.

When this skill is already selected for a publish request, it is the terminal Lens Studio route: do not additionally load `lens-studio-router`. Load only the conditional references named below and `editor-api` after a real pinned-script failure.

**Runtime bootstrap:** invoke `ExecuteEditorCode` directly with a pinned/generated `path`; invoke `PreviewPanelTool` for refresh and `CapturePanelScreenshotTool` for direct-to-disk screenshots only when the selected media flow requires them. Resolve these exact tools without enumerating the full tool registry, loading `lens-studio-router`, or searching this skill after its initial read. **Resolve them by their fully-qualified name on the first attempt.** This skill writes MCP tools by their bare names, but a runtime that namespaces MCP tools exposes them under a prefix, and a bare-name lookup there fails and costs a retry — so prepend whatever prefix your runtime uses rather than selecting the bare name and discovering it is unresolvable. Give any long-running shell command, including the preview capture, a generous execution timeout using your runtime's own parameter for that; guessing a parameter name that the runtime rejects also costs a retry. If an orchestration call yields a retained execution handle instead of a terminal result, join that exact handle as the next action and keep joining until completion before commentary, unrelated work, another Editor call, or a user question.

**Irreversible-submit hard stop:** if no human can answer in this run at all (fully non-interactive), the consolidated confirmation and each exceptional `ACTION_REQUIRED` gate an irreversible submission step or persistent project/private-key mutation, so **STOP and emit the full ordered checklist** of the prepared values and anything the user must fix (with the phase's `reason`/`message`). Never generate a signing key, assign generated metadata, register/upload/submit with unconfirmed values, or silently skip a gate.

### Number every user choice

Prefix every user-facing selection option with a one-based numeric prefix (`1.`, `2.`, `3.`, …), preserving the existing option order and wording. Apply this to static lists, `Done`/`Cancel` confirmations, moderation choices, and dynamically generated backend options; do not number non-choice lists. Prefix backend-provided choices after sorting them in their displayed order; preserve the selected backend ID separately from its numbered label.

## Hard execution barriers

1. **Before confirmation:** call `begin-context --project`, run its returned Preflight and discovery paths once each, then call `stage-context`; require `PUBLISH_CONTEXT_STAGED`. When availability rejects only the current Build Version and supplies an exact next value, `stage-context` defaults that value into `buildVersionPlan` for the consolidated confirmation without mutating the project. It also retains review input and returns its compact summary. Never transport either Editor result through JSON/base64/model code.
2. **Preview replacement:** for `auto_image`, use `prepare-preview-images` → returned requests → `record-preview-images` until `PUBLISH_PREVIEW_IMAGES_READY`, then inspect both images under `references/preview-image-capture.md`. For `auto_video`, use only `prepare-preview-video` → returned Editor path → `record-preview-video` → optional `decide-preview-video`, then the screenshot flow with the requested image count from `references/preview-image-capture.md`. The session owns configuration, normalization, retained media, review input, and cleanup. Follow `references/preview-video-capture.md` only for the returned decision/compatibility/screenshot branch.
3. **At confirmation:** store the exact `{stateHandle, confirmationToken}` under `specsPublishSession`, display the returned asset previews and ask the structured confirmation as described in the user-visible media preview gate, then load that value after the user's reply and pass only it plus the selected option to `confirm`. Require `PUBLISH_SESSION_CONFIRMED`. A confirmed Build Version update is token-bound into Package authorization and applied, saved, verified, and exported by the single configured `package.ts` execution; never orchestrate a separate Build Version setter or recheck on the healthy path.
4. **Package → Publish → Finalize:** keep each `authorize-*` → returned Editor path → matching `record-*` trio in one orchestration scope. The configured script persists its exact result, so healthy record calls receive only the handle.
5. **Terminal:** after `record-finalize` returns `PUBLISH_SESSION_SUBMITTED`, call `complete` once. It builds or skips the promotional video, removes session-owned preview/review intermediates, preserves the final displayed preview artifact for 30 days, deletes the session, and returns all final facts.

For that recovery only, retry the recorder with `--result-json` pointing to the untouched Editor result; never rerun the successful Editor call or copy its fields.

Rerun only the configured Preflight/discovery path named by an `ACTION_REQUIRED` recovery; rerun the collector only after a confirmed review-visible project setter. A failed operation may be retried as documented, but a schema lookup never counts as execution.

Most phases run pinned scripts from this skill's `scripts/` directory, grouped by role: **`editor/`** (everything run through `ExecuteEditorCode`, plus `make-eec-script.py`), **`publish/`** (the deterministic core, plan assembly, review input, uploads), **`preview/`** (preview-media capture), **`promotional/`** (the promotional video), **`schemas/`** (machine-validated boundary contracts), **`setup/`** (signing-key and Lens-icon generators), and **`dev/`** (manual measurement tools, never part of a publish). The must-be-exact logic (signing-key setup, Lens icon generation and assignment, production SPK export, authorized API calls) lives there — **run it, don't re-derive it.** Resolve each script by its full path under this skill (`<skill-dir>/scripts/<group>/<name>`): for a `.ts`, pass that path to `ExecuteEditorCode` as `path`; for a `.js`, run it with `node`; for a `.py`, run it with `python3`; for a `.sh`, run it with `bash`. Each script prints or returns one JSON object with a `status`; branch on it. `ACTION_REQUIRED` is an "ask, then retry" checkpoint, not a failure.

**Never `Read` a pinned `.ts` script to paste it into `ExecuteEditorCode` as `code`.** `preflight.ts` alone is ~28 KB; reading it and resending it costs that twice per call, for nothing. `path` makes the tool read the file itself, so the body never enters your context. Read a pinned script only when it has already failed and you are debugging it.

Every publish Editor API action already has either a pinned `.ts` path or a generated configured `.ts` path. Therefore every `ExecuteEditorCode` call in this skill must supply `path`; supplying inline `code` is a flow violation, including during retries and recovery.

**Only load `ls-clad:editor-api` if a script fails to compile or execute** — this publish-specific speed override takes precedence over the general load-before-`ExecuteEditorCode` rule because these scripts are pinned and pre-written. Loading it pre-emptively costs an extra turn (~15–25 s) for no benefit on the happy path. If you do load it, debug per that skill and retry up to 3×.

## Phases & resources

| # | Phase | Does | Run |
|---|-------|------|-----|
| 1 | Discover | Resolve the `.esproj`; read `packageId` + `packageVersion` + `lensName` | read the project file; otherwise use session `begin-context` Preflight as the open-project fallback |
| 2 | Preflight | Confirm auth/open project, get publish context/build policy, reuse existing store fields by default, prepare only missing or explicitly replaced metadata + project setup, ask once, apply confirmed project changes, and expose moderation/Commerce Kit checks | `scripts/editor/preflight.ts` + `scripts/editor/discover.ts` + setters/generators + `scripts/publish/collect-review-input.py` + `scripts/publish/publish-session.py`; preview capture references below |
| 3 | Package | Authorize confirmed identity → save → export production SPK → checksum | `publish-session.py authorize-package` → configured `package.ts` → `record-package` |
| 4 | Publish | Register the release and upload the Package plus replacement previews | `authorize-registration` → configured `register.ts` → `record-registration` |
| 5 | Finalize | Authorize replacements, verify any update, then submit | `authorize-finalize` → configured `finalize.ts` → `record-finalize` |
| P | Complete | Build/skip the promotional video after Submit, clean session-owned intermediates, retain the displayed preview temporarily, and return final facts | `publish-session.py complete` |

`begin-context` owns Preflight/discovery configuration, result paths, and cleanup. Never configure those scripts yourself. Run `scripts/setup/signing-key.js` and `scripts/setup/generate-lens-icon.py` from disk with their documented arguments.

The package-ID setter (`scripts/editor/set-package-id.ts`) takes the exact JSON `args` returned by session `confirm`, without code generation. The other three standalone project setters and exceptional `authorized-request.ts` take per-call CONFIG values. Build Version is not a standalone setter; the session binds it into configured `package.ts`. Fill standalone setters with `scripts/editor/make-eec-script.py`, which prints a temp path to pass as `path`—never edit the pinned files or hand-write their `const` lines:

```bash
python3 "<skill-dir>/scripts/editor/make-eec-script.py" "<skill-dir>/scripts/editor/set-lens-name.ts" \
  --set "LENS_NAME=<confirmed name>" --set "EXPECTED_PROJECT_PATH=<confirmed .esproj path>"
```

Pass values **raw**; the helper JSON-encodes them. After the Editor call, run `make-eec-script.py --cleanup <configured-path>` rather than `rm`. Package, Register, and Finalize code generation/cleanup belongs exclusively to the session helper.

Generate the configured script and make its `ExecuteEditorCode` call **in the same orchestration scope**. Returning from a scope just to carry a temp path into the next call doubles the turn count for every setter and every authorized request, which is the largest avoidable cost on the healthy path.

### Deterministic publish core

`scripts/publish/publish-session.py` is the normal publish state machine. It keeps complete plans, fingerprints, authorization objects, and Editor results behind an opaque handle; never open or modify its state file. The healthy sequence is:

`begin-context` → returned Preflight path → returned discovery path → `stage-context` → optional session preview operations → `prepare` → store + ask → load + `confirm` → apply returned project setup → Package trio (including any confirmed Build Version update) → Register trio → Finalize trio → `complete`.

The initial `prepare` always renders local media inline. Only call `fallback` with the current confirmation token and a concrete client rendering failure.

Keep `begin-context` → its two configured `ExecuteEditorCode` calls → `stage-context` in one retained orchestration scope; branch only on the final session result. Likewise keep every `authorize-*` → configured `ExecuteEditorCode` → `record-*` trio together. Each configured script persists its exact result and returns only a compact `RESULT_PERSISTED` receipt, so healthy session calls carry only `--state-handle`. If persistence recovery is requested, follow only the returned retry instruction. Do not inspect session schemas on the healthy path, and do not inspect implementation either.

Use the runtime state helpers literally at the user barrier:

```js
store("specsPublishSession", {
  stateHandle: prepared.stateHandle,
  confirmationToken: prepared.confirmation.confirmationToken,
});
// After the user answers, in a new scope:
const { stateHandle, confirmationToken } = load("specsPublishSession");
// Run confirm only; observe PUBLISH_SESSION_CONFIRMED before Package authorization.
```

Never copy availability fields or compare package-version strings in the model; the staged context and version guard own those decisions.

```bash
python3 "<skill-dir>/scripts/publish/publish-session.py" confirm --state-handle "$handle" --confirmation-token "$token" --selection-id confirm
python3 "<skill-dir>/scripts/publish/publish-session.py" authorize-package --state-handle "$handle"
python3 "<skill-dir>/scripts/publish/publish-session.py" record-package --state-handle "$handle"
python3 "<skill-dir>/scripts/publish/publish-session.py" authorize-registration --state-handle "$handle"
python3 "<skill-dir>/scripts/publish/publish-session.py" record-registration --state-handle "$handle"
python3 "<skill-dir>/scripts/publish/publish-session.py" authorize-finalize --state-handle "$handle"
python3 "<skill-dir>/scripts/publish/publish-session.py" record-finalize --state-handle "$handle"
python3 "<skill-dir>/scripts/publish/publish-session.py" complete --state-handle "$handle"
```

`publish-flow.py` remains the lower-level deterministic core used by the session and exceptional recovery. Do not reimplement its validation, comparisons, fingerprints, or merges:

- `registration-authorize` / `registration-succeed` — derive the confirmed request and guard/persist its at-most-once transition.
- `finalize-authorize` — bind release IDs, uploaded previews, and rating behavior to the confirmed plan before submit.
- `version-guard` — validate the exact package ID/version against the deployed availability checks embedded in publish context and fail closed on inconsistent response facts.
- `preview-upload-body` — produce the exact `/apps/upload` body, including `expireIn: 3600`.
- `tile-upload-body` — produce the `/apps/upload` body with `contentType: "til"`, a named `tileType`, and image file type.
- `merge-version-metadata` — preserve every unmentioned field while replacing confirmed `previewAssets`, named `tileAssets` roles, and/or the validated rating plus its complete assessment.

#### Ask the helper for its own I/O contract

**`publish-flow.py --schema <operation>`** prints that operation's summary, required and optional input keys, result keys, and its gotchas as one JSON object; `--schema all` prints every operation at once. The declarations live beside the validators that enforce them, so they cannot drift from the code and no version of them is carried in this file.

A schema result is documentation only. It never satisfies or replaces the named operation; invoke `publish-flow.py <operation> --json ...` separately and require that operation's success status.

Read the schema when you need a key name. Never spend a turn on `--help`, `rg`, or reading `publish-flow.py` — `--help` lists operation names only, and a cold run once lost three turns rediscovering that.

Two facts worth knowing before your first call, because they are easy to get wrong and both fail closed: every `checksum` field is **base64** SHA-256 (`openssl dgst -sha256 -binary FILE | base64`), not hex; and every request builder returns a uniform `request` envelope, so read `result.request.method` / `.path` / `.body` and never a top-level `result.requestPath`.

For registration, the session derives the request body, reuse omissions, preview set, and guarded started state. `register.ts` persists success, mints upload targets, and feeds the signed manifest directly to `upload-all.py`; never launch a second upload.

Keep these calls inside the existing durable orchestration scopes. Do not open a model turn merely to translate a successful deterministic result.

## Output contract (visible to the user)

**A message is the billable unit, not a tool call.** The measured baseline run spent 14 of its 63 messages on text alone and never once combined text with a call — 1.00 calls per message. Prose that merely forbade that waste did not change it, so this section fixes *which message* each piece of output belongs in instead of asking for restraint.

Three outputs are required:

| Output | Placement |
|---|---|
| Asset previews | one text-only message immediately before the ask, emitted as ordinary user-visible assistant output, with nothing in between |
| Consolidated confirmation | a real blocking question — the one place the flow stops |
| Final response | one message, after Submit returns `submitted` |

The confirmation gates an irreversible submission and an at-most-once registration, and the previews are what make its asset approval meaningful, so neither may be batched away or skipped. Everything else below is optional and must cost nothing.

### Batch by default

Independent calls belong in **one** message. Two calls in a message cost the same round trip as one, so batching is free and serialising is not — the baseline's 49 tool-bearing messages carried exactly one call each, which is where most of its cost went.

Co-dispatch anything you do not need to observe in between: the progress-list seed, progress completions, independent read-only requests, a byte-transfer launch plus the read that follows it, and local shell preparation. Equally, never spend a whole message on a progress update, a parsing step, a cached-value display, a retry announcement, or generated-file cleanup — each of those rides with the next real call. The one exception is an authorized **mutation** (`/lenses/publish`, `/apps/upload`, any `PUT`, submit) — never co-dispatch one with another call, because its at-most-once guarantee depends on observing each result before the next call is issued.

### Phase progress list

Seed all five items in a **single** message before Discover, using the runtime's task/progress primitive:

1. Discover project
2. Preflight
3. Package (export SnapOS Package)
4. Publish (register + upload)
5. Finalize (metadata + submit)

**Mark phases `completed` only — skip the `in_progress` transition**, and place every completion inside the same message as the next call that does real work. **Never send a message whose only calls are progress updates:** five solo seeds plus five solo completions is what this display cost in the baseline, and it costs nothing once batched. If a phase becomes `ACTION_REQUIRED`, flip it to `in_progress` in the message that opens the blocking question. On `FAILED`, leave it `in_progress` and report the failure.

### Status labels

One three-word label per logical action — no full sentences, no "Let me…" / "Now I'll…". **A label is text inside the message that carries the call it narrates; it is never a message of its own.** No call to attach it to means no label. Use exactly these (period included): `Preflight…`, `Updating build version…`, `Assigning Lens name…`, `Checking signing key…`, `Generating signing key…`, `Assigning signing key…`, `Generating Lens icon…`, `Assigning Lens icon…`, `Exporting SnapOS Package…`, `Fetching store categories…`, `Registering release…`, `Uploading SnapOS Package…`, `Preparing preview media…`, `Registering preview media…`, `Uploading preview media…`, `Updating store media…`, `Saving age rating…`, `Submitting for review…`.

Emit each applicable label at most once on the healthy path, and never repeat it for temporary-directory setup, file checks, dimension validation, normalization, moderation inspection, content-rating inspection, inline rendering, output parsing, or cleanup. If a failed action is explicitly retried, use `Retrying <action>…` once instead of repeating its original label. Never label preview-media preparation, icon validation, moderation inspection, or the silent promotional-video build as **Generating Lens icon…**.

### No mid-flow result reports

Never echo `lensId`, `releaseId`, `checksum`, `packageBytes`, or `spkPath` between phases, and never add a sentence after a call returns to restate what it returned — the progress list already shows where the flow is. The baseline run violated this twice ("Preflight is clean…", "VERSION_POLICY_OK.") at one round trip each.

A message may carry text only as: the status label for its own call; the Discover line **"Submitting `<lensName>` (`<packageId>`)"** once, attached to the next call; the asset-preview render; a blocking `ACTION_REQUIRED` question the user must answer; a `FAILED` summary with `reason` / `message` / `httpStatus` when a phase errors out; the exact one-line auto-video display warning from `references/preview-video-capture.md`; or the final response.

## Speed rules

Output placement is the contract above; these are the remaining cost rules.

1. **Exact discovery + no pinned-script reads.** Resolve only `ExecuteEditorCode` and, when needed, `PreviewPanelTool` and `CapturePanelScreenshotTool` by exact name. **Never enumerate the full tool registry**, and never load `lens-studio-router` after this skill is selected. Every script runs from disk, so none needs to enter context. There is no read-ahead batch to prepare: go straight to `begin-context`. Read a script only after its own failure; never read one merely to learn an input shape—the session response is self-correcting. Every executable script read must reach **EOF**; fixed `head`/`sed` line caps are prohibited. Read this SKILL.md and each reference **at most once**; if a read truncates, resume from the next unread line rather than restarting.
2. **In user-visible text (progress list, chat, errors), call it a "SnapOS Package" — not "SPK".** "SPK" is correct for internal field names, script names (`upload-all.py`), and API protocol keys (`spkChecksum`, `data.uploads.spk`); leave those alone. Only the prose the user reads changes.
3. **Serial lanes and hard barriers.** Lens Studio MCP/`ExecuteEditorCode` calls share one editor lane. Authorized mutations and dependent reads remain ordered. Confirmation and `ACTION_REQUIRED` are hard barriers. Publish context must pass before preview/Package; Package must precede Register + Upload; Register must finish before Finalize. `stage-context` collects shared review input. Once context is available, independently stage any missing project setup, derive only missing/replaced metadata, and prepare replacement preview media. Use a preview worker only for the returned compatibility command when foreground capture cannot run; inspect a normal two-frame decision directly in the parent.

   For any automatic screenshot, use `CapturePanelScreenshotTool` with `pluginId: "Snap.Plugin.Gui.PreviewPanel"`, the exact session/flow-returned `outputPath`, and `maxDimension: 1920`; then run the returned staging operation in the same durable orchestration scope. The tool writes rendered Preview pixels directly to disk, so no image/base64 block crosses a model or runtime-state boundary. Require success and the returned path to match `outputPath`. `PreviewPanelTool` is for refresh/playback, not screenshot capture. Call the screenshot tool exactly once per planned image: use the count selected under `references/preview-image-capture.md` for automatic images, and the single capture owned by the video-fallback or tiles-only branch otherwise. A staging failure reuses captured files and never triggers recapture. Omitting `outputPath`, `store`/`load` screenshot state, base64 transport, PTY/stdin streaming, and model-authored image reconstruction are forbidden.

   For auto-video, first require discovery to return a successful publish-context availability result. Session `prepare` performs the fail-closed version comparison before rendering confirmation.

   For auto-video, follow `references/preview-video-capture.md` as the single owner of recorder selection, normalization/inspection, compatibility-worker deadlines, exactly-once screenshot fallback, recovery, and cleanup. It requires the Editor API first, permits the toolbar recorder only when capability detection proves no recording started, and forbids a second automatic recording. While its compatibility worker owns Preview, make no Lens Studio MCP call; join it before preview-dependent rating, moderation, media rendering, or confirmation.
4. **Prepare upload inputs early.** Session `prepare` computes and binds local preview checksums before confirmation. Recompute only when a file identity changed. `register.ts` launches `upload-all.py` inside Lens Studio, so never start a separate uploader or request a second network scope.

## State to carry

Store the staged handle under `specsPublishSession`; configured Editor scripts persist directly into it. Never copy, encode, serialize, or reconstruct an Editor result. Before `prepare`, carry only the handle, semantic proposals, and presentation judgment; session-owned review/preview paths stay opaque. Overwrite the stored value with the exact confirmation token, then load both after confirmation. The session owns every discovery artifact, review bundle, preview path, plan, version policy, fingerprint, authorization, Editor result, submit guard, and final token.

Keep the handle through retries. Call `complete` after submission; call `cleanup` only on cancellation or terminal failure. A backend correction that changes confirmed metadata requires a new prepared session and confirmation; a retry that changes no confirmed value reuses the existing handle and exported Package.

## 1 · Discover

- Resolve the `.esproj`: use `$ARGUMENTS` if it is a path; otherwise use the single `.esproj` found by `rg --files -g '*.esproj'`. Never guess a conventional filename such as `Project.esproj`. If none exists and Lens Studio is callable, use the result persisted by session Preflight to resolve `projectPath`; do not run another Preflight.
- Read `packageId:`, `packageVersion:`, and `lensName:` from the `.esproj` text. If `lensName` is blank or trimmed case-insensitive `Untitled`, treat it as missing and humanize the `.esproj` filename (split separators/camel case, remove generic suffixes only when the result remains meaningful, and title-case conservatively) as the initial proposal; do not edit the file directly. If `packageId` is blank or invalid (including the default `mylens`), let session discovery propose a valid ID from the project filename plus a random suffix (`com.lens.<slug>.p<suffix>`), check its availability, and carry it into the consolidated confirmation. Do not mutate project metadata during discovery or generate an ID in prose. Preserve every valid existing ID. An ID is valid only with at least two lowercase dot-separated segments, each starting with a letter and containing only letters, digits, or underscores, and at most 128 characters. Require `packageVersion` to use strict `major.minor.patch` with unsigned 32-bit components. For blank or malformed values, discovery checks `1.0.0` with the backend; the session proposes that available version or the backend’s higher suggestion. Include this repair in the consolidated confirmation and let Package set `project.metaInfo.buildVersion`, save, and verify it before export. Do not ask for a manual Project Settings edit on this path.
- Capture optional inputs only if the user supplied them: `orgId`, `categoryId`, `semanticVersion`, `releaseDescription`, `releaseTags`, content-rating answers, preview image/video paths, a request to auto-generate preview media, or a promotional-video music path. Do not prompt for omitted description, tags, content-rating answers, category, icon, signing-key action, preview-media behavior, or promotional-video music during Discover; leave them unset for the single-plan preparation below. Never invent an `orgId` or `semanticVersion`.

## 2 · Preflight

Call `publish-session.py begin-context --project <esprojPath>` once. In the same scope, run `ExecuteEditorCode` first with its exact `preflightScriptPath`, then with its exact `discoverScriptPath`, ignoring their returned bodies because both persist into the session. Call `stage-context --state-handle` immediately and store its handle. The session verifies the requested project, collects review input, and returns compact `reviewSummary`. Do not use `btoa`, `TextEncoder`, base64, shell quoting, temporary JSON, or model-authored field extraction.

Before branching on any Preflight `status` that includes `projectPath`, canonicalize and compare it with the discovered `esprojPath` (resolve symlinks and `..`, then compare exactly). If they differ, ask the user to open `esprojPath`, then rerun Preflight. **Do not generate or assign an icon, prompt for other project fixes, or continue until the paths match.**

- **`READY`** → keep `packageId`, `packageVersion`, `lensName`, `projectPath` and prepare the _Single publish confirmation_ below.
- **`ACTION_REQUIRED`** → treat a blank/default-`Untitled` `lensName`, `no_lens_icon`, and `no_prod_signing_key` as plan inputs, not immediate questions: prepare the Lens-name proposal, stage the temporary icon, and record the signing-key action. A blank or invalid `packageId` (including `mylens`) and `invalid_package_version` are also plannable through discovery; resolve unrelated issues per `references/exceptions.md` before preparing the confirmation. Never present the plannable items as separate questions unless the user chooses **Edit** or their confirmed automation fails.
- **`FAILED`** → surface `reason` + `message`.

Preflight includes `localAiModerationInput`. Treat it as internal agent context for the local moderation checkpoint. Do not echo project asset paths, including the selected Lens icon path; save the selected available `role: "icon"` path as `lensIconDisplayPath` only for internal validation and optional inline rendering. Preflight reports local image assets independently from Commerce Kit. If Commerce Kit is used, preflight reports product IDs passed to `queryProductDetails(...)` for package-prefix checking before Package.

Do not execute the preparation headings below as an unnecessarily serial checklist. Once project identity and any unrelated `ACTION_REQUIRED` issue are resolved, fan out the independent branches listed in **Speed rules** rule 3, batching them per the output contract. Only the compatibility recorder may use a preview worker; while it owns Preview, the parent must not make any Lens Studio MCP call. Join all preparation branches before deriving preview-dependent content rating/moderation or opening the confirmation.

### Plan missing project setup

If Preflight reported a missing or invalid package ID, `no_lens_icon`, `no_prod_signing_key`, or a blank/placeholder `Untitled`
Lens name, read `references/project-setup.md` and follow it: those are **plannable** items, staged
now and shown in the one confirmation, never asked separately. A project with all four valid and already
set skips that reference entirely and runs no setter.

Whatever is staged, apply the confirmed actions **after** the confirmation in this order:
Package ID, Lens name, Lens icon, signing key. Leave any Build Version update to Package.

### Prepare release metadata

Wait for `discover.ts` before generating either field. Preserve an explicitly supplied description or tags. For every omitted field marked `existing`, leave its value unset and record `reuse_existing`; do not generate it or make any call used only to generate it. For every omitted field marked `missing`, generate a truthful, non-promotional replacement: a description of at least 10 characters and 1–3 tags from the Lens name, package ID, project name, and visible local context. Choose tags only from the Developer Portal's selectable set: `#Outdoors`, `#Active`, `#Offline Mode`, `#Beginner Lenses`, `#Educational`, `#Tabletop`, `#Productivity`, `#Wellness`, `#Holiday`, `#Travel`, `#Creative`, `#World-Based`, `#Watch`, `#Music`, `#Lifestyle`, `#Tools`, `#Developer Tool`. `freeze-plan` owns that list, normalizes case and the leading `#`, and rejects any other tag or more than 5.

### Discover: availability, categories, and the version guard

The discovery path returned by `begin-context` always gets publish context and fetches/normalizes categories only when required. Pass `--force-category-fetch` to `begin-context` only when the user already requested a category replacement; never configure discovery yourself.

- **`PUBLISH_CONTEXT_STAGED`** → the session consumed both persisted results, extracted `publishContext.data.availability`, ran the unit-tested `version-guard`, and returned the listing-reuse/category summary. Never inspect or copy either Editor result.
- **`ACTION_REQUIRED`** → `failedCall` names which GET failed. Handle `PKG_ID_REQUIRED`, `PKG_ID_UNAVAILABLE`, `invalid_package_version`, `SPECS_ACCOUNT_REQUIRED`, `ORG_REQUIRED`, `ORG_AMBIGUOUS`, or `FORBIDDEN` per `references/exceptions.md`. For an `ORG_AMBIGUOUS` retry, clean up the old context session, call `begin-context --tenant-id <orgId>`, and run only the newly returned paths. Never configure discovery yourself.
- **`FAILED`** → surface `reason`, `message`, `httpStatus`, and `failedCall`; stop before confirmation and Package.

The session `stage-context` branches on the guard:

- **`VERSION_POLICY_OK`** → save `packageVersionPrecheckCoverage = "availability_api"` plus any returned `publishedBuildVersionFloor` and `nextAvailablePkgBuildVersion`, then continue preparing the confirmation. `NO_PRIOR_VERSION` is valid for a new package, or an owned one with no released history.
- **`PUBLISH_CONTEXT_STAGED` with `buildVersionPlan`** → use the checked replacement (`1.0.0` for a missing/malformed version when available, or the backend's higher suggestion) as the default Package Build Version in the consolidated confirmation. Do not ask a separate question and do not mutate the project yet. If the user chooses **Edit** for Build Version, accept any strict `major.minor.patch` value at least as high as that backend minimum (it need not be exactly `current + 1`) and pass it to `prepare --build-version <value>`. For checks-only/no-submit, report the defaulted value, call `cleanup` with the retained handle, and stop without mutation or confirmation.
- **`PUBLISH_SESSION_CONFIRMED` with an assigned `projectSetupActions.buildVersion`** → do not run a separate setter. Continue through the normal Package trio. Its token-bound configured `package.ts` validates the intended project, Package ID, Lens name, checked current Build Version, and confirmed higher target before mutating; it then saves, verifies, and exports in that one deterministic Editor execution. If those facts drift, Package returns `ACTION_REQUIRED` before export (and before mutation whenever the pre-mutation identity is wrong).
- **`ACTION_REQUIRED`** → handle `SPK_BUILD_VERSION_NOT_INCREMENTED` (no usable backend suggestion) or `invalid_package_version` per `references/exceptions.md`. Invalid local versions are normally planned automatically; an error here concerns unavailable or inconsistent backend validation. Preserve staged preview media when its identity is unchanged.
- **`package_version_policy_unavailable`** or a legacy/missing checks shape → stop before confirmation and Package. The deployed checks response is mandatory; do not scan Lens channels/build pages or infer a floor locally.

Do not emit **Preparing preview media…** until the guard returns `VERSION_POLICY_OK`. The check is advisory and does not reserve the build version, so the authoritative upload-time validation stays.

### Propose the category

When no explicit category was supplied and `storeListingReuse.fields.category` is `existing`, leave `categoryId`, `categoryDisplayName`, and `selectableCategories` unset; record `reuse_existing` and skip `/categories`. Otherwise use the `selectableCategories` that `discover.ts` returned — filtered, sorted, and ready. Do not fetch `/categories` again.

- If a supplied `categoryId` matches a returned ID, preserve it.
- Otherwise select the closest truthful match from `lensName`, `releaseDescription`, `releaseTags`, and visible project context. Save its ID and display name for the single confirmation; do not ask a separate category question.
- If no returned category is plausible or usable, treat it as an exception and ask the user to choose from the sorted list before showing the confirmation. Never invent an ID.

Treat the response as raw category evidence until `publish-flow.py freeze-plan` succeeds. The frozen plan's `category.id` and `category.displayName` are the only values allowed in both the confirmation and Register; never invent or paraphrase the display name.

### Prepare content rating

Use the compact `reviewSummary` returned by `stage-context` for rating/moderation judgment. The session retains the complete collector bundle as the exact fingerprint input; do not call the collector separately or load its manifest into model context. **Do not hand-roll this inspection.**

Signals are leads, not answers. A silent signal is real evidence of absence, but a firing one still needs judgement — `CommerceKit.lspkg` appears in `installedPackages` on projects that sell nothing, and an `InternetModule` import is not a browser. Read each signal's `note`, which states the distinction that matters for its question.

Then read `references/review-input.md` — one read covers both rating replacement and moderation. Always keep the collector evidence needed by the shared local moderation checkpoint. If the user supplied rating answers, validate and use them. If no answers were supplied and `storeListingReuse.fields.contentRating` is `existing`, record `reuse_existing` and skip all questionnaire inference and rating-only follow-up calls. Otherwise, after the preview-media plan below has selected and staged its media, auto-propose every missing severity/capability answer from the collector bundle plus the exact replacement metadata, the selected/staged icon and preview media, and Preflight's moderation/Commerce Kit signals. Do not ask a separate questionnaire on the healthy path. Save the complete result as `contentRatingAssessment`, record short path-free rationales for non-default answers as `contentRatingEvidence`, and record any incomplete local inspection as `contentRatingCoverage`.

For a replacement, require all eight severity answers, all seven top-level capability answers, and each applicable dependent answer. Validate every answer. SPECS computes the age rating from the answers when Finalize saves them; never compute, propose, or show a rating, and omit `targetAgeRating` from proposals. Reuse is allowed only from the explicit opaque `publish-context` field state—never infer it from another endpoint or fabricate the inherited value.

### Single publish confirmation

Prepare every replacement/reuse decision and project-setup action before Package or persistent mutation. Keep inherited values absent; the session renderer produces opaque reuse labels.

Set `previewMediaPlan` from explicit media/auto-image/auto-video input, which always replaces reuse. With no input, preserve existing media when publish context permits; otherwise default to `auto_image` and prepare the screenshot pair through `references/preview-image-capture.md` after discovery confirms publish-context availability. Never substitute an illustration, project asset, Lens icon, or desktop screenshot.

Keep supplied paths internal. For auto-image, the session retains both images; omit preview proposals from `prepare`. For explicit auto-video follow `references/preview-video-capture.md`; require `PUBLISH_PREVIEW_READY`, which retains either the video or its automatic image fallback, then run the screenshot flow in `references/preview-image-capture.md` with the requested image count before `prepare`. Validate the final set before preparing, and never upload or mutate store media before confirmation.

Build the moderation/rating presentation exactly from `references/review-input.md`; never invent inherited text or digest the review input yourself. When session-owned preview media is the only replacement, avoid JSON entirely:

```bash
python3 "<skill-dir>/scripts/publish/publish-session.py" prepare \
  --state-handle "$handle"
```

Otherwise call `prepare --json -` with one compact object containing:

- `stateHandle`: the exact stored context handle;
- `proposals`: only `lensName`, `releaseDescription`, `releaseTags`, `orgId`, `orgDisplayName`, `semanticVersion`, `lensIconPlan`, `signingKeyPlan`, `selectedCategoryId`, `contentRatingAssessment`, `previewMedia`, `previewMediaPlan`, and optional `tileSourcePath` or `legalDocumentInputs`; each `previewMedia` entry is `{path, source, type?}`. `previewMediaAssets` is accepted as an alias, so never inspect code to resolve that name;
- `presentation`: path-free rating evidence/coverage and moderation findings/coverage.

Do not create a prepare JSON file, extract fields from either Editor result, add collector `releaseText`, or call `--schema`: the session joins retained Preflight release text to the collector, then runs assembly and review fingerprinting, binds the fingerprint into the plan, freezes/renders it, and returns `PUBLISH_SESSION_PREPARED`. On `ACTION_REQUIRED`, fix only the named semantic input and prepare again with the same context handle.

### Store tiles

Discovery uses `publish-context.storeListingReuse.fields.tileAssets`, an `existing` / `missing` flag resolved with the same channel/draft inheritance as preview media. Deploy the additive flag before this skill; an absent flag in an available listing is an unsupported service response, never evidence of missing tiles. A `status: "none"` listing has no existing tiles. Preserve existing tiles by default, including partial sets, by omitting tile replacements; their URLs stay on the server.

When tiles are missing, use a local Lens Studio Preview screenshot. Reuse this run's already captured `auto_image` PNG when available. Otherwise follow the **Store tiles only** branch in [preview-image-capture.md](references/preview-image-capture.md), then pass its PNG as `proposals.tileSourcePath`. Capture before `prepare`, including when details-page previews are reused or user-supplied. This must not add or replace details-page preview assets. Do not download existing preview media or extract a video frame as the default tile source.

Session `prepare` runs `scripts/publish/tile-assets.py`: center-fill crop primary **1056×1056 (1:1)**, default **504×672 (3:4)**, square **504×504 (1:1)**, and hero **1056×792 (4:3)**. An explicit `tileSourcePath` replaces the tile set and regenerates all four crops. The helper's structured input is `{tileAssetsState, previewMediaAssets, sourcePath?, outputDir}`; `tileAssetsState` must be `existing` or `missing`. It returns `TILE_ASSETS_READY` with `tileAssets` and the original `sourcePath` when tiles are generated; preparation errors become `ACTION_REQUIRED`. The session retains the original screenshot separately for edits and removes it during cleanup. It owns invocation, output paths, checksums, and cleanup. The helper uses ffmpeg, preserves aspect ratio, and can upscale small screenshots. Inspect the actual crops for clipped content and sharpness before the consolidated confirmation. To adjust them, use Edit and provide a better screenshot; never change approved tile bytes after confirmation.

Tiles upload separately with `contentType: "til"`, `fileType: "image"`, and `tileType: primary|default|square|hero`; they never consume a `previewIndex`. Finalize merges each approved role as `metadata.default.tileAssets[role].urlMap.png` and checks its URL before submit. It preserves other roles, localizations, and preview metadata. Successful completion retains displayed tile PNGs with the preview artifacts for 30 days; cancellation removes them.

### User-visible media preview gate

The rendered **Publish asset previews** has three sections: **Lens icon**; **Store tiles** — Images used while browsing Lens Explorer and Discover; and **Preview assets** — Screenshots and videos shown on the lens details page. Display every newly generated primary/cropped tile alongside the icon and staged preview assets so confirmation approves the actual images. For preserved assets, show **Reuse existing store tiles** and **Reuse existing preview assets**; do not fetch their URLs for display.

Emit the session's `confirmation.previewMessageMarkdown` unchanged as an ordinary user-visible assistant message when non-empty after the `prepare` tool call returns, then immediately ask its `confirmationMarkdown` with its `options`; nothing may appear between them. Use the runtime's available question tool that permits approval requests. Pass one structured question using `confirmation.confirmationMarkdown` as its prompt and all three returned option labels as selectable choices in order: **1. Confirm and submit**, **2. Edit**, **3. Cancel**. Map the prompt and choices to the question tool's declared input fields. Preserve their IDs separately for session `confirm`. The structured question tool is the intended user-visible surface; `text()`, `image()`, or another orchestration helper printing these values into a tool result does not display the confirmation.

An asynchronous question acknowledgement (such as `{accepted: true}`) means the question was queued, not answered. Keep it pending and use the runtime's supported wait for the user's response. Do not end the turn with a separate “ready for confirmation” summary while awaiting that response; it can replace the confirmation as the final visible message. A preselected option, timeout, or tool acknowledgement is never a selection. Only the actual user reply resumes `confirm`; if no permitted question tool is available, follow the host's plain-text confirmation rules and wait for an explicit answer.

Keep `retainedPaths` stable. If the client fails to render an attachment, call session `fallback` with the current handle, token, and concrete failure reason, then emit its replacement confirmation unchanged. Never choose fallback pre-emptively, expose filenames/full paths, or build confirmation prose yourself.

The session copies final auto-generated preview media out of capture staging before rendering confirmation. A successful `complete` preserves that exact attachment path for 30 days so the run can render it later; a future `begin-context` prunes expired publish-owned artifacts. Cancellation or terminal failure cleanup removes it immediately. Capture recordings, extracted decision frames, configuration, and other intermediates are never retained.

At cancellation, terminal failure, or before regenerating media, delete only staged paths not retained by the latest successful renderer. Remove a temporary directory only when it contains no retained path.

Options:

Publish context includes Lens-level `legalDocuments` readiness and the owning tenant's policy. It is the initial availability check; do not make a separate legal-documents request during discovery. If the service omits this field, deploy the publish-context update before using this skill. For `ORG_AMBIGUOUS`, show the returned `details.orgs` names and retry discovery with the selected tenant ID before preparing the plan. `ORG_REQUIRED` means no organization exists and includes a setup link.

The rendered confirmation includes missing Privacy Policy / Terms of Service requirements for Beta and Production. It offers **Add legal documents / Edit** instead of Confirm while required documents are missing. Ask the user for each missing document's HTTPS link or plain text in that same confirmation flow. Partial edits preserve the prepared release fields and any other supplied legal document; an explicit empty `legalDocumentInputs` object clears planned document additions. Pass only their supplied values as `proposals.legalDocumentInputs`, keyed by `privacyPolicy` and/or `termsOfService`, each exactly `{ "url": "..." }` or `{ "text": "..." }`. Never draft legal text or guess URLs. Prepare again and display the updated confirmation; its approval explicitly includes saving those Lens-level documents. Internal confirmations display **Not required for Internal** in the Lens legal documents section. Missing optional documents do not add a question for Internal or platform-provided tenants. Existing documents are reused; edits to existing Lens documents belong in Lens Settings.

Pass the exact `stateHandle`, `confirmationToken`, and selected option to session `confirm`.

- `confirm`: require `PUBLISH_SESSION_CONFIRMED`, then apply its standalone `projectSetupActions` in Package ID → Lens name → icon → signing-key order. For `packageId.action = assign`, execute its `scriptPath` with its exact `args` and require `PACKAGE_ID_SET`. Preserve `keep_existing` IDs. Leave Build Version to the token-bound Package execution.
- `edit`: ask one free-form question, change only that proposal, clean superseded staging, and prepare again. Rerun discovery only when missing/stale or the organization changed. To edit a proposed package ID, clean up the old session and restart `begin-context --project <esprojPath> --package-id <user value>` (preserving the selected tenant and release proposals), then stage discovery and rebuild confirmation; availability and listing context for one ID cannot authorize another. For the defaulted Build Version, call `prepare --state-handle <handle> --build-version <value>`; accept the backend minimum or any higher strict version, rerender the consolidated confirmation, and leave the project unchanged until confirmation.
- `cancel`: run session `cleanup`, abort without planned persistent mutations, and clean unretained staging.

If no human can answer, print the complete plan and stop. Keep `publishPlanConfirmed = false`. Never interpret the original generic “publish” request as confirmation of generated values, a new private key, or submission.

After the planned setters finish, call `prepare-final-review --state-handle <handle>`, execute its fresh `preflightScriptPath`, then call `record-final-review --state-handle <handle>`; require `FINAL_REVIEW_RECORDED`. Never reuse the original context script: `stage-context` already consumed and deleted it. The session verifies project identity, readiness, and Commerce Kit product-ID prefixes; a still-invalid Build Version is allowed only when it exactly matches the original value in the confirmed repair plan and Package will assign it; when `finalReviewRequired` is true, it collects and compares the final review fingerprint automatically. Pass only the handle, without reading or transporting Preflight or review JSON. Signing-key-only changes do not require a new collector. A mismatch returns to review and a rebuilt confirmation. A reused rating stays opaque. Skip this entire step when no setter ran.

### Promotional video

After `record-finalize` returns `PUBLISH_SESSION_SUBMITTED`, call `complete --state-handle <handle>` once; add `--music-path` only from the original request. It builds or skips the promotional video, cleans session-owned preview/review intermediates, deletes the session, and returns submission plus promotional facts. Do not read the promotional reference, invoke component scripts, spawn a subagent, or run it between phases.

## 3 · Package

After any required `record-final-review` succeeds, call `authorize-package --state-handle <handle>`; require `PACKAGE_SCRIPT_READY`. Execute its `packageScriptPath`, then call `record-package --state-handle <handle>`; require `PACKAGE_RECORDED`. The session authorizes identity/version policy, persists the exact result, and cleans the configured script plus result file. The Editor script rechecks package ID, version, and Lens name. Target **one successful export**.

**If the RPC times out,** follow `references/exceptions.md` to recover and hash a stable on-disk export; only re-run `package.ts` when it is missing or never stabilizes.

- **`EXPORTED`** → save `spkPath` = `packagePath`, plus `cleanupPath`, `checksum`, `packageBytes`, `generatedPackage: true`. Go to Publish.
- **`ACTION_REQUIRED`** (`no_prod_signing_key`, `pending_tasks_unavailable`) → `no_prod_signing_key` means the confirmed signing-key automation did not persist; surface both results and use the exceptional recovery path without creating another key. Handle the other reason per `references/exceptions.md`.

## 4 · Publish (register + upload)

**4a — Register.**

Call `authorize-registration --state-handle <handle>`; require `REGISTER_SCRIPT_READY`. Execute its `registerScriptPath`, then call `record-registration --state-handle <handle>`; require `REGISTRATION_RECORDED`. The result persists directly into the private session directory, while the uploader consumes its manifest through stdin, so the model reconstructs neither result nor signed URLs.

Run the configured `register.ts` with an Editor RPC timeout of at least **720,000 ms**. The execution now includes the byte transfer, and `upload-all.py` allows a slow upload up to 660,000 ms; retaining the old 120,000 ms register-only timeout can hide a successful in-progress transfer behind an RPC timeout after the release was already created.

- **`REGISTRATION_RECORDED`** → continue with the same session handle.
- **`REGISTRATION_SUCCEEDED`** with a `backendStatus` other than `needs_uploads` → the release registered but needs something else. For `needs_metadata`, read category fallback options from `data.details.categories` and apply the category fallback below. Otherwise surface the status and stop.
- **`ACTION_REQUIRED`** → for `CATEGORY_REQUIRED` / `CATEGORY_INVALID`, apply the category fallback. Handle other reasons per `references/exceptions.md`, then retry with the **cached** SPK and checksum; never re-export.
- **`FAILED`** with `registration_succeed_unavailable` → **the create landed.** Do not POST again. Recover the returned `backendData` and treat the attempt as consumed.

For a permitted retry, pass only the documented `retryReason` to `authorize-registration`; the session retains the state and increments the attempt ordinal. Logging, formatting, scope loss, and response parsing are never retry reasons.

For a category fallback, normalize `details.categories` (error) or `data.details.categories` (successful `needs_metadata`) with the same rules `discover.ts` applies — exclude Featured/Favorites, sort by `displayOrder` — ask the user to choose a replacement, then apply the backend-only plan correction rule above and retry with the cached SPK and checksum. If that payload has no usable categories, rerun `discover.ts`.

`upload-all.py` uploads the SnapOS Package and every preview concurrently inside that Editor execution. Its manifest is written once to subprocess stdin and read as one JSON line without waiting for EOF. Do not launch it again on the healthy path, ask the model to retain its manifest, reconstruct `registrationState`, or derive a download URL yourself.

- **`UPLOADS_FAILED`** → **do not attach preview metadata and do not submit.** Each failed entry says why. A `checksumMismatch` means the file changed after its upload was registered: rerun Package once, then re-register and re-upload with the new checksum and fresh targets. Never reuse an old upload URL.
- **`FAILED`** after registration → the result carries the complete succeeded `registrationState` needed for exceptional recovery. Do not hand-copy or truncate it, do not re-POST `/lenses/publish` merely because output parsing or variable scope was lost, and do not claim that an authorization was lost when the result contains it. Handle its exact `reason` and `message` per `references/exceptions.md`.

### Store preview media plan

Do not ask another preview-media question, and do not capture, generate, or select media again after confirmation.

1. The confirmed local media set retained by the session is exactly what Register uploads.
2. Any preview media rendered or listed in the confirmation **replaces** `metadata.default.previewAssets` entirely, including assets inherited from an older release. `finalize.ts` performs that replacement through `merge-version-metadata`; never merge or preserve older preview entries yourself.
3. When preview media is reused, the session configures no preview upload and Finalize preserves preview metadata.

Validate the confirmed media before registering uploads:

- The file exists and is readable.
- Keep 2–10 previews with at least 1 image and at most 3 videos, as the Developer Portal requires. If the user supplies more, ask which ones to keep.
- Keep each image at or under 15 MB and each video at or under 100 MB (1 MB = 1024² bytes).
- Session `prepare` applies the Developer Portal's media rules: it center-crops each user image to a 1080×1440 PNG and shows that crop in the confirmation, and it rejects an image smaller than 1080×1440 (`preview_image_invalid`) or a video that is not 3:4, at least 1080×1440, and 15–30 seconds long (`preview_video_invalid`). On either reason, ask the user for a replacement file.
- For automatic screenshots, require the session’s validated `PUBLISH_PREVIEW_IMAGES_READY` result; inspect every returned image as described in `references/preview-image-capture.md`. An auto-generated video's `VIDEO_READY` result already reports validated dimensions and duration, so do not re-probe it.

Reuse checksums and byte sizes computed during pre-confirmation staging. Recompute only for a file whose verified identity changed, and assign stable zero-based `previewIndex` values. Submit does not carry preview payloads: media must be uploaded and patched into release metadata first.

## 5 · Finalize (metadata + submit)

Legal documents belong to the **Lens**, including its first release; do not copy them into release metadata or write legacy `termsAndConditions`. Beta and Production require a Privacy Policy and Terms of Service; Internal may omit them. The legal-documents API's explicit `legalDocumentsRequired: false` exempts platform organizations from missing-document checks. Never infer an exemption from names, package prefixes, or a general first-party flag. Saved text must finish hosting even when documents are optional. External HTTPS links activate directly and are not fetched or rendered by this skill.

Finalize rechecks `/apps/{lensId}/legal-documents` before changing metadata or submitting. After registration creates the Lens record when needed, it saves only the explicitly confirmed missing documents with an empty expected revision. It preserves a concurrently saved document, reuses an identical source after a retry, and never overwrites an existing revision. It checks the latest saved revisions against the active documents, so an older active page cannot hide a pending replacement. Existing ready documents are reused without another legal-document prompt. This check follows the published document policy even while backend enforcement is being rolled out; do not infer readiness from an environment name or bypass a rejection by changing channels. The skill never invents legal text, supplies platform links for another tenant, or replaces/clears Lens documents on its own.

Call `authorize-finalize --state-handle <handle>`; require `FINALIZE_SCRIPT_READY`. The session owns and reuses its private submit-state path. Execute the returned `finalizeScriptPath`, then call `record-finalize --state-handle <handle>`. Reused rating/preview/tile fields produce no metadata call; a preview or tile replacement reads current metadata, while rating-only replacement skips that GET. The script owns four guarantees:

1. **Read-back before submit.** When a metadata replacement exists, the `PUT` response is compared field by field against only the confirmed replacement fields—every replacement tile role and PNG URL, preview index, url, and type and/or the complete replacement assessment, which must also come back with a SPECS-computed age rating. Any mismatch returns `METADATA_MISMATCH` **without submitting**. When neither exists, there is no metadata mutation to verify.
2. **Submit at most once, from persisted state.** A submitted release returns 404 on a version read, so a consumed attempt can never be resolved by asking the backend. The transition is written **before** the POST, and the script refuses to submit at all if it cannot persist. A `validating` response proves the release was not submitted, so it remains non-terminal and binds the safe retry reason.
3. **Granular terminal state**, so a failure is resumable without guessing what landed. A retry with the matching persisted `started` submit state skips metadata GET/PUT because that state is written only after the configured metadata update landed.
4. **Any metadata merge runs in `merge-version-metadata`**, so replace-not-append and preserve-unmentioned-fields stay in one tested place.

Branch on the result:

- **`PUBLISH_SESSION_SUBMITTED`** → call session `complete` once and report its returned facts.
- **`ALREADY_SUBMITTED`** → this release was already submitted and nothing was re-sent. Treat it as success and clean up.
- **`LEGAL_DOCUMENTS_PENDING`** → tell the user hosting is processing, wait `retryAfterSeconds`, then repeat the Finalize trio with the same session. The session permits at most ten consecutive pending checks before returning `ACTION_REQUIRED`; do not create another session to reset that limit. No submit attempt is opened while this check is pending.
- **`ACTION_REQUIRED`** with `legal_documents_required`, `legal_documents_pending`, `legal_document_save_failed`, `legal_document_changed`, or `legal_documents_unavailable` → follow the legal-document recovery in `references/exceptions.md`; preserve the registered release, uploads, confirmed channel, and session.
- **`SUBMIT_PENDING`** with `backendStatus: "validating"` → do not report success or call `complete`. Wait `retryAfterSeconds` (default 5 seconds when absent), then repeat the Finalize trio with the same session handle. The retained transition selects `submit_returned_retryable_status`, skips any completed metadata update, and keeps retrying until the backend returns `submitted` or a terminal validation error.
- **`METADATA_MISMATCH`** → nothing was submitted. Surface `mismatches` and return to the consolidated confirmation; do not retry blindly.
- **`METADATA_UPDATE_FAILED`** → nothing was submitted. Safe to retry the whole phase once the cause is fixed.
- **`METADATA_UPDATED_SUBMIT_FAILED`** → the update landed. **Retry submit only; never re-PUT.** Reauthorize with the same handle so the session reuses its retained submit-state guard.
- **`SUBMIT_FAILED`** → no metadata mutation was needed or sent. Resolve the submit failure through the persisted submit-state guard; do not add a metadata PUT on retry.
- **`ACTION_REQUIRED`** / **`FAILED`** → handle per `references/exceptions.md`, or surface `reason` / `message` / `httpStatus`.

## Local moderation preflight (advisory)

Read `references/review-input.md` while preparing the single confirmation and follow its derived-input contract. The initial pass must inspect the exact proposed release metadata and every locally available selected/staged icon and preview-media file. A clear initial finding belongs in the consolidated confirmation; change option 1 to **Confirm and submit anyway** and state that the review queue remains authoritative.

After confirmation and the planned setters, use the session-owned `prepare-final-review` → fresh Preflight → `record-final-review` flow above; skip it when no setter ran. The session applies the fingerprint contract in `references/review-input.md`. Skip the second moderation pass, and the rating pass when replacing that field, when the rebuilt review fingerprint is identical. For changed or unverifiable inputs, rerun moderation; rerun rating only when the confirmed plan replaces content rating. A reused rating remains opaque. A finding already shown and explicitly approved does not require a second question; only a new/different finding is an exceptional prompt with **Fix and recheck**, **Submit anyway**, and **Cancel**. If the original request asks for checks only/no submit, stop after reporting the result instead of showing the publish confirmation.

Do not duplicate policy outside `references/review-input.md`. While moderation is active, do not make unconfirmed edits to source files, assets, product IDs, Lens metadata, icons, signing keys, or project settings.

## Exceptions

On `ACTION_REQUIRED` or `FAILED`, read `references/exceptions.md` for blocking-question shapes, recovery, and RPC timeouts; **present every `ACTION_REQUIRED` as a real blocking question**. If no human can answer, **stop and print the ordered checklist** instead of guessing before an irreversible action.

## Final response

One short message, emitted only after the promotional build finishes or its skip reason is known. Report `<lensName>` submitted to the returned `targetChannel` (Public, Beta, or Internal), plus `packageId` and `portalUrl` (when present), and `releaseVersion` only when the API returned one. **Do not** recap the phases — the progress list is the status display. **Do not** mention SPK cleanup, internal file paths, or any other internal mechanics. Keep `spkPath`, `checksum`, `packageBytes`, `lensId`, and `releaseId` out unless the user asks for debug detail. If the promotional video was produced, add one line with its absolute path (the sole file-path exception, since it is a deliverable the user must locate) and state declaratively that it sits in a temporary directory and can be moved somewhere permanent, such as `~/Downloads`; when it came out silent, one further sentence may point at `/build-music`. Otherwise add one concise line saying it was not created and why; do not ask a follow-up question.
