---
name: lens-api
description: Lens Studio TypeScript scripting — component lifecycle, decorators, touch input, screen-to-world conversion, runtime object creation, material cloning, scene queries, and timers. Use when writing any Lens Studio TypeScript script, handling tap/touch events, converting screen to world coordinates, creating objects at runtime, modifying material colors, or debugging null-reference errors in Lens scripts.
user-invocable: true
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

> **LENS RUNTIME ONLY** — This skill covers the **Lens API** (StudioLib),
> which runs inside the AR experience. It is a completely different runtime
> from the **Editor API** (`editor.d.ts` / `pluginSystem`). Never mix them.

| Aspect | Lens API (this skill) | Editor API (`editor-api`) |
|---|---|---|
| Types file | `Support/StudioLib.d.ts` (public LS) or `Support/StudioLib_Internal.d.ts` (internal LS) | `Support/editor.d.ts` |
| Get position | `obj.getTransform().getLocalPosition()` | `obj.localTransform.position` |
| Set position | `obj.getTransform().setLocalPosition(new vec3(...))` | `obj.localTransform.position = new vec3(...)` |
| Get component | `obj.getComponent('Component.RenderMeshVisual')` | `obj.getComponent('RenderMeshVisual')` |
| Rotation | `quat` (radians) | `vec3` Euler in **degrees** |
| Create object | `global.scene.createSceneObject('name')` | `scene.createSceneObject(name)` or `objectOwner.addSceneObject(parent)` |

Mixing the two APIs produces code that compiles but silently fails at runtime — property names look similar but resolve to different things. For example, `obj.localTransform.position` (Editor API) and `obj.getTransform().getLocalPosition()` (Lens API) both access position, but using the wrong one in the wrong runtime returns undefined or throws.

This skill and its `references/` files are the primary source for the Lens runtime API. For specific type signatures not covered here, check the Lens API types file in the project's `Support/` directory — its filename depends on the LS edition: `StudioLib.d.ts` in public Lens Studio, `StudioLib_Internal.d.ts` in internal Lens Studio (some internal projects ship both). Discover it with `Glob pattern="**/Support/StudioLib*.d.ts"` rather than hardcoding either name. Read the matching reference file first (see table at bottom).

---

# Lens Studio Scripting — Reference Guide

---

## Correctness must-haves for the main game script

When writing the main `@component` + helper modules, these matter more than
anything else below. Get all six right.

1. **Write the MAIN `@component` script FIRST, helpers second — with the Write
   tool.** The main orchestrator is the dominant deliverable; helper modules
   alone do not complete the task. Create each file on disk with the Write tool
   (text in your reply creates nothing) and verify it exists before finishing.
2. **Use ONLY APIs that appear in this reference or in existing project code.**
   Never invent methods or classes — there is no `Material.create()`, no
   `sceneObject.createSceneObject(...)`, no `getComponent("Interactable")`
   string lookup with invented events. If you did not see the API in this guide
   or in a script already in the project, do it the way this guide shows instead.
3. **Import and type the UI class, drive it only through its public API.**
   `import { <Name>UI } from "./<Name>UI"` and `@input uiHud!: <Name>UI`; call
   its public methods (`setScore(...)`) and subscribe to its `Event`s
   (`this.uiHud.onX.add(...)`). Never rebuild or edit UI inside the main script —
   no `Component.Text`, no `UIKit` imports here.
4. **Assets: `requireAsset` for anything the script loads itself; `@input
   @allowUndefined <name>Audio!: AudioComponent` for audio.** Loop the
   background music in your start handler: `if (this.bgMusicAudio)
   this.bgMusicAudio.play(-1)`. Play SFX with `audio.play(1)`.
5. **Lifecycle via events, all bound in `onAwake`:**
   `this.createEvent("OnStartEvent").bind(() => this.onStart())`,
   `this.createEvent("UpdateEvent").bind(() => this.onUpdate())`, and timers via
   `this.createEvent("DelayedCallbackEvent")` + `.reset(seconds)`.
6. **Wire every event/callback you declare, and populate every collection you
   iterate.** A declared-but-unwired handler or an array that is read but never
   filled is a defect, not a placeholder.

## Cookbook — read it first

Before writing the main script, **read `references/main-script-cookbook.md`**:
it has the TypeScript discipline rules, the verified API card (and the list of
APIs that do NOT exist), copy-paste recipes for the standard game mechanics
(per-frame motion, prefab spawning, pinch/tap via IK, proximity scoring,
timers, audio), and one complete worked example. **Compose your game from
those recipes — never invent an API.**

---

## Component Anatomy

```typescript
import { IK } from 'InteractionKit.lspkg/IK' // IK = InteractionKit (not inverse kinematics)

@component
export class MyComponent extends BaseScriptComponent {
  // --- Inspector-exposed inputs ---
  @input
  @hint('Drag a scene object here')
  targetObject: SceneObject

  @input
  speed: number = 1.0

  @input
  @allowUndefined         // makes the field optional in the inspector
  optionalAudio: AudioComponent

  @input
  @label('Display Name') // rename the field label in the inspector
  internalProp: number = 0

  // --- Private state ---
  private elapsedTime: number = 0

  // --- Lifecycle ---
  onAwake(): void {
    // Called once at construction time. Set up events here.
    this.createEvent('OnStartEvent').bind(() => this.onStart())
    this.createEvent('UpdateEvent').bind(() => this.onUpdate())
  }

  private onStart(): void {
    // Called once the scene is fully loaded.
    // Reference other components here rather than in onAwake.
    if (!this.targetObject) {
      console.log('[MyComponent] ERROR: targetObject not assigned')
      return
    }
  }

  private onUpdate(): void {
    // Called every frame.
    this.elapsedTime += getDeltaTime()
  }

  onDestroy(): void {
    // Called when the scene object this component belongs to is destroyed.
    // Use to unsubscribe events, clean up sessions, etc.
  }
}
```

### Lifecycle order reference

| Event name | When it fires | Typical use |
|---|---|---|
| `onAwake` | Component constructs | Wire up event listeners |
| `OnStartEvent` | Scene finishes loading | Access other components |
| `UpdateEvent` | Every rendered frame | Per-frame logic |
| `DelayedCallbackEvent` | After N seconds | Timers, deferred actions |
| `OnEnableEvent` | Component or object becomes enabled | React to visibility on |
| `OnDisableEvent` | Component or object becomes disabled | React to visibility off |
| `TurnOnEvent` | Lens turns on (**deprecated** — use `OnStartEvent`) | Legacy lens-on handler |
| `TurnOffEvent` | Lens turns off | Legacy lens-off handler |
| `onDestroy` | Scene object is destroyed | Clean up resources |

---

## Decorator Reference

| Decorator | Effect |
|---|---|
| `@component` | Registers the class as a Lens Studio component |
| `@input` | Exposes the property in the Lens Studio Inspector |
| `@hint('text')` | Adds a tooltip to the inspector field |
| `@allowUndefined` | Prevents validation errors for optional inputs |
| `@label('Display Name')` | Renames the field label shown in the inspector |

**Decorator arguments must be single string literals.** `@hint(...)` /
`@label(...)` take exactly one literal string — no concatenation, no template
literals. The TypeScript compiler accepts them, but Lens Studio's component
compiler rejects them at import time.

**A required `@input`'s runtime value is the serialized scene value, not your TS
field initializer.** `@input width: number = 40` sets the Inspector default at
author time only; once the component is on a SceneObject, an input never set in
the Inspector reads `0` / `""` / `null` at runtime — not your `= 40`. This fails
silently: a panel sized from an unset input builds `width × height = 0 × 0` and
renders nothing, with a clean type-check and no error. Set the value at the point
the component is configured — type it into the input in the Inspector (which
serializes it into the scene), or assign it in the code that creates the
component — not via the class-field default.

### Input arrays

To expose a list of assets or objects in the inspector:

```typescript
@input
myObjects: SceneObject[]  // shown as a resizable list in the inspector

@input
audioTracks: AudioTrackAsset[]
```

---

## Accessing Other Components

For cross-component access patterns — `getComponent` on the same/child object, the TS-to-TS `@input` typed as the class (preferred, no cast), the `getComponent(X.getTypeName()) as X` lookup, TS-to-JS, and `require('LensStudio:...')` for built-in modules — see `references/component-access-patterns.md`.

---

## Scene Object Queries

```typescript
// Preferred: expose the object via @input and assign in the Inspector
// (no runtime name search needed)
@input
targetObject: SceneObject

// Manual recursive name search — there is no built-in findByName or findChild
function findByName(parent: SceneObject, name: string): SceneObject | null {
  if (parent.name === name) return parent
  const count = parent.getChildrenCount()
  for (let i = 0; i < count; i++) {
    const found = findByName(parent.getChild(i), name)
    if (found) return found
  }
  return null
}

// Search across all root objects
function findInScene(name: string): SceneObject | null {
  const rootCount = global.scene.getRootObjectsCount()
  for (let i = 0; i < rootCount; i++) {
    const found = findByName(global.scene.getRootObject(i), name)
    if (found) return found
  }
  return null
}

// Iterate all root objects
const rootCount = global.scene.getRootObjectsCount()
for (let i = 0; i < rootCount; i++) {
  const root = global.scene.getRootObject(i)
}

// Iterate children
const count = parent.getChildrenCount()
for (let i = 0; i < count; i++) {
  const child = parent.getChild(i)
}

// Create a new empty scene object
const newObj = global.scene.createSceneObject('NewObject')
newObj.setParent(this.sceneObject)
```

---

## Prefab Instantiation

- Synchronous: `const instance = this.prefab.instantiate(parent)` (`null` = root), then set `instance.name` / `instance.getTransform().setWorldPosition(...)`.
- Async (non-blocking, large prefabs): `instantiateAsync` **returns void — use the callback argument, NOT `.then()`**: `this.prefab.instantiateAsync(parent, (instance) => {...}, (err) => {...}, (_p) => {})`.
- Tear down with `instance.destroy()`.

For circle/line/grid/sphere spawn layouts, pooling, and delayed destruction, see `references/instantiation-patterns.md`.

---

## DelayedCallbackEvent (Timers)

```typescript
// One-shot delay
const delayedEvent = this.createEvent('DelayedCallbackEvent')
delayedEvent.bind(() => {
  console.log('2 seconds elapsed')
  doSomething()
})
delayedEvent.reset(2) // seconds

// Repeating timer: call reset() again at the end of the callback
delayedEvent.bind(() => {
  tick()
  delayedEvent.reset(1) // re-fire after 1 second
})
delayedEvent.reset(1)

// Cancel a scheduled event
delayedEvent.enabled = false
```

---

## Logging

Lens Studio exposes the standard `console` namespace (`declare namespace console` in the d.ts) with `.log`, `.info`, `.warn`, `.error`, `.debug`, and `.trace`. Use these for new code:

```typescript
console.log('Simple message: ' + value)
console.info(`Template literal: ${object.name}`)
console.warn('Recoverable issue: ' + reason)
console.error('Fatal issue: ' + err)
```

The legacy `print(message)` global still exists but carries no severity level — prefer `console.*` so the log can be filtered by level.

---

## Enabling / Disabling Scene Objects and Components

```typescript
// Show / hide a whole object and all its children
sceneObject.enabled = false

// Disable only a component without hiding the object
meshVisual.enabled = false

// Toggle
sceneObject.enabled = !sceneObject.enabled
```

`OnEnableEvent` fires when a component (or its scene object) becomes enabled; `OnDisableEvent` fires when it becomes disabled. Both fire on the component, not on children. Note: `TurnOnEvent`/`TurnOffEvent` are **Lens** lifecycle events (Lens turns on/off), not object enable/disable events — do not confuse them.

---

## Touch Input

### TapEvent (simplest — phone Lenses)

```typescript
this.createEvent('TapEvent').bind((eventData) => {
  // getTapPosition() returns NORMALIZED [0-1] coordinates, NOT pixels
  // (0,0) = top-left, (1,1) = bottom-right
  const tapPos: vec2 = eventData.getTapPosition()
  console.log('Tapped at: ' + tapPos.x + ', ' + tapPos.y)
})
```

### Screen-to-world conversion

Convert a normalized screen position to a 3D world point:

```typescript
// Screen [0-1] → World position (depth = distance from camera's near plane)
const worldPos: vec3 = camera.screenSpaceToWorldSpace(tapPos, depth)

// World → Screen [0-1]
const screenPos: vec2 = camera.worldSpaceToScreenSpace(worldPoint)
```

`getTapPosition()` and `screenSpaceToWorldSpace()` use the **same normalized coordinate system** — pass one directly to the other with no conversion needed. This handles rotated cameras, orthographic projection, and aspect ratio automatically. Do not write manual projection math.

The `depth` parameter is the distance from the camera's **near clipping plane** (not the camera itself) along the view direction. In practice: if your camera is at height 100 with `near = 1`, and your target surface is at y=0, use `depth = 99` (camera height minus near distance). For orthographic cameras, the exact depth matters less since there's no perspective distortion — any depth that lands on the target plane works.

For more complex touch handling, use `TouchStartEvent`, `TouchMoveEvent`, and `TouchEndEvent` — these give per-finger tracking for drag, multi-touch, and gesture interactions. See `references/2d-ui.md` for patterns.

---

## Runtime Object Creation

### Create a visible 3D object from scratch

```typescript
// In a @component class with these inputs:
// @input templateMesh: RenderMesh
// @input baseMaterial: Material

// 1. Create the scene object (global.scene is ScriptScene, not SceneObject)
const obj = global.scene.createSceneObject('MyObject')
obj.setParent(this.sceneObject) // optional — defaults to root

// 2. Add a RenderMeshVisual and assign a mesh
const rmv = obj.createComponent('Component.RenderMeshVisual') as RenderMeshVisual
rmv.mesh = this.templateMesh

// 3. Clone the material before modifying — see references/materials-shaders.md
//    (materials are shared assets; modifying one in place recolors every object using it)

// 4. Position the object
obj.getTransform().setLocalPosition(new vec3(10, 0, -5))
obj.getTransform().setLocalScale(new vec3(2, 2, 2))
```

For the clone → `clearMaterials` → `addMaterial` workflow, `mainMaterial`/`mainPass` access shortcuts, and why cloning is mandatory, see `references/materials-shaders.md`.

---

## Cross-Script Communication

Lens Studio does not have a global event bus. Use callback arrays or direct `@input` wiring:

```typescript
type OnScoreUpdate = (score: number) => void

@component
export class ScoreManager extends BaseScriptComponent {
  private listeners: OnScoreUpdate[] = []

  addScoreListener(fn: OnScoreUpdate): void {
    this.listeners.push(fn)
  }

  updateScore(score: number): void {
    this.listeners.forEach(fn => fn(score))
  }
}
```

> `createEvent()` only accepts built-in event type strings (e.g. `'UpdateEvent'`, `'TapEvent'`, `'OnEnableEvent'`). It cannot create custom-named events.

---

## Common Gotchas

- **`getComponent` in `onAwake`**: calling `getComponent` on the *same* SceneObject works in `onAwake`, but accessing *other* objects or `@input` references that may not be initialized yet is unsafe. Use `OnStartEvent` for cross-object lookups.
- **Look up a peer TS script by its class type, not the base `ScriptComponent`.** A base-type query — `getComponent("Component.ScriptComponent")` (or `getComponents`) — returns the same underlying object, but typed as the bare `ScriptComponent` (which exposes only `createEvent`/`removeEvent`), so you lose the class type and must `as any` to reach custom members; and it returns the *first* matching component, so with several scripts attached you can silently grab the wrong one. Narrow to the class with `obj.getComponent(MyScript.getTypeName()) as MyScript`, or prefer a scene-wired `@input` typed as the class. Read the peer's custom fields/`Event`s in `OnStartEvent`: a field or `Event` it assigns in its own `onAwake` is `undefined` until that peer initializes (methods live on the prototype, so they are always present).
- **Keep the controller↔peer-script interface in sync.** When a controller subscribes to a peer script's events or calls its methods (`panel.onValueChanged.add(...)`, `panel.setState(...)`), those members must be **declared public on that peer class**. If you rename or remove a member on one side (e.g. during a cleanup pass) and don't update the caller, it's a `TS2339 Property 'X' does not exist on type 'Y'` — the strict type-check will fail on it. Fix both files together, and re-run the type-check after the edit (do not assume a prior green check still holds).
- **Never hide a panel by disabling the script's OWN SceneObject** (`this.getSceneObject().enabled = false`): a disabled object stops firing `OnStartEvent`/updates, so its own build never runs (or never re-runs). Toggle a **child** container object instead.
- **Never call `requireAsset` at module top level**: a miss throws at import and takes the whole component down (surfacing as an unrelated "not found"). Call it inside a lifecycle method and tolerate a missing asset.
- **`@input` arrays** need a matching type annotation and are assigned from the Inspector list.
- **`null` vs `undefined`**: Lens Studio uses `null` more than `undefined`; check with `isNull(val)` or `val !== null`.
- **`getDeltaTime()`** returns frame delta in seconds — always use it for frame-rate-independent motion.
- **`this` inside callbacks**: if using a plain `function() {}` callback (not an arrow function), `this` will be wrong. Either use arrow functions or assign `const self = this` before the callback.
- **Destroying objects mid-update** can cause frame errors — defer with a `DelayedCallbackEvent` set to 0 delay if needed.
- **Component caching**: call `getComponent` once in `OnStartEvent` and store the result; calling it every frame is expensive.
- **`onDestroy` fires on the scene object being destroyed**, not when only a component is removed; if you need component-level cleanup, use `OnDisableEvent` or a manual teardown method.
- **Script initialization order**: components on the same frame initialize roughly in scene-hierarchy order. If two components in the same frame need each other in `onAwake`, use `OnStartEvent` instead.
- **`global.scene.createSceneObject(name)`** is on `ScriptScene` (accessed via `global.scene`), not on `SceneObject`. This is the only way to create scene objects at runtime.
- **Don't shadow `BaseScriptComponent` members**: your `@component` class already inherits `name`, `enabled`, and `sceneObject`. Redeclaring one of those names with an incompatible type breaks the `@component` decorator with confusing errors (TS1238 + TS2416) — pick another name (`userName`, `isActive`, …).
- **`createEvent` registers a persistent event — create each one once, never in a per-frame/per-tick path.** Repeated calls accumulate and never auto-clean, so creating an event inside `update` (or any per-tick code) leaks. Create your events once in `onAwake` and reuse them.
- **Don't assume a capability is missing.** Real-world date/time (`Date`) and cross-session persistence both exist — don't fabricate timestamps.
- **Don't guess a member name on any class — grep `Support/StudioLib.d.ts` for the real one.** Guessed names pass a plain transpile but fail a real type-check. Common example: `SceneObject` has **no** `removeComponent` (destroy a component via the component's own `destroy()`, not the object). When unsure of any member — on `Text`, `SceneObject`, or anything else — look it up rather than trust a plausible-sounding name.
- **`Component.Text.size` is a font-scale number in the tens, NOT centimeters; small values render microscopic.** Readable world-space label text needs `text.size` roughly 36-72 (caption ~32, body ~48, title ~64-72) on a ~30-40 cm panel. Setting `text.size = 5..12` because it looks "panel-sized in cm" is a recurring bug: the text renders far too small to read even though it compiles and is present in the scene. This is the same scale family as UIKit's `ElementContent.textSize` (its readable bands are in `/specs-build-ui` → `references/uikit-4.0.md`); do not confuse either with a cm dimension. The text's rectangular bounds come from its `ScreenTransform`'s rect when one is attached, otherwise `Text.layoutRect`: look those members up in `Support/StudioLib.d.ts`.

---

## Reference Files

| Your script involves... | Read first |
|---|---|
| Touch input, tap events, drag, UI widgets | `references/2d-ui.md` |
| Material colors, textures, blend modes, shaders | `references/materials-shaders.md` |
| Spawning objects, prefab instantiation, pooling | `references/instantiation-patterns.md` |
| Math, coordinates, camera projection, rotations | `references/math.md` |
| Face tracking, expressions, landmarks | `references/face-tracking.md` |
| VFX, particle systems | `references/vfx.md` |
| Animation: tweens built in code (native `AnimationCurve` → `AnimationPlayer`, no library), skeletal playback of imported clips, the `frames:0` T-pose trap | `references/animation-playback.md` |
| Physics raycasting, surface alignment (Specs) | `references/world-query.md` |
| Bitmoji, Dynamic Response | `references/user-context.md` |
| Performance optimization, profiling | `references/performance.md` |
| Debugging — compile/runtime errors, `@input` not assigned, missing component, event timing | `references/debugging.md` |
| Cross-script access, TS-to-JS, require() | `references/component-access-patterns.md` |
| Geometry helpers, line drawing, dot product | `references/runtime-geometry-patterns.md` |
| Specs build-flow runtime patterns — `requireAsset` semantics, GLB 100× scale formula, IK `.lspkg` imports + `getTypeName()`, root −Z / child +Z depth idiom, `isNull()`, audio playback modes, `faceDirection` yaw | `references/specs-runtime-patterns.md` |
| Quick API lookup (method signatures) | `references/api-cheatsheet.md` |
| Naming, file organization, Inspector layout (`@ui.label`/`@ui.group_start`), import order, DO-NOTs | `references/conventions.md` |
| Reading and interpreting Lens Studio log output you wrote with `console.*` / `print()` | sibling skill `ls-clad:lens-log-analysis` |
| Constructing or mutating mesh geometry at runtime (`MeshBuilder` — lathe, extrude, primitives, dynamic vertex updates, skinned meshes) | sibling skill `ls-clad:mesh-builder-scripting` |
