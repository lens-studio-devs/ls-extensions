---
name: snapchat-screen-input
description: On-screen player controls for a mobile Snapchat Lens — the Joystick component (v2.3.0, a screen-space virtual joystick) and Input Action (v1.4.1), which maps joystick/keyboard/D-pad input to movement and projects it into the 3D world. Add/style the joystick or wire input to a character. Spoke of snapchat-controllable-character.
user-invocable: false
---
<!--
Copyright 2026 Snap Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Screen Input (Joystick v2.3.0 + Input Action v1.4.1)

Two cooperating components: **Joystick** renders a screen-space virtual stick and reports a `vec2`; **Input Action** maps that (or keyboard / D-pad) to a response — typically moving a `CharacterController` — and does the **2D→3D projection** that turns a flat stick vector into a camera-relative world direction.

Parent/setup context: `snapchat-controllable-character`. The thing being moved: `snapchat-character-controller`.

> **Specific numbers here (joystick config defaults, `animationDuration`, etc.) are v2.x snapshots — verify against the live component/prefab.** What's durable is the component/knob names, the API, and the input→ability wiring; the exact values drift across versions (see the hub's version caveat).

## Imports

```ts
import { Joystick } from "Joystick.lsc/Joystick/Joystick";                 // @component + Joystick.create + re-exported JoystickConfigInput
import { InputActionComponent } from "InputAction.lsc/InputAction/Input Action"; // file name has a space
```

Both are screen-space UI components. The Joystick adds a `ScreenTransform` to its own SceneObject in `onAwake` — it must live under the **orthographic** "UI Controls" camera (the Bitmoji Player Package parents it there and matches its render layer).

## The two-camera rule (why there are two cameras)

- The **orthographic** 2D camera renders the joystick (screen overlay).
- The **perspective** 3D camera is what Input Action uses as the **projection camera** to convert the stick's `(x,y)` into a world direction. "Up" on the stick means "away from where the 3D camera looks," not "toward screen-top."

`PlayerCharacterInit.assignCameraToScripts` auto-assigns the 3D camera into every Input Action under the controls root: `movementInput.{joystick,keyboard,dpad}AdapterConfig.projection.projectionCamera = the3DCamera`. If you build controls by hand, set that yourself or movement falls back to raw world space (a rotating camera then feels wrong).

## Joystick

The shipped default renders as a **round plate with directional-arrow indicators** (a `visualConfig` preset) — restyle via `visualConfig` or the plate/handle material setters below.

**Public API** (`direction` origin: Left-Top = `(-1,1)`, Right-Bottom = `(1,-1)`):
`direction: vec2` (read), `directionUpdateEvent` (`.add`/`.remove`, fires on change), `onViewLoadedEvent` (view resources ready), `show(withAnimation=true)`, `hide(withAnimation=true)`, `setPlateMaterial(m)`, `setHandleMaterial(m)`, `setHandleSize(n)`, `setDirection(vec2 | null)` (programmatic override — non-null ignores touch; `null` restores touch), `setRenderOrder(n)` / `getRenderOrder()`.

**Create from code:** `Joystick.create(hostingObject: SceneObject, config: JoystickConfigInput)` — adds the component and applies config immediately.

**`JoystickConfigInput`** (defaults): `renderOrder` 100, `deadZone` 0.1, `positionConfig` `Free(0)`/`Fixed(1)`, `interactiveArea` (InteractionComponent, Free only), `onRelease` `Hide/SnapBack(2)/StayInPlace` (Free only, default SnapBack), `resetPositionOnEnable` true, `inactiveOpacity` 0.5 (Free), `handleSmoothingFactor` 0.4, `allowedAxis` `Both(0)/Horizontal/Vertical`, `visualConfig` (Use Preset / Custom materials / Transparent), `enableOnStart` true.

## Input Action

`@component InputActionComponent` selects one action via `actionType` `@input("int")` ComboBox `["Movement"(0), "Rotation"(1), "Event"(2), "Scalar"(3), "Screen Event"(4)]`. **Default is 2 ("Event")** — for player movement set it to **Movement (0)**, which activates `movementInput`. Also: `enableTouchBlocking` (true → sets `global.touchSystem.touchBlocking = true` globally in `onAwake`), `printWarns` (true).

**`movementInput` (MovementInputActionConfig):**
- `inputType`: `Joystick(0)` / `Keyboard(1)` / `DPad(2)`.
- one adapter config per source, `@showIf` on `inputType`:
  - `joystickAdapterConfig`: `joystickInputConfig { joystick (ref the Joystick component), invertX, invertY }` + `projection`.
  - `keyboardAdapterConfig`: `forward/left/backward/right` key mappings + `projection`.
  - `dpadAdapterConfig`: `forward/left/backward/right` (`InteractionComponent`s) + `projection`.
- `responses[]` (MovementResponseConfig): each is `MoveCharacter`, `MoveObject`, or `ComponentApi`.

**`projection` (ProjectionConfig)** — the 2D→3D bridge:
- `projectOnPlane` (true, label "Constrain to Plane"), `projectionCamera` (Camera, label "Reference Camera" — **empty ⇒ world-space projection**), `planePreset` `XZ(0, Horizontal)` / `XY(1, Front)` / `Custom(2)`, `customPlane` `(0,1,0)` (shown for Custom).
- Behavior: with a plane, it takes the projection camera's world **right** vector, projects onto the plane normal (XZ→up, XY→forward, or custom), and rotates `(x,y,0)` into that world plane — so stick input becomes camera-relative movement. `projectOnPlane=false` returns raw `(x,y,0)`.
- **Degenerate case — a level side camera:** if the projection camera looks straight along the character's locked axis (e.g. a side-scroller cam looking down −Z while movement is XY-locked), the plane projection of the joystick's *vertical* axis is ill-defined and can bleed into horizontal movement (a straight-up push can read as sideways). For a side-scroller, constrain the Joystick to **`allowedAxis = Horizontal`** so only the meaningful axis drives movement. Note `allowedAxis` constrains **input only** — the shipped joystick *visual* still shows all four directional arrows, so it can misrepresent a horizontal-only stick; restyle via `visualConfig` (or swap to a horizontal-only visual) if the arrows mislead.

**Movement → CharacterController:** `MoveCharacterResponse.move(velocity)` calls `playerController.setTargetSpeedModifier(speed * velocity.length)` then `playerController.move(velocity.uniformScale(-1))` — note the **negation**. The controller is referenced Directly (`@input("Component.ScriptComponent") characterController: CharacterController`) or resolved via a GameManager's `localPlayerController`. `move()` must be called every frame (the adapter fires only while `|direction| > 0`), so the character stops on release — expected. `MoveObjectResponse` is the alternative (translates a SceneObject by `velocity * speed * deltaTime`, **no** negation).

## Action buttons — Emote / Dash / Jump (what the drop-in ships)

The Bitmoji Player Package's `UI Controls` is **not just a joystick**. Out of the box it also parents a **`Buttons`** group with three action buttons — **Emote**, **Dash**, **Jump** — plus a **`Keyboard Controls`** object (desktop/editor key input). Each button is an **Input Action** whose response drives the character:

| Button | What it does (observed at runtime) |
|---|---|
| **Jump** | the character jumps (`CharacterController.jump()`) |
| **Dash** | a short forward burst along the facing direction (`CharacterController.dash()`) |
| **Emote** | plays a celebration / emote action on the character (a `CharacterController` action) |

> **Inspect the live component — don't trust a memorized wiring.** In v4.0.2 the on-screen buttons are Input Actions in **Screen Event** mode (`actionType = 4`, `screenEventInput`) — *not* the `Event` / `discreteInput` mode (that mode is the **keyboard** equivalents under `Keyboard Controls`). The response arrays serialize as empty *schema templates* through the scene-read tools, so the exact response type / action name is **not reliably readable via `VirtualScene` / `scene-graphql`** — the button→ability column above is what's *observed at runtime*, not a field you can round-trip. For the precise internal wiring, open the button's Input Action in the Inspector. (One value *is* recoverable by grepping the installed `UI Controls.prefab`: the Emote button's `actionName` is **`emote`**, so `characterController.startAction("emote")` reproduces the celebration from script.)

**Anatomy of one button** (e.g. `UI Controls > Buttons > Dash`):
- an **`Input Action`** component (Screen Event) — the trigger; its response drives the CharacterController.
- a **`ButtonPressedState`** component — the press visual: briefly swaps the button `Image` to a pressed texture on touch (an `animationDuration`, ~0.2 s in v4.0.2).
- an **`Image`** (idle icon) + a **`ScreenTransform`** (screen position/size).
- an **`Interaction Area`** child holding the **`InteractionComponent`** that receives the tap.

**Remove a button you don't need:** delete its SceneObject under `UI Controls > Buttons` (e.g. delete `Dash`). Delete the whole `Buttons` object to drop all three; delete `Keyboard Controls` to drop desktop-key input. Nothing else references them, so removal is clean.

**Tweak a button:**
- *Look* — the `Image`'s idle texture, and `ButtonPressedState`'s `pressedTexture` / `animationDuration` (the press-flash).
- *Place* — anchor the button's `ScreenTransform` to a thumb-reachable region (see `../../references/snapchat-ui-and-spatial.md`).
- *Rebind / repurpose* — the button's `Input Action` response. It can drive CharacterController abilities (jump, dash, start-action, toggle sprint, toggle auto-face-movement, stop movement, set position — the `CharacterControllerDiscreteResponseType` family, where **Start Action** plays whatever action name you set) or a `ComponentApi` / `GameManager` / `Behavior` response. Configure it in the Inspector — these response values don't round-trip through the scene-read tools.
- *Change how the ability behaves* (jump height/multi-jump, dash speed/distance/cooldown, which emote clip) — **that lives on the `CharacterController`, not the button.** Tune `jumpSpeed` / `multiJumpCount`, `dashSpeed` / `dashDuration` / `dashCooldown` / `allowAirDash`, and the Actions config there. See `snapchat-character-controller`.

## Recipes

- **Restyle the joystick:** set `visualConfig` to Custom + supply `plateMaterial`/`handleMaterial` (or pick a preset). Live setters `setPlateMaterial`/`setHandleMaterial` work only after `onViewLoadedEvent`; `setHandleSize` only takes effect at load — prefer configuring via `visualConfig`.
- **Reposition:** `positionConfig = Fixed` for a pinned stick, or `Free` + `interactiveArea` for touch-anywhere-in-region. Anchor the Joystick's `ScreenTransform` to a thumb-reachable region (see `../../references/snapchat-ui-and-spatial.md`).
- **Constrain to an axis:** `allowedAxis = Horizontal` / `Vertical` (e.g. a side-scroller stick). Pair with the character's axis lock (`snapchat-character-controller`).
- **Switch to keyboard/D-pad:** set `movementInput.inputType` and fill that adapter; the projection wiring is identical.
- **Drive a non-character object:** use a `MoveObject` response instead of `MoveCharacter`.

## Gotchas

- **Inverted / wrong-plane movement:** the built-in `MoveCharacter` **negates** velocity; `invertX`/`invertY` live on `joystickInputConfig`; wrong plane preset (XZ vs XY) flips ground vs vertical movement. Fix these in config, not by hacking signs downstream.
- **Missing projection camera** → world-space projection (warns); a moving camera then feels wrong. Ensure the 3D perspective camera is assigned (auto in the player package).
- **Init order:** InputAction builds its adapters/responses in `onStart` (not `onAwake`); the referenced Joystick must exist/initialize first — `JoystickWrapper` waits via `doWhenScriptInitialized`. Creating from code, use `Joystick.create(host, config)` so config applies before the InputAction runs.
- **Gesture blocking is on by default** (`enableTouchBlocking`) on both InputAction and CharacterController — turn off if other native Snapchat gestures are needed.
- **"Event" ≠ "Screen Event".** `actionType` default `2` is "Event" (Discrete), not movement. Set it to `0` (Movement) for a player stick.
- **`setHandleMaterial` has no null-guard** — calling before the view loads throws; guard on `onViewLoadedEvent`.
