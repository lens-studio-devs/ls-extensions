---
name: specs-ndk
description: Adds a SpecsNDK CoreJs ABI native module into an existing Lens Studio project. Scaffolds C++ and TypeScript NDK controller. Default export is ping(); use --with-rgba-frame for getFrameRGBA().

---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Native Module CLAD (in existing Lens Studio project)

## When to use

- User wants a **new SpecsNDK native module** next to (or inside) an **existing** Lens Studio project.
- User asks to add exports, implement host functions, or fix builds for that module.
- User is doing SpecsNDK + CoreJs ABI work and already has a `.esproj` / `Assets/` tree.

## Prerequisites (always, in order)

0. **Tooling checks (start of every specs-ndk task)**
   - Run **`cmake --version`**; if it fails, follow setup.mdx step 2 before continuing.
   - When NDK is missing: run setup.mdx steps 2–3 (CMake gate, then auth probe); stop on CMake failure or auth gate (HTTP 401/403).

1. **SpecsNDK on disk**
   Before scaffolding or building, verify the SDK root exists:

   - Path: **`$HOME/Dev/SpecsNDK`** (same as `~/Dev/SpecsNDK`).

   If that directory **does not exist**, is **empty**, or lacks the expected toolchain layout, run **`references/setup.mdx`**: **CMake verify (stop + `brew install cmake` if needed)** → dirs → **auth probe (stop + `brew install --cask google-cloud-sdk` + `gcloud auth login` if 401/403)** → download via **`tools/download_specsndk.py`**. On failure, **User-run fallback**. Other SDK path → **`SPECSNDK_ROOT`**.

   Do not skip setup silently when the sandbox blocks **`brew`** or **`python3`** download.

   Module scaffolding is **only** via this skill’s **`tools/scaffold.py`** and templates under **`resources/NativeModule/`**, **`resources/LensStudio/`**, and **`resources/README.md.tpl`**—no other repo.


2. **Existing Lens Studio project**
   Assume the user’s **current workspace or stated path** is (or contains) a Lens Studio project: typically an `.esproj`, `Assets/`, `Assets/NativeModules/` for shipped `.so` files, and TypeScript under `Assets/Scripts/`. **Do not** scaffold or copy a fresh Lens Studio template project (`ModuleLS` / new `.esproj`).

## Instructions

1. **Scaffold the native module and TypeScript controller** into the user’s project:

   - Use **`tools/scaffold.py`** in this skill; templates live in **`resources/NativeModule/`** (C++ / CMake / **`build.sh`**), **`resources/LensStudio/`** (**`NativeModuleDecorator.ts.tpl`**, **`Controller.ts.tpl`**, **`FlippedImage.lspkg`** for RGBA preview), and **`resources/README.md.tpl`** for the generated module README.
   - **`--out`** is the **Lens Studio project root**: the directory that contains **`Assets/`** (and usually the `.esproj`). The script creates **`<ModuleName>/`** under that root with `CMakeLists.txt`, `build.sh`, and sources—i.e. **`--out/<ModuleName>/`** is the native module folder (sibling of `Assets/`).
   - **`--with-rgba-frame`**: When set, the scaffold includes **`getFrameRGBA`** in C++ and TS (**`<FeatureName>FrameRGBA`**, **`getFrameRGBA` on `<FeatureName>NativeExports`**), copies **`resources/LensStudio/FlippedImage.lspkg`** to **`Assets/Prefabs/FlippedImage.lspkg`** on the project whose existing **`Assets/`** matches **`--out`** (creates **`Assets/Prefabs/`** only if needed; does **not** create **`Assets/`** if missing — pass **`--out`** as the real Lens root), then emits the controller’s **`requireAsset("../Prefabs/FlippedImage.lspkg/FlippedImage.prefab")`** (cast as **`ObjectPrefab`**), **`instantiate(cameraObject)`**, **`UpdateEvent`** procedural **`Image`** path, and README notes. **Without this flag**, only **`ping()`** is exported — **do not** copy **`FlippedImage.lspkg`** or assume RGBA preview assets exist.
   - It also writes **`Assets/Scripts/<FeatureName>NativeModule.ts`** (from **`resources/LensStudio/NativeModuleDecorator.ts.tpl`**) and **`Assets/Scripts/<FeatureName>Controller.ts`** (from **`resources/LensStudio/Controller.ts.tpl`**), with class **`{FeatureName}Controller`**, **`FeatureName`** = **`ModuleName`** with a trailing **`Module`** removed when present (e.g. `MyFeatureModule` → `MyFeatureNativeModule.ts`, `MyFeatureController.ts`). If either script already exists, the script **skips** that file unless **`--force`** (same flag as the module folder overwrite).
   - Example (run from the skill directory, or pass an absolute path to `scaffold.py`):
     ```bash
     python3 tools/scaffold.py --name MyFeatureModule --out /path/to/LensProject
     python3 tools/scaffold.py --name MyFeatureModule --out /path/to/LensProject --with-rgba-frame
     ```
     The first form scaffolds **`ping()`** only. With **`--with-rgba-frame`**, also **`getFrameRGBA()`** → **`{ buffer, width, height }`**, **`Assets/Prefabs/FlippedImage.lspkg`** (from the skill), and the controller preview flow in steps 6–8. **Always run step 7** (scene **`ScriptComponent`**) when Lens Studio MCP is available.

   - Default **`OUTPUT_SO_DIR`** in `build.sh` is **`--out/Assets/NativeModules`**. If `Assets/NativeModules` is not under `--out`, edit `OUTPUT_SO_DIR` to the real path.
   - Do **not** create `<FeatureName>LS/`, copy `template/ls/ModuleLS/`, or add a second Lens Studio app tree unless the user explicitly asks.

2. **Lens Studio wiring (user project)**

   - The scaffolded **`Assets/Scripts/<FeatureName>NativeModule.ts`** defines **`@<FeatureName>NativeModule()`** (field marker only — **no load on instantiation**) and a single loader: **`void <FeatureName>NativeModule.load(this, onLoaded)`** from **`onAwake`**, where **`onLoaded`** is any function invoked as **`onLoaded.call(this, lib)`** after **`lib`** is resolved (**`this.onNativeLibraryLoaded`**, arrow, etc.). By default the native module exports **`ping`** only; **`getFrameRGBA`** → **`{ buffer, width, height }`** exists only when the project was scaffolded or updated with **`--with-rgba-frame`** (or you add it manually in C++/TS in lockstep). Keep **`CoreJsOnLoad` / `CoreJsOnUnload`** and host registration style from the template when adding more exports.
   - **Only when `getFrameRGBA` is part of the module** (scaffold **`--with-rgba-frame`** or equivalent manual work): at runtime the controller **`await`s `requireAsset("../Prefabs/FlippedImage.lspkg/FlippedImage.prefab")`** as **`ObjectPrefab`**, resolves the main camera, then **`instantiate(cameraObject)`** under it. **`renderImage`** is **`instanceRoot.getComponent("Component.Image")`**. **Do not** Editor-create a separate **`Image`** for this flow unless the user opts out of **`FlippedImage.lspkg`**. **Ping-only** modules skip asset copies and this runtime path.
   - **Controller in the scene:** step **7** attaches **`Assets/Scripts/<FeatureName>Controller.ts`** via **`ExecuteEditorCode`** (required whenever Lens Studio MCP is available).
   - **Whenever you add or change native exports** in **`assignNativeFunctions`** / the `.cpp` file, update **`Assets/Scripts/<FeatureName>NativeModule.ts`** (**`<FeatureName>NativeExports`** and any frame/helper types) and **`Assets/Scripts/<FeatureName>Controller.ts`** in the same change, with null/type guards during development.


3. **Naming**
   - Canonical **`ModuleName`** = PascalCase identifier ending in `Module` when possible (e.g. `AudioPitchShiftModule`).
   - **`FeatureName`** = `ModuleName` with trailing `Module` removed when deriving defaults.
   - CMake `project`, `add_library`, and `.cpp/.hpp` stems match **`ModuleName`**.

4. **Host functions**
   - Validate arguments; return concrete **`CoreJsAbiValue`**; on error use **`set_string_error_value`** and **`CoreJsAbiValueKindError`**.

5. **Build** (from the scaffolded module directory)
   - Confirm **`cmake --version`** first (prerequisite **0**); do not build if CMake is missing.
   - `bash ./build.sh` or `bash ./build.sh "$HOME/Dev/SpecsNDK"`
   - Or CMake:
     `cmake -S . -B build -DSPECSNDK_ROOT=$HOME/Dev/SpecsNDK -DCMAKE_BUILD_TYPE=Release && cmake --build build`
   - After success, confirm **`lib<ModuleName>.so`** appears under **`Assets/NativeModules/`** when `OUTPUT_SO_DIR` is set.

6. **Native module TypeScript — adding exports**

   When adding exports, extend **`<FeatureName>NativeExports`** and any frame/helper types so the controller sees accurate typings; keep property names aligned with **`set_object_property_from_string`** / module object keys in C++. (Decorator, `.load`, and RGBA wiring are in step 2.)

7. **Attach controller to scene hierarchy (required)**

   Run **after step 1 (scaffold)** on every specs-ndk task when the **`ExecuteEditorCode`** MCP tool is available. Load **`editor-api`** before writing the snippet.

   - **Goal:** Ensure some **`SceneObject`** has a **`ScriptComponent`** whose **`scriptAsset`** is **`Assets/Scripts/<FeatureName>Controller.ts`** (asset display name **`"<FeatureName>Controller"`**).
   - **Idempotent:** If **any** object in **`scene.sceneObjects`** already has a **`ScriptComponent`** bound to that script asset (match by asset **id** or **name**), **do not** add another host — return **`alreadyPresent: true`**.
   - **Otherwise:** Create **`"<FeatureName>ControllerRoot"`** (or reuse that object if it exists without the script), add **`ScriptComponent`** if missing, assign **`scriptAsset`**, then **`model.project.save()`** when the API allows.
   - **Do not** use this step to build **`FlippedImage`** scene content (RGBA prefab is runtime-only; see step **8**).

   Replace **`<FeatureName>`** with the derived feature name (e.g. `MyFeature` for `MyFeatureModule`).

   ```typescript
   const model = pluginSystem.findInterface(Editor.Model.IModel);
   const scene = model.project.scene;
   const assetManager = model.project.assetManager;
   const FEATURE = "<FeatureName>";
   const SCRIPT_NAME = FEATURE + "Controller";
   const ROOT_NAME = FEATURE + "ControllerRoot";

   const scriptAsset = (assetManager.assets as any[]).find(
     (a: any) => a && (a.name === SCRIPT_NAME || String(a.name).endsWith("/" + SCRIPT_NAME))
   );
   if (!scriptAsset) return JSON.stringify({ error: "Controller asset not found", scriptName: SCRIPT_NAME });

   const scriptId = scriptAsset.id != null ? String(scriptAsset.id) : "";
   for (const o of scene.sceneObjects) {
     for (const c of o.components) {
       if (c.getTypeName() !== "ScriptComponent") continue;
       const sc = c as Editor.Components.ScriptComponent;
       const sa = sc.scriptAsset as any;
       if (!sa) continue;
       if (sa === scriptAsset || (scriptId && String(sa.id) === scriptId) || sa.name === SCRIPT_NAME) {
         return JSON.stringify({ ok: true, alreadyPresent: true, hostId: o.id.toString(), hostName: o.name });
       }
     }
   }

   let host = scene.sceneObjects.find((o: Editor.Model.SceneObject) => o.name === ROOT_NAME);
   if (!host) host = scene.createSceneObject(ROOT_NAME);

   let hostSc = host.components.find((c: Editor.Components.Component) => c.getTypeName() === "ScriptComponent") as
     | Editor.Components.ScriptComponent
     | undefined;
   if (!hostSc) hostSc = host.addComponent("ScriptComponent") as Editor.Components.ScriptComponent;
   hostSc.scriptAsset = scriptAsset;

   try {
     model.project.save();
   } catch (_e) {
     /* save optional if API throws */
   }

   return JSON.stringify({ ok: true, created: true, hostId: host.id.toString(), hostName: host.name });
   ```

   - If **`ExecuteEditorCode`** is unavailable, **stop and tell the user** to attach **`FeatureNameController`** to a **`SceneObject`** in the Inspector before preview — do not claim the module is wired.

8. **`FlippedImage.lspkg` (only when `getFrameRGBA` / RGBA preview is in use)**

   Run **only** if the module exports **`getFrameRGBA`** (e.g. **`--with-rgba-frame`**). **Skip** for **`ping()`-only** modules.

   - Confirm `Assets/Prefabs/FlippedImage.lspkg` is present from scaffold (`--with-rgba-frame`); runtime uses `requireAsset`+`instantiate` only (no Editor-built `Image` SceneObject).

9. **Scope**
   - Prefer edits inside the scaffolded **`<ModuleName>/`** directory; when exports change, also edit **`Assets/Scripts/<FeatureName>NativeModule.ts`** and **`Assets/Scripts/<FeatureName>Controller.ts`** (or the user’s chosen script) unless they ask otherwise.

10. **Build failures**
   - Fix and rebuild before treating the task as done.

11. **Quick consistency check**
    - **`ModuleName`** matches folder, library name, and `requireAsset` path for `lib<ModuleName>.so` (→ step 3).
    - **`FeatureNameController`** / **`FeatureNameNativeModule`** match `ModuleName` via naming rules (→ step 3).
    - **Scene:** step **7** returned `ok` (→ `alreadyPresent` or `created`), or user confirmed manual attachment.
    - **`getFrameRGBA`**: `Assets/Prefabs/FlippedImage.lspkg` present only if `--with-rgba-frame` (→ step 8).


## Response format

- Files changed: list paths.
- Behavior: one bullet per export or wiring change.
- **Scene:** step **7** result (**`alreadyPresent`** / **`created`** / manual / blocked — include **`hostId`** when returned).
- Build: success/failure with key lines.
- If setup ran: note **`~/Dev/SpecsNDK`** (and tarball/quarantine/auth) status.
