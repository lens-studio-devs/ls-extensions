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

const PANEL_W = 38
const PANEL_H = 44
const PAD = 2.0
const THUMB_SIZE = 18

const imageMaterial = requireAsset("../Materials/ImageMaterial.mat") as Material

@component
export class MediaPlayer extends BaseScriptComponent {
  @input
  @allowUndefined
  thumbnail: Texture | null = null

  @input
  trackTitle: string = "Cosmic Drift"

  @input
  artist: string = "Stellar Quartet"

  onAwake() {
    this.sceneObject.createComponent("Component.Canvas")
    const frame = this.sceneObject.createComponent(Frame.getTypeName()) as Frame
    frame.autoShowHide = false
    frame.autoScaleContent = false   // critical: keep cm-units intact for FlexLayout
    frame.allowScaling = false

    frame.onInitialized.add(() => {
      frame.innerSize = new vec2(PANEL_W, PANEL_H)
      frame.padding = new vec2(PAD, PAD)
      this.buildContent(frame.contentTransform.getSceneObject())
    })
  }

  private buildContent(host: SceneObject): void {
    // Push content forward in Z to avoid z-fighting with the Frame visual
    const content = global.scene.createSceneObject("Content")
    content.setParent(host)
    content.getTransform().setLocalPosition(new vec3(0, 0, 0.6))

    const col = content.createComponent(FlexLayout.getTypeName()) as FlexLayout
    col.width = PANEL_W
    col.height = -1
    col.direction = FlexDirection.Column
    col.alignItems = FlexAlign.Stretch
    col.rowGap = 1.8
    col.paddingTop = PAD
    col.paddingBottom = PAD
    col.paddingLeft = PAD
    col.paddingRight = PAD

    this.addThumbnail(content)
    this.addText(content, this.trackTitle, "Title2", 4.0)
    this.addText(content, this.artist, "Headline1", 2.8)
    this.addProgress(content, 0.35)
    this.addControls(content)
  }

  private addThumbnail(parent: SceneObject): void {
    const so = global.scene.createSceneObject("Thumb")
    so.setParent(parent)

    if (this.thumbnail) {
      const img = so.createComponent("Component.Image") as Image
      const mat = imageMaterial.clone()
      mat.mainPass.baseTex = this.thumbnail
      mat.mainPass.depthTest = true
      mat.mainPass.depthWrite = false   // Images: depthTest ON, depthWrite OFF (ImageMaterialPreset default)
      img.clearMaterials()
      img.addMaterial(mat)
      // Square thumbnail (preserve aspect for the icon stand-in)
      so.getTransform().setLocalScale(new vec3(THUMB_SIZE, THUMB_SIZE, 1))
    }
    const item = so.createComponent(FlexItem.getTypeName()) as FlexItem
    // Center cross-axis so parent's Stretch doesn't blow it up
    item.alignSelf = FlexAlignSelf.Center
  }

  private addText(
    parent: SceneObject,
    label: string,
    role: TextRole,
    height: number
  ): void {
    const so = global.scene.createSceneObject(`Text-${label}`)
    so.setParent(parent)
    const t = so.createComponent("Component.Text") as Text
    t.text = label
    t.depthTest = true
    applyTextRole(t, role)
    t.horizontalAlignment = HorizontalAlignment.Left
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Overflow
    t.verticalOverflow = VerticalOverflow.Overflow
    t.layoutRect = Rect.create(-0.5, 0.5, -height / 2, height / 2)

    const item = so.createComponent(FlexItem.getTypeName()) as FlexItem
    item.alignSelf = FlexAlignSelf.Stretch
  }

  private addProgress(parent: SceneObject, initial: number): void {
    const row = global.scene.createSceneObject("Progress")
    row.setParent(parent)
    const flex = row.createComponent(FlexLayout.getTypeName()) as FlexLayout
    flex.direction = FlexDirection.Row
    flex.alignItems = FlexAlign.Center
    flex.columnGap = 0.8
    flex.width = -1
    flex.height = -1
    row.createComponent(FlexItem.getTypeName())

    this.addInlineTime(row, "1:23")
    this.addSlider(row, initial)
    this.addInlineTime(row, "3:47")
  }

  private addInlineTime(parent: SceneObject, text: string): void {
    const so = global.scene.createSceneObject(`Time-${text}`)
    so.setParent(parent)
    const t = so.createComponent("Component.Text") as Text
    t.text = text
    t.depthTest = true
    applyTextRole(t, "Caption") // timestamp readout
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Overflow
    t.layoutRect = Rect.create(-2, 2, -1.2, 1.2)
    so.createComponent(FlexItem.getTypeName())
  }

  private addSlider(parent: SceneObject, value: number): void {
    const so = global.scene.createSceneObject("Scrubber")
    so.setParent(parent)
    const slider = so.createComponent(Slider.getTypeName()) as Slider
    // Compute width: panel inner minus padding minus two time labels and gaps
    const sliderW = PANEL_W - PAD * 2 - 4 * 2 - 0.8 * 2
    slider.size = new vec3(sliderW, 1.0, 1)
    slider.currentValue = value
    so.createComponent(FlexItem.getTypeName())
  }

  private addControls(parent: SceneObject): void {
    const row = global.scene.createSceneObject("Controls")
    row.setParent(parent)
    const flex = row.createComponent(FlexLayout.getTypeName()) as FlexLayout
    flex.direction = FlexDirection.Row
    flex.justifyContent = FlexJustify.Center
    flex.alignItems = FlexAlign.Center
    flex.columnGap = 2.0
    flex.width = -1
    flex.height = -1
    const rowItem = row.createComponent(FlexItem.getTypeName()) as FlexItem
    rowItem.marginTop = 0.8

    for (const label of ["Back", "Play", "Skip"]) {
      const so = global.scene.createSceneObject(label)
      so.setParent(row)
      so.createComponent(Button.getTypeName())
      const ec = so.createComponent(ElementContent.getTypeName()) as ElementContent
      ec.text = label
      ec.autoResize = true
      so.createComponent(FlexItem.getTypeName())
    }
  }
}
