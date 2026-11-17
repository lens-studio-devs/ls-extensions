// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * SPECS Inc. 2027
 * Snap3 DInteractable component for the AI Playground Glasses lens.
 */
import {setTimeout} from "InteractionKit.lspkg/Utils/FunctionTimingUtils"
import {Logger} from "Utilities.lspkg/Scripts/Utils/Logger"

@component
export class Snap3DInteractable extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">Snap3DInteractable – 3D generation result viewer</span><br/><span style="color: #94A3B8; font-size: 11px;">Receives image and mesh data from the factory and renders them on an interactable scene object.</span>')
  @ui.separator

  @ui.label('<span style="color: #60A5FA;">References</span>')
  @input
  @hint("Parent SceneObject where the instantiated 3D model will be placed")
  private modelParent: SceneObject

  @input
  @hint("Image component used to display the preview image while the model loads")
  private img: Image

  @input
  @hint("Text element displaying the generation prompt")
  private promptDisplay: Text

  @input
  @hint("SceneObject shown as a loading spinner during generation")
  private spinner: SceneObject

  @input
  @hint("Material applied to the instantiated 3D model")
  private mat: Material

  @input
  @hint("SceneObject containing the display plate UI element")
  private displayPlate: SceneObject

  @input
  @hint("SceneObject whose scale defines the collision boundary")
  private colliderObj: SceneObject

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Logging</span>')
  @input
  @hint("Enable general logging")
  enableLogging: boolean = false

  @input
  @hint("Enable lifecycle logging (onAwake, onStart, onUpdate, onDestroy)")
  enableLoggingLifecycle: boolean = false

  private logger: Logger
  private tempModel: SceneObject = null
  private finalModel: SceneObject = null
  private size: number = 20
  private sizeVec: vec3 = null

  onAwake(): void {
    this.logger = new Logger("Snap3DInteractable", this.enableLogging || this.enableLoggingLifecycle, true)
    if (this.enableLoggingLifecycle) this.logger.debug("LIFECYCLE: onAwake()")

    const imgMaterial = this.img.mainMaterial
    imgMaterial.mainPass.baseTex = this.img.mainPass.baseTex
    this.img.enabled = false

    const offsetBelow = 0
    this.sizeVec = vec3.one().uniformScale(this.size)
    this.displayPlate.getTransform().setLocalPosition(new vec3(0, -this.size * 0.5 - offsetBelow, 0))
    this.colliderObj.getTransform().setLocalScale(this.sizeVec)
    this.img.getTransform().setLocalScale(this.sizeVec)
  }

  setPrompt(prompt: string): void {
    this.promptDisplay.text = prompt
  }

  setImage(image: Texture): void {
    this.img.enabled = true
    this.img.mainPass.baseTex = image
  }

  setModel(model: GltfAsset, isFinal: boolean): void {
    this.img.enabled = false
    if (isFinal) {
      if (!isNull(this.finalModel)) {
        this.finalModel.destroy()
      }
      this.spinner.enabled = false
      this.finalModel = model.tryInstantiate(this.modelParent, this.mat)
      this.finalModel.getTransform().setLocalScale(this.sizeVec)
    } else {
      this.tempModel = model.tryInstantiate(this.modelParent, this.mat)
      this.tempModel.getTransform().setLocalScale(this.sizeVec)
    }
  }

  onFailure(error: string): void {
    this.img.enabled = false
    this.spinner.enabled = false
    if (this.tempModel) {
      this.tempModel.destroy()
    }
    if (this.finalModel) {
      this.finalModel.destroy()
    }
    this.promptDisplay.text = "Error: " + error
    setTimeout(() => {
      this.destroy()
    }, 5000)
  }
}
