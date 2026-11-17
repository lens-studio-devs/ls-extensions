// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * SPECS Inc. 2027
 * Sphere Controller for the AI Playground Glasses lens experience.
 */
import {Interactable} from "InteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {InteractableManipulation} from "InteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation"
import animate from "InteractionKit.lspkg/Utils/animate"
import WorldCameraFinderProvider from "InteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {HandInputData} from "InteractionKit.lspkg/Providers/HandInputData/HandInputData"
import {BaseButton} from "UIKit.lspkg/Scripts/Components/Button/BaseButton"
import Event from "InteractionKit.lspkg/Utils/Event"
import {bindStartEvent, bindUpdateEvent} from "SnapDecorators.lspkg/decorators"
import {Logger} from "Utilities.lspkg/Scripts/Utils/Logger"
import {MathUtils} from "Utilities.lspkg/Scripts/Utils/MathUtils"

@component
export class SphereController extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">SphereController – AI assistant orb UI</span><br/><span style="color: #94A3B8; font-size: 11px;">Manages the orb that follows the user\'s hand, can be placed in the world, and supports screen-space fallback.</span>')
  @ui.separator

  @ui.label('<span style="color: #60A5FA;">Materials</span>')
  @input
  @hint("Material driving the hover highlight effect on the orb")
  private hoverMat: Material

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Scene References</span>')
  @input
  @hint("SceneObject holding the Interactable and InteractableManipulation components")
  private orbInteractableObj: SceneObject

  @input
  @hint("Root SceneObject of the orb that is scaled and positioned in world space")
  private orbObject: SceneObject

  @input
  @hint("Visual child of the orb reparented between world and screen space")
  private orbVisualParent: SceneObject

  @input
  @hint("Screen-space anchor SceneObject used when the orb is outside the field of view")
  private orbScreenPosition: SceneObject

  @input
  @hint("SceneObject containing the close button and its animations")
  private closeObj: SceneObject

  @input
  @hint("Text element shown in world space for AI output")
  private worldSpaceText: Text

  @input
  @hint("Text element shown in screen space when the orb is off-screen")
  private screenSpaceText: Text

  @input
  @hint("Parent SceneObject for all UI elements, hidden until the session starts")
  private uiParent: SceneObject

  @input
  @hint("Button used to return the orb to hand-tracking mode")
  private closeButton: BaseButton

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Logging</span>')
  @input
  @hint("Enable general logging")
  enableLogging: boolean = false

  @input
  @hint("Enable lifecycle logging (onAwake, onStart, onUpdate, onDestroy)")
  enableLoggingLifecycle: boolean = false

  private logger: Logger
  private wasInFOV: boolean = true
  private interactable: Interactable
  private manipulate: InteractableManipulation
  private handProvider: HandInputData = HandInputData.getInstance()
  private menuHand = this.handProvider.getHand("left")
  private trackedToHand: boolean = true
  private wcfmp = WorldCameraFinderProvider.getInstance()
  private minimizedSize: vec3 = vec3.one().uniformScale(0.3)
  private fullSize: vec3 = vec3.one()

  public isActivatedEvent: Event<boolean> = new Event<boolean>()

  // Fired when the user presses the close button next to the hand, so the
  // bridge can tear down the session and bring the assistant picker back.
  public onCloseButtonEvent: Event<void> = new Event<void>()

  onAwake(): void {
    this.logger = new Logger("SphereController", this.enableLogging || this.enableLoggingLifecycle, true)
    if (this.enableLoggingLifecycle) this.logger.debug("LIFECYCLE: onAwake()")
    this.interactable = this.orbInteractableObj.getComponent(Interactable.getTypeName())
    this.manipulate = this.orbInteractableObj.getComponent(InteractableManipulation.getTypeName())
    this.setIsTrackedToHand(true)
    this.hoverMat.mainPass.activeHover = 0
    this.uiParent.enabled = false
  }

  initializeUI(): void {
    this.uiParent.enabled = true
  }

  hideUI(): void {
    this.uiParent.enabled = false
  }

  private setIsTrackedToHand(value: boolean): void {
    this.trackedToHand = value
    this.manipulate.enabled = !value
    if (value) {
      this.setOrbToScreenPosition(true)
      {
        const tr = this.orbObject.getTransform()
        const start = tr.getLocalScale()
        const end = this.minimizedSize
        animate({
          duration: 0.6,
          easing: "ease-in-out-quad",
          update: (t) => {
            tr.setLocalScale(new vec3(
              MathUtils.lerp(start.x, end.x, t),
              MathUtils.lerp(start.y, end.y, t),
              MathUtils.lerp(start.z, end.z, t)
            ))
          }
        })
      }

      {
        const tr = this.closeObj.getTransform()
        const start = tr.getLocalScale()
        const end = vec3.one().uniformScale(0.1)
        animate({
          duration: 0.6,
          easing: "ease-in-out-quad",
          update: (t) => {
            tr.setLocalScale(new vec3(
              MathUtils.lerp(start.x, end.x, t),
              MathUtils.lerp(start.y, end.y, t),
              MathUtils.lerp(start.z, end.z, t)
            ))
          },
          ended: () => {
            this.closeButton.sceneObject.enabled = false
          }
        })
      }
      this.screenSpaceText.enabled = false
      this.worldSpaceText.enabled = false
    } else {
      {
        const tr = this.orbObject.getTransform()
        const start = tr.getLocalScale()
        const end = this.fullSize
        animate({
          duration: 0.4,
          easing: "ease-in-out-quad",
          update: (t) => {
            tr.setLocalScale(new vec3(
              MathUtils.lerp(start.x, end.x, t),
              MathUtils.lerp(start.y, end.y, t),
              MathUtils.lerp(start.z, end.z, t)
            ))
          }
        })
      }
      {
        const tr = this.orbObject.getTransform()
        const start = tr.getWorldPosition()
        const end = this.wcfmp.getForwardPosition(100)
        animate({
          duration: 0.6,
          easing: "ease-in-out-quad",
          update: (t) => {
            tr.setWorldPosition(new vec3(
              MathUtils.lerp(start.x, end.x, t),
              MathUtils.lerp(start.y, end.y, t),
              MathUtils.lerp(start.z, end.z, t)
            ))
          }
        })
      }

      this.closeButton.sceneObject.enabled = true
      {
        const tr = this.closeObj.getTransform()
        const start = tr.getLocalScale()
        const end = vec3.one()
        animate({
          duration: 0.6,
          easing: "ease-in-out-quad",
          update: (t) => {
            tr.setLocalScale(new vec3(
              MathUtils.lerp(start.x, end.x, t),
              MathUtils.lerp(start.y, end.y, t),
              MathUtils.lerp(start.z, end.z, t)
            ))
          }
        })
      }
      this.screenSpaceText.enabled = false
      this.worldSpaceText.enabled = true
    }

    this.isActivatedEvent.invoke(!value)
  }

  @bindStartEvent
  private init(): void {
    if (this.enableLoggingLifecycle) this.logger.debug("LIFECYCLE: onStart()")
    this.interactable.onHoverEnter.add(() => {
      animate({
        duration: 0.2,
        easing: "linear",
        update: (t) => {
          this.hoverMat.mainPass.activeHover = t
        }
      })
    })

    this.interactable.onHoverExit.add(() => {
      animate({
        duration: 0.2,
        easing: "linear",
        update: (t) => {
          this.hoverMat.mainPass.activeHover = 1 - t
        }
      })
    })

    // PinchButton was removed from InteractionKit. The orb already
    // has an Interactable, whose onTriggerEnd fires on pinch-release exactly as
    // PinchButton.onButtonPinched did — so we subscribe to it directly (no
    // separate button component or scene reattach needed).
    this.interactable.onTriggerEnd.add(() => {
      if (this.trackedToHand) {
        this.setIsTrackedToHand(false)
      }
    })

    // The close button is a UIKit button whose script reference can
    // come through unresolved after the package update (initialize()/onTriggerUp
    // undefined) until the component is reattached in the scene. Guard so the
    // lens does not crash; once reattached these wire up automatically.
    const closeBtn = this.closeButton as any
    if (typeof closeBtn.initialize === "function") closeBtn.initialize()
    closeBtn.onTriggerUp?.add(() => {
      if (!this.trackedToHand) {
        this.setIsTrackedToHand(true)
        this.onCloseButtonEvent.invoke()
      }
    })
  }

  @bindUpdateEvent
  private onUpdate(): void {
    this.positionByHand()
    this.keepActiveOrbVisible()
  }

  private positionByHand(): void {
    let objectToTransform = this.orbObject.getTransform()
    if (!this.trackedToHand) {
      objectToTransform = this.closeObj.getTransform()
    }
    const handPosition = this.menuHand.pinkyKnuckle.position
    const handRight = this.menuHand.indexTip.right

    const curPosition = objectToTransform.getWorldPosition()
    let menuPosition = handPosition.add(handRight.uniformScale(4))

    if (global.deviceInfoSystem.isEditor()) {
      menuPosition = this.wcfmp.getWorldPosition().add(new vec3(0, -20, -25))
    }

    const nPosition = vec3.lerp(curPosition, menuPosition, 0.2)
    objectToTransform.setWorldPosition(nPosition)

    let billboardPos = this.wcfmp.getWorldPosition().add(this.wcfmp.forward().uniformScale(5))
    billboardPos = billboardPos.add(this.wcfmp.right().uniformScale(-5))
    const dir = billboardPos.sub(menuPosition).normalize()
    objectToTransform.setWorldRotation(quat.lookAt(dir, vec3.up()))

    if ((!this.menuHand.isTracked() || !this.menuHand.isFacingCamera()) && !global.deviceInfoSystem.isEditor()) {
      objectToTransform.getSceneObject().enabled = false
    } else {
      objectToTransform.getSceneObject().enabled = true
    }
  }

  private setOrbToScreenPosition(inScrPos: boolean): void {
    if (!inScrPos) {
      this.orbVisualParent.setParent(this.orbScreenPosition)
      this.orbVisualParent.getTransform().setLocalPosition(vec3.zero())
      {
        const tr = this.orbVisualParent.getTransform()
        const start = vec3.one().uniformScale(0.01)
        const end = vec3.one().uniformScale(0.3)
        animate({
          duration: 0.2,
          easing: "linear",
          update: (t) => {
            tr.setLocalScale(new vec3(
              MathUtils.lerp(start.x, end.x, t),
              MathUtils.lerp(start.y, end.y, t),
              MathUtils.lerp(start.z, end.z, t)
            ))
          }
        })
      }
      this.screenSpaceText.enabled = true
      this.worldSpaceText.enabled = false
    } else {
      this.orbVisualParent.setParent(this.orbObject)
      this.orbVisualParent.getTransform().setLocalPosition(vec3.zero())
      {
        const tr = this.orbVisualParent.getTransform()
        const start = tr.getLocalScale()
        const end = vec3.one()
        animate({
          duration: 0.2,
          easing: "linear",
          update: (t) => {
            tr.setLocalScale(new vec3(
              MathUtils.lerp(start.x, end.x, t),
              MathUtils.lerp(start.y, end.y, t),
              MathUtils.lerp(start.z, end.z, t)
            ))
          }
        })
      }
      this.screenSpaceText.enabled = false
      this.worldSpaceText.enabled = true
    }
  }

  private keepActiveOrbVisible(): void {
    if (this.trackedToHand) {
      return
    }
    const orbPos = this.orbObject.getTransform().getWorldPosition()
    const inFov = this.wcfmp.inFoV(orbPos)
    if (inFov !== this.wasInFOV) {
      this.setOrbToScreenPosition(inFov)
    }
    this.wasInFOV = inFov
  }

  public setText(data: {text: string; completed: boolean}): void {
    if (data.completed) {
      this.worldSpaceText.text = data.text
      this.screenSpaceText.text = data.text
    } else {
      this.worldSpaceText.text += data.text
      this.screenSpaceText.text += data.text
    }
  }
}
