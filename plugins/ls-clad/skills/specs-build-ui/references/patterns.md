<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# SpectaclesUIKit Patterns

Copy-paste templates for the recurring shapes that show up in nearly every UI we've built. **Don't reinvent these** — they encode every gotcha discovery we've made.

---

## Typography — the type scale (the ONE knob for text size)

Text size is the #1 source of "this is hard to control" reports. The fix is to **never write a raw size number**. Pick a *role* from the scale and apply it through `applyTextRole`. Size and weight always travel together, the scale lives in exactly one place, and a single `FONT_SIZE_SCALE` corrects every label at once when you swap the theme font.

This is the type-equivalent of a CSS class — the same idea as UIKit's own `TextStylePresets` (`Ranking + Distance → settings`), but without its brittleness (see `gotchas.md → TextStylePresets is partially broken`).

Declare this block once at **module scope** (next to `THEME_FONT`), above the `@component` class:

```ts
// ── Typography: the single source of truth for text size + weight ────────────
//
// `Component.Text.size` is the glyph EM-SQUARE height — NOT cap/glyph height:
//     em-square cm = size / 43.886           (StudioLib.d.ts → Text.size)
// The sizes below are the Snap Specs type scale, calibrated for the SnapOS
// system font (Objektiv, em-square ratio ≈ 0.695) at the default focal plane
// z = -110 cm. Pick a role, never a raw number — that is what makes size
// controllable: change the scale once and every label tracks.
//
// FONT DRIFT: a baked custom theme font (`t.font = THEME_FONT`) renders a
// DIFFERENT visual size for the same number, because each font fills the em
// square differently. That is the #1 "I set the size and it's still wrong".
// Don't re-pick every number — set FONT_SIZE_SCALE once (see gotchas.md →
// "Text size drifts after a font swap").
const FONT_SIZE_SCALE = 1.0   // 1.0 = SnapOS system-font metrics.
                              // Custom font: FONT_SIZE_SCALE ≈ 0.695 / <font em ratio>.

type TextRole =
  | "Title1" | "Title2" | "HeadlineXL" | "Headline1" | "Headline2"
  | "Subheadline" | "Button" | "Callout" | "Body" | "Caption"

// size = em-square @110cm · weight = Snap Specs spec (Bold 700 / Medium 500). Authoritative.
const TYPE_SCALE: Record<TextRole, {size: number; weight: number}> = {
  Title1:      {size: 105, weight: 700},  // Bold
  Title2:      {size: 93,  weight: 700},  // Bold
  HeadlineXL:  {size: 62,  weight: 700},  // Bold
  Headline1:   {size: 54,  weight: 700},  // Bold
  Headline2:   {size: 48,  weight: 700},  // Bold
  Subheadline: {size: 41,  weight: 700},  // Bold
  Button:      {size: 39,  weight: 500},  // Medium
  Callout:     {size: 39,  weight: 700},  // Bold
  Body:        {size: 39,  weight: 500},  // Medium
  Caption:     {size: 38,  weight: 500},  // Medium — floor at 110 cm
}

/** Font-corrected em-square size for a role at a focal distance (cm). */
function roleSize(role: TextRole, distanceCm: number = 110): number {
  return TYPE_SCALE[role].size * FONT_SIZE_SCALE * (distanceCm / 110)
}

/**
 * Apply a type-scale role to a Text — the ONE place size + weight are set.
 * Reads like a CSS class: `applyTextRole(header, "Title1")`.
 */
function applyTextRole(t: Text, role: TextRole, distanceCm: number = 110): void {
  t.size = roleSize(role, distanceCm)
  ;(t as Text & {weight?: number}).weight = TYPE_SCALE[role].weight
}
```

**Usage:**
- Raw `Component.Text` → `applyTextRole(t, "Body")` (sets `size` + `weight`).
- `ElementContent` (no `weight` setter) → `ec.textSize = roleSize("Subheadline")`.
- Closer/farther panels → pass the distance: `applyTextRole(t, "Body", 55)` scales by `distance/110`.

Full scale table + the em-square rationale: `spectacles-spatial-design.md → Typography`.

---

## Skeleton: BackPlate panel

For static panels (settings, status, content browser).

```ts
import {FlexLayout} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexLayout"
import {FlexItem} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexItem"
import {
  FlexAlign, FlexDirection, FlexJustify,
} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import {BackPlate} from "SpectaclesUIKit.lspkg/Scripts/BackPlate"

const PANEL_W = 30
const PAD = 2.0

@component
export class MyPanel extends BaseScriptComponent {
  onAwake() {
    // Canvas at the root — defaults to SortingType.Hierarchy, which paints
    // the subtree in depth-first hierarchy order (parents → children, earlier
    // siblings → later siblings). That hierarchy order IS the render order;
    // never set `renderOrder` on anything inside this subtree.
    this.sceneObject.createComponent("Component.Canvas")

    // BackPlate FIRST so the Hierarchy DFS paints it first (behind content).
    const backPlate = this.sceneObject.createComponent(BackPlate.getTypeName()) as BackPlate

    // Content SceneObject created AFTER the BackPlate so the DFS paints it on top.
    // The +0.6 Z is a depth-buffer tie-breaker (plate has ~1cm thickness) — NOT
    // a render-order knob. Hierarchy ordering already decides paint order.
    const content = global.scene.createSceneObject("Content")
    content.setParent(this.sceneObject)
    content.getTransform().setLocalPosition(new vec3(0, 0, 0.6))

    const flex = content.createComponent(FlexLayout.getTypeName()) as FlexLayout
    flex.width = PANEL_W
    flex.height = -1
    flex.direction = FlexDirection.Column
    flex.alignItems = FlexAlign.Stretch
    flex.rowGap = 1.6
    flex.paddingTop = PAD
    flex.paddingBottom = PAD
    flex.paddingLeft = PAD
    flex.paddingRight = PAD

    // Drive BackPlate size from the FlexLayout result so the plate hugs content
    flex.onLayoutComplete.add((r) => {
      backPlate.size = new vec2(r.containerWidth, r.containerHeight)
    })

    // ... build children of `content` here
  }
}
```

---

## Skeleton: Frame panel

For movable, billboarded windowed UI.

```ts
import {Frame} from "SpectaclesUIKit.lspkg/Scripts/Components/Frame/Frame"

const PANEL_W = 40
const PANEL_H = 28
const PAD = 2.0

@component
export class MyWindow extends BaseScriptComponent {
  onAwake() {
    // Canvas at the root — sortingType = Hierarchy (default). The DFS over
    // SceneObject children decides render order; no `renderOrder = N` calls.
    this.sceneObject.createComponent("Component.Canvas")
    const frame = this.sceneObject.createComponent(Frame.getTypeName()) as Frame
    frame.autoShowHide = false       // keep visible
    frame.autoScaleContent = false   // keep cm-units inside contentTransform

    frame.onInitialized.add(() => {
      // innerSize, padding, contentTransform are ALL unsafe pre-init
      frame.innerSize = new vec2(PANEL_W, PANEL_H)
      frame.padding = new vec2(PAD, PAD)

      const content = global.scene.createSceneObject("Content")
      content.setParent(frame.contentTransform.getSceneObject())
      content.getTransform().setLocalPosition(new vec3(0, 0, 0.6))

      const flex = content.createComponent(FlexLayout.getTypeName()) as FlexLayout
      flex.width = PANEL_W
      flex.height = PANEL_H
      flex.direction = FlexDirection.Column
      flex.alignItems = FlexAlign.Stretch
      flex.rowGap = 1.6
      flex.paddingTop = PAD; flex.paddingBottom = PAD
      flex.paddingLeft = PAD; flex.paddingRight = PAD

      // ... build children
    })
  }
}
```

---

## Header (bold title)

Raw Text styled through the type scale. `applyTextRole` sets size + weight; skip `TextStylePresets`.

```ts
private addHeader(parent: SceneObject, label: string) {
  const so = global.scene.createSceneObject("Header")
  so.setParent(parent)
  const innerW = PANEL_W - PAD * 2
  const headerH = 4.0

  const t = so.createComponent("Component.Text") as Text
  t.text = label
  t.depthTest = true
  applyTextRole(t, "Title1")             // size 105 + weight 700 from the type scale (z=-110)
  t.horizontalAlignment = HorizontalAlignment.Center
  t.verticalAlignment = VerticalAlignment.Center
  t.horizontalOverflow = HorizontalOverflow.Overflow
  t.verticalOverflow = VerticalOverflow.Overflow
  t.layoutRect = Rect.create(-innerW / 2, innerW / 2, -headerH / 2, headerH / 2)

  const item = so.createComponent(FlexItem.getTypeName()) as FlexItem
  item.marginBottom = 1.4   // breathing room before next row
}
```

---

## Body label (ElementContent — companion or standalone)

```ts
import {ElementContent} from "SpectaclesUIKit.lspkg/Scripts/Components/Content/ElementContent"

private addLabel(parent: SceneObject, label: string, width: number) {
  const so = global.scene.createSceneObject("Label")
  so.setParent(parent)
  const ec = so.createComponent(ElementContent.getTypeName()) as ElementContent
  ec.text = label
  ec.textSize = roleSize("Subheadline")   // ElementContent has no weight setter — size only
  ec.contentAlignment = "left"
  ec.sizeOverride = new vec2(width, 2.4)
  so.createComponent(FlexItem.getTypeName())
}
```

---

## Centered text under an icon (the alignment trick)

This is the canonical fix for "my centered text rendered left-aligned":

```ts
import {FlexAlignSelf} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"

private addCenteredLabel(parent: SceneObject, text: string, role: TextRole) {
  const so = global.scene.createSceneObject("Label")
  so.setParent(parent)
  const t = so.createComponent("Component.Text") as Text
  t.text = text
  t.depthTest = true
  applyTextRole(t, role)
  t.horizontalAlignment = HorizontalAlignment.Center
  t.verticalAlignment = VerticalAlignment.Center
  t.horizontalOverflow = HorizontalOverflow.Overflow   // KEY
  t.verticalOverflow = VerticalOverflow.Overflow
  t.layoutRect = Rect.create(-0.5, 0.5, -0.5, 0.5) // small placeholder

  const item = so.createComponent(FlexItem.getTypeName()) as FlexItem
  item.alignSelf = FlexAlignSelf.Stretch                // allocate full cell width
}
```

`alignSelf = Stretch` works here because the parent is a **column** — Stretch fills the cross-axis (horizontal), which is the cell width. **Do not copy this pattern into a row-direction container** (see next pattern + `gotchas.md → Row-direction text is undersized`).

---

## Centered title with flanking icons (row-direction text sizing)

The column-direction trick above does NOT generalize to a row. In a row, `alignSelf = Stretch` fills the row *height*, not the cell *width* — so a text with a 1×1 cm placeholder rect tells FlexLayout the cell is 1 cm wide, neighbors get positioned 0.8 cm outside that 1 cm slot, and the rendered glyphs draw 5-10 cm past the slot, overlapping the neighbors. Default to Option A below; Option B is only correct when there are no flanking siblings.

**Option A — Raw Text with a real `layoutRect` (default for any row with siblings).** Direct control of `weight`, FlexLayout uses the rect as the cell size, and there's no auto-sizer to collapse:

```ts
private addTitleRowRaw(parent: SceneObject, title: string, longestTitle: string,
                       leadingIcon: Texture, trailingIcon: Texture) {
  const row = global.scene.createSceneObject("TitleRow")
  row.setParent(parent)
  const f = row.createComponent(FlexLayout.getTypeName()) as FlexLayout
  f.direction = FlexDirection.Row
  f.alignItems = FlexAlign.Center
  f.justifyContent = FlexJustify.Center
  f.columnGap = 0.8
  f.width = -1
  f.height = -1
  row.createComponent(FlexItem.getTypeName())

  this.addIcon(row, leadingIcon, 2.0)

  // Size the rect for the *longest* expected title at this role's size/weight.
  // Rule of thumb at "HeadlineXL" (size 62, weight 700): ~0.7 cm per character including kerning.
  const TITLE_W = longestTitle.length * 0.7
  const TITLE_H = 2.4

  const titleSO = global.scene.createSceneObject("Title")
  titleSO.setParent(row)
  const t = titleSO.createComponent("Component.Text") as Text
  t.text = title
  t.depthTest = true
  applyTextRole(t, "HeadlineXL")                  // size 62 + weight 700
  t.horizontalAlignment = HorizontalAlignment.Center
  t.verticalAlignment = VerticalAlignment.Center
  t.horizontalOverflow = HorizontalOverflow.Overflow
  t.verticalOverflow = VerticalOverflow.Overflow
  t.layoutRect = Rect.create(-TITLE_W / 2, TITLE_W / 2, -TITLE_H / 2, TITLE_H / 2)
  titleSO.createComponent(FlexItem.getTypeName())  // FlexLayout uses the rect as the cell size

  this.addIcon(row, trailingIcon, 2.0)
}
```

**Option B — `ElementContent` + sibling icons (single-element rows only, no flanking siblings).** ElementContent measures itself correctly *when nothing competes with it for row width*. If you really want ElementContent's icon+text composition and the row contains nothing else, use this; otherwise stick with Option A. (Historical context: ElementContent in multi-child rows silently collapsed labels to ~1 glyph in the Tree Lifecycle build — see SKILL.md R1.)

```ts
import {ElementContent} from "SpectaclesUIKit.lspkg/Scripts/Components/Content/ElementContent"

private addTitleRowEC(parent: SceneObject, title: string, leadingIcon: Texture) {
  // Use ONLY when the row has no siblings beyond what ElementContent itself composes.
  // For trailing icon + title + leading icon as three separate row cells, use Option A.
  const row = global.scene.createSceneObject("TitleRow")
  row.setParent(parent)
  const f = row.createComponent(FlexLayout.getTypeName()) as FlexLayout
  f.direction = FlexDirection.Row
  f.alignItems = FlexAlign.Center
  f.justifyContent = FlexJustify.Center
  f.width = -1
  f.height = -1
  row.createComponent(FlexItem.getTypeName())

  const titleSO = global.scene.createSceneObject("Title")
  titleSO.setParent(row)
  const ec = titleSO.createComponent(ElementContent.getTypeName()) as ElementContent
  ec.leadingIcon = leadingIcon                  // composed inside ElementContent, NOT a row sibling
  ec.text = title
  ec.textSize = roleSize("HeadlineXL")          // ElementContent: size only (no weight setter)
  ec.contentAlignment = "center"
  titleSO.createComponent(FlexItem.getTypeName())
}
```

**Anti-pattern (DO NOT copy):**

```ts
// ❌ ROW + 1×1 placeholder + alignSelf=Stretch — Stretch fills vertical, not horizontal.
//    FlexLayout thinks title is 1 cm wide; icons get positioned 0.8 cm outside that slot;
//    rendered glyphs overflow ~12 cm and render UNDER the icons. Shipping bug.
const t = titleSO.createComponent("Component.Text") as Text
t.text = "Schrödinger's Cat"
applyTextRole(t, "HeadlineXL")                   // size 62
t.horizontalOverflow = HorizontalOverflow.Overflow
t.layoutRect = Rect.create(-0.5, 0.5, -0.5, 0.5)
const item = titleSO.createComponent(FlexItem.getTypeName()) as FlexItem
item.alignSelf = FlexAlignSelf.Stretch   // ← cross-axis = vertical here. Does nothing for width.
```

```ts
// ❌ ElementContent inside a multi-child row with flanking icons or sibling buttons.
//    Auto-sizer collapses the label rect to ~1 glyph silently — see SKILL.md R1.
//    Use Option A (raw Text + layoutRect) instead.
const row = global.scene.createSceneObject("TitleRow")
const f = row.createComponent(FlexLayout.getTypeName()) as FlexLayout
f.direction = FlexDirection.Row
this.addIcon(row, leadingIcon, 2.0)
const ec = titleSO.createComponent(ElementContent.getTypeName()) as ElementContent
ec.text = "Tree Lifecycle"                    // renders as "T"
this.addIcon(row, trailingIcon, 2.0)
```

---

## Row text (canonical helpers)

`addRowText` and `addButtonLabel` are the reach-for helpers whenever you need text inside a `FlexDirection.Row` that has siblings, or text *inside* a Button face. Both take a **`TextRole`** (not a raw size) and wrap the Option-A pattern above into a tight signature so the row-width arithmetic happens at the call site, where the longest expected string is known.

```ts
private addRowText(parent: SceneObject, text: string, role: TextRole, widthCM: number) {
  const so = global.scene.createSceneObject("RowText")
  so.setParent(parent)
  const t = so.createComponent("Component.Text") as Text
  t.text = text
  t.depthTest = true
  applyTextRole(t, role)                 // size + weight from the scale
  t.horizontalAlignment = HorizontalAlignment.Center
  t.verticalAlignment = VerticalAlignment.Center
  t.horizontalOverflow = HorizontalOverflow.Overflow
  t.verticalOverflow = VerticalOverflow.Overflow
  t.layoutRect = Rect.create(-widthCM / 2, widthCM / 2, -1.2, 1.2)
  so.createComponent(FlexItem.getTypeName())
  return so
}

// Forward Z-lift for a label that sits ON a Button face. The button's RoundedRectangle
// visual has thickness; a depthTest=true label at the button's z=0 z-fights / gets its
// leading glyph occluded by that face. FlexLayout/GridLayout write only X/Y on a child —
// local Z is PRESERVED — so this lift survives the layout pass. See gotchas →
// "Button/toggle label's leading glyph is clipped by the button face."
const BUTTON_LABEL_Z = 0.08   // = CONTENT_Z_OFFSET (content-on-button)

private addButtonLabel(parent: SceneObject, text: string, widthCM: number, role: TextRole = "Button") {
  // For raw labels *inside* a Button face. Pair with addButton (below), which sizes the
  // Button.size.x and passes (sizeXCM − 0.5) here so the label rect fits with 0.25cm padding
  // on each side. Defaults to the "Button" role (size 39, Medium).
  const so = global.scene.createSceneObject("ButtonLabel")
  so.setParent(parent)
  so.getTransform().setLocalPosition(new vec3(0, 0, BUTTON_LABEL_Z))   // render in FRONT of the button face
  const t = so.createComponent("Component.Text") as Text
  t.text = text
  t.depthTest = true
  applyTextRole(t, role)
  t.horizontalAlignment = HorizontalAlignment.Center
  t.verticalAlignment = VerticalAlignment.Center
  t.horizontalOverflow = HorizontalOverflow.Overflow
  t.verticalOverflow = VerticalOverflow.Overflow
  t.layoutRect = Rect.create(-widthCM / 2, widthCM / 2, -1.2, 1.2)
  so.createComponent(FlexItem.getTypeName())
}
```

**Picking `widthCM`.** Use the longest string you expect at the role's size. Rule of thumb at `"Caption"`/`"Body"` (size 38–39, Medium): ~0.5 cm per character. At `"HeadlineXL"` (size 62, Bold): ~0.7 cm/char. Then add 1 cm padding. Examples:
- "Species" (7 chars, `"Caption"`) → `widthCM = 7 * 0.5 + 1 = 4.5 cm`
- "Tree Lifecycle" (14 chars, `"HeadlineXL"`) → `widthCM = 14 * 0.7 + 1 = 10.8 cm`

When in doubt, pass the longest of all values the cell will ever display (e.g. for a stage-name label that cycles through "Seed" → "Sapling" → "Mature", size for "Sapling").

---

## Row with label + control (space-between)

```ts
private makeRow(parent: SceneObject, name: string): SceneObject {
  const row = global.scene.createSceneObject(name)
  row.setParent(parent)
  const f = row.createComponent(FlexLayout.getTypeName()) as FlexLayout
  f.direction = FlexDirection.Row
  f.justifyContent = FlexJustify.SpaceBetween
  f.alignItems = FlexAlign.Center
  f.width = -1
  f.height = 3.0     // fixed row height
  row.createComponent(FlexItem.getTypeName())
  return row
}

private addToggleRow(parent: SceneObject, label: string, initial: boolean,
                     onChange?: (on: boolean) => void) {
  const row = this.makeRow(parent, `Row-${label}`)
  this.addLabel(row, label, 18)

  const switchSO = global.scene.createSceneObject("Switch")
  switchSO.setParent(row)
  const sw = switchSO.createComponent(Switch.getTypeName()) as Switch
  sw.size = new vec3(4, 2, 1)   // BEFORE init
  sw.isOn = initial             // BEFORE init
  // React to the user flipping it: Switch.onFinished is PublicApi<boolean> and fires
  // when the toggle settles. Do NOT use onStateChanged — that's PublicApi<StateName>
  // (visual states), and a boolean callback on it is error TS2345.
  if (onChange) sw.onFinished.add((on: boolean) => onChange(on))
  switchSO.createComponent(FlexItem.getTypeName())
}

private addSliderRow(parent: SceneObject, label: string, initial: number) {
  const row = this.makeRow(parent, `Row-${label}`)
  this.addLabel(row, label, 6)

  const sliderSO = global.scene.createSceneObject("Slider")
  sliderSO.setParent(row)
  const slider = sliderSO.createComponent(Slider.getTypeName()) as Slider
  // Compute width explicitly — don't rely on FlexItem to drive it post-init
  slider.size = new vec3(PANEL_W - PAD*2 - 6 - 1.0, 1.4, 1)
  slider.currentValue = initial
  sliderSO.createComponent(FlexItem.getTypeName())
}
```

---

## Button with text (raw Text label, width-budgeted — default)

```ts
import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"

private addButton(parent: SceneObject, text: string, sizeXCM: number, sizeYCM: number, onClick: () => void) {
  const so = global.scene.createSceneObject(text)
  so.setParent(parent)
  const btn = so.createComponent(Button.getTypeName()) as Button
  btn.size = new vec3(sizeXCM, sizeYCM, 1)         // BEFORE init — same rule as Slider/Switch (see gotchas)
  this.addButtonLabel(so, text, sizeXCM - 0.5)     // label rect = Button.size.x − 0.5cm; "Button" role (39, Medium)
  so.createComponent(FlexItem.getTypeName())

  // Element exposes trigger events directly — DO NOT use btn.interactable.onTriggerStart
  btn.onTriggerUp.add(onClick)
}
```

**Sizing `sizeXCM` and `sizeYCM`.** Per SKILL.md R2 (Button label width budgeting):

| Label characters | Leading icon | Minimum `sizeXCM` | Recommended `sizeYCM` |
|---|---|---|---|
| 4 chars | no icon | `5.5` | `2.4` |
| 4 chars | yes | `7.5` | `2.6` |
| 6 chars | yes | `9.0` | `2.6` |

For a row with multiple buttons competing for width (Prev + Next + indicator), drop the leading icon and use inline glyphs in the label (`< Prev`, `Next >`) so no row child competes with `sizeXCM`. Why this matters: `ElementContent.autoResize = true` used to be the canonical pattern here; it silently truncates labels to the first ~1–3 visible characters when `Button.size.x` is too small, with no compile-time warning. Width-budgeting the label rect makes the failure mode loud (the rect overflows visibly) instead of silent.

## Button (icon-only, single-element ElementContent face)

When the Button's entire face is an icon — dock entries, close X, scrubber chevrons — ElementContent companion mode is fine, because the row has no siblings to collapse the auto-sizer:

```ts
private addIconButton(parent: SceneObject, icon: Texture, sizeCM: number, onClick: () => void) {
  const so = global.scene.createSceneObject("IconButton")
  so.setParent(parent)
  const btn = so.createComponent(Button.getTypeName()) as Button
  btn.size = new vec3(sizeCM, sizeCM, 1)           // BEFORE init
  const ec = so.createComponent(ElementContent.getTypeName()) as ElementContent
  ec.leadingIcon = icon
  so.createComponent(FlexItem.getTypeName())
  btn.onTriggerUp.add(onClick)
}
```

Do not extend this pattern to text Buttons unless the Button face has nothing else (no trailing/leading icon as a row sibling, no second label).

---

## Image with cloned ImageMaterial

Load the material once at module scope via `requireAsset` — never as `@input`. The orchestrator's Phase 3a bootstrap (or `/specs-build-ui`'s standalone Step 8) is responsible for ensuring `Assets/Materials/ImageMaterial.mat` exists at the path; the script just consumes it.

```ts
// Module-level — once per file, above the @component class
const imageMaterial = requireAsset("../Materials/ImageMaterial.mat") as Material

// Inside the component
private addImage(parent: SceneObject, texture: Texture, sizeCM: number) {
  const so = global.scene.createSceneObject("Image")
  so.setParent(parent)
  const img = so.createComponent("Component.Image") as Image

  const mat = imageMaterial.clone()          // CLONE — don't share across textures
  mat.mainPass.baseTex = texture
  mat.mainPass.depthTest = true              // depth-test ON so the image respects geometry behind it
  mat.mainPass.depthWrite = false            // depth-write OFF (ImageMaterialPreset default) — images
                                             // must NOT occlude things behind them or their alpha edges
                                             // punch holes through siblings/backings drawn later in the
                                             // hierarchy. The Canvas hierarchy DFS order handles z-order.
  img.clearMaterials()
  img.addMaterial(mat)

  // ImageHandler reads localScale as size
  so.getTransform().setLocalScale(new vec3(sizeCM, sizeCM, 1))
  so.createComponent(FlexItem.getTypeName())
}
```

**Why `ImageMaterialPreset`, not `UnlitMaterialPreset`:** `ImageMaterialPreset` is configured for premultiplied-alpha compositing, which is what icon PNGs need. `UnlitMaterialPreset` produces dark/halo fringes around transparent icons.

---

## Card with its own BackPlate

For storefront / tile grids where each card should feel like a button surface.

```ts
private makeCard(parent: SceneObject, width: number, height: number) {
  const card = global.scene.createSceneObject("Card")
  card.setParent(parent)
  card.createComponent(GridItem.getTypeName())   // or FlexItem

  const plate = card.createComponent(BackPlate.getTypeName()) as BackPlate
  plate.size = new vec2(width, height)

  // Inner content offset forward to avoid z-fight with the card's plate
  const inner = global.scene.createSceneObject("CardInner")
  inner.setParent(card)
  inner.getTransform().setLocalPosition(new vec3(0, 0, 0.6))

  const stack = inner.createComponent(FlexLayout.getTypeName()) as FlexLayout
  stack.direction = FlexDirection.Column
  stack.alignItems = FlexAlign.Center
  stack.justifyContent = FlexJustify.Center
  stack.rowGap = 0.4
  stack.width = width
  stack.height = height
  stack.paddingTop = 0.8
  stack.paddingBottom = 0.8
  return inner   // put your icon/text/button children here
}
```

---

## Detail card / tap-to-open info panel

For the "tap a tile/item → an info card appears with N labeled rows" shape. Used by element detail panels, character info cards, item inspection modals, settings sheets, etc. **Always use a FlexLayout column** — never hand-position the rows with explicit `layoutRect` Y-bands (see gotchas → *Top-anchored multi-line Text overflows upward* for the failure mode this prevents).

Real-world example shape: Symbol (big) / Name / `Number · Mass` / Category / Description (multi-line, can wrap) / Close button. Six rows, one card. The pattern below scales to any N.

```ts
import {Frame} from "SpectaclesUIKit.lspkg/Scripts/Components/Frame/Frame"
import {FlexLayout} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexLayout"
import {FlexItem} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexItem"
import {FlexAlign, FlexAlignSelf, FlexDirection, FlexJustify}
  from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"

const CARD_W = 30
const CARD_H = 22
const PAD = 1.5

@component
export class ElementDetailPanel extends BaseScriptComponent {
  private symText!: Text
  private nameText!: Text
  private numMassText!: Text
  private categoryText!: Text
  private descText!: Text

  onAwake() {
    this.sceneObject.createComponent("Component.Canvas")   // Hierarchy Sort
    const frame = this.sceneObject.createComponent(Frame.getTypeName()) as Frame
    frame.autoShowHide = false
    frame.autoScaleContent = false

    // Content host pushed forward 0.6cm to avoid z-fight with the Frame
    const content = global.scene.createSceneObject("Content")
    content.setParent(this.sceneObject)
    content.getTransform().setLocalPosition(new vec3(0, 0, 0.6))

    frame.onInitialized.add(() => {
      frame.innerSize = new vec2(CARD_W, CARD_H)
      const col = content.createComponent(FlexLayout.getTypeName()) as FlexLayout
      col.width = CARD_W
      col.height = CARD_H
      col.direction = FlexDirection.Column
      col.alignItems = FlexAlign.Stretch        // rows fill horizontally
      col.justifyContent = FlexJustify.Start    // pack from top
      col.rowGap = 0.6
      col.paddingTop = PAD
      col.paddingBottom = PAD
      col.paddingLeft = PAD
      col.paddingRight = PAD

      // Each helper creates a SceneObject + Component.Text + FlexItem.
      // alignSelf=Stretch is REQUIRED on column rows so the row spans the
      // card width and centered text actually centers (see gotchas →
      // "Centered text appears left-aligned").
      this.symText      = this.addRow(content, "Title1",      3.5)   // Symbol
      this.nameText     = this.addRow(content, "Subheadline", 1.6)   // Name
      this.numMassText  = this.addRow(content, "Caption",     1.4)   // "Number · Mass"
      this.categoryText = this.addRow(content, "Caption",     1.4)   // Category
      this.descText     = this.addRow(content, "Body",        4.0)   // Description (wraps)
      this.descText.horizontalOverflow = HorizontalOverflow.Wrap
      this.descText.verticalOverflow   = VerticalOverflow.Overflow

      // Footer: close button in its own row
      const closeRow = global.scene.createSceneObject("CloseRow")
      closeRow.setParent(content)
      const closeFlex = closeRow.createComponent(FlexItem.getTypeName()) as FlexItem
      closeFlex.alignSelf = FlexAlignSelf.Center
      const closeBtn = closeRow.createComponent(Button.getTypeName()) as Button
      ;(closeBtn as any)._size = new vec3(6, 1.6, 1)
      closeBtn.initialize()
      // ... wire close label + onTriggerUp
    })
  }

  // Public setters — the parent script pushes data in
  setData(sym: string, name: string, num: number, mass: number, category: string, desc: string) {
    if (!this.symText) return   // Frame not initialized yet
    this.symText.text      = sym
    this.nameText.text     = name
    this.numMassText.text  = `${num} · ${mass.toFixed(3)}`
    this.categoryText.text = category
    this.descText.text     = desc
  }

  private addRow(parent: SceneObject, role: TextRole, h: number): Text {
    const so = global.scene.createSceneObject("Row")
    so.setParent(parent)
    const t = so.createComponent("Component.Text") as Text
    t.depthTest = true
    applyTextRole(t, role)   // size + weight from the scale
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center   // NEVER Top for multi-line
    t.horizontalOverflow = HorizontalOverflow.Overflow
    t.verticalOverflow   = VerticalOverflow.Overflow
    t.layoutRect = Rect.create(-0.5, 0.5, -0.5, 0.5)   // 1x1 placeholder
    const item = so.createComponent(FlexItem.getTypeName()) as FlexItem
    item.alignSelf = FlexAlignSelf.Stretch   // span card width — centers actually center
    item.overrideHeight = h
    return t
  }
}
```

**Why this shape is right:**

- **No hand-picked Y positions.** FlexLayout column measures each row's `overrideHeight` and applies `rowGap` between them. There is no way for row N to overflow into row N−1 — the layout engine reserves the slot.
- **`alignSelf = Stretch`** on every column row spans the row across the card's full inner width, so the centered text's tiny `layoutRect` placeholder is centered inside a wide cell. Without Stretch, the text cell collapses and "center alignment" is meaningless.
- **`verticalAlignment = Center`** on the multi-line description means wrap overflow grows symmetrically around the row center, never up into the row above.
- **Setters, not mutation in onAwake.** The card is built once with stored `Text` handles (`symText`, `descText`, etc.). The parent script (the one that knows *which* element was tapped) calls `setData(...)` — keeps the UI module data-agnostic.

**When to deviate:** never, for one composed panel. The grid-cell carve-out in `SKILL.md` ("Never hand-roll" → high-cardinality cells ≥ 30) does NOT apply to the detail card that opens when a cell is tapped. The detail card is always UIKit.

---

## Tabbed content (destroy-and-rebuild pattern)

`FlexLayout` only re-discovers children when child *count* changes. So toggling `enabled` doesn't trigger a relayout. For tab UIs, destroy and recreate the active pane on every tab switch:

```ts
private currentPane: SceneObject | null = null
private contentHost: SceneObject | null = null
private tabBuilders: ((pane: SceneObject) => void)[] = []

private showTab(index: number): void {
  if (!this.contentHost) return

  if (this.currentPane) {
    this.currentPane.destroy()   // count -1 → triggers FlexLayout rediscover
    this.currentPane = null
  }

  const pane = global.scene.createSceneObject(`Pane-${index}`)  // count +1 → rediscover
  pane.setParent(this.contentHost)
  const flex = pane.createComponent(FlexLayout.getTypeName()) as FlexLayout
  flex.direction = FlexDirection.Column
  flex.alignItems = FlexAlign.Stretch
  flex.verticalAlignment = ContentVerticalAlignment.Top   // overflow downward only
  flex.rowGap = 1.2
  flex.width = -1
  flex.height = -1
  const item = pane.createComponent(FlexItem.getTypeName()) as FlexItem
  item.alignSelf = FlexAlignSelf.Stretch
  item.setFlex(1)
  this.tabBuilders[index](pane)
  this.currentPane = pane

  // Toggle button visual states
  for (let i = 0; i < this.tabButtons.length; i++) {
    this.tabButtons[i].isOn = i === index
  }
}
```

Import: `import {ContentVerticalAlignment} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/LayoutTypes"`.

---

## Balance pill (icon + number, custom rather than ElementContent)

ElementContent wraps text by default, so "1,250" in a narrow rect renders as just "1". Build the pill manually:

```ts
private addBalancePill(parent: SceneObject) {
  const pill = global.scene.createSceneObject("Balance")
  pill.setParent(parent)

  const plate = pill.createComponent(BackPlate.getTypeName()) as BackPlate
  plate.size = new vec2(10, 3.2)

  const inner = global.scene.createSceneObject("BalanceInner")
  inner.setParent(pill)
  inner.getTransform().setLocalPosition(new vec3(0, 0, 0.6))

  const row = inner.createComponent(FlexLayout.getTypeName()) as FlexLayout
  row.direction = FlexDirection.Row
  row.alignItems = FlexAlign.Center
  row.justifyContent = FlexJustify.Center
  row.columnGap = 0.6
  row.width = 10
  row.height = 3.2

  // Coin icon — `imageMaterial` from the module-level requireAsset above
  const iconSO = global.scene.createSceneObject("CoinIcon")
  iconSO.setParent(inner)
  const img = iconSO.createComponent("Component.Image") as Image
  const mat = imageMaterial.clone()
  mat.mainPass.baseTex = this.coinIcon
  mat.mainPass.depthTest = true
  mat.mainPass.depthWrite = false   // Images: depthTest ON, depthWrite OFF
  img.clearMaterials(); img.addMaterial(mat)
  iconSO.getTransform().setLocalScale(new vec3(1.8, 1.8, 1))
  iconSO.createComponent(FlexItem.getTypeName())

  // Amount — raw Text with Overflow so it doesn't wrap
  const txtSO = global.scene.createSceneObject("Amount")
  txtSO.setParent(inner)
  const txt = txtSO.createComponent("Component.Text") as Text
  txt.text = this.formatCoins(this.coins)
  txt.depthTest = true
  applyTextRole(txt, "Headline1")        // size 54 + weight 700
  txt.horizontalAlignment = HorizontalAlignment.Left
  txt.verticalAlignment = VerticalAlignment.Center
  txt.horizontalOverflow = HorizontalOverflow.Overflow
  txt.layoutRect = Rect.create(-0.5, 0.5, -1.2, 1.2)
  txtSO.createComponent(FlexItem.getTypeName())

  this.balanceText = txt   // keep ref for live updates
  pill.createComponent(FlexItem.getTypeName())
}
```

---

## Head-following dock

```ts
frame.onInitialized.add(() => {
  // ... innerSize, padding, content
  frame.setUseFollow(true)
  frame.setFollowing(true)
  frame.showFollowButton = false   // hide UI toggle if always-follow
})
```

---

## Sizing recap

| Where | Setter | When |
|---|---|---|
| Frame | `innerSize`, `padding`, `contentTransform` | inside `frame.onInitialized.add(...)` |
| BackPlate | `size` (vec2) | inside `flex.onLayoutComplete.add(...)` for auto-hug, or set explicitly |
| Slider / Switch | `size` (vec3) | BEFORE init — i.e. immediately after `createComponent` |
| Button | `size` (vec3) | anytime (or use ElementContent `autoResize`) |
| Image | `transform.localScale` (vec3) | before FlexItem so initial measure is correct |
| Text | `layoutRect` (Rect) | before FlexItem; TextHandler overrides it on layout |
| FlexLayout | `width`/`height` | anytime; `-1` for auto |
| GridLayout | `width`/`height`/`templateColumns`/`templateRows`/`autoRows`/`autoColumns` | `autoRows = "auto"` when height is auto |

---

## Imports cheat-sheet

```ts
// Layout
import {FlexLayout} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexLayout"
import {FlexItem} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexItem"
import {
  FlexAlign, FlexAlignSelf, FlexDirection, FlexJustify, FlexWrap,
} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import {GridLayout} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Grid/GridLayout"
import {GridItem} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Grid/GridItem"
import {ContentVerticalAlignment, ContentHorizontalAlignment}
  from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/LayoutTypes"

// Surfaces
import {Frame} from "SpectaclesUIKit.lspkg/Scripts/Components/Frame/Frame"
import {BackPlate} from "SpectaclesUIKit.lspkg/Scripts/BackPlate"

// Controls
import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {RoundButton} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RoundButton"
import {Switch} from "SpectaclesUIKit.lspkg/Scripts/Components/Switch/Switch"
import {Slider} from "SpectaclesUIKit.lspkg/Scripts/Components/Slider/Slider"
import {TextInputField} from "SpectaclesUIKit.lspkg/Scripts/Components/TextInputField/TextInputField"

// Content
import {ElementContent} from "SpectaclesUIKit.lspkg/Scripts/Components/Content/ElementContent"

// SIK (if needed)
import {Billboard} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Billboard/Billboard"

// Text size/weight is set through the type scale (see "Typography" at the top of this
// file) — declare TYPE_SCALE + FONT_SIZE_SCALE + applyTextRole at module scope and call
// applyTextRole(t, "Body"). No FontWeight import and no per-file weight cast needed.
type TextWithWeight = Text & {weight?: number}
```

---

## Wiring into the scene (post-script)

After writing the script (resolve MCP tool names per your runtime — see `lens-studio-field-notes` Hard Rule 2):

1. `RecompileTypeScriptTool` → expect `status: "succeeded"`
2. `VirtualScene` with `command: "read"` to inspect existing scene objects
3. `scene-graphql` to create a root SceneObject and add the script:
   ```graphql
   mutation {
     createSceneObject(name: "MyPanel") { id }
     # then setLocalTransform, addComponent, setProperty for inputs
   }
   ```
4. For `@input` fields:
   - Strings: `setProperty(... valueType: STRING, value: "...")`
   - Numbers: `valueType: NUMBER`
   - Single asset refs (Texture, Material): `valueType: REFERENCE, value: "<uuid>"`
   - Asset arrays: set each index — `setProperty(id: "<componentId>", propertyPath: "icons.0", valueType: REFERENCE, value: "<uuid>")`
5. `setEnabled(id: "<sceneObjId>", enabled: true)`
6. `setLocalTransform(id: "<sceneObjId>", position: {x:0, y:0, z:-110})`
7. `RecompileTypeScriptTool` again
8. `RunAndCollectLogsTool` — check `errors` (stack traces) and `prints`. **Compile success ≠ runtime success.**
9. `CapturePanelScreenshotTool` with `pluginId: Snap.Plugin.Gui.PreviewPanel` to share back to the user
