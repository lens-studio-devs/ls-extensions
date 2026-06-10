---
name: specs-interaction-recipes
description: All Specs hand-interaction guidance — SIK + GestureModule. Load for ANY hand interaction — buttons, hover, tap, swipe, throw, spring-returning grabs, pinch-pull, palm-tap menus, phone-controller switching, inventing a new gesture, or debugging 'my SIK event listener isn't firing'. Includes the init-order rule — SIK / `HandInputData` / `GestureModule` subscriptions must bind inside `OnStartEvent`, not `onAwake`.
user-invocable: false
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Interaction Recipes — Specs Hand Interactions

This skill owns all hand interactions for Specs: the SIK primer in §1, the editor-mock decision rule in §2 (get this wrong and you double-fire callbacks in Editor), the routing table in §3, the drop-in basic recipes in §4–§5 (`TapInteraction`, `DragInteraction`), and the composite recipes in §6–§8 (swipe, throw, grab-pull) which build on raw hand data and therefore each carry their own editor mock. Composite recipes are **reference templates**, not a closed catalog — drop one in as-is, tweak the `CONFIG`, override the public hooks, or compose your own from the shared building blocks in §9. Prefer deriving over reinventing.

## 1. Core SIK primer

These are the SpectaclesInteractionKit primitives every Specs interaction is built on. Use them directly for basic buttons / draggables / hover feedback, or as the Specs-side building blocks of the composite recipes in §6–§8.

### Core imports

```typescript
import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import { InteractableManipulation } from "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation"
import { HandInputData } from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandInputData"
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import animate from "SpectaclesInteractionKit.lspkg/Utils/animate"
import Event from "SpectaclesInteractionKit.lspkg/Utils/Event"
```

Always import from `SpectaclesInteractionKit.lspkg/...` — never from a relative path or the unpackaged source.

### Subscribe to SIK events inside `OnStartEvent`, not directly in `onAwake`

```typescript
@component
export class NewScript extends BaseScriptComponent {
    private interactable: Interactable;

    onAwake() {
        // getComponent / createComponent is safe in onAwake — the component
        // handle exists at scene load.
        this.interactable = this.sceneObject.getComponent(Interactable.getTypeName());

        // Subscribe to SIK events inside OnStartEvent.
        this.createEvent("OnStartEvent").bind(() => {
            this.interactable.onTriggerStart.add(() => {
                print("Start");
            });
        });
    }
}
```

**Rule of thumb — what stays in `onAwake` vs. what moves into `OnStartEvent`:**

| Operation | Where it goes |
|---|---|
| `getComponent` / `createComponent` of any SIK component | `onAwake` |
| Property assignment on a freshly-created SIK component (e.g. `interactable.targetingMode = 1`) | `onAwake` |
| `HandInputData.getInstance()` and `handProvider.getHand("left"\|"right")` | `onAwake` |
| `require("LensStudio:GestureModule")` (typically a class-field init) | `onAwake` |
| `this.createEvent("UpdateEvent" \| "TouchStartEvent" \| "KeyPressEvent" \| …)` — these are `BaseScriptComponent` lifecycle hooks, not SIK events | `onAwake` |
| `.add(...)` on **any** `Interactable` event (`onTriggerStart`, `onTriggerEnd`, `onTriggerEndOutside`, `onTriggerCanceled`, `onHoverEnter`, `onHoverExit`) | inside `createEvent("OnStartEvent").bind(...)` |
| `.add(...)` on **any** `InteractableManipulation` event (`onManipulationStart`, `onManipulationEnd`) | inside `createEvent("OnStartEvent").bind(...)` |
| `.add(...)` on hand-side pinch events (`hand.onPinchDown`, `onPinchUp`, `onPinchCancel`) | inside `createEvent("OnStartEvent").bind(...)` |
| `.add(...)` on any `GestureModule.get*Event(...)` (`getGrabBeginEvent`, `getGrabEndEvent`, `getPalmTapDownEvent`, `getPinchStrengthEvent`, `getTargetingDataEvent`, `getIsPhoneInHandBeginEvent`, `getFilteredPinch*Event`, …) | inside `createEvent("OnStartEvent").bind(...)` |

Every code example below — and every reference script in `resources/scripts/` — follows this pattern.

### Hand tracking

```typescript
const handProvider = HandInputData.getInstance()
const leftHand = handProvider.getHand("left")
const rightHand = handProvider.getHand("right")

if (rightHand.isTracked()) {
  const wristPos: vec3 = rightHand.wrist.position           // stable; use for motion deltas
  const indexTip: vec3 = rightHand.indexTip.position        // jittery during pinch open/close
  const thumbTip: vec3 = rightHand.thumbTip.position
}

// World camera transform — needed for camera-relative interaction math
const camera = WorldCameraFinderProvider.getInstance()
const camTransform = camera.getComponent().getTransform()
```

`rightHand.onPinchDown / onPinchUp / onPinchCancel` are the canonical hand-side pinch signals — recipes in §6–§8 subscribe to these.

### Interactable (pinch / hover on an object)

`Interactable` makes a scene object respond to SIK interactors. Create programmatically — no `@input` wiring needed. Object must have a `ColliderComponent` (auto-create if missing — see `PinchPullReleaseInteraction.ts` for the pattern).

```typescript
onAwake() {
    const interactable = myObj.createComponent(Interactable.getTypeName()) as Interactable;
    this.createEvent("OnStartEvent").bind(() => {
        interactable.onTriggerStart.add((event) => { /* pinch started on this object */ });
    });
}
```

Also available: `onTriggerEnd`, `onHoverEnter`, `onHoverExit` — same shape. All subscribe inside `OnStartEvent` (see §1 "Subscribe to SIK events inside `OnStartEvent`" above).

### Interactor types — SIK already dual-paths Interactables for you

`Interactable` callbacks (`onTriggerStart`, `onHoverEnter`, …) are fired by whichever `Interactor` is active on the current platform — you bind once and it works everywhere:

| Interactor | Active when | What it does |
|---|---|---|
| `HandInteractor` | Running on a Specs device | Hand pinch / targeting ray → fires `Interactable` events |
| `MouseInteractor` | Running in Lens Studio Editor Preview | Mouse click on the preview area → fires `Interactable` events. v0.12.0+ adds `moveInDepth` / `moveInDepthAmount` Inspector inputs for testing 3D depth interaction |
| `MobileInteractor` | Specs paired with the Snap mobile app, phone-as-controller | Phone tracking + on-screen button → fires `Interactable` events |

**Implication:** if your interaction is built on `Interactable` or `InteractableManipulation`, you do NOT need to add a manual `TouchStartEvent` / `TapEvent` editor mock. SIK's `MouseInteractor` handles editor preview automatically. Adding a manual mock on top causes **double-firing** in editor (MouseInteractor fires `onTriggerStart`, your `TapEvent` handler fires the same callback again).

Manual editor mocking IS required for the composite recipes in §6–§8, because they subscribe to raw `HandInputData` (`hand.onPinchDown`, wrist position) and raw `GestureModule` events — and those raw events do NOT fire in Lens Studio Editor. See §2 for the decision rule and §9 for the camera-relative 2D-to-3D primitive the recipes use.

### InteractableManipulation (grab and move)

Layers grab-and-move on top of an `Interactable`. Use for "stay where released"; for "spring back on release with thrown velocity" use §7 `PinchPullReleaseInteraction`.

```typescript
onAwake() {
    const manipulate = myObj.createComponent(InteractableManipulation.getTypeName()) as InteractableManipulation;
    this.createEvent("OnStartEvent").bind(() => {
        manipulate.onManipulationStart.add(() => { /* user grabbed */ });
        manipulate.onManipulationEnd.add(()   => { /* user released */ });
    });
}
```

### animate() — smooth transitions

```typescript
animate({ duration: 0.3, easing: "ease-out-quad", update: (t) => { /* lerp scale, position, etc. */ }, ended: () => {} })
```

Easings: `linear`, `ease-{in|out|in-out}-quad`, `ease-{in|out|in-out}-back`. For release momentum (recipes need it), use §9 `SpringAnimate` instead.

### Event<T> — typed component-to-component signals

```typescript
public onActionComplete: Event<{ result: string }> = new Event<{ result: string }>()
this.onActionComplete.invoke({ result: "success" })           // owner invokes
otherComp.onActionComplete.add(({ result }) => print(result)) // subscriber binds
```

### GestureModule — raw Lens Studio gesture events

`HandInputData` (above) wraps the most common SIK-mediated pinch events. Drop down to Lens Studio's raw `GestureModule` for events SIK doesn't surface: fist-grab (used by §8 `GrabPullReleaseInteraction`), palm tap, pinch strength curve, targeting ray, phone-in-hand. Setup:

```typescript
private gestureModule: GestureModule = require('LensStudio:GestureModule')

onAwake() {
    // require() is safe as a class-field init; subscriptions go inside OnStartEvent
    // (see §1 "Subscribe to SIK events inside OnStartEvent").
    this.createEvent("OnStartEvent").bind(() => {
        // Representative example — fist-grab (§8 GrabPullReleaseInteraction uses this).
        // For the full API surface see the table below.
        this.gestureModule.getGrabBeginEvent(GestureModule.HandType.Right).add(() => { /* fist closed */ });
    });
}
```

API surface (every method takes `GestureModule.HandType.Left | Right`):

| Method | Args | Fires |
|---|---|---|
| `getGrabBeginEvent` / `getGrabEndEvent` | `{}` | Fist closes / opens |
| `getPalmTapDownEvent` / `getPalmTapUpEvent` | `{}` | Other hand's index taps / lifts |
| `getPinchStrengthEvent` | `{strength: 0–1}` | Every frame |
| `getTargetingDataEvent` | `{isValid, rayOriginInWorld, rayDirectionInWorld}` | Every frame |
| `getPinchDownEvent` / `getPinchUpEvent` | `{confidence, palmOrientation}` | Pinch start / release (prefer `hand.onPinchDown` from `HandInputData`) |
| `getFilteredPinchDownEvent` / `getFilteredPinchUpEvent` | same as above | Stable variants — robust while hand is moving |
| `getIsPhoneInHandBeginEvent` / `getIsPhoneInHandEndEvent` | `{}` | Phone detected / removed |

## 2. Editor-first interactions — when manual mocking is and isn't needed

Specs experiences need to be testable in Lens Studio Editor without a headset. **But the right way to achieve that depends on which API your interaction is built on** — get this wrong and you'll either double-fire callbacks in editor or have no editor support at all.

### Decision rule

| Your interaction is built on… | Editor support comes from… | Add manual mock? |
|---|---|---|
| `Interactable` / `InteractableManipulation` / free-space gesture | SIK's `MouseInteractor` / `Interactor.onTriggerStart` | **No.** (Interactable and free-space cases covered in §1 Interactor types) |
| Raw `HandInputData` events (`hand.onPinchDown`, `hand.onPinchUp`, `wrist.position` tracking) — chosen for wrist-stable tracking or per-hand separation | Nothing automatic — raw hand events don't fire in Editor | **Yes.** Bind `TouchStartEvent` / `TouchMoveEvent` / `TouchEndEvent` + Shift key for a 2D-to-3D mock. See §9. |
| Raw `GestureModule` events (`getGrabBeginEvent`, palm-tap, targeting ray, pinch strength, phone-in-hand) | Nothing automatic — these are hand-tracking-only on Specs. See §1 `GestureModule` subsection. | **Yes.** Same as above. |
| Mixed (e.g. `Interactable` for grab-start + raw `wrist.position` for motion delta) | `Interactable` part: MouseInteractor. Motion part: nothing. | **Yes, partial.** Let SIK fire trigger events; add a TouchMove-based mock for the motion delta. See `PinchPullReleaseInteraction.ts`. |

For a complete button class with named `onPress` hook using `Interactable` + `OnStartEvent`, see §4 `TapInteraction.ts` (drop-in) or the §1 "Interactable" subsection for the inline `createComponent` + `.add(...)` pattern.

### Free-space gesture — no Interactable, no manual mock

When the user pinches/clicks anywhere in space (no specific object being targeted) and you need a continuous 3D position while they hold it — mid-air sketching, pinch-to-draw, tap-anywhere-to-spawn — wrapping a giant invisible collider so `Interactable` fires is the wrong shape. Instead, subscribe to the **Interactor's own** `onTriggerStart` event (which fires regardless of target — see [`BaseInteractor.ts:174`](https://github.com/Snapchat/SpectaclesInteractionKit) — note this is the Interactor's event, not the Interactable's) and read `interactor.startPoint` per frame while triggering. SIK's `MouseInteractor` internally uses a `TouchRayProvider` that already binds `TouchStartEvent` / `TouchMoveEvent` / `TouchEndEvent` and exposes the cursor's world-space position continuously, so you do NOT need to bind those events yourself.

One code path, both platforms: in Editor `MouseInteractor` fires `onTriggerStart` on mouse-down anywhere and its `startPoint` follows the cursor in world space every frame; on Specs `HandInteractor` fires `onTriggerStart` on pinch and its `startPoint` is the pinch point.

**Two caveats to be aware of:**

1. **Editor depth is fixed by the camera plane.** `MouseInteractor.startPoint` sits at one camera-relative depth — fine for 2D sketching, limited for strokes that must vary in Z. Toggle the `moveInDepth` Inspector input on MouseInteractor for an oscillating-depth test, or layer the §9 Shift+Y mock for explicit Z control.
2. **`startPoint` on Specs is the pinch point**, which jitters as fingers close/open. For drawing-style strokes the jitter reads as line texture; for precision pulls (PinchPullRelease, GrabPullRelease) use raw `hand.wrist.position` instead — which is exactly why the §7–§8 composite recipes do what they do.

### Composite gestures — manual editor mock is REQUIRED

When the Specs path subscribes to raw hand data (e.g. `hand.onPinchDown` for swipe detection, `wrist.position` for motion tracking, `GestureModule.getGrabBeginEvent` for fist-grab), the editor has no equivalent input source. You must add a `TouchStartEvent` / `TouchMoveEvent` mock that maps 2D screen drag to camera-relative 3D motion — default vertical drag = Z (depth), with Shift switching vertical drag to Y (height). The canonical implementation is in:

- [`SwipeInteraction.ts:39-42`](resources/scripts/SwipeInteraction.ts:39) — the `onAwake` that calls both `setupSpectaclesInteraction()` and `setupEditorInteraction()`
- [`SwipeInteraction.ts:119-142`](resources/scripts/SwipeInteraction.ts:119) — the editor-mock body
- §9 "Editor-mocking pattern" — the touch + Shift-key → camera-relative 3D primitive every composite recipe reuses

When inventing a new composite recipe, see §9.

## 3. When to use this skill

| If the experience needs… | Where to look |
|---|---|
| Single-object tap (button-like) with named `onTap`/`onHoverStart`/`onHoverEnd` hooks | this skill → §4 `TapInteraction.ts` (auto-collider, no manual mock) |
| Single-object grab-and-move with `onDragStart`/`onDragUpdate`/`onDragEnd` | this skill → §5 `DragInteraction.ts` (auto-collider, no manual mock) |
| Inline button — just one `Interactable.onTriggerStart` binding in an existing script | this skill → §1 primer (see §2 basic-button example; no extra file needed) |
| Raw `GestureModule` events — fist-grab, palm-tap, pinch-strength curve, targeting ray, phone-in-hand | this skill → §1 `GestureModule` subsection |
| Swipe-direction detection — snake, carousel, page flip | this skill → §6 `SwipeInteraction.ts` |
| Pinch-pull-and-release throw — slingshot, mini-golf, bow-and-arrow | this skill → §7 `PinchPullReleaseInteraction.ts` |
| Full-fist grab with axis lock + spring return — lever, drawer, joystick | this skill → §8 `GrabPullReleaseInteraction.ts` |
| A gesture none of these cover | this skill — start from §9 building blocks |
| Production UI module (multi-button panels, layout, icons) | `/specs-build-ui` (generates the module; wire its events via §1 primer) |

## 4. Recipe: TapInteraction

Drop-in `@component` for object pinch-tap. Wraps SIK's `Interactable` and exposes named hooks. Use this when you want a clean button signal on a single object without re-implementing the `Interactable` binding every time.

- **Source:** `resources/scripts/TapInteraction.ts`
- **Hooks:** `onTap: Event<InteractorEvent>`, `onHoverStart`, `onHoverEnd`
- **CONFIG:** `autoCreateCollider` (default `true`), `colliderSize` (default 10cm cube), `debugCollider`, `targetingMode` (1=Direct, 2=Indirect, 3=Both)
- **Editor support:** via SIK `MouseInteractor` (see §2).
- **Example use — start screen "Begin" button:** attach `TapInteraction` to the button mesh, subscribe `onTap` in the main game script to advance state.

## 5. Recipe: DragInteraction

Drop-in `@component` for object grab-and-move. Wraps SIK's `Interactable` + `InteractableManipulation` and surfaces named hooks plus a per-frame world position while dragging.

- **Source:** `resources/scripts/DragInteraction.ts`
- **Hooks:** `onDragStart: Event<void>`, `onDragEnd: Event<void>`, `onDragUpdate: Event<vec3>` (fires every frame while dragging; payload is the object's world position after `InteractableManipulation` has written it)
- **CONFIG:** `autoCreateCollider`, `colliderSize`, `debugCollider`, `targetingMode`
- **Editor support:** via SIK `MouseInteractor` (see §2).
- **Example use — repositionable widget:** attach `DragInteraction` to a UI panel; subscribe `onDragEnd` to persist the new position. For "spring back on release with thrown velocity" use §7 `PinchPullReleaseInteraction.ts` instead.

## ⚠ Composite recipes are ADDITIVE to the specs-experience-builder pipeline

Per orchestrator Hard Rule 1: copying a composite recipe (§6–§8) adds **one extra script file** to `Assets/Scripts/`. It does NOT replace any pipeline phase — asset manifest, Phase 2 asset generation (`/build-mesh`, `/build-sfx`, `/build-music`, `/specs-build-ui`, `/icon-selector`), Phase 2b main game script, Phase 2c `aabb_cm` update, Phase 3 bootstrap all still run. If you catch yourself thinking "the recipe handles it" and skipping a Phase 2 sub-step, stop and re-plan. The recipe is one file; the pipeline is everything else.

§4 `TapInteraction` / §5 `DragInteraction` drop-ins follow the same rule. §1 primer + §2 basic-button example are inline patterns, not extra files.

## 6. Recipe: SwipeInteraction

Detects fast, directional hand swipes by pinching and moving. Six directions: Left, Right, Up, Down, Forward, Back.

- **Source:** `resources/scripts/SwipeInteraction.ts`
- **Core mechanism:** on pinch-down, record wrist position in camera-local space. While pinching, track max displacement. On pinch-up, classify by dominant axis using a cone-of-acceptance.
- **Tunables:**
  - `SWIPE_THRESHOLD_3D` (default `5.0` cm) — minimum travel to register a swipe
  - duration cap `0.75s` — pinches held longer than this are treated as drags, not swipes
  - `strictness = 1.3` — dominant axis must exceed others by 30% to avoid diagonal false positives
- **Override these hooks** (all public, empty by default; default bodies just call `updateFeedback`):
  - `onSwipeLeft()`, `onSwipeRight()`, `onSwipeUp()`, `onSwipeDown()`, `onSwipeForward()`, `onSwipeBack()`
- **Editor mocking:** 2D touch drag → X = Left/Right, vertical = Forward/Back, Shift + vertical = Up/Down.
- **Example use — 3D snake:** override `onSwipeLeft/Right/Up/Down` to change the snake head's velocity vector. Ignore Forward/Back.
- **Adaptation ideas:**
  - Keep only the cone-detection math and apply it to a different input signal (e.g., head rotation delta) to classify head-shakes.
  - Shrink the threshold and raise the duration cap for slower, more forgiving swipes on a tutorial UI.

## 7. Recipe: PinchPullReleaseInteraction

SIK-`Interactable`-based. User pinches an object, pulls it on allowed axes up to `maxDistance`, releases it, and spring physics snaps it back — recording release velocity for throw momentum.

- **Source:** `resources/scripts/PinchPullReleaseInteraction.ts`
- **Core mechanism:** attaches to an object with a `ColliderComponent` + `Interactable` (auto-created if missing). `targetingMode = 1` (Direct touch) by default. Tracks `startPoint` delta on Specs, planecastPoint in Editor.
- **`CONFIG` object** (edit at top of file):
  - `allowX / allowY / allowZ` — axis lock per axis
  - `maxDistance` — cm clamp from original position
  - `springDuration`, `springBounce` — release feel
  - `colliderSize` — auto-generated box if no collider present
  - `debugCollider` — wireframe while prototyping
- **Example use — mini-golf ball launcher:** `allowX=true, allowY=false, allowZ=true`. Grab the ball, pull back along -Z, release. Use `spring.velocity` at release to apply impulse to a physics-driven ball.
- **Adaptation ideas:**
  - Drop the spring-return for "stay where released" — remove the `else` branch in `onUpdate` that calls `spring.evaluate`.
  - Allow free 3D pull: set all three axes true, remove distance clamp.
  - Switch `targetingMode = 3` (Both) if you want indirect raycast-pinch instead of direct touch.

## 8. Recipe: GrabPullReleaseInteraction

Same behavior as PinchPullRelease but uses a **full-fist grab** via `GestureModule.getGrabBeginEvent` instead of SIK pinch. Tracks the midpoint of `indexTip` + `thumbTip` to decide if the hand is inside the grab volume, then uses `wrist.position` for stable motion tracking.

- **Source:** `resources/scripts/GrabPullReleaseInteraction.ts`
- **Same `CONFIG` schema** as PinchPullRelease plus `grabSize` + `grabPadding` for the hand-in-volume check.
- **Why prefer this over PinchPullRelease:** grabbing feels more natural for chunky objects (levers, handles, bats). Pinch is better for small/precise targets.
- **Example use — virtual lever:** `allowX=false, allowY=true, allowZ=false`, small `maxDistance`. Override the spring to trigger a state change when pulled past a threshold.
- **Adaptation ideas:**
  - Two instances, one per object, driven by left + right hand — two-handed stretch that scales a middle object based on hand separation.
  - Drive rotation instead of translation by replacing `setWorldPosition` with a rotation calculated from `handDelta`.

## 9. Reusable building blocks (compose your own interaction)

When none of the recipes above fit, compose a new one from these primitives. Every recipe in this skill is built from them.

### Spring-return

```typescript
import { SpringAnimate } from "SpectaclesInteractionKit.lspkg/Utils/springAnimate";

this.spring = SpringAnimate.spring(0.5 /* duration */, 0.3 /* bounce 0-1 */);

// each frame while "released":
if (this.spring.isSettled(current, target, 0.1, 0.1)) {
  transform.setWorldPosition(target);
  this.spring.reset();
  return;
}
const next = this.spring.evaluate(current, target);
transform.setWorldPosition(next);
```

Record `spring.velocity` at release for throw momentum: `spring.velocity = (targetPos - currentPos) / deltaTime`.

### Cone-of-acceptance (direction classification)

Require the dominant axis to exceed the others by a `strictness` factor (1.3 is a good default). Prevents diagonal false positives.

```typescript
const max = Math.max(absX, absY, absZ);
if (max === absX && absX > absY * 1.3 && absX > absZ * 1.3) {
  // X is dominant
}
```

For Z (push/pull), you may want to loosen the Y check because arms naturally arc vertically when pushing forward — see `SwipeInteraction.ts` for the ergonomic exception in `detect3DSwipe`.

### Grab-center heuristic

- To test whether a hand is **inside** a grab volume: use the midpoint of `indexTip.position` + `thumbTip.position`, transform into the object's local space, compare to `halfSize + padding`.
- To **track motion** during a grab: use `wrist.position`. Fingertips jitter when fingers open/close, which causes jumps.

```typescript
const hand = HandInputData.getInstance().getHand("right");
const grabCenter = hand.indexTip.position.add(hand.thumbTip.position).uniformScale(0.5);
const wristMotion = hand.wrist.position; // use this for deltas
```

### Editor-mocking pattern

Specs experiences need to be testable in the Editor without a headset. Map 2D touch drag to 3D camera-relative motion. Default vertical drag controls Z (depth); hold `Shift` to switch vertical drag to Y (height).

```typescript
this.createEvent("TouchStartEvent").bind((e) => { this.touchStart = e.getTouchPosition(); });
this.createEvent("TouchMoveEvent").bind((e) => { this.touchNow = e.getTouchPosition(); });
this.createEvent("KeyPressEvent").bind((e) => { if (e.key === Keys.Shift) this.shift = true; });
this.createEvent("KeyReleaseEvent").bind((e) => { if (e.key === Keys.Shift) this.shift = false; });

// each frame:
const cam = WorldCameraFinderProvider.getInstance().getComponent().getTransform();
const flatRight = new vec3(cam.right.x, 0, cam.right.z).normalize();
const flatForward = new vec3(cam.forward.x, 0, cam.forward.z).normalize();
const delta = this.touchNow.sub(this.touchStart);

const x = flatRight.uniformScale(delta.x * SENS);
const yOrZ = this.shift
  ? new vec3(0, -delta.y * SENS, 0)             // Shift: drag vertical → Y
  : flatForward.uniformScale(-delta.y * SENS);  // no Shift: drag vertical → Z
```

This is the primitive every composite recipe (§6–§8) uses for its `setupEditorInteraction()` body.

### Time-gated vs held

A `duration > 0.75s` check is the simplest way to separate **swipe** (fast, ballistic) from **drag** (slow, held). Apply the same threshold idea when you need to distinguish any transient gesture from a sustained one.

## 10. Integration pattern

A recipe is **one extra script file** living next to the main game script and the `/specs-build-ui`-generated `<Name>UI.ts` module — owns its own `UpdateEvent`, collider setup, and gesture bindings.

1. **Place the file** under `Assets/Scripts/` (copy from `resources/scripts/`).
2. **Attach** via `ScriptComponent` in Editor, or via `getComponent` / `createComponent` in `onAwake`.
3. **Subscribe to the public hooks** documented in each recipe section (§4–§8). Wire callbacks to game state, `requireAsset` meshes/SFX, or the UI module — never inline `Component.Text`.

Meshes/SFX/icons/UI all come from Phase 2 of the orchestrator's pipeline. The recipe never generates or replaces those.

## 11. When to adapt vs. write from scratch

- **≥70% match** to an existing composite recipe (§6–§8) → copy the file, tweak `CONFIG`, override hooks. Don't rewrite.
- **Fundamentally new gesture** (two-handed, rotation-based, head-driven) → start from §9 building blocks for the spring/cone/editor-mock patterns. See §3 routing table and §2 decision rule for Interactable vs. raw-hand guidance.
