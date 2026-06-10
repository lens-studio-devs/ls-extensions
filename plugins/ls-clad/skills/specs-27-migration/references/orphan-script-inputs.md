<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Orphan `@input` Fields After Migration

When this skill rewrites code — most commonly during the WebView / fetch / HTTP migration
(`RemoteServiceModule` → `InternetModule`) — it sometimes leaves behind a script-level
`@input` declaration that no other line in the file references. The TypeScript compiler
does **not** flag this: an `@input` is valid syntax regardless of whether the field is
read elsewhere. But the Lens runtime treats every `@input` as a required Inspector slot
and crashes on Lens start with:

```
Error: Input <fieldName> was not provided for the object <SceneObjectName>
checkUndefined@Scripts/TS/<Class>_c.js:...
```

The error is **only visible after launching the preview**. A green TypeScript compile is
not sufficient — every migration that touches `@input` declarations or type swaps must be
followed by a runtime log check.

## When this commonly happens

| Migration | Why it produces orphans |
|---|---|
| `RemoteServiceModule` → `InternetModule` | A file with both an unused `@input remoteServiceModule: RemoteServiceModule` *and* a `private internetModule = require("LensStudio:InternetModule")` previously type-checked fine; after the type swap the `@input` is still there, still unused, and now its Inspector slot has no asset wired to it. |
| Renaming an `@input` variable | If the rename does not match the field name in scenes/prefabs, the new name has no serialized value and the old name no longer exists in code — the runtime sees an unprovided input under the new name. |
| Removing the only use of an `@input` field during a refactor | The declaration was kept (perhaps as future-use), but the Lens now treats it as unprovided. |

## Detection

Run the preview (or recompile + collect logs) and scan for the exact pattern:

```
grep -nE "Input [A-Za-z_][A-Za-z0-9_]* was not provided for the object" "<runtime-log>"
```

Each match gives you:

- `<fieldName>` — the property name on the script.
- `<SceneObjectName>` — the SceneObject that holds the broken ScriptComponent.

If you have multiple errors of this shape, deal with them all in one pass.

## Diagnose: is the field actually used?

Find the source file by the field name. The pattern is robust because `@input` field
names are usually unique within a file:

```bash
grep -rnE "@input.*<fieldName>" Assets/Scripts \
  --include="*.ts" --include="*.js"
```

Then check whether the field is read or written **anywhere else in the same file**:

```bash
grep -nE "(this|script)\.<fieldName>([^a-zA-Z0-9_]|$)" "<FoundFile>"
```

Three outcomes:

1. **Zero other references in the file** → the field is genuinely orphaned. Remove the
   declaration. This is the most common case after our WebView migration.
2. **Other references exist, and they're the only consumer of the value** → the field is
   used but never wired in the Inspector. Either remove it (if the value comes from
   somewhere else, like a `require()` on the next line) or tell the user to wire it.
3. **Other references exist, and the value comes from `require(...)` inline somewhere
   else in the file** → classic "@input shadowed by a require". Remove the @input.

The shadowed-by-require pattern is what produces orphan errors after WebView migration.
Recognize it by the file having two declarations that target the same concept — one
`@input` (typed against the new module) and one `private <name> = require("LensStudio:<Module>")`.
Drop the `@input`; the require is the actual provider.

## Fix

For genuine orphans (case 1) and shadowed-by-require (case 3), delete the entire
`@input ...` line. Use `Edit` with enough surrounding context to make the deletion
unambiguous — including the line above and below in `old_string` is fine.

For wired-but-required fields (case 2), tell the user the field needs a value in the
Inspector and identify the SceneObject (from the runtime error's `<SceneObjectName>`).
Do not auto-wire serialized scene data — that requires Inspector authoring.

## Verify

After each fix:

1. Recompile TypeScript via the `RecompileTypeScriptTool` MCP tool. Should pass.
2. Re-launch the preview and collect logs via the `RunAndCollectLogsTool` MCP tool.
3. Confirm the original `Input <fieldName> was not provided` error is gone.
4. Confirm no **new** `Input ... was not provided` errors appeared. (Removing one
   orphan can occasionally expose another that previously got drowned out — the Lens
   often stops on the first such error.)

Repeat the detection grep against the new logs until the pattern returns zero matches.

## Pitfall: do not remove fields that the scene relies on

If `<fieldName>` appears inside a scene or prefab YAML (e.g.,
`Assets/Generated/Scene.scene` has `ScriptInputs: <fieldName>: <some-uuid>`), it was
historically wired. Removing the `@input` then re-saving the scene will silently strip
that serialized reference. If the field is also referenced in code, that's case 2 above
and the right answer is to keep the @input and wire the value. Only delete when the field
is truly unused in code **and** has no serialized binding.

Quick check:

```bash
grep -rn "<fieldName>:" Assets --include="*.prefab" --include="*.scene" 2>/dev/null
```

If this returns hits and the field is used in code → keep the @input, surface the
wiring requirement to the user. If this returns hits but the field is unused in code →
also surface to the user before deleting; they may want the field re-bound rather than
dropped.
