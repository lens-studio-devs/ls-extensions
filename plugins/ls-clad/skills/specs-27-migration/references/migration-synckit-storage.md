<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Migration: SyncKit StorageProperty Generics

**When this applies:** any match for `StorageProperty<`, `: StorageProperty<`,
`as StorageProperty<`, `SnapshotBufferOptions<`, `SnapshotBufferOptionsObj<`,
`StorageProperty.manual`, `StorageProperty.auto`, `getEqualsCheckForStorageType`, or
`getLerpForStorageType` in the project scan.

SpectaclesSyncKit now parameterizes `StorageProperty` (and friends) by a `StorageTypes` enum
member instead of the underlying TypeScript primitive. This is a **type-only** change — all
runtime values you assign (`string`, `number`, `vec3`, etc.) stay exactly as they were.

Only the type annotations and the `propertyType` argument on direct
`StorageProperty.manual`/`StorageProperty.auto` calls need to change. Helper wrappers like
`manualInt`, `autoFloat`, or `autoString` already bake in `StorageTypes.*`, so those usually
need no callsite edits unless the file also has explicit generic annotations. This mainly
affects `.ts` files.

## Detection Patterns

- `StorageProperty<` — any generic on StorageProperty
- `: StorageProperty<` — explicit annotations
- `as StorageProperty<` — casts
- `SnapshotBufferOptions<` / `SnapshotBufferOptionsObj<`
- `StorageProperty.manual` / `StorageProperty.auto` called with a string literal propertyType (e.g. `"int"`, `"string"`)
- `getEqualsCheckForStorageType` / `getLerpForStorageType` direct calls

## Migration Steps

### Add the StorageTypes import

`StorageTypes` is **not** re-exported from `StorageProperty.ts` — it must be imported from
its own module. Add this import to every `.ts` file that needs it:

```ts
import { StorageTypes } from "SpectaclesSyncKit.lspkg/Core/StorageTypes"
```

Missing this import produces `Cannot find name 'StorageTypes'` on every usage.

### Update `StorageProperty<T>` annotations

Replace primitive generic arguments with the matching `StorageTypes` enum member:

```ts
// OLD
private foo: StorageProperty<string>
private count: StorageProperty<number>
private pos: StorageProperty<vec3>

// NEW
private foo: StorageProperty<StorageTypes.string>
private count: StorageProperty<StorageTypes.int>   // or .float / .double — match what you pass at runtime
private pos: StorageProperty<StorageTypes.vec3>
```

**Important:** `number` was previously ambiguous and collapsed `int`/`float`/`double` into one
type. You must now pick the variant that matches the numeric type you pass to
`manualInt`/`manualFloat`/`manualDouble`/`autoInt`/etc. If you are unsure, check the factory
helper being used:

- `manualInt` / `autoInt` → `StorageTypes.int`
- `manualFloat` / `autoFloat` → `StorageTypes.float`
- `manualDouble` / `autoDouble` → `StorageTypes.double`

### Update return-type annotations on factory helpers

All typed static helpers (`manualString`, `manualInt`, `manualFloat`, `manualVec3`,
`autoBool`, `wrapProperty*`, etc.) now return `StorageProperty<StorageTypes.X>`:

```ts
// OLD
const nameProp: StorageProperty<string> = StorageProperty.manualString("name")

// NEW
const nameProp: StorageProperty<StorageTypes.string> = StorageProperty.manualString("name")
```

If the return type was inferred (no explicit annotation), nothing to change — inference
picks up the new type automatically.

### Update `StorageProperty.manual` / `StorageProperty.auto` propertyType

The `propertyType` argument must now be a `StorageTypes` enum member, not a string literal:

```ts
// OLD (previously compiled, but unsafe)
StorageProperty.manual("k", "int", 0)
StorageProperty.auto("k", "vec3", {
  getter: () => vec3.zero(),
  setter: (value) => {},
})
StorageProperty.manual("k", "string", "hello")

// NEW
StorageProperty.manual("k", StorageTypes.int, 0)
StorageProperty.auto("k", StorageTypes.vec3, {
  getter: () => vec3.zero(),
  setter: (value) => {},
})
StorageProperty.manual("k", StorageTypes.string, "hello")
```

`startingValue` is now cross-checked against `propertyType`, so mismatches like
`StorageProperty.manual("k", StorageTypes.int, "hi")` are compile errors — that's the
intended payoff of this change, not a bug to work around.

### Update `SnapshotBufferOptions` / `SnapshotBufferOptionsObj` generics

```ts
// OLD
const opts: SnapshotBufferOptions<number> = { ... }

// NEW
const opts: SnapshotBufferOptions<StorageTypes.float> = { ... }
```

### Update direct calls to `getEqualsCheckForStorageType` / `getLerpForStorageType`

```ts
// OLD
getEqualsCheckForStorageType<number>(StorageTypes.int)

// NEW
getEqualsCheckForStorageType<StorageTypes.int>(StorageTypes.int)
```

### Cascading errors to ignore

A single wrong generic produces a cascade of downstream errors. These all **auto-resolve**
once the `StorageProperty<StorageTypes.X>` annotations are correct — do not chase them as
independent fixes:

- `Argument of type 'StorageProperty<string>' is not assignable to parameter of type 'StorageProperty<StorageTypes>'` at every `syncEntity.addStorageProperty(prop)` call site.
- `Argument of type 'unknown' is not assignable to parameter of type 'string'` inside `prop.onRemoteChange.add((val) => ...)` callbacks and at `prop.currentValue` reads. The `unknown` inference comes from the broken upstream generic; once the generic is right, callbacks infer `StorageTypeToPrimitive[StorageTypes.X]` (the correct primitive) automatically.

If you fix the generic and these still don't disappear, the annotation itself is wrong —
don't patch the callback, fix the annotation.

### Detailed procedure

1. Grep the project for each of these forms:
   - `StorageProperty<`
   - `: StorageProperty<`
   - `as StorageProperty<`
   - `SnapshotBufferOptions<`
   - `SnapshotBufferOptionsObj<`
   Replace each generic argument with the matching `StorageTypes.X`.
2. Grep for direct `StorageProperty.manual(` and `StorageProperty.auto(` calls and replace any string-literal `propertyType` (e.g. `"int"`, `"string"`, `"vec3"`) with the corresponding `StorageTypes.X`.
3. Add `import { StorageTypes } from "SpectaclesSyncKit.lspkg/Core/StorageTypes"` to every `.ts` file that now references `StorageTypes`.
4. Run `tsc` from the plugin directory. The remaining errors should only be legitimate `startingValue` / `propertyType` mismatches — fix those by picking the correct `StorageTypes` variant or correcting the starting value.
5. Do **not** modify any runtime values. Values assigned to properties and passed as `startingValue` stay as primitives (`string`, `number`, `vec3`, etc.).

### What NOT to change

- Runtime values: `prop.setPendingValue(5)`, `prop.currentValue`, event payloads — no change.
- `.js` files using SyncKit: JavaScript has no type annotations, so only the `propertyType` argument on direct `StorageProperty.manual`/`auto` calls needs updating (string literal → `StorageTypes.X`). Helper wrappers like `autoInt` and `autoString` do not need callsite changes. That still requires a `require`/`import` of `StorageTypes` in JS when you update a direct `manual`/`auto` call.
