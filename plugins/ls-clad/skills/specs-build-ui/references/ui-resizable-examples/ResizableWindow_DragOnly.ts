// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

import {Frame} from "SpectaclesUIKit.lspkg/Scripts/Components/Frame/Frame"

/**
 * Sample 2 — DragOnly window.
 *
 * Frame is movable but cannot be resized by the user. Size is controlled by
 * the `initialSize` parameter (or by code at runtime).
 *
 * Frame is auto-discovered from this SceneObject or its descendants.
 */
@component
export class ResizableWindow_DragOnly extends BaseScriptComponent {
  @input
  @hint("Window size in cm (width, height).")
  initialSize: vec2 = new vec2(40, 25)

  @input
  @hint("Auto-show on hover and hide when not interacted with.")
  autoShowHide: boolean = true

  onAwake() {
    // Canvas at the panel root in SortingType.Hierarchy (the default). DFS over
    // the SceneObject subtree owns paint order — no `renderOrder` anywhere.
    this.sceneObject.createComponent("Component.Canvas")
    this.createEvent("OnStartEvent").bind(() => this.initialize())
  }

  private initialize() {
    const frame = findFrame(this.sceneObject)
      ?? (this.sceneObject.createComponent(Frame.getTypeName()) as Frame)

    const apply = () => {
      frame.allowTranslation = true
      frame.allowScaling = false           // hide corner-resize handles
      frame.allowNonUniformScaling = false // gated by allowScaling, kept for clarity
      frame.autoScaleContent = false
      frame.autoShowHide = this.autoShowHide
      frame.innerSize = this.initialSize
      if (!this.autoShowHide) frame.showVisual()
    }

    if (frame.roundedRectangle) apply()
    else frame.onInitialized.add(apply)
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
