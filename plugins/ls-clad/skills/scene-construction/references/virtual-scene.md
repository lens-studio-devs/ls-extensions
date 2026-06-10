<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# VirtualScene Operations

Use `read` to understand the scene, `apply` to make changes.

## When to use VirtualScene

Prefer VirtualScene over scene-graphql / asset-graphql for these patterns:

| Scene-graphql / asset-graphql pattern | VirtualScene replacement |
|---|---|
| `rootSceneObjects { … }` / `allSceneObjects { … }` for scene inspection | `read` + grep on `.virtual-scene.json` |
| 2+ `setProperty` calls in a row | One `modify` block |
| Multiple `createAssetFromPreset` with aliases | One `assets` array |
| `createSceneObject` + `addComponent` + N `setProperty` | One `create` instruction |
| `setProperty` against a component/asset by UUID | `modify` with `@id:<uuid>` key |
| `deleteAsset` + `deleteSceneObject` separately | One `delete` array (mixed refs) |

For scene construction, use GraphQL mainly for discovery/introspection and preset-spawned scene objects that VirtualScene cannot materialize as safely. Standalone asset CRUD still belongs in `asset-graphql`; use VirtualScene for asset work when the value is atomic asset + scene wiring in one apply.

| Use scene-graphql for | Use asset-graphql for |
|---|---|
| `presets(type: SceneObject) { name }` — list available SceneObject presets | `presets { name assetType }` — list available asset presets |
| `__type` / `__schema` — schema introspection | `__type` / `__schema` — schema introspection |
| `createSceneObjectFromPreset(presetName: "CameraObjectPreset" \| "ScreenImageObjectPreset" \| "ScreenTextObjectPreset" \| ...)` — pass the literal `*Preset` identifier, **not** the display name (e.g. `"Camera Object"` will fail). Discover via `presets(type: SceneObject) { name }`. | `allAssets(typeFilter: "...", nameContains: "...")` / `assetsByName(...)` — search the asset library, including package-imported assets like SIK prefabs (VS `read` doesn't index the broader asset library well). Standalone asset rename/move/delete/property edits also use asset-graphql directly. |

VirtualScene apply has no schema-shape failure mode (no `Cannot query field 'X' on Y` or "must have a selection of subfields" errors). Instructions are loose JSON validated against an allowlist; typos surface as `validate.*` errors with the allowed keys listed inline.

## Read — Understand the Scene

```json
{ "command": "read" }
```

Serializes scene objects + assets to `.virtual-scene.json` on disk. AI reads/greps this file with standard file tools (zero MCP cost). Properties are flattened to dot-paths matching the exact format needed for modify.

## Apply — Declarative Instructions

```json
{
  "command": "apply",
  "instructions": {
    "assets": [...],
    "create": [...],
    "modify": {...},
    "delete": [...]
  }
}
```

All sections are optional. Execution order is guaranteed: assets → create → modify → delete.

## Creating Assets

Preset-based (most common):
```json
{ "id": "$temp:sphere", "preset": "SphereMeshPreset", "name": "Sphere", "destinationPath": "Meshes" }
{ "id": "$temp:mat", "preset": "UnlitMaterialPreset", "name": "Red Material", "destinationPath": "Materials",
  "properties": { "passInfos.0.baseColor": {"x":1, "y":0, "z":0, "w":1} } }
```

Native type:
```json
{ "id": "$temp:rt", "type": "RenderTarget", "name": "My RT" }
```

### Common Preset Names
- **Meshes:** `SphereMeshPreset`, `BoxMeshPreset`, `PlaneMeshPreset`, `CylinderMeshPreset`, `ConeMeshPreset`, `CapsuleMeshPreset`
- **Materials:** `UnlitMaterialPreset`, `SimplePBRMaterialPreset`, `PBRMaterialPreset`, `OccluderMaterialPreset`

## Creating Scene Objects

```json
{
  "create": [
    { "id": "$temp:sun", "name": "Sun", "parentId": null,
      "transform": {"position": [0,0,0], "rotation": [0,0,0], "scale": [8,8,8]},
      "layers": 1,
      "components": [
        { "type": "RenderMeshVisual", "properties": {"mesh": "$temp:sphere", "mainMaterial": "$temp:mat"} }
      ]
    },
    { "id": "$temp:child", "name": "Orbiter", "parentId": "$temp:sun",
      "transform": {"position": [20,0,0], "rotation": [0,0,0], "scale": [1,1,1]} }
  ]
}
```

- Parents are created before children automatically (topological sort)
- `transform` uses `[x, y, z]` tuples
- `layers` is a bitmask integer (1 = default)

### Prefab Instantiation
```json
{ "id": "$temp:sik", "name": "SIK",
  "_prefab": "@asset:SpectaclesInteractionKit.lspkg/Prefabs/SpectaclesInteractionKit.prefab" }
```

### Physics Components
Use bare type names without namespace:
```json
{ "type": "BodyComponent", "properties": {} }
{ "type": "ColliderComponent", "properties": {} }
```
NOT `Physics.BodyComponent` — the `Physics.` namespace is stripped automatically.

## Modifying Existing Objects

Modify keys can be **scene objects, components, or assets**:

| Key shape | Target | Dispatcher |
|---|---|---|
| `@sceneObject:Name` | Scene object | Rich: `transform.*`, `components.*`, `_addComponents`, `_removeComponents`, `parentId`, `enabled`, `name`, `layers` |
| `@id:<componentUuid>` | Component | Property-only: each `{ key: value }` is a flat write |
| `@asset:Path` or `@id:<assetUuid>` | Asset | Property-only: each `{ key: value }` is a flat write |

```json
{
  "modify": {
    "@sceneObject:Camera Object": { "components.Camera.fov": 45 },
    "@asset:Materials/Red.mat":   { "passInfos.0.baseColor": {"x":0,"y":1,"z":0,"w":1} },
    "@id:8f3230ca-...":            { "enabled": false }
  }
}
```

For scene objects, both full triples and sub-paths work — copy whichever the snapshot emits:

```json
{ "@sceneObject:Sun": { "transform.position": [0,5,0], "transform.scale.x": 6 } }
```

### Multiple same-type components — `#index`
```json
{
  "@sceneObject:Player": {
    "components.ScriptComponent#0.speed": 5,
    "components.ScriptComponent#1.health": 100
  }
}
```

### Add components to existing objects — `_addComponents`
```json
{
  "@sceneObject:Mercury": {
    "_addComponents": [
      { "type": "ScriptComponent", "properties": {"scriptAsset": "@asset:Scripts/Orbit.ts", "speed": 4} }
    ]
  }
}
```

### Remove components — `_removeComponents`
```json
{
  "@sceneObject:Player": {
    "_removeComponents": ["ScriptComponent#1", "ColliderComponent"]
  }
}
```

### Reparent
```json
{
  "@sceneObject:Child": { "parentId": "@sceneObject:NewParent" }
}
```

## Deleting Objects and Assets

`delete` accepts mixed scene-object and asset refs in one array:

```json
{ "delete": [
  "@sceneObject:Old Light",
  "@asset:Materials/Unused.mat",
  "@id:8f3230ca-..."
] }
```

Scene objects are destroyed children-before-parents (depth-sorted). Assets are deleted via the asset manager.

## Reference Syntax

| Syntax | Resolves to | Example |
|---|---|---|
| `$temp:label` | Object/asset created in same apply | `$temp:sphere` |
| `@asset:path` | Asset by relative path | `@asset:Materials/Red.mat` |
| `@sceneObject:Name` | Scene object by name | `@sceneObject:Camera Object` |
| `@sceneObject:Name#N` | Nth object with that name | `@sceneObject:Light#1` |
| `@id:uuid` | Direct UUID | `@id:8f3230ca-...` |

All references work in all contexts (create, modify, delete, property values).

## Value Type Inference

The tool infers types from value shapes — no explicit `valueType` needed:
- `{ "x": 1, "y": 0, "z": 0, "w": 1 }` → Vec4
- `{ "value": "Normal", "type": "enum", "enumType": "Editor.Assets.BlendMode" }` → Enum
- `"@asset:..."` or `"$temp:..."` → Reference (resolved to native object)
- Numbers, strings, booleans → pass through

**Enum gotcha:** `enumType` is the fully-qualified path under `Editor.*`. If a write fails with `Invalid enum value '...' for type '...'`, the path is wrong — read `.virtual-scene.json` to see how the value is currently typed (the `type` field on a property entry shows the path).

## Script Input Wiring (Two-Phase)

Script `@input` properties require TypeScript to be compiled first. **Do NOT wire inputs in the same apply as object creation.**

### Phase 1: Create structure
```json
{ "create": [{ "id": "$temp:obj", "name": "Player",
    "components": [{ "type": "ScriptComponent", "properties": {} }] }] }
```

### Between phases
1. Write TypeScript via FileEditTool
2. RecompileTypeScriptTool

### Phase 2: Wire inputs
```json
{ "modify": { "@sceneObject:Player": {
    "components.ScriptComponent.scriptAsset": "@asset:Scripts/Player.ts",
    "components.ScriptComponent.speed": 5,
    "components.ScriptComponent.target": "@sceneObject:Waypoint"
}}}
```

Script inputs are set via direct native accessor, so they work after compilation **for scalar and asset-reference inputs** (numbers, strings, bools, `@asset:` refs).

**Component-typed `@inputs`** (e.g. `@input ui: MyUiScript`) — reference the target **component** with `@id:<componentUuid>` (the `ScriptComponent`'s uuid), not `@sceneObject:`/the object's id. A SceneObject ref reports success but reads back null at runtime (`Input <name> was not provided`).

**Array-typed `@inputs`** (e.g. `@input items: Item[]`) — VirtualScene errors here (`Value is not a native object`); wire them via `scene-graphql setProperty` (see `references/scene-graphql.md` § Script component properties).

**Alternative for Phase 2:** scene-graphql `setProperty` batch also works well for targeted property wiring.

## Error Handling

Errors are per-operation and non-fatal. Response includes:
```json
{
  "applied": 25,
  "errors": [{ "op": "modify", "targetId": "@sceneObject:X", "propertyPath": "components.Camera.clearColor", "message": "..." }],
  "idMapping": { "$temp:sun": "real-uuid" }
}
```

## Common Errors

| Error message | Cause | Fix |
|---|---|---|
| `Unknown key '<x>'. Allowed: …` | Typo in instruction shape (e.g. `parent` vs `parentId`, `propertis` vs `properties`) | The validator lists allowed keys inline — rename and retry |
| `Skipped: parent object '<id>' was not created in phase 1` | An earlier `create` failed and a later instruction depended on it | Look up the original failure in the same `errors` array; fix that first |
| `Skipped: component was not created in phase 2` | `addComponent` returned null in phase 2; phase 3 has no component to write to | Check the phase-2 error for that component; usually a bad `type` |
| `Script input '<name>' not found on ScriptComponent — recompile…` | TypeScript wasn't compiled before the input wiring apply | Run `RecompileTypeScriptTool`, then retry the wiring |
| `Asset not found at path: <name>. Try @id:uuid instead.` | Asset created in same apply isn't yet resolvable by `@asset:<bareName>` | Use `$temp:label` in same apply, or split into two applies and use `@id:` after `read` |
| `Target not found (not a scene object, component, or asset): <ref>` | Ref didn't resolve at all — typo, deleted object, or stale cached snapshot | Re-run `read` and copy the exact ref from the snapshot |
| `Invalid enum value '<x>' for type '<path>'` | `enumType` path is wrong for the property | Check the `type` field on that property in the snapshot |
