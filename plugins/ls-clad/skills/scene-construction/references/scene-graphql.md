<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Scene GraphQL Operations

Patterns for the `scene-graphql` MCP tool. Every operation below is verified against the source code — use these exact argument names, value formats, and return fields.

> **Leading gotcha — enum-arg casing.** See `graphql-common.md` § Enum-arg casing for the shared rule (`ValueType` is UPPERCASE). Surface-specific:
>
> - `ScenePresetType` uses **TitleCase**: `presets(type: SceneObject)` / `Component` (not `"SceneObject"`, not `SCENEOBJECT`).

## Creating Scene Objects

### From a preset

```graphql
mutation {
  createSceneObjectFromPreset(
    presetName: "BoxMeshObjectPreset"
    name: "MyBox"
    parentId: "parent-uuid"  # optional, omit for root
  ) {
    id
    name
    parentId
    components
    message
  }
}
```

Common presets: `PlaneMeshObjectPreset`, `BoxMeshObjectPreset`, `SphereMeshObjectPreset`, `BoxPhysicsObjectPreset`, `SpherePhysicsObjectPreset`, `CameraObjectPreset`, `LightObjectPreset`, `OrthographicCameraObjectPreset`, `ScreenImageObjectPreset`, `ScreenTextObjectPreset`. Use the `presets` query to discover all available names.

### Empty scene object

```graphql
mutation {
  createSceneObject(name: "Container", parentId: "parent-uuid") {
    id
    name
    parentId
    components
  }
}
```

`parentId` is optional — omit for root level.

### Batch creation with aliases

Create multiple objects in one call using GraphQL aliases:

```graphql
mutation {
  w1: createSceneObjectFromPreset(presetName: "BoxPhysicsObjectPreset", name: "Wall_Top", parentId: "walls-id") { id name components }
  w2: createSceneObjectFromPreset(presetName: "BoxPhysicsObjectPreset", name: "Wall_Bottom", parentId: "walls-id") { id name components }
  w3: createSceneObjectFromPreset(presetName: "BoxPhysicsObjectPreset", name: "Wall_Left", parentId: "walls-id") { id name components }
}
```

This is significantly faster than separate calls. Aliases (`w1:`, `w2:`, etc.) are required when calling the same mutation multiple times.

## Setting Transforms

```graphql
mutation {
  setLocalTransform(
    id: "object-uuid"
    position: { x: 0, y: 10, z: 0 }
    scale: { x: 2, y: 2, z: 2 }
    rotation: { x: -90, y: 0, z: 0 }  # degrees
  ) {
    success
    message
  }
}
```

All fields (`position`, `rotation`, `scale`) are optional — omit any you don't need to change. Omitted components within a vec3 (e.g., `{ y: 10 }`) preserve the existing x and z values.

## Querying Scene Objects

Use the exact top-level query names below. Common hallucinations from benchmark logs include `sceneObjects`, `assets`, and `component` on `Query`; none of those are scene-graphql queries. If you need the authoritative list, run `{ __schema { queryType { fields { name } } } }` before trying variants.

### Root objects (top-level only)

```graphql
{
  rootSceneObjects {
    id
    name
    localTransform {
      position { x y z }
      scale { x y z }
      rotation { x y z }
    }
    children { id name }
    components { type id name enabled properties }
  }
}
```

### All objects (full hierarchy)

```graphql
{
  allSceneObjects(nameContains: "Ball", hasComponent: "Camera", limit: 20, offset: 0) {
    id
    name
    enabled
    parentId
    components { type id name enabled properties }
  }
}
```

### Available filters (same for `rootSceneObjects` and `allSceneObjects`)

| Argument | Type | Description |
|---|---|---|
| `hasComponent` | String | Filter by component type (case-insensitive partial match) |
| `nameContains` | String | Filter by name (case-insensitive partial match) |
| `hasProperty` | `{key, value}` | Filter by component property key/value pair |
| `limit` | Int | Max results to return |
| `offset` | Int | Skip first N results |

### Single object by ID

```graphql
{
  sceneObject(id: "uuid") {
    name
    enabled
    parentId
    parent { name id }
    localTransform { position { x y z } scale { x y z } }
    layers { mask }
    components { type id name enabled properties }
    children { id name }
  }
}
```

### Count (useful with pagination)

```graphql
{ sceneObjectCount(hasComponent: "Camera") }
```

Same filter arguments as `rootSceneObjects`/`allSceneObjects` (except `limit`/`offset`).

### Transform field syntax

Transform fields are nested: `localTransform { position { x y z } }`. Do NOT use `localPosition`, `localScale`, or `localRotation` — these field names don't exist.

## Setting Properties

```graphql
mutation {
  setProperty(
    id: "component-uuid"
    propertyPath: "dynamic"
    value: false
    valueType: BOOLEAN
  ) {
    success
    message
  }
}
```

**Critical details:**
- `id` is the **component** ID, not the scene object ID. Query the object's components to find it.
- `propertyPath` is the argument name — not `path` or `property`.
- `valueType` is required.
- When `valueType` is `ENUM`, you must also pass `enumType` (e.g., `enumType: "Editor.Assets.BlendMode"`).
- Return fields `{ success message }` are required — mutations without return fields fail.

### Value formats by type

| valueType | Format | Example |
|---|---|---|
| `BOOLEAN` | Boolean or string | `false` or `"false"` |
| `NUMBER` | Number or string | `0.3` or `"0.3"` |
| `STRING` | String | `"hello"` |
| `VEC2` | Comma string or object | `"1.0, 2.0"` or `{x: 1.0, y: 2.0}` |
| `VEC3` | Comma string or object | `"0, -981, 0"` or `{x: 0, y: -981, z: 0}` |
| `VEC4` | Comma string or object | `"0.8, 0.1, 0.1, 1.0"` or `{x: 0.8, y: 0.1, z: 0.1, w: 1.0}` |
| `REFERENCE` | UUID string | `"asset-uuid"`, `"sceneObject-uuid"`, or `"component-uuid"` (for a script `@input` typed as a component/script, use the **component's** UUID — see § Script component properties) |
| `ENUM` | Enum member name | `"Normal"` (requires `enumType`) |
| `TRANSFORM` | Object | `{position: {x,y,z}, rotation: {x,y,z}, scale: {x,y,z}}` |
| `RECT` | Object | `{left: 0, right: 1, bottom: 0, top: 1}` |
| `LAYER_SET_MASK` | Integer | `1048576` (bitmask) |

### Common examples

```graphql
# Boolean
setProperty(id: "body-comp-id", propertyPath: "dynamic", value: false, valueType: BOOLEAN) { success }

# Number
setProperty(id: "body-comp-id", propertyPath: "damping", value: 0.3, valueType: NUMBER) { success }

# Reference (assign material to mesh)
setProperty(id: "rmv-comp-id", propertyPath: "materials.0", value: "material-asset-id", valueType: REFERENCE) { success }

# Vec3 (set gravity)
setProperty(id: "settings-id", propertyPath: "gravity", value: "0, -981, 0", valueType: VEC3) { success }

# Vec4 (set color)
setProperty(id: "material-id", propertyPath: "passInfos.0.baseColor", value: {x: 0.8, y: 0.1, z: 0.1, w: 1.0}, valueType: VEC4) { success }

# Enum
setProperty(id: "comp-id", propertyPath: "blendMode", value: "Normal", valueType: ENUM, enumType: "Editor.Assets.BlendMode") { success }

# Layer mask
setProperty(id: "comp-id", propertyPath: "renderLayer", value: 1048576, valueType: LAYER_SET_MASK) { success }
```

### Script component properties

Script properties use the property name directly — NOT `inputs.propertyName`:
```graphql
setProperty(id: "script-comp-id", propertyPath: "myBool", value: true, valueType: BOOLEAN) { success }
```

**Wiring a component-typed `@input`** (e.g. `@input uiHud: BubblePopUI`) via `setProperty REFERENCE`: `value` MUST be the target **component's** UUID, **not** its SceneObject's UUID — a SceneObject id reports `success: true` but reads back null at runtime (`Input <name> was not provided`). Query the object's components for the right `ScriptComponent` id, then:
```graphql
# wire BubblePop.uiHud → the BubblePopUI script component on the BubblePopUI object
setProperty(id: "bubblepop-script-comp-id", propertyPath: "uiHud", value: "bubblepopui-script-comp-id", valueType: REFERENCE) { success }
```

**Array-typed `@input`** (e.g. `@input providers: HelloProvider[]`) — pass the whole list of **component** UUIDs in one call (VirtualScene can't):
```graphql
setProperty(id: "consumer-script-comp-id", propertyPath: "providers", value: ["provider-comp-id-1", "provider-comp-id-2"], valueType: REFERENCE) { success }
```

## Components

### Add a component

```graphql
mutation {
  addComponent(id: "object-uuid", componentType: "BodyComponent") {
    id
    type
    name
    parentId
    parentName
    enabled
    properties
    success
    message
  }
}
```

Common types: `BodyComponent`, `ColliderComponent`, `RenderMeshVisual`, `Camera`, `LightSource`, `ScriptComponent`, `ScreenTransform`, `Image`, `Text`. Shorthand like `"Script"` is accepted (normalizes to `ScriptComponent`).

### Add from preset

```graphql
mutation {
  createComponentFromPreset(id: "object-uuid", presetName: "ScriptComponentPreset") {
    id
    type
    name
    parentId
    properties
    message
  }
}
```

### Remove a component

```graphql
mutation {
  removeComponent(componentId: "component-uuid") {
    success
    message
    id
    name
  }
}
```

Note: the argument is `componentId`, not `id`.

## Hierarchy Operations

```graphql
# Rename
mutation { setName(id: "object-uuid", newName: "NewName") { success message name } }

# Reparent (omit parentId for root)
mutation { setParent(id: "child-uuid", parentId: "new-parent-uuid") { success message } }

# Delete
mutation { deleteSceneObject(id: "object-uuid") { success message } }

# Toggle visibility
mutation { setEnabled(id: "object-uuid", enabled: false) { success message } }

# Set layer mask
mutation { setLayers(id: "object-uuid", mask: 1048576) { success message } }

# Duplicate
mutation {
  duplicateSceneObject(id: "object-uuid", newName: "Copy", parentId: "parent-uuid") {
    id
    name
    parentId
    components
    success
    message
  }
}
```

`newName` and `parentId` are optional on `duplicateSceneObject`.

## Prefab Operations

### Instantiate a prefab

```graphql
mutation {
  instantiatePrefab(prefabId: "prefab-asset-uuid", parentId: "parent-uuid", name: "Instance") {
    id
    name
    parentId
    components
    success
    message
  }
}
```

`parentId` and `name` are optional.

### Create a prefab from scene object

```graphql
mutation {
  # destinationPath is "folder/basename" relative to Assets/ (no extension) —
  # do NOT prefix with "Assets/" or it will be normalized and noted in `message`.
  createPrefabFromSceneObject(id: "object-uuid", destinationPath: "Prefabs/MyPrefab", prefabName: "MyPrefab") {
    id
    sourceObjectId
    path
    name
    message
  }
}
```

`prefabName` is optional.

### Query prefab contents

```graphql
{
  prefabSceneObjects(prefabId: "prefab-asset-uuid", hasComponent: "Camera") {
    id
    name
    components { type id properties }
  }
}
```

Same filter arguments as `rootSceneObjects`.

## Preset Discovery

```graphql
# List all scene presets
{ presets(type: SceneObject) { name description entityType section } }

# List component presets
{ presets(type: Component) { name description entityType section } }

# Get a single preset
{ preset(presetName: "BoxMeshObjectPreset") { name description entityType } }
```

`type` is optional — omit to get both SceneObject and Component presets.

`presetName` is the argument name for single-preset lookup and preset-create mutations. Do not use `preset(name: ...)`, `preset(type: ...)`, or `name:` for preset lookup.

## Error Codes

When `success` is `false`, the `errorCode` field contains one of: `NOT_FOUND`, `UNKNOWN_PROPERTY_PATH`, `TYPE_MISMATCH`, `READ_ONLY_PROPERTY`, `INVALID_ENUM_VALUE`, `INVALID_ARGUMENT`, `INTERNAL_ERROR`.

## Common Mistakes & How to Recover

### 1. Editor API ≠ GraphQL surface

> See `graphql-common.md` §1. (`scene-graphql` is the GraphQL surface; `Editor.Assets.Scene` / `Editor.Components.*` access goes through `ExecuteEditorCode`.)

### 2. Composite fields require subselections (but `properties` is JSON)

> See `graphql-common.md` §2 for the shared rule. Scene composite types: `Component`, `LayerSet`, `SceneObject`, `Transform`, etc. Scene-specific examples:

```graphql
# ❌ { sceneObject(id: "uuid") { components } }
# ✅ { sceneObject(id: "uuid") { components { id type enabled } } }

# ❌ { sceneObject(id: "uuid") { layers } }
# ✅ { sceneObject(id: "uuid") { layers { mask } } }
```

`properties` is the exception — it's a JSON scalar, query it WITHOUT subfields:

```graphql
# ✅ { sceneObject(id: "uuid") { components { id type properties } } }
# ❌ { sceneObject(id: "uuid") { components { properties { key value } } } }
```

Mutation results are flat:

```graphql
# ✅ createSceneObject(name: "X") { id name parentId components }
# ❌ createSceneObject(name: "X") { sceneObject { id name } }
```

Introspect a scene composite type with `{ __type(name: "LayerSet") { fields { name type { name kind } } } }`.

### 3. Don't guess field names — introspect

> See `graphql-common.md` §3. Scene-specific type introspection:

```graphql
{ __type(name: "SceneObject") { fields { name type { name kind } } } }  # fields on a specific type
```

### 4. Error → fix lookup

Pattern-match on the error fragment, not the prose around it.

| Error fragment | Cause | Fix |
|---|---|---|
| `doesn't exist on typeof Editor` | Used `Editor.*` inside a GraphQL string | Move to `ExecuteEditorCode`; GraphQL is not JavaScript |
| `Field ... must have a selection of subfields` | Composite field without `{ }` | Add `{ id name ... }`. Inline hint from `errorHints.enrichErrors` lists the type's fields |
| `Cannot query field "X" on type "Y" — did you mean Z?` | Wrong field name | Use the suggestion if present; else introspect `{ __type(name: "Y") { fields { name } } }` |
| `Cannot query field "sceneObjectById" on type "Query"` (or any other hallucinated name) | Top-level query doesn't exist | Introspect `{ __schema { queryType { fields { name } } } }` |
| `Cannot query field "sceneObjects" on type "Query"` | Invented query name | Use `allSceneObjects(...)` or `rootSceneObjects(...)` |
| `Cannot query field "component" on type "Query"` | Components are nested under scene objects | Query `sceneObject(id: "...") { components { id type properties } }` or `allSceneObjects(...) { components { ... } }` |
| `Cannot query field "assets" on type "Query"` | Mixed asset-graphql into scene-graphql | Use `asset-graphql` (`allAssets`, `asset`, `assetsByName`) |
| `Unknown argument "name" on field "Query.preset"` or `Field "preset" argument "presetName" is required` | Used the wrong preset lookup argument | Use `{ preset(presetName: "BoxMeshObjectPreset") { name entityType } }` |
| `Unknown argument "presetType"` / `filter` / `includeReadOnly` | Guessed an argument from another surface | Use the documented args or introspect the field args first |
| `Enum value 'X' does not exist in 'EnumName'` | Wrong casing for enum literal | `ValueType`=UPPERCASE, `ScenePresetType`=TitleCase. Introspect `{ __type(name: "EnumName") { enumValues { name } } }` |
| `String cannot represent enum 'EnumName'` | Wrapped enum literal in quotes | Drop the quotes — enum args are bare identifiers |
| `Cannot query field "properties { ... }"` (or similar JSON subselection error) | `properties` is a JSON scalar | Query it without subselection: `{ components { properties } }` |
| `Cannot query field "success" on type "SceneObjectMutationResult"` | Older MCP schema lacks `success` on that result | Retry with fields from the example (`id name parentId components message`) or introspect the result type |

### Result-shape compatibility

> See `graphql-common.md` § Result-shape compatibility for the shared advisory. Scene result types to introspect:

```graphql
{ __type(name: "SceneObjectMutationResult") { fields { name } } }
{ __type(name: "ComponentMutationResult") { fields { name } } }
```

### 5. Cheatsheet of known-good queries

Scene-specific templates. Field names match the patterns documented above (verified against the source-of-truth descriptions in `src/Utils/GraphQL/Scene/`); re-introspect after schema changes.

```graphql
# Read top-level objects + immediate children
{ rootSceneObjects { id name children { id name } } }

# Full info for one object (most common)
{ sceneObject(id: "uuid") {
    id name enabled parentId
    localTransform { position { x y z } scale { x y z } rotation { x y z } }
    components { id type enabled }
} }

# Find objects by name or component
{ allSceneObjects(nameContains: "Camera", limit: 10) { id name } }
{ allSceneObjects(hasComponent: "Camera") { id name } }

# Count without fetching
{ sceneObjectCount(hasComponent: "BodyComponent") }

# Verify a preset exists before creating
{ presets(type: SceneObject) { name } }
{ preset(presetName: "BoxMeshObjectPreset") { name entityType } }
```

### 6. Batching independent mutations

> See `graphql-common.md` §6 for the shared batching pattern. Scene example:

```graphql
mutation {
  a: setProperty(id: "comp1", propertyPath: "enabled", value: true, valueType: BOOLEAN) { success message }
  b: setLocalTransform(id: "obj1", position: { x: 0, y: 10, z: 0 }) { success message }
}
```
