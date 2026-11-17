<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Scene wiring via Lens Studio scene GraphQL

Only needed when wiring a Snap Cloud script and its `supabaseProject` input via the MCP scene API (a niche sub-path — most invocations of this skill never touch it).

When attaching a script and wiring its `supabaseProject` input via the MCP scene API, use `addComponent(id: "<the-scene-object-uuid>", type: "ScriptComponent")` — the GraphQL argument is named `id` (**not** `sceneObjectId`; using `sceneObjectId` returns "Unknown argument" error). To set asset/scalar inputs use the `setProperty` mutation (**not** `setComponentProperty` — that field does not exist). To assign a TypeScript asset to a ScriptComponent use `primaryAsset` (**not** `scriptAsset` — `scriptAsset` always returns null); resolve the asset id first via `getFileMeta("Scripts/<Name>.ts")`, then set `propertyName: "primaryAsset"`.

**Important caveats:**

1. `setComponentProperty` does **not** exist — use `setProperty`.
2. `setProperty` with `type: REFERENCE` returns `success: false` for asset references and cannot be used to wire a `SupabaseProject` asset. Instead, assign the script asset via the Editor API: find the ScriptComponent, use `primaryAsset` (not `scriptAsset` — reading `scriptAsset` always returns null). Asset path must be relative to Assets/ (e.g. `"Scripts/MyScript.ts"`, not `"Assets/Scripts/MyScript.ts"`).
