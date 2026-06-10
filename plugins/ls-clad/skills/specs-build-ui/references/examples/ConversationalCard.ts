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
import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {ElementContent} from "SpectaclesUIKit.lspkg/Scripts/Components/Content/ElementContent"
import {TextInputField} from "SpectaclesUIKit.lspkg/Scripts/Components/TextInputField/TextInputField"

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

const PANEL_W = 36
const PANEL_H = 40
const PAD = 1.6
const INPUT_HEIGHT = 3.0
const SEND_BTN_W = 6.0

@component
export class ConversationalCard extends BaseScriptComponent {
  private messageList: SceneObject | null = null
  private inputField: TextInputField | null = null

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
    col.rowGap = 1.2
    col.paddingTop = PAD
    col.paddingBottom = PAD
    col.paddingLeft = PAD
    col.paddingRight = PAD

    this.addHeader(content, "Chat")
    this.addMessageList(content)
    this.addInputRow(content)

    // Seed with a couple of messages
    this.addMessage("Hi, how can I help today?", false)
    this.addMessage("Tell me about Spectacles.", true)
  }

  private addHeader(parent: SceneObject, label: string): void {
    const so = global.scene.createSceneObject("Header")
    so.setParent(parent)
    const innerW = PANEL_W - PAD * 2
    const headerH = 3.6

    const t = so.createComponent("Component.Text") as Text
    t.text = label
    t.depthTest = true
    applyTextRole(t, "HeadlineXL")
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Overflow
    t.verticalOverflow = VerticalOverflow.Overflow
    t.layoutRect = Rect.create(-innerW / 2, innerW / 2, -headerH / 2, headerH / 2)

    so.createComponent(FlexItem.getTypeName())
  }

  private addMessageList(parent: SceneObject): void {
    const list = global.scene.createSceneObject("Messages")
    list.setParent(parent)
    const flex = list.createComponent(FlexLayout.getTypeName()) as FlexLayout
    flex.direction = FlexDirection.Column
    flex.alignItems = FlexAlign.Stretch
    flex.justifyContent = FlexJustify.Start
    flex.rowGap = 0.8
    flex.width = -1
    flex.height = -1
    const item = list.createComponent(FlexItem.getTypeName()) as FlexItem
    item.alignSelf = FlexAlignSelf.Stretch
    item.setFlex(1)   // take all remaining vertical space above input row
    this.messageList = list
  }

  private addMessage(text: string, isUser: boolean): void {
    if (!this.messageList) return
    const bubble = global.scene.createSceneObject(`Msg-${isUser ? "user" : "bot"}`)
    bubble.setParent(this.messageList)

    const ec = bubble.createComponent(ElementContent.getTypeName()) as ElementContent
    ec.text = text
    ec.textSize = roleSize("Body")
    ec.contentAlignment = isUser ? "right" : "left"
    ec.sizeOverride = new vec2(PANEL_W - PAD * 2 - 1, 2.2)

    const item = bubble.createComponent(FlexItem.getTypeName()) as FlexItem
    item.alignSelf = isUser ? FlexAlignSelf.End : FlexAlignSelf.Start
  }

  private addInputRow(parent: SceneObject): void {
    const row = global.scene.createSceneObject("InputRow")
    row.setParent(parent)
    const flex = row.createComponent(FlexLayout.getTypeName()) as FlexLayout
    flex.direction = FlexDirection.Row
    flex.alignItems = FlexAlign.Center
    flex.columnGap = 0.8
    flex.width = -1
    flex.height = INPUT_HEIGHT
    row.createComponent(FlexItem.getTypeName())

    // Text field
    const tfSO = global.scene.createSceneObject("Input")
    tfSO.setParent(row)
    const tf = tfSO.createComponent(TextInputField.getTypeName()) as TextInputField
    const tfWidth = PANEL_W - PAD * 2 - SEND_BTN_W - 0.8
    tf.size = new vec3(tfWidth, INPUT_HEIGHT, 1)
    tfSO.createComponent(FlexItem.getTypeName())
    this.inputField = tf

    // Send button
    const sendSO = global.scene.createSceneObject("Send")
    sendSO.setParent(row)
    const send = sendSO.createComponent(Button.getTypeName()) as Button
    send.size = new vec3(SEND_BTN_W, INPUT_HEIGHT, 1)
    const sendEC = sendSO.createComponent(ElementContent.getTypeName()) as ElementContent
    sendEC.text = "Send"
    sendSO.createComponent(FlexItem.getTypeName())

    send.onTriggerUp.add(() => this.sendMessage())
  }

  private sendMessage(): void {
    const tf = this.inputField
    if (!tf) return
    const text = tf.text.trim()
    if (text.length === 0) return
    this.addMessage(text, true)
    tf.text = ""
  }
}
