// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {ElementContent} from "SpectaclesUIKit.lspkg/Scripts/Components/Content/ElementContent"
import {IMAGE_MATERIAL_ASSET} from "SpectaclesUIKit.lspkg/Scripts/Components/Element"
import {Frame, FrameAppearance} from "SpectaclesUIKit.lspkg/Scripts/Components/Frame/Frame"
import {FlexItem} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexItem"
import {FlexLayout} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexLayout"
import {FlexAlign, FlexDirection, FlexJustify} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import {ScrollWindow} from "SpectaclesUIKit.lspkg/Scripts/Components/ScrollWindow/ScrollWindow"
import {Billboard} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Billboard/Billboard"

const FONT_LIGHT: Font   = requireAsset("../../Fonts/SpecsSans-Light.otf")   as Font
const FONT_REGULAR: Font = requireAsset("../../Fonts/SpecsSans-Regular.otf") as Font
const FONT_MEDIUM: Font  = requireAsset("../../Fonts/SpecsSans-Medium.otf")  as Font
const FONT_BOLD: Font    = requireAsset("../../Fonts/SpecsSans-Bold.otf")    as Font

type FontWeight = "light" | "regular" | "medium" | "bold"

const CONTENT_Z_OFFSET           = 0.08
const LAYOUT_Z_LIFT              = 0.005
const LABEL_EDGE_INSET           = 0.75
const PANEL_CONTENT_Z_LIFT       = 0.005

/**
 * Programmatic example: Double Horizontal Carousel
 *
 * Two independent horizontally-scrollable card rows inside a Frame panel.
 * Cards show an image when one is supplied, otherwise fall back to a text label.
 * All dimensions are exposed as @input parameters — adjust and press Play to rebuild.
 */
@component
export class ExampleCarouselLayout extends BaseScriptComponent {

  @ui.label('<span style="color: #60A5FA; font-size: 13px;">Programmatic UI Component</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Two horizontal carousels built at runtime. Adjust inputs and press Play to rebuild.</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Uncheck Test Mode to start empty — populate row1Items / row2Items via API before Play.</span>')
  @ui.separator

  // ── Test Mode ─────────────────────────────────────────────────────────
  @ui.group_start("Test Mode")
  @input
  @hint("Fill both carousels with mockup cards automatically. Uncheck to start empty and populate via row1Items / row2Items.")
  testMode: boolean = true
  @ui.group_end

  @ui.separator

  // ── Panel ──────────────────────────────────────────────────────────────
  @ui.group_start("Panel")
  @input
  @hint("Title text shown at the top of the panel")
  panelTitle: string = "Carousel"
  @ui.group_end

  // ── Window ─────────────────────────────────────────────────────────────
  @ui.separator
  @ui.group_start("Window")
  @input
  @hint("Outer size of the frame border in cm.")
  frameSize: vec2 = new vec2(38, 30)

  @input
  @hint("Inner cropping viewport in cm. Padding = (frameSize - croppingSize) / 2.")
  croppingSize: vec2 = new vec2(36, 28)

  @input
  @hint("Lock height to the initial aspect ratio when resizing.")
  lockAspectRatio: boolean = false

  @input
  @hint("Auto-hide on hover. Off (default) = window is always visible.")
  autoShowHide: boolean = false

  @input
  @hint("Inset between cropping viewport and content — X = left/right, Y = top/bottom (cm).")
  contentInset: vec2 = new vec2(1.5, 1.0)

  @input
  @hint("Show the × close button on the frame.")
  showCloseButton: boolean = true

  @input
  @hint("Show the follow / grip button on the frame.")
  showFollowButton: boolean = true
  @ui.group_end

  // ── Position ───────────────────────────────────────────────────────────
  @ui.separator
  @ui.group_start("Position")
  @input
  @hint("World X position (0 = horizontal centre)")
  positionX: number = 0

  @input
  @hint("World Y position (0 = camera height)")
  positionY: number = 0

  @input
  @hint("Distance from camera in cm (negative = in front)")
  positionZ: number = -110
  @ui.group_end

  // ── Row 1 ──────────────────────────────────────────────────────────────
  @ui.separator
  @ui.group_start("Row 1")
  @input
  @hint("Section header label for the first row")
  row1Label: string = "Featured"

  @input
  @hint("Number of cards in row 1")
  row1Count: number = 8

  @input
  @hint("Button style — e.g. 'PrimaryNeutral', 'Secondary', 'Primary'")
  row1CardStyle: string = "PrimaryNeutral"

  @input
  @hint("Button shape — 'Rectangle' or 'Capsule'")
  row1CardShape: string = "Rectangle"

  @input
  @hint("Card images for row 1 (in order). If fewer than row1Count, remaining cards show a text label.")
  row1Images: Texture[] = []
  @ui.group_end

  // ── Row 2 ──────────────────────────────────────────────────────────────
  @ui.separator
  @ui.group_start("Row 2")
  @input
  @hint("Section header label for the second row")
  row2Label: string = "Recommended"

  @input
  @hint("Number of cards in row 2")
  row2Count: number = 8

  @input
  @hint("Button style — e.g. 'PrimaryNeutral', 'Secondary', 'Primary'")
  row2CardStyle: string = "Secondary"

  @input
  @hint("Button shape — 'Rectangle' or 'Capsule'")
  row2CardShape: string = "Rectangle"

  @input
  @hint("Card images for row 2 (in order). If fewer than row2Count, remaining cards show a text label.")
  row2Images: Texture[] = []
  @ui.group_end

  // ── Cards ──────────────────────────────────────────────────────────────
  @ui.separator
  @ui.group_start("Cards")
  @input
  @hint("How many cards are fully visible at once per row. Card width is auto-computed to fill the carousel.")
  visibleCards: number = 3

  @input
  @hint("Gap between consecutive cards in cm")
  cardGap: number = 0.8

  @input
  @hint("Image size within the card in cm — used when a texture is supplied")
  cardImageSize: number = 5.5
  @ui.group_end

  // ── Typography ─────────────────────────────────────────────────────────
  @ui.separator
  @ui.group_start("Typography")
  @input
  @hint("Font size for the panel title — Headline 1 on the type scale @ z=-110")
  titleTextSize: number = 54

  @input
  @hint("Font size for section header labels — Subheadline on the type scale")
  sectionTextSize: number = 41

  @input
  @hint("Font size for card text labels (shown when no image is supplied) — Body on the type scale")
  cardTextSize: number = 39

  @ui.separator
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Font slots are optional — SpecsSans is auto-loaded from the Fonts folder when left empty.</span>')

  @input
  @hint("Light weight font — auto-loads SpecsSans-Light if empty")
  fontLight: Font

  @input
  @hint("Regular weight font — auto-loads SpecsSans-Regular if empty")
  fontRegular: Font

  @input
  @hint("Medium weight font — auto-loads SpecsSans-Medium if empty")
  fontMedium: Font

  @input
  @hint("Bold font — auto-loads SpecsSans-Bold if empty")
  fontBold: Font
  @ui.group_end

  // ─── Public item API ─────────────────────────────────────────────────

  public row1Items: {label: string; image?: Texture}[] = []
  public row2Items: {label: string; image?: Texture}[] = []

  // ─── Lifecycle ────────────────────────────────────────────────────────

  onAwake(): void {
    // Canvas at the panel root in SortingType.Hierarchy (the default). DFS over
    // the SceneObject subtree owns paint order — no `renderOrder` anywhere.
    this.sceneObject.createComponent("Component.Canvas")
    this.createEvent("OnStartEvent").bind(() => this.buildUI())
  }

  // ─── Build ────────────────────────────────────────────────────────────

  private buildUI(): void {
    if (this.testMode) {
      if (this.row1Items.length === 0) {
        const imgs1 = this.row1Images
        for (let i = 0; i < this.row1Count; i++) {
          const img = imgs1.length > 0 ? imgs1[Math.floor(Math.random() * imgs1.length)] : undefined
          this.row1Items.push({label: `${this.row1Label} ${i + 1}`, image: img})
        }
      }
      if (this.row2Items.length === 0) {
        const imgs2 = this.row2Images
        for (let i = 0; i < this.row2Count; i++) {
          const img = imgs2.length > 0 ? imgs2[Math.floor(Math.random() * imgs2.length)] : undefined
          this.row2Items.push({label: `${this.row2Label} ${i + 1}`, image: img})
        }
      }
    }
    const root = this.getSceneObject()
    root.createComponent(Billboard.getTypeName())
    root.getTransform().setWorldPosition(new vec3(this.positionX, this.positionY, this.positionZ))

    const PW         = this.croppingSize.x
    const PH         = this.croppingSize.y
    const PAD_X      = this.contentInset.x
    const PAD_Y      = this.contentInset.y
    const GAP        = 0.5
    const CONTENT_W  = PW - 2 * PAD_X
    const CAROUSEL_W = CONTENT_W
    const TITLE_H    = 3
    const SECTION_H  = 2

    // Auto-compute card width to fill the visible carousel area exactly
    const n          = Math.max(1, this.visibleCards)
    const cardW      = (CAROUSEL_W - (n - 1) * this.cardGap) / n

    // Auto-compute card height to fill available vertical space
    // Available height minus title, two section headers, and all row gaps (5 items → 4 gaps)
    const fixedH     = TITLE_H + SECTION_H * 2 + GAP * 4
    const cardH      = (PH - 2 * PAD_Y - fixedH) / 2 - 0.5  // 0.5 breathing room per row

    const CAROUSEL_H = cardH + 0.5

    const panelContent = this.scenePanel(root, "CarouselPanel", this.frameSize, this.croppingSize)

    const outer = this.flexColumn(panelContent, PW, PH, {
      gap: GAP, padX: PAD_X, padY: PAD_Y
    })

    // ── Title ─────────────────────────────────────────────────────────
    this.flexChild(outer, {w: CONTENT_W, h: TITLE_H}, (t) => {
      this.label(t, this.panelTitle, CONTENT_W, TITLE_H, {
        textSize: this.titleTextSize, align: "left", fontWeight: "bold"
      })
    })

    // ── Row 1 ─────────────────────────────────────────────────────────
    this.flexChild(outer, {w: CONTENT_W, h: SECTION_H}, (t) => {
      this.label(t, this.row1Label, CONTENT_W, SECTION_H, {
        textSize: this.sectionTextSize, align: "left", fontWeight: "medium",
        color: new vec4(1, 1, 1, 0.65)
      })
    })

    // ScrollWindow must NOT be on the FlexItem directly — wrap it one level deeper.
    this.flexChild(outer, {w: CAROUSEL_W, h: CAROUSEL_H}, (slot) => {
      const sc = this.obj(slot, "ScrollContainer")
      this.buildCarousel(sc, this.row1Items, this.row1CardStyle, this.row1CardShape, CAROUSEL_W, CAROUSEL_H, cardW, cardH)
    })

    // ── Row 2 ─────────────────────────────────────────────────────────
    this.flexChild(outer, {w: CONTENT_W, h: SECTION_H}, (t) => {
      this.label(t, this.row2Label, CONTENT_W, SECTION_H, {
        textSize: this.sectionTextSize, align: "left", fontWeight: "medium",
        color: new vec4(1, 1, 1, 0.65)
      })
    })

    this.flexChild(outer, {w: CAROUSEL_W, h: CAROUSEL_H}, (slot) => {
      const sc = this.obj(slot, "ScrollContainer")
      this.buildCarousel(sc, this.row2Items, this.row2CardStyle, this.row2CardShape, CAROUSEL_W, CAROUSEL_H, cardW, cardH)
    })
  }

  private buildCarousel(
    scrollContainer: SceneObject,
    items: {label: string; image?: Texture}[],
    cardStyle: string,
    cardShape: string,
    carouselW: number,
    carouselH: number,
    cardW: number,
    cardH: number
  ): void {
    if (items.length === 0) return
    const totalW = items.length * (cardW + this.cardGap) - this.cardGap

    const sw = scrollContainer.createComponent(ScrollWindow.getTypeName()) as ScrollWindow
    ;(sw as any)._vertical         = false
    ;(sw as any)._horizontal       = true
    ;(sw as any)._windowSize       = new vec2(carouselW, carouselH)
    ;(sw as any)._scrollDimensions = new vec2(Math.max(totalW, carouselW), carouselH)
    ;(sw as any)._edgeFade         = true

    const scrollContent = this.obj(scrollContainer, "ScrollContent")

    const row = this.flexRow(scrollContent, totalW, carouselH, {
      gap: this.cardGap,
      align: FlexAlign.Center
    })

    for (const item of items) {
      const label = item.label
      const tex   = item.image
      this.flexChild(row, {w: cardW, h: cardH}, (cardObj) => {
        const btn = this.btn(cardObj, cardStyle, cardShape, cardW, cardH)
        if (tex) {
          this.buildImageCard(cardObj, label, tex, cardW, cardH)
        } else {
          this.content(cardObj, {
            text: label, textSize: this.cardTextSize,
            fontWeight: "medium", contentAlignment: "center"
          })
        }
        btn.onTriggerUp.add(() => print(`Carousel: tapped "${label}"`))
      })
    }
  }

  private buildImageCard(
    cardObj: SceneObject, label: string, tex: Texture, cardW: number, cardH: number
  ): void {
    const lblH    = 2.2
    const gap     = 0.4
    const imgSize = Math.min(this.cardImageSize, cardH - lblH - gap - 0.6)

    const inner = this.obj(cardObj, "CardContent")
    this.liftInZ(inner, CONTENT_Z_OFFSET)

    const flex = inner.createComponent(FlexLayout.getTypeName()) as FlexLayout
    flex.onInitialized.add(() => {
      flex.width          = cardW
      flex.height         = cardH
      flex.direction      = FlexDirection.Column
      flex.justifyContent = FlexJustify.Center
      flex.alignItems     = FlexAlign.Center
      flex.rowGap         = gap
    })

    // Image — centered, fixed size.
    // Render order = Canvas Hierarchy DFS (image is created after the button background,
    // so it paints on top). No manual `renderOrder` — Canvas at the root in
    // `SortingType.Hierarchy` (UIKit's default) handles paint order via child position.
    this.flexChild(inner, {w: imgSize, h: imgSize}, (imgObj) => {
      const imgComp = imgObj.createComponent("Component.Image") as Image
      imgComp.mainMaterial = IMAGE_MATERIAL_ASSET.clone()
      imgComp.mainPass.baseTex = tex
      imgComp.mainPass.depthTest = true
      imgComp.mainPass.depthWrite = false   // Image: depthTest ON, depthWrite OFF
    })

    // Label — tight single-line slot directly below image
    this.flexChild(inner, {w: cardW - 1.0, h: lblH}, (lblObj) => {
      this.label(lblObj, label, cardW - 1.0, lblH, {
        textSize: this.cardTextSize, align: "center", fontWeight: "medium"
      })
    })
  }

  // ─── Composition helpers ──────────────────────────────────────────────

  private fontForWeight(weight: FontWeight): Font {
    switch (weight) {
      case "light":  return this.fontLight   || FONT_LIGHT
      case "medium": return this.fontMedium  || FONT_MEDIUM
      case "bold":   return this.fontBold    || FONT_BOLD
      default:       return this.fontRegular || FONT_REGULAR
    }
  }

  private obj(parent: SceneObject, name: string, position?: vec3): SceneObject {
    const so = global.scene.createSceneObject(name)
    so.setParent(parent)
    if (position) so.getTransform().setLocalPosition(position)
    return so
  }

  private liftInZ(so: SceneObject, z: number): void {
    const t = so.getTransform()
    const p = t.getLocalPosition()
    t.setLocalPosition(new vec3(p.x, p.y, p.z + z))
  }

  // Resizable frame with toggle-on-resize cropping. Mask is enabled only
  // during onScalingStart..onScalingEnd so the inner ScrollWindow carousel
  // is never blocked. See Scripts/UI/ResizableSamples/ResizableWindow_Cropped.ts.
  private scenePanel(
    parent: SceneObject, name: string, frameSize: vec2, croppingSize: vec2
  ): SceneObject {
    const frameObj = this.obj(parent, name)
    const frame = frameObj.createComponent(Frame.getTypeName()) as Frame
    ;(frame as any)._innerSize = croppingSize
    const padX = Math.max(0, (frameSize.x - croppingSize.x) / 2)
    const padY = Math.max(0, (frameSize.y - croppingSize.y) / 2)
    ;(frame as any)._padding = new vec2(padX, padY)
    ;(frame as any)._appearance = FrameAppearance.Small

    const clipObj = this.obj(frameObj, "ResizableContent", new vec3(0, 0, PANEL_CONTENT_Z_LIFT + 0.05))
    const screenTransform = clipObj.createComponent("Component.ScreenTransform") as any
    const maskingComp = clipObj.createComponent("Component.MaskingComponent") as any
    const setAnchors = (size: vec2) => {
      screenTransform.anchors.left = -size.x / 2
      screenTransform.anchors.right = size.x / 2
      screenTransform.anchors.bottom = -size.y / 2
      screenTransform.anchors.top = size.y / 2
    }
    setAnchors(croppingSize)
    maskingComp.enabled = true

    const initRatio = croppingSize.x / Math.max(croppingSize.y, 0.001)
    let applyingAspect = false

    const apply = () => {
      frame.allowTranslation = true
      frame.allowNonUniformScaling = true
      frame.autoScaleContent = false
      frame.autoShowHide = this.autoShowHide
      if (!this.autoShowHide) frame.showVisual()
      frame.showCloseButton = this.showCloseButton
      frame.showFollowButton = this.showFollowButton
      ;(frame as any).useFollowBehavior = this.showFollowButton

      frame.onlyInteractOnBorder = true
      frame.maximumSize = croppingSize
      frame.onScalingUpdate.add(() => {
        if (this.lockAspectRatio && !applyingAspect) {
          const cur = frame.innerSize
          const expectedY = cur.x / initRatio
          if (Math.abs(expectedY - cur.y) >= 0.01) {
            applyingAspect = true
            frame.innerSize = new vec2(cur.x, expectedY)
            applyingAspect = false
          }
        }
        setAnchors(frame.innerSize)
      })
      frame.onScalingEnd.add(() => {
        maskingComp.enabled = true
      })
    }

    if (frame.roundedRectangle) apply()
    else frame.onInitialized.add(apply)

    return this.obj(clipObj, "FrameContent", new vec3(0, 0, 0))
  }

  private btn(so: SceneObject, style: string, shape: string, width: number, height: number): Button {
    const button = so.createComponent(Button.getTypeName()) as Button
    ;(button as any)._themeOverride = "SnapOS2"
    ;(button as any)._shapeSnapOS2  = shape
    ;(button as any)._styleSnapOS2  = style
    ;(button as any)._size          = new vec3(width, height, 1)
    button.initialize()
    return button
  }

  private content(
    so: SceneObject,
    opts: {
      text?: string; contentAlignment?: string; textSize?: number
      paddingLeft?: number; paddingRight?: number; sizeOverride?: vec2
      useThemeColors?: boolean; textColorOverride?: vec4; fontWeight?: FontWeight
      leadingIcon?: Texture; iconLayout?: string; leadingIconSize?: number
    }
  ): ElementContent {
    const ec = so.createComponent(ElementContent.getTypeName()) as ElementContent
    const a  = ec as any
    // Z gap alone separates ElementContent from the button backing (depth-buffer
    // tie-break). Paint order comes from Canvas Hierarchy DFS — no renderOrder.
    a._zOffset           = CONTENT_Z_OFFSET
    a._font              = this.fontForWeight(opts.fontWeight ?? "regular")
    if (opts.text !== undefined)             a._text             = opts.text
    if (opts.contentAlignment)               a._contentAlignment = opts.contentAlignment
    if (opts.textSize)                       a._textSize         = opts.textSize
    if (opts.paddingLeft  !== undefined)     a._paddingLeft      = opts.paddingLeft
    if (opts.paddingRight !== undefined)     a._paddingRight     = opts.paddingRight
    if (opts.sizeOverride)                   a._sizeOverride     = opts.sizeOverride
    if (opts.useThemeColors !== undefined)   a._useThemeColors   = opts.useThemeColors
    if (opts.leadingIcon) {
      a._useLeadingIcon  = true
      a._leadingIcon     = opts.leadingIcon
    }
    if (opts.iconLayout)                     a._iconLayout       = opts.iconLayout
    if (opts.leadingIconSize !== undefined)  a._leadingIconSize  = opts.leadingIconSize
    if (opts.textColorOverride) {
      a._useTextColorOverride = true
      a._textColorOverride    = opts.textColorOverride
    }
    return ec
  }

  private label(
    so: SceneObject, text: string, width: number, height: number,
    opts?: {textSize?: number; align?: string; color?: vec4; fontWeight?: FontWeight}
  ): ElementContent {
    const align = opts?.align ?? "center"
    return this.content(so, {
      text, sizeOverride: new vec2(width, height), useThemeColors: false,
      textSize: opts?.textSize ?? 32, contentAlignment: align,
      textColorOverride: opts?.color, fontWeight: opts?.fontWeight ?? "regular",
      paddingLeft:  align === "left"  ? LABEL_EDGE_INSET : 0,
      paddingRight: align === "right" ? LABEL_EDGE_INSET : 0
    })
  }

  private flexColumn(
    parent: SceneObject, width: number, height: number,
    opts?: {gap?: number; padY?: number; padX?: number; justify?: FlexJustify; align?: FlexAlign}
  ): SceneObject {
    return this.makeFlex(parent, FlexDirection.Column, width, height, opts)
  }

  private flexRow(
    parent: SceneObject, width: number, height: number,
    opts?: {gap?: number; padY?: number; padX?: number; justify?: FlexJustify; align?: FlexAlign}
  ): SceneObject {
    return this.makeFlex(parent, FlexDirection.Row, width, height, opts)
  }

  private makeFlex(
    parent: SceneObject, direction: FlexDirection, width: number, height: number,
    opts?: {gap?: number; padY?: number; padX?: number; justify?: FlexJustify; align?: FlexAlign}
  ): SceneObject {
    const container = this.obj(parent, "Flex")
    this.liftInZ(container, LAYOUT_Z_LIFT)
    const fl = container.createComponent(FlexLayout.getTypeName()) as FlexLayout
    const fi = container.createComponent(FlexItem.getTypeName())   as FlexItem
    if (width  > 0) fi.overrideWidth  = width
    if (height > 0) fi.overrideHeight = height
    fl.onInitialized.add(() => {
      fl.width  = width
      fl.height = height
      fl.direction = direction
      if (direction === FlexDirection.Row) fl.columnGap = opts?.gap ?? 0
      else                                 fl.rowGap    = opts?.gap ?? 0
      fl.paddingTop    = opts?.padY ?? 0
      fl.paddingBottom = opts?.padY ?? 0
      fl.paddingLeft   = opts?.padX ?? 0
      fl.paddingRight  = opts?.padX ?? 0
      fl.justifyContent = opts?.justify ?? FlexJustify.Start
      fl.alignItems     = opts?.align   ?? FlexAlign.Stretch
    })
    return container
  }

  private flexChild(
    parent: SceneObject,
    size: {w?: number; h?: number; grow?: number},
    builder: (child: SceneObject) => void
  ): SceneObject {
    const child = this.obj(parent, "Item")
    this.liftInZ(child, LAYOUT_Z_LIFT)
    const fi = child.createComponent(FlexItem.getTypeName()) as FlexItem
    if (size.w !== undefined && size.w > 0) fi.overrideWidth  = size.w
    if (size.h !== undefined && size.h > 0) fi.overrideHeight = size.h
    fi.flexGrow   = size.grow ?? 0
    fi.flexShrink = 0
    builder(child)
    const parentFl = parent.getComponent(FlexLayout.getTypeName()) as FlexLayout | null
    if (parentFl) parentFl.addItems([fi])
    return child
  }
}
