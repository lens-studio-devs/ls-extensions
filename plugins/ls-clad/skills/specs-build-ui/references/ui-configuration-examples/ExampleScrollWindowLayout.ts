// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {ElementContent} from "SpectaclesUIKit.lspkg/Scripts/Components/Content/ElementContent"
import {Frame, FrameAppearance} from "SpectaclesUIKit.lspkg/Scripts/Components/Frame/Frame"
import {FlexItem} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexItem"
import {FlexLayout} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexLayout"
import {FlexAlign, FlexDirection, FlexJustify} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import {ScrollWindow} from "SpectaclesUIKit.lspkg/Scripts/Components/ScrollWindow/ScrollWindow"
import {Billboard} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Billboard/Billboard"

const FONT_LIGHT: Font = requireAsset("../../Fonts/SpecsSans-Light.otf") as Font
const FONT_REGULAR: Font = requireAsset("../../Fonts/SpecsSans-Regular.otf") as Font
const FONT_MEDIUM: Font = requireAsset("../../Fonts/SpecsSans-Medium.otf") as Font
const FONT_BOLD: Font = requireAsset("../../Fonts/SpecsSans-Bold.otf") as Font

type FontWeight = "light" | "regular" | "medium" | "bold"

const CONTENT_Z_OFFSET = 0.08
const LAYOUT_Z_LIFT = 0.02
const DYNAMIC_TEXT_Z_OFFSET = 0.15
const LABEL_EDGE_INSET = 0.75
const PANEL_CONTENT_Z_LIFT = 0.01
const FRAME_PADDING = new vec2(2.2, 2.2)

const WINDOW_WIDTH = 26
const WINDOW_HEIGHT = 18
const ITEM_HEIGHT = 5
const ITEM_COUNT = 8
const ITEM_GAP = 0.6

/**
 * Programmatic example: Scroll Window Layout
 *
 * Builds a ScrollWindow with a list of tappable items.
 * The scroll dimensions are calculated from item count and height.
 * No @input wiring — the full UI hierarchy is created in buildUI().
 */
@component
export class ExampleScrollWindowLayout extends BaseScriptComponent {
  @input
  @hint("Outer size of the frame border in cm.")
  frameSize: vec2 = new vec2(32, 28)

  @input
  @hint("Inner cropping viewport in cm. Padding = (frameSize - croppingSize) / 2.")
  croppingSize: vec2 = new vec2(30, 26)

  @input
  @hint("Lock height to the initial aspect ratio when resizing.")
  lockAspectRatio: boolean = false

  @input
  @hint("Auto-hide on hover. Off (default) = window is always visible.")
  autoShowHide: boolean = false

  @input
  @hint("Show the × close button on the frame.")
  showCloseButton: boolean = true

  @input
  @hint("Show the follow / grip button on the frame.")
  showFollowButton: boolean = true

  onAwake(): void {
    // Canvas at the panel root in SortingType.Hierarchy (the default). DFS over
    // the SceneObject subtree owns paint order — no `renderOrder` anywhere.
    this.sceneObject.createComponent("Component.Canvas")
    this.createEvent("OnStartEvent").bind(() => this.buildUI())
  }

  private buildUI(): void {
    const root = this.getSceneObject()
    root.createComponent(Billboard.getTypeName())
    root.getTransform().setWorldPosition(new vec3(0, 0, -110))

    const panelContent = this.scenePanel(root, "ScrollWindowPanel", this.frameSize, this.croppingSize)
    const outer = this.flexColumn(panelContent, 28, 24, {gap: 0.8, padX: 1, padY: 0.5})

    // Title
    this.flexChild(outer, {w: 26, h: 3}, (t) => {
      this.label(t, "Scroll Window", 26, 3, {textSize: this.roleSize("Headline1"), align: "left", fontWeight: "bold"})
    })

    // ScrollWindow container
    this.flexChild(outer, {w: WINDOW_WIDTH, h: WINDOW_HEIGHT}, (scrollContainer) => {
      const sw = scrollContainer.createComponent(ScrollWindow.getTypeName()) as ScrollWindow
      const totalScrollHeight = ITEM_COUNT * (ITEM_HEIGHT + ITEM_GAP) - ITEM_GAP
      ;(sw as any)._vertical = true
      ;(sw as any)._horizontal = false
      ;(sw as any)._windowSize = new vec2(WINDOW_WIDTH, WINDOW_HEIGHT)
      ;(sw as any)._scrollDimensions = new vec2(WINDOW_WIDTH, totalScrollHeight)
      ;(sw as any)._edgeFade = true

      // Scrollable content — a vertical list of buttons
      const listContainer = this.obj(scrollContainer, "ScrollContent")
      const list = this.flexColumn(listContainer, WINDOW_WIDTH, totalScrollHeight, {gap: ITEM_GAP})

      for (let i = 0; i < ITEM_COUNT; i++) {
        const itemLabel = `Item ${i + 1}`
        this.flexChild(list, {w: WINDOW_WIDTH, h: ITEM_HEIGHT}, (itemObj) => {
          const btn = this.btn(itemObj, "PrimaryNeutral", "Rectangle", WINDOW_WIDTH, ITEM_HEIGHT)
          this.content(itemObj, {
            text: itemLabel,
            textSize: this.roleSize("Button"),   // list-item button label
            fontWeight: "medium",
            contentAlignment: "left",
            paddingLeft: 1.5
          })
          btn.onTriggerUp.add(() => {
            print(`ScrollWindow: tapped "${itemLabel}"`)
          })
        })
      }
    })
  }

  // ─── Composition helpers ───────────────────────────────────────────────

  private fontForWeight(weight: FontWeight): Font {
    switch (weight) {
      case "light": return FONT_LIGHT
      case "medium": return FONT_MEDIUM
      case "bold": return FONT_BOLD
      default: return FONT_REGULAR
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
  // during onScalingStart..onScalingEnd so inner ScrollWindow gestures are
  // never blocked. See Scripts/UI/ResizableSamples/ResizableWindow_Cropped.ts.
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
    ;(button as any)._shapeSnapOS2 = shape
    ;(button as any)._styleSnapOS2 = style
    ;(button as any)._size = new vec3(width, height, 1)
    button.initialize()
    return button
  }

  // Type-scale role → text size @ z=-110 (110cm). Pick by role, never a raw number.
  // Full scale + rationale: references/spectacles-spatial-design.md → Typography.
  private roleSize(role: string): number {
    switch (role) {
      case "Title1":      return 105
      case "Title2":      return 93
      case "HeadlineXL":  return 62
      case "Headline1":   return 54
      case "Headline2":   return 48
      case "Subheadline": return 41
      case "Button":      return 39
      case "Callout":     return 39
      case "Body":        return 39
      case "Caption":     return 38
      default:            return 39
    }
  }

  private content(
    so: SceneObject,
    opts: {
      text?: string; contentAlignment?: string; textSize?: number;
      paddingLeft?: number; paddingRight?: number; sizeOverride?: vec2
      useThemeColors?: boolean; textColorOverride?: vec4; fontWeight?: FontWeight
    }
  ): ElementContent {
    const ec = so.createComponent(ElementContent.getTypeName()) as ElementContent
    const a = ec as any
    // Z gap alone separates ElementContent from the button backing (depth-buffer
    // tie-break). Paint order comes from Canvas Hierarchy DFS — no renderOrder.
    a._zOffset = CONTENT_Z_OFFSET
    a._font = this.fontForWeight(opts.fontWeight ?? "regular")
    if (opts.text !== undefined) a._text = opts.text
    if (opts.contentAlignment) a._contentAlignment = opts.contentAlignment
    if (opts.textSize) a._textSize = opts.textSize
    if (opts.paddingLeft !== undefined) a._paddingLeft = opts.paddingLeft
    if (opts.paddingRight !== undefined) a._paddingRight = opts.paddingRight
    if (opts.sizeOverride) a._sizeOverride = opts.sizeOverride
    if (opts.useThemeColors !== undefined) a._useThemeColors = opts.useThemeColors
    if (opts.textColorOverride) { a._useTextColorOverride = true; a._textColorOverride = opts.textColorOverride }
    return ec
  }

  private label(
    so: SceneObject, text: string, width: number, height: number,
    opts?: {textSize?: number; align?: string; color?: vec4; fontWeight?: FontWeight}
  ): ElementContent {
    const align = opts?.align ?? "center"
    return this.content(so, {
      text, sizeOverride: new vec2(width, height), useThemeColors: false,
      textSize: opts?.textSize ?? this.roleSize("Caption"), contentAlignment: align,
      textColorOverride: opts?.color, fontWeight: opts?.fontWeight ?? "regular",
      paddingLeft: align === "left" ? LABEL_EDGE_INSET : 0,
      paddingRight: align === "right" ? LABEL_EDGE_INSET : 0
    })
  }

  private flexColumn(
    parent: SceneObject, width: number, height: number,
    opts?: {gap?: number; padY?: number; padX?: number; justify?: FlexJustify; align?: FlexAlign}
  ): SceneObject {
    return this.makeFlex(parent, FlexDirection.Column, width, height, opts)
  }

  private makeFlex(
    parent: SceneObject, direction: FlexDirection, width: number, height: number,
    opts?: {gap?: number; padY?: number; padX?: number; justify?: FlexJustify; align?: FlexAlign}
  ): SceneObject {
    const container = this.obj(parent, "Flex")
    this.liftInZ(container, LAYOUT_Z_LIFT)
    const fl = container.createComponent(FlexLayout.getTypeName()) as FlexLayout
    const fi = container.createComponent(FlexItem.getTypeName()) as FlexItem
    if (width > 0) fi.overrideWidth = width
    if (height > 0) fi.overrideHeight = height
    fl.onInitialized.add(() => {
      fl.width = width; fl.height = height; fl.direction = direction
      if (direction === FlexDirection.Row) fl.columnGap = opts?.gap ?? 0
      else fl.rowGap = opts?.gap ?? 0
      fl.paddingTop = opts?.padY ?? 0; fl.paddingBottom = opts?.padY ?? 0
      fl.paddingLeft = opts?.padX ?? 0; fl.paddingRight = opts?.padX ?? 0
      fl.justifyContent = opts?.justify ?? FlexJustify.Start
      fl.alignItems = opts?.align ?? FlexAlign.Stretch
    })
    return container
  }

  private flexChild(
    parent: SceneObject, size: {w?: number; h?: number; grow?: number},
    builder: (child: SceneObject) => void
  ): SceneObject {
    const child = this.obj(parent, "Item")
    this.liftInZ(child, LAYOUT_Z_LIFT)
    const fi = child.createComponent(FlexItem.getTypeName()) as FlexItem
    if (size.w !== undefined && size.w > 0) fi.overrideWidth = size.w
    if (size.h !== undefined && size.h > 0) fi.overrideHeight = size.h
    fi.flexGrow = size.grow ?? 0
    fi.flexShrink = 0
    builder(child)
    const parentFl = parent.getComponent(FlexLayout.getTypeName()) as FlexLayout | null
    if (parentFl) parentFl.addItems([fi])
    return child
  }
}
