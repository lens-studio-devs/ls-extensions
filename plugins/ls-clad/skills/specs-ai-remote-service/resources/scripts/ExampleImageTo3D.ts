// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * Example implementation of Snap3D text-to-3D generation with texture display. Demonstrates
 * submitting prompts for 3D generation while displaying a reference texture from the editor.
 * This example shows how to handle generation progress and instantiate 3D mesh assets.
 */
import { Snap3D } from "RemoteServiceGateway.lspkg/HostedSnap/Snap3D";
import { Snap3DTypes } from "RemoteServiceGateway.lspkg/HostedSnap/Snap3DTypes";

@component
export class ExampleSnap3DImageTo3D extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Text-to-3D Configuration</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Generate 3D models from text prompts with reference texture</span>')

  @ui.group_start("Generation Settings")
  @input
  @hint("Source texture/image to use for generation")
  private sourceTexture: Texture;

  @input
  @widget(new TextAreaWidget())
  @hint("Prompt to describe the object (e.g., 'a toy car', 'a vase')")
  private prompt: string = "an object";

  @input
  @hint("Enable mesh refinement for higher quality (slower)")
  private refineMesh: boolean = true;

  @input
  @hint("Use vertex colors instead of textures")
  private useVertexColor: boolean = false;
  @ui.group_end

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Display Configuration</span>')

  @input
  @hint("Image component to display the source image")
  sourceImage: Image;

  @input
  @hint("Parent object for base mesh")
  baseMeshRoot: SceneObject;

  @input
  @hint("Parent object for refined mesh")
  refinedMeshRoot: SceneObject;

  @input
  @hint("Material to apply to generated meshes")
  modelMat: Material;

  @input
  @hint("Text component for status messages")
  hintText: Text;

  @input
  @hint("Enable generation on tap/pinch")
  runOnTap: boolean = false;

  private baseMeshSpinner: SceneObject;
  private refinedMeshSpinner: SceneObject;

  private baseMeshSceneObject: SceneObject = null;
  private refinedMeshSceneObject: SceneObject = null;

  private isRequestInProgress: boolean = false;
  private gestureModule: GestureModule = require("LensStudio:GestureModule");

  onAwake() {
    this.initializeSpinners();

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

    this.hintText.text = "Tap or Pinch to generate 3D from prompt";
  }

  private onTap() {
    if (!this.runOnTap) {
      return;
    }
    if (this.isRequestInProgress) {
      this.hintText.text = "Request already in progress...";
      return;
    }
    if (!this.sourceTexture || isNull(this.sourceTexture)) {
      this.hintText.text = "Please assign a source texture";
      return;
    }

    this.startImageTo3DGeneration();
  }

  /**
   * Starts the text-to-3D generation process using the provided prompt.
   * The source texture is displayed but not used for generation (package limitation).
   */
  private startImageTo3DGeneration() {
    this.isRequestInProgress = true;
    this.resetAssets();
    this.hintText.text = "Generating 3D from prompt. Please wait...";
    this.enableSpinners(true);

    // Display the source texture
    this.sourceImage.mainPass.baseTex = this.sourceTexture;
    this.sourceImage.enabled = true;

    // Submit request for 3D generation (this version doesn't support direct image input)
    Snap3D.submitAndGetStatus({
      prompt: this.prompt,
      format: "glb",
      refine: this.refineMesh,
      use_vertex_color: this.useVertexColor,
    })
      .then((submitGetStatusResults) => {
        this.hintText.text = "Generating 3D model from image...";

        submitGetStatusResults.event.add(([artifactType, assetOrError]) => {
          if (artifactType === "image") {
            // Image already exists (we provided it), so this stage is skipped
            // or confirms the image was received
            print("Image artifact confirmed");
          } else if (artifactType === "base_mesh") {
            this.generateBaseMeshAsset(
              assetOrError as Snap3DTypes.GltfAssetData
            );
            this.hintText.text = "Base mesh generated. Refining...";
          } else if (artifactType === "refined_mesh") {
            this.generateRefinedMeshAsset(
              assetOrError as Snap3DTypes.GltfAssetData
            );
            this.hintText.text =
              "Generation complete! Tap or Pinch to generate again.";
          } else if (artifactType === "failed") {
            this.handleError(assetOrError as Snap3DTypes.ErrorData);
          }
        });
      })
      .catch((error) => {
        this.handleError({
          errorMsg: error,
          errorCode: -1,
        });
      });
  }


  private generateBaseMeshAsset(gltfAssetData: Snap3DTypes.GltfAssetData) {
    this.baseMeshSceneObject = gltfAssetData.gltfAsset.tryInstantiate(
      this.baseMeshRoot,
      this.modelMat
    );
    this.baseMeshSpinner.enabled = false;
    print("Base mesh instantiated from: " + gltfAssetData.url);
  }

  private generateRefinedMeshAsset(gltfAssetData: Snap3DTypes.GltfAssetData) {
    this.refinedMeshSceneObject = gltfAssetData.gltfAsset.tryInstantiate(
      this.refinedMeshRoot,
      this.modelMat
    );
    this.refinedMeshSpinner.enabled = false;
    this.isRequestInProgress = false;
    print("Refined mesh instantiated from: " + gltfAssetData.url);
  }

  private handleError(error: Snap3DTypes.ErrorData) {
    this.enableSpinners(false);
    print(
      "Generation failed: " +
        error.errorMsg +
        " (Code: " +
        error.errorCode +
        ")"
    );
    this.hintText.text = "Generation failed. Tap or Pinch to try again.";
    this.isRequestInProgress = false;
  }

  private resetAssets() {
    this.sourceImage.enabled = false;
    if (!isNull(this.baseMeshSceneObject)) {
      this.baseMeshSceneObject.destroy();
      this.baseMeshSceneObject = null;
    }
    if (!isNull(this.refinedMeshSceneObject)) {
      this.refinedMeshSceneObject.destroy();
      this.refinedMeshSceneObject = null;
    }
  }

  private initializeSpinners() {
    this.baseMeshSpinner = this.baseMeshRoot.getChild(0);
    this.refinedMeshSpinner = this.refinedMeshRoot.getChild(0);
    this.enableSpinners(false);
  }

  private enableSpinners(enable: boolean) {
    this.baseMeshSpinner.enabled = enable;
    this.refinedMeshSpinner.enabled = enable;
  }
}
