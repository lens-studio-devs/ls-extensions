<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Runtime scale animation on instantiated prefabs (the 100× trap)

The 100× import scale is what makes `aabb_cm` correct at default — but it also lies in wait for any script that **animates a prefab's scale at runtime** (grow tweens, pop-in, shrink-to-pickup, breathing idle, etc.).

**The trap.** When you call `prefab.instantiate(parent)` on any `/build-mesh` GLB, the new SceneObject's transform carries the authored `localScale = vec3(100, 100, 100)`. Naive tween code looks like this and is wrong by 100×:

```typescript
// ❌ WRONG — 0.2 means "0.2 cm of authored scale", not "20% of full size"
// Result: a sub-millimeter speck instead of a sprout.
const cropObj = def.prefab.instantiate(plot.cropAnchorSO)
cropObj.getTransform().setLocalScale(new vec3(0.2, 0.2, 0.2))
// later, in onUpdate:
const s = 0.2 + 0.8 * t   // tween 0.2 → 1.0
cropObj.getTransform().setLocalScale(new vec3(s, s, s))
```

This was the FarmGame.ts crops-invisible bug: planting fired, audio played, the SceneObject existed at the right world position — but at 0.0001 effective scale it rendered as a sub-millimeter speck on top of an 8 cm tile. The build-mesh contract held (GLB normalized to ~6 cm), the bug was downstream.

**Fix — wrap the prefab, scale the wrapper.** This is the recommended pattern. The prefab keeps its authored 100, and the wrapper's `localScale` is a plain 0-to-1 multiplier — readable, future-proof if you add a collider later, no magic constants:

```typescript
// ✅ RIGHT — wrapper scales 0..1, prefab stays at authored 100
const cropWrapper = global.scene.createSceneObject("CropWrapper")
cropWrapper.setParent(plot.cropAnchorSO)
cropWrapper.getTransform().setLocalScale(new vec3(0.2, 0.2, 0.2))  // 20% of full
const cropObj = def.prefab.instantiate(cropWrapper)  // child of wrapper
// later, in onUpdate:
const s = 0.2 + 0.8 * t
cropWrapper.getTransform().setLocalScale(new vec3(s, s, s))
```

**Inline fallback — multiply tween values by 100.** Acceptable only when you've decided not to add a wrapper. Note the explicit `* 100` comment so the next reader doesn't "simplify" it away:

```typescript
// ⚠️ Inline form — every tween value must be × 100 to stay in authored range.
const sproutScale = 0.2 * 100         // 20% of GLB's authored 100
cropObj.getTransform().setLocalScale(new vec3(sproutScale, sproutScale, sproutScale))
// later:
const s = (0.2 + 0.8 * t) * 100       // tween in 20..100, NOT 0.2..1.0
cropObj.getTransform().setLocalScale(new vec3(s, s, s))
```

**Same trap applies to:** any `/build-mesh` output (SPECS, FAST3D, voxel — all GLBs hit the 100× import) instantiated via `ObjectPrefab.instantiate()`. It does NOT apply to runtime-built meshes (e.g. `MeshBuilder` output you assemble in code) — those have whatever local scale you give them. The trap is specifically about prefab instances carrying the GLB's authored 100 on their transform.

**Detection in QA:** if a planted/spawned object visibly disappears, is reported "spawned but invisible," or has world-position correct but `localScale < 1` in `RuntimeSceneTool` output, suspect this bug before suspecting the asset.

---

# Collider & interaction rules (SIK) — specs-experience-builder Hard Rule 6

Canonical copy of the builder agent's Hard Rule 6 — other files cite these as "Hard Rule 6.N". They prevent broken raycasts and invisible objects:

1. **Never set `intangible = true`** on colliders used for SIK interaction. SIK raycasts require `intangible = false` (default). Omit the property.
2. **Never put a collider on a scaled object.** `box.size` is local space and gets multiplied by scale. Use the **wrapper pattern**: collider + Interactable on a unit-scale wrapper; scaled visual is a child of the wrapper. **Position the wrapper at `mesh_position + aabb_center_offset_cm`** so the collider lands on the visual centroid instead of the asset origin — AI-backend output (SPECS / FAST3D) is rarely bottom-centered, and the offset reported by `/build-mesh` is non-zero for those assets.
3. **Never rotate objects with colliders.** SIK hand raycasts expect axis-aligned planes. Apply rotation to a child visual — not the collider wrapper.
4. **Beware rotation inheritance.** Children of rotated parents inherit rotation. Keep interactive wrappers at identity rotation; rotate only leaf visual children.
5. **GLB pose at instantiation — upright AND facing AND complete.** Three checks on every instantiated mesh, using the `/build-mesh` **Pose contract** fields (`upright`, `forward_axis`, `completeness`, `aabb_min_cm`, `grounded`):
   - **Upright.** Lens Studio's import sometimes adds a −90° X rotation on the root instantiated node — for Blender-, SPECS-, and FAST3D-exported GLBs. If `upright` is `unknown`, or a `CapturePanelScreenshotTool` / `GetBoundingBox` check shows the mesh on its back (measured Y ≠ the `aabb_cm` Y), correct it.
   - **Facing — meshes arrive baked to −Z; trust the stamp.** `/build-mesh` bakes each asset to face Lens Studio forward (`-Z`) and stamps it canonical (the report carries `forward_axis: -Z`; confirm with `analyze_glb.js --orient-meta`). So a **static** mesh needs no facing fix — it's already correct. The remaining jobs:
     - **Moving meshes** (a ship flying a path, an enemy charging the player) → rotate **at runtime** to face the travel/target vector with the `faceDirection` helper (`lens-api` → `references/specs-runtime-patterns.md` §10), from the baked `-Z` zero point. For a mover the baked baseline matters **more**, not less — runtime yaw *composes* with it, so an unverified `-Z` stamp becomes a wrong heading every frame. A ship flies belly-first from skipping the helper, and **tail-first from trusting a baseline that was stamped `-Z` without being verified** — if `forward_axis` is not a *verified* `-Z`, treat it as `unknown` (next bullet). Travel along ±X is where a wrong yaw is most visible; ±Z hides it.
     - **Viewer-addressing props** (a sign, a shop counter) → if you want it facing the viewer rather than into the scene, apply a 180° leaf-visual yaw — `leafVisual.getTransform().setLocalRotation(quat.fromEulerAngles(0, Math.PI, 0))`. The exception, not the rule.
     - **Unstamped / `forward_axis: unknown`** (an externally-sourced mesh, or an AI backend — SPECS / FAST3D — when no Blender preview ran this build) → facing is NOT guaranteed. Canonicalize it first (this skill's **Pose contract** canonicalize-on-ingest loop), or confirm via `CaptureRuntimeViewTool { uniqueIds:[id], isolate:true }` and correct on the leaf visual. Never assume.
     - All facing rotation goes on the **leaf visual**, never the collider wrapper (rules 2–4 above).
   - **Complete.** If `/build-mesh` reported `completeness: suspect` or `unverified`, capture the instantiated mesh (`CaptureRuntimeViewTool { uniqueIds:[id], isolate:true }`) and confirm it's the **whole** subject, not a fragment (the "spaceship that's only a cockpit" failure). If it's a fragment, re-invoke `/build-mesh` with whole-object language — do NOT build the camera or gameplay around a partial mesh.
   - Do all three checks proactively on first build.
6. **Respect `animation_available` from `/build-mesh`.** Each mesh report includes `animation_available: true|false`. If `false`, treat the asset as a static prop — do NOT call `playAnimation`, do NOT import or reference its animation clip names, do NOT wire idle/walk triggers. The asset shipped without animation because Blender wasn't reachable; the experience still builds and runs, just without the requested motion.
7. **Hit-zone debugging is a one-toggle flip.** The entry-point script ships with `@input debugColliders: boolean = false` and a `setColliderDebugAll` walker invoked from `onAwake()` after `buildScene()` (see `lens-api` → `references/specs-runtime-patterns.md` §7). When a user reports that "the hit zone is in the wrong place" or "the button doesn't trigger where I'm looking," instruct them to flip this toggle in the Inspector and restart preview — do not modify per-recipe `debugCollider` CONFIG flags or hand-edit individual `collider.debugDrawEnabled` calls.
8. **Scale is not a units-conversion tool — fix size at the asset boundary.** If a mesh comes back from `/build-mesh` at the wrong size (most commonly AI-backend output landing at ~100 cm when you wanted 12 cm), the fix is to **re-invoke `/build-mesh` with `target_size_cm` set** so the GLB is normalized at import — **never** compensate downstream with `transform.setLocalScale(...)`, which leaks the scale factor into `ColliderComponent.shape.size`, body bounds, and every child transform (a `box.size = [12,8,12]` ends up 144 cm in world space). Once normalized, `box.size = aabb_cm` matches world space and rule 2's wrapper math works. If `/build-mesh` returned `size_warning: true` and you didn't re-invoke, you skipped this rule. The full worked anti-pattern (the 144 cm bag) lives in this skill's **Scale convention** section. **Runtime scale animation has the same trap, in reverse** — see *Runtime scale animation on instantiated prefabs (the 100× trap)* at the top of this file.
