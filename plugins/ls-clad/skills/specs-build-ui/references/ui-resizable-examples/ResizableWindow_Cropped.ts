// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

import {Frame, FrameAppearance} from "SpectaclesUIKit.lspkg/Scripts/Components/Frame/Frame"
import {ScrollWindow} from "SpectaclesUIKit.lspkg/Scripts/Components/ScrollWindow/ScrollWindow"
import {BackPlate} from "SpectaclesUIKit.lspkg/Scripts/BackPlate"
import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {ElementContent} from "SpectaclesUIKit.lspkg/Scripts/Components/Content/ElementContent"

/**
 * Sample 5 — Resizable window with VIEWPORT CROPPING (Chrome-window behavior).
 *
 *   [Frame]            ← drag + corner-resize handles (no content scaling)
 *     └─[ScrollWindow] ← stencil-clips children to windowSize = frame.innerSize
 *          └─[content] ← BackPlate + buttons + labels at fixed sizes; the
 *                         window crops what's visible as you resize.
 *
 * Auto-creates everything. Demo content is intentionally larger than the
 * initial window so cropping is visible immediately.
 */

const FONT_BOLD: Font = requireAsset("../../../Fonts/SpecsSans-Bold.otf") as Font
const FONT_REGULAR: Font = requireAsset("../../../Fonts/SpecsSans-Regular.otf") as Font

const CONTENT_SIZE: vec2 = new vec2(36, 32)   // demo content is larger than the cropping area so cropping is visible
const CONTENT_Z_OFFSET = 0.1                  // push content forward to avoid z-fighting with the frame

@component
export class ResizableWindow_Cropped extends BaseScriptComponent {
  @input("vec2", "{32,22}")
  @hint("Outer size of the frame in cm (the overall window border).")
  frameSize: vec2 = new vec2(32, 22)

  @input("vec2", "{30,20}")
  @hint("Inner cropping viewport in cm. Content is stencil-clipped to this area. Padding = (frameSize - croppingSize) / 2.")
  croppingSize: vec2 = new vec2(30, 20)

  @input
  @hint("Lock height to the initial aspect ratio when resizing.")
  lockAspectRatio: boolean = false

  @input
  @hint("Auto-hide on hover. Off (default) = always visible.")
  autoShowHide: boolean = false

  private frame: Frame | null = null
  private scrollWindow: ScrollWindow | null = null
  private aspectRatio: number = 1
  private applyingAspectLock: boolean = false

  onAwake() {
    // Canvas at the panel root in SortingType.Hierarchy (the default). DFS over
    // the SceneObject subtree owns paint order — no `renderOrder` anywhere.
    this.sceneObject.createComponent("Component.Canvas")
    this.createEvent("OnStartEvent").bind(() => this.initialize())
  }

  private initialize() {
    const root = this.sceneObject

    // ── Frame: window border, drag/resize handles ─────────────────────────
    // Padding is the gap between the cropping viewport edge and the frame
    // outer edge: (frameSize - croppingSize) / 2 per axis, clamped at zero.
    const padX = Math.max(0, (this.frameSize.x - this.croppingSize.x) / 2)
    const padY = Math.max(0, (this.frameSize.y - this.croppingSize.y) / 2)
    const padding = new vec2(padX, padY)

    const frame = root.createComponent(Frame.getTypeName()) as Frame
    ;(frame as any)._innerSize = this.croppingSize
    ;(frame as any)._padding = padding
    // Set the appearance enum BEFORE init runs, but don't trigger the public
    // setter — that writes to the shader, which doesn't exist yet.
    ;(frame as any)._appearance = FrameAppearance.Small
    this.frame = frame

    // ── ScrollWindow: stencil-clips children to windowSize ────────────────
    // Pushed forward in Z so its content doesn't co-plane with the frame's
    // glass material (which causes flicker/artifacts).
    const scrollObj = this.makeChild(root, "CroppedContent", new vec3(0, 0, CONTENT_Z_OFFSET))
    const sw = scrollObj.createComponent(ScrollWindow.getTypeName()) as ScrollWindow
    // Vertical-only: this demo content is a button column. Other examples
    // (e.g., carousels) will configure their own scroll axes when adapted.
    ;(sw as any)._vertical = true
    ;(sw as any)._horizontal = false
    ;(sw as any)._windowSize = this.croppingSize.uniformScale(1)
    ;(sw as any)._scrollDimensions = new vec2(this.croppingSize.x, CONTENT_SIZE.y)
    this.scrollWindow = sw

    this.buildDemoContent(scrollObj)

    // ── Configure the Frame for drag + non-uniform resize ─────────────────
    const apply = () => {
      frame.allowTranslation = true
      frame.allowNonUniformScaling = true
      frame.autoScaleContent = false
      frame.autoShowHide = this.autoShowHide
      if (!this.autoShowHide) frame.showVisual()

      // Drag from the border only — interior stays free for content interaction.
      frame.onlyInteractOnBorder = true
      // Clamp max to the starting cropping size — user can shrink to reveal
      // cropping but cannot grow the window past where it started.
      frame.maximumSize = this.croppingSize

      this.aspectRatio = this.croppingSize.x / Math.max(this.croppingSize.y, 0.001)

      frame.onScalingUpdate.add(() => {
        if (this.lockAspectRatio) this.enforceAspect(frame)
        if (this.scrollWindow) this.scrollWindow.windowSize = frame.innerSize
      })
    }

    if (frame.roundedRectangle) apply()
    else frame.onInitialized.add(apply)
  }

  // ── Demo content: BackPlate background + title + button list ────────────
  // All sized larger than the initial window so cropping is visible at every
  // edge. Real UI components (BackPlate, Button, ElementContent text) test
  // that the stencil mask correctly clips visuals AND text.
  private buildDemoContent(parent: SceneObject) {
    // Full-size dark background plate (50×40).
    const plateObj = this.makeChild(parent, "Background", new vec3(0, 0, 0))
    const plate = plateObj.createComponent(BackPlate.getTypeName()) as BackPlate
    plate.style = "dark"
    plate.size = CONTENT_SIZE

    // Title text near the top of the content (well inside, but offset enough
    // that shrinking the window will eventually crop it).
    const titleObj = this.makeChild(parent, "Title", new vec3(0, CONTENT_SIZE.y / 2 - 2.5, 0.05))
    const title = titleObj.createComponent(ElementContent.getTypeName()) as ElementContent
    const a = title as any
    a._font = FONT_BOLD
    a._text = "Drag corners to crop"
    a._textSize = this.roleSize("Headline1")
    a._contentAlignment = "center"
    a._sizeOverride = new vec2(CONTENT_SIZE.x - 2, 3)
    a._useThemeColors = false
    a._useTextColorOverride = true
    a._textColorOverride = new vec4(1, 1, 1, 1)
    // Z gap separates the ElementContent label from the Frame backing (depth tie-
    // break). Paint order = Canvas Hierarchy DFS, no manual renderOrder.
    a._zOffset = 0.05

    // A column of labeled buttons. Width is slightly larger than the initial
    // window (32 vs 30) so horizontal cropping is just visible at the start;
    // total column height exceeds the window so vertical cropping is obvious.
    const itemW = 32
    const itemH = 3.2
    const itemGap = 0.6
    const itemCount = 8
    const columnTopY = CONTENT_SIZE.y / 2 - 6
    for (let i = 0; i < itemCount; i++) {
      const y = columnTopY - i * (itemH + itemGap)
      const itemObj = this.makeChild(parent, `Item${i}`, new vec3(0, y, 0.05))
      const btn = itemObj.createComponent(Button.getTypeName()) as Button
      const b = btn as any
      b._themeOverride = "SnapOS2"
      b._shapeSnapOS2 = "Rectangle"
      b._styleSnapOS2 = i % 2 === 0 ? "PrimaryNeutral" : "Primary"
      b._size = new vec3(itemW, itemH, 1)
      btn.initialize()

      const label = itemObj.createComponent(ElementContent.getTypeName()) as ElementContent
      const la = label as any
      la._font = FONT_REGULAR
      la._text = `Row ${i + 1}`
      la._textSize = this.roleSize("Body")
      la._contentAlignment = "left"
      la._paddingLeft = 1.2
      la._sizeOverride = new vec2(itemW, itemH)
      la._useThemeColors = false
      la._useTextColorOverride = true
      la._textColorOverride = new vec4(1, 1, 1, 1)
      la._zOffset = 0.08

      btn.onTriggerUp.add(() => print(`Cropped: tapped Row ${i + 1}`))
    }
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

  private makeChild(parent: SceneObject, name: string, position: vec3): SceneObject {
    const so = global.scene.createSceneObject(name)
    so.setParent(parent)
    so.layer = parent.layer
    so.getTransform().setLocalPosition(position)
    return so
  }

  private enforceAspect(frame: Frame) {
    if (this.applyingAspectLock) return
    const cur = frame.innerSize
    const expectedY = cur.x / this.aspectRatio
    if (Math.abs(expectedY - cur.y) < 0.01) return
    this.applyingAspectLock = true
    frame.innerSize = new vec2(cur.x, expectedY)
    this.applyingAspectLock = false
  }
}
