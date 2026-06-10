// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * Internet Availability Pop Up component for the AI Playground Spectacles lens.
 */
import animate from "SpectaclesInteractionKit.lspkg/Utils/animate"
import {Logger} from "Utilities.lspkg/Scripts/Utils/Logger"
import {MathUtils} from "Utilities.lspkg/Scripts/Utils/MathUtils"

@component
export class InternetAvailabilityPopUp extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">InternetAvailabilityPopUp – internet status popup</span><br/><span style="color: #94A3B8; font-size: 11px;">Shows or hides a popup to warn the user when internet connectivity is unavailable.</span>')
  @ui.separator

  @input
  @hint("Root SceneObject of the popup to show or hide based on internet status")
  popup: SceneObject

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Logging</span>')
  @input
  @hint("Enable general logging")
  enableLogging: boolean = false

  @input
  @hint("Enable lifecycle logging (onAwake, onStart, onUpdate, onDestroy)")
  enableLoggingLifecycle: boolean = false

  private logger: Logger

  onAwake(): void {
    this.logger = new Logger("InternetAvailabilityPopUp", this.enableLogging || this.enableLoggingLifecycle, true)
    if (this.enableLoggingLifecycle) this.logger.debug("LIFECYCLE: onAwake()")
    global.deviceInfoSystem.onInternetStatusChanged.add((args) => {
      this.isInternetAvailable(args.isInternetAvailable)
    })
    this.isInternetAvailable(global.deviceInfoSystem.isInternetAvailable(), 0)
  }

  isInternetAvailable = (bool: boolean, timeOverride = 300) => {
    if (bool) {
      const tr = this.popup.getChild(0).getTransform()
      const start = tr.getLocalScale()
      const end = vec3.one().uniformScale(0.01)
      animate({
        duration: (timeOverride ?? 300) / 1000,
        easing: "ease-out-cubic",
        update: (t) => {
          tr.setLocalScale(new vec3(
            MathUtils.lerp(start.x, end.x, t),
            MathUtils.lerp(start.y, end.y, t),
            MathUtils.lerp(start.z, end.z, t)
          ))
        },
        ended: () => {
          this.popup.enabled = false
        }
      })
    } else {
      const tr = this.popup.getChild(0).getTransform()
      const start = tr.getLocalScale()
      const end = vec3.one()
      animate({
        duration: (timeOverride ?? 300) / 1000,
        easing: "ease-in-cubic",
        update: (t) => {
          tr.setLocalScale(new vec3(
            MathUtils.lerp(start.x, end.x, t),
            MathUtils.lerp(start.y, end.y, t),
            MathUtils.lerp(start.z, end.z, t)
          ))
        }
      })
      this.popup.enabled = true
    }
  }
}
