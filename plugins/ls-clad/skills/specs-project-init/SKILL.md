---
name: specs-project-init
description: Initializes and validates Specs-specific Lens Studio project setup after the /lens-studio-router skill has gated app/project/MCP readiness. Checks project state, Camera setup (Perspective + DeviceTracking World), SIK/UIKit packages, SIK prefab presence, Preview Panel device, and optional generator dependencies such as Blender and Node.js. Reports environment status and auto-fixes Lens Studio project settings where safe.
user-invocable: true
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Project Initialization

Validate Specs-specific Lens Studio project setup (Camera, DeviceTracking, SIK/UIKit packages, SIK prefab, Preview Panel device) and warn about missing generator dependencies (Blender, Node.js). Auto-fixes settings where safe.

> **STOP — wrong entry point for a from-scratch build.** If the user's task is to build a Specs experience (meshes + UI + scripts + scene assembly), this skill alone is NOT enough. Invoke `/lens-studio-router` first. Jumping straight to leaf skills skips field-notes' Hard Rules and the asset pipeline, producing broken or unmaintainable output.
>
> **When this skill IS the right call:** status check on an already-open project; spot-check of Camera/SIK/Preview setup; auto-fix in an existing project that's already past the orchestrator phase. In a fresh full-build conversation it is the wrong entry.

## Step 0: Standalone Pre-flight (tool resolution)

This skill uses these Lens Studio MCP tools (bare names): `ListAllPanels`, `VirtualScene`, `ListInstalledPackagesTool`, `InstallLensStudioPackage`, `SearchLensStudioAssetLibrary`, `PreviewPanelTool`, `ExecuteEditorCode`. Resolve them all before Step 1 — tool naming, deferred schemas, and ask/spawn semantics: see `lens-studio-field-notes` Hard Rule 2 / Cross-runtime orchestration.

`PreviewPanelTool` is for Step 3b; `ExecuteEditorCode` is for Step 3a. Skip Step 0 only if at least one Lens Studio MCP tool already ran earlier in this conversation. If the tool-resolution step itself errors (a runtime failure, not a schema-not-loaded error on a specific tool), surface the verbatim error and stop — see the no-HTTP/no-curl rule in `lens-studio-field-notes` Hard Rules.

## Step 1: MCP Connection Gate (blocking)

1. `ListAllPanels`.
2. `VirtualScene { "command": "read" }` — confirms a scene is loaded AND writes `.virtual-scene.json` for Step 2a.
3. `Bash: test -f .virtual-scene.json && wc -c .virtual-scene.json` — a missing or zero-byte file is a scene-load failure.

- **All succeed** → proceed.
- **MCP fails** → stop; tell the user to invoke `/lens-studio-router`.
- **VirtualScene fails / no scene / empty file** → stop; tell the user to open the expected `.esproj` and re-run.

If `ListAllPanels` fails with a schema/validation error, Step 0 was skipped — run the Step 0 tool resolution and retry. Do not continue past this gate without a confirmed MCP connection and a non-empty `.virtual-scene.json`.

## Step 2: Parallel Survey

Run these 4 checks simultaneously (they are independent):

### 2a. Scene Hierarchy Read

Read or grep `.virtual-scene.json` (already written by Step 1) for root objects, their immediate children, IDs, and component types. Reused by Steps 3c (empty-project heuristic), 3d (Camera lookup), and 3f (SIK presence check).

After 3d mutates the Camera, refresh with `VirtualScene { command: "read" }` before 3f.

### 2b. Installed Packages

Call `ListInstalledPackagesTool` with `includeDetails: false` to get all installed packages.

### 2c. Blender CLI Check

Run via Bash:
```bash
test -x /Applications/Blender.app/Contents/MacOS/Blender && /Applications/Blender.app/Contents/MacOS/Blender --version 2>&1 | head -1
```
Capture the version string if available, or note that Blender is not installed.

### 2d. Node.js Check

Run via Bash:
```bash
node --version 2>/dev/null || echo "NODE_MISSING"
```
Capture the version string if available, or note that Node.js is not installed.

## Step 3: Evaluate and Act

Process results from Step 2 sequentially. Each sub-step may modify the scene, so order matters.

### 3a. Project Target (Spectacles)

The project's target platform gates several Specs-only capabilities — most visibly the **ASR Module** (speech-to-text), but also which APIs surface in the Asset Library and which export paths are valid. If the target is left on `Snapchat` while building a Specs Lens, ASR and other Specs-only modules silently fail at runtime.

`Editor.Model.Project.targetPlatform` is a writable property of type `Editor.TargetPlatform` (enum: `Snapchat`, `Spectacles`). Read and set via `ExecuteEditorCode`:

```typescript
const model = pluginSystem.findInterface(Editor.Model.IModel) as Editor.Model.IModel;
const project = model.project;
const current = project.targetPlatform;
const desired = Editor.TargetPlatform.Spectacles;

if (current === desired) {
    return JSON.stringify({ success: true, action: "Already Spectacles" });
}

project.targetPlatform = desired;
return JSON.stringify({
    success: true,
    action: `Set targetPlatform: ${Editor.TargetPlatform[current] ?? current} → Spectacles`
});
```

If the snippet throws (e.g. `targetPlatform` is read-only on this LS version, or the assignment is rejected), surface a `WARN`: *"Project target is not set to Spectacles. Set it manually via Project Settings → Target → Spectacles, or ASR and other Specs-only capabilities will not work."*

### 3b. Preview Panel Device

**Goal:** the Preview Panel must be set to a Specs (stereo) device in **Interactive** mode so the preview renders in stereo with the correct FOV / aspect ratio and accepts SIK hand-interactor input. This step bypasses the scene tools (`/scene-construction`) entirely and calls `PreviewPanelTool` directly.

**Use the `PreviewPanelTool` MCP tool.** It ships with Lens Studio (via the `ChatTools-PreviewTesting` plugin). `setConfig` with `inputType: "Interactive"` requires a `sourcePath` pointing at a scene directory from `listSources.scenes` — passing `inputType: "Interactive"` without `sourcePath` fails with *"Interactive preview expects a scene directory path (use listSources.scenes). Video/image files (.mp4, .jpg, …) require Multimedia mode."* Always two-step it:

**Step 1 — discover sources:**
```
PreviewPanelTool({ action: "listSources" })
```
Returns `{ videos, images, scenes }` as absolute paths. Do not invent paths.

**Step 2 — apply config with a scene from step 1:**
```
PreviewPanelTool({
  action: "setConfig",
  deviceCategory: "stereo",
  inputType: "Interactive",
  sourcePath: "<scenes[0] from step 1, copied exactly>"
})
```

On success, report `Preview Device: FIXED — stereo / Interactive`. To verify, follow up with the `PreviewPanelTool` MCP tool: `PreviewPanelTool({ action: "getConfig" })`.

**If `scenes[]` from step 1 is empty** (older LS version, or no interactive preview scenes shipped): fall back to a device-only call to `PreviewPanelTool` — `PreviewPanelTool({ action: "setConfig", deviceCategory: "stereo" })` (omit both `inputType` and `sourcePath`). This sets the stereo device but leaves the input source untouched. Surface a `WARN`: *"Interactive preview not available in this Lens Studio version (no scenes in listSources). Device set to stereo; configure input mode manually in the Preview panel if needed."*

**Fallback (older Lens Studio without `PreviewPanelTool`):** if the `PreviewPanelTool` MCP tool cannot be resolved by its bare name in this runtime (the tool is genuinely absent, not merely unresolved), surface a `WARN`: *"Preview Panel cannot be auto-configured (PreviewTesting plugin missing). Open the Preview panel and select a Specs device in Interactive mode."* Do NOT fall back to custom preview setup through the `ExecuteEditorCode` MCP tool here — preview-panel automation is version-specific and belongs behind `PreviewPanelTool`.

### 3c. Empty Project Detection

From the root objects in `.virtual-scene.json`: a project is "empty" if all root objects are default Lens Studio objects (`Camera`, `Main Camera`, `Light`, `Directional Light`, `Render Output`, `Render Target`, case-insensitive) OR the root count is ≤ 2.

If empty: tell the user "This appears to be a new/empty project. I'll configure it for Specs development." and continue — Steps 3d-3f cover the setup. Do not invoke `/new-template` unless the user explicitly asks for a full scaffold. Otherwise: report the root count and continue.

### 3d. Camera Setup (VirtualScene)

Specs requires a root Camera with `cameraType: Perspective` AND a `DeviceTracking` component in `World` mode — without world tracking, SIK interactions and spatial features don't work.

From the Step 2a snapshot, find the root Camera (default name `Camera`; older templates use `Main Camera`). If neither exists, warn and ask the user to add a Camera manually — don't create one from scratch (render-target wiring is hard to automate). Then build a single `apply` containing only the writes that are actually needed:

```json
{
  "command": "apply",
  "instructions": {
    "modify": {
      "@sceneObject:Camera": {
        "components.Camera.cameraType": { "value": "Perspective", "type": "enum", "enumType": "Editor.Components.CameraType" },
        "_addComponents": [
          {
            "type": "DeviceTracking",
            "properties": {
              "deviceTrackingMode": { "value": "World", "type": "enum", "enumType": "Editor.Components.DeviceTrackingMode" }
            }
          }
        ]
      }
    }
  }
}
```

Adjust based on the snapshot:
- Use `@sceneObject:Main Camera` if that's the actual name.
- Drop `cameraType` if already `Perspective`.
- If `DeviceTracking` already exists, drop `_addComponents` and write `components.DeviceTracking.deviceTrackingMode` with the same enum payload directly.
- If both are correct, skip the apply entirely.

**On error:** `Target not found` → name mismatch, refresh the snapshot. `Invalid enum value '...' for type '...'` → `enumType` path drifted; copy the exact `type` field for that property from `.virtual-scene.json` and retry.

**3d must complete before 3f** — the SIK prefab depends on world tracking being configured.

### 3e. Package Installation

From the Step 2b list, check for `SpectaclesInteractionKit` and `SpectaclesUIKit`. If either is missing, invoke `/ensure-package-installed` with `package_name = "SpectaclesUIKit"` — it resolves the dependency chain (UIKit depends on SIK, so SIK installs first), searches the Asset Library, installs, and verifies. After it returns, re-call `ListInstalledPackagesTool` and confirm both appear.

If installation fails, warn with manual instructions: "Install via Window > Asset Library in Lens Studio."

### 3f. SIK Prefab (VirtualScene)

Grep the (3d-refreshed) `.virtual-scene.json` for a root SceneObject named `SpectaclesInteractionKit`. If present, OK. If missing and SIK is installed (3e), instantiate at root:

```json
{
  "command": "apply",
  "instructions": {
    "create": [
      {
        "id": "$temp:sik",
        "name": "SpectaclesInteractionKit",
        "_prefab": "@asset:SpectaclesInteractionKit.lspkg/Prefabs/SpectaclesInteractionKit.prefab"
      }
    ]
  }
}
```

The SIK prefab supplies the InteractionManager, HandInteractors, and core interaction systems; root placement (omit `parentId`) is required for SIK to function.

**On `Asset not found at path`:** the package was imported under a different path. Check `Assets/` for the actual `.lspkg` location and adjust the `@asset:` ref, OR fall back to `asset-graphql` `allAssets(nameContains: "SpectaclesInteractionKit", typeFilter: "ObjectPrefab")` and retry with `"_prefab": "@id:<uuid>"`. (Do NOT use `assetsByName(..., assetType: ...)` — the arg name is `typeFilter`, not `assetType`.) If it still fails, warn: "Drag `Assets/SpectaclesInteractionKit.lspkg/Prefabs/SpectaclesInteractionKit.prefab` from the Asset Browser into the Scene Hierarchy."

### 3g. Generator Dependencies (warnings only)

Based on Steps 2c/2d:

- **Blender** (`/build-mesh` voxel backend — the only rigged-GLB path) — soft warning only when BOTH Blender is missing AND no AI backend (SPECS Text-to-3D / FAST3D) is reachable. The AI backends handle static meshes without Blender, so Blender alone being absent is fine for static-only experiences. If Blender is missing AND an AI backend is reachable, warn: `Blender CLI not found. The voxel backend (rigged GLBs, blocky aesthetic) is unavailable; animated content can still be code-authored via /mesh-builder-scripting. Install from https://www.blender.org/download/ to enable rigged-GLB exports.` If Blender is missing AND no AI backend is reachable, warn: `Blender CLI not found and no AI mesh backend (SPECS / FAST3D) reachable. GLB generation is unavailable — only code-authored MeshBuilder meshes (/mesh-builder-scripting) are possible. Install Blender, or sign in to Lens Studio / check the MCP connection to enable the AI backends.`
- **FAST3D MCP** — probe whether the `GenerateFast3DAssets` MCP tool resolves by its bare name in this runtime: `OK` if it resolves, `Unreachable` otherwise. No install link — this is a server-side capability.
- **SPECS Text-to-3D** — surface a line in the report: `OK` when the `ExecuteEditorCode` MCP tool resolves in this runtime AND the user is signed in to Lens Studio (sign-in is gated upstream by `/lens-studio-router`'s Gate phase — this skill does not re-check it), `Unreachable` otherwise. No install link — server-side + signed-in-session capability.
- **Node.js** (used by `/build-sfx`, `/build-music`, AND `/build-mesh`'s GLB tooling — download/normalize/analyze) — if missing, warn: `Node.js not found. Sound-effect and music generation via /build-sfx and /build-music will not work, and /build-mesh's GLB download/normalize tooling is unavailable. Install from https://nodejs.org/ or an approved package manager.`

Backend choice is owned by `/build-mesh`'s Backend menu (SPECS / FAST3D / code-authored MeshBuilder / voxel) — this skill only reports which backends are reachable.

All warnings are non-blocking — the build proceeds, only the affected backends are unavailable. The build only fully fails when ALL of {SPECS, FAST3D, Blender, Node} are unreachable AND the experience needs a GLB mesh (code-authored MeshBuilder meshes need none of them).

## Step 4: Report

Output a summary table showing all check results. Each Status cell must be exactly ONE of: `OK`, `FIXED`, `ADDED`, or `WARN` — pick the value that matches what actually happened in this run. **Never output a slash-separated combo** like `OK/FIXED` or `OK/ADDED` — those were template artifacts in older versions, not valid statuses.

**Status key:**
- `OK` — already correct on arrival; no action taken
- `FIXED` — the skill auto-corrected this setting (e.g., set the project target, switched the preview device, set camera type)
- `ADDED` — the skill created something that didn't exist (e.g., installed a missing package, added the SIK prefab to the scene)
- `WARN` — non-blocking issue that couldn't be auto-fixed; put the reason in Detail

Representative example (your row values depend on what actually happened):

```
## Environment Ready

| Check           | Status | Detail                              |
|-----------------|--------|-------------------------------------|
| MCP Connection  | OK     | Connected, scene loaded             |
| FAST3D MCP      | OK     | GenerateFast3DAssets reachable      |
| SPECS Text-to-3D| OK     | ExecuteEditorCode + signed in       |
| Blender CLI     | OK     | v4.x at /Applications/Blender.app   |
| Node.js         | OK     | v20.x                               |
| Project Target  | FIXED  | Set to Spectacles                   |
| Preview Device  | FIXED  | Set to stereo / Interactive         |
| Project State   | OK     | Existing project, 7 root objects    |
| Camera Setup    | OK     | Perspective + DeviceTracking World  |
| SIK Package     | ADDED  | Installed from Asset Library        |
| UIKit Package   | OK     | Installed                           |
| SIK Prefab      | ADDED  | Inserted at scene root              |

Environment ready.
```

**Do NOT append a question at the end** (no "What would you like to build?", no "Ready — what's next?"). The skill's job ends with the status table — the orchestrator (Phase 0.5) or the user will name the next task.
