---
name: editor-api
description: ExecuteEditorCode contract and Editor API paradigms — runtime, access patterns, gotchas, references. Use before writing Editor API TS (`pluginSystem.findInterface`, `LensStudio:*`), grepping `editor.d.ts`, or routing to scene/asset-graphql.
user-invocable: true
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# ExecuteEditorCode Tool Reference

## Decision Rules — Do NOT use ExecuteEditorCode for these

If the task in front of you maps to one of these rows, **prefer the dedicated tool over writing Editor API code**. Specific tool names vary by environment — check what's available before reaching for EEC.

| Task                                                                  | Prefer (if available in your environment)                          |
| --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Create a built-in primitive (Sphere/Cube/Cylinder/Plane/Camera/Light) | `scene-graphql.createSceneObjectFromPreset(presetName: …Preset)`   |
| Find SceneObjects by name                                             | `scene-graphql.sceneObjectsByName`                                 |
| Set local transform / property / add component                        | `scene-graphql.setLocalTransform` / `setProperty` / `addComponent` |
| Create a PBR / Unlit / SimplePBR material                             | `asset-graphql.createAssetFromPreset`                              |
| Set a material property (color, baseTex)                              | `asset-graphql.setProperty`                                        |

**Use EEC** for: bulk operations across many objects, custom traversals with filtering, public `LensStudio:*` Editor API modules declared in the active `Support/editor.d.ts` (FileSystem/Shell/Network/Preview/etc.), and atomic multi-step mutations that must run in one execution context.

## Runtime

Code runs as an **ES2021 async function body** with a `pluginSystem` parameter:

```ts
async function(pluginSystem) {
  // your code here
}
```

**Input**: `{ code: string }`
**Success**: `{ status: "Execution Succeeded", returnValue: <value>, console: [...] }`
**Compile error**: `{ status: "Compilation Failed", errors: [...], console: [...] }`
**Runtime error**: `{ status: "Execution Failed", error: <message>, stack: <trace>, console: [...] }`

Use `return` to produce output. `console.log()` calls are captured in the `console` array.

## Editor API Entry Points

Only initialize the interfaces and modules the snippet actually uses. For scene, assets, or project state, start from `Editor.Model.IModel`:

```ts
const model = pluginSystem.findInterface(Editor.Model.IModel);
const scene = model.project.scene;            // for scene operations
const assetManager = model.project.assetManager; // for asset operations
```

For literal `await import("LensStudio:<Name>")`, grep `declare module "LensStudio:<Name>"` in the active project's `Support/editor.d.ts` first — see "API Reference Lookup" below for details on the hidden-module rule.

## Editor API vs Lens Scripting (Lens Runtime) — Do Not Confuse

You operate in the **Editor API** environment. The project's `.ts` files use the **Lens Scripting (Lens Runtime)** API — different types, different scene access, incompatible signatures. Code from one will not run in the other.

| Aspect        | Editor API (this tool)                                          | Lens Scripting (project .ts files)                          |
| ------------- | --------------------------------------------------------------- | ----------------------------------------------------------- |
| Types file    | `<project>/Support/editor.d.ts`                                 | `<project>/Support/StudioLib.d.ts` (or `StudioLib_Internal.d.ts`) |
| Scene access  | `pluginSystem.findInterface(Editor.Model.IModel).project.scene` | `script.getSceneObject().getScene()`                        |
| Get position  | `obj.localTransform.position`                                   | `obj.getTransform().getLocalPosition()`                     |
| Set position  | `obj.localTransform.position = new vec3(...)`                   | `obj.getTransform().setLocalPosition(new vec3(...))`        |
| Rotation      | `vec3` Euler in **degrees**                                     | `quat` (quaternion, radians)                                |
| Get component | `obj.getComponent('RenderMeshVisual')`                          | `obj.getComponent('Component.RenderMeshVisual')`            |

**NEVER** use Lens Scripting patterns in ExecuteEditorCode. **NEVER** grep `StudioLib.d.ts` / `StudioLib_Internal.d.ts` from this tool — those describe a different API.

## Two API Access Patterns

```ts
// 1) pluginSystem.findInterface() — Editor-internal interfaces
const model = pluginSystem.findInterface(Editor.Model.IModel);
const protoRegistry = pluginSystem.findInterface(Editor.Model.IEntityPrototypeRegistry);
const entityRegistry = pluginSystem.findInterface(Editor.Model.IEntityRegistry);

// 2) await import("LensStudio:___") — Editor API modules
const App = await import("LensStudio:App");
const FS = await import("LensStudio:FileSystem");
const Shell = await import("LensStudio:Shell");
const Network = await import("LensStudio:Network");
const Preset = await import("LensStudio:Preset");
const Preview = await import("LensStudio:Preview");
```

Grep `declare module "LensStudio:` in the active `Support/editor.d.ts` for the public-typed module list. Hidden/internal modules that are absent from `Support/editor.d.ts` must not appear as string-literal imports in generic snippets. If a specialized workflow has already verified a hidden module is needed and runtime-loadable, avoid a literal specifier and handle failure explicitly:

```ts
const importEditorModule = async (name: string): Promise<any> => await import("LensStudio:" + name);
const Engine = await importEditorModule("Engine"); // hidden/internal: use only in workflow-specific code
```

## Essential Patterns

**Batch operations** — prefer loops in a single call over multiple tool calls (see `references/scene-object-operations.md` for an 8×8 grid example).

**Return values** must be JSON-serializable. Call `.toString()` on UUIDs, IDs, `Editor.Path`, and other opaque types before returning.

## Critical Gotchas

Each gotcha is encoded as JSDoc on the relevant class/property in `editor.d.ts`. The pointers below tell you what to grep.

1. **`vec3` is required for position/rotation/scale** (`new vec3(...)`, never `{ x: 10 }`); the position getter returns a *copy* — assign a fresh `vec3` back. See JSDoc on `Editor.Model.TransformEntity`.
2. **Rotation is `vec3` Euler in degrees** (not radians, not quaternion). `Editor.Transform` constructor requires all three `vec3` arguments.
3. **`addComponent` / `getComponent` keys come from `ComponentNameMap`.** Wrong string → runtime `EntityRegistry::create failed. Unknown entity type "…"`. Grep `interface ComponentNameMap` in `editor.d.ts` for the canonical list.
4. **Always wrap in try/catch — return errors as strings:** `return \`Failed: ${e.message}\``.

## API Reference Lookup

`editor.d.ts` is the canonical source. **Never read the full file** — Grep for the symbol you need. It lives at `<project>/Support/editor.d.ts`. Do **not** fall back to the app bundle's copy — version-pinned and macOS-only.

Always pass context flags so JSDoc + class body come back in one call:

```
Grep pattern="class SceneObject" path="<project>/Support/editor.d.ts" -B 30 -A 60 output_mode="content"
```

Tune `-A` to class size — 40 for most components; 60–120 for `SceneObject` / `Project`. `-B 30` catches `@example` blocks. If the class is bigger than your window, follow up with `Read offset=<matched-line> limit=200`.

`IModel`, `IEntityRegistry`, etc. are declared as `class` (not `interface`), even though looked up via `pluginSystem.findInterface(...)`. Grep `class IModel`, not `interface IModel`.

**Namespace rules — do not guess, do not flip the `I`-prefix:**

- Interfaces resolved via `pluginSystem.findInterface(...)` live at `Editor.Model.I<Name>` — always with the `I` prefix and the `Model` namespace. Examples: `Editor.Model.IModel`, `Editor.Model.IEntityRegistry`, `Editor.Model.IEntityPrototypeRegistry`, `Editor.Model.IAssetManager`. Common slips: dropping the namespace (`Editor.IModel`), dropping the `I` (`Editor.Model.Model`), or doubling the name (`Editor.Model.IModel.Model`).
- Public Editor API modules that **look** like they should be `Editor.Model.I<X>` (App, FileSystem, Shell, Network, Preview, Preset, …) are not — they are module imports accessed via `await import("LensStudio:<X>")`. See "API Reference Lookup" above for the public-typed list and the hidden-module rule.
- `SourcePath` is **not** the same type as `Path | Entity`. APIs that take `Path | Entity` (e.g. `assetManager.getFileMeta`) want an `Editor.Path` or an entity, not a raw `SourcePath`. Wrap with `new Editor.Path(str)` before calling.

When in doubt, grep `editor.d.ts` for the exact symbol — never guess by analogy to a similar name.

## Error Handling

1. `status: "Compilation Failed"` — inspect the `errors` array, fix the code, retry.
2. `status: "Execution Failed"` — read `error`, `stack`, and `console`.
3. Retry up to 3 times. **Do not retry with a different argument type** after "Incorrect argument type" — wrong types can pass type-check but reach native code in an invalid state. Research the correct signature first.

The snippet you ran for the **mutation** is the `FINAL_SNIPPET` — a follow-up call that reads state back is a *verifier* and is not the answer. When reporting, surface the mutation call, not the verifier. If the last call returned `Failed:`, the result has an `error` field, or the result describes a partial mutation, the outcome is `fail` or `partial` — never `pass`. Specifically: `passInfos.length === 0` blocking a color-set step is `partial`, not `pass`.

## Reference Files

Before writing Editor API code, check if your task matches a reference below — they contain working patterns and gotchas that prevent common mistakes. Only grep `editor.d.ts` for APIs not covered by a reference.

| Your code involves...                                          | Read first                                                                                                          |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Creating, finding, renaming, deleting **assets**               | `references/asset-operations.md`                                                                                    |
| Creating, reparenting, finding, destroying **scene objects**   | `references/scene-object-operations.md`                                                                             |
| Instantiating or saving **prefabs**                            | `Scene.instantiatePrefab` and `AssetManager.saveAsPrefab` JSDoc                                                     |
| **Physics** bodies, colliders, gravity                         | invoke `physics`; grep `class WorldSettingsAsset` / `BodyComponent` / `ColliderComponent` in `editor.d.ts`     |
| **Camera**, **RenderMeshVisual**, material slots, world AABB   | `references/camera-and-rendering.md`                                                                                |
| **Material** or **PassInfo** types (incl. passInfos.length===0)| invoke `materials`; for low-level passInfo edits see `Material.passInfos` JSDoc in `editor.d.ts`              |
| Driving the **preset registry** directly from EEC              | `references/presets.md`                                                                                             |
| **Project** lifecycle — open, save, export, icon, Lens metadata| `references/project-operations.md`                                                                                  |
