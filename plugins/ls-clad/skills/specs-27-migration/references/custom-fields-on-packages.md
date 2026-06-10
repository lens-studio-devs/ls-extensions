<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Custom Fields on Package Types

In older package versions and looser TypeScript configurations, user code could
attach arbitrary properties to package-owned objects — e.g., writing
`interactable.shouldBeActive = true` on an SIK `Interactable` even though
`Interactable` never declared a `shouldBeActive` field. When the package
upgrades and the types tighten, these reads/writes fail with:

```
error TS2339: Property '<custom>' does not exist on type '<PackageClass>'.
```

This is **not** a Spectacles (2024) → SPECS 27 API change, and **not** a
package API drift (the new package never had the property). It's user code
relying on an undeclared field. There is no single correct fix — the right
answer depends on whether the field was set in code, set via the Lens Studio
Inspector, or used to live on the package and was removed. **Always present
the options below to the user and let them choose.**

## Detection

After updating packages, fixing import paths (`package-path-suffix.md`), and
applying known API renames (`sik-api-drift.md`), recompile. Remaining `TS2339`
errors are candidates.

For each error like `Property '<prop>' does not exist on type '<Class>'`:

1. **Confirm the package never declared the property.** If the new package
   source mentions it, it's API drift — see `sik-api-drift.md`, not this
   document.

   ```bash
   grep -rn "<prop>" "Assets/<Package>.lspkg/" 2>/dev/null
   ```

   Zero hits means it's a custom field.

2. **Find where it's written.** Any TypeScript assignment to that property.

   ```bash
   grep -rnE "\.<prop>[[:space:]]*=" Assets/Scripts --include="*.ts" --include="*.js"
   ```

3. **Find where it's read.**

   ```bash
   grep -rnE "\.<prop>([^a-zA-Z0-9_]|$)" Assets/Scripts --include="*.ts" --include="*.js"
   ```

4. **Check for Inspector-authored values.** Scan `.scene` and `.prefab` YAML
   for the property name. If found, the field was historically populated by
   serialized scene data, which means the *previous* package version declared
   it as an `@input` or similar, and has now removed it.

   ```bash
   grep -rln "<prop>" Assets --include="*.prefab" --include="*.scene" 2>/dev/null
   ```

The combination of "read-only in code" + "present in scene/prefab YAML"
strongly indicates an Inspector-authored field that the package dropped — this
narrows the viable fix options significantly (Inspector data is lost on
package update unless the field is re-declared somewhere).

## Options (no single right answer)

Present these to the user, with a brief description of when each is
appropriate. Recommend based on the detection signal but do **not** apply a
fix without confirmation.

### A — Module augmentation

Re-declare the field as part of the package's type via TypeScript module
augmentation. Type-safe and central — call sites do not change.

```typescript
// Assets/Scripts/TS/<Package>Augmentations.ts
export {};

declare module "<relative-or-mapped-path-to-package-source>" {
  interface <ClassName> {
    <prop>?: <type>;
  }
}
```

The path used in `declare module "..."` is resolved relative to this file. As
long as it resolves to the same source file the call sites import from,
TypeScript will merge the augmentation in regardless of how each consumer
spells its own import path.

**When this fits:** the field's value is set and read entirely from TypeScript
code. Both endpoints participate in normal value lifetime. No Inspector
authoring.

**When this fits less well:** the field was Inspector-authored — augmenting
the type makes TypeScript happy, but the previously-serialized values are
still stripped on package update (the package's own class doesn't recognize
the field anymore for serialization).

### B — `as any` cast at call sites

At each read/write, cast the receiver to `any`:

```typescript
(interactable as any).shouldBeActive = false;
if ((interactable as any).shouldBeActive) { ... }
```

For reads where `undefined` is a possible outcome, combine with optional
chaining and a default:

```typescript
const text = (it as any).description ?? "";
if ((it as any).description?.length > 0) { ... }
```

**When this fits:** the call sites are few (1–3 expressions) and you want to
minimize total diff.

**When this fits less well:** the property is used in many places — repeated
`as any` casts spread untyped accesses through the codebase. Prefer A then.

### C — Sidecar component

Define a new user-owned `BaseScriptComponent` whose only job is to hold the
data, attach it to the same `SceneObject` that previously had the field on
the package class, and read/write the sidecar instead.

```typescript
@component
export class InteractableMetadata extends BaseScriptComponent {
  @input description: string = "";
  @input shouldBeActive: boolean = true;
}
```

Callers do `sceneObject.getComponent(InteractableMetadata.getTypeName())`.

**When this fits:** the field was Inspector-authored and the values mattered.
You can re-author the data on the sidecar in scenes/prefabs.

**When this fits less well:** dozens of SceneObjects need the sidecar added,
or the field is purely behavioral and never Inspector-set.

### D — Off-instance Map / WeakMap

Keep the per-instance state outside the package object entirely.

```typescript
const shouldBeActive = new WeakMap<Interactable, boolean>();
shouldBeActive.set(interactable, true);
if (shouldBeActive.get(interactable)) { ... }
```

**When this fits:** the field is small, code-only, and you want to avoid
mutating package objects at all. `WeakMap` allows GC when the Interactable
goes away.

**When this fits less well:** the lifecycle of the field is tied to scene
serialization, or the call sites assume direct-property syntax.

### E — Remove the feature

If the field supports a feature that's no longer needed, delete the reads,
writes, and any UI / behavior that depends on it. Simplest if the feature is
optional.

## Choosing

Use the detection signals to recommend, but always present alternatives.

- Code-only field, both read and written in TypeScript: A or B (A scales
  better; B is minimal diff for 1–2 sites).
- Inspector-authored field, read-only in code, value matters: C is usually
  required (the data has to live somewhere the new package doesn't strip on
  load).
- Inspector-authored field, read-only in code, value not critical: B with
  `?? <default>` is acceptable as a stopgap.
- Unused or low-value feature: E.

State the recommendation and the trade-off plainly. Get explicit user approval
before editing — these fixes are partly behavioral, not just type-level.
