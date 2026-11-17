// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * SPECS Inc. 2027
 * Snap3 DInteractable Factory component for the AI Playground Glasses lens.
 */
import {Snap3D} from "RemoteServiceGateway.lspkg/HostedSnap/Snap3D"
import {Snap3DTypes} from "RemoteServiceGateway.lspkg/HostedSnap/Snap3DTypes"
import WorldCameraFinderProvider from "InteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {Snap3DInteractable} from "./Snap3DInteractable"
import {Logger} from "Utilities.lspkg/Scripts/Utils/Logger"
import {PlaygroundLogger} from "./PlaygroundLogger"

@component
export class Snap3DInteractableFactory extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">Snap3DInteractableFactory – 3D object generation factory</span><br/><span style="color: #94A3B8; font-size: 11px;">Creates interactable Snap3D objects from text prompts and manages the generation lifecycle.</span>')
  @ui.separator

  @ui.label('<span style="color: #60A5FA;">Generation Settings</span>')
  @ui.group_start("Submit and Get Status Example")
  @input
  @hint("Default text prompt used when running via tap (overridden when called programmatically)")
  @widget(new TextAreaWidget())
  private prompt: string = "A cute dog wearing a hat"

  @input
  @hint("Run the mesh refinement pass for higher quality output")
  private refineMesh: boolean = true

  @input
  @hint("Use vertex color instead of a UV-mapped texture on the generated mesh")
  private useVertexColor: boolean = false
  @ui.group_end

  @input
  @hint("Generate a 3D object when the scene is tapped (useful for quick testing)")
  runOnTap: boolean = false

  @input
  @hint("Prefab instantiated for each generated 3D object — must have a Snap3DInteractable component")
  snap3DInteractablePrefab: ObjectPrefab

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Logging</span>')
  @input
  @hint("Enable general logging")
  enableLogging: boolean = false

  @input
  @hint("Enable lifecycle logging (onAwake, onStart, onUpdate, onDestroy)")
  enableLoggingLifecycle: boolean = false

  private logger: Logger
  private avaliableToRequest: boolean = true
  private wcfmp = WorldCameraFinderProvider.getInstance()

  onAwake(): void {
    this.logger = new Logger("Snap3DInteractableFactory", this.enableLogging || this.enableLoggingLifecycle, true)
    if (this.enableLoggingLifecycle) this.logger.debug("LIFECYCLE: onAwake()")
    this.createEvent("TapEvent").bind(() => {
      if (!this.runOnTap) {
        return
      }
      this.createInteractable3DObject(this.prompt)
    })
  }

  createInteractable3DObject(input: string, overridePosition?: vec3): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.avaliableToRequest) {
        PlaygroundLogger.log("3D generation busy — request ignored")
        this.logger.warn("Already processing a request. Please wait")
        return
      }
      PlaygroundLogger.log(`3D generation request sent: "${input}"`)
      this.avaliableToRequest = false
      const outputObj = this.snap3DInteractablePrefab.instantiate(this.sceneObject)
      outputObj.name = "Snap3DInteractable - " + input
      const snap3DInteractable = outputObj.getComponent(Snap3DInteractable.getTypeName())
      snap3DInteractable.setPrompt(input)

      if (overridePosition) {
        outputObj.getTransform().setWorldPosition(overridePosition)
      } else {
        const newPos = this.wcfmp.getForwardPosition(80)
        outputObj.getTransform().setWorldPosition(newPos)
      }

      Snap3D.submitAndGetStatus({
        prompt: input,
        format: "glb",
        refine: this.refineMesh,
        use_vertex_color: this.useVertexColor
      })
        .then((submitGetStatusResults) => {
          submitGetStatusResults.event.add(([value, assetOrError]) => {
            if (value === "image") {
              assetOrError = assetOrError as Snap3DTypes.TextureAssetData
              PlaygroundLogger.log("3D generation: preview image received")
              snap3DInteractable.setImage(assetOrError.texture)
            } else if (value === "base_mesh") {
              assetOrError = assetOrError as Snap3DTypes.GltfAssetData
              if (!this.refineMesh) {
                snap3DInteractable.setModel(assetOrError.gltfAsset, true)
                this.avaliableToRequest = true
                PlaygroundLogger.log(`3D mesh ready: "${input}"`)
                resolve("Successfully created mesh with prompt: " + input)
              } else {
                PlaygroundLogger.log("3D generation: base mesh received — refining...")
                snap3DInteractable.setModel(assetOrError.gltfAsset, false)
              }
            } else if (value === "refined_mesh") {
              assetOrError = assetOrError as Snap3DTypes.GltfAssetData
              snap3DInteractable.setModel(assetOrError.gltfAsset, true)
              this.avaliableToRequest = true
              PlaygroundLogger.log(`3D mesh ready: "${input}"`)
              resolve("Successfully created mesh with prompt: " + input)
            } else if (value === "failed") {
              assetOrError = assetOrError as Snap3DTypes.ErrorData
              PlaygroundLogger.log(`3D generation failed: ${assetOrError.errorMsg}`)
              this.logger.error("Error: " + assetOrError.errorMsg)
              this.avaliableToRequest = true
              reject("Failed to create mesh with prompt: " + input)
            }
          })
        })
        .catch((error) => {
          PlaygroundLogger.log(`3D generation failed: ${error}`)
          snap3DInteractable.onFailure(error)
          this.logger.error("Error submitting task or getting status: " + error)
          this.avaliableToRequest = true
          reject("Failed to create mesh with prompt: " + input)
        })
    })
  }

  private onTap(): void {}
}
