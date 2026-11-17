<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# UIKit 4.0 (Lens Studio 5.25+) — working contract

Current for **UIKit 4.0.0** with InteractionKit 4.0.0, Motion 4.0.0 and Icons 4.0.0.
On an older line (`SpectaclesUIKit` 2.x / 3.x) follow `specs-package-renames` and do
not apply this file.

All UIKit imports start with `UIKit.lspkg/Scripts/`.

## Rules

1. **Layout = Flex/Grid, never absolute.** `FlexLayout` / `GridLayout` on the container and a
   `FlexItem` / `GridItem` on every managed child; place with `justifyContent`, `alignItems`,
   `alignSelf`, `gap`. `localPosition` is only for a small `+Z` depth offset.
2. **Depth-separate stacked surfaces.** Give every screen root a Canvas
   (`new CanvasController(root).ensure(panelSize)`) and set one absolute `+Z` (~0.05–0.1 cm) on the
   node that begins each stacked coplanar layer. Flex/Grid keep Z: set it once, not per nesting
   level. Without it, transparent surfaces z-fight into a checkerboard.
3. **Initialization.** Element widgets and visuals auto-initialize in `OnStart`. Call
   `initialize()` yourself to build in the same frame; wire the widget's events right after
   `initialize()`, never from a deferred `UpdateEvent`. Call `setVariant` / `setThemeOverride`
   **before** `initialize()`.
4. **Frame is self-initializing and async**: set `innerSize` and read generated internals in
   `frame.onInitialized`, not right after `createComponent`. Keep host transforms at scale 1.
5. **Text size is a font number, not cm**: `ElementContent.textSize` ~28–48 (default 48).
   Standalone labels need an explicit `sizeOverride`.
6. **Cross-axis fill needs `alignItems: Stretch`**, or the child collapses to scale 0. Call
   `refreshChildren()` after adding rows. A `TopLeft` ScrollWindow's content column sets
   `horizontalAlignment: Left` + `verticalAlignment: Top` and `width = windowSize.x`.
7. **Hide a panel by toggling one host** that carries both the backing and the content.
8. **Children inherit the parent layer**: create them with
   `createChildSceneObjectWithParentLayer(name, parent)`, not raw `createSceneObject`.
9. **One theme, System 3.0** (`"System3"`). Button styles: `Primary`, `Secondary`, `Ghost`,
   `Prism`, `PrismGhost`; shapes: `Rectangle`, `Capsule`, `Round`.
10. **Icons** only from `/icon-selector` or a text glyph; never a hand-typed `requireAsset` path,
    never `requireAsset` at module top level.

## Modules

| Need | Component | Module after `UIKit.lspkg/Scripts/` |
|---|---|---|
| Button / toggle | `Button` (`setVariant({theme, shape, style})`) | `Components/Button/Button` |
| Exclusive set | `ToggleGroup` + `Button` / `RadioButton` / `Checkbox` | `Components/Toggle/ToggleGroup` |
| On/off | `Switch` | `Components/Switch/Switch` |
| Value | `Slider`, `ColorSlider`, `ConfirmationSlider` | `Components/Slider/...` |
| Text entry | `TextInputField`, `TextInputArea`, `VoiceInputButton` | `Components/TextInputField/TextInputField`, ... |
| Choice / date | `Dropdown`, `NumberPicker`, `Calendar`, `DatePicker` | `Components/...` |
| Progress | `ProgressBar`, `Spinner` | `Components/...` |
| Window / backing | `Frame` | `Components/Frame/Frame` |
| Light surface | `RoundedRectangle` (`size` is a `vec2`, `cornerRadius`; tint via material) | `Visuals/RoundedRectangle/RoundedRectangle` |
| Layout | `FlexLayout`, `FlexItem`, `GridLayout`, `GridItem` | `Components/Layout2D/Flex/...`, `Components/Layout2D/Grid/...` |
| Scrolling | `ScrollWindow` (`contentOrigin` before `initialize()`), `ScrollBar` (package root) | `Components/ScrollWindow/ScrollWindow`, `ScrollBar` |
| Widget content | `addContentToElement`, `ElementContent`; `Ranking` enum from `TextStylePresets` | `Components/Content/ElementContentFactory`, `Components/TextStylePresets/TextStylePresets` |
| Theme | `ThemeService`, `System3`, theme colors | `Themes/ThemeService`, `Themes/System-3.0/System3`, `Themes/System-3.0/Colors` |
| Fades | `VisibilityGroup` | `Utility/VisibilityGroup` |
| Frame button sizing | `FRAME_BUTTON_SETTINGS` (`buttonSize`, `iconSize`, `offset`) | `Components/Frame/FrameButtonSettings` |

There is no dialog component: compose a scrim (`RoundedRectangle`) plus a `Frame` floated `+Z`,
and set the controls behind it to `inactive`.

## Deprecated and removed

| Do not use | Use |
|---|---|
| `RectangleButton`, `CapsuleButton`, `RoundButton` (deprecated) | `Button` with `shape: "Rectangle" / "Capsule" / "Round"` |
| `BackPlate` (deprecated) | `Frame` for panels, `RoundedRectangle` for light surfaces |
| `Frame.border`, `Frame.onlyInteractOnBorder`, `Frame.smoothFollow` (deprecated) | `Frame.margin`, `Frame.onlyInteractOnMargin`, `setUseFollow(true)` |
| `Components/Layout/*` (removed) | `Components/Layout2D/` Flex or Grid |
| System 2.0 theme, `_styleSystem2` / `_shapeSystem2` (removed) | System 3.0, `setVariant({shape, style})` |
| `Frame.appearance`, `FrameAppearance`, `FRAME_BUTTON_SETTINGS_BY_APPEARANCE` (removed) | One frame size; `FRAME_BUTTON_SETTINGS` |
| `Frame.roundedRectangle` (removed) | `frame.cornerRadius`, or `frame.frameVisual` (`cornerRadius`, `getRenderOrder()`, `getButtonAnchor(...)`) |

## Examples

```ts
import {Button} from "UIKit.lspkg/Scripts/Components/Button/Button"
import {addContentToElement} from "UIKit.lspkg/Scripts/Components/Content/ElementContentFactory"
import {createChildSceneObjectWithParentLayer} from "UIKit.lspkg/Scripts/Utility/SceneUtilities"

function createContinueButton(parent: SceneObject, onTrigger: () => void): Button {
  const object = createChildSceneObjectWithParentLayer("ContinueButton", parent)
  const button = object.createComponent(Button.getTypeName()) as Button
  button.setVariant({theme: "System3", shape: "Rectangle", style: "Primary"})
  button.size = new vec3(8, 3, 1)
  button.initialize()
  addContentToElement(object, {text: "Continue"})
  button.onTriggerUp.add(onTrigger)
  return button
}
```

```ts
import {FlexLayout} from "UIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexLayout"
import {FlexItem} from "UIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexItem"
import {FlexDirection, FlexJustify, FlexAlign} from "UIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import {createChildSceneObjectWithParentLayer} from "UIKit.lspkg/Scripts/Utility/SceneUtilities"

// `root` is a scene-authored host that carries the panel backing.
function layoutPanel(root: SceneObject, w: number, h: number) {
  const col = root.createComponent(FlexLayout.getTypeName()) as FlexLayout
  col.direction = FlexDirection.Column
  col.width = w; col.height = h
  col.justifyContent = FlexJustify.Start
  col.alignItems = FlexAlign.Stretch
  col.rowGap = 1

  const header = createChildSceneObjectWithParentLayer("Header", root)
  const hItem = header.createComponent(FlexItem.getTypeName()) as FlexItem
  hItem.overrideHeight = 5; hItem.flexShrink = 0
  const hRow = header.createComponent(FlexLayout.getTypeName()) as FlexLayout
  hRow.direction = FlexDirection.Row
  hRow.justifyContent = FlexJustify.SpaceBetween
  hRow.alignItems = FlexAlign.Center

  const body = createChildSceneObjectWithParentLayer("Body", root)
  const bItem = body.createComponent(FlexItem.getTypeName()) as FlexItem
  bItem.flexGrow = 1

  col.refreshChildren()
}
```

```ts
import {ScrollWindow} from "UIKit.lspkg/Scripts/Components/ScrollWindow/ScrollWindow"

function createScrollWindow(scrollObject: SceneObject, contentObject: SceneObject, contentHeight: number) {
  const scroll = scrollObject.createComponent(ScrollWindow.getTypeName()) as ScrollWindow
  scroll.contentOrigin = "TopLeft"          // init-only
  scroll.windowSize = new vec2(22, 18)
  scroll.initialize()
  scroll.addObject(contentObject)
  scroll.scrollDimensions = new vec2(22, contentHeight)
  return scroll
}
```

Inside Flex/Grid, put a ScrollWindow under a plain wrapper that owns the FlexItem/GridItem.
