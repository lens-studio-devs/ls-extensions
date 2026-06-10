// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

import {Frame} from "SpectaclesUIKit.lspkg/Scripts/Components/Frame/Frame"

/**
 * Sample 1 — ResizableWindow (recommended baseline).
 *
 * Configures a Frame to behave like a desktop/website window:
 *   • Drag    — grab the frame border to move it.
 *   • Resize  — corner handles change width/height independently.
 *   • No scale — contents inside the frame keep their original size; only
 *                the window dimensions change (innerSize).
 *
 * The Frame is auto-discovered from this SceneObject or its descendants —
 * no drag-and-drop reference required. Tunable values are exposed below.
 */
@component
export class ResizableWindow extends BaseScriptComponent {
  @input
  @hint("Initial window size in cm (width, height).")
  initialSize: vec2 = new vec2(40, 25)

  @input
  @hint("Auto-show on hover and hide when not interacted with. Disable to keep the frame always visible.")
  autoShowHide: boolean = true

  onAwake() {
    // Canvas at the panel root in SortingType.Hierarchy (the default). DFS over
    // the SceneObject subtree owns paint order — no `renderOrder` anywhere.
    this.sceneObject.createComponent("Component.Canvas")
    this.createEvent("OnStartEvent").bind(() => this.initialize())
  }

  private initialize() {
    // Reuse a Frame already in the hierarchy, or create one on this SceneObject.
    const frame = findFrame(this.sceneObject)
      ?? (this.sceneObject.createComponent(Frame.getTypeName()) as Frame)

    const apply = () => {
      frame.allowTranslation = true
      frame.allowNonUniformScaling = true
      frame.autoScaleContent = false
      frame.autoShowHide = this.autoShowHide
      frame.innerSize = this.initialSize
      // Frame's init calls hideVisual() when autoShowHide is true (its default).
      // If we want it always visible, force-show after the property is updated.
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
