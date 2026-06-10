---
name: preview-inspection
description: Use when inspecting the live Lens Studio preview — querying scene state, discovering objects by component or property, reading transforms / bounds / component values, exploring the scene hierarchy, or capturing orthographic renders. Universal across Specs and Snapchat Lenses. For driving the preview with hand actions (Pinch / Hover / Drag / etc.), use the specs-preview-interaction skill instead.
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Preview Inspection

Inspect the Lens Studio preview via `QueryRuntimeSceneTool` and `CaptureRuntimeViewTool` — see Tools below.

**Scope:** Both tools work on any Lens Studio preview — Specs or Snapchat Lenses. No SIK dependency. The companion `specs-preview-interaction` skill covers driving the scene with hand actions and is Specs-only.

**Lens-side setup:** The Lens must include the `AiPreviewAgentInspect.lspkg` package with the `AgentInspectScript` component on a SceneObject. Without it, queries time out with `NO_PREVIEW`.

**Verification surfaces:**

- **Editor-time / authored** (this `.esproj` is configured correctly): `@input` bindings, `scriptAsset` UUIDs, `requireAsset` paths, asset library entries, authored components and transforms. Verified via `scene-graphql` / `asset-graphql` / Editor API (`ExecuteEditorCode`).
- **Live runtime** (the Lens actually does the right thing when it runs): resolved JS object references, runtime-spawned components (e.g. UIKit `Interactable`, runtime audio children, material clones), current property values, post-interaction state. Verified via **this skill** + `RunAndCollectLogsTool` + `CaptureRuntimeViewTool`.

This skill covers the runtime side only. Editor-side fields are **not** queryable through `QueryRuntimeSceneTool` — the runtime consumes them at instantiation and no longer carries them as data. An empty runtime response for an editor-side field means the runtime doesn't track it, not that the feature is missing. If you need to verify both sides, use both tool families in sequence.

## Tools

Both tools work against the live preview. They accept optional `previewName` (routes to a specific preview panel — see [Preview routing](#preview-routing)) and `timeoutMs` (defaults to 5000).

| Tool | Purpose |
|------|---------|
| `QueryRuntimeSceneTool` | Unified GraphQL endpoint. Roots: `sceneObjects(filter, limit, sortBy)` for filtered walks, `sceneObject(uniqueId)` for single-object deep reads, `sceneRoots` for top-level walks, `capabilities` for live introspection. Composable AND-filters, projection-driven payloads, single round-trip per query. |
| `CaptureRuntimeViewTool` | Orthographic render of the runtime scene. **Object mode** when `uniqueIds` are passed (auto-frames the bounding box, `isolate` hides everything else). **Scene mode** otherwise (looks at `center`, ortho size from `distance`). |

`QueryRuntimeSceneTool` projection shortcuts to know about:

- **`summary`** — single JSON blob with all 7 cheap fields (`{name, uniqueId, enabled, parentName, parentUniqueId, childCount, componentTypes}`). Use instead of typing each.
- **`descendantsTree(maxDepth, enabledOnly)`** — nested JSON tree of summaries (server cap depth 5). Replaces nested `children { children { ... } }` boilerplate. `enabledOnly: true` prunes disabled subtrees.
- **`capabilities { digest }`** — one-shot JSON dump of every queryable field. The "what can I ask?" escape hatch.
- **Vec3 / Quat are JSON scalars at the leaves.** Write `transform { worldPosition }` and get `{x,y,z}`. Never write `worldPosition { x y z }` (no subselection on JSON scalars). Same for `bounds { min max center extents }`.

## Quick Reference

All scene queries go through `QueryRuntimeSceneTool` with a GraphQL string. Pass enum values without quotes; project only the fields you need.

| Step | Query | Key Argument |
|------|-------|---------------|
| Orient (top-level) | `{ sceneRoots { summary descendantsTree(maxDepth: 2) } }` | — |
| Drill into subtree | `{ sceneObject(uniqueId: "X") { summary descendantsTree(maxDepth: 3, enabledOnly: true) } }` | `uniqueId`, `maxDepth`, `enabledOnly` |
| Spatial query | `{ sceneObjects(filter: {nearPoint: {point: {x,y,z}, radius: N}}, sortBy: DISTANCE) { matches { summary distance } } }` | `nearPoint`, `radius` |
| Discover interactables | `{ sceneObjects(filter: {hasComponents: ["Interactable"], enabledOnly: true}) { matches { summary } } }` | `hasComponents`, `enabledOnly` |
| Find by type | `{ sceneObjects(filter: {hasComponents: ["Text"]}) { matches { summary } } }` | `hasComponents` |
| Find by name | `{ sceneObjects(filter: {nameContains: "Launch"}) { matches { summary } } }` | `nameContains` (case-insensitive) |
| AND multiple components | `{ sceneObjects(filter: {hasComponents: ["Interactable", "PinchButton"]}) { matches { summary } } }` | `hasComponents` (array is AND) |
| Find by value | `{ sceneObjects(filter: {property: {componentType: "Text", propertyName: "text", operator: CONTAINS, value: "hi"}}) { matches { summary matchedProperty { value } } } }` | `property` |
| Subtree-scoped find | `{ sceneObjects(filter: {descendantOf: "<rootUid>", hasComponents: ["Text"]}) { matches { summary } } }` | `descendantOf` |
| Negative existence | `{ sceneObjects(filter: {nameContains: "X"}) { matches { summary } totalScanned } }` — assert `matches` is empty | `nameContains`, `totalScanned` |
| Read state | `{ sceneObject(uniqueId: "X") { summary transform { worldPosition worldScale } components(filter: ["Text"]) { type properties } } }` | `uniqueId`, projection |
| Get bounds | `{ sceneObject(uniqueId: "X") { bounds { min max center extents } } }` | `uniqueId` |
| Self-introspect | `{ capabilities { digest } }` | — |
| Scene view | `CaptureRuntimeViewTool(center: {x,y,z}, distance: N)` | `center`, `distance`, `viewAngle`, `detail` |
| Object view | `CaptureRuntimeViewTool(uniqueIds: ["..."])` | `uniqueIds`, `viewAngle`, `isolate`, `distance`, `detail` |

## Scene Understanding

Build a mental model of the scene by composing GraphQL queries through `QueryRuntimeSceneTool`. Cheap fields (`summary`) are always free; lazy fields (`transform`, `bounds`, `components`, `parent`, `children`) require explicit selection. See the Quick Reference table above for all query patterns.

### Synthetic component types — the SIK pattern

Many SIK behaviors aren't built-in component types — they're ScriptComponents whose script asset is named after the behavior (`Interactable`, `PinchButton`, `InteractableManipulation`, `ButtonFeedback`). `componentTypes` and `presentComponents` surface those script-asset names alongside real types, and `hasComponents` matches them:

- `{ sceneObjects(filter: {hasComponents: ["PinchButton"]}) { matches { summary } } }` — finds every PinchButton in the scene
- `{ sceneObjects(filter: {hasComponents: ["Interactable", "ToggleButton"]}) { matches { summary } } }` — AND-combine literal types with synthetics

**Caveat:** synthetic names work in `hasComponents` but **not** in `property` filter (which requires a registered reader). To filter ScriptComponents by their script-asset name, use the registered `ScriptComponent` reader: `property: { componentType: "ScriptComponent", propertyName: "scriptAsset", operator: EQUALS, value: "PinchButton" }`. The predicate iterates all ScriptComponents on each object, so it correctly finds PinchButtons regardless of script attachment order.

### Multi-component reads

A SIK Interactable typically has 2-5 ScriptComponents on the same SceneObject (`Interactable` + `PinchButton` + `InteractableAudioFeedback` + `ButtonFeedback`). `components { type properties }` returns **all** of them, distinguished by `properties.scriptAsset`. Don't assume one entry per type.

### Property operators

`property` filter accepts five operators (passed as enum values, no quotes):

| Operator | Applies to | Behavior |
|----------|------------|----------|
| `EQUALS` | any | Strict equality. |
| `CONTAINS` | strings | Case-insensitive substring match. String values only. |
| `GT` | numbers | Greater-than. Numeric values only. |
| `LT` | numbers | Less-than. Numeric values only. |
| `EXISTS` | any | The property is present. `value` is not required. |

**Type-mismatch behavior:** when an operator is used against a property of an incompatible type (e.g. `GT` against a string, `CONTAINS` against a number), the predicate **silently returns `false` for that object** rather than throwing — so the match list is empty and `filterBreakdown.afterProperty` is 0. This is by design (lets you compose filters across mixed-type readers without errors) but means an empty result doesn't necessarily indicate "no matches" — it can also mean "operator/type mismatch." If you suspect a type mismatch, use `EXISTS` first to confirm the property is present, then check its actual type via a `components { properties }` projection.

### Empty-result debugging — `filterBreakdown`

If `sceneObjects(...) { matches }` returns `[]`, project `totalScanned` and `filterBreakdown` to learn which filter culled the results:

```graphql
{ sceneObjects(filter: {...}) {
    matches { summary }
    totalScanned
    filterBreakdown { afterEnabledOnly afterNameContains afterComponent afterNearPoint afterProperty }
} }
```

Each breakdown field is `null` when the filter wasn't applied; otherwise the count of objects surviving up to that stage in cheap-first order. Reads as a funnel.

### Errors — `errors[].extensions.code`

GraphQL errors carry a stable `extensions.code` for branching:

| Code | Meaning | Recovery |
|------|---------|----------|
| `UNKNOWN_COMPONENT` | property filter targets an unregistered reader | `extensions.registered` lists valid names |
| `UNKNOWN_PROPERTY` | reader exists but propertyName is unknown | `extensions.availableProperties` lists what the reader exposes |
| `NOT_FOUND` | `descendantOf` uniqueId not in scene | re-query for a fresh uniqueId |
| `INVALID_FILTER` | `sceneObjects` called without any predicate | use `sceneRoots` for unfiltered top-level walks |
| `INVALID_PARAMS` | bad `limit`, or `sortBy: DISTANCE` without `nearPoint` | follow the message |
| `TIMEOUT` / `NO_PREVIEW` | bridge problem | retry, ensure preview is open and AgentInspectScript is wired |
| `INTERNAL_ERROR` | unexpected lens-side exception | report; not retryable |

## Capture

`CaptureRuntimeViewTool` renders the runtime scene as an orthographic image. It has two modes selected by whether you pass `uniqueIds`:

| Mode | When | What you control |
|---|---|---|
| **Object mode** | `uniqueIds: ["..."]` is non-empty | Camera auto-frames the combined bounding box. `viewAngle` is *object-relative* for a single uniqueId (so `front` means the front of that object); world-aligned for multi-id framing. `isolate: true` hides every other scene object so nothing occludes the targets. `distance` adds extra padding around the box (cm). |
| **Scene mode** | `uniqueIds` omitted | Camera looks at `center` (defaults to origin) inside a cube of half-size `distance / 2` (default 100 → ±50 extent). `isolate` is ignored — there's no object set to isolate against. `viewAngle` is world-aligned. |

Common to both modes:
- `viewAngle`: `isometric` (default) | `top` | `front` | `back` | `left` | `right`
- `detail`: `low` (256×192, quick checks) | `medium` (512×384, default) | `high` (1024×768, fine details / text)
- `previewName`: route to a specific preview panel by its label (e.g. `"Preview 1"`, `"Player 1"`, `"Wearable Experience"`)
- `timeoutMs`: bridge timeout, default 5000

### Picking the mode

- **Known specific object(s)** → pass `uniqueIds`. Let the framing do the math. Add `isolate: true` if something is in the way. Use a single-element array for one object; the camera will use that object's rotation so `viewAngle: "front"` is its actual front face.
- **Empty region, arbitrary vantage, or scene-wide overview** → omit `uniqueIds` and pass `center` (or omit it for origin).
- Read an object's `transform { worldPosition }` via `QueryRuntimeSceneTool` if you need a precise `center` for scene mode.
- Prefer `CaptureRuntimeViewTool` over `CapturePanelScreenshotTool` for Lens verification — it renders from any angle and can isolate targets.

## Preview routing

Both tools accept an optional `previewName` parameter to route commands to a specific preview panel. Use it whenever multiple preview panels are open — multiplayer scenes, side-by-side comparison of different Lenses, wearable-vs-camera testing, etc.

**How it works:**
- The first use of a name lazily assigns it to the next available preview panel by `panel.title` (`"Preview 1"`, `"Preview 2"`, ...). Any string works (`"Player 1"`, `"Solo Mode"`, `"Wearable Experience"`).
- Subsequent calls with the same name route to the same panel.
- Omitting `previewName` broadcasts to all previews (single-preview default).

**Multiplayer / multi-preview workflow:**
1. Open multiple preview panels in Lens Studio (e.g. Preview 1 and Preview 2)
2. Query each preview's interactables separately: `QueryRuntimeSceneTool` with `previewName: "Player 1"` and `query: "{ sceneObjects(filter: {hasComponents: [\"Interactable\"]}) { matches { summary } } }"`
3. Parallel queries across different previews are safe and encouraged.

**Key behaviors:**
- UIDs are scene-level, so multiple previews of the same scene report the same UIDs — expected.
- Screenshots with `captureScreenshot: true` automatically capture **all** assigned previews and return them in a `screenshots` map keyed by previewName.
- If a previewName is used but no unassigned preview panel is available, the tool throws an error asking you to open another preview panel.

## Rules

1. **Always discover first.** UIDs change across preview resets. Never cache or guess UIDs. Start with `{ sceneRoots { summary descendantsTree(maxDepth: 2) } }` for a shallow view, then drill into subtrees via `sceneObject(uniqueId)` or filter via `sceneObjects(filter: {hasComponents: ["Interactable"]})`.
2. **Use `parentName` to disambiguate.** Multiple objects share the same name in scenes with repeated UI templates — `parentName` tells you which is which. The `summary` projection includes it for free.
3. **Read world position before spatial actions.** `{ sceneObject(uniqueId) { transform { worldPosition } } }` — don't guess coordinates.
4. **Verify visually with `CaptureRuntimeViewTool`** — see Capture above for mode selection and detail levels.
5. **Parallelize independent queries.** Multiple queries with no dependencies can run in parallel. Cross-preview parallelism is safe.
6. **Always pass `previewName` when multiple preview panels are open.** Without it, overview queries may hit different preview panels, causing UID lookup failures.

## Common Mistakes

- **Reusing UIDs after preview reset** — see Rules #1 above.
- **Calling `sceneObjects` without a filter** (`INVALID_FILTER`) — use `sceneRoots` for unfiltered walks.
- **Writing `worldPosition { x y z }` or `min { x y z }` etc.** — Vec3 leaves are JSON scalars, no subselection (see Tools above).
- **`property: { componentType: "PinchButton", ... }`** — see Synthetic component types above.
- **Assuming `components { type properties }` returns one entry per type** — see Multi-component reads above.
- **Using `GetRuntimeObjectsByComponent`, `InspectRuntimeObject`, `GetRuntimeSceneOverview`, etc.** Those tools no longer exist. Use `QueryRuntimeSceneTool` for all scene queries.
