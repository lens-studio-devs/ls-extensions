<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Phase 3a — canonical bootstrap shape (specs-bootstrap-scene)

On-demand detail for the `specs-bootstrap-scene` skill's two-phase VirtualScene bootstrap (Phase 3a). The SKILL.md keeps the ImageMaterial-detection grep, the strict-allowlist rules, and the recovery logic inline; the full canonical JSONC (Phase A assets+create, the inter-phase recompile, Phase B input-wiring, authored-root handling, and the `ExecuteEditorCode` fallback) is here. Read this at bootstrap write time.

---

#### Canonical shape (two-phase apply, with ImageMaterial)

**Phase A — assets + create (no input wiring):**

```jsonc
VirtualScene { command: "apply", instructions: {
  "assets": [
    { "id": "$temp:imgMat", "preset": "ImageMaterialPreset",
      "name": "ImageMaterial", "destinationPath": "Materials" }
  ],
  "create": [
    { "id": "$temp:root", "name": "<ExperienceName>",
      "components": [
        { "type": "ScriptComponent",
          "properties": { "scriptAsset": "@asset:Scripts/<ExperienceName>Main.ts" } }
      ]
    },
    { "id": "$temp:uiGroup", "name": "UI", "parentId": "$temp:root" },
    { "id": "$temp:anchorsGroup", "name": "Anchors", "parentId": "$temp:root" },
    { "id": "$temp:contentGroup", "name": "Content", "parentId": "$temp:root" },
    { "id": "$temp:placeholdersGroup", "name": "Placeholders", "parentId": "$temp:root" },

    // One authored root per UI SURFACE (the default) — each at its own
    // spatial-layout pose, each in its own z depth slot. The owning module's
    // ScriptComponent goes on the root it owns; a second surface is a sibling
    // root the module adopts by name (panelRoot), not a runtime-created child.
    { "id": "$temp:scorePanel", "name": "ScorePanel", "parentId": "$temp:uiGroup",
      "transform": { "position": { "x": 0, "y": 20, "z": -110 } },
      "components": [
        { "type": "ScriptComponent",
          "properties": { "scriptAsset": "@asset:Scripts/<ExperienceName>ScorePanelUI.ts" } }
      ]
    },
    { "id": "$temp:gameOverDialog", "name": "GameOverDialog", "parentId": "$temp:uiGroup",
      "transform": { "position": { "x": 0, "y": 0, "z": -108 } },
      "components": [
        { "type": "ScriptComponent",
          "properties": { "scriptAsset": "@asset:Scripts/<ExperienceName>GameOverDialogUI.ts" } }
      ]
    },

    { "id": "$temp:spawnPointA", "name": "SpawnPoint_A", "parentId": "$temp:anchorsGroup",
      "transform": { "position": { "x": -12, "y": 0, "z": -110 } } },

    { "id": "$temp:playerSlot", "name": "PlayerSlot", "parentId": "$temp:placeholdersGroup",
      "transform": { "position": { "x": 0, "y": -8, "z": -110 } },
      "components": [
        { "type": "ScriptComponent",
          "properties": { "scriptAsset": "@asset:Scripts/<ExperienceName>PlayerController.ts" } }
      ]
    }
  ]
}}
```

Note: components have only `type` and `properties`. No `id`. No main-to-UI/controller refs. The Phase A apply just lands the authored structure.

**Between Phase A and Phase B:** call `RecompileTypeScriptTool` so the `@input` slots register against the live ScriptComponents. If recompile fails, fix the script and retry — do NOT proceed to Phase B with a failed compile (input writes can fail with `Script input '<name>' not found on ScriptComponent — recompile…`).

**Phase B — modify to wire component refs, authored-object refs, arrays, and scalar tunables:**

```jsonc
VirtualScene { command: "apply", instructions: {
  "modify": {
    "@sceneObject:<ExperienceName>": {
      // SceneObject-typed refs and scalars are fine in modify:
      "components.ScriptComponent.primarySpawnPoint": "@sceneObject:SpawnPoint_A"
      // NOTE: script-component-typed refs (scorePanel: ScorePanelUI, playerController: …)
      // are NOT wired here — modify silently no-ops them. Wire them via scene-graphql
      // setProperty REFERENCE (UUIDs) after this apply, then read back. See below.
    },
    "@sceneObject:ScorePanel": {
      "components.ScriptComponent.widthCm": 14,
      "components.ScriptComponent.paddingCm": 0.8,
      "components.ScriptComponent.labelText": "Score"
    }
  }
}}
```

Then wire the script-component refs (and any array refs) and verify:

```jsonc
scene-graphql { query: `mutation {
  // SINGLE script-component ref → value is a PLAIN STRING UUID, not an array.
  setProperty(id: "<MainScriptComponentUUID>", propertyPath: "scorePanel",
              valueType: REFERENCE, value: "<ScorePanelUI ScriptComponent UUID>") { success }
}` }
// then read scorePanel back (scene-graphql query / QueryRuntimeSceneTool) and assert non-null.
// An ARRAY-typed input takes an array instead: value: ["<uuid1>", "<uuid2>", …].
```

`@input scorePanel!: ScorePanelUI` typed as the UI class resolves at runtime via Lens Studio's [@input + class-type pattern](https://developers.snap.com/lens-studio/features/scripting/accessing-components#accessing-typescript-from-typescript). **Wiring a script-component-typed input reliably: use `scene-graphql setProperty(id, propertyPath, valueType: REFERENCE, value: "<targetScriptComponentUUID>")` — the `value` shape matches the property's arity, so a single reference is a plain string UUID and an array-typed input is an array of UUIDs (`["<uuid1>", …]`); the single-element array form `["<uuid>"]` for a scalar ref returns `success: false` and binds nothing. Read it back to confirm it bound** (SKILL wiring steps 7–8a). Do **NOT** wire it with a `modify` value of `@component:<path>/<ScriptName>` — every script component is *type* `ScriptComponent`, so `<ScriptName>` is not a resolvable component-type there; VirtualScene returns `applied`/no-error and binds nothing, and the lens crashes at runtime with `Input <field> was not provided`. The `modify` block above is for SceneObject refs (`@sceneObject:`), asset/texture refs, and scalar tunables; array and script-component refs go through the `scene-graphql` REFERENCE path and are verified by read-back — never trust the `applied` count for a reference property.

If the grep returned zero hits, drop the `"assets"` block from Phase A. If the manifest has multiple UI panels/controllers/anchors, add one create entry per authored semantic root in Phase A and one `components.ScriptComponent.<inputName>` line per wired ref/tunable in Phase B — all batched into the single Phase B modify call.

**Fallback** (only if VirtualScene is genuinely unavailable): one `ExecuteEditorCode` per phase, doing the same steps. Never split bootstrap across more than the two phases above.

---

#### Saving the project — the exact call

Everything built through MCP lives only in the running editor until this runs, and the save lives on the **project**, not the model. One `ExecuteEditorCode` call, verbatim:

```ts
const model = pluginSystem.findInterface(Editor.Model.IModel);
model.project.save();
```

`model.save()` does not exist. Confirm `Assets/Scene.scene` on disk before reporting `project_saved: true`.

If the save throws `Cannot save project while an asset operation is in progress`, a pending import has not settled: the mutation still succeeded, so call `save()` again in a follow-up call rather than treating it as a failure.

#### Reading `.virtual-scene.json`

`VirtualScene { command: "read" }` serializes the scene next to the `.esproj`. Read it **once** per bootstrap half. Query it with `jq`, never a Python heredoc. The keys every consumer in this plugin relies on:

- **`sceneObjects[]`** — one record per object, carrying at least `id`, `name`, and `components[]`; each component has a `type` (`ScriptComponent`, `RenderMeshVisual`, `BodyComponent`, …). `jq '.sceneObjects[] | select(.name=="<Name>") | {id, comps: [.components[].type]}'` is the standard lookup.
- **`assets[]`** — one record per asset, carrying `id`, `name` and `type` (`Scene`, `ObjectPrefab`, `Material`, …), plus its path. Assets referenced by presets or `requireAsset` are found here by `type` + `name`, not in the object tree.
- **Component properties are flattened to dot-paths** — exactly the `components.<ComponentType>.<property>` spelling a Phase B `modify` takes, which is why the read is the authoritative source for a property name you are about to write.

Trust it only between consecutive VirtualScene applies in a single-writer session: after any `ExecuteEditorCode`/`scene-graphql` mutation or runtime change, re-run the read instead of re-reading the file.

#### `GetBoundingBox` degrades silently

With `includeChildren: true` it returns a transform-AABB fallback — a suspiciously round ~100 cm cube — for prefab-instantiated roots that render correctly. Round transform-sized numbers, or the same cube on a known-good object, mean the reading is meaningless: retry without `includeChildren`, or fall back to `QueryRuntimeSceneTool`'s `bounds { min max }` plus a capture. Never do placement math on a fallback.
