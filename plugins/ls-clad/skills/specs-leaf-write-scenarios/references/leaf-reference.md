<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# LEAF Reference

Complete reference for writing LEAF integration tests for Lens Studio Lenses. Covers the package layout, import paths, templates, APIs, and common pitfalls.

## Packages

LEAF ships as a single package. All LEAF functionality lives in `Leaf.lspkg`, organized into sub-folders (`Utils/`, `Interactors/`, `Scenarios/`, `IKSolver/`).

| Package | Purpose |
|---------|---------|
| **Leaf.lspkg** | All LEAF functionality — utilities, interactors, scenario system, and IK solver |

Everything is nested under `Leaf.lspkg/<Utils|Interactors|Scenarios|IKSolver>/...`. Use `specs-leaf-install-packages` to install the package.

`Leaf.lspkg` declares **SpectaclesInteractionKit** and **Bitmoji 3D** as dependencies (Bitmoji 3D powers the IK avatar). Both are pulled in automatically when LEAF is installed from the Asset Library.

## Import Path Mapping

| What | Import from |
|------|-------------|
| `Scenario` | `Leaf.lspkg/Scenarios/scenario/Scenario` |
| `ScenarioMetadata` | `Leaf.lspkg/Scenarios/scenario/ScenarioMetadata` |
| `ScenarioConfig` | `Leaf.lspkg/Scenarios/scenario/ScenarioConfig` |
| `DefaultScenarioManager` | `Leaf.lspkg/Scenarios/scenario/manager/DefaultLeafScenarioManager` |
| `scenariosIndex` decorator | `Leaf.lspkg/Scenarios/decorator/ScenarioIndexDecorator` |
| `expect` | `Leaf.lspkg/Utils/common/Expect` |
| `sleep`, `nextFrame` | `Leaf.lspkg/Utils/common/Utils` |
| `findSceneObjectByName`, `findSceneObject`, `findSceneObjectsByName`, `matchSceneObjectName`, `matchSceneObjectParentName` | `Leaf.lspkg/Utils/common/Utils` |
| `DefaultLeafInteractor` | `Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor` |
| `findInteractableByName`, `findInteractablesByName`, `getInteractables` | `Leaf.lspkg/Interactors/InteractableUtils` |
| `LeafHandInteractor` (shared single-hand accessor) | `Leaf.lspkg/Interactors/interactor/LeafTwoHandInteractor` |
| `LeafSingleHandInteractor` (base class to subclass for custom hand interactors) | `Leaf.lspkg/Interactors/interactor/handInput/LeafHandInteractor` |
| `createIKInteractor` (IK + Bitmoji avatar factory) | `Leaf.lspkg/Interactors/interactor/ik/visualizer/BitmojiAvatar` |
| `IKBodyInteractor` (type) | `Leaf.lspkg/Interactors/interactor/ik/IKBodyInteractor` |

## Scenario Template

```typescript
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {findSceneObjectByName, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {<LensName>LeafInteractor} from "./<LensName>LeafInteractor"

@component
export class <LensName>LeafScenario extends Scenario {
  async run(): Promise<void> {
    const interactor = new <LensName>LeafInteractor()

    await sleep(1500)

    // Step 1: Interact
    // await interactor.tapButton("ButtonName")

    // Verify expected state
    // const element = findSceneObjectByName("ElementName")
    // expect(element.enabled).toBe(true)
  }
}
```

## Custom Interactor Template

```typescript
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {findInteractablesByName} from "Leaf.lspkg/Interactors/InteractableUtils"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"

export class <LensName>LeafInteractor extends DefaultLeafInteractor {
  async tapButton(buttonName: string): Promise<void> {
    const button = findInteractablesByName(buttonName, undefined, true)[0]
    if (!button) {
      throw new Error(`Button "${buttonName}" not found or not enabled`)
    }
    await this.trigger(button)
    await sleep(200)
  }

  async dragElement(
    elementName: string,
    direction: vec3,
    durationMs: number,
  ): Promise<void> {
    const element = findInteractablesByName(elementName, undefined, true)[0]
    if (!element) {
      throw new Error(`Element "${elementName}" not found or not enabled`)
    }
    await this.drag(element, direction, durationMs)
    await sleep(200)
  }
}
```

For hand-gesture interactors, subclass `LeafSingleHandInteractor` and have the subclass call `super(handType, debugMode)`:

```typescript
import {LeafSingleHandInteractor} from "Leaf.lspkg/Interactors/interactor/handInput/LeafHandInteractor"
import {HandType} from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandType"

export class MyGestureInteractor extends LeafSingleHandInteractor {
  constructor(handType: HandType = "right", debugMode: boolean = true) {
    super(handType, debugMode)
  }

  async openPalmMenu(): Promise<void> {
    await this.hand.makeGesture("palm")
    await this.hand.setScreenPosition(new vec2(0.5, 0.5), 70)
  }
}
```

For **direct, non-subclassed** hand access (no custom methods), use the shared accessor `LeafHandInteractor.get("right")` (see the Hand Gestures section below).

Use a custom interactor when the same action appears in 2+ scenarios.

## LeafIndex Wiring

```typescript
import {scenariosIndex} from "Leaf.lspkg/Scenarios/decorator/ScenarioIndexDecorator"
import {ScenarioMetadata} from "Leaf.lspkg/Scenarios/scenario/ScenarioMetadata"
import {<LensName>LeafScenario} from "./<LensName>LeafScenario"

@component
export class LeafIndex extends BaseScriptComponent {
  @scenariosIndex
  static scenariosIndex: ScenarioMetadata[] = [
    {
      id: "<lens-name>-scenario",
      typename: <LensName>LeafScenario.getTypeName(),
    },
  ]
}
```

If a LeafIndex already exists, **append** new entries — do not remove existing ones.

## ScenarioClient (optional — for local preview auto-run)

```typescript
import {DefaultScenarioManager} from "Leaf.lspkg/Scenarios/scenario/manager/DefaultLeafScenarioManager"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"

@component
export class <LensName>ScenarioClient extends BaseScriptComponent {
  private scenarioManager = DefaultScenarioManager.getInstance()

  onAwake() {
    this.runScenarios()
      .then(() => print("[SUCCESS] All scenarios passed."))
      .catch((error) => print(`[FAILURE] ${error}`))
  }

  private async runScenarios(): Promise<void> {
    for (let scenarioId of this.scenarioManager.listScenarioIds()) {
      await sleep(1000)
      await this.scenarioManager.startScenario(scenarioId)
      await sleep(1000)
    }
  }
}
```

## Assertions

```typescript
expect(value).toBe(expected)
expect(obj).toEqual(expectedObj)
expect(value).toBeNull()
expect(number).toBeGreaterThan(5)
expect(float).toBeCloseTo(3.14, 2)
expect(value).toBeTruthy()
expect(value).toBeFalsy()
expect(value).not.toBe(unexpected)
```

**No `toContain` or `toContainString` matcher.** For substring checks:
```typescript
expect(str.includes("x")).toBe(true)
expect(str.includes("x")).toBe(false)  // negation
```

### Assertion best practices

For authoring constraints (no guessing values, relative/delta assertions, verified object names), see the **Scenario rules** section of the main SKILL.md.

## Interactors

```typescript
const interactor = new DefaultLeafInteractor()
await interactor.trigger(interactable)
await interactor.drag(interactable, dragVector, durationMs)
await interactor.hover(interactable, durationMs)
```

### Choosing an interactor

| Interactor | When to use |
|------------|-------------|
| **`DefaultLeafInteractor`** | Fast, scripted SIK interactions. Default for functional/logic flows where you don't care *how* the user reaches the control. |
| **`LeafHandInteractor.get(hand)`** | Simulated hand — gestures (`pinch`/`palm`/…), screen-space hand placement, palm menus. Get both `LeafHandInteractor.get("left")` and `LeafHandInteractor.get("right")` for two-hand flows (concurrent gestures and **two-hand scale**). |
| **`createIKInteractor()`** (IK) | Realistic full-arm + head reach. **Use whenever the test should also verify a real user can physically reach and operate the UI** — it catches buttons placed out of reach, occluded, or only hittable by far-field ray. |

**Add at least one IK scenario** for any Lens with reach-sensitive UI (buttons, panels, sliders the user must touch). IK tests double as a reachability check; the other interactors assume the control is already reachable. See the IK Interactor section below.

### Finding elements

```typescript
const obj = findSceneObjectByName("MyObject")
const objs = findSceneObjectsByName("MyObject")
const button = findInteractableByName("Button")        // single match (preferred when one is expected)
const button2 = findInteractablesByName("Button")[0]   // array form
const all = getInteractables()
// Predicate-based scene search (e.g. disambiguate by parent):
const knob = findSceneObject(
  (sceneObject) =>
    matchSceneObjectName("Knob")(sceneObject) &&
    matchSceneObjectParentName("Slider")(sceneObject),
)
```

## Hand Gestures

Available gestures: `"pinch"`, `"fist"`, `"palm"`, `"backhand"`, `"relaxed"`, `"neutral"`

Get the shared single hand with `LeafHandInteractor.get(handType)`:

```typescript
import {LeafHandInteractor} from "Leaf.lspkg/Interactors/interactor/LeafTwoHandInteractor"

const right = LeafHandInteractor.get("right")
await right.hand.makeGesture("palm")
await right.hand.setScreenPosition(new vec2(0.5, 0.5), 70)  // (screenPos, depthCm)
```

`.hand` exposes the underlying `Hand` (gestures, position, rotation); the interactor itself exposes `trigger` / `drag` / `hover` against interactables.

### Two-handed interactions

Get each hand with `LeafHandInteractor.get("left")` / `LeafHandInteractor.get("right")` and drive them concurrently with `Promise.all`. When both hands drag the **same** interactable concurrently, LEAF auto-synchronizes them into a **two-hand scale** gesture; a lone hand drags normally.

```typescript
import {LeafHandInteractor} from "Leaf.lspkg/Interactors/interactor/LeafTwoHandInteractor"

const left = LeafHandInteractor.get("left")
const right = LeafHandInteractor.get("right")

// Single-hand drag:
await right.drag(planet, new vec3(-5, 5, 0), 2000)

// Two-hand scale — both hands grab the same target and spread apart:
await Promise.all([
  right.drag(satellite, vec3.right().uniformScale(5), 1000),
  left.drag(satellite, vec3.left().uniformScale(5), 1000),
])

// Concurrent independent gestures on both hands:
await Promise.all([
  left.hand.makeGesture("palm"),
  right.hand.makeGesture("palm"),
])
```

The two-hand target must allow it: `Interactable.allowMultipleInteractors` + `InteractableManipulation.canScale`.

## IK Interactor (recommended for UI reachability)

The **IK interactor** drives a full inverse-kinematics arm (shoulder → elbow → wrist → fingers) and head on a Bitmoji avatar, then triggers SIK the way a real user would. Because it physically reaches for each target, **it surfaces UI problems that scripted interactors hide** — buttons placed outside arm reach, occluded targets, or controls the user can only hit via a far-field ray. Prefer it for any scenario validating that a real user can actually reach and operate the UI.

```typescript
import {createIKInteractor} from "Leaf.lspkg/Interactors/interactor/ik/visualizer/BitmojiAvatar"

@component
export class MyIKScenario extends Scenario {
  private readonly _interactor = createIKInteractor()  // {} or omit args for the common case

  async run(): Promise<void> {
    const button = findInteractableByName("LaunchButton")

    // Trigger: pinches the target with the right hand (default) and turns the head toward it.
    // Routing is physics-driven: within arm reach → direct poke; beyond reach → far-field ray.
    await this._interactor.trigger(button)
    await this._interactor.trigger(button, "left")  // left hand

    // Drag: vec2 delta = target's ScreenTransform anchor frame (UI panels/sliders);
    //       vec3 delta = world-space cm (3D draggables).
    await this._interactor.drag(sliderKnob, new vec2(5, 0))     // slide along panel's local X
    await this._interactor.drag(planet, new vec3(0, 10, 0))     // world-space

    // Two-handed scale: grab opposite sides and spread/pinch.
    await this._interactor.scale(planet, vec3.left().uniformScale(4), vec3.right().uniformScale(4))
  }
}
```

### IK reachability checks

Reachability isn't asserted directly. When you `trigger` a target, the IK solver sets the target, resolves the wrist via a least-squares solution, then verifies the reach ray actually converges on the target. Convergence fails when something is between the hand and the target, the target is too small, or it's too close/overlapping — so the `trigger` itself *is* the reachability check.

```typescript
const ik = createIKInteractor()
// trigger resolves the arm to "Confirm" and only succeeds if the reach converges on it.
await ik.trigger(confirmButton)
```

If `trigger` on a supposedly-reachable button fails to converge, routes through a far-field ray, or times out waiting for hover/trigger-end, that's a real signal the control is mis-placed — surface it rather than masking it with a plain `DefaultLeafInteractor`. (`hand.isIndirect(target)` reports the routing decision — direct poke vs. far-field ray — if you want to inspect it.)

### IK notes

- `createIKInteractor()` returns an `IKBodyInteractor` owning a `left` and `right` `IKHandInteractor` plus a head controller. It auto-destroys on scenario cleanup.
- Requires the **Bitmoji 3D** dependency (installed automatically with `Leaf.lspkg`).
- A two-hand `scale` target needs `Interactable.allowMultipleInteractors` + `InteractableManipulation.canScale`.
- IK motion is physically paced — give it `await sleep(...)` after a `scale` (the arms return to idle) before reaching for the next target, and prefer **loop-until-condition** over single moves for precise drag/scale endpoints (the indirect drag is a first-order approximation).

## Timing

```typescript
await sleep(500)      // Wait milliseconds
await nextFrame()     // Wait one frame
```

## Quick Patterns

### Button click
```typescript
const interactor = new DefaultLeafInteractor()
const button = findInteractablesByName("Button")[0]
await interactor.trigger(button)
await sleep(200)
expect((findSceneObjectByName("Label").getComponent("Component.Text") as Text).text).toBe("Clicked")
```

### Hand pinch
```typescript
const hand = LeafHandInteractor.get("right")
await hand.hand.makeGesture("pinch")
await hand.hand.setScreenPosition(new vec2(0.5, 0.5), 70)
await sleep(1000)
await hand.hand.hide()
```

### IK button trigger (validates reachability)
```typescript
const ik = createIKInteractor()
const button = findInteractableByName("Confirm")
// trigger resolves the arm to the button and only succeeds if the reach converges on it;
// an out-of-reach or occluded button fails to converge — a real reachability finding.
await ik.trigger(button)
expect(findSceneObjectByName("Dialog").enabled).toBe(false)
```

### Drag slider
```typescript
const interactor = new DefaultLeafInteractor()
const slider = findInteractablesByName("Slider")[0]
await interactor.drag(slider, new vec3(10, 0, 0), 500)
```

### Scroll to find and tap item in ScrollView
```typescript
const interactor = new DefaultLeafInteractor()
const scrollView = getInteractables().find(
  (i) => i.getSceneObject().name === "ScrollView",
)
const scrollViewST = scrollView.getSceneObject().getComponent("ScreenTransform")

let target: Interactable | undefined
let attempts = 0
while (isNull(target) && attempts < 50) {
  attempts++
  await interactor.drag(scrollView, vec3.up(), 100)
  target = getInteractables().find((i) => {
    if (i.getSceneObject().getParent()?.name !== "TargetItem") return false
    const st = i.getSceneObject().getComponent("ScreenTransform")
    return !isNull(st) && scrollViewST.containsWorldPoint(
      st.localPointToWorldPoint(new vec2(0, -1)),
    )
  })
}
if (!target) throw new Error("Item not found after scrolling")
await interactor.trigger(target)
```

## Path-Driven Generation

When the user provides a scenario path (e.g., "Open Settings -> Tap Theme -> Select Dark mode"):

1. **Parse the path** into ordered steps.
2. **Discover interactables and scene structure** — search the Lens Assets for `findSceneObjectByName(`, `findInteractablesByName(`, scene object names in scripts, UI component names.
3. **Generate the scenario** with real steps: for each step, add `await interactor.someAction(...)` with `expect(...)` assertions.
4. **Generate or extend the interactor** with methods needed for the path.
5. **If object names cannot be determined**, generate with placeholder names and `// TODO` comments.

## Type Reference

```typescript
type HandType = "left" | "right"
type GestureType = "pinch" | "fist" | "palm" | "backhand" | "relaxed" | "neutral" | "unknown"

interface ScenarioConfig {
  getString(key: string): string | undefined
  getInt(key: string): number | undefined
  getBool(key: string): boolean | undefined
}
```

## Checklist

- Extend `Scenario`, implement `async run()`
- Add `@component` decorator
- `await sleep(1500)` at start of `run()` if the Lens uses deferred initialization
- Create interactor (`DefaultLeafInteractor`, `LeafHandInteractor.get(hand)`, or `createIKInteractor()`)
- For reach-sensitive UI, add an IK scenario (`createIKInteractor`) — trigger the way a real user would; a reach that fails to converge (or routes far-field / times out) is a real reachability finding
- Find scene elements by name
- Perform interactions with `await`
- Add `sleep()` after interactions for state to settle
- Assert with `expect()`
- Register scenario in LeafIndex

## Common Pitfalls

- **Init timing** — many Lenses defer scene construction to a `DelayedCallbackEvent` (commonly 0.5s after `onAwake`). Interactables, UI, and scene objects won't exist until that callback fires and SIK registers them. If the Lens under test uses this pattern, add `await sleep(1500)` at the start of `run()` to ensure the Lens is fully initialized. Check the Lens's `onAwake()` for `DelayedCallbackEvent` to confirm whether this is needed.
- **`BaseScriptComponent` is a global** — do NOT import it from SIK or any package. Use it directly in your `LeafIndex` class declaration.
- **Getting a hand** — use the shared accessor `LeafHandInteractor.get(hand)`; a custom *subclass* of `LeafSingleHandInteractor` calls `super(handType, debugMode)`.
- **IK trigger silently goes indirect / times out** — usually means the target is genuinely out of arm reach or occluded. That's a real reachability finding about the Lens UI, not a test bug; report it instead of switching to `DefaultLeafInteractor` to force the interaction.
- **UIKit buttons are findable as Interactables** — `RectangleButton` and `CapsuleButton` extend SIK's `Interactable`, so `findInteractablesByName("MyButton")[0]` works without any special handling.
- **ScrollView is also an Interactable** — scroll by calling `drag()` on the ScrollView interactable. To find items inside a ScrollView, check visibility with `ScreenTransform.containsWorldPoint()` since off-screen items exist but aren't scrolled into view. See the scroll pattern in the Quick Patterns section.
- **Text component name** — use `obj.getComponent("Component.Text") as Text`, not `"Text"`.
- **No `toContain` matcher** — use `expect(str.includes("x")).toBe(true)` instead.
- **Import errors for the LEAF package** — ensure the package is in the Lens's `Assets/` folder, not a parent directory.
- **SpectaclesInteractionKit not found** — install SIK from Asset Library first.
- **Scenarios not running** — verify `LeafIndex` is on the scene and `ScenarioClient` is on an enabled SceneObject for auto-run.
- **Shared state between scenarios** — scenarios run sequentially against the same live Lens instance. State (coins, scores, unlocked items, UI visibility) carries over. Never assert absolute starting values like `expect(coins).toBe(100)` — read the current value and assert deltas instead. Each scenario must be resilient to whatever state the previous scenario left behind.

## Package Installation

For package URIs, SIK version matching, and installation steps, see the **`specs-leaf-install-packages`** skill.
