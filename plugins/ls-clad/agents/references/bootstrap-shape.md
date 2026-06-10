<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Phase 3a — canonical bootstrap shape (specs-experience-builder)

On-demand detail for Phase 3a's two-phase VirtualScene bootstrap. The agent body keeps the ImageMaterial-detection grep, the strict-allowlist rules, and the recovery logic inline; the full canonical JSONC (Phase A assets+create, the inter-phase recompile, Phase B input-wiring, multi-panel handling, and the `ExecuteEditorCode` fallback) is here. Read this at Phase 3a write time.

---

#### Canonical shape (two-phase apply, with ImageMaterial)

**Phase A — assets + create (no `uiHud` wiring):**

```jsonc
VirtualScene { command: "apply", instructions: {
  "assets": [
    { "id": "$temp:imgMat", "preset": "ImageMaterialPreset",
      "name": "ImageMaterial", "destinationPath": "Materials" }
  ],
  "create": [
    { "id": "$temp:uiRoot", "name": "<ExperienceName>UI",
      "transform": { "position": { "x": 0, "y": 0, "z": -110 } },
      "components": [
        { "type": "ScriptComponent",
          "properties": { "scriptAsset": "@asset:Scripts/<ExperienceName>UI.ts" } }
      ]
    },
    { "id": "$temp:root", "name": "<ExperienceName>",
      "components": [
        { "type": "ScriptComponent",
          "properties": { "scriptAsset": "@asset:Scripts/<ExperienceName>.ts" } }
      ]
    }
  ]
}}
```

Note: components have only `type` and `properties`. No `id`. No `uiHud`. The Phase A apply just lands the structure.

**Between Phase A and Phase B:** call `RecompileTypeScriptTool` so the `@input` slots register against the live ScriptComponents. If recompile fails, fix the script and retry — do NOT proceed to Phase B with a failed compile (the `uiHud` write will fail with `Script input 'uiHud' not found on ScriptComponent — recompile…`).

**Phase B — modify to wire `uiHud` (and any other `@input` fields):**

```jsonc
VirtualScene { command: "apply", instructions: {
  "modify": {
    "@sceneObject:<ExperienceName>": {
      "components.ScriptComponent.uiHud": "@sceneObject:<ExperienceName>UI"
    }
  }
}}
```

`@input uiHud!: <ExperienceName>UI` typed as the UI class resolves at runtime via Lens Studio's [@input + class-type pattern](https://developers.snap.com/lens-studio/features/scripting/accessing-components#accessing-typescript-from-typescript) — wiring the value to the UI SceneObject is enough; the runtime walks the SceneObject's ScriptComponents and binds the one whose `scriptAsset` matches the declared class.

If the grep returned zero hits, drop the `"assets"` block from Phase A. If the manifest has multiple UI panels, add one create entry per panel in Phase A and one `components.ScriptComponent.<inputName>` line per panel in Phase B (`uiHud`, `uiDock`, `uiSettings`, etc.) — all batched into the single Phase B modify call.

**Fallback** (only if VirtualScene is genuinely unavailable): one `ExecuteEditorCode` per phase, doing the same steps. Never split bootstrap across more than the two phases above.
