---
name: specs-build-ui
description: Build Specs UI in Lens Studio using SpectaclesUIKit (FlexLayout / GridLayout / Frame / BackPlate / Button / Switch / Slider / TextInputField). Use when the user wants to create a UI panel, status HUD, settings screen, media browser, dock, storefront, or any 2D-ish UI rendered in world space. Generates a TypeScript BaseScriptComponent under Assets/Scripts/ and wires it into the scene.
user-invocable: true
argument-hint: a short description of what to build — for example "a status HUD with a connecting message" or "a settings panel with two toggles and a volume slider"
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Build UI for Specs

> **Are you building a full experience, or just a UI panel?** If the user wants a complete Specs build (meshes + UI + scripts + scene), the canonical entry is the `/lens-studio-router` skill, which then spawns `specs-experience-builder` (a sub-agent). The orchestrator loads `/lens-studio-field-notes` + `/scene-construction` first, runs `/specs-project-init`, generates all assets through `/build-mesh` / `/build-sfx` / `/build-music` / `/icon-selector` / *this skill*, writes scripts, and bootstraps the scene in one atomic apply. Invoking `/specs-build-ui` standalone is only correct when the project is already set up AND the user explicitly wants just a UI module added — e.g. "add a settings panel to my existing scene." A from-scratch full build that starts with `/specs-build-ui` will skip field-notes' Hard Rules and produce a UI module without the surrounding scene the user actually asked for.

This skill builds UI panels for Specs using the **SpectaclesUIKit** package at `Cache/TypeScript/Src/Packages/SpectaclesUIKit.lspkg/`. It generates a TypeScript `BaseScriptComponent` under `Assets/Scripts/`, then wires it into the scene via `scene-graphql` / `asset-graphql`.

The output is **production-ready cm-based UI** that renders in world space, with proper z-fighting handling, typography hierarchy, and event wiring.

## Core mental model

UIKit is **CSS-flexbox / CSS-grid in 3D**. Units are centimeters. The default focal distance for Specs is **z = -110 cm** (~1.1 m). You don't lay out by absolute pixel positions — you compose with `FlexLayout` / `GridLayout` and let the engine measure children.

```
SceneObject (root, at z=-110)
├── Component.Canvas         (required at root, sortingType = Hierarchy — the default)
├── Frame OR BackPlate       (the visual surface; pick one — see below)
└── Content SceneObject      (offset +0.6 cm in Z to avoid z-fighting)
    └── FlexLayout           (your CSS-flex container)
        ├── Header           (raw Text + TextStylePresets OR direct size+weight)
        ├── Row 1            (nested FlexLayout with FlexItem)
        ├── Row 2
        └── ...
```

### Render-order rules — Canvas Hierarchy Sort + DFS, never `renderOrder`

The root `Component.Canvas` runs in **`SortingType.Hierarchy`** mode by default. Under that mode, the engine renders the host SceneObject's subtree in **depth-first hierarchy order**: each parent draws before its children, and earlier siblings draw before later siblings. *Hierarchy position IS render order.* Treat that as the only knob you have:

- **Never set `renderOrder` manually** on any UIKit component (`BackPlate`, `Frame`, button visuals, image components) or on `Component.RenderMeshVisual` underneath them. Hand-picked render orders fight the Canvas's DFS pass and cause flicker the moment a sibling is added or reordered. The `BackPlate.renderOrder` and `Frame.renderOrder` setters exist for advanced cases (multi-canvas overlays) — for normal UI authoring they should stay at their default of `0`. If you find yourself reaching for `renderOrder` to fix a z-issue, fix the *hierarchy order* instead.
- **To make A render on top of B, place A AFTER B in the SceneObject hierarchy** (lower in the child list of their shared parent). To make A render *behind* B, place A earlier. This is the same as CSS `z-index: auto` painter ordering — the order in the DOM/scene tree decides which paints last.
- **A small Z offset is still required** to break depth-buffer ties between the backing and the content drawn on top of it (the BackPlate/Frame body is ~1 cm thick; content sitting at the host's z=0 would z-fight with the plate's front face). Pick one of:
  - **Push content forward** by `+0.6 cm` on a `Content` child SceneObject (the convention this skill uses — see Z-fighting below).
  - **Push the backing back** by `-0.1 cm` (equivalent in effect; rarely needed because UIKit Frame/BackPlate already have their own front-face offset).

  The Z offset and the hierarchy order are independent fixes for two different problems: the offset prevents same-Z depth-buffer fighting; the hierarchy ordering decides who paints over whom when depths agree.

- **Depth flags for the surface vs. the content:**
  - **UI Panel backings (BackPlate / Frame / RoundedRectangle)** — `DepthWrite = true`, `DepthTest = true` (the UIKit defaults — leave them alone). The backing participates in scene occlusion so anything physically behind it is hidden.
  - **`Component.Image` (icons, thumbnails, balance pills)** — `mat.mainPass.depthTest = true`, `mat.mainPass.depthWrite = false`. The `ImageMaterialPreset` ships configured this way; do not override `depthWrite` to `true`. (Why: image rectangles include transparent alpha pixels around the icon — writing them to depth occludes siblings/text drawn after the image in the hierarchy.)
  - **`Component.Text`** — `text.depthTest = true`. Text has no `depthWrite` property; the built-in text shader writes coverage but not depth, which is exactly what's wanted.

## Never hand-roll UIKit primitives

The whole reason `/specs-build-ui` exists is to compose UIKit primitives correctly. If you find yourself drafting one of these patterns, you're re-implementing a UIKit component badly — stop and swap to the primitive.

| You're tempted to write… | Because you want… | Use this instead |
|---|---|---|
| Raw `SceneObject` named `"Backplate"` + `Component.RenderMeshVisual` + unit-cube `RenderMesh` + cloned `SimplePBR` tinted by hand | A flat panel surface | `BackPlate` (static) or `Frame` (movable). They handle depth, rounded edges, lit material, hover/press states. |
| Hand-positioned `setLocalPosition(new vec3(0, 4.0, 0))`, `(0, -5.2, 0)`, … for stacked labels | Header above content above footer | `FlexLayout` column with `rowGap` / `padding*`. Children get `FlexItem`; the layout positions them. No magic numbers. |
| A vertical stack of `Component.Text` rows with hand-picked `layoutRect = Rect.create(L, R, yBottom, yTop)` Y-bands (e.g. Symbol +7.5, Name +3.8, Category −0.6, Description −3.8) inside one card / panel | A tap-to-open detail card with N labeled rows (symbol, name, category, description, …) | `FlexLayout` column with one `FlexItem` per row (`alignSelf = Stretch`, `overrideHeight`); `verticalAlignment = Center` on every multi-line row. The non-overlap is structural — there's no way for row N to bleed into row N−1. See `references/patterns.md` → *Detail card / tap-to-open info panel*. Hand-positioned Y-bands look fine in scene-graph inspection but break the moment description text wraps to a second line (Top-anchored multi-line text overflows upward — `references/gotchas.md` covers the exact failure mode with the `"NameUnknownmstadt"` worked example). |
| `Physics.ColliderComponent` + `Shape.createBoxShape()` + raw `Interactable` + child `Component.Text` for one tappable element | A button | UIKit `Button` + `ElementContent` (label, optional leadingIcon). Collider, Interactable, label, press visual — all wired by the component. |
| A row of `Component.Image` icons with `setLocalPosition` for each | A horizontal icon row | `FlexLayout` row with `columnGap`; each icon in a `FlexItem`. |
| A grid of cards each with its own hand-built backplate + label | A storefront / catalog | `GridLayout` with `GridItem` per card; each card uses `BackPlate` or `Frame` and its own internal `FlexLayout`. See `references/examples/FarmStorefront.ts` and `references/examples/MediaGrid.ts`. |

**The single legitimate carve-out is high-cardinality grid cells (≥ 30).** For a periodic table (118 elements), a 30-day calendar, or a dense product catalog, the per-cell instantiation cost of UIKit `Button` is real — those cells may be raw `RenderMeshVisual` + raw collider + raw text inside a per-cell factory. Strict scope:
- Cells live inside a UIKit `GridLayout` produced by this skill.
- The panel wrapping the grid is still UIKit `Frame` / `BackPlate`.
- Header buttons, footer buttons, settings sheets, **detail panels that open when a cell is tapped**, info popups, dialogs, the close affordance on any of those — all stay UIKit. No exceptions.
- The per-cell factory function MUST be annotated `// per-tile factory — Hard Rule 3 grid-cell carve-out (N = <count>)` so downstream enforcement (the orchestrator's Phase 3c grep) treats it as exempt.

If the surface is "one composed UI panel" — score HUD, settings modal, game-over dialog, element detail card, buy/sell sheet — it's UIKit, full stop. Don't generalize the grid-cell exemption to anything else.

## When to invoke this skill

The triggers are in the frontmatter description. Before generating, load these references in parallel — they are mandatory reading:

- `references/component-cheatsheet.md` — every component's public API + the right setter to use
- `references/gotchas.md` — every footgun we've hit (Slider jank-on-spawn, Frame.autoScaleContent, autoRows="1fr", etc.)
- `references/patterns.md` — copy-paste templates for header, row-with-control, item card, button row, etc.
- `references/helpers.md` — verbatim Layout Composition helper implementations (`obj`/`liftInZ`/`flexColumn`/`flexRow`/`flexChild`/GridLayout)

## Workflow

### 1. Decide on the surface: Frame vs BackPlate vs none

| Surface | When |
|---|---|
| **Frame** | Movable, billboarded, follow-the-user windowed UI. Has close/follow buttons, drag handles, resize. **Always:** `frame.autoShowHide = false`, `frame.autoScaleContent = false`, `frame.allowScaling = false`. Build content inside `frame.onInitialized.add(() => { ... })` — `innerSize` setter and `contentTransform` getter are unsafe before init. Only opt into `allowScaling = true` when the panel is genuinely a resizable window (see `references/ui-resizable-examples/`). |
| **BackPlate** | Static panel (no move/resize). Size driven by content via `flex.onLayoutComplete.add(r => backPlate.size = new vec2(r.containerWidth, r.containerHeight))`. |
| **No backplate** | Heads-up content that overlays world without a card surface (e.g. icon-only dock if Frame isn't desired). |

### 2. Z-fighting

The Frame/BackPlate visual has thickness. Always create a `Content` child SceneObject at `localPosition (0, 0, 0.6)` and put your `FlexLayout` on that — otherwise text and icons z-fight with the surface. The `+0.6` is a Z-gap, not a hand-picked render order; the `Content` SceneObject sits *after* the BackPlate/Frame in the parent's child list, so the Canvas Hierarchy Sort paints it on top regardless of the Z value. This `+0.6` content offset is the skill's convention because it composes cleanly when a card nests another card (each inner `CardInner` adds its own `+0.6` relative to its parent's plate). The equivalent backing-push (`-0.1 cm`) also works — pick one direction per panel; see `references/gotchas.md → Z-fighting`.

### 3. Layout

Use **Layout2D** (`FlexLayout`, `GridLayout`) for new UI. Reach for:

- `FlexLayout` for column or row containers
- `GridLayout` for tabular item grids
- `FlexItem` / `GridItem` per child (required for layout to pick the child up)
- **`layout.addItems([...])` to register those children — mandatory.** Creating the `FlexItem`/`GridItem` is necessary but not sufficient: `GridLayout` (and anything built lazily inside `frame.onInitialized`) will **stack every child at the origin** unless you collect the item components and call `addItems`. The `flexChild` helper does this for you; hand-rolled rows/grids must call it. (gotchas → *Children stack at the origin — you forgot `layout.addItems()`*.)
- `flex.direction`, `alignItems`, `justifyContent`, `rowGap`, `columnGap`, `paddingTop/Right/Bottom/Left` map 1:1 to CSS

### 4. Text

- **Raw `Component.Text` is the default everywhere** — column headers, body labels, prices, row labels, Button labels. Set `depthTest = true`, `horizontalOverflow = Overflow`, and choose `layoutRect` by row direction:
  - **Column-direction parent** (header above content): `layoutRect = Rect.create(-0.5, 0.5, -0.5, 0.5)` (1×1 placeholder) plus `FlexItem.alignSelf = FlexAlignSelf.Stretch`. The column's cross-axis is horizontal, so Stretch allocates full cell width and centered text actually centers. **Enum trap:** `alignSelf` takes its own `FlexAlignSelf` enum — `item.alignSelf = FlexAlign.Stretch` is `TS2322` even though `FlexAlign.Stretch` looks identical. The parent's `alignItems = FlexAlign.Stretch` and the child's `alignSelf = FlexAlignSelf.Stretch` are distinct types; import `FlexAlignSelf` alongside `FlexAlign` whenever a `FlexItem` has an `alignSelf` setter. See `references/gotchas.md → Flex enum drift`.
  - **Row-direction parent** (title with flanking icons, Button label, anything sharing a row with siblings): `layoutRect = Rect.create(-widthCM/2, widthCM/2, -1.2, 1.2)` sized to the longest expected string. In a row, Stretch fills *vertical*, not horizontal — using the column trick collapses the text cell to 1 cm and neighbors render on top of glyphs. Use `addRowText` / `addButtonLabel` from `references/patterns.md` (canonical helpers). `addButtonLabel` additionally lifts the label `+0.08` in local Z (`CONTENT_Z_OFFSET`) so its leading glyph isn't occluded by the button's own face — don't hand-roll a button label without that lift (gotchas → *button/toggle label's leading glyph is clipped*).
- **Size + weight: always `applyTextRole(text, "<Role>")`** — never raw `text.size = N`. The role sets both size and weight from the one type-scale table (see *Type Scale* below + `references/patterns.md → Typography`), so they can't drift apart and a font swap is one-constant correctable. **TextStylePresets** is brittle — its `initialized` flag is never set, so post-`onAwake` changes are silently ignored, and it only sets `size`, not `weight` — so the skill applies the scale directly instead. (See gotchas.)
- **`ElementContent`** is the right primitive only when its SceneObject is the **sole child** of its row — e.g. a Button whose entire face is the ElementContent (icon-only dock entry, full-width pill). With any sibling in the row (an icon, another text, a second Button), its auto-sizer collapses the label to ~1 glyph silently. Default to raw Text in those cases. ElementContent has no `weight` setter, so style it with `ec.textSize = roleSize("Body")` (size only). See R1 below.

### 5. Interactive controls

Always set `size` BEFORE the component initializes (in OnStart). Sliders and Switches **do not** refresh their fill/knob visuals when `size` changes post-init — only `currentValue` drag fires the refresh. So if you set size after init, you get the jank-on-spawn bug until the user drags.

Subscribe to triggers via the **Element-level** events (`btn.onTriggerUp.add(...)`) — NOT `btn.interactable.onTriggerStart` which is `undefined` until the Element initializes.

### 6. Spatial design

Defaults from `references/spectacles-spatial-design.md` (already in repo):
- Position at z = -110 cm (full binocular overlap, 53×77 cm usable area)
- Minimum interactive target: 4 cm at 110 cm distance, 6 cm recommended
- Dark backgrounds, light text (Specs uses additive color — black = transparent)
- Always `depthTest = true` on world-space text

### 7. Generate the script

Create the file at `Assets/Scripts/<Name>.ts` (flat — no `UI/` subfolder). Use the patterns from `references/patterns.md` as the starting template. Always:

1. `this.sceneObject.createComponent("Component.Canvas")` at root — defaults to `SortingType.Hierarchy`, which is what every pattern in this skill relies on
2. Frame or BackPlate (created BEFORE the Content child so hierarchy DFS draws them first)
3. Content child SceneObject at z=0.6 (created AFTER the backing so hierarchy DFS draws it on top)
4. FlexLayout column on Content
5. Children via private helper methods (header, row, card, etc.) — see examples

**Never** call `someComponent.renderOrder = N` or `mat.mainPass.depthWrite = true` on Image materials inside the generated script — see Core mental model → Render-order rules.

#### Canonical import paths — copy verbatim, never fabricate

UIKit symbols live at non-obvious paths. **Do NOT invent paths from the symbol name** — there is no `Components/UI/`, no `Components/Element/`, no `Layout2D/FlexLayout/`. The agent must copy these strings verbatim. If a symbol isn't listed here, open `references/component-cheatsheet.md` and read the actual `Cache/TypeScript/Src/Packages/SpectaclesUIKit.lspkg/` tree — do not guess.

| Symbol | Import path |
|---|---|
| `FlexLayout` | `SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexLayout` |
| `FlexItem` | `SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexItem` |
| `FlexAlign`, `FlexDirection`, `FlexJustify`, `FlexWrap`, `FlexAlignContent`, `FlexAlignSelf` | `SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes` |
| `GridLayout` | `SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Grid/GridLayout` |
| `GridItem` | `SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Grid/GridItem` |
| `ContentVerticalAlignment`, `ContentHorizontalAlignment` | `SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/LayoutTypes` |
| `BackPlate` | `SpectaclesUIKit.lspkg/Scripts/BackPlate` *(note: NOT under `Components/`)* |
| `Frame` | `SpectaclesUIKit.lspkg/Scripts/Components/Frame/Frame` |
| `Button` | `SpectaclesUIKit.lspkg/Scripts/Components/Button/Button` |
| `Switch` | `SpectaclesUIKit.lspkg/Scripts/Components/Switch/Switch` |
| `Slider` | `SpectaclesUIKit.lspkg/Scripts/Components/Slider/Slider` |
| `ElementContent` | `SpectaclesUIKit.lspkg/Scripts/Components/Content/ElementContent` *(note: `Content/`, not `Element/`)* |
| `TextInputField` | `SpectaclesUIKit.lspkg/Scripts/Components/TextInputField/TextInputField` |
| `FontWeight` and other TextStylePresets enums | `SpectaclesUIKit.lspkg/Scripts/Components/TextStylePresets/TextStylePresets` |
| `Event`, `PublicApi` | `SpectaclesInteractionKit.lspkg/Utils/Event` |

Common drift patterns to avoid: inserting a `UI/` or `Element/` segment that doesn't exist, renaming `Flex/` to `FlexLayout/`, and dropping the `Scripts/` segment between `.lspkg/` and `Components/`. All three produce `TS2307: Cannot find module ...`.

### 8. Wire into the scene

**Skip this entire step when the orchestrator (`specs-experience-builder`) is driving** — its Phase 3a bootstrap owns scene composition and material creation. The skill's job in that mode is to produce `<Name>UI.ts` only.

When invoked **standalone**, after writing the script, call the `RecompileTypeScriptTool` MCP tool. If `succeeded`:

> Tool naming, deferred schemas, and ask/spawn semantics: see `lens-studio-field-notes` Hard Rule 2 / Cross-runtime orchestration.

1. If the script uses `Component.Image` (i.e. references `ImageMaterial.mat` via `requireAsset`), create `Assets/Materials/ImageMaterial.mat` first via `asset-graphql` `createAssetFromPreset` with `preset: "ImageMaterialPreset"`, `destinationPath: "Materials"`, `name: "ImageMaterial"`. Skip if no `Component.Image` usage.
2. Use `scene-graphql` to create a root SceneObject at position `(0, 0, -110)`.
3. Add a ScriptComponent pointing at `@asset:Scripts/<Name>.ts`.
4. Set any `@input` fields (textures, strings, numbers) using `setProperty` with `valueType: REFERENCE` for asset refs and `STRING`/`NUMBER`/`JSON` for primitives. **Do NOT wire a material `@input`** — the script gets the material via `requireAsset` from step 1.
5. For Texture arrays: set each index with `setProperty` on `<componentId>.<inputName>.<i>` (REFERENCE, UUID string).
6. Run `RecompileTypeScriptTool` again to verify.
7. Run `RunAndCollectLogsTool` — `status="succeeded"` from compile does NOT mean runtime works. Check `errors` and `prints` for stack traces from `onAwake` / `OnStart`.
8. Capture preview with the `CapturePanelScreenshotTool` MCP tool (pluginId `Snap.Plugin.Gui.PreviewPanel`) and review with the user.

### 9. Iterate

The first render is rarely right. Common follow-ups (covered in gotchas.md):
- Hierarchy too flat → bump header to `applyTextRole(header, "Title1")` (see Type Scale) and add `marginBottom` on header FlexItem
- Cells too cramped → bigger `rowGap` / `columnGap` and bigger panel
- Bottom-row tiles missing → `GridLayout.autoRows = "auto"` (not `"1fr"`)
- Knob/fill wrong position → set `slider.size` before init
- Frame invisible → `autoShowHide = false`
- Content stretched/squished → `frame.autoScaleContent = false`
- Text left-aligned despite Center → set `horizontalOverflow = Overflow` so the alignment respects the (small) rect's center

## Lens API gotchas (don't reach for Editor-API verbs)

Three runtime-API pitfalls that recur in `<Name>UI.ts` because the Editor API surface (scene-graphql, asset-graphql) has differently-named operations than the Lens runtime API the UI module actually runs in. Compile-time errors or silent runtime failures, both fixable by switching to the right verb.

Before writing against any unfamiliar LS API: see `lens-studio-field-notes` "Verify the API surface before writing".

### G1 — `sceneObject.removeComponent` does NOT exist in the Lens API

**Symptom:** `error TS2551: Property 'removeComponent' does not exist on type 'SceneObject'. Did you mean 'createComponent'?`

**Cause:** The agent reached for `removeComponent` because `_removeComponents` exists in the Editor API surface (VirtualScene / scene-graphql — see `ls-clad/skills/scene-construction/references/virtual-scene.md` line 161). The runtime `SceneObject` interface has no symmetrical removal — components are removed by destroying them or by destroying the whole SceneObject.

**Fix.** Pick the smallest scope that removes what you want:

```ts
// Remove a single component (the component instance owns its lifetime):
const rmv = obj.getComponent("Component.RenderMeshVisual") as RenderMeshVisual | null
if (rmv) rmv.destroy()

// Remove a whole subtree (children destroyed automatically):
obj.destroy()
```

**Better path most of the time: don't create-then-remove.** If the UI flow needs a SceneObject that holds a RenderMeshVisual *sometimes* and a Text *sometimes*, build two sibling SceneObjects and toggle `.enabled` between them. Repeated create/destroy thrashes the scene graph and is a common source of GC-induced one-frame flicker in 5.22.

### G2 — UIKit `Button.size` after init: use `button.onInitialized.add`, not the private `_size`

**Symptom:** Button visuals render at the default size even after the script assigned a new size, or the size "takes" the first preview but reverts on rebuild. Sometimes the fix-it-by-typing path that "worked" is `(btn as Button & { _size?: vec3 })._size = new vec3(...)` — a write to a private field.

**Cause:** UIKit `Button` (like `Frame`) defers most of its self-configuration to its `onInitialized` callback. Writing `button.size = vec3(...)` BEFORE init happens is fine (the public setter buffers the value) but writing it during construction in a way that races init can land before the size getter is wired up. Touching `_size` directly bypasses the public setter and any size-change side-effects (collider resize, content reflow) — it works by accident today and will silently break on the next UIKit revision that adds a side-effect to the setter.

**Fix.** Always assign `Button.size` (and `Frame.innerSize`, `Frame.size`) inside `onInitialized`. Never write to `_size`:

```ts
const closeBtn = closeObj.createComponent(Button.getTypeName()) as Button
closeBtn.onInitialized.add(() => {
  closeBtn.size = new vec3(8, 3, 1)
})
```

The exception that proves the rule is `Switch` and `Slider`, which require the explicit `_size` + `.initialize()` pattern shown in the smart-home example near line 651 of this file — those two components only. **Do NOT generalize that pattern to `Button` or `Frame`.** If a `Button.size` assignment "doesn't seem to work," your fix is `onInitialized.add(...)`, not `_size`.

### G3 — A Frame-bearing panel that starts hidden: disable ONLY at the tail of `frame.onInitialized.add`, never synchronously

**Symptom:** A detail panel / popup / dialog that should start hidden never appears when you later try to show it. The tap *is* detected — a tap SFX or other side-effect on the same handler fires — but the panel stays blank or absent **forever**. Compiles clean, passes log-only QA, and surfaces to the user as "I tapped and heard the audio but nothing showed up." (A milder variant of the same bug: the panel flickers visible on the first preview frame, then vanishes.)

**Cause:** `buildUI()` / `buildDetailCard()` usually runs in `onAwake`. A `Frame` binds its `initialize()` to **`OnStartEvent`** (`Frame.ts:756`), and `onInitialized` fires only *inside* `initialize()` (`Frame.ts:1236`). A SceneObject that is **disabled before start never fires `OnStartEvent` for its components.** So a synchronous `this.detailRoot.enabled = false` in `onAwake` disables the host *before* OnStart → the Frame never initializes → `onInitialized` never fires → the content you built inside `onInitialized` (text fields, buttons) is never created. Your show method's `if (!this.field) return` guard then bails on every call and the panel can never be shown. (The flicker variant is the opposite timing: if the disable is deferred via `DelayedCallbackEvent`, the host reaches OnStart enabled, the Frame inits and re-shows itself, then the delayed disable lands — fragile timing that breaks if init takes >100 ms.)

**Fix.** Build *all* content inside `frame.onInitialized.add(...)`, and make a **single** `enabled = false` the **last statement of that same callback**. No synchronous disable in `onAwake`. No `DelayedCallbackEvent`. No nesting `onInitialized` inside `onInitialized`.

```ts
const frame = this.detailRoot.createComponent(Frame.getTypeName()) as Frame
frame.autoShowHide = false
frame.onInitialized.add(() => {
  // ...build every text row, button, and layout HERE...
  this.symText = this.addCardRow(/* ... */)
  // ...
  this.detailRoot.enabled = false   // LAST line — after content exists AND after init re-show
})
// ❌ NEVER add a synchronous disable — it disables the host before OnStart and kills Frame init:
// this.detailRoot.enabled = false
```

Every nested Frame in the same subtree needs its own `onInitialized.add` block — they each have independent init callbacks and re-enable their host SceneObject independently. (This is the same root cause as the "Frame `innerSize` setter throws Cannot read 'size' of undefined" trace — both are Frame-init-order bugs, fixed by deferring the write into `onInitialized`.)

**Related — the "opens only on the second tap" bug.** A lazily-built panel (`ensureStore()`/`ensureSettings()` builds the Frame on the first tap) hits this same timing: the tap handler sets `root.enabled = true`, then `onInitialized`'s tail `enabled = false` fires *after* the handler returns and re-hides it — so the first tap silently builds, the second tap shows. **Fix:** gate the start-hidden disable on a `wantVisible` flag that both the open handler and the `onInitialized` tail read, instead of hardcoding `false`. Full pattern in `references/gotchas.md → Lazy-built panels → A panel only opens on the second tap`.

## Common pitfalls

These recur often enough that they're worth pulling out of `references/gotchas.md` into the main flow. Apply them at authoring time. R1 and R2 produce green compile + green Phase 3c grep but cosmetically broken UI; R3 is a hard compile error (`TS2345`).

### R1 — ElementContent in a multi-child row collapses to ~1 glyph

ElementContent in a `FlexDirection.Row` with any sibling collapses its internal text box to ~1 glyph ("Prev" → blank). Default to raw `Component.Text` with an explicit `layoutRect` (the `addRowText` helper). Full cause + escape hatch: `references/gotchas.md → ElementContent in a row`.

### R2 — Button labels need width budgeting

**Symptom:** "Prev" renders as "Pre", "Next" as "Ne". The Button compiled clean; the visible truncation comes from the label rect outrunning `Button.size.x`.

**Rule:** `Button.size.x ≥ (glyph budget) + (leading-icon width if any) + 1.5 cm padding`. Embed the label as a raw Text sized to `Button.size.x − 0.5 cm` via `addButtonLabel(parent, text, size, widthCM)` from `references/patterns.md`.

**Minimum sizes (Button label, size = 39):**

| Label characters | Leading icon | Minimum `Button.size.x` |
|---|---|---|
| 4 chars | no icon | `5.5 cm` |
| 4 chars | yes | `7.5 cm` |
| 6 chars | yes | `9.0 cm` |

When a row has Prev + Next + indicator competing for width, drop leading icons and use inline glyphs (`< Prev`, `Next >`) so no row child competes with the label.

### R3 — FlexLayout is a Component, children parent to the SceneObject

`someSO.createComponent(FlexLayout.getTypeName())` returns a `FlexLayout` *component*, not the SceneObject — passing it to a `(parent: SceneObject, ...)` helper is `TS2345`. Pass the SceneObject instead. Convention: SceneObjects are `row` / `col` / `content` / `inner`; FlexLayout components are `flex` / `f` / `stack` / `rowFlex`. Full cause + fix: `references/gotchas.md → FlexLayout is a Component, not a SceneObject`.

## Communicating with the main script (event bus)

Each UI module is a self-contained `@component class extends BaseScriptComponent`. There is **no `buildUI()` function and no `UIElements` handle bag** — the main game script does NOT mutate UI text/state directly. Instead:

- **Main → UI** (push state into UI): the UI exposes public methods that take primitive data.
- **UI → Main** (user input flows back): the UI exposes `Event<T>` instances (typed event emitters from SIK) and the main script subscribes.

The main script declares the handle directly with the UI class type: `@input uiHud!: StatusHUD` (Lens Studio resolves the wired ScriptComponent to the typed class at runtime — see [Accessing TypeScript from TypeScript](https://developers.snap.com/lens-studio/features/scripting/accessing-components#accessing-typescript-from-typescript)). No `.getScript()`, no cast.

```typescript
import Event, {PublicApi} from "SpectaclesInteractionKit.lspkg/Utils/Event"

@component
export class StatusHUD extends BaseScriptComponent {
  @input message: string = "Connecting..."

  private statusText!: Text
  private _onDismiss = new Event<void>()

  // Public event — main script subscribes
  get onDismiss(): PublicApi<void> { return this._onDismiss.publicApi() }

  // Public mutators — main script calls these
  setMessage(msg: string): void {
    if (this.statusText) this.statusText.text = msg
  }

  onAwake() { /* build the panel, store statusText, wire dismiss button to this._onDismiss.invoke() */ }
}
```

```typescript
// Main game script
import {StatusHUD} from "./StatusHUD"

@input uiHud!: StatusHUD   // typed as the UI class — wired in the scene, used directly

onAwake() {
  this.uiHud.onDismiss.add(() => { /* react to user dismissing the HUD */ })

  this.createEvent("OnStartEvent").bind(() => {
    this.uiHud.setMessage("Connected.")
  })
}
```

The main script must **never** call `this.sceneObject.createComponent("Component.Text")` for game text — all visible strings live inside the UI module. Use `setX()` methods to push values in; subscribe to `onX` events to pull user input out.

## Asset prerequisites

Most UIs need:
- **`Assets/Materials/ImageMaterial.mat`** (from `ImageMaterialPreset`) for every `Component.Image`. This preset is premultiplied-alpha-correct for icon PNGs; `UnlitMaterialPreset` does not composite icon alpha correctly on UIKit Image components. The script loads it once at module scope via `requireAsset('../Materials/ImageMaterial.mat') as Material`, clones per image, sets `mat.mainPass.baseTex = <texture>` plus `mat.mainPass.depthTest = true; mat.mainPass.depthWrite = false`, and assigns via `img.clearMaterials(); img.addMaterial(mat)`. The depth flags match the preset's own defaults — **Images depth-test ON, depth-write OFF** — so the icon respects the scene but doesn't punch its rectangular alpha bounds into the depth buffer (which would occlude siblings the Canvas hierarchy draws after it). Do NOT take the material as `@input` — `requireAsset` makes the script self-contained and works identically whether the skill is invoked standalone or from the `specs-experience-builder` orchestrator.
- **Icons** via the `/icon-selector` skill (Material Symbols, 512×512 RGBA PNGs at `Assets/Icons/<name>.png`).
- **Theme font** via the `/font-selector` skill (Google Fonts, `.ttf` / `.otf` at `Assets/Fonts/<Family>.ttf`). The caller decides the family BEFORE invoking `/specs-build-ui` and passes the resulting path in as `theme_font_path` (e.g. `"../Fonts/Teachers.ttf"` relative to `Assets/Scripts/`). The generated script declares the font once at module scope — `const THEME_FONT = requireAsset(<theme_font_path>) as Font` — and assigns `t.font = THEME_FONT` on every `Component.Text` it creates. This mirrors the icon pattern: the caller decides, the script bakes the reference. **Do NOT take the font as `@input`**, and do NOT call the `FontSelector` MCP tool with `sceneObjectId` from inside this skill — the Inspector apply collides with the script's runtime `t.font` assignment.

**Who creates `ImageMaterial.mat`:**

- Standalone `/specs-build-ui` invocation → this skill creates the material via `asset-graphql` (`createAssetFromPreset` with `ImageMaterialPreset`, destination `Materials/`, name `ImageMaterial`) in Step 8 before wiring the script into the scene.
- `specs-experience-builder` orchestrator → the Phase 3a bootstrap creates it via `VirtualScene` `apply` (`preset: "ImageMaterialPreset"`, `destinationPath: "Materials"`, `name: "ImageMaterial"`). The skill should NOT pre-create it in that path — the orchestrator's grep-detection rule decides.

Either way, the generated `<Name>UI.ts` references it via `requireAsset('../Materials/ImageMaterial.mat')` and survives.

## Worked examples

Eight complete reference scripts are bundled at `references/examples/`. Each one is a complete `@component class extends BaseScriptComponent` that mounts on its own SceneObject. Copy the closest match and edit:

| File | Demonstrates |
|---|---|
| `references/examples/StatusHUD.ts` | BackPlate sized by `onLayoutComplete`, single ElementContent with leadingIcon, Billboard |
| `references/examples/SettingsPanel.ts` | BackPlate column, mixed Switch/Slider/Button rows, `applyTextRole(…, "Title2")` header, Cancel-as-label vs Save-as-Button |
| `references/examples/MediaGrid.ts` | GridLayout 3 cols × 2 rows with `autoRows = "auto"`, per-tile Image with cloned material, raw Text labels |
| `references/examples/MediaPlayer.ts` | Frame (autoScaleContent=false), square thumbnail (alignSelf=Center), title/artist hierarchy, scrubber Slider |
| `references/examples/AppLauncherDock.ts` | Frame with head-follow (`setUseFollow(true)`, `setFollowing(true)`), horizontal icon-only Buttons |
| `references/examples/TabbedSettings.ts` | Frame + tab Buttons (`setIsToggleable(true)`), destroy-and-rebuild pane on `showTab()` to force FlexLayout re-discovery, `verticalAlignment = Top` to avoid overflow-upward |
| `references/examples/ConversationalCard.ts` | Frame + scrollable message list + `TextInputField` + Send Button wired via `onTriggerUp` |
| `references/examples/FarmStorefront.ts` | Frame + balance pill (BackPlate + raw Image + raw Text), GridLayout of cards each with their own BackPlate, per-card Buy Button that mutates state |

When in doubt, read one of these — they reflect every workaround discussed in gotchas.md.

**Static vs. runtime-updating text.** Use `label()` / `content()` (ElementContent) for text that never changes (button labels, static titles, icons). Use the `dynamicText()` helper (raw `Component.Text`, `text.depthTest = true`) for values that update at runtime (scores, timers, HP, counters) — update via `textComponent.text = "new value"`.

**Pitfall: `dynamicText` next to an icon overlaps it.** `dynamicText()` does NOT participate in FlexLayout — it's a raw `Component.Text` placed at `localPos`, so dropping it alongside an ElementContent icon renders both at the parent's origin (a "0" stacked over a star icon). The rule: if an element must update at runtime AND sit next to other elements, wrap each piece in its own `flexChild` so FlexLayout spaces them — never make `dynamicText` a sibling of `content()` on the same SceneObject. The full `dynamicText` helper plus the WRONG/RIGHT icon-value-label row pattern is in `references/examples/CoinScoreRow.ts`.

---

## Layout Composition

Compose layouts with the private helpers `obj` / `liftInZ` (SceneObject creation), `flexColumn` / `flexRow` / `makeFlex` (flex containers configured inside `onInitialized` to avoid race conditions), and `flexChild` (registers each child via `parentFlexLayout.addItems([flexItem])` — mandatory, or children stack at the origin). `GridLayout` follows the same shape: configure inside `onInitialized`, give each child a `GridItem`, and register them via `grid.addItems()`. **Full verbatim implementations of all helpers live in `references/helpers.md` — copy them into the class.**

The one usage shape to internalize is `flexChild` with a builder callback that composes the child's content:

```typescript
this.flexChild(parent, {w: 12, h: 2.4}, (child) => {
  // build this child's content inside the callback; FlexLayout spaces siblings
})
```

---

## Color & Typography Guide

### Additive Display Rules (Spectacles)

- **Black = transparent.** Pure black cannot be rendered — it disappears.
- **White = boldest/brightest.** Design in "dark mode" patterns.
- **Avoid dark colors** that might disappear against the background. Use white text with varying opacity for hierarchy.
- Colors are OK for accents — just avoid very dark shades.

### Text Opacity Hierarchy

```typescript
new vec4(1, 1, 1, 1)       // Primary text — full white
new vec4(1, 1, 1, 0.75)    // Strong secondary
new vec4(1, 1, 1, 0.6)     // Secondary text
new vec4(1, 1, 1, 0.55)    // Subtle secondary
new vec4(1, 1, 1, 0.5)     // Tertiary/caption text
```

### Accent Colors

```typescript
new vec4(0.45, 0.9, 0.55, 1)   // Green (success, recovery scores)
new vec4(0.9, 0.45, 0.45, 1)   // Red (alerts, errors) — use cautiously, stays visible on Specs
new vec4(0.45, 0.7, 0.95, 1)   // Blue (info, links)
```

### Type Scale (calibrated for the default z = -110 cm)

**Never write a raw size number.** Pick a **role** and apply it with `applyTextRole(text, "Body")` — the one helper that sets `size` *and* `weight` from the table below. That is the whole controllability fix: size and weight can't drift apart, the scale lives in one place, and a font swap is corrected by one constant (see below). `text.size` is the glyph **em-square height** (`em-square cm = size / 43.886`), calibrated for the SnapOS system font at the 110 cm focal plane. For closer panels pass the distance — `applyTextRole(t, "Body", 55)` scales by `distance_cm / 110`. **Caption (38) is the floor** — never render readable text below it at 110 cm.

| Style | size | weight | role | | Style | size | weight | role |
|-------------|-----:|--------------|--------------|-|-------------|-----:|--------------|--------------|
| Title 1 | 105 | Bold (700) | `"Title1"` | | Subheadline | 41 | Bold (700) | `"Subheadline"` |
| Title 2 | 93 | Bold (700) | `"Title2"` | | Button | 39 | Medium (500) | `"Button"` |
| Headline XL | 62 | Bold (700) | `"HeadlineXL"` | | Callout | 39 | Bold (700) | `"Callout"` |
| Headline 1 | 54 | Bold (700) | `"Headline1"` | | Body | 39 | Medium (500) | `"Body"` |
| Headline 2 | 48 | Bold (700) | `"Headline2"` | | Caption | 38 | Medium (500) | `"Caption"` |

Declare the canonical `TYPE_SCALE` + `FONT_SIZE_SCALE` + `applyTextRole` block at module scope (full block in `references/patterns.md → Typography`). For `ElementContent` (no `weight` setter) use `ec.textSize = roleSize("Subheadline")`.

**Custom-font drift — the usual "size won't behave" complaint.** The scale is calibrated for the system font (Objektiv, em ratio ≈ 0.695). The skill bakes a custom theme font onto every label, and each font fills the em square differently, so the same number renders a different *visual* size. Don't re-pick numbers — set `FONT_SIZE_SCALE ≈ 0.695 / <font em ratio>` once (default `1.0`); `applyTextRole` multiplies it into every size. Full rationale: `references/gotchas.md` → *Text size drifts after a font swap* and `references/spectacles-spatial-design.md` → Typography. The examples under `references/examples/` apply each role by name.

---

## Consolidation — Group Nearby Elements

**Always consolidate UI elements that are near each other into shared layout containers** rather than creating standalone objects scattered in space. This reduces scene object count, simplifies alignment, and prevents micro-overlaps.

**WRONG:** three standalone `this.obj(root, ..., new vec3(...))` elements with hand-picked world positions and separate BackPlates — hard to align, easy to overlap. The entire skill forbids hand-placement; use a flex container.

**RIGHT — single HUD row with flex layout:**
```typescript
// One BackPlate/Frame containing all HUD elements in a row
const hudRoot = this.obj(root, "HUD", new vec3(0, 25, -110))
const hudPanel = this.scenePanel(hudRoot, "HUDPanel", 40, 5, "backplate")
const row = this.flexRow(hudPanel, 40, 4, {
  justify: FlexJustify.SpaceBetween,
  align: FlexAlign.Center,
  padX: 1.5
})
this.flexChild(row, {w: 10, h: 3}, (lives) => { /* lives content */ })
this.flexChild(row, {w: 14, h: 3, grow: 1}, (score) => { /* score content */ })
this.flexChild(row, {w: 10, h: 3}, (timer) => { /* timer content */ })
```

**When to consolidate:**
- Multiple HUD elements (score, timer, lives) → single HUD panel with flex row
- Button groups (Start, Reset, Settings) → single button bar with flex row
- Label + value pairs → single flex row per pair, grouped into flex column
- Dialog content (title + message + buttons) → single Frame with flex column

---

## Complete Example — Smart Home Device Row

Shows a realistic composition: button card with leading icon, device name, rich text subtitle, and toggle switch.

```typescript
// Icons loaded at module top — imported by the calling agent (Phase 2a) from manifest `icon` entries
const ICON_LIGHTBULB: Texture = requireAsset("../Icons/lightbulb.png") as Texture

this.flexChild(outer, {w: 26, h: 4.8}, (rowObj) => {
  // Background button card
  this.btn(rowObj, "PrimaryNeutral", "Rectangle", 26, 4.8)

  // Row layout: icon + text on left, toggle on right
  const row = this.flexRow(rowObj, 26, 4.8, {
    justify: FlexJustify.SpaceBetween,
    align: FlexAlign.Center,
    padX: 1.4
  })

  // Left: icon + device name + subtitle (grows to fill)
  this.flexChild(row, {w: 17, h: 3.2, grow: 1}, (left) => {
    const col = this.flexColumn(left, 17, 3.2, {
      justify: FlexJustify.Center,
      align: FlexAlign.Start,
      gap: 0.15
    })
    this.flexChild(col, {w: 16, h: 1.4}, (name) => {
      // Leading icon + text — standard pattern for list items
      this.content(name, {
        text: "Entry Lights",
        leadingIcon: ICON_LIGHTBULB,
        leadingIconSize: 1.8,
        spacing: 0.55,
        textSize: roleSize("Body"),   // Body (39, Medium)
        fontWeight: "medium",
        contentAlignment: "left",
        paddingLeft: 0.5
      })
    })
    this.flexChild(col, {w: 16, h: 1.4}, (subtitle) => {
      // Rich text for mixed formatting — bold status + light description.
      // fontWeight "light" is a deliberate de-emphasis override on this subtitle
      // (ElementContent takes no weight from the role); size still comes from the scale.
      this.label(subtitle, "<b>Warm scene</b> active", 16, 1.4, {
        textSize: roleSize("Caption"), align: "left", color: new vec4(1, 1, 1, 0.5), fontWeight: "light", richText: true
      })
    })
  })

  // Right: toggle switch (fixed size)
  this.flexChild(row, {w: 4.8, h: 2.4, grow: 0}, (toggleObj) => {
    const toggle = toggleObj.createComponent(Switch.getTypeName()) as Switch
    ;(toggle as any)._size = new vec3(4.8, 2.4, 1)
    toggle.initialize()
    toggle.isOn = true
    // React to user toggles via onFinished (PublicApi<boolean>). NOT onStateChanged —
    // that's PublicApi<StateName> (visual states), and a boolean callback on it is TS2345.
    toggle.onFinished.add((on: boolean) => { /* push the new state into your model */ })
  })
})
```

---

## Spatial Placement

Position at z = −110 cm; add `obj.createComponent(Billboard.getTypeName())` to make panels face the user. See `references/spectacles-spatial-design.md` for touch-target sizes, display areas at other Z-depths, and Y-axis boresight guidance.

**Z-axis rules for UI composition:**
- The **orchestrator** positions the UI root at **-Z** in world space (e.g., `new vec3(0, 10, -110)`). This is passed to `buildUI(script, parent)` — the parent is already at the right world position.
- **Inside `buildUI()`**, all positions are **local** (relative to the parent). Use **+Z** to bring content in front of containers:
  - `PANEL_CONTENT_Z_LIFT = 0.01` — content inside Frame/BackPlate
  - `LAYOUT_Z_LIFT = 0.02` — nested flex layouts
  - `CONTENT_Z_OFFSET = 0.08` — **any label drawn ON a Button face** — `ElementContent` *and* raw `Component.Text` (the `addButtonLabel` helper bakes this in). A label at the button's `z = 0` is coincident with the button's own face and its leading glyph gets occluded — lift it forward. (gotchas → *button/toggle label's leading glyph is clipped*.)
  - `DYNAMIC_TEXT_Z_OFFSET = 0.15` — plain Component.Text on BackPlate
- **Never use -Z for child elements** — that pushes them behind their parent (invisible).
- **A laid-out child's local Z survives the layout pass.** `FlexLayout`/`GridLayout` write only **X/Y** on each child (`z` is preserved), so these forward-Z lifts hold after layout. If a lift *seems* ineffective, the cause is almost always **bounds** (the layout pushed the element past the BackPlate/Frame edge → edge-clipped — add padding / avoid `SpaceBetween` on an edge item), not Z.

See `spectacles-spatial-design.md` reference for the complete spatial design guide.

---

## Reference: Supplementary UI examples

The canonical worked examples for `/specs-build-ui` live under `references/examples/` (see *Worked examples* above). Three supplementary directories cover patterns that aren't represented in that primary set — read them only when your task matches one of the rows below.

All files in these directories follow the same render-order rule the rest of the skill enforces (see Core mental model → Render-order rules): layering between siblings is controlled by hierarchy position, and any code that moves a panel/card/tile to the front does it by re-parenting (becomes the last sibling), never by setting a numeric render order.

### `references/ui-configuration-examples/` — composition patterns

| File | Pattern |
|---|---|
| `UIController.ts`, `UIManager.ts` | Top-level UI orchestration and module wiring |
| `ExampleCarouselLayout.ts` | Horizontal carousel of cards |
| `ExampleChat.ts` | Chat/message list panel with input + send |
| `ExampleDeck.ts` | Stacked / swipeable card deck — layering via hierarchy reorder (`bringCardToFront`) |
| `ExampleScrollWindowLayout.ts` | Scrollable window with clipped content |
| `ExampleVideoPlayer.ts` | Video player UI with transport controls |
| `GridRearrangement.ts` | Drag-to-rearrange grid items — drag-on-top via hierarchy reorder + Z-boost, no renderOrder |

### `references/ui-custom-examples/` — custom visual overrides

| File | Pattern |
|---|---|
| `UIKitCustomVisualsFrame.ts` | Themed Frame backing (gradients + borders) |
| `UIKitCustomVisualsRectangleButton.ts` | Themed RectangleButton (per-state gradients) |
| `UIKitCustomVisualsRoundButton.ts` | Themed RoundButton |
| `UIKitCustomVisualsSlider.ts` | Themed Slider track / fill / knob |
| `UIKitCustomVisualsSwitch.ts` | Themed Switch track / knob |

### `references/ui-resizable-examples/` — ResizableWindow patterns

| File | Pattern |
|---|---|
| `ResizableWindow.ts` | Baseline resizable Frame |
| `ResizableWindow_Bounds.ts` | Min/max size constraints |
| `ResizableWindow_Cropped.ts` | MaskingComponent crop that toggles on resize |
| `ResizableWindow_DragOnly.ts` | Drag-handle interaction without corner resize |
| `ResizableWindow_FlexContent.ts` | Resize that re-flows nested FlexLayout content |

**When to read them:** open the matching file only if `references/examples/` doesn't already cover your pattern. The composition helpers, font-loading conventions, and `@ui.group_start` decorators in these files come from the UIKit demo project — not from `/specs-build-ui`'s standalone output — so adapt the rendering pattern, not the file's import shape.

---

## How to Build

1. **Analyze** the user's request — identify panels, text, controls, layout structure
2. **Glob `Assets/Icons/*.png` FIRST to discover what's available.** This is the authoritative icon list. Do not skip this step even if the caller provided an icon list in the args — always verify against disk. Load each discovered icon as `requireAsset("../Icons/<name>.png") as Texture` at the top of the module, and map elements to those names. If the UI needs an icon that isn't on disk, stop and ask the orchestrator to add a matching `icon` manifest entry — do NOT call `IconSelector` from this skill, do NOT ship icon-less UI.
3. **Choose container** — Frame (movable, most cases) or BackPlate (fixed, e.g. NPC dialog)
4. **Compose** the layout hierarchy using `flexColumn`/`flexRow`/`flexChild`/GridLayout
5. **Style** buttons with `btn()` and add content with `content()` — always pass `leadingIcon` or `trailingIcon` for buttons. Use `richText: true` for any label that mixes bold/light weights or inline formatting (e.g., `<b>Score</b> 42`).
6. **Compile** with `RecompileTypeScriptTool` to verify
7. **Screenshot** with `CapturePanelScreenshotTool` to verify visual output
8. **Iterate** — adjust sizes, gaps, colors based on screenshot feedback

**Default rules:**
- **Icons are preferred** on all buttons and panel headers when they're available on disk at `Assets/Icons/`. When an element's mapping is `null` or the intended icon isn't in the glob output, render the element text-only via `content()` — still through the composition helpers, never via raw `Component.Text` in the caller's main script.
- **Rich text (`richText: true`) is the default** for labels that combine different visual weights (e.g., bold label + regular value). Use it with `<b>`, `<i>`, `<size=N>`, `<color=#hex>` tags.
- **Prefer icons when available** — scores are nicer with trophy/star icons, timers with clock icons, close buttons with X icons, navigation with arrows. But never halt the build over a missing icon; ship the text-only version.
- **If using `Component.Image`**, include `requireAsset('../Materials/ImageMaterial.mat')` in the module. The orchestrator will detect this and create the material during bootstrap. Always clone the material for each Image instance.
- **Consolidate nearby UI elements** — if multiple labels, icons, or panels are close together, group them into a single `flexRow` or `flexColumn` with `flexChild` entries rather than creating separate standalone elements. This reduces scene object count, simplifies layout, and prevents micro-overlaps between adjacent elements.
