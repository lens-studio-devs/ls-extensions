<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# SpectaclesUIKit Component Cheatsheet

Public API surfaces for every component you'll use. **Read the setter you want here before writing code** — many components have private/protected fields that look like setters but aren't exposed.

All paths are relative to `Cache/TypeScript/Src/Packages/SpectaclesUIKit.lspkg/Scripts/Components/`.

---

## Layout2D

### `FlexLayout` (`Layout2D/Flex/FlexLayout.ts`)

Container component. Children with `FlexItem` are auto-discovered.

| Setter | Type | Notes |
|---|---|---|
| `width` | number | cm, `-1` = auto |
| `height` | number | cm, `-1` = auto |
| `direction` | FlexDirection | `Row`, `RowReverse`, `Column`, `ColumnReverse` |
| `wrap` | FlexWrap | `NoWrap`, `Wrap`, `WrapReverse` |
| `justifyContent` | FlexJustify | `Start`, `Center`, `End`, `SpaceBetween`, `SpaceAround`, `SpaceEvenly` |
| `alignItems` | FlexAlign | `Start`, `Center`, `End`, `Stretch` |
| `alignContent` | FlexAlignContent | cross-axis distribution for wrapped lines |
| `rowGap`, `columnGap`, `gap` | number | cm |
| `paddingTop/Right/Bottom/Left` | number | cm |
| `horizontalAlignment` | ContentHorizontalAlignment | `Left`, `Center`, `Right` |
| `verticalAlignment` | ContentVerticalAlignment | `Top`, `Center`, `Bottom` — set to `Top` to prevent column overflow upward |

Events:
- `onInitialized: PublicApi<void>` (ReplayEvent — safe to subscribe late)
- `onLayoutComplete: PublicApi<FlexLayoutResult>` — fires after layout pass; `{items[], containerWidth, containerHeight}`

Methods: `markDirty()`, `forceLayout()`, `computeContentSize()`, `addItems()`, `removeItems()`.

### `FlexItem` (`Layout2D/Flex/FlexItem.ts`)

| Setter | Type | Notes |
|---|---|---|
| `order` | number | visual ordering |
| `flexGrow`, `flexShrink` | number | |
| `flexBasis` | number | cm; `-1` = intrinsic |
| `alignSelf` | FlexAlignSelf | `Auto`, `Start`, `Center`, `End`, `Stretch` |
| `marginTop/Right/Bottom/Left`, `margin` | number | cm |

Methods: `setFlex(grow, shrink?, basis?)`.

> **`alignSelf` enum trap.** It's `FlexAlignSelf`, not `FlexAlign`. The members overlap (both have `Start, Center, End, Stretch`) but TypeScript will not coerce — `item.alignSelf = FlexAlign.Stretch` fails with `TS2322`. Always import `FlexAlignSelf` alongside `FlexAlign` and write `item.alignSelf = FlexAlignSelf.X`. See `gotchas.md → Flex enum drift`.
> ```ts
> // ✅ Right
> item.alignSelf = FlexAlignSelf.Stretch
> // ❌ Wrong — TS2322: Type 'FlexAlign.Stretch' is not assignable to type 'FlexAlignSelf'.
> item.alignSelf = FlexAlign.Stretch
> ```

### `GridLayout` (`Layout2D/Grid/GridLayout.ts`)

| Setter | Type | Notes |
|---|---|---|
| `width`, `height` | number | cm, `-1` = auto |
| `templateColumns`, `templateRows` | string | `"1fr 2cm auto"`, `"repeat(3, 1fr)"` |
| `autoRows` | string | **defaults to `"1fr"` — set to `"auto"`** when height is auto |
| `autoColumns` | string | |
| `templateAreas` | string | rows separated by `/` |
| `autoFlow` | GridAutoFlow | `Row`, `Column`, `RowDense`, `ColumnDense` |
| `columnGap`, `rowGap` | number | cm |
| `paddingTop/Right/Bottom/Left` | number | cm |
| `justifyItems`, `alignItems` | GridAlign | default per-item alignment |

### `GridItem` (`Layout2D/Grid/GridItem.ts`)

| Setter | Type | Notes |
|---|---|---|
| `autoPlacement` | boolean | false = use explicit gridRow/gridColumn |
| `gridRow`, `gridColumn` | number | 0-indexed |
| `rowSpan`, `columnSpan` | number | >= 1 |
| `gridArea` | string | named area from templateAreas |
| `justifySelf`, `alignSelf` | GridAlign | per-cell override |
| `minWidth`, `maxWidth`, `minHeight`, `maxHeight` | number | cm |

---

## Root container

### `Component.Canvas` (built-in LS)

The required root component for every UI panel in this skill. The Canvas decides how its subtree is sorted for rendering — UIKit panels rely on the default mode.

| Setter | Type | Notes |
|---|---|---|
| `sortingType` | `Canvas.SortingType` | **`Hierarchy` (default) — leave alone.** Renders the SceneObject subtree in depth-first hierarchy order: parents first, then children, earlier siblings before later siblings. The other value, `Depth`, sorts by world-space Z and breaks every pattern in this skill (backings and content draw in arbitrary order). |
| `unitType` | `Canvas.UnitType` | `World`, `Pixels`, `Points`. Defaults work for cm-based world-space UI. |
| `layoutRect` | Rect | Bounds of the canvas in world units. Optional — UIKit components don't read from it. |
| `pivot` | vec2 | Rotation pivot in fractional canvas coords. |

`createComponent("Component.Canvas")` is enough — the defaults already give Hierarchy sort + world units. **No need to set `renderOrder` on anything in the subtree** — the Canvas's DFS pass is the render-order mechanism. Setting per-component `renderOrder` fights the DFS and produces flicker as soon as a sibling is added or reordered.

---

## Visual surfaces

### `Frame` (`Frame/Frame.ts`)

Heavy interactive window. Drag, resize, billboard, close/follow buttons.

| Setter | Type | Notes |
|---|---|---|
| `autoShowHide` | boolean | **set false** to keep visible |
| `autoScaleContent` | boolean | **set false** to keep cm-units intact in contentTransform |
| `innerSize` | vec2 | unsafe pre-init |
| `padding` | vec2 | cm |
| `showCloseButton`, `showFollowButton` | boolean | |
| `following` | boolean (getter) | currently following |
| `appearance` | FrameAppearance | `Large`, `Small` |
| `cutOutCenter` | boolean | hollow center |
| ~~`renderOrder`~~ | number | **DO NOT set.** Canvas Hierarchy Sort owns render order — see BackPlate row below and `SKILL.md → Render-order rules`. |

Methods: `setUseFollow(b)`, `setFollowing(b)`, `setBillboardBufferDegrees(x,y)`.

Getters (unsafe pre-init): `contentTransform`, `closeButton`, `followButton`, `interactionPlane`, `roundedRectangle`, `billboardComponent`.

Default material (`Frame.mat`): **DepthWrite = true, DepthTest = true** — leave alone.

Events: `onInitialized` (ReplayEvent), `onFollowingChange`, `onSnappingComplete`, `onScalingUpdate`.

### `BackPlate` (`BackPlate.ts`)

Lightweight static plate. No interaction or movement.

| Setter | Type | Notes |
|---|---|---|
| `size` | vec2 | cm — usually driven by `flex.onLayoutComplete` |
| `width`, `height` | number | cm |
| `style` | `"default"` \| `"dark"` \| `"simple"` | |
| ~~`renderOrder`~~ | number | **DO NOT set.** Leave at default `0`. Render order is owned by the Canvas Hierarchy Sort pass (DFS over the SceneObject tree). To make A render on top of B, place A *after* B in the hierarchy — never hand-pick a `renderOrder`. The setter is here for multi-Canvas overlays only. |
| `interactionPlaneOffset` | vec3 | |
| `interactionPlanePadding` | vec2 | |

Default material (`RoundedRectangleStroke.mat` / `FragRoundedRectangle.mat`): **DepthWrite = true, DepthTest = true** — leave alone. The backing participates in scene occlusion so anything physically behind it is hidden.

Events: `onSizeChanged: PublicApi<vec3>`.

BackPlate does **not** satisfy ElementContent's `ContentHost` interface — companion-mode positioning won't pick it up.

### `Billboard` (SIK — `SpectaclesInteractionKit.lspkg/Components/Interaction/Billboard/Billboard`)

Make a panel face the user. Add to the same SceneObject as the Frame/BackPlate.

**Exact import — copy verbatim, do NOT shorten the path:**
```typescript
import {Billboard} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Billboard/Billboard"
```

**Common hallucinations (these paths do NOT exist):**
- ~~`SpectaclesInteractionKit.lspkg/Components/Helpers/Billboard`~~
- ~~`SpectaclesInteractionKit.lspkg/Billboard`~~
- ~~`SpectaclesUIKit.lspkg/.../Billboard`~~ (Billboard ships with SIK, not UIKit)

| Setter | Type | Notes |
|---|---|---|
| `xAxisEnabled` | boolean | pitch — default off |
| `yAxisEnabled` | boolean | yaw — default on (the "face user horizontally" case) |
| `zAxisEnabled` | boolean | roll — default off |
| `axisEasing` | vec3 | per-axis ease factor |
| `axisBufferDegrees` | vec3 | dead-zone before re-aiming |

Methods: `setPivot(pivot, interactor)`, `resetPivotPoint()`. Getter: `targetTransform`.

Usage is normally just `obj.createComponent(Billboard.getTypeName())` — defaults are correct for the "panel always faces user" case.

---

## Buttons

### `Button` (`Button/Button.ts`) — extends `BaseButton` → `Element` → `VisualElement`

| Setter | Type | Notes |
|---|---|---|
| `size` | vec3 | cm; Round shape forces y=x |
| `opacity` | number | 0..1 |
| `isOn` | boolean | current toggle state (get/set) — only meaningful after `setIsToggleable(true)` |

`_styleSnapOS2` / `_shapeSnapOS2` etc. are protected — no public setter (kit gap).

Methods: `setIsToggleable(b)`, `toggle(on)` (programmatic flip; logs a warning if not in toggle mode).

**Common hallucinations (do NOT exist on Button):**
- ~~`btn.isToggled`~~ → use `btn.isOn` (get/set the current toggle value)
- ~~`btn.setToggled(true)`~~ → use `btn.isOn = true` or `btn.toggle(true)`
- ~~`btn.toggleable = true`~~ → use `btn.setIsToggleable(true)` (and call it BEFORE `isOn`, otherwise the button isn't a toggle yet)
- ~~`btn.checked` / `btn.selected`~~ → no such property; track selection in your own state and reflect via `isOn` or label color

Toggle setup order: `createComponent(Button) → setIsToggleable(true) → (optional) isOn = initial`. For an exclusive set (radio behavior), use `RadioButton` or manage `isOn` across siblings yourself.

Events (inherited from Element): `onTriggerUp`, `onTriggerDown`, `onHoverEnter`, `onHoverExit`, `onStateChanged`, `onSizeChanged`, `onInitialized`. Use these — NOT `btn.interactable.onTriggerStart` (undefined pre-init).

Variants: `RoundButton`, `CapsuleButton`, `RectangleButton`, `Checkbox`, `RadioButton`.

---

## Inputs

### `Slider` (`Slider/Slider.ts`)

| Setter | Type | Notes |
|---|---|---|
| `size` | vec3 | **set BEFORE init** — fill/knob don't refresh on post-init size change |
| `currentValue` | number | 0..1 |
| `knobSize` | vec2 | cm |
| `segmented` | boolean | |
| `numberOfSegments` | number | >= 2 |
| `knobSpringConfig` | SpringConfig | |
| `trackFillVisual`, `knobVisual` | Visual | replaceable |

Events: `onValueChange`, `onFinished`.

### `Switch` (`Switch/Switch.ts`) — extends Slider

- `isOn: boolean` — get/set the toggle state; `toggle(on: boolean)` sets it in code.
- **React to user toggles via `onFinished: PublicApi<boolean>`** — `sw.onFinished.add((on: boolean) => { ... })`. Switch overrides Slider's `onFinished` to carry the boolean state; it fires when the toggle settles.
- **Do NOT use `onStateChanged` for the on/off value.** That's the inherited Element event, typed `PublicApi<StateName>` — it fires for every *visual* state (hovered, triggered, toggledDefault…), not the boolean. Subscribing to it with a boolean callback is `error TS2345: '(on: boolean) => void' is not assignable to 'callback<StateName>'` (the recurring trap — use `onFinished`).

### `TextInputField` (`TextInputField/TextInputField.ts`) — extends `BaseTextInputComponent`

| Setter | Type | Notes |
|---|---|---|
| `size` | vec3 | cm |
| `text` | string | get/set |
| `textOffset` | vec2 | |

Methods: `setInputType(type)`, `setIconSide(side)`, `setUseIcon(b)`, `setState(name)`.

Events: `onTextChanged: PublicApi<string>`, `onFocusGained`, `onFocusLost`.

---

## Text + Content

### `Component.Text` (built-in LS)

- `text: string`
- `size: number` — the glyph **em-square height** (not cap height): `em-square cm = size / 43.886`. **Don't set this by hand** — call `applyTextRole(t, "Body")` so size + weight come from the type scale and a font swap is corrected by one `FONT_SIZE_SCALE` constant. See `spectacles-spatial-design.md → Typography` and `patterns.md → Typography`.
- `weight: number` — LS 5.16+; cast as `Text & {weight?: number}` (the kit itself casts to `any` because the .d.ts hasn't shipped it yet). Set via the role, not directly.
- `font: Font`
- `depthTest: boolean` — **always set true** for world-space text
- *(no `depthWrite` property)* — by design. The built-in text shader writes color/coverage but never depth. That matches the rule "Images and Text: depth-test ON, depth-write OFF" — text gets it for free; no action needed.
- `horizontalAlignment`: `Left`, `Center`, `Right`
- `verticalAlignment`: `Top`, `Center`, `Bottom`
- `horizontalOverflow`: `Overflow`, `Wrap`, `Shrink` — `Overflow` is the safest default
- `verticalOverflow`: `Overflow`, `Truncate`
- `layoutRect: Rect` — bounding rect in local cm
- `textFill.color: vec4`

### `ElementContent` (`Content/ElementContent.ts`)

Companion to a VisualElement OR standalone with `sizeOverride`.

| Setter | Type | Notes |
|---|---|---|
| `text` | string | |
| `textSize` | number | em-square size; set via `roleSize("Subheadline")` (ElementContent has no `weight` setter) |
| `leadingIcon`, `trailingIcon` | Texture \| null | non-null auto-enables `_useLeadingIcon`/`_useTrailingIcon` |
| `iconLayout` | `"left"` \| `"right"` \| `"top"` \| `"bottom"` | |
| `contentAlignment` | `"left"` \| `"center"` \| `"right"` | |
| `sizeOverride` | vec2 | standalone-mode size |
| `padding`, `paddingTop/Right/Bottom/Left` | number | |
| `spacing` | number | gap between icon and text |
| `autoResize` | boolean | resize parent host |

Useful when companion-mode applies (e.g., sized by sibling Button). For wide-content-narrow-rect cases (balance pills), prefer raw Image + raw Text in a manual FlexLayout — see patterns.md.

### `TextStylePresets` (`TextStylePresets/TextStylePresets.ts`)

Brittle (see gotchas) — **don't use it.** Use the skill's own type scale: `applyTextRole(t, "Title1")` (rationale + block in `patterns.md → Typography`). It applies the same `Ranking`s correctly (size *and* weight) and adds a `FONT_SIZE_SCALE` knob for custom-font drift. For reference, the rankings it mirrors:
- `distance`: `Near` (55cm) / `Far` (110cm)
- `ranking` / role string: `Title1`, `Title2`, `HeadlineXL`, `Headline1`, `Headline2`, `Subheadline`, `Button`, `Callout`, `Body`, `Caption`

Sizes (Far / z=-110): Title1=105, Title2=93, HeadlineXL=62, Headline1=54, Headline2=48, Subheadline=41, Button=39, Callout=39, Body=39, Caption=38. Weights: Bold (700) for Title/Headline/Subheadline/Callout, Medium (500) for Button/Body/Caption. Near (z=-55) ≈ half. Full type scale: `spectacles-spatial-design.md` → Typography.

---

## Toolbar (`Toolbar/Toolbar.ts`)

Programmatic: `toolbar.addItem(config)`. Item types: `BUTTON`, `TEXTFIELD`, `SLIDER`, `TOGGLE`, `SEPARATOR`, `CUSTOM`. Each config interface has callbacks (`onTriggerUp`, `onValueChanged`, etc.).

Inspector mode: attach `ToolbarItemInput` script components as child SceneObjects.

Frame integration: `toolbar.frame = myFrame`, `framePosition: "bottom"|"top"|"left"|"right"`, `frameGap`, `isToolbarInsideFrame`, `fitToFrame`.

---

## Other (less common)

| Component | Purpose | File |
|---|---|---|
| `ScrollWindow` | Scrollable content | `ScrollWindow/ScrollWindow.ts` |
| `Tooltip` | Hover tooltip | `Tooltip.ts` |
| `TextInputArea` | Multi-line input | `TextInputArea/` |
| `ToggleGroup` | Exclusive toggles | `Toggle/ToggleGroup.ts` (@input-driven, awkward programmatic) |
| `Mask3D` | Visual masking | `Utility/Mask3D.ts` |

---

## ItemHandlerRegistry (`Layout2D/ItemHandlerRegistry.ts`)

How FlexItem/GridItem measure children. Priority (descending):

| Priority | Handler | Matches on |
|---|---|---|
| 110 | LayoutContainerHandler | nested FlexLayout/GridLayout |
| 100 | ElementHandler | UIKit Elements (`width`/`height`/`onSizeChanged`) — Button, Switch, Slider, BackPlate, Frame |
| 95 | StandaloneContentHandler | standalone ElementContent (`_text` + `_sizeOverride`) |
| 90 | ShapeHandler | shape components (`_size` vec2 + renderMeshVisual) |
| 70 | TextHandler | `Component.Text` — measures from `layoutRect`, applies sets it to allocated size |
| 60 | ImageHandler | `Component.Image` — measures from `localScale.xy`, applies sets `localScale` |
| 50 | RenderMeshVisualHandler | mesh visuals — measures from mesh AABB × localScale |

Register custom handlers: `ItemHandlerRegistry.register(handler, priority)`.
