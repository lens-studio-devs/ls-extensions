// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

import {FlexLayout} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexLayout"
import {FlexItem} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexItem"
import {
  FlexAlign,
  FlexAlignSelf,
  FlexDirection,
  FlexJustify,
} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import {Frame} from "SpectaclesUIKit.lspkg/Scripts/Components/Frame/Frame"
import {ContentVerticalAlignment} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/LayoutTypes"
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

const PANEL_W = 42
const PANEL_H = 28
const PAD = 1.8
const ROW_HEIGHT = 3.2
const LABEL_WIDTH = 14
const SWITCH_W = 4.0
const SWITCH_H = 2.0
const SLIDER_HEIGHT = 1.6
const SLIDER_WIDTH = PANEL_W - PAD * 2 - LABEL_WIDTH - 1.5

type TabBuilder = (pane: SceneObject) => void

@component
export class TabbedSettings extends BaseScriptComponent {
  private tabBuilders: TabBuilder[] = []
  private tabButtons: Button[] = []
  private contentHost: SceneObject | null = null
  private currentPane: SceneObject | null = null
  private activeTab: number = 0

  onAwake() {
    this.sceneObject.createComponent("Component.Canvas")
    const frame = this.sceneObject.createComponent(Frame.getTypeName()) as Frame
    frame.autoShowHide = false
    frame.autoScaleContent = false
    frame.allowScaling = false

    frame.onInitialized.add(() => {
      frame.innerSize = new vec2(PANEL_W, PANEL_H)
      frame.padding = new vec2(PAD, PAD)
      this.buildContent(frame.contentTransform.getSceneObject())
    })
  }

  private buildContent(host: SceneObject): void {
    const content = global.scene.createSceneObject("Content")
    content.setParent(host)
    content.getTransform().setLocalPosition(new vec3(0, 0, 0.6))

    const col = content.createComponent(FlexLayout.getTypeName()) as FlexLayout
    col.width = PANEL_W
    col.height = PANEL_H
    col.direction = FlexDirection.Column
    col.alignItems = FlexAlign.Stretch
    col.justifyContent = FlexJustify.Start
    col.rowGap = 1.4
    col.paddingTop = PAD
    col.paddingBottom = PAD
    col.paddingLeft = PAD
    col.paddingRight = PAD

    this.contentHost = content
    this.addHeader(content, "Settings")
    this.addTabRow(content, ["General", "Display", "Audio"])

    // Tab definitions: builder per tab
    this.tabBuilders = [
      (pane) => {
        this.addToggleRow(pane, "Auto-update", true)
        this.addToggleRow(pane, "Send analytics", false)
        this.addToggleRow(pane, "Show tips", true)
      },
      (pane) => {
        this.addSliderRow(pane, "Brightness", 0.7)
        this.addSliderRow(pane, "Contrast", 0.5)
        this.addToggleRow(pane, "Dark mode", true)
      },
      (pane) => {
        this.addSliderRow(pane, "Volume", 0.6)
        this.addToggleRow(pane, "Spatial audio", true)
        this.addToggleRow(pane, "Mute alerts", false)
      },
    ]

    this.showTab(0)
  }

  private addHeader(parent: SceneObject, label: string): void {
    const so = global.scene.createSceneObject("Header")
    so.setParent(parent)
    const innerW = PANEL_W - PAD * 2
    const headerH = 3.6

    const t = so.createComponent("Component.Text") as Text
    t.text = label
    t.depthTest = true
    applyTextRole(t, "HeadlineXL") // panel header
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Overflow
    t.verticalOverflow = VerticalOverflow.Overflow
    t.layoutRect = Rect.create(-innerW / 2, innerW / 2, -headerH / 2, headerH / 2)

    so.createComponent(FlexItem.getTypeName())
  }

  private addTabRow(parent: SceneObject, labels: string[]): void {
    const row = global.scene.createSceneObject("Tabs")
    row.setParent(parent)
    const flex = row.createComponent(FlexLayout.getTypeName()) as FlexLayout
    flex.direction = FlexDirection.Row
    flex.alignItems = FlexAlign.Center
    flex.justifyContent = FlexJustify.Start
    flex.columnGap = 1.0
    flex.width = -1
    flex.height = -1
    row.createComponent(FlexItem.getTypeName())

    for (let i = 0; i < labels.length; i++) {
      const btnSO = global.scene.createSceneObject(`Tab-${labels[i]}`)
      btnSO.setParent(row)
      const btn = btnSO.createComponent(Button.getTypeName()) as Button
      btn.setIsToggleable(true)
      const ec = btnSO.createComponent(ElementContent.getTypeName()) as ElementContent
      ec.text = labels[i]
      ec.autoResize = true
      btnSO.createComponent(FlexItem.getTypeName())

      const tabIndex = i
      // Element exposes trigger events directly — `interactable` is undefined until OnStart.
      btn.onTriggerUp.add(() => this.showTab(tabIndex))
      this.tabButtons.push(btn)
    }

    // Extra breathing room below tab row before content panes
    const rowItem = row.getComponent(FlexItem.getTypeName()) as FlexItem
    if (rowItem) rowItem.marginBottom = 1.8
  }

  private showTab(index: number): void {
    if (!this.contentHost) return
    this.activeTab = index

    // Destroy previous pane (changes child count, which triggers the column
    // FlexLayout to re-discover children and re-layout — it doesn't react to
    // enabled toggles, only to count changes).
    if (this.currentPane) {
      this.currentPane.destroy()
      this.currentPane = null
    }

    // Build the new pane
    const pane = global.scene.createSceneObject(`Pane-${index}`)
    pane.setParent(this.contentHost)
    const flex = pane.createComponent(FlexLayout.getTypeName()) as FlexLayout
    flex.direction = FlexDirection.Column
    flex.alignItems = FlexAlign.Stretch
    flex.verticalAlignment = ContentVerticalAlignment.Top
    flex.rowGap = 1.2
    flex.width = -1
    flex.height = -1
    const item = pane.createComponent(FlexItem.getTypeName()) as FlexItem
    item.alignSelf = FlexAlignSelf.Stretch
    item.setFlex(1)
    this.tabBuilders[index](pane)
    this.currentPane = pane

    for (let i = 0; i < this.tabButtons.length; i++) {
      this.tabButtons[i].isOn = i === index
    }
  }

  // ─── Row helpers (same patterns as SettingsPanel) ─────────────────────

  private makeRow(parent: SceneObject, name: string): SceneObject {
    const row = global.scene.createSceneObject(name)
    row.setParent(parent)
    const f = row.createComponent(FlexLayout.getTypeName()) as FlexLayout
    f.direction = FlexDirection.Row
    f.justifyContent = FlexJustify.SpaceBetween
    f.alignItems = FlexAlign.Center
    f.width = -1
    f.height = ROW_HEIGHT
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

  private addToggleRow(parent: SceneObject, label: string, initial: boolean): void {
    const row = this.makeRow(parent, `Row-${label}`)
    this.addLabel(row, label, LABEL_WIDTH)
    const swSO = global.scene.createSceneObject("Switch")
    swSO.setParent(row)
    const sw = swSO.createComponent(Switch.getTypeName()) as Switch
    sw.size = new vec3(SWITCH_W, SWITCH_H, 1)
    sw.isOn = initial
    swSO.createComponent(FlexItem.getTypeName())
  }

  private addSliderRow(parent: SceneObject, label: string, initial: number): void {
    const row = this.makeRow(parent, `Row-${label}`)
    this.addLabel(row, label, LABEL_WIDTH)
    const slSO = global.scene.createSceneObject("Slider")
    slSO.setParent(row)
    const slider = slSO.createComponent(Slider.getTypeName()) as Slider
    slider.size = new vec3(SLIDER_WIDTH, SLIDER_HEIGHT, 1)
    slider.currentValue = initial
    slSO.createComponent(FlexItem.getTypeName())
  }
}
