// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

import {Frame} from "SpectaclesUIKit.lspkg/Scripts/Components/Frame/Frame"

/**
 * Sample 3 — ResizableWindow with explicit bounds + optional aspect-ratio lock.
 *
 * Same drag + non-uniform resize behavior as Sample 1, plus:
 *   • Min/max size (cm) applied to the Frame.
 *   • Optional aspect-ratio lock — height tracks width using the initial ratio.
 *
 * Frame is auto-discovered from this SceneObject or its descendants.
 */
@component
export class ResizableWindow_Bounds extends BaseScriptComponent {
  @input
  @hint("Initial window size in cm (width, height).")
  initialSize: vec2 = new vec2(40, 25)

  @input
  @hint("Minimum window size in cm.")
  minSize: vec2 = new vec2(20, 12)

  @input
  @hint("Maximum window size in cm.")
  maxSize: vec2 = new vec2(120, 80)

  @input
  @hint("Lock height to the initial aspect ratio (width drives height).")
  lockAspectRatio: boolean = false

  @input
  @hint("Auto-show on hover and hide when not interacted with.")
  autoShowHide: boolean = true

  private aspectRatio: number = 1
  private applyingAspectLock: boolean = false

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
      frame.allowNonUniformScaling = true
      frame.autoScaleContent = false
      frame.autoShowHide = this.autoShowHide
      frame.minimumSize = this.minSize
      frame.maximumSize = this.maxSize
      frame.innerSize = this.initialSize

      if (!this.autoShowHide) frame.showVisual()

      if (this.lockAspectRatio) {
        const s = frame.innerSize
        this.aspectRatio = s.y > 0 ? s.x / s.y : 1
        frame.onScalingUpdate.add(() => this.enforceAspect(frame))
      }
    }

    if (frame.roundedRectangle) apply()
    else frame.onInitialized.add(apply)
  }

  private enforceAspect(frame: Frame) {
    if (this.applyingAspectLock) return
    const current = frame.innerSize
    const expectedY = current.x / this.aspectRatio
    if (Math.abs(expectedY - current.y) < 0.01) return
    this.applyingAspectLock = true
    frame.innerSize = new vec2(current.x, expectedY)
    this.applyingAspectLock = false
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
