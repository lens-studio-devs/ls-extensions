---
name: specs-27-migration
description: >
  Migrate a Lens project from Spectacles (2024) to SPECS 27 APIs: WebView, Remote Media,
  Camera, Depth, Motion Controller, SyncKit, VoiceML→ASR, RemoteReferenceAsset→Supabase.
  Use when migrating or porting a Lens to SPECS 27, or about deprecated APIs.
user-invocable: true
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Migrate Spectacles (2024) Lens to SPECS 27

Migrate a Lens project's JavaScript/TypeScript code from deprecated Spectacles (2024)-era APIs to their
SPECS 27 replacements.

Tool naming, deferred schemas, and ask/spawn semantics: see `lens-studio-field-notes` Hard Rule 2 / Cross-runtime orchestration.

## Instructions

### 1. Upgrade the Project to the Latest Lens Studio Version

Before anything else, upgrade the project file to the current Lens Studio format using the
Lens Studio CLI `project-update` command. This ensures the project metadata, scene format,
and asset references are compatible with the latest editor before packages or APIs are
migrated.

The upgrade also re-bootstraps Lens Studio's project-scoped MCP server, so this step
**ends by stopping and returning control to the user** — you cannot finish the migration
in the same editor session you started it in.

#### 1a. Locate Lens Studio (and lock the version for the whole skill)

Find the Lens Studio binary. Check these paths in order and use the first one that exists:

```
/Applications/Lens Studio.app/Contents/MacOS/Lens Studio
/Applications/Lens Studio 5.app/Contents/MacOS/Lens Studio
```

If neither exists, ask the user where Lens Studio is installed. Always quote the path in
shell commands since it contains spaces.

**Capture two values from this step and reuse them everywhere below:**

- `<LENS_STUDIO>` — the binary path, e.g. `/Applications/Lens Studio.app/Contents/MacOS/Lens Studio`. Used for every `--exec` CLI call (1d, 1e, 1f).
- `<LENS_STUDIO_APP>` — the `.app` bundle path, derived by stripping `/Contents/MacOS/Lens Studio` from `<LENS_STUDIO>`, e.g. `/Applications/Lens Studio.app`. Used for the GUI launch (1h).

Many machines have multiple Lens Studio installations (e.g. an `/Applications` install plus
a developer debug build under `~/Snapchat/Dev/...`). Pick one binary up front and thread it
through every subsequent step so the CLI upgrade and the GUI launch use the same install
(the version-mismatch risk this avoids is detailed at Step 1h).

If the user has multiple Lens Studio installations and you cannot tell which one they want from context, ask — do not silently pick.

#### 1b. Locate the project file

Find the `.esproj` file in the Lens project directory. Ask the user if the project
directory is not obvious from context.

#### 1c. Record the current project version

Read the top of the `.esproj` file and capture the existing `studioVersion` block
(`major.minor.patch`). You'll use this to report old → new to the user, and to detect a
no-op upgrade so you can skip ahead.

#### 1d. Dry-run first

Run a dry-run to preview what will change. The `project-update` command is invoked via
`--exec` and takes the project path with `-f`:

```bash
"<LENS_STUDIO>" --exec project-update -f "<PROJECT>.esproj" --dry-run
```

Show the output to the user so they can see what the upgrade will do.

#### 1e. Apply the update

Run the actual upgrade:

```bash
"<LENS_STUDIO>" --exec project-update -f "<PROJECT>.esproj" --force
```

The `--force` flag bypasses the interactive confirmation dialog that would otherwise block
in headless mode. The CLI does not always exit cleanly after the update — wait until the
new `studioVersion` is written to the file (see 1g), then terminate the process if it
hasn't already.

If the user wants to write the updated project to a different directory (preserving the
original), use `-o <dir>` as well.

#### 1f. Save the project via plugin script

`project-update` rewrites the `.esproj` header in place, but assets and sub-files that
were migrated in memory are not always persisted. Run the bundled `save-project.js`
plugin script to open the now-upgraded project and re-save it, flushing all
asset/sub-file changes to disk:

```bash
"<LENS_STUDIO>" --exec run-script \
  -f "<SKILL_DIR>/scripts/save-project.js" \
  -a "<PROJECT>.esproj"
```

`<SKILL_DIR>` is this skill's root directory (the folder containing this `SKILL.md`).
The script opens the project, calls `model.project.saveTo(<same-path>)`, and logs
`PROJECT_SAVED: <path>` on success. Wait for that log line, then terminate the process
if it hasn't exited.

#### 1g. Confirm the upgrade

Read the `.esproj` file again and check the `studioVersion` block. Compare against the
value captured in 1c:

- **If versions match (no-op upgrade)** — the project was already current. Skip 1h–1i and
  proceed to Step 2 in the current session.
- **If versions differ** — report the old and new version to the user, then continue with
  1h.

#### 1h. Re-launch Lens Studio with the updated project

Before launching, make sure no other Lens Studio instance is already running — a stale
instance from a different installation will hold port `50040` and the new GUI you launch
will fail to boot its MCP server:

```bash
pgrep -lf "Lens Studio" | grep -v crashpad | grep -v QtWebEngine
```

If anything is listed, ask the user whether to terminate it (don't kill silently — they
may have unsaved work in another project).

Launch Lens Studio in GUI mode with the upgraded project, **using the exact `.app` bundle
path captured in 1a** (not the bare app name). Using `open -a "Lens Studio"` triggers a
macOS LaunchServices lookup that can resolve to a *different* installation than the one
the CLI just upgraded with — producing a "Project Version Warning" dialog when the build
numbers diverge:

```bash
open -a "<LENS_STUDIO_APP>" "<PROJECT>.esproj"
```

Confirm Lens Studio is up **and that it's the right installation**:

```bash
pgrep -lf "Lens Studio" | grep -v crashpad | grep -v QtWebEngine
lsof -nP -iTCP:50040 -sTCP:LISTEN
```

You should see a process whose executable path matches `<LENS_STUDIO>` from 1a, and port
`50040` in `LISTEN` state. If the running process is from a different installation,
something went wrong with LaunchServices — terminate it and relaunch using the full
`<LENS_STUDIO_APP>` path.

#### 1i. Verify the project's `.mcp.json` was written

When Lens Studio starts with a project loaded, it writes a project-scoped `.mcp.json` to
the project root. This file is what allows Claude Code / Codex CLI / any compatible editor
to discover and connect to the Lens Studio MCP server when launched in that directory.

Check that the file exists at `<PROJECT_DIR>/.mcp.json`. If it's missing, wait a few
seconds for Lens Studio to finish initializing and re-check. If it still doesn't appear,
surface the issue to the user.

#### 1j. Stop and hand control back to the user

You **cannot** complete the migration in your current editor session. Step 2 needs the
Lens Studio MCP tools, and those are registered when the editor starts — your current
process began before Lens Studio's MCP server existed. Calling the MCP via direct HTTP
is forbidden by the project's hard rule.

Tell the user, then stop and yield control:

> The project has been upgraded from vX.Y.Z to vA.B.C and Lens Studio is now running with
> the updated project. `.mcp.json` is in the project root.
>
> **Please close your editor (Claude Code / Codex CLI / etc.) and re-launch it from this
> project directory** so it picks up the Lens Studio MCP connection. If your editor
> supports resuming sessions (Claude Code's `--resume` does), you can resume this
> conversation and I'll continue from Step 2. Otherwise, just invoke the
> `/specs-27-migration` skill again — I'll detect that the upgrade is
> already done and skip ahead.

Do not continue past this point in the current session.

### 2. Update All Packages with Pull Update

With the project now on the latest Lens Studio version (and the editor restarted so MCP
tools are available), bring every installed package to the latest available Asset Library
version. Newer package versions may already include SPECS 27 API support and can reduce
the number of code changes needed in later steps.

**This step requires a running Lens Studio MCP connection** (the `ExecuteEditorCode` MCP tool).
If the tools are still not present, the user has not yet restarted their editor — stop and
remind them.

Use the [`update-lens-packages`](../update-lens-packages/SKILL.md) skill and tell it to
update all updatable packages. That skill uses the supported pull-update flow:

1. list installed `NativePackageDescriptor` assets;
2. check `registry.canPullUpdate(desc)`;
3. call `registry.pullUpdate(desc)` for each selected package;
4. re-list installed packages and report old/new versions.

If you need an inline fallback instead of invoking the skill, run
`references/pull-update-packages.md` in one `ExecuteEditorCode` call. It mirrors the same
`canPullUpdate` / `pullUpdate(desc)` workflow for all updatable packages. Set
`timeoutMs` on that `ExecuteEditorCode` call to `300000`; the loop is synchronous and
blocking, but multiple Asset Library downloads can exceed the default timeout.

Notes:

- `pullUpdate` updates a package to the most recent version available in the Asset
  Library. It is synchronous/blocking but may take time while package assets are
  downloaded and updated: use a longer `ExecuteEditorCode` timeout (typically
  `timeoutMs: 300000`) for update loops, but do not add task-manager waits or polling
  for `pullUpdate` itself. Re-list packages after the call returns to verify the update.
  If a specific version is required, use the version-selection workflow in the
  `update-lens-packages` skill instead of blindly pulling latest.
- If `before` already matches `after`, everything was already up to date for the
  available pull-update candidates.
- If `canPullUpdate` remains `true` after an update attempt, report it as a package that
  still advertises an available pull update and continue only after noting the risk to
  the user.
- Package renames between versions are common (e.g., "Remote Service Gateway" →
  "RemoteServiceGateway", "Spectacles 3D Hand Hints" → "Spectacles3DHandHints"). After
  the rename, the registry may install the new descriptor alongside the legacy-named
  one rather than retiring the old one — both show up in `assetManager.assets`. The
  legacy descriptor is dead weight; the new one is the live install. Surface duplicate
  name pairs to the user. Automated descriptor deletion is out of scope for this skill.

Report `before` vs `after` to the user as a table showing which packages changed,
renamed, or appeared as new transitive dependencies. Flag any duplicate-name pairs
left by a rename. If no versions changed, note that everything was already on a
compatible version and continue.

### 3. Stabilize the Compile After Package Updates

Before scanning for Spectacles (2024) → SPECS 27 API usage, make sure the project compiles
cleanly on the new package versions. Package updates regularly introduce three classes of
breakage that are independent of the Spectacles (2024) → SPECS 27 migration but will block — or silently
mask — the deeper migration work in Steps 4–5:

1. **Bare-name import paths** (`TS2307: Cannot find module ...`) — see **3b**.
2. **Renamed / removed package APIs** (`TS2339: Property 'X' does not exist on type 'Y'`) — see **3c**.
3. **Custom user-attached fields** — also `TS2339`, but the property was user-invented and
   never declared by the package — see **3c**.

The order matters: until (1) is fixed, the TypeScript compiler short-circuits on the
import errors and (2) / (3) stay hidden. Work the loop below.

#### 3a. Recompile and triage

Invoke the `RecompileTypeScriptTool` MCP tool and inspect the error list.

- `TS2307: Cannot find module '...<PackageName>/...'` → go to **3b**.
- `TS2339: Property '<X>' does not exist on type '<PackageClass>'` → go to **3c** (after
  3b is clean).
- No errors → skip to Step 4.

#### 3b. Fix bare-name package import paths

Read `references/package-path-suffix.md` and apply its detection + replacement procedure.
This reference is **generic** — it works for any package, not just SIK. After the
replacement, return to **3a**.

#### 3c. Resolve `TS2339` errors

For each unique `Property '<X>' does not exist on type '<Class>'` error:

1. **Check if the package itself declares `<X>`.**

   ```bash
   grep -rn "<X>" "Assets/<Package>.lspkg/" 2>/dev/null
   ```

   - **Hits inside the package** → the property exists under a different access path
     or was moved. This is package API drift. For SIK, read `references/sik-api-drift.md`
     for the known mapping table. For other packages, search the package source for the
     likely replacement and consult that package's own changelog.
   - **No hits** → the property was never declared by the package. It's a custom
     user-attached field. Read `references/custom-fields-on-packages.md` for the
     option set; **do not auto-apply** — present options to the user and let them choose.

2. Apply the chosen fix.

3. Return to **3a** and recompile.

#### 3d. Stop condition

Stay in the 3a → 3b/3c loop until either:

- The compile succeeds with zero errors, **or**
- The only remaining errors are about Spectacles (2024) APIs that are migration targets in
  Steps 4–5 (e.g., the user code uses `Request`'s now-protected constructor, or imports
  `RemoteServiceModule` whose type still exists but should be swapped in Step 5). These
  are not Step 3 work — note them and move on.

Report the final compile state to the user before continuing.

### 4. Scan the Lens Project

The project directory is already known from Step 1.

Search the project's `.js` and `.ts` files for usage of any deprecated API. Run these
searches in parallel and record every file + line that matches.

**Scope: skip matches inside `.lspkg/` directories.** Anything under
`Assets/<Package>.lspkg/` is package-internal code maintained by the package author and
already handled by the package update in Step 2. Hits there are not lens-level
dependencies and do not need user-facing fixes. Concretely, exclude `.lspkg/` from every
grep, e.g.:

```bash
grep -rn "<Pattern>" Assets --include="*.ts" --include="*.js" \
  | grep -v "\.lspkg/"
```

This rule matters most for `MotionController`: in any Lens that uses SpectaclesInteractionKit,
SIK consumes `MotionControllerModule` internally for the mobile-phone input path. Those hits
live in `Assets/SpectaclesInteractionKit.lspkg/Providers/MobileInputData/` and do **not** mean
the Lens depends on a motion controller — they're SIK plumbing. Filter them out before deciding
whether the Motion Controller migration applies.

If after filtering a pattern has zero remaining matches, treat its migration area as not
applicable in Step 5.

| Pattern to search | Migration area |
|---|---|
| `RemoteServiceModule` | WebView / fetch / WebSocket / HTTP |
| `remoteServiceModule` | WebView / fetch / WebSocket / HTTP (instance refs) |
| `loadAsImageTexture` | Remote Media |
| `loadAsVideoTexture` | Remote Media |
| `loadAsGltfAsset` | Remote Media |
| `loadAsAudioTrackAsset` | Remote Media |
| `RemoteReferenceAsset` | Remote Assets (Snap Cloud manual migration) |
| `StereoCameraModule` | Camera |
| `stereoCameraModule` | Camera |
| `CameraRawModule` | Camera |
| `DepthTextureProvider` (not `DepthModule`) | Depth |
| `WorldDepthTextureProvider` | Depth |
| `sampleDepthAtPoint` | Depth |
| `MotionController` | Motion Controller |
| `StorageProperty<` | SyncKit StorageProperty generics |
| `: StorageProperty<` | SyncKit StorageProperty generics (annotations) |
| `as StorageProperty<` | SyncKit StorageProperty generics (casts) |
| `SnapshotBufferOptions<` | SyncKit StorageProperty generics |
| `SnapshotBufferOptionsObj<` | SyncKit StorageProperty generics |
| `StorageProperty.manual` | SyncKit StorageProperty generics (string-literal propertyType) |
| `StorageProperty.auto` | SyncKit StorageProperty generics (string-literal propertyType) |
| `getEqualsCheckForStorageType` | SyncKit StorageProperty generics |
| `getLerpForStorageType` | SyncKit StorageProperty generics |
| `VoiceMLModule` | Speech transcription (VoiceML → ASR) |
| `VoiceML.ListeningOptions` | Speech transcription (VoiceML → ASR) |
| `startListening` | Speech transcription (VoiceML → ASR) |
| `stopListening` | Speech transcription (VoiceML → ASR) |
| `onListeningUpdate` | Speech transcription (VoiceML → ASR) |
| `NlpKeywordModelOptions` | Voice command (removed — no ASR equivalent) |
| `NlpIntentsModelOptions` | Voice command (removed — no ASR equivalent) |
| `enableSystemCommands` | Voice command (removed — no ASR equivalent) |
| `KeywordDetectionController` | Voice command (removed — no ASR equivalent) |
| `AudioSpectrogram` | Voice command (removed — no ASR equivalent) |
| `SpeechCommandsLabels` | Voice command (removed — no ASR equivalent) |
| `LeaderboardModule` | Leaderboard |
| `leaderboardModule` | Leaderboard (instance refs) |
| `Leaderboard.UsersType` | Leaderboard |
| `Leaderboard.OrderingType` | Leaderboard |

Present a summary table of findings to the user before making any changes. Group by migration
area and show file paths and line numbers. If nothing is found, tell the user the Lens is
already compatible and stop.

### 5. Apply Migrations

For each migration area that matched in Step 4, read the linked reference file and apply its
procedure. Work through matched areas in the order listed below; **skip areas with no
matches** — do not read their reference files.

Show the user what changed after each area.

---

#### WebView / fetch / WebSocket / HTTP

**Summary:** Direct module swap — `RemoteServiceModule` → `InternetModule`. Method signatures
are identical. Exception: `createAPIWebSocket` stays on `RemoteServiceModule`.

**Procedure:** read `references/migration-webview-internet.md`.

---

#### Remote Media and Remote Assets

**Summary:** Two parts. (1) The `loadAs*` URL methods become `loadResourceAs*`, routed through
`InternetModule.makeResourceFromUrl`. (2) `RemoteReferenceAsset` assets are re-hosted on a
Supabase / Snap Cloud bucket and their `downloadAsset` consumers rewritten to
`RemoteMediaModule` — now automated end-to-end via the asset's `metadata.resource.url`.

**Procedure:** read `references/migration-remote-media.md`. For the `RemoteReferenceAsset`
part, it will direct you to `references/remote-asset-supabase-migration.md` (which uses
`assets/RemoteSupabaseLoader.ts` and `scripts/upload_to_supabase.py`).

---

#### Camera

**Summary:** Module swap to the unified `CameraModule`, loaded via `require()` rather than
an `@input` and accessed with a request/response pattern.

**Procedure:** read `references/migration-camera.md`.

---

#### Depth

**Summary:** Paradigm change, not a 1:1 swap — show the user before/after code and have
them confirm the new session-based flow fits their Lens logic before finalizing.

**Procedure:** read `references/migration-depth.md`.

---

#### Motion Controller

**Summary:** Signatures unchanged, but mobile-phone-as-controller is gone on SPECS 27, so
this is a UX recommendation only: **do not auto-insert code** — ask the user where and how
they want the no-controller notification shown.

**Procedure:** read `references/migration-motion-controller.md`.

---

#### SyncKit StorageProperty Generics

**Summary:** Type-only change — generics take a `StorageTypes` enum member instead of a
TS primitive; runtime values stay as primitives, so only annotations and `propertyType`
arguments change.

**Procedure:** read `references/migration-synckit-storage.md`.

---

#### Leaderboard

**Summary:** Replace the native leaderboard with a SnapCloud/Supabase-backed one (requires
one-time DB setup and a SupabaseProject asset). Friends-mode and auto-reset intervals are
not available in SnapCloud — inform the user if these were in use.

**Procedure:** read `references/migration-leaderboard.md`.

---

#### Speech transcription (VoiceML → ASR)

**Summary:** Migrate **free-form transcription** to `LensStudio:AsrModule`. **Voice-command
flows cannot move to ASR** (NLP keyword/intent
models, `enableSystemCommands`, custom limited-vocabulary ML detectors) — ASR has no
keyterm bias today, so short target words frequently fail to register at all and homophones
routinely fire false positives (e.g. a target keyword of "two" comes back as "to" or "too";
"no" as "know"; "right" as "write"). For voice-command matches the procedure **removes the
VoiceML voice-command code** and warns the user that those voice commands no longer work.

**Procedure:** read `references/migration-speech-voiceml-asr.md`.

---

### 6. Final TypeScript Compile Check

Before running the Lens, confirm there are no TypeScript errors remaining. Migrations
in Step 5 can introduce subtle type issues that the per-area edits didn't catch (e.g.
a missed call site, a stale import).

Invoke the `RecompileTypeScriptTool` MCP tool one final time. Expected outcomes:

- **`status: "succeeded"`** — proceed to Step 7.
- **`status: "failed"`** — read the `errors` array. For each error:
  - `TS2307: Cannot find module ...` → return to Step 3b. Something is still importing
    a bare-name package path that the new package no longer exposes.
  - `TS2339: Property 'X' does not exist on type 'Y'` → return to Step 3c. Either you
    missed a known SIK rename, or a custom-field decision needs to be revisited.
  - Other errors → investigate the specific call site against the new API surface in
    `Cache/TypeScript/lib/LensifyTS/Declarations/StudioLib.d.ts`. Common patterns:
    - `TS2554: Expected N arguments, but got M` after a signature change.
    - `TS2345: Argument of type 'X' is not assignable to parameter of type 'Y'` after
      a parameter-type tightening.

Loop the recompile until it succeeds. Do not proceed to Step 7 with a failing compile.

### 7. Runtime Validation in the Preview

A clean TypeScript compile does not prove the Lens runs. The most common post-migration
runtime issues — orphaned `@input` fields and outdated package prefab SceneObjects —
are invisible to the compiler and only surface when the Lens loads in the preview.
This step launches the Lens with the appropriate Specs simulation profile and iterates
on any runtime errors until the preview reaches a clean start.

#### 7a. Configure the Preview Panel for the SPECS 27 target

The Preview Panel needs to be set to the latest Specs hardware profile (commonly
referred to as "SPECS 27" in the device dropdown) with the
Environment view mode enabled. Environment view renders the Lens inside a 3D test
environment rather than against a flat camera feed — this matches the actual Specs
runtime closely enough to surface AR-specific runtime errors (hand tracking,
DeviceTracking, world hit-testing) that flat-preview hides.

The exact UI labels and underlying enum values can drift between Lens Studio versions;
**discover the available device options programmatically** rather than hardcoding
strings:

1. Use `ExecuteEditorCode` to enumerate simulation devices. The preview/simulation
   service lives on `pluginSystem` — search for an interface whose methods mention
   `device` / `simulation` / `preview`. The `.esproj` `viewConfig.simulation.device`
   field gives you the property path to set; the available enum members can be
   introspected from the same service.
2. Filter the enumeration for the newest Specs profile — match the entry labeled
   "SPECS 27" (or, if labels have drifted between Lens Studio versions, the highest
   numbered / latest entry that includes the word "Specs").
3. Apply the selection plus environment-view mode via the appropriate property setters.

After configuring, read back the preview state and confirm the device label and view
mode match what you intended. If the discovery cannot find a Specs option, surface the
list of available devices to the user and ask which one to use.

#### 7b. Run the Lens and collect runtime logs

Invoke the `RunAndCollectLogsTool` MCP tool to launch the Lens in the preview and
capture stdout/stderr from the runtime. Wait for the Lens to either reach a steady
state (no new errors arriving) or crash on startup.

Filter the captured logs for runtime errors — anything with `Error:`, `Exception`, or
the specific patterns from the next two sub-steps. Ignore informational logs and known
warnings.

#### 7c. Resolve orphaned `@input` errors

Detection pattern in the logs:

```
Error: Input <fieldName> was not provided for the object <SceneObjectName>
```

This means a script attached to `<SceneObjectName>` declares `@input <fieldName>` but
no value is wired in the Inspector and no inline `require()` provides one. The
migration in Step 5 is the most common cause — type-swapping an `@input` left the
declaration behind, redundant to a `require()` elsewhere in the same file.

**Fix:** read `references/orphan-script-inputs.md` and apply its detection + three-outcome
decision procedure.

Do not ask the user to identify the broken `@input`. The runtime error contains the
field name; you can find the source file by grepping `@input` declarations matching
that name. Apply the fix, then return to **7b** and re-run.

#### 7d. Resolve outdated package prefab SceneObjects

Detection pattern in the logs:

```
Error: <ComponentName>: Outdated <ComponentName> SceneObject detected. Please click on
the <PrefabName> SceneObject in the Scene Hierarchy, then click Revert in the Inspector
Panel.
```

This means a package script detected that a prefab instance in the scene has the
**old** layout from before the package was upgraded. The runtime message instructs the
user to click "Revert" in the Inspector — but that action is **not exposed via the
Editor MCP API**.

**Fix:** read `references/prefab-revert.md` and apply its delete-plus-re-instantiate
procedure (locate SceneObject, verify it has no user content, find the prefab asset,
delete + re-instantiate + save).

If the SceneObject has user-authored children beyond the stock layout, **stop and ask
the user** — they may want to preserve the custom content. Select the SceneObject with
`SetLensStudioSelection` so they can click Revert manually with one click.

After applying, return to **7b** and re-run.

#### 7e. Other runtime errors

Some runtime errors are project-specific and outside this skill's scope (e.g., a
business-logic bug exposed by behavior changes in the new APIs). Surface those to the
user with the log excerpt and stack trace; let them decide whether to fix or defer.

Stop condition for Step 7: the Lens reaches a steady running state in the preview with
no `Input ... was not provided` errors and no `Outdated ... SceneObject detected`
errors. Other unrelated runtime errors do not block — list them in the final summary.

### 8. Summary

After all migrations are complete, present a final summary:

```
Migration Summary
=================
[x] Project Upgrade:               vX.Y.Z -> vA.B.C  (or: already current)
[x] Project saved + relaunched:    .mcp.json present, editor restarted by user
[x] Package Updates:               N packages updated  (or: all already latest)
[x] Compile Stabilization:
    - Bare-name import paths:      N files updated  (or: not applicable)
    - Package API drift (TS2339):  N files updated  (or: not applicable)
    - Custom user fields:          N sites fixed via <chosen option>  (or: not applicable)
[x] WebView / fetch / HTTP:        N files updated  (or: not applicable)
[x] Remote Media (URL->Resource):  N files updated  (or: not applicable)
[x] Remote Assets (Snap Cloud):    manual steps provided  (or: not applicable)
[x] Camera:                        N files updated  (or: not applicable)
[x] Depth:                         N files updated  (or: not applicable)
[x] Motion Controller:             recommendation shown / already handled / not used
[x] SyncKit StorageProperty:       N files updated  (or: not applicable)
[x] Leaderboard:                   N files updated / manual steps provided  (or: not applicable)
[x] Speech transcription -> ASR:   N files updated  (or: not applicable)
[!] Voice commands removed:        N files (no ASR replacement yet — commands no longer work; reimplement when keyterm-biased ASR ships)
[x] Final TypeScript Compile:      clean
[x] Runtime Validation:
    - Orphan @input fixes:         N sites removed  (or: none found)
    - Outdated prefab recreates:   N prefabs recreated  (or: none found)
    - Other runtime errors:        surfaced to user / none
```

Out of scope for this migration and requiring separate investigation: SnapML
quantization, BBG/SPK repackaging, and Smartgate API changes.
