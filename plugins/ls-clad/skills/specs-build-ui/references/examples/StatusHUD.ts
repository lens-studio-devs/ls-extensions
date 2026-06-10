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
import {ElementContent} from "SpectaclesUIKit.lspkg/Scripts/Components/Content/ElementContent"
import {Billboard} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Billboard/Billboard"

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

@component
export class StatusHUD extends BaseScriptComponent {
  @input
  @allowUndefined
  statusIcon: Texture | null = null

  @input
  message: string = "Connecting..."

  onAwake() {
    this.sceneObject.createComponent("Component.Canvas")
    this.sceneObject.createComponent(Billboard.getTypeName())
    const backPlate = this.sceneObject.createComponent(BackPlate.getTypeName()) as BackPlate

    const flex = this.sceneObject.createComponent(FlexLayout.getTypeName()) as FlexLayout
    flex.onLayoutComplete.add((result) => {
      backPlate.size = new vec2(result.containerWidth, result.containerHeight)
    })
    flex.direction = FlexDirection.Row
    flex.alignItems = FlexAlign.Center
    flex.justifyContent = FlexJustify.Start
    flex.columnGap = 0.8
    flex.paddingTop = 0.8
    flex.paddingBottom = 0.8
    flex.paddingLeft = 1.2
    flex.paddingRight = 1.4
    flex.width = -1
    flex.height = -1

    const contentSO = global.scene.createSceneObject("Status")
    contentSO.setParent(this.sceneObject)
    const ec = contentSO.createComponent(ElementContent.getTypeName()) as ElementContent
    ec.text = this.message
    if (this.statusIcon) {
      ec.leadingIcon = this.statusIcon
      ec.iconLayout = "left"
    }
    ec.textSize = roleSize("Subheadline")
    ec.sizeOverride = new vec2(12, 2.2)
    contentSO.createComponent(FlexItem.getTypeName())
  }
}
