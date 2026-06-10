---
name: scene-construction
description: Load when constructing or modifying a scene in Lens Studio. Teaches the canonical preset-first workflow (read → presets → re-read → apply → save). Indexes the domain skills (cameras, materials, shaders, VFX, physics).
user-invocable: true
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Scene Construction

Orchestrator for scene construction work. Teaches the canonical workflow, guides which tool to reach for, and points at the deep references for exact syntax. Foundational env/API context lives in `lens-studio-field-notes`.

> **If the task is standalone asset CRUD** — rename, move, delete a single asset; edit a material/Matter/WorldSettings property; search the asset library by name or type; enumerate presets — go to `asset-graphql` directly (see `references/asset-graphql.md`). You don't need this orchestrator. The workflow below is for building or modifying *scenes* (objects + components + their asset wiring).

## Tool surfaces

| Surface | Use for | Reference |
|---|---|---|
| **VirtualScene** | Introspection (`read` → `.virtual-scene.json`) and bulk apply (`apply` for reparenting, transforms, wiring component properties with asset refs, batch property writes / deletes). The atomic win is when you create assets *and* wire them into new scene objects in one apply. | `references/virtual-scene.md` |
| **scene-graphql** | **Preset creates** (`createSceneObjectFromPreset`, `createComponentFromPreset`) — batch these in parallel; they spawn pre-wired component hierarchies and return real UUIDs you'll use in the next `apply`. Also for schema introspection (`presets`, `__type`/`__schema`) when needed. Don't guess your way here; you'll be too specific and miss. | `references/scene-graphql.md` |
| **asset-graphql** | **Direct path for standalone asset work** — rename, move, delete, property edits, library search by name/type/path, preset enumeration. Use directly when the task is asset-only. Also valid inside step 2 below when batching asset preset creates alongside scene preset creates. | `references/asset-graphql.md` |
| **Procedural code** | Two uses only: (1) last resort when no other surface can do the job; (2) when you need an algorithm rather than a guess — e.g., computing object positions instead of eyeballing them. | (delegate) |

## Canonical workflow

**Prefer presets when one fits.** Preset-spawned objects come pre-wired with the right components, child hierarchy, and internal bindings (a Camera Object's render target, a Text Object's font asset, etc.) — recreating that by hand in `apply` is tedious and error-prone. Always check `presets(type: SceneObject) { name }` or `presets(type: Component) { name }` before reaching for a manual `create`.

1. **`VirtualScene read`** — snapshot current scene state to `.virtual-scene.json`; grep for existing objects, components, exact property paths.
2. **List presets to get exact `presetName` strings.** Before any create, run `{ presets(type: SceneObject) { name } }` and/or `{ presets(type: Component) { name } }` — `presetName` takes the literal identifier (e.g. `"CameraObjectPreset"`), **not** the display name (`"Camera Object"` will fail). Never guess; the list is cheap. Skip only if you already verified the names earlier this session.
3. **Create via presets, in parallel.** Fire all `createSceneObjectFromPreset` / `createComponentFromPreset` calls in a **single message with parallel tool calls** — they're independent (no ref dependencies between them), so sequential calls are wasted round-trips. **If any preset call fails, surface to the user before proceeding** — orphan objects don't auto-rollback.
4. **`VirtualScene read` again** — pick up the real UUIDs of preset-spawned objects and any children they materialized. Use these IDs in step 5 rather than inventing synthetic refs.
5. **`VirtualScene apply`** — reparent, set transforms, wire component properties with asset references, do bulk modifications and deletes. Execution order inside an apply is `assets` → `create` → `modify` → `delete`; the apply is atomic, so failures don't leave half-wired state.
6. **Save at milestones** — VirtualScene mutations don't persist on their own.

For script `@input` wiring, use the two-phase pattern (create structure, recompile, wire) — see `references/virtual-scene.md` § Script Input Wiring. Two gotchas for **reference-typed** `@inputs`:

- **Component-typed** (e.g. `@input ui: MyUiScript`) — set the ref to the target **component's** UUID (`@id:<componentUuid>` in VirtualScene, or `scene-graphql setProperty REFERENCE`), not its SceneObject's. A SceneObject ref reports success but reads back null at runtime.
- **Array-typed** (e.g. `@input items: Item[]`) — wire via `scene-graphql setProperty` (`value` = array of component UUIDs); VirtualScene rejects these.

See `references/scene-graphql.md` § Script component properties for examples.

## Domain skills

Invoke during planning, not just execution — these document gotchas that cost hours when missed:

| Topic | Skill |
|---|---|
| Cameras, 2D/screen-space rendering, invisible objects | `camera-and-rendering` |
| Materials from presets, color/PBR/texture properties, assignment | `materials` |
| Custom shaders (`.graphShader` YAML, GLSL code nodes) — only when no material preset works | `shader-graph` |
| Custom VFX / particle graphs (`.graphVfx`) | `vfx-graph` |
| Physics bodies, colliders, gravity, bounciness, friction, triggers | `physics` |
| TypeScript Lens scripting that drives the scene at runtime | `lens-api` |

## Spatial awareness

When positioning objects relative to each other: introspect first (read positions and scales from `.virtual-scene.json`), calculate offsets accounting for object radii, never default to `(0,0,0)`. For 2D/UI layout, Screen Transforms use anchors (`-1..1`) + offsets — prefer anchor-based sizing.
