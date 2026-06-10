// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

import {FlexLayout} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexLayout"
import {FlexItem} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexItem"
import {
  FlexAlign,
  FlexDirection,
  FlexJustify,
} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import {Frame} from "SpectaclesUIKit.lspkg/Scripts/Components/Frame/Frame"
import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {ElementContent} from "SpectaclesUIKit.lspkg/Scripts/Components/Content/ElementContent"

const PAD = 1.2
const ICON_BUTTON_SIZE = 5.0
const ICON_SIZE = 2.8

/**
 * Horizontal dock: a Frame that follows the user's head with a row of round
 * icon buttons. Useful as a persistent action bar that stays in view.
 *
 * (Snap OS's true hand-anchoring needs SIK's HandTracking — for a self-contained
 * sample we use Frame's built-in head-follow which is the closest available
 * behavior without requiring runtime hand setup.)
 */
@component
export class AppLauncherDock extends BaseScriptComponent {
  @input
  icons: Texture[] = []

  @input
  labels: string[] = []

  onAwake() {
    this.sceneObject.createComponent("Component.Canvas")
    const frame = this.sceneObject.createComponent(Frame.getTypeName()) as Frame
    frame.autoShowHide = false
    frame.autoScaleContent = false
    frame.allowScaling = false

    frame.onInitialized.add(() => {
      const count = this.icons.length
      // width = icons * (button + gap) + padding - last gap
      const width = count * (ICON_BUTTON_SIZE + 1.2) - 1.2 + PAD * 2
      const height = ICON_BUTTON_SIZE + PAD * 2
      frame.innerSize = new vec2(width, height)
      frame.padding = new vec2(PAD, PAD)

      // Enable head-follow and start following so it stays in view
      frame.setUseFollow(true)
      frame.setFollowing(true)
      frame.showFollowButton = false   // hide UI toggle — always follow

      this.buildContent(frame.contentTransform.getSceneObject(), width)
    })
  }

  private buildContent(host: SceneObject, width: number): void {
    const content = global.scene.createSceneObject("Content")
    content.setParent(host)
    content.getTransform().setLocalPosition(new vec3(0, 0, 0.6))

    const row = content.createComponent(FlexLayout.getTypeName()) as FlexLayout
    row.width = width
    row.height = -1
    row.direction = FlexDirection.Row
    row.justifyContent = FlexJustify.Center
    row.alignItems = FlexAlign.Center
    row.columnGap = 1.2
    row.paddingTop = PAD
    row.paddingBottom = PAD
    row.paddingLeft = PAD
    row.paddingRight = PAD

    for (let i = 0; i < this.icons.length; i++) {
      this.makeIconButton(content, this.icons[i], this.labels[i] ?? `App ${i + 1}`)
    }
  }

  private makeIconButton(parent: SceneObject, icon: Texture, _label: string): void {
    const so = global.scene.createSceneObject("AppButton")
    so.setParent(parent)
    const btn = so.createComponent(Button.getTypeName()) as Button
    btn.size = new vec3(ICON_BUTTON_SIZE, ICON_BUTTON_SIZE, 1)

    // ElementContent companion-mode places the icon centered within the button
    const ec = so.createComponent(ElementContent.getTypeName()) as ElementContent
    ec.leadingIcon = icon
    ec.iconLayout = "left"   // single-icon, no text — layout direction irrelevant

    so.createComponent(FlexItem.getTypeName())
  }
}
