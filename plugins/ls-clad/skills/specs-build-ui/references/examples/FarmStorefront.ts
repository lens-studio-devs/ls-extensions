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
import {GridLayout} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Grid/GridLayout"
import {GridItem} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Grid/GridItem"
import {Frame} from "SpectaclesUIKit.lspkg/Scripts/Components/Frame/Frame"
import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {BackPlate} from "SpectaclesUIKit.lspkg/Scripts/BackPlate"
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

interface ShopItem {
  name: string
  price: number
  icon: Texture | null
}

const PANEL_W = 48
const PANEL_H = 30
const PAD = 2.0
const COLS = 3
const CARD_W = (PANEL_W - PAD * 2 - 1.2 * (COLS - 1)) / COLS  // ~14.4
const CARD_H = 9.4

const imageMaterial = requireAsset("../Materials/ImageMaterial.mat") as Material

@component
export class FarmStorefront extends BaseScriptComponent {
  @input
  itemIcons: Texture[] = []

  @input
  itemNames: string[] = []

  @input
  itemPrices: number[] = []

  @input
  @allowUndefined
  coinIcon: Texture | null = null

  @input
  startingCoins: number = 1250

  private coins: number = 0
  private balanceText: Text | null = null

  onAwake() {
    this.coins = this.startingCoins
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
    col.rowGap = 1.6
    col.paddingTop = PAD
    col.paddingBottom = PAD
    col.paddingLeft = PAD
    col.paddingRight = PAD

    this.addHeaderRow(content)
    this.addItemGrid(content)
  }

  // ─── Header: title + coin-balance pill ───────────────────────────────

  private addHeaderRow(parent: SceneObject): void {
    const row = global.scene.createSceneObject("Header")
    row.setParent(parent)
    const f = row.createComponent(FlexLayout.getTypeName()) as FlexLayout
    f.direction = FlexDirection.Row
    f.justifyContent = FlexJustify.SpaceBetween
    f.alignItems = FlexAlign.Center
    f.width = -1
    f.height = 4.0
    row.createComponent(FlexItem.getTypeName())

    // Title — Bold, prominent
    const titleSO = global.scene.createSceneObject("Title")
    titleSO.setParent(row)
    const title = titleSO.createComponent("Component.Text") as Text
    title.text = "Farm Shop"
    title.depthTest = true
    applyTextRole(title, "Title2") // storefront title
    title.horizontalAlignment = HorizontalAlignment.Left
    title.verticalAlignment = VerticalAlignment.Center
    title.horizontalOverflow = HorizontalOverflow.Overflow
    title.verticalOverflow = VerticalOverflow.Overflow
    title.layoutRect = Rect.create(-7, 7, -2, 2)
    titleSO.createComponent(FlexItem.getTypeName())

    this.addBalancePill(row)
  }

  /** Coin balance shown as a pill: BackPlate background + inner Image + Text. */
  private addBalancePill(parent: SceneObject): void {
    const pill = global.scene.createSceneObject("Balance")
    pill.setParent(parent)

    const plate = pill.createComponent(BackPlate.getTypeName()) as BackPlate
    plate.size = new vec2(10, 3.2)

    // Inner row offset forward in Z
    const inner = global.scene.createSceneObject("BalanceInner")
    inner.setParent(pill)
    inner.getTransform().setLocalPosition(new vec3(0, 0, 0.6))

    const row = inner.createComponent(FlexLayout.getTypeName()) as FlexLayout
    row.direction = FlexDirection.Row
    row.alignItems = FlexAlign.Center
    row.justifyContent = FlexJustify.Center
    row.columnGap = 0.6
    row.width = 10
    row.height = 3.2

    if (this.coinIcon) {
      const iconSO = global.scene.createSceneObject("CoinIcon")
      iconSO.setParent(inner)
      const img = iconSO.createComponent("Component.Image") as Image
      const mat = imageMaterial.clone()
      mat.mainPass.baseTex = this.coinIcon
      mat.mainPass.depthTest = true
      mat.mainPass.depthWrite = false   // Images: depthTest ON, depthWrite OFF (ImageMaterialPreset default)
      img.clearMaterials()
      img.addMaterial(mat)
      iconSO.getTransform().setLocalScale(new vec3(1.8, 1.8, 1))
      iconSO.createComponent(FlexItem.getTypeName())
    }

    const txtSO = global.scene.createSceneObject("Amount")
    txtSO.setParent(inner)
    const txt = txtSO.createComponent("Component.Text") as Text
    txt.text = this.formatCoins(this.coins)
    txt.depthTest = true
    applyTextRole(txt, "Headline1") // coin balance
    txt.horizontalAlignment = HorizontalAlignment.Left
    txt.verticalAlignment = VerticalAlignment.Center
    txt.horizontalOverflow = HorizontalOverflow.Overflow
    txt.verticalOverflow = VerticalOverflow.Overflow
    txt.layoutRect = Rect.create(-0.5, 0.5, -1.2, 1.2)
    txtSO.createComponent(FlexItem.getTypeName())
    this.balanceText = txt

    pill.createComponent(FlexItem.getTypeName())
  }

  // ─── Grid of item cards ──────────────────────────────────────────────

  private addItemGrid(parent: SceneObject): void {
    const count = Math.max(this.itemIcons.length, this.itemNames.length, this.itemPrices.length)
    const items: ShopItem[] = []
    for (let i = 0; i < count; i++) {
      items.push({
        name: this.itemNames[i] ?? `Item ${i + 1}`,
        price: this.itemPrices[i] ?? 0,
        icon: this.itemIcons[i] ?? null,
      })
    }

    const gridSO = global.scene.createSceneObject("Grid")
    gridSO.setParent(parent)
    const grid = gridSO.createComponent(GridLayout.getTypeName()) as GridLayout
    grid.templateColumns = `repeat(${COLS}, 1fr)`
    grid.templateRows = "auto"
    grid.autoRows = "auto"
    grid.columnGap = 1.2
    grid.rowGap = 1.2
    grid.width = PANEL_W - PAD * 2
    grid.height = -1
    const gridItem = gridSO.createComponent(FlexItem.getTypeName()) as FlexItem
    gridItem.alignSelf = FlexAlignSelf.Stretch

    for (const item of items) this.makeItemCard(gridSO, item)
  }

  private makeItemCard(parent: SceneObject, item: ShopItem): void {
    const card = global.scene.createSceneObject(`Card-${item.name}`)
    card.setParent(parent)
    card.createComponent(GridItem.getTypeName())

    // BackPlate gives the card its visual surface
    const plate = card.createComponent(BackPlate.getTypeName()) as BackPlate
    plate.size = new vec2(CARD_W, CARD_H)

    // Inner content offset forward so it doesn't z-fight with the plate
    const inner = global.scene.createSceneObject("CardInner")
    inner.setParent(card)
    inner.getTransform().setLocalPosition(new vec3(0, 0, 0.6))

    const stack = inner.createComponent(FlexLayout.getTypeName()) as FlexLayout
    stack.direction = FlexDirection.Column
    stack.alignItems = FlexAlign.Center
    stack.justifyContent = FlexJustify.Center
    stack.rowGap = 0.4
    stack.width = CARD_W
    stack.height = CARD_H
    stack.paddingTop = 0.8
    stack.paddingBottom = 0.8

    // Icon
    if (item.icon) {
      const imgSO = global.scene.createSceneObject("Icon")
      imgSO.setParent(inner)
      const img = imgSO.createComponent("Component.Image") as Image
      const mat = imageMaterial.clone()
      mat.mainPass.baseTex = item.icon
      mat.mainPass.depthTest = true
      mat.mainPass.depthWrite = false   // Images: depthTest ON, depthWrite OFF (ImageMaterialPreset default)
      img.clearMaterials()
      img.addMaterial(mat)
      imgSO.getTransform().setLocalScale(new vec3(3.4, 3.4, 1))
      imgSO.createComponent(FlexItem.getTypeName())
    }

    // Name
    const nameSO = global.scene.createSceneObject("Name")
    nameSO.setParent(inner)
    const name = nameSO.createComponent("Component.Text") as Text
    name.text = item.name
    name.depthTest = true
    applyTextRole(name, "Subheadline") // item name
    name.horizontalAlignment = HorizontalAlignment.Center
    name.verticalAlignment = VerticalAlignment.Center
    name.horizontalOverflow = HorizontalOverflow.Overflow
    name.verticalOverflow = VerticalOverflow.Overflow
    name.layoutRect = Rect.create(-0.5, 0.5, -0.5, 0.5)
    const nameItem = nameSO.createComponent(FlexItem.getTypeName()) as FlexItem
    nameItem.alignSelf = FlexAlignSelf.Stretch

    // Buy button (companion-style: coin icon + price)
    const buySO = global.scene.createSceneObject("Buy")
    buySO.setParent(inner)
    const btn = buySO.createComponent(Button.getTypeName()) as Button
    btn.size = new vec3(CARD_W - 2.4, 2.4, 1)
    const ec = buySO.createComponent(ElementContent.getTypeName()) as ElementContent
    ec.text = `${item.price}`
    ec.textSize = roleSize("Button") // price label
    if (this.coinIcon) {
      ec.leadingIcon = this.coinIcon
      ec.iconLayout = "left"
    }
    ec.contentAlignment = "center"
    const buyItem = buySO.createComponent(FlexItem.getTypeName()) as FlexItem
    buyItem.marginTop = 0.4

    btn.onTriggerUp.add(() => this.tryBuy(item))
  }

  private formatCoins(n: number): string {
    return n.toLocaleString()
  }

  private tryBuy(item: ShopItem): void {
    if (this.coins < item.price) return
    this.coins -= item.price
    if (this.balanceText) this.balanceText.text = this.formatCoins(this.coins)
  }
}
