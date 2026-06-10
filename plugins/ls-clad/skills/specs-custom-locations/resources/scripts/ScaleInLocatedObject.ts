// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

import { LocatedObject } from "./LocatedObject"

/**
 * LocatedObject that scales its content in when the user arrives and out when they leave.
 *
 * Captures the content's authored scale on awake, then starts it hidden at scale 0.
 * `activate()` animates it up to the authored scale; `deactivate()` animates it back to 0
 * and disables the object when it gets there. Add this to the "listeners" list of a
 * LocationActivator.
 */
@component
export class ScaleInLocatedObject extends BaseScriptComponent implements LocatedObject {
  @input
  @hint("Content scaled in on activate, out on deactivate")
  content: SceneObject

  @input
  @hint("Scale fraction per second while animating (1.5 ≈ 0.7s to full)")
  speed: number = 1.5

  private targetScale: number = 1
  private velocity: number = 0

  onAwake(): void {
    const t = this.content.getTransform()
    this.targetScale = t.getLocalScale().x
    t.setLocalScale(vec3.zero())
    this.content.enabled = false
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  private onUpdate(): void {
    if (this.velocity === 0) {
      return
    }
    const t = this.content.getTransform()
    // Scale by getDeltaTime() so the animation runs at the same rate regardless of
    // frame rate (Editor ~30 FPS vs Spectacles 60–90 FPS).
    let s = t.getLocalScale().x + this.velocity * getDeltaTime()
    if (s <= 0) {
      s = 0
      this.velocity = 0
      this.content.enabled = false
    } else if (s >= this.targetScale) {
      s = this.targetScale
      this.velocity = 0
    }
    t.setLocalScale(new vec3(s, s, s))
  }

  localize(): void {}

  activate(): void {
    this.content.enabled = true
    this.velocity = this.targetScale * this.speed
  }

  deactivate(): void {
    this.velocity = this.targetScale * -this.speed
  }
}
