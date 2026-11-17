// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0
//
// demo.ts — one Specs prototype: a draggable billboarded panel with label/value
// chips, a slider, a switch and a dropdown; a scrolling text list on a
// RoundedRectangle plate; and a grabbable low-poly icosphere. Copy it, delete what you don't
// need, rename it, change the layout. Comments explain component connections,
// initialization order and adaptation points; keep those relevant to your Lens.
// Sizes derive from the constants below. Recheck spacing when adding controls.

import {Interactable} from "InteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {InteractableManipulation} from "InteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation"
import {Button} from "UIKit.lspkg/Scripts/Components/Button/Button"
import {Dropdown, DropdownItemEvent, DropdownOption} from "UIKit.lspkg/Scripts/Components/Dropdown/Dropdown"
import {Frame} from "UIKit.lspkg/Scripts/Components/Frame/Frame"
import {ScrollWindow} from "UIKit.lspkg/Scripts/Components/ScrollWindow/ScrollWindow"
import {Slider} from "UIKit.lspkg/Scripts/Components/Slider/Slider"
import {Switch} from "UIKit.lspkg/Scripts/Components/Switch/Switch"
import {System3} from "UIKit.lspkg/Scripts/Themes/System-3.0/System3"
import {ThemeService} from "UIKit.lspkg/Scripts/Themes/ThemeService"
import {FlexItem} from "UIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexItem"
import {FlexLayout} from "UIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexLayout"
import {FlexAlign, FlexDirection, FlexJustify} from "UIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import {RoundedRectangle} from "UIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle"

// Use UberPBR or UberUnlit with Vertex Color set to "Base Color" so the
// material displays the mesh's per-vertex colours.
const PROP_MAT = requireAsset("../Materials/PropMat.mat") as Material

// 110 cm is the Specs focal plane and what the type scale is calibrated for.
// DeviceTracking(World) puts the camera at the tracking origin at session start,
// so "FOCAL_CM in front of the camera" IS world z = -FOCAL_CM; /specs-project-init
// guarantees that camera. Never read the camera in onAwake to derive this — there
// it still holds the authored z = +40 and tracking overwrites it a frame later,
// landing content 40 cm short. Content at a fixed world z is world-locked, not
// head-locked: FOCAL_CM from the user only until they walk, which is intended
// here — Frame billboarding handles facing, not position.
const FOCAL_CM = 110

// ADDITIVE display: black reads as transparent, and a filled plate ADDS light,
// LOWERING text contrast. Group with space and weight, never with a fill. For
// the same reason colour needs SATURATION, not brightness — see the palette.
const WHITE = new vec4(1, 1, 1, 1)
const DIM = new vec4(1, 1, 1, 0.6)

// ─── Type scale ─────────────────────────────────────────────────────────────
// Never write a raw text size; pick a role. `size` is em-height calibrated for
// FOCAL_CM, and CAPTION is the readability floor — go smaller and it is
// unreadable on device however good it looks on a monitor.
type Role = {size: number; weight: number}
const STRONG: Role = {size: 48, weight: 700}
const BODY: Role = {size: 39, weight: 500}
const CAPTION: Role = {size: 38, weight: 500}
// A text rect must be tall enough for its glyphs or they clip. Empirical: a
// size-48 role needs about 3.0 cm, which is this ratio.
const GLYPH_CM_PER_SIZE = 3.0 / 48

// ─── Local Z lifts ──────────────────────────────────────────────────────────
// These surfaces face +Z toward the camera; positive local Z lifts content
// toward the viewer. Revisit the sign if you change their orientation.
const LIFT_LAYOUT = 0.02   // a nested flex container or item, to break depth ties
const LIFT_CONTENT = 0.6   // content sitting on a Frame or plate face
const LIFT_OVERLAY = 0.5   // a button label, or a dropdown drawer over siblings

// ─── Panel ──────────────────────────────────────────────────────────────────
const TAP_H = 4.4     // a tap target needs the bulk
const TEXT_H = 2.6    // a text line looks padded out in one
const CTRL_H = 3.4
const TITLE_H = 3.4
const COL_GAP = 0.8
const PANEL_W = 24
// The column, top to bottom. COL_H and the Frame's innerSize both derive from
// this list, so changing a row means editing here and its build call below —
// there is no third place holding a stale total.
const ROW_HS = [TITLE_H, TAP_H, CTRL_H, CTRL_H, CTRL_H, TAP_H]
const COL_H = ROW_HS.reduce((a, b) => a + b, 0) + COL_GAP * (ROW_HS.length - 1)
// Frame draws its chrome OUTSIDE innerSize — measured at ~4 cm per side. You
// need this to place anything beside the panel; without it a neighbour tucks
// under the border and looks like a render-order bug.
const FRAME_CHROME = 8
const PANEL_OUTER_W = PANEL_W + FRAME_CHROME
const BTN_W = PANEL_W - 4
// Control slot sizes are NOT cosmetic — see ctrlRow. A Switch is a compact pill;
// hand it the Slider's width and it stretches into a look-alike slider.
const SLIDER_SLOT = {w: 10, h: 2.2}
const SWITCH_SLOT = {w: 4.8, h: 2.4}
const LABEL_PAD = 2     // between a control's label and its slot
const TEXT_INSET = 1.5  // text rect inside its row, so glyphs clear the edge

// ─── Chips ──────────────────────────────────────────────────────────────────
// Chips must fit PANEL_W — check the sum, and widen the panel or drop one
// rather than shrinking them. This format stops being glanceable past three.
const CHIP_W = 10
const CHIP_GAP = 2.5        // BETWEEN chips: must stay well above CHIP_INNER_GAP,
const CHIP_INNER_GAP = 0.8  // because that contrast is what reads as grouping
const CHIP_LABEL_FRAC = 0.45

// ─── List ───────────────────────────────────────────────────────────────────
const LIST_WINDOW = new vec2(20, 18)   // the visible viewport
const ROW_GAP = 0.6
const PLATE_MARGIN = 2.5               // plate beyond the window, per axis
const ROW_W = LIST_WINDOW.x - 2   // 1cm text inset per side
// Placed clear of the panel's chrome, so the two surfaces cannot overlap.
const LIST_X = PANEL_OUTER_W / 2 + (LIST_WINDOW.x + PLATE_MARGIN) / 2 + 0.75  // gap beyond both half-widths
// Enough rows to overflow the window, so the list demonstrates scrolling rather
// than looking like a short static column. Derived, so it stays true if the
// window or the row height changes.
const SEED_ROWS = Math.ceil(LIST_WINDOW.y / (TEXT_H + ROW_GAP)) + 2

// ─── Prop ───────────────────────────────────────────────────────────────────
const PROP_RADIUS = 4.5
// 0 -> 20 faces, 1 -> 80, 2 -> 320. Each step quadruples the triangle count, so
// 1 is the low-poly sweet spot: round silhouette, still visibly faceted.
const PROP_SUBDIVISIONS = 1
const SPIN_MAX_DEG = 90     // at slider = 1
const SPIN_START = 0.5      // slider's initial position, and so the initial rate

const PICKS = ["Item A", "Item B", "Item C"]


function obj(parent: SceneObject, name: string, pos?: vec3): SceneObject {
  const so = global.scene.createSceneObject(name)
  so.setParent(parent)
  if (pos) so.getTransform().setLocalPosition(pos)
  return so
}

// `w` must be the real slot width in cm: a 1x1 rect collapses to about one glyph
// in a row, and Ellipsis measures truncation against this rect.
function txt(host: SceneObject, s: string, role: Role, w: number,
    align: HorizontalAlignment, color: vec4,
    overflow: HorizontalOverflow = HorizontalOverflow.Overflow): Text {
  const t = host.createComponent("Component.Text") as Text
  t.text = s
  t.depthTest = true
  t.size = role.size
  t.weight = role.weight
  const h = role.size * GLYPH_CM_PER_SIZE
  t.layoutRect = Rect.create(-w / 2, w / 2, -h / 2, h / 2)
  t.horizontalOverflow = overflow
  t.horizontalAlignment = align
  t.verticalAlignment = VerticalAlignment.Center
  t.textFill.mode = TextFillMode.Solid
  t.textFill.color = color   // an unset fill renders dim grey and is illegible at 110 cm
  return t
}

// Configure layout after child discovery. Register size-dependent work after
// this callback so it observes these defaults rather than being overwritten.
function flex(parent: SceneObject, dir: FlexDirection, w: number, h: number, gap = 0,
    justify = FlexJustify.Start, align = FlexAlign.Stretch): SceneObject {
  const c = obj(parent, "Flex", new vec3(0, 0, LIFT_LAYOUT))
  const f = c.createComponent(FlexLayout.getTypeName()) as FlexLayout
  const i = c.createComponent(FlexItem.getTypeName()) as FlexItem
  i.overrideWidth = w
  i.overrideHeight = h
  f.onInitialized.add(() => {
    f.width = w
    f.height = h
    f.direction = dir
    if (dir === FlexDirection.Row) f.columnGap = gap
    else f.rowGap = gap
    f.justifyContent = justify
    f.alignItems = align
  })
  return c
}

// FlexLayout discovers initial child FlexItems at OnStart. With discovery
// enabled, call addItems() only after initialization for later additions.
function item(parent: SceneObject, w: number, h: number, build: (o: SceneObject) => void,
    name = "Item", lift = LIFT_LAYOUT): SceneObject {
  const child = obj(parent, name, new vec3(0, 0, lift))
  const i = child.createComponent(FlexItem.getTypeName()) as FlexItem
  i.overrideWidth = w
  i.overrideHeight = h
  i.flexGrow = 0
  i.flexShrink = 0
  build(child)
  return child
}

// One "label + control" row. The label is a raw Text, not an Element, because it
// has a flex sibling — an ElementContent in that position collapses to about one
// glyph. `slot` is NOT cosmetic: the layout assigns the FlexItem's laid-out size
// onto any Element it positions, so the slot beats the control's own `size`. A
// Switch handed the Slider's 10 cm slot stretches into a look-alike slider.
function ctrlRow(col: SceneObject, label: string, slot: {w: number; h: number},
    build: (host: SceneObject) => void, name: string): void {
  const labelW = PANEL_W - slot.w - LABEL_PAD
  item(col, PANEL_W, CTRL_H, (host) => {
    const row = flex(host, FlexDirection.Row, PANEL_W, CTRL_H, LABEL_PAD / 2,
      FlexJustify.SpaceBetween, FlexAlign.Center)
    // A control's label is functional, not a caption — keep it full white.
    item(row, labelW, TEXT_H, (h) => {
      txt(h, label, BODY, labelW, HorizontalAlignment.Left, WHITE)
    }, "Label")
    item(row, slot.w, slot.h, build, "Control")
  }, name)
}

/**
 * A geodesic sphere: an icosahedron whose triangles are split and pushed back
 * out to the radius. Reach for this rather than a lat/long sphere — the facets
 * stay near-equal, so there is no pinching at the poles and no seam. Faceted:
 * each triangle carries its own three vertices with that facet's normal, so it
 * lights as one plane. (For smooth, a sphere centred at the origin has normal
 * === normalized position; no other shape is that cheap.)
 */
function icosphere(b: MeshBuilder, radius: number, subdivisions: number): void {
  // The 12 icosahedron vertices are three nested golden-ratio rectangles.
  const t = (1 + Math.sqrt(5)) / 2
  const verts = [
    new vec3(-1, t, 0), new vec3(1, t, 0), new vec3(-1, -t, 0), new vec3(1, -t, 0),
    new vec3(0, -1, t), new vec3(0, 1, t), new vec3(0, -1, -t), new vec3(0, 1, -t),
    new vec3(t, 0, -1), new vec3(t, 0, 1), new vec3(-t, 0, -1), new vec3(-t, 0, 1),
  ].map((v) => v.normalize().uniformScale(radius))
  // Every triple winds counter-clockwise seen from OUTSIDE. Reverse one and that
  // face is back-face culled, which looks like a hole rather than a winding bug.
  let faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ]

  // Split each triangle on its edge midpoints into four, then push the new points
  // back out to the radius. That projection is the entire trick — it is what
  // turns a subdivided polyhedron into a sphere. Midpoints are not shared between
  // neighbouring faces, which costs vertices but avoids an edge cache; the flat
  // path wants per-face vertices anyway.
  for (let step = 0; step < subdivisions; step += 1) {
    const next: number[][] = []
    for (const [i0, i1, i2] of faces) {
      const mid = (a: vec3, c: vec3): number => {
        verts.push(a.add(c).uniformScale(0.5).normalize().uniformScale(radius))
        return verts.length - 1
      }
      const m01 = mid(verts[i0], verts[i1])
      const m12 = mid(verts[i1], verts[i2])
      const m20 = mid(verts[i2], verts[i0])
      next.push([i0, m01, m20], [i1, m12, m01], [i2, m20, m12], [m01, m12, m20])
    }
    faces = next
  }

  // One mesh, one material, many colours — what a single material cannot do
  // without per-vertex colour. Distinct saturated hues, not a ramp: a ramp
  // reads as lighting.
  const palette = [
    new vec4(1.0, 0.25, 0.35, 1),
    new vec4(1.0, 0.65, 0.10, 1),
    new vec4(0.35, 1.0, 0.40, 1),
    new vec4(0.15, 0.90, 1.0, 1),
    new vec4(0.35, 0.45, 1.0, 1),
    new vec4(1.0, 0.35, 1.0, 1),
  ]
  // Band by the facet's own centroid, not per vertex: one colour per triangle is
  // what keeps each facet flat instead of gradient-shaded across it.
  const bandFor = (tri: vec3[]): vec4 => {
    const midY = (tri[0].y + tri[1].y + tri[2].y) / 3
    const k = (midY / radius + 1) / 2
    return palette[Math.min(palette.length - 1, Math.floor(k * palette.length))]
  }

  const base = b.getVerticesCount()
  const data: number[] = []
  const indices: number[] = []
  faces.forEach((face, f) => {
    const tri = [verts[face[0]], verts[face[1]], verts[face[2]]]
    // Outward normal of a CCW face: (v1-v0) x (v2-v0). Computed, not hardcoded.
    const faceN = tri[1].sub(tri[0]).cross(tri[2].sub(tri[0])).normalize()
    const c = bandFor(tri)
    for (const p of tri) {
      const n = faceN
      // Value order must match the layout the caller declared.
      data.push(p.x, p.y, p.z, n.x, n.y, n.z, c.x, c.y, c.z, c.w)
    }
    const v = base + f * 3
    indices.push(v, v + 1, v + 2)
  })
  b.appendVerticesInterleaved(data)
  b.appendIndices(indices)
}

@component
export class Demo extends BaseScriptComponent {
  private values = new Map<string, Text>()
  private prop!: SceneObject
  private rows!: FlexLayout
  private scroll!: ScrollWindow
  private rowCount = 0
  private taps = 0
  private clock = 0
  private spinDegPerSec = SPIN_START * SPIN_MAX_DEG
  private spinning = true
  private manipulating = false
  private shownSecond = -1

  onAwake(): void {
    // Select the theme before creating UIKit components: they read it while
    // building their visuals. A later change does not restyle existing controls.
    ThemeService.getInstance().setTheme(System3)

    const root = this.getSceneObject()
    // Surfaces are spread around the user: panel dead ahead, list to the right,
    // prop beneath. Content outside the instantaneous view is NOT a defect — the
    // user turns their head, and that is the point of a headset. Do not shrink a
    // layout to fit one screenshot.
    const z = -FOCAL_CM
    this.buildPanel(obj(root, "Panel", new vec3(0, 6, z)))
    this.buildList(obj(root, "ListPanel", new vec3(LIST_X, 6, z)))
    this.prop = this.buildProp(obj(root, "Prop", new vec3(0, -16, z)))

    // Bind prop interactions once, after construction. OnStart keeps setup
    // together here; Interactable events also accept subscriptions in onAwake.
    // UIKit callbacks that depend on internal objects use onInitialized below.
    this.createEvent("OnStartEvent").bind(() => {
      const it = this.prop.getComponent(Interactable.getTypeName()) as Interactable
      // onTriggerStart, not onTriggerEnd: a release drifting off the collider
      // fires onTriggerEndOutside, so onTriggerEnd silently misses presses —
      // which a far-field pointer, including the Preview mouse, does easily.
      it.onTriggerStart.add(() => this.set("taps", `${++this.taps}`))
      // Pause auto-spin while the user is grabbing the prop, so a manual
      // rotation is not overwritten by the spin each frame (see UpdateEvent).
      const manip = this.prop.getComponent(
        InteractableManipulation.getTypeName()) as InteractableManipulation
      manip.onManipulationStart.add(() => {this.manipulating = true})
      manip.onManipulationEnd.add(() => {this.manipulating = false})
    })

    this.createEvent("UpdateEvent").bind(() => {
      const dt = getDeltaTime()   // seconds since last frame; multiply rates by it
      this.clock += dt
      // Compose a per-frame delta onto the CURRENT rotation, and only while the
      // user is not grabbing: writing an absolute yaw here would overwrite the
      // rotation InteractableManipulation just applied, snapping a manual turn
      // back the instant spin resumes.
      if (this.spinning && !this.manipulating) {
        const t = this.prop.getTransform()
        const dYaw = dt * this.spinDegPerSec * (Math.PI / 180)
        t.setLocalRotation(t.getLocalRotation().multiply(quat.fromEulerAngles(0, dYaw, 0)))
      }
      // Assign Text.text only on change — every write costs a text rebuild.
      const second = Math.floor(this.clock)
      if (second !== this.shownSecond) {
        this.shownSecond = second
        this.set("time", `${second}s`)
      }
    })
  }

  private set(label: string, value: string): void {
    const t = this.values.get(label)
    if (t) t.text = value
  }

  // Canvas sorts depth-first, so hierarchy position IS render order — later
  // sibling draws on top. Never set renderOrder.
  private buildPanel(root: SceneObject): void {
    root.createComponent("Component.Canvas")

    // Frame is created before the content child so DFS paints it underneath.
    const frame = root.createComponent(Frame.getTypeName()) as Frame
    frame.autoShowHide = false   // otherwise the Frame hides itself and reads as invisible
    // autoScaleContent rescales content by innerSize/originalInnerSize on every
    // post-init innerSize write, and originalInnerSize came from a 32x32 default —
    // so sizing the panel from script silently shrinks its contents.
    frame.autoScaleContent = false
    frame.allowScaling = false      // corner-resize handles; opt in for real resizable windows
    frame.allowTranslation = true   // THIS is the drag affordance
    // showCloseButton / showFollowButton must NOT be set here — their setters
    // reach an internal ButtonHandler that does not exist until init, and a throw
    // in onAwake aborts the rest of it. See onInitialized below.
    //
    // Billboarding at rest needs xAlways/yAlways: private @inputs with no
    // setters, re-asserted onto the Billboard every frame (so assigning
    // frame.billboardComponent is overwritten). Set pre-init — init reads them.
    // At their false defaults a code-built Frame does not billboard at all.
    const bb = frame as unknown as {xAlways: boolean; yAlways: boolean; yBufferDegrees: number}
    bb.yAlways = true    // yaw toward the user
    bb.xAlways = false   // leave pitch level
    bb.yBufferDegrees = 8  // deadband: small head yaw does not re-aim it

    // Parent content to the host in onAwake; Frame ADOPTS existing children into
    // a wrapper at init, so only size-dependent work (innerSize) waits. Never
    // inspect a UIKit container's children from your OnStart — order is undefined.
    const col = flex(obj(root, "Content", new vec3(0, 0, LIFT_CONTENT)),
      FlexDirection.Column, PANEL_W, COL_H, COL_GAP, FlexJustify.Center, FlexAlign.Center)

    // These six build calls must stay in step with ROW_HS above.
    const titleW = PANEL_W - LABEL_PAD
    item(col, titleW, TITLE_H, (h) => {
      txt(h, "Prototype", STRONG, titleW, HorizontalAlignment.Center, WHITE)
    }, "Title")

    this.buildChips(col, [["time", "0s"], ["taps", "0"]])

    // Slider and Switch both extend Element, so `size` buffers pre-init. Set it
    // there, never after: neither rebuilds its fill/knob geometry for a post-init
    // size change, which is the "knob sits wrong until you drag it" bug.
    ctrlRow(col, "spin speed", SLIDER_SLOT, (host) => {
      const slider = host.createComponent(Slider.getTypeName()) as Slider
      slider.currentValue = SPIN_START
      slider.onValueChange.add((v: number) => {
        this.spinDegPerSec = v * SPIN_MAX_DEG
      })
    }, "SliderRow")

    // The "toggle" — UIKit has no Toggle component. `Switch implements
    // Toggleable`; Toggle/ holds only group helpers.
    ctrlRow(col, "spin", SWITCH_SLOT, (host) => {
      const sw = host.createComponent(Switch.getTypeName()) as Switch
      sw.isOn = true
      // onFinished is PublicApi<boolean>. NOT onStateChanged — that carries a
      // visual StateName, and a boolean callback on it is a compile error.
      sw.onFinished.add((on: boolean) => {
        this.spinning = on
      })
    }, "ToggleRow")

    // The open drawer must paint OVER whatever it covers. Canvas paints
    // depth-first, so a later sibling draws on top: the invariant is that
    // everything the drawer overlaps is an EARLIER sibling. expandUp opens it
    // over the rows above, all of which are built before this one, so the button
    // below stays clear and its later paint order never matters — only
    // first-in-column would break this.
    //
    // The extra lift settles DEPTH, which hierarchy order does not: these are
    // world-space meshes with depthTest on, sitting within one layout lift of
    // each other, so they need a physical push forward too.
    item(col, PANEL_W, CTRL_H, (host) => {
      const dd = host.createComponent(Dropdown.getTypeName()) as Dropdown
      // REQUIRED inside a layout. It defaults to false, meaning the Dropdown
      // anchors ITSELF by writing its own localPosition.y, overwriting the Y the
      // parent FlexLayout assigned. Symptom: the trigger renders at the column's
      // origin stacked on a sibling while every other child spaces correctly.
      dd.parentHandlesAnchor = true
      // Dropdown defaults to startExpanded = TRUE — it comes up with the drawer
      // open, covering whatever is below. Init-only (a later write logs a warning
      // and is ignored), so it must be set here; at runtime use expand() /
      // collapse() / toggle().
      dd.startExpanded = false
      // Upward keeps the drawer over earlier siblings, per the note above; a
      // downward drawer would open straight through the button below it.
      dd.expandUp = true
      dd.triggerLabel = "item"
      dd.triggerButtonSize = new vec2(BTN_W - LABEL_PAD, CTRL_H)
      // setData() switches the Dropdown into pool mode and queues items when
      // called pre-init, so onAwake is a supported place for it.
      dd.setData(PICKS.map((label) => new DropdownOption(label)))
      // Pool mode identifies a selection by INDEX, not object: it recycles its
      // buttons, so onSelectionChanged hands back DropdownItem[] whose entries
      // are null here. Read the index and look it up.
      dd.onItemTapped.add((e: DropdownItemEvent) => {
        this.addRow(`picked ${PICKS[e.index] ?? "none"}`)
      })
    }, "ItemDropdown", LIFT_LAYOUT + LIFT_OVERLAY)
    item(col, BTN_W, TAP_H, (h) => {
      const b = h.createComponent(Button.getTypeName()) as Button
      b.size = new vec3(BTN_W, TAP_H, 1)   // BEFORE init: ElementContent reads it when it builds
      // A generous lift, not a hairline: a button's content offset moves as it
      // animates, and a small one gets swallowed mid-press.
      txt(obj(h, "Label", new vec3(0, 0, LIFT_OVERLAY)), "add row", BODY,
        BTN_W - LABEL_PAD, HorizontalAlignment.Center, WHITE)
      // UIKit Elements are a different layer from IK Interactables, with
      // different event names: onTriggerUp / onTriggerDown.
      b.onTriggerUp.add(() => this.addRow(`row ${this.rowCount + 1}`))
    }, "AddBtn")


    // innerSize and button flags access Frame internals: wait for initialization.
    // Size to the content; Frame adds its own chrome outside this rectangle.
    frame.onInitialized.add(() => {
      frame.innerSize = new vec2(PANEL_W, COL_H)
      frame.syncScaleBaseline()
      frame.showCloseButton = true
    })
  }

  private buildChips(col: SceneObject, chips: [string, string][]): void {
    const barW = chips.length * CHIP_W + CHIP_GAP * (chips.length - 1)
    item(col, barW, TAP_H, (host) => {
      const row = flex(host, FlexDirection.Row, barW, TAP_H, CHIP_GAP,
        FlexJustify.Center, FlexAlign.Center)
      for (const [label, value] of chips) {
        const labelW = CHIP_W * CHIP_LABEL_FRAC
        const valueW = CHIP_W - labelW - CHIP_INNER_GAP
        item(row, CHIP_W, TAP_H, (chip) => {
          const pair = flex(chip, FlexDirection.Row, CHIP_W, TAP_H, CHIP_INNER_GAP,
            FlexJustify.Center, FlexAlign.Center)
          // Label dim and small, value bright and bold: the type contrast is what
          // makes the pair read as one chip without drawing a box round it.
          item(pair, labelW, TEXT_H, (h) => {
            txt(h, label, CAPTION, labelW, HorizontalAlignment.Right, DIM)
          }, "Label")
          item(pair, valueW, TEXT_H, (h) => {
            this.values.set(label,
              txt(h, value, STRONG, valueW, HorizontalAlignment.Left, WHITE))
          }, "Value")
        }, `Chip_${label}`)
      }
    }, "ChipRow")
  }

  private buildList(root: SceneObject): void {
    root.createComponent("Component.Canvas")

    // RoundedRectangle is the STATIC panel primitive (Frame is the movable one;
    // BackPlate is deprecated in UIKit 4.0). Without it the rows are unbacked
    // text floating in space, which reads as a bug. Created before the content
    // child so DFS paints it underneath. size is a vec2; there is no `color` —
    // use backgroundColor (dark: a light fill adds light and kills contrast).
    const plate = root.createComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
    plate.size = new vec2(LIST_WINDOW.x + PLATE_MARGIN, LIST_WINDOW.y + PLATE_MARGIN)
    plate.cornerRadius = 1
    plate.backgroundColor = new vec4(0.17, 0.17, 0.17, 1)

    // MaskingComponent clips descendants to the ScreenTransform on the SAME
    // object, so both go here and the content parents underneath.
    const clip = obj(root, "Clip", new vec3(0, 0, LIFT_CONTENT))
    const st = clip.createComponent("Component.ScreenTransform") as ScreenTransform
    // anchors are NORMALIZED (+/-1 spans the parent), so cm in anchors describes a
    // rect many times the parent and clips NOTHING. Collapse anchors to the
    // centre; put the real cm in offsets.
    st.anchors.left = 0
    st.anchors.right = 0
    st.anchors.bottom = 0
    st.anchors.top = 0
    st.offsets.left = -LIST_WINDOW.x / 2
    st.offsets.right = LIST_WINDOW.x / 2
    st.offsets.bottom = -LIST_WINDOW.y / 2
    st.offsets.top = LIST_WINDOW.y / 2
    // Fully qualified. The short name "MaskingComponent" creates NOTHING — no
    // component, no error — and an absent mask looks just like a mis-sized one.
    const mask = clip.createComponent("Component.MaskingComponent") as MaskingComponent
    mask.cornerRadius = 1  // cm, not a normalized fraction

    const viewport = obj(clip, "Viewport")
    this.scroll = viewport.createComponent(ScrollWindow.getTypeName()) as ScrollWindow
    this.scroll.windowSize = LIST_WINDOW   // setters buffer pre-init
    this.scroll.vertical = true
    this.scroll.horizontal = false
    this.scroll.edgeFade = true          // fades rows at the viewport edges
    this.scroll.edgeMode = "elastic"     // rubber-band bounce at the ends; "clamped" = hard stop
    // ScrollWindow performs NO layout — addObject() only reparents into its
    // Scroller — so a flex column inside it positions the rows.
    const rows = flex(viewport, FlexDirection.Column, LIST_WINDOW.x, LIST_WINDOW.y, ROW_GAP)
    this.rows = rows.getComponent(FlexLayout.getTypeName()) as FlexLayout
    // Seed after flex() applies its defaults. Later UI events append directly;
    // onInitialized is a ReplayEvent, so subscribing per row retains callbacks.
    this.rows.onInitialized.add(() => {
      for (let i = 1; i <= SEED_ROWS; i += 1) this.addRow(`item ${i}`)
    })
  }

  private addRow(label: string): void {
    const child = item(this.rows.sceneObject, ROW_W, TEXT_H, (row) => {
      // Ellipsis over Overflow: an over-long item ends in "..." instead of
      // running under the mask edge, where it reads as a rendering fault.
      txt(row, label, BODY, ROW_W - TEXT_INSET, HorizontalAlignment.Left, WHITE,
        HorizontalOverflow.Ellipsis)
    }, "TextRow")
    this.rows.addItems([child.getComponent(FlexItem.getTypeName()) as FlexItem])
    this.rowCount += 1
    // Keep column height and scroll extent in step with the row count: if
    // scrollDimensions is under the real laid-out extent, the tail rows are
    // unreachable however far you drag. Uniform row height makes this hold.
    const h = Math.max(this.rowCount * (TEXT_H + ROW_GAP) - ROW_GAP, LIST_WINDOW.y)
    this.rows.height = h
    this.scroll.scrollDimensions = new vec2(LIST_WINDOW.x, h)   // bounded content extent; horizontal is disabled
  }

  // Create collider -> Interactable -> manipulation: hit testing needs the
  // collider, and manipulation needs the Interactable on the same object.
  // Each new Interactable registers itself in its own onAwake.
  private buildProp(root: SceneObject): SceneObject {
    const b = new MeshBuilder([
      {name: "position", components: 3},
      {name: "normal", components: 3, normalized: true},
      {name: "color", components: 4},
    ])
    b.topology = MeshTopology.Triangles
    b.indexType = MeshIndexType.UInt16
    icosphere(b, PROP_RADIUS, PROP_SUBDIVISIONS)

    const rmv = root.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    rmv.mesh = b.getMesh()
    rmv.mainMaterial = PROP_MAT
    b.updateMesh()   // required after every change, including the first

    const collider = root.createComponent("Physics.ColliderComponent") as ColliderComponent
    const sphere = Shape.createSphereShape()
    sphere.radius = PROP_RADIUS   // disagree with the visual and taps miss
    collider.shape = sphere

    root.createComponent(Interactable.getTypeName())
    // Requires the Interactable on the same object, hence created second.
    const m = root.createComponent(
      InteractableManipulation.getTypeName()) as InteractableManipulation
    m.setCanTranslate(true)
    m.setCanRotate(true)
    m.setCanScale(false)   // keep this demo's prop at a fixed size
    return root
  }
}
