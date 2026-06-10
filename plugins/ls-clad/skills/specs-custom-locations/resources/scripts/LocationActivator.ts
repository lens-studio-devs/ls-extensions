// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

import { LocatedObject } from "./LocatedObject"

/**
 * Drives LocatedObject listeners based on the user's proximity to a Custom Location.
 *
 * Attach to the SceneObject that carries the LocatedAtComponent (the "Custom Location"
 * node). Once the device localizes (onFound) and the user walks within `activateDistance`
 * AND the location center is in the camera's view, every listener is activated. When the
 * user walks back out past the (larger) deactivation distance, listeners are deactivated.
 * The gap between the two distances is hysteresis — it stops content from flickering on the
 * boundary.
 *
 * EDITOR TESTING: the device never localizes inside Lens Studio, so onFound never fires
 * there. `global.deviceInfoSystem.isEditor()` forces the localized state to true so you can
 * verify activation by dragging the Preview camera toward the location center.
 */
@component
export class LocationActivator extends BaseScriptComponent {
  @input
  @hint("Main camera — used to measure distance and test whether the location is in view")
  camera: Camera

  @input
  @allowUndefined
  @hint("Optional SceneObject marking the activation center. Defaults to this SceneObject.")
  centerReference: SceneObject

  @input("Component.ScriptComponent[]")
  @hint("LocatedObject listeners (e.g. ScaleInLocatedObject, AudioLocatedObject)")
  listeners: LocatedObject[]

  @input
  @hint("Distance from center (cm) at which content activates")
  activateDistance: number = 1000

  @input
  @hint("Deactivation distance = activateDistance x this multiplier (hysteresis)")
  deactivateMultiplier: number = 1.5

  @input
  @hint("Radius (cm) of the sphere tested for camera visibility before activating")
  inViewRadius: number = 600

  private locatedAt: LocatedAtComponent
  private centerTransform: Transform
  private deactivateDistance: number = 0
  private didLocalize: boolean = false
  private isActive: boolean = false

  onAwake(): void {
    this.locatedAt = this.getSceneObject().getComponent("LocatedAtComponent")
    if (!this.locatedAt) {
      print("[LocationActivator] No LocatedAtComponent found — attach this script to the Custom Location node.")
      return
    }

    this.deactivateDistance = this.activateDistance * this.deactivateMultiplier
    const center = this.centerReference ? this.centerReference : this.getSceneObject()
    this.centerTransform = center.getTransform()

    this.locatedAt.onFound.add(() => {
      this.didLocalize = true
      this.listeners.forEach((l) => l.localize && l.localize())
    })

    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  private onUpdate(): void {
    if (!this.didLocalize) {
      if (global.deviceInfoSystem.isEditor()) {
        // The device never localizes in the editor, so onFound never fires there.
        // Run the one-time localize() hook here (once) so editor testing matches
        // on-device behavior for content that does setup in localize().
        this.didLocalize = true
        this.listeners.forEach((l) => l.localize && l.localize())
      } else {
        return
      }
    }

    const camPos = this.camera.getTransform().getWorldPosition()
    const center = this.centerTransform.getWorldPosition()
    // Horizontal (XZ) distance only — ignore height differences between eyes and content.
    const distance = new vec2(center.x, center.z).distance(new vec2(camPos.x, camPos.z))

    if (this.isActive) {
      if (distance > this.deactivateDistance) {
        this.isActive = false
        this.listeners.forEach((l) => l.deactivate && l.deactivate())
      }
    } else if (distance < this.activateDistance && this.camera.isSphereVisible(center, this.inViewRadius)) {
      this.isActive = true
      this.listeners.forEach((l) => l.activate && l.activate())
    }
  }
}
