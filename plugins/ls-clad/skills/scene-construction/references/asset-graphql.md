<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Asset GraphQL Operations

Patterns for the `asset-graphql` MCP tool. Every operation below is verified against the source code — use these exact argument names, value formats, and return fields.

> **Leading gotcha — enum-arg casing.** See `graphql-common.md` § Enum-arg casing for the shared rule (`ValueType` is UPPERCASE). Surface-specific:
>
> - Asset preset listing does **not** take a `type` argument in asset-graphql. Use `presets { ... }`, not `presets(type: Asset)`.

## Creating Assets

### From a preset (materials, etc.)

```graphql
mutation {
  createAssetFromPreset(
    presetName: "SimplePBRMaterialPreset"
    name: "MyMaterial"
    destinationPath: "Materials"  # optional, folder beneath Assets/
  ) {
    id
    assetType
    name
    path
    properties
    message
  }
}
```

Common material presets: `SimplePBRMaterialPreset`, `UnlitMaterialPreset`. Use the `presets` query to discover all available asset presets.

> **Gotcha — `destinationPath` is resolved relative to the project's `Assets/` root.** Pass `"Materials"` or `"UI/Icons"`, NOT `"Assets/Materials"`. A leading `Assets/` would historically create a nested `Assets/Assets/Materials/` directory on disk — the plugin now auto-strips the redundant prefix and adds a note to the response `message` so you can learn the correct convention. Omit the argument to default to the Assets root.

### Native asset (no preset needed)

```graphql
mutation {
  createNativeAsset(
    assetType: "WorldSettingsAsset"
    name: "ZeroGravity"
    # destinationPath omitted -> created at the Assets/ root.
    # Pass e.g. destinationPath: "Physics" (NOT "Assets/Physics") to nest.
  ) {
    id
    assetType
    name
    path
    properties
    message
  }
}
```

Common native types: `WorldSettingsAsset`, `Matter`, `Material`, `RenderTarget`, `Filter`.

Note: argument is `assetType`, not `type`. Use the `assetTypes` query to discover all valid types.

### Generic asset creation

```graphql
mutation {
  createAsset(
    type: "Material"
    name: "MyMaterial"
    destinationPath: "Materials"  # optional, folder beneath Assets/
  ) {
    success
    message
    id
    name
    path
  }
}
```

Note: argument is `type` (not `assetType`). This is a different mutation from `createNativeAsset` with a different return type. Prefer `createAssetFromPreset` for materials and `createNativeAsset` for physics/settings assets.

## Setting Asset Properties

```graphql
mutation {
  setProperty(
    id: "asset-uuid"
    propertyPath: "passInfos.0.baseColor"
    value: {x: 0.05, y: 0.45, z: 0.15, w: 1.0}
    valueType: VEC4
  ) {
    success
    message
    id
    name
  }
}
```

**Critical details:**
- `id` is the **asset** ID (not a component ID — asset-graphql operates on assets).
- `propertyPath` uses dot notation with array indices (e.g., `passInfos.0.baseColor`).
- `valueType` is required.
- When `valueType` is `ENUM`, you must also pass `enumType`.
- Return fields `{ success }` are required — mutations without return fields fail.

### Material property paths (PBR)

Material properties are accessed through `passInfos.0.<propertyName>`:

| Property | Path | valueType | Example |
|---|---|---|---|
| Base color | `passInfos.0.baseColor` | VEC4 | `{x: 0.8, y: 0.1, z: 0.1, w: 1.0}` |
| Roughness | `passInfos.0.roughness` | NUMBER | `0.5` |
| Metallic | `passInfos.0.metallic` | NUMBER | `0.8` |

These paths are for **PBR materials** (`SimplePBRMaterialPreset`). Other material types have different properties — query the asset's `properties` field to discover them. The `passInfos.0` prefix refers to the first render pass and is not discoverable from the schema.

### Value formats

| valueType | Format | Example |
|---|---|---|
| `BOOLEAN` | Boolean or string | `false` or `"false"` |
| `NUMBER` | Number or string | `0.3` or `"0.3"` |
| `STRING` | String | `"hello"` |
| `VEC2` | Comma string or object | `"1.0, 2.0"` or `{x: 1.0, y: 2.0}` |
| `VEC3` | Comma string or object | `"0, -981, 0"` or `{x: 0, y: -981, z: 0}` |
| `VEC4` | Comma string or object | `"0.8, 0.1, 0.1, 1.0"` or `{x: 0.8, y: 0.1, z: 0.1, w: 1.0}` |
| `REFERENCE` | UUID string or null | `"target-uuid"` or `null` (to clear) |
| `ENUM` | Enum member name | `"Normal"` (requires `enumType`) |

Full valueType enum: `NUMBER`, `STRING`, `BOOLEAN`, `ENUM`, `REFERENCE`, `VEC2`, `VEC3`, `VEC4`, `MAT3`, `TRANSFORM`, `RECT`, `LAYER_SET_MASK`.

### Common property examples

> **passInfos properties are shader-dependent** — not all materials have `baseColor`, `roughness`, etc. Query the asset's `properties` field first to discover available property names. For material-specific guidance, see the `materials`. Component types and their properties can be confirmed in `editor.d.ts`.

```graphql
# Set material color (verify baseColor exists on your material type first)
setProperty(id: "material-id", propertyPath: "passInfos.0.baseColor", value: {x: 0.8, y: 0.1, z: 0.1, w: 1.0}, valueType: VEC4) { success }

# Set roughness
setProperty(id: "material-id", propertyPath: "passInfos.0.roughness", value: 0.5, valueType: NUMBER) { success }

# Set gravity on WorldSettingsAsset
setProperty(id: "world-settings-id", propertyPath: "gravity", value: {x: 0, y: -981, z: 0}, valueType: VEC3) { success }

# Set bounciness on Matter asset
setProperty(id: "matter-id", propertyPath: "dynamicBounciness", value: 0.9, valueType: NUMBER) { success }

# Clear a reference
setProperty(id: "asset-id", propertyPath: "someRef", value: null, valueType: REFERENCE) { success }
```

### Batch property setting with aliases

```graphql
mutation {
  color: setProperty(id: "mat-id", propertyPath: "passInfos.0.baseColor", value: {x: 0.2, y: 0.6, z: 0.1, w: 1.0}, valueType: VEC4) { success }
  rough: setProperty(id: "mat-id", propertyPath: "passInfos.0.roughness", value: 0.8, valueType: NUMBER) { success }
  metal: setProperty(id: "mat-id", propertyPath: "passInfos.0.metallic", value: 0.0, valueType: NUMBER) { success }
}
```

## Querying Assets

Use the exact top-level query names below. Common hallucinations from benchmark logs include `assets` and unsupported `allAssets(filter: ...)` arguments; neither shape exists. If you need the authoritative list, run `{ __schema { queryType { fields { name } } } }` before trying variants.

### By ID

```graphql
{
  asset(id: "uuid") {
    id
    name
    type
    path
    properties
  }
}
```

### By file path

```graphql
{
  assetByPath(path: "Assets/Materials/MyMaterial.mat") {
    id
    name
    type
    properties
  }
}
```

### By name

```graphql
{
  assetsByName(name: "MyMaterial", exactMatch: true) {
    id
    name
    type
    path
  }
}
```

`exactMatch` is optional (default: false). When false, returns partial matches.

### All assets with filters

```graphql
{
  allAssets(typeFilter: "Material", nameContains: "PBR", limit: 10, offset: 0) {
    id
    name
    type
    path
  }
}
```

| Argument | Type | Description |
|---|---|---|
| `typeFilter` | String | Exact match on asset type |
| `nameContains` | String | Regex, case-insensitive name filter |
| `pathFilter` | String | Regex, case-insensitive path filter |
| `showPackedContent` | Boolean | Include internal package assets (default: false) |
| `limit` | Int | Max results |
| `offset` | Int | Skip first N results |

### Count

```graphql
{ assetCount(typeFilter: "Material") }
```

Same filter arguments as `allAssets` (except `limit`/`offset`).

### Available asset types

```graphql
{ assetTypes }
```

Returns a list of valid native asset type names that can be used with `createNativeAsset`.

### Asset return fields

| Field | Type | Notes |
|---|---|---|
| `id` | String! | Asset UUID |
| `name` | String! | Asset name |
| `type` | String! | Asset type |
| `path` | String | File path (may be null) |
| `description` | String | Available for ScriptAsset types |
| `tags` | JSON | Available for ScriptAsset types |
| `properties` | JSON | All properties as flat JSON |

## Managing Assets

### Rename

```graphql
mutation {
  renameAsset(id: "asset-uuid", newName: "BetterName") {
    success
    message
    id
    name
    path
  }
}
```

### Delete

```graphql
mutation {
  deleteAsset(id: "asset-uuid") {
    success
    message
    id
    name
  }
}
```

Also removes the backing file from disk (scripts, textures, etc.) — no need to delete separately.

### Duplicate

```graphql
mutation {
  duplicateAsset(id: "asset-uuid", newName: "Copy", destinationPath: "Materials") {
    success
    message
    id
    name
    path
  }
}
```

`newName` defaults to `"originalName_copy"`. `destinationPath` defaults to the original asset's directory.

### Move

```graphql
mutation {
  moveAsset(id: "asset-uuid", destinationPath: "NewFolder") {
    success
    message
    id
    name
    path
  }
}
```

## Preset Discovery

```graphql
# List all asset presets
{ presets { name description entityType assetType section } }

# Get a single preset
{ preset(presetName: "SimplePBRMaterialPreset") { name description entityType } }
```

`assetType` and `entityType` are aliases for the same field — both return the type of asset the preset creates.

`presets` in asset-graphql does not take a `type` argument. Use `{ presets { ... } }`, not `presets(type: Asset)`. `presetName` is the argument name for single-preset lookup and preset-create mutations; do not use `preset(name: ...)` or `preset(type: ...)`.

## Error Codes

When `success` is `false`, the `errorCode` field contains one of: `NOT_FOUND`, `UNKNOWN_PROPERTY_PATH`, `TYPE_MISMATCH`, `READ_ONLY_PROPERTY`, `INVALID_ENUM_VALUE`, `PERMISSION_DENIED`, `INTERNAL_ERROR`.

## Common Mistakes & How to Recover

### 1. Editor API ≠ GraphQL surface

> See `graphql-common.md` §1. (`asset-graphql` is the GraphQL surface; `Editor.Assets.*` / `Editor.Model.AssetManager` access goes through `ExecuteEditorCode`.)

### 2. Composite fields require subselections (but `properties` is JSON)

> See `graphql-common.md` §2 for the shared rule. Asset composite types: `Asset`, `Preset`, etc. Asset-specific examples:

```graphql
# ❌ { presets }
# ✅ { presets { name assetType } }
```

`properties` is the exception — it's a JSON scalar, query it WITHOUT subfields:

```graphql
# ✅ { asset(id: "uuid") { id name assetType path properties } }
# ❌ { asset(id: "uuid") { properties { name value type } } }
```

Mutation results are flat:

```graphql
# ✅ createAssetFromPreset(...) { id name path properties success message }
# ❌ createAssetFromPreset(...) { asset { id name } }
```

`path` is returned by asset-creation mutations and queries (`asset`, `assetsByName`, `allAssets`), but not by plain `MutationResult` types — don't request it from `setProperty`. Introspect an asset composite type with `{ __type(name: "Asset") { fields { name type { name kind } } } }`.

### 3. Don't guess field names — introspect

> See `graphql-common.md` §3. Asset-specific type introspection:

```graphql
{ __type(name: "Asset") { fields { name type { name kind } } } }     # fields on a specific type
```

### 4. Error → fix lookup

Pattern-match on the error fragment, not the prose around it.

| Error fragment | Cause | Fix |
|---|---|---|
| `doesn't exist on typeof Editor` | Used `Editor.*` inside a GraphQL string | Move to `ExecuteEditorCode`; GraphQL is not JavaScript |
| `Field ... must have a selection of subfields` | Composite field without `{ }` | Add `{ id name ... }`. Inline hint from `errorHints.enrichErrors` lists the type's fields |
| `Cannot query field "X" on type "Y" — did you mean Z?` | Wrong field name | Use the suggestion if present; else introspect `{ __type(name: "Y") { fields { name } } }` |
| `Cannot query field "assetById" on type "Query"` (or any other hallucinated name) | Top-level query doesn't exist | Introspect `{ __schema { queryType { fields { name } } } }` |
| `Cannot query field "assets" on type "Query"` | Invented query name | Use `allAssets(...)`, `asset(id: ...)`, or `assetsByName(...)` |
| `Unknown argument "type" on field "Query.presets"` | Asset preset listing has no type filter | Use `{ presets { name assetType } }` |
| `Cannot query field "type" on type "AssetPreset"` | Asset presets expose `assetType` / `entityType` | Use `{ presets { name assetType entityType } }` |
| `Unknown argument "name" on field "Query.preset"` or `Field "preset" argument "presetName" is required` | Used the wrong preset lookup argument | Use `{ preset(presetName: "SimplePBRMaterialPreset") { name entityType } }` |
| `Unknown argument "filter" on field "Query.allAssets"` | Guessed a generic filter object | Use scalar args: `typeFilter`, `nameContains`, `pathFilter`, `showPackedContent`, `limit`, `offset` |
| `Unknown argument "includeReadOnly"` | Guessed an asset-library flag from another API surface | Omit it. If you need package/internal assets, use `showPackedContent: true` where supported |
| `Unknown argument "presetType"` | Guessed a preset filter argument | Asset preset listing has no preset-type filter; use `{ presets { name assetType entityType } }` and filter client-side |
| `Enum value 'X' does not exist in 'EnumName'` | Wrong casing for enum literal | `ValueType`=UPPERCASE. Introspect `{ __type(name: "EnumName") { enumValues { name } } }` |
| `String cannot represent enum 'EnumName'` | Wrapped enum literal in quotes | Drop the quotes — enum args are bare identifiers |
| `Cannot query field "properties { ... }"` (or similar JSON subselection error) | `properties` is a JSON scalar | Query it without subselection: `{ asset(id: "...") { properties } }` |
| `Cannot query field "success" on type "AssetPresetMutationResult"` | Older MCP schema lacks `success` on that result | Retry with fields from the example (`id assetType name path properties message`) or introspect the result type |
| `Cannot query field "asset" on type "AssetPresetMutationResult"` | Mutation results are flat, not wrapped | Request direct fields: `{ id name path properties message }` |

### Result-shape compatibility

> See `graphql-common.md` § Result-shape compatibility for the shared advisory (applies to `createAssetFromPreset` and `createNativeAsset`). Asset result types to introspect:

```graphql
{ __type(name: "AssetPresetMutationResult") { fields { name } } }
{ __type(name: "NativeAssetMutationResult") { fields { name } } }
```

### 5. Cheatsheet of known-good queries

Asset-specific templates. Field names match the patterns documented above (verified against the source-of-truth descriptions in `src/Utils/GraphQL/Asset/`); re-introspect after schema changes.

```graphql
# Get one asset by ID
{ asset(id: "asset-uuid") { id name path assetType properties } }

# Find assets by name (e.g. before wiring a material reference)
{ assetsByName(name: "Red Material") { id name path assetType } }

# Verify a preset exists before creating
{ presets { name assetType } }
{ preset(presetName: "SimplePBRMaterialPreset") { name entityType } }

# List the asset types this tool knows about
{ assetTypes }
```

### 6. Batching independent mutations

> See `graphql-common.md` §6 for the shared batching pattern. Asset example:

```graphql
mutation {
  a: setProperty(id: "mat1", propertyPath: "passInfos.0.baseColor", value: {x:1,y:0,z:0,w:1}, valueType: VEC4) { success message }
  b: setProperty(id: "mat2", propertyPath: "passInfos.0.baseColor", value: {x:0,y:1,z:0,w:1}, valueType: VEC4) { success message }
}
```
