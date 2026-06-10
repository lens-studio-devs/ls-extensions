<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Lens Studio — Known Issue Triage

# Visual issues

## Invisible, wrong place, or glitchy

- **Is it enabled?** Check `sceneObject.enabled` and the component's `enabled`. Dumbest possible miss; check first.
- **Render layer mismatch** — SceneObject's layer not in the camera's Render Layer set. Invisible with no error.
- **Outside camera near/far** — object at distance 0 with camera `near=1` is clipped; same past `far`.
- **Facing wrong way** — single-sided mesh; check from cardinal angles. Diagnostic: `mat.mainPass.twoSided = true` — if it appears, fix the geometry (rotate or re-export with correct normals; don't ship with `twoSided` on, it doubles fragment work).
- **Z-fighting** — two surfaces at identical world depth flicker. Move one along the view axis by a large delta first to confirm; then dial back to the smallest offset that still resolves it. For UI: `ls-clad:specs-build-ui` § Z-Ordering / Root Canvas.
- **Bounds check** — print AABB (snippet in § Layout wrong at runtime below):
  - Camera between `aabbMin` / `aabbMax` → rendering from inside the geometry; scene looks empty. Usual cause: runaway `setLocalScale` or inflated parent transform.
  - AABB sub-pixel at camera distance → too small to render. Usual cause: wrong import scale (Blender 100x).

All clear → `ls-clad:camera-and-rendering`.

## Colors / textures look wrong

- **Solid pink/magenta** = missing shader or texture asset, or one of the material's input texture slots is unassigned. Reimport the affected asset; in the Material Inspector confirm every required input (base/normal/roughness/emissive/etc.) points at a real texture, not a deleted or null reference; confirm the shader graph compiles in the Material Editor.
- **Color leaks across objects** = shared material mutated in place. Always clone: `const mat = base.clone(); rmv.clearMaterials(); rmv.addMaterial(mat); mat.mainPass.baseColor = red`.
- **Washed-out / blurry** = mipmap or compression. Check import settings before assuming a shader bug.

Deeper → `lens-api` → `references/materials-shaders.md`.

## Layout wrong at runtime

- **Read the AABB — pick the surface that matches *when* you're asking** (same author-time-vs-runtime split as `materials` § Editor/GraphQL vs Runtime API):

  - **Author/editor time** (scene built, not running — or you'd rather not add a script): the `GetBoundingBox` MCP tool. Returns world-space bounds for the current editor selection, already accounting for `localScale`. No code, no preview run. **Only sees objects that exist in the Lens Studio scene** — it cannot measure objects created at runtime (`scene.createSceneObject`, instantiated prefabs); for those, use the runtime surface below.
  - **Runtime** (preview running): read it from a Lens script via the runtime Lens API (snippet below), or query it non-invasively with `QueryRuntimeSceneTool { sceneObject(uniqueId: "X") { bounds { min max center extents } } }` (see `preview-inspection`).

  ```typescript
  // worldAabbMin/Max() are engine-computed world-space bounds (rotation + scale
  // + parent transform); prefer them over manual mesh.aabb* math, which drops rotation.
  const rmv = obj.getComponent('Component.RenderMeshVisual') as RenderMeshVisual
  if (rmv) {
    console.log(obj.name + ' AABB: ' + rmv.worldAabbMin() + ' → ' + rmv.worldAabbMax())
  }
  ```

- **Cross-check parent transform** — if bounds look right but placement is off, walk up the hierarchy logging each ancestor's world pos/scale.
- **Query the scene non-invasively** — `scene-graphql` reads transforms without modifying state; syntax lives in `scene-construction` → `references/scene-graphql.md`.

Deeper coordinate / projection math → `lens-api` → `references/math.md`.

---

# Runtime behavior

## Content stays glued to the camera

- **Check the parent** — if the object is a child of the Camera, it inherits the Camera's transform and follows the head regardless of tracking mode. Re-parent out from under the Camera. *Most common cause.*
- **Add `DeviceTracking` to the root Camera** — without it, every transform is camera-relative.
- **Pick the mode:**
  - `Surface` — content sticks to a physical surface (table, floor). Phone Lenses.
  - `World` — user walks around content. Required for Specs, SIK, spatial anchors.
  - `Rotation` — rotates with device, no translation.

Specs requires `World` mode → `ls-clad:specs-project-init`.

## Handler never fires

- **Hierarchy order, top to bottom** — Component A above B runs `onAwake` first. If A reads state B sets up in *its* `onAwake`, A sees nothing.
- **`OnStartEvent` already fired** — components added/enabled after the scene started can't subscribe to start; it doesn't replay. Same for binding from a `DelayedCallbackEvent` that fires after start.
- **Cross-object access from `onAwake`** — unsafe; the other object's `onAwake` may not have run. Move cross-object work to `onStart`.

Deeper + handler-leak cleanup → `lens-api` → `references/debugging.md` (Event subscription timing).

## Asset or dynamic object not ready

- **Async asset null on first access** — log the reference itself (`console.log('track: ' + this.audioTrack)`). If null, asset isn't loaded yet, not your call site.
- **Lifecycle subtleties for prefab instantiation and `createComponent`** — see `lens-api` → `references/debugging.md` § Event subscription timing for full diagnosis and fix patterns.
- **Preview reload state** — preview re-runs share asset cache but reset script state. Cold-Lens-Studio-restart bugs may not repro on plain preview re-run.
- **`OnStartEvent` ≠ `TurnOnEvent`/`TurnOffEvent`** — first is per scene load; second is the Lens engine activating/deactivating the whole Lens. Don't substitute.

If a *dependent* object's `onAwake` runs after yours, see "Handler never fires" above.

## Physics object isn't where you put it

- **Add containment** — static colliders for floors / walls / surfaces to rest or bounce on. Without them, gravity pulls forever (hundreds of units below the scene within a second).
- **Initial overlap** — a dynamic body placed inside another collider on frame 1 ejects at high speed. Place clear before enabling.
- **Velocity / mass** — tiny mass + scripted impulse = teleport. Log `physicsBody.velocity` once per second to distinguish "vanished" from "moving too fast to perceive."

Deeper → `ls-clad:physics`.
