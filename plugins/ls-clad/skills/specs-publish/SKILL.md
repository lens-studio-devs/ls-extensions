---
name: specs-publish
description: >-
  Take a Specs/Specs Lens to "submitted for review" in 5 phases (discover, preflight, package, publish, submit). Use when the user wants to publish, submit, release, or ship a Specs Lens. Asks for anything missing instead of stopping.
argument-hint: "[project path | .esproj]"
user-invocable: true
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Publish Lens

**User request:** $ARGUMENTS

Drive a Specs Lens from project → submitted for review. Be mechanical and fast: **carry state forward**, run the expensive export **once**, and whenever something is missing (sign-in, signing key, org, category…) **ask the user and keep going — never just halt.**

## Cross-runtime (Claude Code / Cursor / Codex)

Apply this skill's two interactive primitives — the per-phase progress list and `ACTION_REQUIRED` blocking questions — by **intent**, not literal tool name. Tool naming, deferred schemas, and ask/spawn semantics: see `lens-studio-field-notes` Hard Rule 2 / Cross-runtime orchestration.

**Irreversible-submit hard stop:** if no human can answer in this run at all (fully non-interactive), every `ACTION_REQUIRED` here gates an *irreversible submission step* (sign-in, signing key, org, category, package-id), so **STOP and emit the full ordered checklist** of what the user must fix (with the phase's `reason`/`message`). Never register, upload, or submit with missing or guessed metadata, and never silently skip a gate.

Most phases run pinned Editor API TypeScript via `ExecuteEditorCode`. The must-be-exact logic (production SPK export, authorized API calls) lives in this skill's `scripts/` directory — **run it, don't re-derive it.** Resolve each script by its full path under this skill (`<skill-dir>/scripts/…`): for a `.ts`, read the file and pass its contents to `ExecuteEditorCode`; for a `.sh`, run it with `bash`. Each script returns one JSON object with a `status`; branch on it. `ACTION_REQUIRED` is an "ask, then retry" checkpoint, not a failure.

**Only load `ls-clad:editor-api` if a script fails to compile or execute** — these scripts are pre-written and don't need the contract loaded up front. Loading it pre-emptively costs an extra turn (~15–25 s) for no benefit on the happy path. If you do load it, debug per that skill and retry up to 3×.

## Phases & resources

| # | Phase | Does | Run |
|---|-------|------|-----|
| 1 | Discover | Resolve the `.esproj`; read `packageId` + `lensName` | read the project file (no LS needed) |
| 2 | Preflight | Confirm auth, open project, metadata, signing key | `scripts/preflight.ts` — **as-is** |
| 3 | Package | Save → export production SPK → checksum | `scripts/package.ts` — **as-is** |
| 4 | Publish | Register the release, then upload the SPK bytes | `scripts/authorized-request.ts` (fill CONFIG) + `scripts/upload-spk.sh` |
| 5 | Submit | Submit the release for review | `scripts/authorized-request.ts` (fill CONFIG) |

`preflight.ts` and `package.ts` are **zero-config** — pass the file contents straight to `ExecuteEditorCode`. `authorized-request.ts` has a small CONFIG block at the top: substitute the per-call values **in the copy you send**; don't edit the file on disk.

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

1. **Batch script reads.** Before running Preflight, read `scripts/preflight.ts`, `scripts/package.ts`, `scripts/authorized-request.ts`, and `scripts/upload-spk.sh` in a **single parallel message** with four `Read` calls — not one at a time before each phase.
2. **Three-word label before each `ExecuteEditorCode` / `Bash` script call** — no full sentences, no "Let me…" / "Now I'll…". Use exactly these labels (period included, then call the tool on the next line): `Preflight…`, `Exporting SnapOS Package…`, `Registering release…`, `Uploading SnapOS Package…`, `Submitting for review…`. Skip labels for trivial calls (the parallel `Read` batch, `rm -f` cleanup) — they're obvious from the tool rendering.
3. **No mid-flow result reports** — phases speak through the progress list (`TaskUpdate` on Claude Code), not chat. Never echo `lensId`, `releaseId`, `checksum`, `packageBytes`, or `spkPath` between phases. The label in rule #2 is the only chat output between phases — no follow-up sentence after the call returns. Allowed in chat (and only when genuinely required): a one-line `ACTION_REQUIRED` prompt the user must answer; a `FAILED` summary with `reason` / `message` / `httpStatus` when a phase errors out; the Discover line **"Submitting `<lensName>` (`<packageId>`)"** once after Discover; the final response after Submit returns `submitted`.
4. **In user-visible text (TaskList, chat, errors), call it a "SnapOS Package" — not "SPK".** "SPK" is correct for internal field names, script names (`upload-spk.sh`), and API protocol keys (`spkChecksum`, `data.uploads.spk`); leave those alone. Only the prose the user reads changes.

## State to carry

Track these as soon as they're known; resolve once, reuse everywhere. **Never re-export after a backend-only prompt** (org/category/account) — the cached SPK + checksum still stand.

- `esprojPath`: absolute `.esproj` path resolved in Discover.
- `packageId`, `lensName`: read from the `.esproj`, confirmed by preflight.
- `spkPath`: absolute SPK path returned by package as `packagePath`.
- `cleanupPath`: same as `spkPath`; safe to delete after successful submit when `generatedPackage` is true.
- `generatedPackage`: `true` only for SPKs created by this run (never delete a user-provided SPK).
- `checksum`: base64 SHA-256 of the SPK, returned by package — reuse on every register retry.
- `packageBytes`: SPK size; internal/debug only, never in the final response.
- `orgId`, `categoryId`, `semanticVersion`: only set after the user provided or chose them; otherwise omit.
- `lensId`, `releaseId`: returned by publish/register; needed for upload and submit.
- `portalUrl`: returned by publish; surfaced in the final response.
- `uploadExpiresAt`: ISO 8601 expiry from `data.uploads.spk.expiresAt` — re-register if near expiry before uploading.

## 1 · Discover

- Resolve the `.esproj`: use `$ARGUMENTS` if it's a path; else the single `.esproj` in the cwd; else **ask** the user for the project (don't guess among several).
- Read `packageId:` and `lensName:` from the `.esproj` text and echo **"Submitting `<lensName>` (`<packageId>`)"**. If either is blank, preflight will confirm it — flag it now so the user can fix it in Lens Studio.
- Capture optional inputs only if the user supplied them: `orgId`, `categoryId`, `semanticVersion`. Otherwise discover/prompt them later (don't invent values).

## 2 · Preflight

Run `scripts/preflight.ts` as-is.

- **`READY`** → keep `packageId`, `lensName`, `projectPath`. If `projectPath` ≠ the discovered `.esproj`, the wrong project is open — ask the user to open the right one, then rerun. Else go to Package.
- **`ACTION_REQUIRED`** → if the response has an `issues: [...]` array, present each issue as a blocking question via your runtime's ask facility — on Claude Code, batch them as **one tab per issue inside a single `AskUserQuestion` call** (1–4 questions rendered as tabs); on runtimes without multi-tab asks, ask sequentially. Each question is the issue's `message`; options are `Done` / `Cancel`. The user sees the full list up front, completes them in order, and one Cancel anywhere aborts. After every tab is `Done`, `sleep 2` via Bash and rerun preflight once. If there are more than 4 issues (rare), split into batches of 4 across sequential `AskUserQuestion` calls. If `issues` is absent (auth / project-state failure), follow the single-issue path per **Ask, don't stop**.
- **`FAILED`** → surface `reason` + `message`.

## 3 · Package

Run `scripts/package.ts` as-is. This is the expensive phase — run it **once**.

**If the RPC times out (rare), do not re-export blindly.** The export is synchronous and the timeout lives in `ExecuteEditorCode`, not in the editor itself, so the SPK may already be on disk. Fall back to:

1. `ls "<projectDir>/.export/<projectFileBase>.spk"` — confirm the file exists.
2. Hash it twice ~3s apart with `shasum -a 256` to confirm the file is **stable** (size + digest unchanged between reads). If it's still being written, wait and recheck.
3. Compute the base64 SHA-256 (`shasum -a 256 -b … | awk '{print $1}' | xxd -r -p | base64`) and reuse it as the `checksum`. Set `spkPath`, `cleanupPath`, `packageBytes`, `generatedPackage: true` from disk, then continue to Publish — **don't** re-run `package.ts`.

Only re-run `package.ts` if the SPK is missing or never stabilizes.

- **`EXPORTED`** → save `spkPath` = `packagePath`, plus `cleanupPath`, `checksum`, `packageBytes`, `generatedPackage: true`. Go to Publish.
- **`ACTION_REQUIRED`** (`no_prod_signing_key`, `pending_tasks_unavailable`) → handle, rerun once.

## 4 · Publish (register + upload)

**4a — Register.** Run `authorized-request.ts` with:

```ts
const REQUEST_PATH = "/lenses/publish";
const BODY = { pkgId: "<packageId>", name: "<lensName>", spkChecksum: "<checksum>" };
// add ONLY if set: orgId, categoryId, semanticVersion
const TENANT_ID = "<orgId or ''>";
```

- **`AUTHORIZED_POST_OK`** → inspect `data.status`:
  - `needs_uploads` → keep `lensId`, `releaseId`, `portalUrl`, and `data.uploads.spk` (`.url` + `.headers` + `.expiresAt`). Go to 4b.
  - `needs_metadata` → ask for the missing field/category, retry register with the **cached** SPK + checksum.
  - terminal/other → surface the status and useful IDs; don't guess the next mutation.
- **`ACTION_REQUIRED`** → handle per **Ask, don't stop**, then retry register with the cached SPK + checksum.

**4b — Upload.**

**Before invoking `upload-spk.sh`, check `uploadExpiresAt`.** If `Date.parse(uploadExpiresAt) - Date.now() < 60_000` (less than ~60 s until the signed URL expires — usually because the user took a long time answering a blocking question between register and here), **re-register first** to get a fresh upload target. Reuse the cached SPK + checksum on the re-register; do not re-export. If `uploadExpiresAt` is absent (older backend), skip the check.

Then run `scripts/upload-spk.sh` with:

```bash
SPK_PATH="<spkPath>" UPLOAD_URL="<data.uploads.spk.url>" \
UPLOAD_HEADERS_JSON='<data.uploads.spk.headers as JSON>' SPK_CHECKSUM="<checksum>" \
bash scripts/upload-spk.sh
```

Pass the upload URL and headers directly as environment variables. Do not write presigned upload URLs, upload headers, checksums, or SPK paths to temp files just to work around quoting.

- **`UPLOAD_DONE`** → go to Submit.
- **`ERROR: SnapOS Package checksum changed since publish registration`** → the exported SnapOS Package changed after registration. Rerun Package once, then rerun Register with the new checksum and upload URL. Do not reuse the old upload URL.

## 5 · Submit

Run `authorized-request.ts` with:

```ts
const REQUEST_PATH = `/lenses/<lensId>/submit`;
const BODY = { releaseId: "<releaseId>", wait: true, maxWaitMs: 180000, pollIntervalMs: 1000 };
const TENANT_ID = "<orgId or ''>";
```

- **`AUTHORIZED_POST_OK`** → inspect `data.status`:
  - `submitted` → if `generatedPackage`, `rm -f "<cleanupPath>"` **and** `rmdir "$(dirname "<cleanupPath>")" 2>/dev/null || true` to remove the now-empty `.export/` directory (`rmdir` is non-destructive — it leaves the dir alone if the user has other files there). Never delete a user-provided SPK. Report success.
  - `validating` → report `retryAfterSeconds` and `data.wait`; don't start your own polling loop unless asked.
  - other → report the status and the next required action.

## Ask, don't stop

**Present every `ACTION_REQUIRED` prompt as a blocking question** using your runtime's ask facility, and wait for the answer (see Cross-runtime above). Don't substitute a vague free-form "let me know" and stall — give the user a clear reply contract (the option labels below). **If no human can answer in this run at all**, do not guess: STOP and emit the ordered checklist of what's needed — these are irreversible submit gates (see Cross-runtime).

Two prompt shapes:

1. **User fixes something in Lens Studio UI** (`no_prod_signing_key`, `no_lens_icon`, project mismatch, sign-in needed, MCP unavailable, etc.). Ask one question with two options: **Done** (they completed the action — sleep 2s via Bash, then rerun the failing phase once) and **Cancel** (abort the publish; report the reason). Phrase the question with the exact UI path, e.g. *"Open Project Settings → Lens Icon, then import or generate a Lens icon. Done when ready?"*
2. **User picks from a list** (`CATEGORY_REQUIRED`, `CATEGORY_INVALID`, `needs_metadata`, `ORG_AMBIGUOUS`). Use the backend's `details.categories[]` / `details.orgs[]` as options (label = `displayName`, sorted by `displayOrder` when present). Save the chosen `id` as `categoryId` / `orgId` and retry register with the **cached** SPK + checksum.

If the same `ACTION_REQUIRED` reason returns after one retry, stop with the reason, `message`, and any `details` payload — don't loop.

| Reason | Shape | Ask the user to… | Then |
|--------|-------|------------------|------|
| `not_signed_in`, `no_auth_interface` | UI fix | sign in from the Lens Studio profile menu | rerun preflight |
| MCP / `ExecuteEditorCode` unavailable | UI fix | open/reconnect Lens Studio with the project — if `/mcp` shows `lens-studio` failed, choose **Reconnect**, not **Authenticate** | retry the same code |
| project mismatch (you detected) | UI fix | open the discovered `.esproj` | rerun preflight |
| `no_prod_signing_key` | UI fix | generate **or add** a production signing key in Project Settings → SPECS Settings (reusing an existing key is fine) | rerun preflight/package |
| `no_lens_icon` | UI fix | open Project Settings → Lens Icon, then import or generate a Lens icon | rerun preflight |
| `missing_submission_metadata`, `INVALID_REQUEST` | UI fix | set a package ID + Lens name in the project | rerun preflight/package |
| `SPECS_ACCOUNT_REQUIRED` | UI fix | link/create their Specs account (open `details.setupUrl`) | retry register, cached SPK |
| `ORG_REQUIRED` | UI fix | create/join an org (open `details.setupUrl`) | retry register, cached SPK |
| `ORG_AMBIGUOUS` | pick from list | pick which org owns the submission from `details.orgs` | retry register with `orgId` + `TENANT_ID` |
| `CATEGORY_REQUIRED`, `CATEGORY_INVALID`, `needs_metadata` | pick from list | pick from `details.categories` (label = `displayName`, sorted by `displayOrder`) | retry register with `categoryId` |
| `FORBIDDEN` | pick from list (or UI fix) | pick another listed org, switch accounts, or get access | retry |
| `PKG_ID_REQUIRED`, `PKG_ID_UNAVAILABLE` | UI fix | use a package ID they own | rerun preflight/package if project metadata changes |

For **`FAILED`**, surface `stage`, `reason`, `message`, `httpStatus`, `apiBaseUrl`, and `bodyPrefix` when present — backend validation messages are usually the fastest path to a fix.

## Final response

One short message. Report `<lensName>` submitted, plus `packageId` and `portalUrl` (when present), and `releaseVersion` only when the API returned one. **Do not** recap the phases — the TaskList is the status display. **Do not** mention SPK cleanup, file paths, or any other internal mechanics. Keep `spkPath`, `checksum`, `packageBytes`, `lensId`, and `releaseId` out unless the user asks for debug detail.
