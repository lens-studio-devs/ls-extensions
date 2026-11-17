---
name: specs-project-init
description: Initializes and validates Specs-specific Lens Studio project setup after the /lens-studio-router skill has gated app/project/MCP readiness. Fires one verbatim setup script that sets the project target, Camera (Perspective + DeviceTracking World), and preview simulation (SPECS 27 stereo + Interactive), and instantiates the IK prefab when the package is installed. Reports readiness, installs UIKit and verifies its IK dependency on a miss, and warns about missing generator dependencies (Blender, Node.js).
user-invocable: true
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Project Initialization

Validate Specs-specific Lens Studio project setup by firing one deterministic, idempotent setup script (`references/specs-setup.ts`) that configures the project target, the Camera (Perspective + DeviceTracking World), the preview simulation (SPECS 27 stereo + Interactive), and the IK prefab — then install UIKit and verify its IK dependency if either package is missing, and warn about missing generator dependencies (Blender, Node.js).

> **STOP — wrong entry point for a from-scratch build.** If the user's task is to build a Specs experience (meshes + UI + scripts + scene assembly), this skill alone is NOT enough. Invoke `/lens-studio-router` first. Jumping straight to leaf skills skips field-notes' Hard Rules and the asset pipeline, producing broken or unmaintainable output.
>
> **When this skill IS the right call:** status check on an already-open project; spot-check of Camera/IK/preview setup; auto-fix in an existing project that's already past the orchestrator phase. In a fresh full-build conversation it is the wrong entry.

## Step 0: Standalone Pre-flight (tool resolution)

This skill uses these Lens Studio MCP tools (bare names): `ExecuteEditorCode`, and — only when the setup script reports IK or UIKit is not installed — `SearchLensStudioAssetLibrary` and `InstallLensStudioPackage`. Resolve them before Step 1 — tool naming, deferred schemas, and ask/spawn semantics: see `lens-studio-field-notes` Hard Rule 2 / Cross-runtime orchestration.

`ExecuteEditorCode` runs the verbatim `references/specs-setup.ts` (Step 1); that single call is also the liveness + project gate, so there is no separate scene read. Skip Step 0 only if at least one Lens Studio MCP tool already ran earlier in this conversation. If the tool-resolution step itself errors (a runtime failure, not a schema-not-loaded error on a specific tool), surface the verbatim error and stop — see the no-HTTP/no-curl rule in `lens-studio-field-notes` Hard Rules.

## Step 1: Specs setup (one verbatim `ExecuteEditorCode` call)

This is the first real MCP call, so it doubles as the liveness + project gate — no separate scene read is needed.

**Wrong-project guard (fill one line).** Because this script *mutates*, first make sure Lens Studio has the project you intend open — not a different one. Detect the session's project: `ls *.esproj` at the cwd gives the intended `.esproj`; resolve it to an **absolute, symlink-resolved** path — use `realpath` (or `pwd -P`), because Lens Studio reports the *physical* path (`/private/var/…` on macOS, not `/var/…`), and the guard compares exactly after only trimming/trailing-slash normalization. In `references/specs-setup.ts`, set the `EXPECT_PROJECT = ""` line to that path — **this is the only line you may fill in.** The script then refuses to mutate and returns `error=wrong_project_open` (touching nothing) if LS has a different project loaded. If you can't determine a cwd `.esproj`, leave it `""` (guard off) and rely on `/lens-studio-router` having already matched the open project. Via the normal flow the router *does* this match in its Gate phase; this guard is belt-and-suspenders for a direct `/specs-project-init` invocation.

**Fire `references/specs-setup.ts`** as the `code` argument of `ExecuteEditorCode` — pass its exact contents, changing nothing except the `EXPECT_PROJECT` value above (see the header for the load-bearing invariants, e.g. hidden modules must be imported via a computed specifier or the snippet fails to compile). It is **idempotent** and does all the fixed, identical-every-Specs-project setup in one call:

- sets `targetPlatform` → Spectacles (idempotent),
- ensures the root Camera is `Perspective` and has `DeviceTracking(World)` (adds the component if missing),
- sets the preview simulation to the **SPECS 27 stereo** device + **Interactive** input when the panel isn't on a Specs device (a Specs panel keeps the creator's input),
- instantiates the `InteractionKit` prefab at scene root **if** the IK package is already installed.

It returns a single flat readiness snapshot line (the resulting state — no follow-up status read needed):

```
projectPath=<path>, isAuthorized=<bool>, targetPlatform=<name>, installedPackages=<n>, deviceTracking=World|other|none, sikInstalled=<bool>, uikitInstalled=<bool>, sikPrefab=<bool>[, nextAction=<...>][, errors=<json>]
```

First handle the gate outcomes (the call itself is the liveness + project check — these failure modes are distinct, don't collapse them):

- **Call denied / transport error** (LS/MCP isn't reachable) → the call never ran. Stop and tell the user to invoke `/lens-studio-router`.
- **Returns `error=no_project_open`** → LS is up but no project is loaded (the script guards this and returns a clean sentinel rather than throwing). Stop and tell the user to open the expected `.esproj` and re-run.
- **Returns `error=wrong_project_open`** → Lens Studio has a *different* project open than the cwd `.esproj`; the guard fired **before any mutation**, so nothing changed. Stop, surface the message, and offer to switch via `/lens-studio-router`. Never proceed past this.
- **Returns the `projectPath=…` readiness line** → the intended project is open and setup ran; map the fields below. (An empty scene still returns a normal line — `deviceTracking=none` + a camera warning surface it, no separate check needed.)

Map the returned fields to the Step 3 report rows:

- `projectPath` → confirm it's the project you intended (defense in depth even with the guard); if it's unexpected, treat as a wrong-project case and stop.
- `targetPlatform=Spectacles` → **Project Target** `OK`.
- `deviceTracking=World` → **Camera Setup** `OK`/`ADDED`. `deviceTracking=none` (no root Camera) or `other` → `WARN` (add a Camera manually / check tracking mode).
- Preview is set inside the script; report **Preview Device** `OK`/`FIXED` unless an `errors.preview` entry is present.
- `sikInstalled=true` → **IK Package** `OK`; `uikitInstalled=true` → **UIKit Package** `OK`. Either `false` (with a `nextAction`) → that package is still pending; go to Step 2.
- `sikPrefab=true` → **IK Prefab** `OK`/`ADDED`. `sikPrefab=false` with a `nextAction` → IK still pending; go to Step 2.
- `installedPackages` is the raw installed-package count (informational).
- `isAuthorized=false` → `WARN`: AI model/image generation, Remote Service Gateway tokens, and publish need sign-in — direct the user to sign in via `/lens-studio-router`. Package installs (IK, UIKit) work signed out.
- `errors={...}` present → surface each entry as a `WARN` row with its message; the rest of the setup still applied (each section is isolated in try/catch).

## Step 2: Install IK + UIKit (only if the setup line contains `nextAction`)

If Step 1's line carried a `nextAction` (IK and/or UIKit not installed), install the missing package(s), then re-run the setup script so it can instantiate the IK prefab. Specs projects require **both** InteractionKit and UIKit:

1. **Ensure UIKit first.** Invoke `/ensure-package-installed` with `package_name = "UIKit"`; let package installation resolve its IK dependency. Do not preinstall IK separately.
2. **Re-fire `references/specs-setup.ts`** to read back both packages and instantiate the IK prefab. If UIKit is present but `sikInstalled=false`, ensure `InteractionKit` separately as recovery, then re-run setup. Require `sikInstalled=true`, `uikitInstalled=true`, `sikPrefab=true`, and no `nextAction`; a successful UIKit install alone is not proof of readiness.

If installation fails, warn with manual instructions: "Install UIKit (and its IK dependency) via Window > Asset Library in Lens Studio," and leave **UIKit Package** / **IK Prefab** as `WARN`.

## Step 3: Generator dependencies (warnings only)

Independent of the scene setup — run these Bash/probe checks (they can run concurrently with Step 1):

### Blender CLI
```bash
# Cross-platform: PATH first (Linux apt / any `blender` on PATH), then the macOS app bundle, then the
# common Linux path. macOS installs often aren't on PATH, so the .app fallback still resolves there.
BLENDER="$(command -v blender \
  || (test -x /Applications/Blender.app/Contents/MacOS/Blender && echo /Applications/Blender.app/Contents/MacOS/Blender) \
  || (test -x /usr/bin/blender && echo /usr/bin/blender))"
[ -n "$BLENDER" ] && "$BLENDER" --version 2>&1 | head -1 || echo "BLENDER_MISSING"
```
Soft warning only when BOTH Blender is missing AND no AI backend (SPECS Text-to-3D / FAST3D) is reachable. If Blender is missing but an AI backend is reachable, warn: `Blender CLI not found. The voxel backend (rigged GLBs, blocky aesthetic) is unavailable; animated content can still be code-authored via /mesh-builder-scripting. Install from https://www.blender.org/download/ to enable rigged-GLB exports.` If Blender is missing AND no AI backend is reachable, warn: `Blender CLI not found and no AI mesh backend (SPECS / FAST3D) reachable. GLB generation is unavailable — only code-authored MeshBuilder meshes (/mesh-builder-scripting) are possible. Install Blender, or sign in to Lens Studio / check the MCP connection to enable the AI backends.`

### Node.js
```bash
node --version 2>/dev/null || echo "NODE_MISSING"
```
If missing, warn: `Node.js not found. Sound-effect and music generation via /build-sfx and /build-music will not work, and /build-mesh's GLB download/normalize tooling is unavailable. Install from https://nodejs.org/ or an approved package manager.`

### AI mesh backends (report reachability)
- **FAST3D MCP** — probe whether the `GenerateFast3DAssets` MCP tool resolves by its bare name in this runtime: `OK` if it resolves, `Unreachable` otherwise. No install link — server-side capability.
- **SPECS Text-to-3D** — `OK` when the `ExecuteEditorCode` MCP tool resolves AND the user is signed in (gated upstream by `/lens-studio-router`; `isAuthorized` from Step 1 is the signal), `Unreachable` otherwise.

Backend choice is owned by `/build-mesh`'s Backend menu — this skill only reports which backends are reachable. All warnings are non-blocking; the build only fully fails when ALL of {SPECS, FAST3D, Blender, Node} are unreachable AND the experience needs a GLB mesh.

## Step 4: Report

Output a summary table. Each Status cell must be exactly ONE of: `OK`, `FIXED`, `ADDED`, or `WARN` — pick the value that matches what actually happened this run. **Never output a slash-separated combo** like `OK/FIXED`.

**Status key:**
- `OK` — already correct on arrival; no action taken
- `FIXED` — the skill auto-corrected this setting (e.g., set the project target, switched the preview device)
- `ADDED` — the skill created something that didn't exist (e.g., installed a missing package, added DeviceTracking, instantiated the IK prefab)
- `WARN` — non-blocking issue that couldn't be auto-fixed; put the reason in Detail

Representative example (your row values depend on what actually happened):

```
## Environment Ready

| Check           | Status | Detail                              |
|-----------------|--------|-------------------------------------|
| MCP Connection  | OK     | Connected, scene loaded             |
| Project Target  | OK     | Spectacles                          |
| Camera Setup    | ADDED  | Perspective + DeviceTracking World  |
| Preview Device  | FIXED  | SPECS 27 stereo / Interactive       |
| IK Package     | ADDED  | Installed from Asset Library        |
| IK Prefab      | ADDED  | Inserted at scene root              |
| FAST3D MCP      | OK     | GenerateFast3DAssets reachable      |
| SPECS Text-to-3D| OK     | ExecuteEditorCode + signed in       |
| Blender CLI     | OK     | v4.x at /Applications/Blender.app   |
| Node.js         | OK     | v20.x                               |

Environment ready.
```

**Do NOT append a question at the end** (no "What would you like to build?"). The skill's job ends with the status table — the orchestrator (Phase 0.5) or the user will name the next task.
