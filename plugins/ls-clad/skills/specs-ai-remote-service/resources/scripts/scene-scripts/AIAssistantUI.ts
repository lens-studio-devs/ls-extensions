// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * AIAssistantUI – Transcript panel + Hold to Talk button UI module
 *
 * Builds:
 *  - A transcript BackPlate panel showing conversation history
 *  - A "Hold to Talk" capsule button below
 *
 * Exports buildUI() and UIElements interface for use by AIAssistant.ts
 */

import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {BackPlate} from "SpectaclesUIKit.lspkg/Scripts/BackPlate"
import {ElementContent} from "SpectaclesUIKit.lspkg/Scripts/Components/Content/ElementContent"
import {FlexItem} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexItem"
import {FlexLayout} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexLayout"
import {FlexAlign, FlexDirection, FlexJustify} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import {Billboard} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Billboard/Billboard"

// ── Fonts ──────────────────────────────────────────────────────────────────────
const FONT_LIGHT: Font = requireAsset("../Fonts/SpecsSans-Light.otf") as Font
const FONT_REGULAR: Font = requireAsset("../Fonts/SpecsSans-Regular.otf") as Font
const FONT_MEDIUM: Font = requireAsset("../Fonts/SpecsSans-Medium.otf") as Font
const FONT_BOLD: Font = requireAsset("../Fonts/SpecsSans-Bold.otf") as Font

type FontWeight = "light" | "regular" | "medium" | "bold"

function fontForWeight(weight: FontWeight): Font {
  switch (weight) {
    case "light":   return FONT_LIGHT
    case "regular": return FONT_REGULAR
    case "medium":  return FONT_MEDIUM
    case "bold":    return FONT_BOLD
  }
}

// ── Z-ordering constants ───────────────────────────────────────────────────────
const CONTENT_Z_OFFSET = 0.08
const CONTENT_RENDER_ORDER_OFFSET = 8
const LAYOUT_Z_LIFT = 0.02
const PANEL_CONTENT_Z_LIFT = 0.01
const DYNAMIC_TEXT_Z_OFFSET = 0.15
const LABEL_EDGE_INSET = 0.75
const FRAME_PADDING = new vec2(2.2, 2.2)

// ── Public interface ───────────────────────────────────────────────────────────
export interface UIElements {
  /** The Hold to Talk button — subscribe to onTriggerStart / onTriggerEnd */
  holdToTalkButton: Button
  /** Call this to update transcript lines; max 6 lines shown */
  setTranscript: (lines: string[]) => void
  /** Show/hide the "Listening…" indicator on the button */
  setListening: (active: boolean) => void
  /** Root UI scene object */
  root: SceneObject
}

// ── Builder ────────────────────────────────────────────────────────────────────
export function buildUI(script: BaseScriptComponent, parent: SceneObject): UIElements {
  const ui = new _UIBuilder(script, parent)
  return ui.build()
}

class _UIBuilder {
  private script: BaseScriptComponent
  private parent: SceneObject

  // Transcript text components — up to 6 lines, updatable at runtime
  private transcriptLines: Text[] = []
  private buttonLabelContent: ElementContent | null = null
  private holdToTalkButton!: Button

  constructor(script: BaseScriptComponent, parent: SceneObject) {
    this.script = script
    this.parent = parent
  }

  build(): UIElements {
    // ── Root panel container ─────────────────────────────────────────────────
    const root = this.obj(this.parent, "AIAssistantUI", new vec3(0, 0, -110))

    // Add Billboard so panel always faces camera
    root.createComponent(Billboard.getTypeName())

    // ── Transcript panel (BackPlate, dark style) ──────────────────────────────
    // Position slightly above center
    const transcriptRoot = this.obj(root, "TranscriptRoot", new vec3(0, 8, 0))
    const transcriptPlate = transcriptRoot.createComponent(BackPlate.getTypeName()) as BackPlate
    ;(transcriptPlate as any).style = "dark"
    ;(transcriptPlate as any).size = new vec2(38, 24)

    const transcriptContent = this.obj(transcriptRoot, "TranscriptContent", new vec3(0, 0, PANEL_CONTENT_Z_LIFT))

    // Flex column for transcript lines
    const col = this.flexColumn(transcriptContent, 36, 22, {
      justify: FlexJustify.Start,
      align: FlexAlign.Stretch,
      padX: 1.2,
      padY: 1.0,
      gap: 0.5
    })

    // Title row
    this.flexChild(col, {w: 34, h: 2.5}, (titleObj) => {
      this.content(titleObj, {
        text: "AI Assistant",
        textSize: 26,
        fontWeight: "bold",
        contentAlignment: "left"
      })
    })

    // Separator hint
    this.flexChild(col, {w: 34, h: 0.5}, (_sep) => {
      // intentionally empty — visual gap
    })

    // 6 transcript line slots (runtime-updatable plain Text)
    for (let i = 0; i < 6; i++) {
      this.flexChild(col, {w: 34, h: 2.8}, (lineObj) => {
        const tc = this.dynamicText(lineObj, `Line${i}`, "", 22,
          new vec3(0, 0, DYNAMIC_TEXT_Z_OFFSET),
          new vec4(1, 1, 1, i < 2 ? 1.0 : 0.75),
          FONT_LIGHT,
          HorizontalAlignment.Left)
        tc.horizontalOverflow = HorizontalOverflow.Wrap
        tc.verticalOverflow = VerticalOverflow.Overflow
        this.transcriptLines.push(tc)
      })
    }

    // ── Hold to Talk button ───────────────────────────────────────────────────
    const btnRoot = this.obj(root, "HoldToTalkRoot", new vec3(0, -20, 0))
    const button = this.btn(btnRoot, "Primary", "Capsule", 24, 5.5)
    this.holdToTalkButton = button

    // Button label via ElementContent (static — changes are via setListening)
    this.buttonLabelContent = this.content(btnRoot, {
      text: "Hold to Talk",
      textSize: 28,
      fontWeight: "medium",
      contentAlignment: "center"
    })

    // ── Status indicator (small label below button) ───────────────────────────
    const statusRoot = this.obj(root, "StatusRoot", new vec3(0, -26, 0))
    const _statusTC = this.dynamicText(statusRoot, "Status", "", 20,
      new vec3(0, 0, DYNAMIC_TEXT_Z_OFFSET),
      new vec4(0.45, 0.9, 0.55, 1),
      FONT_LIGHT)

    const self = this
    return {
      holdToTalkButton: button,
      root,
      setTranscript: (lines: string[]) => {
        for (let i = 0; i < 6; i++) {
          const tc = self.transcriptLines[i]
          if (tc) {
            tc.text = lines[i] ?? ""
          }
        }
      },
      setListening: (active: boolean) => {
        if (self.buttonLabelContent) {
          ;(self.buttonLabelContent as any).text = active ? "Listening…" : "Hold to Talk"
        }
        ;(_statusTC as Text).text = active ? "Recording…" : ""
      }
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
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

  private btn(so: SceneObject, style: string, shape: string, width: number, height: number): Button {
    const button = so.createComponent(Button.getTypeName()) as Button
    const b = button as any
    b._themeOverride = "SnapOS2"
    b._shapeSnapOS2 = shape
    b._styleSnapOS2 = style
    b._size = new vec3(width, height, 1)
    button.initialize()
    return button
  }

  private content(so: SceneObject, opts: {
    text?: string
    textSize?: number
    fontWeight?: FontWeight
    contentAlignment?: string
    paddingLeft?: number
    paddingRight?: number
    sizeOverride?: vec2
  }): ElementContent {
    const ec = so.createComponent(ElementContent.getTypeName()) as ElementContent
    const e = ec as any
    e._zOffset = CONTENT_Z_OFFSET
    e._renderOrderOffset = CONTENT_RENDER_ORDER_OFFSET
    e._font = fontForWeight(opts.fontWeight ?? "regular")
    if (opts.text !== undefined) e._text = opts.text
    if (opts.contentAlignment) e._contentAlignment = opts.contentAlignment
    if (opts.textSize) e._textSize = opts.textSize
    if (opts.paddingLeft !== undefined) e._paddingLeft = opts.paddingLeft
    if (opts.paddingRight !== undefined) e._paddingRight = opts.paddingRight
    if (opts.sizeOverride) e._sizeOverride = opts.sizeOverride
    return ec
  }

  private dynamicText(parent: SceneObject, name: string, text: string, size: number,
    localPos: vec3, color: vec4, font: Font,
    hAlign: HorizontalAlignment = HorizontalAlignment.Center): Text {
    const textObj = this.obj(parent, name, localPos)
    const tc = textObj.createComponent("Component.Text") as Text
    tc.text = text
    tc.size = size
    tc.textFill.color = color
    tc.font = font
    tc.horizontalAlignment = hAlign
    tc.verticalAlignment = VerticalAlignment.Center
    tc.horizontalOverflow = HorizontalOverflow.Overflow
    tc.verticalOverflow = VerticalOverflow.Overflow
    // Text uses BaseMeshVisual (not MaterialMeshVisual) — depth control via cast to any
    const tcAny = tc as any
    if (typeof tcAny.getMaterial === "function") {
      try {
        const pass = tcAny.getMaterial(0).mainPass
        pass.depthTest = true
        pass.depthWrite = true
      } catch (_) {
        // depth control not available on this Text variant — no-op
      }
    }
    return tc
  }

  private flexColumn(parent: SceneObject, width: number, height: number,
    opts?: {gap?: number, padY?: number, padX?: number, justify?: FlexJustify, align?: FlexAlign}): SceneObject {
    return this.makeFlex(parent, FlexDirection.Column, width, height, opts)
  }

  private makeFlex(parent: SceneObject, direction: FlexDirection, width: number, height: number,
    opts?: {gap?: number, padY?: number, padX?: number, justify?: FlexJustify, align?: FlexAlign}): SceneObject {
    const container = this.obj(parent, "Flex")
    this.liftInZ(container, LAYOUT_Z_LIFT)
    const flexLayout = container.createComponent(FlexLayout.getTypeName()) as FlexLayout
    const flexItem = container.createComponent(FlexItem.getTypeName()) as FlexItem
    if (width > 0) flexItem.overrideWidth = width
    if (height > 0) flexItem.overrideHeight = height

    flexLayout.onInitialized.add(() => {
      flexLayout.width = width
      flexLayout.height = height
      flexLayout.direction = direction
      if (direction === FlexDirection.Row) {
        flexLayout.columnGap = opts?.gap ?? 0
      } else {
        flexLayout.rowGap = opts?.gap ?? 0
      }
      flexLayout.paddingTop = opts?.padY ?? 0
      flexLayout.paddingBottom = opts?.padY ?? 0
      flexLayout.paddingLeft = opts?.padX ?? 0
      flexLayout.paddingRight = opts?.padX ?? 0
      flexLayout.justifyContent = opts?.justify ?? FlexJustify.Start
      flexLayout.alignItems = opts?.align ?? FlexAlign.Stretch
    })
    return container
  }

  private flexChild(parent: SceneObject, size: {w?: number, h?: number, grow?: number},
    builder: (childObject: SceneObject) => void): SceneObject {
    const child = this.obj(parent, "Item")
    this.liftInZ(child, LAYOUT_Z_LIFT)
    const flexItem = child.createComponent(FlexItem.getTypeName()) as FlexItem
    if (size.w !== undefined && size.w > 0) flexItem.overrideWidth = size.w
    if (size.h !== undefined && size.h > 0) flexItem.overrideHeight = size.h
    flexItem.flexGrow = size.grow ?? 0
    flexItem.flexShrink = 0
    builder(child)
    return child
  }
}
