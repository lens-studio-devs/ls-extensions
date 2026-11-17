<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Project setup: Package ID, Lens name, Lens icon, signing key

Read this **only** when Preflight reports one of `no_lens_icon`, `no_prod_signing_key`, a missing or invalid package ID, or a blank
/ placeholder `Untitled` Lens name. A project that already has valid values for all four skips this reference.

All four are **plannable**: stage or probe what is missing, show it in the single consolidated
confirmation, and mutate the project only after the user approves. Never present them as separate
questions unless the user chooses **Edit** or a confirmed automation fails.

### Prepare missing or invalid Package ID

`begin-context` gives discovery a random suffix once per session. When the project has no valid ID (including the default `mylens`),
discovery creates `com.lens.<project-slug>.p<suffix>` without saving it, or uses the explicit
`begin-context --package-id <value>`. Valid existing IDs are preserved. `stage-context` requires
availability to report **AVAILABLE** for a replacement proposal; **EXISTS** must not turn a new
project into an update to another Lens. Retrying the same discovery script retains the proposal.

The consolidated confirmation displays the proposed ID, the invalid ID it replaces when present, and its pending assignment. After `confirm`,
run `projectSetupActions.packageId.scriptPath` with its exact JSON `args` through ExecuteEditorCode
when `action` is `assign`. This standalone action accepts exactly `{ projectPath, packageId, expectedCurrentPackageId }`;
it validates the ID and intended project, assigns `project.metaInfo.packageId`, writes the metadata
back to the project, saves, and verifies both live and on-disk values. Require `PACKAGE_ID_SET`.
It permits a retry with the same confirmed ID. Otherwise it replaces only the exact missing or invalid ID observed before confirmation; a changed ID or any valid existing ID requires a new plan. Do not edit
`.esproj` text. An unsupported API returns `package_id_api_unavailable` for manual recovery.

After all confirmed setters finish, run session `prepare-final-review`, execute the returned fresh
`preflightScriptPath`, then `record-final-review`; require `FINAL_REVIEW_RECORDED`. The session checks
Commerce Kit product-ID prefixes and collects/verifies the final review. The original context
Preflight script has been deleted; never reuse it or transport its results through model-authored JSON. To change the proposal, restart context with the explicit ID and
rebuild confirmation. Never reuse another ID's availability result or frozen plan.

### Repair missing or malformed Build Version

Discovery checks `1.0.0` when the live Build Version is blank or malformed, without changing the
project. The session uses the checked version or the backend's higher available suggestion and
binds the original value into the consolidated confirmation. Do not run a standalone version setter:
Package assigns `project.metaInfo.buildVersion`, saves, verifies, and exports in one execution.
Post-setup Preflight may still report the exact invalid version pending this confirmed repair;
the session allows that specific issue and rejects unrelated issues or identity drift.

### Prepare missing Lens name

Preserve a non-empty project Lens name unless it is trimmed case-insensitive `Untitled`. When it is blank or `Untitled`, set `lensNameNeedsAssignment = true` and propose a concise, non-placeholder name of at most 30 characters (the Developer Portal limit, which `freeze-plan` enforces as `lens_name_too_long`) from the humanized `.esproj` filename plus visible local context. Do not mutate the project yet. Include the proposal in the consolidated confirmation.

After confirmation, run `scripts/editor/set-lens-name.ts` with `LENS_NAME = lensName` and `EXPECTED_PROJECT_PATH = esprojPath`. Require `LENS_NAME_SET`. The setter validates through `Editor.Model.MetaInfo.isLensNameValid`, replaces only a blank name or Lens Studio's `Untitled` placeholder, refuses a generated `Untitled` value or overwriting any other non-empty name, verifies the active project again at mutation time, saves, and reads the committed value back. Treat `wrong_project_open`, `lens_name_already_set`, `default_lens_name`, or any validation failure as an exceptional prompt/failure; never edit `.esproj` text directly.

### Stage missing Lens icon

The project's Lens icon ships inside the SnapOS Package as `icon.png`, and the store shows it as the Lens icon. The backend rejects a package without one (`SPK_ICON_MISSING`) and no longer accepts a separately uploaded icon, so this skill never uploads one.

Only when Preflight reports `no_lens_icon`, set `lensIconNeedsAssignment = true`. Before creating anything, check the carried state: if `generatedLensIconReady` is true and `generatedLensIconPath` still exists, is readable, and is a 320×320 PNG, reuse it without emitting another generation label or running the generator. Otherwise create one fresh temporary directory with `mktemp -d`, emit **Generating Lens icon…** once, and run the deterministic local generator exactly once:

```bash
python3 "<skill-dir>/scripts/setup/generate-lens-icon.py" \
  --project "<esprojPath>" --lens-name "<lensName>" \
  --output "<generatedLensIconTempDir>/lens-icon.png"
```

Require `ICON_GENERATED`, its returned 320×320 dimensions, and the expected absolute path. Save that path internally as `generatedLensIconPath` and `lensIconDisplayPath`, then set `generatedLensIconReady = true`. File validation, moderation inspection, inline rendering, category fetching, signing-key preparation, and confirmation assembly must reuse this staged file silently; none may call `scripts/setup/generate-lens-icon.py` or emit **Generating Lens icon…**. Show **Auto-generate and assign a new Lens icon (no custom Lens icon is currently set)** in the consolidated confirmation; do not call `scripts/editor/set-lens-icon.ts` before confirmation. When Preflight reports an existing icon, save its available `localAiModerationInput.assets[]` `role: "icon"` path internally as `lensIconDisplayPath`, set `generatedLensIconReady = false`, show **Use existing Lens icon**, and preserve it without asking or replacing it. Never add a Lens icon file/path row to the confirmation, even when the path is unavailable.

Regenerate only when the user edits the Lens name or icon plan in a way that changes the icon, or when the staged file is missing/invalid. Clean up the superseded temporary directory, set `generatedLensIconReady = false`, emit **Retrying Lens icon…** once, and create one replacement. Do not regenerate merely because Preflight, moderation, category discovery, confirmation rendering, or another helper step runs again.

If the user cancels, abandons the publish, or edits the confirmed plan so the staged generated icon will not be assigned, delete `generatedLensIconTempDir` immediately and set `generatedLensIconReady = false`. Apply that cleanup on every terminal path after staging, not only after an assignment attempt.

After confirmation, emit **Assigning Lens icon…** once and run `scripts/editor/set-lens-icon.ts` with the staged `ICON_PATH` and `EXPECTED_PROJECT_PATH`; do not generate a replacement first. On `ICON_SET`, set `generatedLensIconReady = false` and delete the temporary file/directory after Lens Studio copies it. On `wrong_project_open`, clean up and ask the user to open `esprojPath`; on any other failure, clean up and use the manual **Project Settings → Lens Icon** fallback. The confirmed generated icon must pass the same final local moderation check as a user-supplied icon.

### Plan missing production signing key

Preserve a valid assigned key. When Preflight reports `no_prod_signing_key`:

- If the publish request supplied an existing key path, validate it before confirmation with `signing-key.js --path`; require `SIGNING_KEY_READY`, save the resolved plan internally, and omit the signing-key row from the confirmation. Treat `SIGNING_KEY_MISSING` or `FAILED` as an exceptional correction before confirmation.
- Otherwise probe the default `<projectRoot>/specs_signing_key.pem` path before confirmation with `signing-key.js --project "<esprojPath>"` (without `--generate`):
  - **`SIGNING_KEY_READY`** → save its path/fingerprint, omit the signing-key row from the confirmation, and do not call `--generate` after confirmation.
  - **`SIGNING_KEY_MISSING`** → save its returned path and show **Auto-generate and assign a new project signing key at `<path>` (no key exists at this path)**. Do not run `--generate` yet.
  - **`FAILED`** → surface the invalid/unreadable existing-path failure as an exceptional correction before confirmation; never replace it.

When Preflight reports a valid key already assigned to the project, omit the signing-key row from the confirmation. Omit the row for every valid existing-key plan; show it only when the plan will auto-generate a new key, because that new private-key creation requires explicit confirmation. Do not add a secrecy, backup, or commit warning.

Choosing **Confirm and submit** is the explicit approval to execute the displayed signing-key plan. After confirmation, run `scripts/setup/signing-key.js --generate --project "<esprojPath>"` only for the confirmed **Auto-generate and assign a new project signing key** plan (accept `created: false` concurrency success); for either use-existing plan, reuse the already validated `signingKeyPath` without calling `--generate`. Save the result's path/fingerprint and run `scripts/editor/set-signing-key.ts`. Never overwrite, regenerate, print, upload, copy, delete, or silently chmod a private key. If generation/validation/assignment fails, offer the existing-key or manual **Project Settings → SPK Settings → Signing Key** recovery as an exceptional prompt; do not generate another key.

## State this reference owns

- `signingKeyPlan`, `signingKeyPath`, `signingKeyFingerprint`: preserve a valid assigned key; otherwise plan the supplied key, a valid existing project-local key, or project-local generation only when the default path is missing. Never create a key until confirmation, and never read, print, copy, upload, or delete private-key contents.
