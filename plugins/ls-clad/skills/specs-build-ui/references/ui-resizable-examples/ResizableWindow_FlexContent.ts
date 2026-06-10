// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

import {Frame} from "SpectaclesUIKit.lspkg/Scripts/Components/Frame/Frame"
import {FlexLayout} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexLayout"

/**
 * Sample 4 — Resizable window with a FlexLayout content area.
 *
 * Closest to "drag and resize, just like a website":
 *   • Drag    — move the frame.
 *   • Resize  — corner handles change innerSize.
 *   • Reflow  — child FlexLayout's width/height track the frame's innerSize,
 *               so flex children re-pack like a CSS flexbox container.
 *
 * Frame and FlexLayout are auto-discovered from this SceneObject or its
 * descendants — no drag-and-drop references.
 */
@component
export class ResizableWindow_FlexContent extends BaseScriptComponent {
  @input
  @hint("Initial window size in cm (width, height).")
  initialSize: vec2 = new vec2(40, 25)

  @input
  @hint("Padding subtracted from innerSize before applying to FlexLayout (cm).")
  contentInset: vec2 = new vec2(0, 0)

  @input
  @hint("Auto-show on hover and hide when not interacted with.")
  autoShowHide: boolean = true

  private flex: FlexLayout | null = null

  onAwake() {
    // Canvas at the panel root in SortingType.Hierarchy (the default). DFS over
    // the SceneObject subtree owns paint order — no `renderOrder` anywhere.
    this.sceneObject.createComponent("Component.Canvas")
    this.createEvent("OnStartEvent").bind(() => this.initialize())
  }

  private initialize() {
    const frame = findFrame(this.sceneObject)
      ?? (this.sceneObject.createComponent(Frame.getTypeName()) as Frame)
    this.flex = findFlexLayout(this.sceneObject) ?? this.createFlexChild()

    const apply = () => {
      frame.allowTranslation = true
      frame.allowNonUniformScaling = true
      frame.autoScaleContent = false
      frame.autoShowHide = this.autoShowHide
      frame.innerSize = this.initialSize
      if (!this.autoShowHide) frame.showVisual()
      this.syncFlexSize(frame)
      frame.onScalingUpdate.add(() => this.syncFlexSize(frame))
    }

    if (frame.roundedRectangle) apply()
    else frame.onInitialized.add(apply)
  }

  private createFlexChild(): FlexLayout {
    const child = global.scene.createSceneObject("FlexContent")
    child.setParent(this.sceneObject)
    child.layer = this.sceneObject.layer
    return child.createComponent(FlexLayout.getTypeName()) as FlexLayout
  }

  private syncFlexSize(frame: Frame) {
    if (!this.flex) return
    const s = frame.innerSize
    this.flex.width = Math.max(0, s.x - this.contentInset.x)
    this.flex.height = Math.max(0, s.y - this.contentInset.y)
  }
}

function findFrame(root: SceneObject): Frame | null {
  const own = root.getComponent(Frame.getTypeName()) as Frame
  if (own) return own
  for (let i = 0; i < root.getChildrenCount(); i++) {
    const found = findFrame(root.getChild(i))
    if (found) return found
  }
  return null
}

function findFlexLayout(root: SceneObject): FlexLayout | null {
  const own = root.getComponent(FlexLayout.getTypeName()) as FlexLayout
  if (own) return own
  for (let i = 0; i < root.getChildrenCount(); i++) {
    const found = findFlexLayout(root.getChild(i))
    if (found) return found
  }
  return null
}
