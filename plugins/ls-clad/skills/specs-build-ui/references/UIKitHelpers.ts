// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// UIKitHelpers.ts — UIKit composition-helper compatibility snapshot.
//
// This file was validated against UIKit 4.0.0 / InteractionKit 4.0.0 (LS 5.25).
// Copy it only when the installed UIKit and InteractionKit versions match exactly, then
// verify its imports in the real type-check. On any version mismatch, do not copy
// this snapshot: author project-local composition code from references/uikit-4.0.md and
// the installed declarations instead.
//
// Non-component module. Every <Experience>*UI.ts imports from here so the type
// scale, the Z-lift constants, the flex composition and the depth-flag rules
// exist in exactly ONE place.
//
// Doctrine encoded here (do not "simplify" any of it):
//   * Theme is System3, and it arrives through a scene-level ThemeManager
//     component (_theme = "System3"); with no ThemeManager, ThemeService also
//     falls back to System3. Per-component
//     variants go through Button.setVariant({theme, shape, style}) /
//     VisualElement.setThemeOverride(theme) BEFORE init. Nothing in this file
//     writes _themeOverride / _styleSystem* / _shapeSystem* privates.
//   * ElementContent is the default for labels, titles, and icon+text faces.
//     Standalone content gets its own host SceneObject that is the sole child
//     of its FlexItem cell (R1); button faces use companion mode (the
//     ElementContent is a sibling component on the Button's own SceneObject).
//   * ElementContent.textSize (fed roleSize(role)) is the live text-size knob.
//     The theme never sizes text. ElementContent has no weight, font, or color
//     setter in 4.0.0 — weight-critical and colored/live-updating text is the
//     dynamicText() raw-Text path.
//   * Canvas SortingType.Hierarchy owns render order — hierarchy position IS
//     z-order. Nothing in this file sets `renderOrder`.
//   * Every FlexLayout gets `autoDiscoverItemsOnStart = false` BEFORE addItems,
//     because FlexLayout.addItems throws pre-init while auto-discovery is on.
//   * Every child is registered via `parentFlex.addItems([item])` — creating the
//     FlexItem is necessary but not sufficient.
//   * Images: depthTest ON, depthWrite OFF. Text: depthTest ON (no depthWrite).
//     Backings: defaults, untouched. A panel's surface is a Frame; an inner
//     card / pill / list plate is a RoundedRectangle (makeCardRect). BackPlate
//     is deprecated and this module neither imports nor emits it.
//   * Text size/weight only ever via applyTextRole() / roleSize() — never a raw
//     `t.size = N` and never a raw `ec.textSize = N`.

import {FlexLayout} from "UIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexLayout"
import {FlexItem} from "UIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexItem"
import {
  FlexAlign,
  FlexAlignSelf,
  FlexDirection,
  FlexJustify
} from "UIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import {Button} from "UIKit.lspkg/Scripts/Components/Button/Button"
import {Frame} from "UIKit.lspkg/Scripts/Components/Frame/Frame"
import {InteractableManipulation} from "InteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation"
import {ElementContent, TextAlignment} from "UIKit.lspkg/Scripts/Components/Content/ElementContent"
import {addContentToElement} from "UIKit.lspkg/Scripts/Components/Content/ElementContentFactory"
import {RoundedRectangle} from "UIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle"
import {System3} from "UIKit.lspkg/Scripts/Themes/System-3.0/System3"
import {ThemeService} from "UIKit.lspkg/Scripts/Themes/ThemeService"

// ─── Theme ──────────────────────────────────────────────────────────────────

/**
 * The one theme name this module ever passes to setVariant/setThemeOverride.
 * Kept as a constant so a theme migration is one edit, not a grep.
 */
export const UI_THEME = "System3"

/**
 * FALLBACK ONLY — pure-script standalone use.
 *
 * The preferred wiring is a scene-level `ThemeManager` ScriptComponent with
 * `_theme = "System3"` on the FIRST root SceneObject: its onAwake calls
 * ThemeService.setTheme(System3) before any UI module builds, and it stays
 * editable in the Inspector. Use this helper only when the module must not
 * depend on scene wiring (a self-contained sample, a unit-test harness).
 *
 * Call it in `onAwake()` and nowhere else — ThemeService only styles visuals
 * created AFTER setTheme runs, so a later call leaves already-built visuals on
 * the previous theme. It is idempotent, but two modules both calling it is a smell: that
 * scene wants a ThemeManager.
 */
export function applyTheme(): void {
  ThemeService.getInstance().setTheme(System3)
}

/**
 * Pre-init variant for a Button. `shape`: Rectangle | Capsule | Round.
 * `style` (System3): Prism | PrismGhost | Primary | Secondary | Ghost.
 * setVariant validates and warns-and-drops anything else.
 */
export interface ButtonVariant {
  shape?: string
  style?: string
}

// ─── Z lifts ────────────────────────────────────────────────────────────────
// Depth-buffer tie-breakers, NOT render-order knobs. All four are INTRA-panel —
// content vs its own plate. None of them separates one panel from another; that
// is PANEL_MIN_Z_SEPARATION below.
/** Content host in front of a Frame or card face (~1 cm thick plate). */
export const PANEL_CONTENT_Z_LIFT = 0.6
/** Nested flex container / laid-out child. */
export const LAYOUT_Z_LIFT = 0.02
/** A label drawn ON a Button face. */
export const CONTENT_Z_OFFSET = 0.08
/** Raw dynamic Text sitting directly on a panel or card surface. */
export const DYNAMIC_TEXT_Z_OFFSET = 0.15

/**
 * Minimum z gap between two CO-VISIBLE panels whose x/y rectangles intersect.
 * Measure each rectangle from the full frame extent — innerSize + 2 * margin +
 * padding (Frame's margin defaults to 4 cm per side) — not from innerSize.
 * 0.05 cm is the depth-buffer floor, not a target: two coplanar dialog-class
 * surfaces flickered across their whole shared region until one moved 8 cm.
 * Mutually exclusive panes (tab bodies, a pane switcher) are exempt.
 */
export const PANEL_MIN_Z_SEPARATION = 2

// ─── Typography: the single source of truth for text size + weight ──────────
//
// `Component.Text.size` (and `ElementContent.textSize`) is the glyph
// EM-SQUARE height, not cap height:
//     em-square cm = size / 43.886
// The scale below is the Snap Specs type scale, calibrated for the SnapOS
// system font (Objektiv, em ratio ~= 0.695) at the default focal plane
// z = -110 cm. Pick a ROLE, never a raw number.
//
// FONT DRIFT: the experience bakes no custom theme font, so this stays 1.0. If a
// theme font is ever baked onto the labels, set FONT_SIZE_SCALE once to
// ~= 0.695 / <font em ratio> and every label tracks automatically. (Note that a
// baked font only reaches raw Text — ElementContent has no font setter in
// 2.0.0 and renders in the theme font.)
export const FONT_SIZE_SCALE = 1.0

export type TextRole =
  | "Title1"
  | "Title2"
  | "HeadlineXL"
  | "Headline1"
  | "Headline2"
  | "Subheadline"
  | "Button"
  | "Callout"
  | "Body"
  | "Caption"

export const TYPE_SCALE: Record<TextRole, {size: number; weight: number}> = {
  Title1: {size: 105, weight: 700},
  Title2: {size: 93, weight: 700},
  HeadlineXL: {size: 62, weight: 700},
  Headline1: {size: 54, weight: 700},
  Headline2: {size: 48, weight: 700},
  Subheadline: {size: 41, weight: 700},
  Button: {size: 39, weight: 500},
  Callout: {size: 39, weight: 700},
  Body: {size: 39, weight: 500},
  Caption: {size: 38, weight: 500}
}

/**
 * Font-corrected em-square size for a role at a focal distance (cm).
 * This is the value that feeds `ElementContent.textSize` — the default text
 * path. The theme's own font-size defaults are clobbered during init, so
 * "the theme will size it" is always wrong.
 */
export function roleSize(role: TextRole, distanceCm: number = 110): number {
  return TYPE_SCALE[role].size * FONT_SIZE_SCALE * (distanceCm / 110)
}

/**
 * Apply a type-scale role to a raw Text — the ONE place size + weight are set.
 * Only raw Text has a weight; ElementContent takes `roleSize(role)` alone.
 */
export function applyTextRole(t: Text, role: TextRole, distanceCm: number = 110): void {
  t.size = roleSize(role, distanceCm)
  ;(t as Text & {weight?: number}).weight = TYPE_SCALE[role].weight
}

// ─── Color ─────────────────────────────────────────────────────────────────

/** Widen an inspector vec3 color to vec4 with an explicit alpha. */
export function rgba(c: vec3, a: number = 1): vec4 {
  return new vec4(c.x, c.y, c.z, a)
}

// ─── SceneObject helpers ───────────────────────────────────────────────────

export function obj(parent: SceneObject, name: string, position?: vec3): SceneObject {
  const sceneObject = global.scene.createSceneObject(name)
  sceneObject.setParent(parent)
  if (position) {
    sceneObject.getTransform().setLocalPosition(position)
  }
  return sceneObject
}

/**
 * Adopt-or-create the authored root for one UI surface (the panel-split contract
 * with the bootstrap: one authored SceneObject per surface, placed at its
 * spatial-layout pose).
 *
 * If `parent` already has a child named `name`, it is returned UNTOUCHED — the
 * developer's transform is the source of truth, and re-writing the position on
 * every run silently reverts hand-tuned placement. Only when no such child
 * exists is one created at `fallbackLocalPos`, which is why the module's
 * `@input` pose vec3s are fallbacks, not placements.
 *
 * onAwake-safe: createSceneObject + setParent + the position given at creation
 * time, nothing else.
 */
export function panelRoot(parent: SceneObject, name: string, fallbackLocalPos: vec3): SceneObject {
  const childCount = parent.getChildrenCount()
  for (let i = 0; i < childCount; i++) {
    const child = parent.getChild(i)
    if (child.name === name) {
      return child
    }
  }
  return obj(parent, name, fallbackLocalPos)
}

export function liftInZ(sceneObject: SceneObject, zOffset: number): void {
  const transform = sceneObject.getTransform()
  const pos = transform.getLocalPosition()
  transform.setLocalPosition(new vec3(pos.x, pos.y, pos.z + zOffset))
}

/**
 * Content host for a Frame or card visual: a child SceneObject pushed forward so its
 * text/icons don't z-fight the plate's front face. Created AFTER the backing so
 * the Canvas hierarchy DFS paints it on top.
 */
export function contentHost(parent: SceneObject, name: string = "Content"): SceneObject {
  return obj(parent, name, new vec3(0, 0, PANEL_CONTENT_Z_LIFT))
}

// ─── Flex composition ──────────────────────────────────────────────────────

export interface FlexOpts {
  gap?: number
  padX?: number
  padY?: number
  justify?: FlexJustify
  align?: FlexAlign
}

/**
 * Create a flex container SceneObject under `parent`.
 * Properties are assigned immediately (they are plain setters that mark the
 * layout dirty) so `addItems` can never run against an unconfigured layout.
 * Pass width/height <= 0 to leave the axis auto (-1).
 */
export function makeFlex(
  parent: SceneObject,
  direction: FlexDirection,
  width: number,
  height: number,
  opts?: FlexOpts
): SceneObject {
  const container = obj(parent, direction === FlexDirection.Row ? "Row" : "Column")
  liftInZ(container, LAYOUT_Z_LIFT)

  const flex = container.createComponent(FlexLayout.getTypeName()) as FlexLayout
  flex.autoDiscoverItemsOnStart = false // REQUIRED before addItems — addItems throws otherwise
  flex.direction = direction
  flex.width = width > 0 ? width : -1
  flex.height = height > 0 ? height : -1
  if (direction === FlexDirection.Row) {
    flex.columnGap = opts?.gap ?? 0
  } else {
    flex.rowGap = opts?.gap ?? 0
  }
  flex.paddingTop = opts?.padY ?? 0
  flex.paddingBottom = opts?.padY ?? 0
  flex.paddingLeft = opts?.padX ?? 0
  flex.paddingRight = opts?.padX ?? 0
  flex.justifyContent = opts?.justify ?? FlexJustify.Start
  flex.alignItems = opts?.align ?? FlexAlign.Stretch

  // A nested flex container must itself be a laid-out item of its parent.
  const item = container.createComponent(FlexItem.getTypeName()) as FlexItem
  if (width > 0) item.overrideWidth = width
  if (height > 0) item.overrideHeight = height
  const parentFlex = parent.getComponent(FlexLayout.getTypeName()) as FlexLayout | null
  if (parentFlex) parentFlex.addItems([item])

  return container
}

export function flexRow(parent: SceneObject, width: number, height: number, opts?: FlexOpts): SceneObject {
  return makeFlex(parent, FlexDirection.Row, width, height, opts)
}

export function flexColumn(parent: SceneObject, width: number, height: number, opts?: FlexOpts): SceneObject {
  return makeFlex(parent, FlexDirection.Column, width, height, opts)
}

/**
 * Add one laid-out child to a flex container. `builder` composes the child's
 * content; the FlexItem is registered with the parent layout afterwards.
 *
 * CAUTION (same naked-item trap as addRowText): this child is a bare wrapper, so
 * LayoutItem2D writes `localScale = allocated / declared` on it. With
 * flexShrink = 0 and grow = 0 the allocation equals the declared w/h and the
 * scale stays 1 — which is why both are pinned here. If you ever pass
 * `grow > 0` on a cell that contains TEXT, the surplus width becomes a
 * horizontal glyph stretch: give the cell a real content component, or nest the
 * text in a fixed-size inner flex container instead.
 */
export function flexChild(
  parent: SceneObject,
  size: {w?: number; h?: number; grow?: number; alignSelf?: FlexAlignSelf},
  builder: (childObject: SceneObject) => void
): SceneObject {
  const child = obj(parent, "Item")
  liftInZ(child, LAYOUT_Z_LIFT)

  const item = child.createComponent(FlexItem.getTypeName()) as FlexItem
  if (size.w !== undefined && size.w > 0) item.overrideWidth = size.w
  if (size.h !== undefined && size.h > 0) item.overrideHeight = size.h
  item.flexGrow = size.grow ?? 0
  item.flexShrink = 0
  if (size.alignSelf !== undefined) item.alignSelf = size.alignSelf

  builder(child)

  const parentFlex = parent.getComponent(FlexLayout.getTypeName()) as FlexLayout | null
  if (parentFlex) parentFlex.addItems([item])
  return child
}

// ─── Text & content ────────────────────────────────────────────────────────
//
// ElementContent first. The two placement modes are structural, not stylistic:
//   * Standalone  — the ElementContent's SceneObject is the SOLE CHILD of its
//     FlexItem cell (R1). Sharing a cell object with siblings collapses its
//     internal text box to ~1 glyph.
//   * Companion   — the ElementContent is a sibling COMPONENT on the host
//     Element's own SceneObject (Button faces). It discovers the host, tracks
//     its size and state, and ignores sizeOverride.
// Standalone mode REQUIRES a non-zero sizeOverride: with no host Element to
// measure, a zero sizeOverride logs "No VisualElement found and sizeOverride
// is zero" and renders nothing. Every helper below sets it.

/** Alignment strings ElementContent understands. Plain strings in 2.0.0 — there is no enum. */
export type ContentAlign = "left" | "center" | "right"

/**
 * One standalone ElementContent on its own host object under an existing cell.
 * The caller owns the cell (and its FlexItem); this only builds the R1-safe
 * sole-child host, so it composes with flexChild as well as the row/column
 * helpers below.
 */
export function contentOn(
  cell: SceneObject,
  value: string,
  role: TextRole,
  widthCM: number,
  heightCM: number,
  align: ContentAlign = "center",
  leadingIcon?: Texture
): ElementContent {
  return contentHostOn(cell, value, role, widthCM, heightCM, align, leadingIcon).ec
}

/**
 * Internal: same as `contentOn` but also returns the ElementContent's host
 * SceneObject, because the FlexItem MUST be created on THAT object — see the
 * "NEVER scale a text cell" note on addRowText below.
 */
function contentHostOn(
  cell: SceneObject,
  value: string,
  role: TextRole,
  widthCM: number,
  heightCM: number,
  align: ContentAlign,
  leadingIcon?: Texture
): {ec: ElementContent; host: SceneObject} {
  const host = obj(cell, "Content")
  const ec = addContentToElement(host, {
    text: value,
    textSize: roleSize(role), // the live size knob — never a raw number
    sizeOverride: new vec2(widthCM, heightCM),
    textAlignment: align as TextAlignment,
    leadingIcon: leadingIcon
  })
  return {ec: ec, host: host}
}

/**
 * Text inside a ROW-direction flex container (i.e. with siblings).
 * `widthCM` must be sized for the LONGEST string the cell will ever show —
 * the row uses the cell width, not the rendered glyphs.
 * Rule of thumb: ~0.5 cm/char at Body/Caption, ~0.7 cm/char at HeadlineXL, +1 cm.
 *
 * NEVER SCALE A TEXT CELL (hard rule — cost one measured build its longest fix
 * cycle): LayoutItem2D.applyLayout has a "naked item" fallback — when NO
 * ItemHandler resolves for the FlexItem's own SceneObject it writes
 * `localScale = allocated / declaredOverride` (and treats a missing
 * overrideWidth as declaredW = 1). A FlexItem on a bare wrapper whose only
 * content is a CHILD ElementContent is exactly that naked case, so the wrapper
 * got `localScale.x = columnWidthCm` and every glyph under it was stretched
 * horizontally (measured {8.6,1,1} and {15.6,1,1} worldScale on labels) and
 * pushed off-panel by the multiplied content offset.
 * The invariant to preserve: the FlexItem goes on the SAME SceneObject as the
 * standalone ElementContent, so UIKit's StandaloneContentHandler (priority 95)
 * resolves — it measures from `sizeOverride` and its `apply()` writes ONLY
 * local x/y, never scale. Width is therefore a LAYOUT size (sizeOverride +
 * overrideWidth/Height), never a transform scale. Every Text SceneObject must
 * report worldScale {1,1,1}.
 */
export function addRowText(
  parent: SceneObject,
  value: string,
  role: TextRole,
  widthCM: number,
  heightCM: number = 2.4,
  align: ContentAlign = "center",
  leadingIcon?: Texture
): ElementContent {
  const cell = obj(parent, "RowText")
  const built = contentHostOn(cell, value, role, widthCM, heightCM, align, leadingIcon)
  // FlexItem on the ElementContent host (NOT the bare cell) — see the rule above.
  const item = built.host.createComponent(FlexItem.getTypeName()) as FlexItem
  item.overrideWidth = widthCM
  item.overrideHeight = heightCM
  const parentFlex = parent.getComponent(FlexLayout.getTypeName()) as FlexLayout | null
  if (parentFlex) parentFlex.addItems([item])
  return built.ec
}

/**
 * Text as a full-width row of a COLUMN-direction flex container.
 * alignSelf = Stretch spans the cell across the container width (cross-axis is
 * horizontal in a column); `widthCM` is the container's inner width, which the
 * standalone ElementContent needs as its sizeOverride.
 *
 * Same hard rule as addRowText: the FlexItem lives on the ElementContent's own
 * SceneObject so StandaloneContentHandler owns the apply and no transform scale
 * is ever written. This helper was the primary source of the stretched-glyph
 * defect — it declared overrideHeight only, so the naked-item fallback computed
 * `localScale.x = allocatedWidth / 1` = the full column/panel width.
 * overrideWidth is now always declared as well.
 */
export function addColumnText(
  parent: SceneObject,
  value: string,
  role: TextRole,
  widthCM: number,
  heightCM: number = 2.4,
  align: ContentAlign = "center",
  leadingIcon?: Texture
): ElementContent {
  const cell = obj(parent, "ColText")
  const built = contentHostOn(cell, value, role, widthCM, heightCM, align, leadingIcon)
  // FlexItem on the ElementContent host (NOT the bare cell) — see addRowText.
  const item = built.host.createComponent(FlexItem.getTypeName()) as FlexItem
  item.alignSelf = FlexAlignSelf.Stretch
  item.overrideHeight = heightCM
  item.overrideWidth = widthCM
  const parentFlex = parent.getComponent(FlexLayout.getTypeName()) as FlexLayout | null
  if (parentFlex) parentFlex.addItems([item])
  return built.ec
}

/**
 * The label on a Button face — COMPANION mode: the ElementContent is created as
 * a sibling component on the Button's OWN SceneObject, so it discovers the
 * Button, tracks its size and press/hover state, and colors itself from the
 * theme. No child object, no FlexItem, no Z lift: the content container places
 * itself in front of the button face.
 *
 * WIDTH BUDGET still applies (R2) — the button, not the label, owns it:
 * `Button.size.x >= glyph budget + leading-icon width + 1.5 cm padding`.
 * Minimums at the "Button" role (39): 4 chars no icon -> 5.5 cm; 4 chars +
 * icon -> 7.5 cm; 6 chars + icon -> 9.0 cm. An undersized button clips the
 * label ("Prev" -> "Pre") with a clean compile. When several buttons compete
 * for one row's width, drop the leading icon and use inline glyphs
 * ("< Prev", "Next >") so nothing else competes with the label.
 */
export function addButtonLabel(
  buttonObject: SceneObject,
  value: string,
  role: TextRole = "Button",
  opts?: {align?: ContentAlign; padX?: number; leadingIcon?: Texture; iconSizeCM?: number}
): ElementContent {
  const ec = addContentToElement(buttonObject, {
    text: value,
    textSize: roleSize(role),
    textAlignment: (opts?.align ?? "center") as TextAlignment,
    leadingIcon: opts?.leadingIcon
  })
  if (opts?.padX !== undefined) {
    ec.paddingLeft = opts.padX
    ec.paddingRight = opts.padX
  }
  if (opts?.iconSizeCM !== undefined) ec.leadingIconSize = opts.iconSizeCM
  return ec
}

function baseText(so: SceneObject, value: string, role: TextRole, color?: vec4): Text {
  const t = so.createComponent("Component.Text") as Text
  t.text = value
  t.depthTest = true // world-space text always depth-tests; Text has no depthWrite by design
  applyTextRole(t, role)
  t.horizontalAlignment = HorizontalAlignment.Center
  t.verticalAlignment = VerticalAlignment.Center // never Top — multi-line overflows upward
  t.horizontalOverflow = HorizontalOverflow.Overflow
  t.verticalOverflow = VerticalOverflow.Overflow
  if (color) t.textFill.color = color
  return t
}

/**
 * RAW Component.Text for a value that changes at runtime — scores, timers,
 * counters, a live balance. This stays raw Text by doctrine: rewriting
 * `ElementContent.text` re-runs its content layout pass, which is wrong at
 * per-frame rates. It is also the only path to an explicit text COLOR or a
 * baked theme FONT (ElementContent exposes neither setter in 2.0.0) and to
 * weight (a Title1 header that must render Bold).
 *
 * Update it with `t.text = "new value"`. It is a laid-out cell like any other
 * — never make it a sibling component of an ElementContent on one SceneObject,
 * or the two render stacked at the cell origin.
 */
export function dynamicText(
  parent: SceneObject,
  value: string,
  role: TextRole,
  widthCM: number,
  heightCM: number = 2.4,
  color?: vec4
): Text {
  // Lift the raw Text off the panel/card surface so it does not z-fight the plate behind it.
  const so = obj(parent, "DynamicText", new vec3(0, 0, DYNAMIC_TEXT_Z_OFFSET))
  const t = baseText(so, value, role, color)
  t.layoutRect = Rect.create(-widthCM / 2, widthCM / 2, -heightCM / 2, heightCM / 2)
  const item = so.createComponent(FlexItem.getTypeName()) as FlexItem
  item.overrideWidth = widthCM
  item.overrideHeight = heightCM
  const parentFlex = parent.getComponent(FlexLayout.getTypeName()) as FlexLayout | null
  if (parentFlex) parentFlex.addItems([item])
  return t
}

// ─── Icons ─────────────────────────────────────────────────────────────────

/**
 * A standalone icon as a Component.Image with a per-instance clone of
 * ImageMaterial.mat. Prefer `ElementContent.leadingIcon` when the icon belongs
 * to a label or a button face — this is for icons that are their own layout
 * cell (a thumbnail, a status glyph in a HUD row).
 *
 * `imageMaterial` comes from the caller's module-scope
 * `requireAsset("../Materials/ImageMaterial.mat") as Material` — but only in a
 * module that actually calls addIcon; don't add the requireAsset (or ship the
 * material) in a build where nothing does.
 * Depth flags: test ON, write OFF — an icon's transparent alpha must never
 * punch holes through siblings the Canvas paints after it.
 */
export function addIcon(
  parent: SceneObject,
  texture: Texture,
  sizeCM: number,
  imageMaterial: Material
): SceneObject {
  const so = obj(parent, "Icon")
  const img = so.createComponent("Component.Image") as Image
  const mat = imageMaterial.clone() // clone per image — never share
  mat.mainPass.baseTex = texture
  mat.mainPass.depthTest = true
  mat.mainPass.depthWrite = false
  img.clearMaterials()
  img.addMaterial(mat)
  so.getTransform().setLocalScale(new vec3(sizeCM, sizeCM, 1)) // ImageHandler reads localScale as size
  const item = so.createComponent(FlexItem.getTypeName()) as FlexItem
  item.overrideWidth = sizeCM
  item.overrideHeight = sizeCM
  const parentFlex = parent.getComponent(FlexLayout.getTypeName()) as FlexLayout | null
  if (parentFlex) parentFlex.addItems([item])
  return so
}

// ─── Surfaces ──────────────────────────────────────────────────────────────

/** Default card fill — a dark neutral that reads as a raised plate on Specs' additive display. */
export const CARD_COLOR = new vec4(0.08, 0.09, 0.1, 0.78)
/** Default card corner radius, in local-space cm (RoundedRectangle.cornerRadius is cm, not a ratio). */
export const CARD_CORNER_RADIUS = 1.2

/**
 * A RoundedRectangle card visual on `host` — the surface for an inner card,
 * pill, or list-row plate INSIDE a Frame panel (storefront cards, balance
 * pills, grouped-list backgrounds).
 *
 * The PANEL itself is never one of these: a panel is a `Frame`, which owns the
 * movable/scalable chrome and the built-in close button. Never nest a second
 * Frame inside a panel, and never hand-build a plate from a mesh.
 * `BackPlate` is deprecated — every former BackPlate site is a Frame (panel) or
 * this (card).
 *
 * Every setter below is safe pre-init: `Shape.initialize()` (bound to
 * OnStartEvent) reads the stored fields in `configureMesh()` / `updateSize()`,
 * so there is nothing to defer into `onInitialized`.
 */
export function makeCardRect(
  host: SceneObject,
  width: number,
  height: number,
  opts?: {cornerRadius?: number; color?: vec4; border?: boolean; gradient?: boolean}
): RoundedRectangle {
  const card = host.createComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
  card.size = new vec2(width, height)
  card.cornerRadius = opts?.cornerRadius ?? CARD_CORNER_RADIUS
  card.gradient = opts?.gradient ?? false
  card.border = opts?.border ?? false
  // backgroundColor is the solid-fill knob and is ignored while gradient is on.
  card.backgroundColor = opts?.color ?? CARD_COLOR
  return card
}

/**
 * Flat-tint an existing RoundedRectangle visual — a Frame's own visual, a card
 * from `makeCardRect`, or a Button face. Use this when the rectangle was
 * created by someone else; `makeCardRect` already takes its color up front.
 */
export function tintRoundedRect(rr: RoundedRectangle | null | undefined, color: vec4): void {
  if (!rr || isNull(rr)) return
  rr.gradient = false
  rr.backgroundColor = color
}

/**
 * A FIXED (non-grabbable) panel Frame. `allowTranslation = false` alone is NOT
 * enough: Frame.onAwake unconditionally creates an InteractableManipulation on
 * the host, and its start path creates an InteractionPlane whose collider is
 * `totalSize x (nearFieldExitDepth * 2)` — measured 26 x 16 x 42 cm around an
 * 18 x 8 cm HUD panel, i.e. ~21 cm of grab/target volume protruding toward the
 * user that intercepts rays aimed at anything near the panel. This helper
 * disables all of it once the Frame has initialized. Use it for every HUD
 * strip, status card, and fixed dialog; create the Frame directly only when the
 * panel is genuinely movable. The caller still owns `innerSize` + content in
 * its own `onInitialized` block.
 */
export function makeFixedFrame(host: SceneObject): Frame {
  const frame = host.createComponent(Frame.getTypeName()) as Frame
  frame.autoShowHide = false
  frame.autoScaleContent = false
  frame.allowScaling = false
  frame.allowTranslation = false
  frame.onInitialized.add(() => {
    const manip = host.getComponent(InteractableManipulation.getTypeName()) as InteractableManipulation | null
    if (manip && !isNull(manip)) {
      manip.setCanTranslate(false)
      manip.setCanRotate(false)
      manip.setCanScale(false)
      manip.enabled = false
    }
    // _enableInteractionPlane is a private @input with no public setter — the
    // component itself is reachable through the public getter. Disabling it
    // before its OnStart also prevents the collider child from being created.
    const plane = frame.interactionPlane
    if (plane && !isNull(plane)) plane.enabled = false
    for (let i = host.getChildrenCount() - 1; i >= 0; i--) {
      const child = host.getChild(i)
      if (!isNull(child) && child.name === "InteractionPlaneColliderRoot") child.enabled = false
    }
  })
  return frame
}

// ─── Buttons ───────────────────────────────────────────────────────────────

/**
 * Total depth, in cm, of a button's interaction collider.
 *
 * Element.initialize() fits the collider to `_size` and CENTERS it on the
 * element, so a fitted box always pokes half its depth toward the user and sits
 * in front of the plate it belongs to. A camera->target ray then hits the
 * button's OWN collider before the button ("obstructed by Collider" — in one
 * measured build this blocked a purchase flow's entry button entirely). Keep
 * this thin.
 */
export const BUTTON_COLLIDER_DEPTH_CM = 1.0

/**
 * Pin an Element's collider to its visible plate: exactly plate-sized in X/Y,
 * `depthCM` thin, and pushed fully BEHIND the plate plane (-Z is away from the
 * user) so its front face is flush with the plate and nothing protrudes toward
 * the user.
 *
 * `colliderFitElement = false` must be set before `colliderSize` /
 * `colliderCenter` (the setters are no-ops while the element is still fitting),
 * and the whole trio must be re-asserted inside `onInitialized` because
 * initialize() builds the box shape from whatever it reads at that moment.
 */
export function fitElementCollider(
  el: Button,
  widthCM: number,
  heightCM: number,
  depthCM: number = BUTTON_COLLIDER_DEPTH_CM
): void {
  el.colliderFitElement = false
  el.colliderSize = new vec3(widthCM, heightCM, depthCM)
  el.colliderCenter = new vec3(0, 0, -depthCM / 2)
}

/**
 * Text Button with a companion ElementContent label.
 *
 * `setVariant` runs FIRST, before `size` and before anything init-dependent:
 * createDefaultVisual() reads the shape and style fields at init time to pick
 * the Visual subclass, so a post-init variant is ignored. Theme is always
 * passed in the same call — setVariant drops shape/style with a warning when
 * no concrete theme override is in effect.
 *
 * `sizeXCM` minimums (R2): 4 chars no icon -> 5.5; 4 chars + icon -> 7.5;
 * 6 chars + icon -> 9.0. The companion label sizes itself from Button.size, so
 * an undersized button is what clips a label.
 *
 * Button.size is assigned pre-init (buffered by the public setter) AND
 * re-asserted in onInitialized, which is the sanctioned path — never `_size`.
 */
export function addButton(
  parent: SceneObject,
  label: string,
  sizeXCM: number,
  sizeYCM: number,
  onClick: () => void,
  opts?: {
    role?: TextRole
    variant?: ButtonVariant
    leadingIcon?: Texture
    align?: ContentAlign
    padX?: number
  }
): {button: Button; content: ElementContent} {
  const so = obj(parent, `Btn-${label}`)
  const btn = so.createComponent(Button.getTypeName()) as Button
  // Pre-init variant — must precede size and every init-dependent write.
  btn.setVariant({theme: UI_THEME, shape: opts?.variant?.shape, style: opts?.variant?.style})
  btn.size = new vec3(sizeXCM, sizeYCM, 1)
  fitElementCollider(btn, sizeXCM, sizeYCM)
  btn.onInitialized.add(() => {
    btn.size = new vec3(sizeXCM, sizeYCM, 1)
    fitElementCollider(btn, sizeXCM, sizeYCM)
  })

  // Companion mode: sibling component on the button's own SceneObject.
  const content = addButtonLabel(so, label, opts?.role ?? "Button", {
    align: opts?.align,
    padX: opts?.padX,
    leadingIcon: opts?.leadingIcon
  })

  const item = so.createComponent(FlexItem.getTypeName()) as FlexItem
  item.overrideWidth = sizeXCM
  item.overrideHeight = sizeYCM
  const parentFlex = parent.getComponent(FlexLayout.getTypeName()) as FlexLayout | null
  if (parentFlex) parentFlex.addItems([item])

  btn.onTriggerUp.add(onClick) // Element-level event — never btn.interactable.*
  return {button: btn, content}
}

/**
 * Icon-only Button (chevrons, dock entries, overflow glyphs — NOT a panel's
 * close affordance, which is `frame.showCloseButton`). The icon is the
 * ElementContent's `leadingIcon` in companion mode — a whole-face icon has no
 * row siblings to collapse the auto-sizer, and it inherits the theme's
 * hover/press tints for free.
 *
 * Defaults to `style: "Ghost"` — an icon-only affordance reads as a glyph, not
 * a filled pill. Pass `variant` to override (e.g. Capsule + Secondary for a
 * chip-shaped control).
 */
export function addIconButton(
  parent: SceneObject,
  icon: Texture,
  sizeCM: number,
  onClick: () => void,
  opts?: {variant?: ButtonVariant; iconScale?: number}
): {button: Button; content: ElementContent} {
  const so = obj(parent, "IconBtn")
  const btn = so.createComponent(Button.getTypeName()) as Button
  btn.setVariant({
    theme: UI_THEME,
    shape: opts?.variant?.shape,
    style: opts?.variant?.style ?? "Ghost"
  })
  btn.size = new vec3(sizeCM, sizeCM, 1)
  fitElementCollider(btn, sizeCM, sizeCM)
  btn.onInitialized.add(() => {
    btn.size = new vec3(sizeCM, sizeCM, 1)
    fitElementCollider(btn, sizeCM, sizeCM)
  })

  const content = addContentToElement(so, {
    leadingIcon: icon,
    textAlignment: TextAlignment.Center
  })
  content.leadingIconSize = sizeCM * (opts?.iconScale ?? 0.55)

  const item = so.createComponent(FlexItem.getTypeName()) as FlexItem
  item.overrideWidth = sizeCM
  item.overrideHeight = sizeCM
  const parentFlex = parent.getComponent(FlexLayout.getTypeName()) as FlexLayout | null
  if (parentFlex) parentFlex.addItems([item])

  btn.onTriggerUp.add(onClick)
  return {button: btn, content}
}

// Re-export the layout/content/theme vocabulary so module files import from one place.
export {
  FlexAlign,
  FlexAlignSelf,
  FlexDirection,
  FlexJustify,
  FlexItem,
  FlexLayout,
  Button,
  Frame,
  ElementContent,
  addContentToElement,
  RoundedRectangle,
  System3,
  ThemeService
}
