// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * Example implementation of Snap3D text-to-3D generation. Demonstrates submitting prompts,
 * tracking generation progress through multiple stages (image, base mesh, refined mesh), and
 * instantiating generated 3D assets with loading spinners and status updates.
 */
import { Snap3D } from "../Snap3D";
import { Snap3DTypes } from "../Snap3DTypes";
import { Logger } from "Utilities.lspkg/Scripts/Utils/Logger";
import { bindStartEvent, bindUpdateEvent, bindLateUpdateEvent, bindDestroyEvent } from "SnapDecorators.lspkg/decorators";

@component
export class ExampleSnap3D extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Generation Configuration</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Configure Snap3D generation parameters and display objects</span>')

  @ui.group_start("Submit and Get Status Example")
  @input
  @widget(new TextAreaWidget())
  private prompt: string = "A cute dog wearing a hat";
  @input
  private refineMesh: boolean = true;
  @input
  private useVertexColor: boolean = false;
  @ui.group_end
  @input
  imageRoot: Image;

  @input
  baseMeshRoot: SceneObject;

  @input
  refinedMeshRoot: SceneObject;

  @input
  modelMat: Material;

  @input
  hintText: Text;

  @input
  runOnTap: boolean = false;

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Logging Configuration</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Control logging output for this script instance</span>')

  @input
  @hint("Enable general logging (animation cycles, events, etc.)")
  enableLogging: boolean = false;

  @input
  @hint("Enable lifecycle logging (onAwake, onStart, onUpdate, onDestroy, etc.)")
  enableLoggingLifecycle: boolean = false;

  // Logger instance
  private logger: Logger;  private loaderSpinnerImage: SceneObject;
  private baseMeshSpinner: SceneObject;
  private refinedMeshSpinner: SceneObject;

  private baseMeshSceneObject: SceneObject = null;
  private refinedMeshSceneObject: SceneObject = null;

  private avaliableToRequest: boolean = true;
  private gestureModule: GestureModule = require("LensStudio:GestureModule");  /**
   * Called when component is initialized
   */
  onAwake(): void {
    // Initialize logger
    this.logger = new Logger("ExampleSnap3D", this.enableLogging || this.enableLoggingLifecycle, true);

    if (this.enableLoggingLifecycle) {
      this.logger.debug("LIFECYCLE: onAwake() - Component initializing");
    }


    this.initalizeSpinners();
    this.imageRoot.enabled = false;

    if (global.deviceInfoSystem.isEditor()) {
      this.createEvent("TapEvent").bind(() => {
        this.onTap();
      });
    } else {
      this.gestureModule
        .getPinchDownEvent(GestureModule.HandType.Right)
        .add(() => {
          this.onTap();
        });
    }
  }
  private onTap() {
    if (!this.runOnTap) {
      return;
    }
    if (!this.avaliableToRequest) {
      return;
    }
    this.avaliableToRequest = false;
    this.resetAssets();
    this.hintText.text = "Requested Snap3D generation. Please wait...";

    this.enableSpinners(true);

    Snap3D.submitAndGetStatus({
      prompt: this.prompt,
      format: "glb",
      refine: this.refineMesh,
      use_vertex_color: this.useVertexColor,
    })
      .then((submitGetStatusResults) => {
        submitGetStatusResults.event.add(([value, assetOrError]) => {
          if (value === "image") {
            this.generateImageAsset(
              assetOrError as Snap3DTypes.TextureAssetData
            );
          } else if (value === "base_mesh") {
            this.generateBaseMeshAsset(
              assetOrError as Snap3DTypes.GltfAssetData
            );
          } else if (value === "refined_mesh") {
            this.generateRefinedMeshAsset(
              assetOrError as Snap3DTypes.GltfAssetData
            );
          } else if (value === "failed") {
            this.enableSpinners(false);
            const error = assetOrError as {
              errorMsg: string;
              errorCode: number;
            };
            print(
              "Task failed with error: " +
                error.errorMsg +
                " (Code: " +
                error.errorCode +
                ")"
            );
            this.hintText.text =
              "Generation failed. Please Tap or Pinch to try again.";

            this.avaliableToRequest = true;
          }
        });
      })
      .catch((error) => {
        this.hintText.text =
          "Generation failed. Please Tap or Pinch to try again.";
        print("Error submitting task or getting status: " + error);

        this.avaliableToRequest = true;
      });
  }
  private generateImageAsset(textureAssetData: Snap3DTypes.TextureAssetData) {
    this.imageRoot.mainPass.baseTex = textureAssetData.texture;
    this.loaderSpinnerImage.enabled = false;
    this.imageRoot.enabled = true;
  }
  private generateBaseMeshAsset(gltfAssetData: Snap3DTypes.GltfAssetData) {
    this.baseMeshSceneObject = gltfAssetData.gltfAsset.tryInstantiate(
      this.baseMeshRoot,
      this.modelMat
    );
    this.baseMeshSpinner.enabled = false;
  }
  private generateRefinedMeshAsset(gltfAssetData: Snap3DTypes.GltfAssetData) {
    this.refinedMeshSceneObject = gltfAssetData.gltfAsset.tryInstantiate(
      this.refinedMeshRoot,
      this.modelMat
    );
    this.refinedMeshSpinner.enabled = false;

    this.hintText.text =
      "Generation Completed. Please Tap or Pinch to try again.";

    this.avaliableToRequest = true;
  }
  private resetAssets() {
    this.imageRoot.enabled = false;
    if (!isNull(this.baseMeshSceneObject)) {
      this.baseMeshSceneObject.destroy();
      this.baseMeshSceneObject = null;
    }
    if (!isNull(this.refinedMeshSceneObject)) {
      this.refinedMeshSceneObject.destroy();
      this.refinedMeshSceneObject = null;
    }
  }
  private initalizeSpinners() {
    this.loaderSpinnerImage = this.imageRoot.sceneObject.getChild(1);
    this.baseMeshSpinner = this.baseMeshRoot.getChild(1);
    this.refinedMeshSpinner = this.refinedMeshRoot.getChild(1);
    this.enableSpinners(false);
  }
  private enableSpinners(enable: boolean) {
    this.loaderSpinnerImage.enabled = enable;
    this.baseMeshSpinner.enabled = enable;
    this.refinedMeshSpinner.enabled = enable;
  }
}
