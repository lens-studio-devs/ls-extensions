// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

import {FlexLayout} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexLayout"
import {FlexItem} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexItem"
import {
  FlexAlign,
  FlexDirection,
  FlexJustify,
} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import {BackPlate} from "SpectaclesUIKit.lspkg/Scripts/BackPlate"
import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {Switch} from "SpectaclesUIKit.lspkg/Scripts/Components/Switch/Switch"
import {Slider} from "SpectaclesUIKit.lspkg/Scripts/Components/Slider/Slider"
import {ElementContent} from "SpectaclesUIKit.lspkg/Scripts/Components/Content/ElementContent"

// ── Type scale — single source of truth (canonical + rationale: references/patterns.md → Typography)
const FONT_SIZE_SCALE = 1.0  // 1.0 = SnapOS system font; tune ≈ 0.695 / <font em ratio> after a font swap
type TextRole =
  | "Title1" | "Title2" | "HeadlineXL" | "Headline1" | "Headline2"
  | "Subheadline" | "Button" | "Callout" | "Body" | "Caption"
const TYPE_SCALE: Record<TextRole, {size: number; weight: number}> = {
  Title1: {size: 105, weight: 700}, Title2: {size: 93, weight: 700},
  HeadlineXL: {size: 62, weight: 700}, Headline1: {size: 54, weight: 700},
  Headline2: {size: 48, weight: 700}, Subheadline: {size: 41, weight: 700},
  Button: {size: 39, weight: 500}, Callout: {size: 39, weight: 700},
  Body: {size: 39, weight: 500}, Caption: {size: 38, weight: 500},
}
function roleSize(role: TextRole, distanceCm: number = 110): number {
  return TYPE_SCALE[role].size * FONT_SIZE_SCALE * (distanceCm / 110)
}
function applyTextRole(t: Text, role: TextRole, distanceCm: number = 110): void {
  t.size = roleSize(role, distanceCm)
  ;(t as Text & {weight?: number}).weight = TYPE_SCALE[role].weight
}

const PANEL_WIDTH = 30
const PAD_X = 2.0
const PAD_Y = 2.0
const ROW_HEIGHT = 3.0
const LABEL_WIDTH = 6.0
const SLIDER_WIDTH = PANEL_WIDTH - PAD_X * 2 - LABEL_WIDTH - 1.0  // -1 for SpaceBetween gap
const SLIDER_HEIGHT = 2.2
const SWITCH_WIDTH = 4.0
const SWITCH_HEIGHT = 2.0

@component
export class SettingsPanel extends BaseScriptComponent {
  onAwake() {
    this.sceneObject.createComponent("Component.Canvas")
    const backPlate = this.sceneObject.createComponent(BackPlate.getTypeName()) as BackPlate

    // Push content forward to avoid z-fighting with the BackPlate
    const contentHost = global.scene.createSceneObject("Content")
    contentHost.setParent(this.sceneObject)
    contentHost.getTransform().setLocalPosition(new vec3(0, 0, 0.6))

    const flex = contentHost.createComponent(FlexLayout.getTypeName()) as FlexLayout
    flex.width = PANEL_WIDTH
    flex.height = -1
    flex.direction = FlexDirection.Column
    flex.justifyContent = FlexJustify.Start
    flex.alignItems = FlexAlign.Stretch
    flex.rowGap = 1.6
    flex.paddingTop = PAD_Y
    flex.paddingBottom = PAD_Y
    flex.paddingLeft = PAD_X
    flex.paddingRight = PAD_X

    flex.onLayoutComplete.add((result) => {
      backPlate.size = new vec2(result.containerWidth, result.containerHeight)
    })

    this.addHeader(contentHost, "Settings")
    this.addToggleRow(contentHost, "Notifications", true)
    this.addToggleRow(contentHost, "Spatial audio", false)
    this.addSliderRow(contentHost, "Volume", 0.6)
    this.addActionRow(contentHost)
  }

  private addHeader(parent: SceneObject, label: string): void {
    const so = global.scene.createSceneObject("Header")
    so.setParent(parent)
    const innerW = PANEL_WIDTH - PAD_X * 2
    const headerH = 4.5

    const text = so.createComponent("Component.Text") as Text
    text.text = label
    text.depthTest = true
    applyTextRole(text, "Title2")   // size 93 + weight 700 — replaces the brittle TextStylePresets
    text.horizontalAlignment = HorizontalAlignment.Center
    text.verticalAlignment = VerticalAlignment.Center
    text.horizontalOverflow = HorizontalOverflow.Overflow
    text.verticalOverflow = VerticalOverflow.Overflow
    text.layoutRect = Rect.create(-innerW / 2, innerW / 2, -headerH / 2, headerH / 2)

    const item = so.createComponent(FlexItem.getTypeName()) as FlexItem
    item.marginBottom = 1.0
  }

  private addToggleRow(parent: SceneObject, label: string, initial: boolean): void {
    const row = this.makeRow(parent, `Row-${label}`)
    this.addLabel(row, label, PANEL_WIDTH - PAD_X * 2 - 6)
    const switchSO = global.scene.createSceneObject("Switch")
    switchSO.setParent(row)
    const sw = switchSO.createComponent(Switch.getTypeName()) as Switch
    // Size before initialize() for same reason as Slider — fill/knob computed once
    sw.size = new vec3(SWITCH_WIDTH, SWITCH_HEIGHT, 1)
    sw.isOn = initial
    switchSO.createComponent(FlexItem.getTypeName())
  }

  private addSliderRow(parent: SceneObject, label: string, initial: number): void {
    const row = this.makeRow(parent, `Row-${label}`)
    this.addLabel(row, label, LABEL_WIDTH)
    const sliderSO = global.scene.createSceneObject("Slider")
    sliderSO.setParent(row)
    const slider = sliderSO.createComponent(Slider.getTypeName()) as Slider
    // Set size BEFORE Slider.initialize() runs (OnStart) so the fill + knob
    // are computed against the final width. Slider does not refresh fill/knob
    // when size changes post-init — only on drag — which causes the "jank-on-spawn" bug.
    slider.size = new vec3(SLIDER_WIDTH, SLIDER_HEIGHT, 1)
    slider.currentValue = initial
    sliderSO.createComponent(FlexItem.getTypeName())
  }

  private addActionRow(parent: SceneObject): void {
    const row = global.scene.createSceneObject("Actions")
    row.setParent(parent)
    const f = row.createComponent(FlexLayout.getTypeName()) as FlexLayout
    f.direction = FlexDirection.Row
    f.alignItems = FlexAlign.Center
    f.justifyContent = FlexJustify.End
    f.columnGap = 1.5
    f.width = -1
    f.height = ROW_HEIGHT
    const rowItem = row.createComponent(FlexItem.getTypeName()) as FlexItem
    rowItem.marginTop = 0.6

    for (const text of ["Cancel", "Save"]) {
      const so = global.scene.createSceneObject(text)
      so.setParent(row)
      so.createComponent(Button.getTypeName())
      const ec = so.createComponent(ElementContent.getTypeName()) as ElementContent
      ec.text = text
      ec.autoResize = true
      so.createComponent(FlexItem.getTypeName())
    }
  }

  private makeRow(parent: SceneObject, name: string): SceneObject {
    const row = global.scene.createSceneObject(name)
    row.setParent(parent)
    const rowFlex = row.createComponent(FlexLayout.getTypeName()) as FlexLayout
    rowFlex.direction = FlexDirection.Row
    rowFlex.justifyContent = FlexJustify.SpaceBetween
    rowFlex.alignItems = FlexAlign.Center
    rowFlex.width = -1
    rowFlex.height = ROW_HEIGHT
    row.createComponent(FlexItem.getTypeName())
    return row
  }

  private addLabel(parent: SceneObject, label: string, width: number): void {
    const so = global.scene.createSceneObject("Label")
    so.setParent(parent)
    const ec = so.createComponent(ElementContent.getTypeName()) as ElementContent
    ec.text = label
    ec.textSize = roleSize("Subheadline")
    ec.contentAlignment = "left"
    ec.sizeOverride = new vec2(width, 2.4)
    so.createComponent(FlexItem.getTypeName())
  }
}
