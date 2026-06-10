// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

import {GridLayout} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Grid/GridLayout"
import {GridItem} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Grid/GridItem"
import {FlexLayout} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexLayout"
import {FlexItem} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexItem"
import {
  FlexAlign,
  FlexDirection,
  FlexJustify,
} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import {BackPlate} from "SpectaclesUIKit.lspkg/Scripts/BackPlate"
import {FlexAlignSelf} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"

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

const PANEL_WIDTH = 60
const PAD_X = 5.0
const PAD_Y = 5.0
const TILE_ICON_SIZE = 6.0
const TILE_LABEL_HEIGHT = 2.5
const COLS = 3

const imageMaterial = requireAsset("../Materials/ImageMaterial.mat") as Material

@component
export class MediaGrid extends BaseScriptComponent {
  @input
  tiles: Texture[] = []

  @input
  labels: string[] = []

  onAwake() {
    this.sceneObject.createComponent("Component.Canvas")
    const backPlate = this.sceneObject.createComponent(BackPlate.getTypeName()) as BackPlate

    // Push content forward in Z to avoid z-fighting with the BackPlate
    const contentHost = global.scene.createSceneObject("Content")
    contentHost.setParent(this.sceneObject)
    contentHost.getTransform().setLocalPosition(new vec3(0, 0, 0.6))

    const column = contentHost.createComponent(FlexLayout.getTypeName()) as FlexLayout
    column.width = PANEL_WIDTH
    column.height = -1
    column.direction = FlexDirection.Column
    column.alignItems = FlexAlign.Stretch
    column.justifyContent = FlexJustify.Start
    column.rowGap = 4.0
    column.paddingTop = PAD_Y
    column.paddingBottom = PAD_Y
    column.paddingLeft = PAD_X
    column.paddingRight = PAD_X

    column.onLayoutComplete.add((result) => {
      backPlate.size = new vec2(result.containerWidth, result.containerHeight)
    })

    this.addHeader(contentHost, "Media")
    this.addGrid(contentHost)
  }

  private addHeader(parent: SceneObject, label: string): void {
    const so = global.scene.createSceneObject("Header")
    so.setParent(parent)
    const innerW = PANEL_WIDTH - PAD_X * 2
    const headerH = 6.0

    const text = so.createComponent("Component.Text") as Text
    text.text = label
    text.depthTest = true
    text.horizontalAlignment = HorizontalAlignment.Center
    text.verticalAlignment = VerticalAlignment.Center
    text.layoutRect = Rect.create(-innerW / 2, innerW / 2, -headerH / 2, headerH / 2)
    // Role-based sizing for guaranteed visual hierarchy (sets size + weight).
    applyTextRole(text, "Title1")

    const item = so.createComponent(FlexItem.getTypeName()) as FlexItem
    item.marginBottom = 3.0
  }

  private addGrid(parent: SceneObject): void {
    const gridSO = global.scene.createSceneObject("Grid")
    gridSO.setParent(parent)
    const grid = gridSO.createComponent(GridLayout.getTypeName()) as GridLayout
    grid.templateColumns = `repeat(${COLS}, 1fr)`
    grid.templateRows = "auto"
    grid.autoRows = "auto"  // CRITICAL: default "1fr" collapses to 0 when container height is auto
    grid.columnGap = 4.0
    grid.rowGap = 6.0
    grid.width = PANEL_WIDTH - PAD_X * 2
    grid.height = -1
    gridSO.createComponent(FlexItem.getTypeName())

    for (let i = 0; i < this.tiles.length; i++) {
      this.makeTile(gridSO, this.tiles[i], this.labels[i] ?? "")
    }
  }

  private makeTile(parent: SceneObject, tex: Texture, label: string): void {
    const tile = global.scene.createSceneObject("Tile")
    tile.setParent(parent)
    tile.createComponent(GridItem.getTypeName())

    const stack = tile.createComponent(FlexLayout.getTypeName()) as FlexLayout
    stack.direction = FlexDirection.Column
    stack.alignItems = FlexAlign.Center
    stack.justifyContent = FlexJustify.Start
    stack.rowGap = 1.5
    stack.width = -1
    stack.height = -1

    // Icon — Image component with cloned ImageMaterial (premultiplied alpha)
    const imgSO = global.scene.createSceneObject("Icon")
    imgSO.setParent(tile)
    const img = imgSO.createComponent("Component.Image") as Image
    const mat = imageMaterial.clone()
    mat.mainPass.baseTex = tex
    mat.mainPass.depthTest = true
    mat.mainPass.depthWrite = false   // Images: depthTest ON, depthWrite OFF (ImageMaterialPreset default)
    img.clearMaterials()
    img.addMaterial(mat)
    // ImageHandler reads localScale as size — set before FlexLayout measures
    imgSO.getTransform().setLocalScale(new vec3(TILE_ICON_SIZE, TILE_ICON_SIZE, 1))
    imgSO.createComponent(FlexItem.getTypeName())

    // Label — mirror ElementContent's pattern: Wrap overflow + small placeholder rect
    // + alignSelf=Stretch so the FlexItem allocates the full cell width and the
    // centered text actually centers.
    const txtSO = global.scene.createSceneObject("Label")
    txtSO.setParent(tile)
    const txt = txtSO.createComponent("Component.Text") as Text
    txt.text = label
    txt.depthTest = true
    txt.horizontalAlignment = HorizontalAlignment.Center
    txt.verticalAlignment = VerticalAlignment.Center
    txt.horizontalOverflow = HorizontalOverflow.Overflow
    txt.verticalOverflow = VerticalOverflow.Overflow
    txt.layoutRect = Rect.create(-0.5, 0.5, -0.5, 0.5)
    applyTextRole(txt, "Headline1")

    const labelItem = txtSO.createComponent(FlexItem.getTypeName()) as FlexItem
    labelItem.alignSelf = FlexAlignSelf.Stretch
  }
}
