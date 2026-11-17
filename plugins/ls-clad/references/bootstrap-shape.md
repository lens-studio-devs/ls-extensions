<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Phase 3a — canonical bootstrap shape (specs-experience-builder)

On-demand detail for Phase 3a's two-phase VirtualScene bootstrap. The agent body keeps the ImageMaterial-detection grep, the strict-allowlist rules, and the recovery logic inline; the full canonical JSONC (Phase A assets+create, the inter-phase recompile, Phase B input-wiring, authored-root handling, and the `ExecuteEditorCode` fallback) is here. Read this at Phase 3a write time.

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

    { "id": "$temp:scorePanel", "name": "ScorePanel", "parentId": "$temp:uiGroup",
      "transform": { "position": { "x": 0, "y": 0, "z": -110 } },
      "components": [
        { "type": "ScriptComponent",
          "properties": { "scriptAsset": "@asset:Scripts/<ExperienceName>ScorePanelUI.ts" } }
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
      "components.ScriptComponent.scorePanel": "@sceneObject:ScorePanel",
      "components.ScriptComponent.playerController": "@sceneObject:PlayerSlot",
      "components.ScriptComponent.primarySpawnPoint": "@sceneObject:SpawnPoint_A"
    },
    "@sceneObject:ScorePanel": {
      "components.ScriptComponent.widthCm": 14,
      "components.ScriptComponent.paddingCm": 0.8,
      "components.ScriptComponent.labelText": "Score"
    }
  }
}}
```

`@input scorePanel!: ScorePanelUI` typed as the UI class resolves at runtime via Lens Studio's [@input + class-type pattern](https://developers.snap.com/lens-studio/features/scripting/accessing-components#accessing-typescript-from-typescript). Component-typed inputs should ultimately resolve to the target ScriptComponent; if VirtualScene cannot express a specific component/array input reliably, use the documented `scene-graphql setProperty` component-UUID path for that property only, after the Phase B apply.

If the grep returned zero hits, drop the `"assets"` block from Phase A. If the manifest has multiple UI panels/controllers/anchors, add one create entry per authored semantic root in Phase A and one `components.ScriptComponent.<inputName>` line per wired ref/tunable in Phase B — all batched into the single Phase B modify call.

**Fallback** (only if VirtualScene is genuinely unavailable): one `ExecuteEditorCode` per phase, doing the same steps. Never split bootstrap across more than the two phases above.
