<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# SpectaclesUIKit Gotchas

Hard-earned lessons from building 8 sample UIs. Each one is a real bug we hit and the workaround that made it work. **Read this before writing any UIKit code** — most of these will silently waste hours.

---

## Initialization order

### Frame's `innerSize` / `contentTransform` are unsafe pre-init

Frame initializes in `OnStartEvent`. If you set `frame.innerSize = ...` immediately after `createComponent`, you get `TypeError: Cannot set property 'size' of undefined` (the internal `roundedRectangle` doesn't exist yet). Same for reading `frame.contentTransform` — it's `undefined`.

**Fix:** wrap content creation in `frame.onInitialized.add(() => { ... })`. `onInitialized` is a ReplayEvent so it's safe to subscribe after init fires too.

```ts
const frame = this.sceneObject.createComponent(Frame.getTypeName()) as Frame
frame.autoShowHide = false
frame.autoScaleContent = false       // CRITICAL — see below

frame.onInitialized.add(() => {
  frame.innerSize = new vec2(40, 24)
  frame.padding = new vec2(2, 2)
  this.buildContent(frame.contentTransform.getSceneObject())
})
```

**Related — starting a Frame-bearing panel hidden:** because `initialize()` is bound to `OnStartEvent`, never disable the host SceneObject synchronously in `onAwake`/`buildUI` — a disabled object never fires `OnStartEvent`, so the Frame never initializes and the panel can never be shown. The `enabled = false` must be the last line *inside* `onInitialized`. See `SKILL.md` gotcha G3.

### Element's `interactable` is undefined until init

`btn.interactable.onTriggerStart.add(...)` throws `TypeError: Cannot read property 'onTriggerStart' of undefined` because `interactable` is created in OnStart.

**Fix:** subscribe via Element's own events: `btn.onTriggerUp.add(callback)`. Same for `onTriggerDown`, `onHoverEnter`, `onHoverExit`. These work because Element exposes them as ReplayEvent-like proxies.

---

## Frame visual behavior

### Frame is invisible until hovered

`Frame.autoShowHide` defaults to `true` — the Frame fades on hover-out. You'll see content but no rounded rectangle background.

**Fix:** `frame.autoShowHide = false` immediately after `createComponent` (before init is fine for this one — it's a plain boolean).

### Frame mangles cm units

`Frame.autoScaleContent` defaults to `true`. Frame scales `contentTransform` based on `innerSize / originalInnerSize`. This breaks any cm-based FlexLayout living inside contentTransform — your perfectly-sized 30cm column becomes 23cm or 37cm depending on Frame's scaling factor.

**Fix:** `frame.autoScaleContent = false` immediately after `createComponent`.

### Frame shows corner-resize handles by default

`Frame._allowScaling` defaults to `true`, so every Frame ships with corner handles that let the user scale the window. For static UIs (HUDs, docks, cards, storefronts, settings) that's a footgun — the user can grab a corner and drag your panel into a weird aspect ratio. The public setter `frame.allowScaling = false` was missing in early UIKit revisions and an older comment in this skill claimed it didn't exist; it does.

**Fix:** `frame.allowScaling = false` immediately after `createComponent`, alongside `autoShowHide = false` and `autoScaleContent = false`. Only leave it on when the panel is genuinely a resizable window (see `references/ui-resizable-examples/`).

---

## Slider / Switch visual jank-on-spawn

### Problem

`Slider` and `Switch` (extends `Slider`) compute their fill rectangle and knob position **once** in `initialize()`. If you set `slider.size` AFTER init, the inherited `VisualElement.size` setter updates the track visual but does NOT call `updateFillSize()` / `updateKnobPositionFromValue()`. Result: knob and fill are positioned for the original (default) size, and the slider looks wrong until the user drags.

This is a real upstream bug worth filing.

### Fix

Set `slider.size = new vec3(W, H, 1)` BEFORE `OnStart` fires for the slider — i.e., immediately after `createComponent`. The slider initializes with that size and the visuals are correct on first frame.

```ts
const slider = so.createComponent(Slider.getTypeName()) as Slider
slider.size = new vec3(SLIDER_WIDTH, SLIDER_HEIGHT, 1)   // BEFORE init
slider.currentValue = 0.6                                // also fine pre-init
so.createComponent(FlexItem.getTypeName())
```

Don't rely on `FlexItem` to drive the slider's width via the ItemHandlerRegistry — it will set `comp.width` post-init, which triggers the bug. Instead size the slider explicitly to match what the layout would have given it.

### Reacting to a Switch toggle: `onFinished`, not `onStateChanged` (compile trap → TS2345)

**Symptom:** Wiring a Switch's on/off handler fails to compile, repeatedly:

```
error TS2345: Argument of type '(on: boolean) => void' is not assignable to
parameter of type 'callback<StateName>'.
```

**Cause:** `onStateChanged` *sounds* like the toggle callback, but it's the event `Switch` inherits from `Element`, typed `PublicApi<StateName>` — it fires for every **visual** state (hovered, triggered, toggledDefault, …) and hands you a `StateName` enum, not a boolean. A `(on: boolean) => …` callback doesn't match, hence TS2345.

**Fix:** subscribe to **`onFinished`**, which `Switch` overrides to `PublicApi<boolean>` (fires when the toggle settles, with the new state):

```ts
sw.isOn = initial                                  // read/set state
sw.onFinished.add((on: boolean) => { /* … */ })    // ✅ react to the toggle (boolean)
// sw.onStateChanged.add((on: boolean) => …)       // ❌ TS2345 — StateName, not boolean
```

(This is the compile-time event-selection fix only. It does not address Switch *visual* placement/rendering inside a tight flex row — that's a separate, framework-level concern.)

---

## GridLayout's implicit rows collapse

### Problem

`GridLayout.autoRows` defaults to `"1fr"`. If your grid has `height = -1` (auto-size to content), `1fr` of "auto" evaluates to **zero height** for the implicit row. Items auto-placed into that implicit row (the bottom row of a 3-col × 2-row grid where you only declared `templateRows = "auto"`) collapse to 0 height — icons disappear, labels overlap row 1.

### Fix

```ts
grid.templateRows = "auto"
grid.autoRows = "auto"        // NOT "1fr"
```

---

## FlexLayout child discovery

### Children stack at the origin (or overlap) — you forgot `layout.addItems([...])`

**Symptom:** Every item in a row/grid renders on top of the others at the container's origin — a 4-card storefront shows only the last card; a card's two labels superimpose into garbage like `"Sel60ted"` ("Selected" + price "60" stacked). Compiles clean, no error.

**Cause:** Creating a `FlexItem` / `GridItem` component on a child is **necessary but not always sufficient.** The layout positions a child only once it is in the layout's managed-children list. `FlexLayout` *sometimes* auto-discovers FlexItem children — but only when they're created **synchronously, in child order, before the layout's first pass.** `GridLayout` does **not** reliably auto-discover — it needs the items registered explicitly. And anything built lazily **inside `frame.onInitialized`** (storefronts, settings sheets, detail cards) has already missed the synchronous discovery window. Unregistered children never get a slot, so they all sit at the container origin.

**Fix — always register explicitly. Don't rely on auto-discovery.** Collect the `FlexItem`/`GridItem` instances and call `addItems` once the children exist:

```ts
// GridLayout — REQUIRED, or the cards stack at the origin:
const items: GridItem[] = []
for (const data of myData) {
  const card = global.scene.createSceneObject("Card")
  card.setParent(gridParent)
  const item = card.createComponent(GridItem.getTypeName()) as GridItem
  item.overrideWidth = cardW; item.overrideHeight = cardH
  items.push(item)
  this.fillCard(card, data)
}
grid.addItems(items)                       // ← the line whose absence stacks every card

// A nested column INSIDE a card (status + price as separate rows) — same rule:
const nameItem  = nameSO.createComponent(FlexItem.getTypeName()) as FlexItem
const priceItem = priceSO.createComponent(FlexItem.getTypeName()) as FlexItem
stack.addItems([nameItem, priceItem])      // ← without this, name + price overlap at center
```

The skill's `flexChild` helper already calls `parentFlexLayout.addItems([flexItem])` for you — but hand-rolled rows/grids (and especially `GridLayout` and anything built in `onInitialized`) must call it themselves. The board grid in a working build does; the storefront grid that stacked did not. **Treat `addItems` as mandatory for every layout container.**

### `FlexLayout` is a Component, not a SceneObject — children parent to the host

`content.createComponent(FlexLayout.getTypeName())` returns a `FlexLayout` *component*. Children of the layout parent to `content` (the **SceneObject** that owns the FlexLayout), never to the FlexLayout return value. The layout walks its host's children — that's the entire flexbox model.

The trap is variable naming. It's natural to write:

```ts
const row = content.createComponent(FlexLayout.getTypeName()) as FlexLayout   // ← row is FlexLayout
row.direction = FlexDirection.Row
// ...
this.addStatCell(row, ICON_SHIELD, ...)    // ❌ helper expects SceneObject parent
                                            //    → TS2345: 'FlexLayout' is not assignable to 'SceneObject'
```

`row` reads like a SceneObject because it represents the visual row. It isn't — it's the layout *driver* sitting on `content`. The TypeScript error is loud (`'FlexLayout' is missing the following properties from type 'SceneObject': getComponent, getComponents, createComponent, getComponentInAncestors, and 27 more`), but it lands wherever the FlexLayout variable gets passed to a function — often dozens of lines from the assignment.

### Fix

Pass the SceneObject (`content`), not the FlexLayout (`row`):

```ts
const row = content.createComponent(FlexLayout.getTypeName()) as FlexLayout
// ...
this.addStatCell(content, ICON_SHIELD, ...)   // ✅ content is the SceneObject that owns row
this.addStatCell(content, ICON_BOLT,   ...)
```

Or rename the FlexLayout component to make the type obvious and reserve `row` / `col` for the SceneObject:

```ts
const row = global.scene.createSceneObject("StatRow")        // SceneObject
row.setParent(content)
const rowFlex = row.createComponent(FlexLayout.getTypeName()) as FlexLayout   // Component
rowFlex.direction = FlexDirection.Row
this.addStatCell(row, ...)                                   // ✅ row is a SceneObject
```

The skeleton patterns in `patterns.md` follow the second convention: SceneObjects are `row` / `col` / `content` / `inner`; FlexLayout components are `flex` / `f` / `stack` / `rowFlex`. Anything you `setParent(...)` or pass to a `(parent: SceneObject, ...)` helper must be the SceneObject — not the FlexLayout return value.

### Disabled children stay out of layout

`FlexLayout.discoverChildren()` skips children with `enabled = false`. It only re-runs `discoverChildren` when the child *count* changes — not when an existing child's `enabled` flag flips.

Consequence: if you have 3 panes A/B/C all alive in the hierarchy and toggle `A.enabled = false; B.enabled = true`, the column FlexLayout keeps its old layout (which positioned only A). B is now active but never positioned → it ends up at SceneObject local (0,0), overlapping the rest of your UI.

### Fix

For tab-style UIs: **destroy and recreate** the active pane SceneObject on every tab switch. Destroying changes the child count, which triggers `FlexLayout`'s UpdateEvent-based `checkForChildChanges` → it re-discovers and re-layouts.

```ts
private showTab(index: number) {
  if (this.currentPane) {
    this.currentPane.destroy()    // count -1 → triggers rediscover
    this.currentPane = null
  }
  const pane = global.scene.createSceneObject(`Pane-${index}`)  // count +1 → rediscover
  pane.setParent(this.contentHost)
  // ... build content
  this.currentPane = pane
}
```

### FlexLayout content overflows upward in column direction

A nested FlexLayout with `height = -1` (auto) might end up allocated a smaller-than-intrinsic height by its parent. Default `verticalAlignment = Center` causes the overflow to extend equally in BOTH directions — including UPWARD, over the previous sibling.

### Fix

```ts
flex.verticalAlignment = ContentVerticalAlignment.Top    // import from LayoutTypes
```

Now overflow only extends downward, and you'll see the first row clipped at the bottom rather than overlapping the row above. Then bump the panel height or trim content.

### Flex enum drift

SpectaclesUIKit's `FlexJustify` / `FlexAlign` / `FlexAlignSelf` enums look like CSS keywords but are *not* CSS keywords, and they don't interchange. Two recurring TS errors:

1. **No CSS prefixes (TS2339).** Members are bare: `Start`, `Center`, `End`, `Stretch`, `SpaceBetween`. Not `FlexStart` / `FlexEnd` / `flex-start`. Writing `FlexJustify.FlexStart` → `Property 'FlexStart' does not exist on type 'typeof FlexJustify'`.

2. **Container enum ≠ item enum (TS2322).** `FlexLayout.alignItems` takes `FlexAlign`. `FlexItem.alignSelf` takes `FlexAlignSelf`. The member names overlap (`Start`, `Center`, `End`, `Stretch`) but TypeScript treats them as distinct string-enum types and will not coerce. Writing `item.alignSelf = FlexAlign.Stretch` → `Type 'FlexAlign.Stretch' is not assignable to type 'FlexAlignSelf'`.

Reference table (verify against this before writing any FlexLayout code):

| Enum | Used on | Members |
|---|---|---|
| `FlexJustify` | `FlexLayout.justifyContent` | `Start, Center, End, SpaceBetween, SpaceAround, SpaceEvenly` |
| `FlexAlign` | `FlexLayout.alignItems` | `Start, Center, End, Stretch` |
| `FlexAlignSelf` | `FlexItem.alignSelf` | `Auto, Start, Center, End, Stretch` |
| `FlexAlignContent` | `FlexLayout.alignContent` | `Start, Center, End, Stretch, SpaceBetween, SpaceAround` |

Import line for any module that uses `FlexItem.alignSelf`:

```ts
import {FlexAlign, FlexAlignSelf, FlexDirection, FlexJustify}
  from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
```

Skip `FlexAlignSelf` from the import line whenever you write any `item.alignSelf = …`, and the compile errors arrive at scale (every `FlexItem` row in the file). Treat the missing-import as the same bug as the wrong-enum — both surface as `TS2322`.

---

## Text rendering and alignment

### Centered text appears left-aligned

If you set `text.horizontalAlignment = HorizontalAlignment.Center` and the text still hugs the left edge, the culprit is `horizontalOverflow`. The default behavior wraps text within `layoutRect`. If `layoutRect` is narrow (the kit's `TextHandler.apply` sets it from FlexItem-allocated width), wrapping packs text starting at rect.left.

### Fix

Mirror `ElementContent`'s pattern:

```ts
text.horizontalAlignment = HorizontalAlignment.Center
text.verticalAlignment = VerticalAlignment.Center
text.horizontalOverflow = HorizontalOverflow.Overflow    // KEY
text.verticalOverflow = VerticalOverflow.Overflow
text.layoutRect = Rect.create(-0.5, 0.5, -0.5, 0.5)  // small placeholder

const item = so.createComponent(FlexItem.getTypeName()) as FlexItem
item.alignSelf = FlexAlignSelf.Stretch                    // allocates full cell width
```

The cell-width allocation centers the SceneObject; `horizontalOverflow=Overflow` makes the text render at its natural size centered around the rect center; `verticalOverflow=Overflow` prevents vertical truncation.

### Row-direction text is undersized by `alignSelf = Stretch` — neighbors render on top of glyphs

The fix above relies on a property of `alignSelf = Stretch` that only holds in **column-direction** containers: in a column, the cross-axis is horizontal, so Stretch allocates the full row width to the text cell. In a **row-direction** container, the cross-axis is vertical — Stretch allocates the row's full *height* and leaves the main-axis (horizontal) cell at the 1 cm placeholder. FlexLayout's text handler measures `layoutRect`, not the rendered glyphs, so the 1 cm placeholder *is* what the row uses for spacing. Neighbors get positioned 0.8 cm (or whatever `columnGap`) outside that 1 cm slot, but the glyphs overflow that slot by 5-10× and render *underneath* the neighbors. Classic shipping bug: title with a leading and trailing icon in a row, icons appear inside the title text.

```
                  ┌─────────┐
   ┌───┐  ┌─┐     │ "Schrödinger's Cat"  ←  rendered glyphs ~12 cm
   │ ⚛ │  │T│     │  (overflowing the 1 cm rect)
   └───┘  └─┘     └─────────┘
   icon  text     ↑
   2cm   1cm      icon at +2.3 cm sits inside the 12 cm glyph extent → overlaps "dinge"
```

#### Fix — pick one

1. **Drop the row layout.** Use `ElementContent` companion mode (`leadingIcon + text`) for icon+text composition. It measures correctly and centers as a unit. If a trailing icon is desired, put it as a sibling `FlexItem` in the row alongside the ElementContent — then the ElementContent measures itself, and only the trailing icon is a separate cell.

2. **Give the text a real `layoutRect`.** Estimate the rendered width for the longest expected string at the chosen `size`/`weight` (a rough rule of thumb at `size = 62, weight = 700` (Headline XL) is ~0.7 cm per character including kerning). For "Schrödinger's Cat" (~16 chars) that's ~11 cm:

   ```ts
   text.layoutRect = Rect.create(-5.5, 5.5, -1.2, 1.2)   // 11 cm × 2.4 cm
   text.horizontalOverflow = HorizontalOverflow.Overflow      // still safe; rect is the layout slot
   ```

   Then the row container allocates 11 cm for the text cell and positions neighbors outside the glyph extent.

3. **Wrap the text in a FlexItem with explicit main-axis width.** Lets the rect stay at the 1 cm placeholder:

   ```ts
   const textItem = textSO.createComponent(FlexItem.getTypeName()) as FlexItem
   textItem.setBasis(11)   // 11 cm main-axis size — main-axis means horizontal in row direction
   ```

   `FlexItem.setBasis` (or `setFlex` if you want it to grow/shrink) makes the parent allocate that much width regardless of the child's intrinsic measurement.

The row-direction trap is silent — there's no overflow warning, no console log; FlexLayout just lays out the cells per their reported sizes and the glyphs draw on top of whatever's at their world position. Always check row-direction layouts that contain text by previewing — column-direction patterns don't generalize.

### ElementContent in a row with siblings collapses to ~1-glyph width

A near-cousin to the row-direction text bug above, but with `ElementContent` as the culprit. `ElementContent` is a UIKit composite (icon + label + auto-sizing) designed for **full-width single-child** buttons. Drop it inside a `FlexDirection.Row` next to a sibling — a leading icon SceneObject, a trailing icon, a second ElementContent, another Button — and its internal text box collapses to ~1 glyph width. The label still measures correctly (`ec.text` still equals the original string), but the render rect is clipped and FlexLayout uses that clipped rect as the cell size. You see "Tree Lifecycle" render as `T`, "Species" as `S`, "Prev" as a single character.

```
                  ┌─┐
   ┌───┐  ┌─┐    │T│  ←  rendered glyph (just one)
   │ ⚛ │  │T│    │ │      while ec.text === "Tree Lifecycle"
   └───┘  └─┘    └─┘
   icon  icon   collapsed ElementContent — auto-sizer
                clipped its text rect to ~1 glyph
```

The compile passes. The Phase 3c grep passes (no raw `Component.Text` in the main script, no hand-rolled UIKit primitives). The preview screenshot quietly shows a single character.

#### Fix

Default to raw `Component.Text` with an explicit `layoutRect` sized to the longest expected string. See `patterns.md` "Row text" section and the `addRowText(parent, text, role, widthCM)` / `addButtonLabel(parent, text, widthCM, role?)` helpers (both take a `TextRole`, not a raw size). This is what SKILL.md R1 documents.

```ts
// ❌ DO NOT — ElementContent in a multi-child row
const row = global.scene.createSceneObject("TitleRow")
const f = row.createComponent(FlexLayout.getTypeName()) as FlexLayout
f.direction = FlexDirection.Row
this.addIcon(row, leadingIcon, 2.0)            // sibling 1
const ec = titleSO.createComponent(ElementContent.getTypeName()) as ElementContent
ec.text = "Tree Lifecycle"                     // renders as "T"
this.addIcon(row, trailingIcon, 2.0)           // sibling 2

// ✅ DO — raw Text + layoutRect via addRowText
const row = global.scene.createSceneObject("TitleRow")
const f = row.createComponent(FlexLayout.getTypeName()) as FlexLayout
f.direction = FlexDirection.Row
this.addIcon(row, leadingIcon, 2.0)
this.addRowText(row, "Tree Lifecycle", "HeadlineXL", 11)   // role carries size + weight
this.addIcon(row, trailingIcon, 2.0)
```

#### Escape hatch (when you genuinely need ElementContent's composition)

If you really need ElementContent's leadingIcon+text composition (e.g. a balance pill, a single-tile dock chip) AND the row has no other siblings: it works. The auto-sizer doesn't collapse when ElementContent is the sole row child. See `patterns.md` "Centered title with flanking icons → Option B (single-element row only)" and `addBalancePill` in this file. Setting `FlexItem.flexGrow >= 1` on the ElementContent SO plus an explicit row width is a less-tested workaround for the multi-child case — prefer raw Text in those rows; it's simpler and version-stable.

### Multi-line wrap in narrow ElementContent

`ElementContent` sets `text.horizontalOverflow = Wrap` and `verticalOverflow = Truncate`. If the rect is too narrow for your string at the chosen `textSize`, the text wraps one character per line and only the first line shows — so "1,250" displays as "1".

### Fix

Don't use ElementContent for wide-content-narrow-rect cases like a balance pill. Build the row manually with `FlexLayout` + raw `Component.Image` + raw `Component.Text` (with `horizontalOverflow = Overflow`). See `FarmStorefront.ts` for the pattern.

### Top-anchored multi-line `Text` in a hand-positioned vertical stack overflows UPWARD into the row above

**Symptom:** Two adjacent text rows in a hand-positioned card render as glyphs of the lower row visually appearing on the same baseline as the upper row. Real incident (periodic table detail panel, Darmstadtium):

> `"Synthetic. NameUnknownmstadt, Germany."` — the description text `"Synthetic. Named after Darmstadt, Germany."` rendered into the same horizontal band as the category label `"Unknown"` sitting one row above it.

**Cause:** When `Component.Text.verticalAlignment = VerticalAlignment.Top`, the text engine plants the **first line at the top edge of `layoutRect`** and extends additional wrapped lines *downward* — fine for a 1-line label, but when the string wraps to 2+ lines and the rect isn't tall enough, the renderer extends lines **upward past the rect's top edge** to fit the content. In a hand-positioned card with rows like `Symbol +7.5 / Name +3.8 / Category −0.6 / Description −3.8` (Y-centers in cm), a Top-anchored Description with a small rect ends up drawing line 2 at the y position of the Category row, on top of the Category glyphs.

**Why the layout looked fine to the agent that built it:** the bands are non-overlapping *as rectangles* (3.2 cm apart). The overlap only appears at runtime when the actual string is long enough to wrap. Static-position inspection of the scene graph reports PASS.

**Fix (preferred — fully avoid the trap):** Don't hand-position stacked text rows. Use a `FlexLayout` column with one `FlexItem` per row. The layout engine measures each row's actual rendered height and applies `rowGap` — there's no way for row N to overflow into row N−1. This is the canonical pattern for any detail-card / info-panel UI; see `references/patterns.md` → *Detail card / tap-to-open info panel*.

**Fix (if you must hand-position — e.g. high-cardinality grid-cell carve-out):**
1. Set `verticalAlignment = VerticalAlignment.Center` on the multi-line text. Glyphs grow symmetrically around the band center, so any overflow is split top + bottom (visible but no longer collides with the row above).
2. Size the rect to the actual expected wrapped-text height: `layoutRect = Rect.create(left, right, −H/2, +H/2)` where `H ≥ lineHeight × maxExpectedLines + 0.4cm` margin. For a description at `text.size = 39` (Body, ≈ 0.98 cm line height) that wraps to 3 lines, `H ≥ 3.3 cm`.
3. Set `horizontalOverflow = Overflow` and `verticalOverflow = Overflow` so the alignment honors the rect center.
4. Leave at least 0.4 cm of gap between adjacent row centers' nearest edges — `(rowA.y − rowA.h/2) − (rowB.y + rowB.h/2) ≥ 0.4`.

The Center-anchored fix alone is sufficient in 90% of cases. The "hand-position the bands correctly" fix is fragile and re-breaks the moment someone enlarges a font or adds a longer description. **Use FlexColumn unless you have a documented reason not to.**

### `TextStylePresets` is partially broken

- It only sets `text.size`, not `weight`, for Title/Headline/Subheadline tiers (despite the design system specifying Bold for those). Only Callout has `weight: Bold`.
- Its `initialized` flag is declared but never set to `true`, so the `if (this.initialized) updateTextStyle()` check in property setters always fails — meaning post-`onAwake` calls to `preset.ranking = ...` silently do nothing.
- Reverse-enum lookup `Ranking[this._ranking]` doesn't work for string enums, so even the initial onAwake call may fail silently on some rankings.

**Fix:** skip TextStylePresets entirely. Apply the type scale through the skill's own helper, which sets size *and* weight in one place:

```ts
applyTextRole(text, "Title1")   // size 105 + weight 700 from the scale; see patterns.md → Typography
```

`applyTextRole` (defined at module scope — see `patterns.md → Typography`) does the `(text as Text & {weight?: number}).weight` cast for you. The cast is unavoidable because LS's .d.ts hasn't shipped `weight` yet — the kit itself uses `(text as any).weight`.

> Worth knowing — what `TextStylePresets` does internally: on LS 5.16+ it does **not** apply its listed design sizes directly. It runs them through `convert516Size()`, which multiplies by `objektivEmSquare(0.695) × 43.886 / 32 ≈ 0.953` to convert the old 5.15 line-height sizing into the new em-square sizing for the **Objektiv system font**. The skill's type-scale numbers are already in that final em-square space, so you set `text.size` directly — but the calibration is Objektiv-specific, which is exactly why a custom font needs `FONT_SIZE_SCALE` (next gotcha).

### Text size drifts after a font swap (em-square calibration)

**Symptom:** "I set the header to size 105 and it renders huge / tiny." "Body looked right with the default font but blew up after I dropped in a Google font." The number didn't change — the font did.

**Cause:** `Component.Text.size` is the glyph **em-square height**, not cap/glyph height (`em-square cm = size / 43.886`, StudioLib). The type scale (105…38) is calibrated for the **SnapOS system font (Objektiv, em-square ratio ≈ 0.695)**. Every font fills its em square differently, so when the skill bakes a custom theme font onto every label (`t.font = THEME_FONT`), the same `size` value produces a different *visual* height. The numbers are right; the font moved the baseline.

**Fix:** don't re-pick every size. The scale flows through `applyTextRole`, which multiplies one module-scope constant into every size:

```ts
const FONT_SIZE_SCALE = 1.0   // 1.0 = SnapOS system font. With a baked custom font, set to
                              // ≈ 0.695 / <font's em-square ratio> so visual height matches the scale.
```

Pick the value once per theme font:
1. **From the font's metrics**, if known: `FONT_SIZE_SCALE = 0.695 / fontEmRatio` (most UI fonts land ≈ 0.9–1.1).
2. **By measurement**: render one line at `applyTextRole(t, "Title1")`, read `t.getBoundingBox()` height, compare to the system-font reference at the same role, and solve for the ratio.
3. **By eye**: nudge the single constant until a known header looks right — every other label tracks automatically because they all route through `applyTextRole`.

This is the controllability fix: font drift becomes one number, not a hunt through every `text.size` in the file.

### Always `text.depthTest = true` — set it on the Text, never via `getMaterial`/`mainPass`

Forgetting this makes text render OVER other content even when geometrically behind it. World-space text without depthTest is the cause of most "text bleeding through plates" reports.

**Set it directly: `tc.depthTest = true`.** `Component.Text` has **no** `getMaterial()` / `getMaterials()` / `mainPass` — those are `RenderMeshVisual` / `Image` API. Reaching for them on Text is a frequent LLM hallucination. Written plainly it's a clean `TS2339` you'd catch immediately — but the dangerous form is the **cast**:

```ts
const pass = (tc as any).getMaterial(0).mainPass   // ❌ compiles (cast hides it), CRASHES at runtime:
pass.depthTest = true                              //    "getMaterial is not a function"
tc.depthTest = true                                // ✅ the only correct form
```

The `as any` silences the compiler, so `RecompileTypeScriptTool` reports success and the bug only surfaces as a runtime exception. **Never use `as any` to reach a material/pass off a `Component.Text`** — `depthTest` is a direct property of Text (there is no `depthWrite` on Text, by design; the text shader writes coverage, not depth).

### A button/toggle label's leading glyph is clipped/occluded by the button's own face

**Symptom:** A label *on* a Button or toggle renders with its first character(s) chopped — `"Flag: OFF"` shows as `"lag: OFF"`, `"Easy"` loses its `E`. The text is there; its left edge is occluded. In one real build this recurred across the Flag toggle, all three difficulty buttons, and the Sound toggle — each "fixed" by hand with a `+0.02` local-Z nudge, over and over, because the label helper never lifted the label in the first place.

**Cause:** The Button's `RoundedRectangle` visual (the face) has thickness and writes depth (backings have `depthWrite = true`). A `depthTest = true` label sitting at the button's local `z = 0` is **coincident with the face** → the depth test fails along the edges and the face occludes the glyphs. This is *not* the panel-vs-content z-gap (that's the `+0.6` Content child); it's a second, smaller gap needed between a **button face and a label drawn on it.**

**Fix — bake a forward Z-lift into the label helper, once.** Lift the label SceneObject by `CONTENT_Z_OFFSET` (0.08) toward the viewer so it draws in front of the face. Do it in the shared helper so every button label gets it — never as a per-call-site `+0.02` afterthought:

```ts
const so = global.scene.createSceneObject("ButtonLabel")
so.setParent(buttonSO)
so.getTransform().setLocalPosition(new vec3(0, 0, 0.08))   // in FRONT of the button face
// ... createComponent Text, applyTextRole, layoutRect, FlexItem
```

**Critical: a laid-out child's local Z survives the layout pass — so this lift is robust.** `FlexLayout` / `GridLayout` write only **X and Y** on each child (`ItemHandlerRegistry.setLocalXY`: "z preserved"; the no-handler path overwrites `pos.x`/`pos.y` only). A common wrong belief is "the layout reset my Z offset" — it doesn't. If a forward-Z lift *seems* not to take, the problem is almost always **bounds, not Z**: the layout pushed the element past the BackPlate/Frame edge so it's edge-clipped (see next gotcha), or the lift was applied to the wrong SceneObject.

### A control gets edge-clipped against the panel border (bounds, not Z)

**Symptom:** A Switch/Slider/Button at the end of a row is cut off by the panel edge, and pushing it forward in Z does nothing (because the problem isn't depth).

**Cause:** `justifyContent: SpaceBetween` (or too little container padding) positions the last item flush against — or past — the BackPlate/Frame bounds. The control's far edge falls outside the rendered surface and is clipped.

**Fix:** keep interactive controls inside the panel bounds. Add container `paddingRight`/`paddingLeft`, or size the row narrower than the plate, or use `justifyContent: Start`/`Center` with explicit gaps instead of `SpaceBetween` when an edge item would otherwise touch the border. Budget at least the control's half-width of margin between its outer edge and the plate edge.

---

## Lazy-built panels (build-on-first-tap)

Storefronts, settings sheets, and detail cards are often built lazily — `ensureStore()` / `ensureSettings()` creates the `Frame` and its content the first time the user taps the open button. Two timing bugs come straight out of this pattern; both trace to `Frame.initialize()` running on `OnStartEvent` and `frame.onInitialized` firing **after** the synchronous tap handler returns.

### A panel only opens on the *second* tap (the show is clobbered by the onInitialized disable)

**Symptom:** First tap on the gear/store button does nothing visible; a second tap opens the panel. Toggling open→close→open also wastes a tap.

**Cause:** The open handler runs `ensureSettings()` (creates the Frame) then `settingsRoot.enabled = true`. But `ensureSettings`'s `frame.onInitialized` callback — which by gotcha G3 ends with `root.enabled = false` to start hidden — fires *later*, **after** the handler returns, and overwrites the `true` you just set. So the first tap builds + shows + gets re-hidden; the second tap (Frame now already inited) sets `enabled = true` and it sticks.

**Fix — gate the start-hidden disable on a `wantVisible` flag, don't hardcode `false`.** Let the show/hide intent flow through one field that both the tap handler and the init tail read:

```ts
private wantSettingsVisible = false

private showSettings(visible: boolean): void {
  this.wantSettingsVisible = visible
  this.ensureSettings()                       // builds the Frame on first call
  if (this.settingsRoot) this.settingsRoot.enabled = visible   // applies now if already built
}

private ensureSettings(): void {
  if (this.settingsRoot) return
  this.settingsRoot = global.scene.createSceneObject("Settings")
  // ...
  frame.onInitialized.add(() => {
    // ...build content...
    this.settingsRoot!.enabled = this.wantSettingsVisible   // honor intent, not a hardcoded false
  })
}
```

Now the first tap sets `wantSettingsVisible = true`; whether the Frame inits before or after the handler returns, the panel ends up visible. Keep the same flag in sync with the X/close button so open↔close never needs a wasted tap.

---

## Image / Material gotchas

### A solid-color fill renders as the broken-image (missing-texture) placeholder

**Symptom:** A cell/tile you intended as a flat colored rectangle shows the gray mountain/photo "missing texture" glyph instead of the color.

**Cause:** `Component.Image` with an `ImageMaterial` that has **no `baseTex`** renders the missing-texture placeholder — setting only `baseColor` on an empty Image material does **not** produce a solid fill. `ImageMaterialPreset` is built to composite a texture's premultiplied alpha, not to paint a flat color.

**Fix:** for a flat colored surface, use a **UIKit `BackPlate`** (a real rendered surface — set its size; tint via theme/style) rather than a bare `Component.Image`. If you must use an Image, give its material an actual texture (e.g. a 1×1 white PNG) and tint it via `baseColor`/`textureColor` so there's a `baseTex` to sample. Reserve `Component.Image` for icons/thumbnails that genuinely have a texture.

### `Component.Image` is sized by its SceneObject's localScale

`ImageHandler` (the FlexItem adapter for Image) reads `sceneObject.localScale.xy` as the image's measured dimensions. So:

```ts
const img = imgSO.createComponent("Component.Image") as Image
imgSO.getTransform().setLocalScale(new vec3(width, height, 1))   // <-- sizes the image
```

`FlexLayout`'s ImageHandler will then drive `setLocalScale(allocatedW, allocatedH, ...)` to fit it into the cell. Set the scale BEFORE the FlexItem is created so the initial measure is correct.

### Clone `ImageMaterial.mat` per image — never share

Use `ImageMaterialPreset` (loaded via `requireAsset("../Materials/ImageMaterial.mat")`), NOT `UnlitMaterialPreset`. The Image-preset material is premultiplied-alpha-correct for icon PNGs; UnlitMaterial produces dark fringes around transparent edges.

You can't share one material across multiple `Component.Image`s with different textures — setting `mat.mainPass.baseTex` mutates the shared material. Clone first, and set the depth flags so the world-space image respects geometry behind it without occluding things drawn later in the Canvas hierarchy:

```ts
// Module-level (once per file)
const imageMaterial = requireAsset("../Materials/ImageMaterial.mat") as Material

// Per-image
const mat = imageMaterial.clone()
mat.mainPass.baseTex = myTexture
mat.mainPass.depthTest = true            // respects scene depth — ON
mat.mainPass.depthWrite = false          // does NOT write to depth — OFF
img.clearMaterials()
img.addMaterial(mat)
```

**Why `depthWrite = false` for Images and Text:** Images and text live in front of a backing inside the same Canvas. The Canvas sorts by hierarchy DFS, so the *backing* draws first, then the content on top of it. If a content Image writes to depth, its rectangular bounds (including transparent pixels around an icon) punch a "near" value into the depth buffer that occludes anything attempting to draw at the same world Z later in the same frame — a sibling icon, a second text label, even the front face of the backing itself. The user's rule is precise: **backings have depth-write ON (so they participate in scene occlusion); images and text have depth-write OFF (so their alpha doesn't poison the depth buffer for content drawn after them).** The `ImageMaterialPreset` ships with `DepthWrite=false, DepthTest=true` by default — never override `depthWrite` to `true` on Image materials.

**Do NOT take the material as `@input`.** `requireAsset` makes the script self-contained — it works identically whether `/specs-build-ui` is invoked standalone (where the skill creates `ImageMaterial.mat` via `asset-graphql`) or from the `specs-experience-builder` orchestrator (where Phase 3a's bootstrap creates it via VirtualScene `apply`).

---

## Render order — never hand-pick, always use hierarchy

The root `Component.Canvas` runs in `SortingType.Hierarchy` mode (the default), which paints the subtree in **depth-first hierarchy order**: parents first, then children, earlier siblings before later siblings. That's *the* render-order mechanism for UIKit panels. Two corollaries:

1. **Never set `renderOrder = N`** on any UIKit component (`BackPlate.renderOrder`, `Frame.renderOrder`), `Component.RenderMeshVisual`, or the visuals inside Button/Switch/Slider. The setters exist for advanced multi-Canvas overlays, not for fixing z-issues in a single panel. A hand-picked render order silently overrides the Canvas's DFS and produces flicker the instant a sibling is added or its order changes.
2. **Reorder, don't re-prioritize.** If A is currently rendering behind B and you want the opposite, move A *below* B in the SceneObject child list (later in the DFS → painted later → on top). Same shape as CSS painter ordering: the order in the tree decides who paints last.

A small Z offset is still needed between a backing and its content because the backing has ~1 cm thickness — but the offset breaks depth-buffer ties, not render order. See the next section.

---

## Z-fighting

The Frame visual and BackPlate have ~1cm depth. Content placed on the same SceneObject at z=0 sits *inside* the plate and z-fights with the front face. This is a depth-buffer tie, separate from render ordering (which Hierarchy Sort already handles by hierarchy DFS).

### Fix

Always create a `Content` child SceneObject at `localPosition (0, 0, 0.6)` and put your FlexLayout on that:

```ts
const content = global.scene.createSceneObject("Content")
content.setParent(host)
content.getTransform().setLocalPosition(new vec3(0, 0, 0.6))   // forward of plate front
```

Nested elements (icons, text inside cards) inherit this offset.

**Alternative direction:** pushing the *backing* back by `-0.1 cm` produces the same effect — the content stays at z=0 and the BackPlate/Frame sits slightly behind. The skill convention is `+0.6 cm` on the Content child because it composes cleanly when a card nests another card. Pick one direction per panel and stick with it; mixing them inside one tree makes nested z-gaps hard to reason about.

The Z gap exists **in addition to** the Canvas hierarchy ordering — they solve two different problems. Hierarchy DFS decides who paints over whom (the painter's order). The Z offset prevents the depth-test from seeing two surfaces at exactly the same Z and producing flicker. You need both.

---

## Depth flags by surface type

The canonical depth-flag rules (Backings: `depthTest`/`depthWrite` both true; Images: depthTest true, depthWrite **false**; Text: `text.depthTest = true`, no depthWrite knob) live in `SKILL.md → Core mental model → Render-order rules` — that is the authoritative copy.

**Symptom if you get it wrong (depthWrite ON on Images/Text):** icons render fine in isolation, but when two icons sit on a row with a small gap, one icon's transparent alpha region punches a hole through the other once FlexLayout positions them within ~0.5 cm. Or: text labels appear "ghosted" with a hard rectangle outline around their bounding box where the alpha-zero region wrote depth.

---

## Button.style is read-only post-construction

`Button` has protected `_styleSnapOS2` / `_styleSnapOS3` fields but no public setter. You can't change a Button to "Ghost" or "Primary" programmatically without `as any`. So if you want visual hierarchy between two buttons (e.g. Cancel = ghost, Save = filled), you have to either:

1. Make Cancel a plain text label (no Button background) — see SettingsPanel
2. Subclass Button and expose a `setStyle()` method
3. Accept the visual sameness

This is a real kit gap worth filing.

---

## Sizing surfaces by their content

To make a `BackPlate` hug content size, subscribe to `flex.onLayoutComplete`:

```ts
flex.onLayoutComplete.add((result) => {
  backPlate.size = new vec2(result.containerWidth, result.containerHeight)
})
```

For Frame, this isn't necessary — `frame.innerSize` is set explicitly by you and Frame draws the plate at that size.

---

## Companion-mode ElementContent host detection

`ElementContent`'s "companion mode" (where it positions text/icon relative to a sibling VisualElement like Button) requires the sibling to implement a full `ContentHost` interface (`onStateChanged`, `onSizeChanged`, `onInitialized`, `size`, `typeString`, `style`, `normalizedThemeOverride`, `registerManagedChild`). `BackPlate` does NOT implement all of these — so attaching `ElementContent` next to a BackPlate runs in standalone mode using `sizeOverride`, not the BackPlate's size.

If you want icon+text *on* a BackPlate, build the row manually (FlexLayout + Image + Text) — don't try to companion ElementContent off the BackPlate.
