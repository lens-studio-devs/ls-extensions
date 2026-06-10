<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Using Presets via Run Editor Code

Most preset work is a single MCP call away — use `scene-graphql.createSceneObjectFromPreset` for SceneObject presets and `asset-graphql.createAssetFromPreset` for asset presets. Reach for the snippets below only when those don't cover the case (for example to chain preset into a larger atomic mutation).

`pluginSystem` is injected; `return <value>` to produce a result.

## List all preset names

```ts
const FileSystem: any = await import("LensStudio:FileSystem");
const PresetsRegistry: any = await import(
  FileSystem.getPluginsFolder()
    .appended(new Editor.Path("JsPlugins/PresetsRegistry/PresetsRegistry/PresetsRegistry.js"))
    .toString()
);
return Object.keys(PresetsRegistry).filter((k) => k !== "default");
```

## List presets filtered by type (Asset | SceneObject | Component)

```ts
const FILTER: "Asset" | "SceneObject" | "Component" = "Component";

const FileSystem: any = await import("LensStudio:FileSystem");
const PresetsRegistry: any = await import(
  FileSystem.getPluginsFolder()
    .appended(new Editor.Path("JsPlugins/PresetsRegistry/PresetsRegistry/PresetsRegistry.js"))
    .toString()
);
const proto = pluginSystem.findInterface(
  Editor.Model.IEntityPrototypeRegistry
) as Editor.Model.IEntityPrototypeRegistry;
const supportedTypes = proto.getEntityTypes(FILTER, () => true);

return Object.entries(PresetsRegistry)
  .filter(([k]) => k !== "default")
  .filter(([, Ctor]: [string, any]) => {
    const et = Ctor?.descriptor?.()?.entityType;
    return et === FILTER || supportedTypes.indexOf(et) !== -1;
  })
  .map(([name, Ctor]: [string, any]) => {
    const d = Ctor.descriptor();
    return { name, entityType: d.entityType, section: d.section, description: d.description };
  });
```

## List presets with full metadata (id, section, description)

```ts
const FileSystem: any = await import("LensStudio:FileSystem");
const PresetsRegistry: any = await import(
  FileSystem.getPluginsFolder()
    .appended(new Editor.Path("JsPlugins/PresetsRegistry/PresetsRegistry/PresetsRegistry.js"))
    .toString()
);
return Object.entries(PresetsRegistry)
  .filter(([k]) => k !== "default")
  .map(([name, Ctor]: [string, any]) => {
    const d = Ctor.descriptor?.();
    return {
      name,
      id: d?.id,
      entityType: d?.entityType,
      section: d?.section,
      description: d?.description,
    };
  });
```

## Create a SceneObject from a preset

```ts
const PRESET_NAME = "ScreenTransformObjectPreset"; // e.g. ObjectPrefabPreset, BoxMeshObjectPreset
const NEW_NAME = "MyObject";
const PARENT_UUID: string | undefined = undefined; // pass a UUID to nest under it

const FileSystem: any = await import("LensStudio:FileSystem");
const PresetsRegistry: any = await import(
  FileSystem.getPluginsFolder()
    .appended(new Editor.Path("JsPlugins/PresetsRegistry/PresetsRegistry/PresetsRegistry.js"))
    .toString()
);
const PresetCtor = PresetsRegistry[PRESET_NAME];
if (!PresetCtor) return { error: `Preset "${PRESET_NAME}" not found` };

const model = pluginSystem.findInterface(Editor.Model.IModel) as Editor.Model.IModel;
const scene = model.project.scene;

// Reuse the findById walk from `SceneObject` JSDoc @example.
const parent = PARENT_UUID ? findById(scene, PARENT_UUID) : null;
if (PARENT_UUID && !parent) return { error: `Parent ${PARENT_UUID} not found` };

const preset = new PresetCtor(pluginSystem);
let obj: any = null;
try {
  obj = preset.createAsync ? await preset.createAsync(parent) : preset.create?.(parent);
} catch (e: any) {
  return { error: `Failed: ${e?.message ?? e}` };
}
if (!obj) return { error: `Preset "${PRESET_NAME}" returned nothing` };

obj.name = NEW_NAME;
return { uuid: obj.id?.toString(), name: obj.name };
```

## Create a Component from a preset (on an existing SceneObject)

```ts
const PRESET_NAME = "Text3DComponentPreset"; // e.g. TextComponentPreset, CanvasComponentPreset
const TARGET_UUID = "<scene-object-uuid>";

const FileSystem: any = await import("LensStudio:FileSystem");
const PresetsRegistry: any = await import(
  FileSystem.getPluginsFolder()
    .appended(new Editor.Path("JsPlugins/PresetsRegistry/PresetsRegistry/PresetsRegistry.js"))
    .toString()
);
const PresetCtor = PresetsRegistry[PRESET_NAME];
if (!PresetCtor) return { error: `Preset "${PRESET_NAME}" not found` };

const model = pluginSystem.findInterface(Editor.Model.IModel) as Editor.Model.IModel;
const scene = model.project.scene;
// Reuse the findById walk from `SceneObject` JSDoc @example.
const target = findById(scene, TARGET_UUID);
if (!target) return { error: `SceneObject ${TARGET_UUID} not found` };

const preset = new PresetCtor(pluginSystem);
let component: any = null;
try {
  component = preset.createAsync ? await preset.createAsync(target) : preset.create?.(target);
} catch (e: any) {
  return { error: `Failed: ${e?.message ?? e}` };
}
if (!component) return { error: `Preset "${PRESET_NAME}" returned nothing` };

return {
  componentUUID: component.id?.toString(),
  componentType: component.type,
  onObject: target.name,
};
```

## Create an Asset from a preset

```ts
const PRESET_NAME = "BoxMeshPreset"; // e.g. AnalogTVMaterialPreset, AmaticScFontPreset
const ASSET_NAME = "MyBox";
const FOLDER = "Assets"; // relative folder path inside the project

const FileSystem: any = await import("LensStudio:FileSystem");
const PresetsRegistry: any = await import(
  FileSystem.getPluginsFolder()
    .appended(new Editor.Path("JsPlugins/PresetsRegistry/PresetsRegistry/PresetsRegistry.js"))
    .toString()
);
const PresetCtor = PresetsRegistry[PRESET_NAME];
if (!PresetCtor) return { error: `Preset "${PRESET_NAME}" not found` };

const model = pluginSystem.findInterface(Editor.Model.IModel) as Editor.Model.IModel;
const destination = new Editor.Path(FOLDER);

const preset = new PresetCtor(pluginSystem);
let asset: any = null;
try { asset = preset.createAsync ? await preset.createAsync(destination) : preset.create?.(destination); } catch (e: any) {
  return { error: `Failed: ${e?.message ?? e}` };
}
if (!asset) return { error: `Preset "${PRESET_NAME}" returned nothing` };

if (asset.fileMeta) model.project.assetManager.rename(asset.fileMeta, ASSET_NAME);
return {
  assetUUID: asset.id?.toString(),
  assetType: asset.type,
  name: asset.name,
  path: asset.fileMeta?.sourcePath?.toString(),
};
```

## Notes

- **Preset names** are JS class names exported from `PresetsRegistry.js` (e.g. `Text3DComponentPreset`, `BoxMeshPreset`, `ScreenTransformObjectPreset`). Use the "List all preset names" snippet to discover them.
- **Destination semantics:**
  - SceneObject preset → parent `SceneObject` (or `null` for scene root).
  - Component preset → the host `SceneObject` to add the component onto.
  - Asset preset → an `Editor.Path` pointing at the target folder (typically `"Assets"`).
- **Why dynamic import:** `pluginSystem.create(descriptor)` fails cross-module ("plugin loaded in a different module is not supported"). The dynamic-import path constructs the preset class directly in the caller's module and avoids that restriction.
- **`import.meta` is unavailable** inside `ExecuteEditorCode`. Anchor paths with `FileSystem.getPluginsFolder()` instead.
