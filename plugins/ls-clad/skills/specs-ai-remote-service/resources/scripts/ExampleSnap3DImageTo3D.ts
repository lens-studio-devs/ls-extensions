// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * Example implementation of Snap3D image-to-3D generation. Demonstrates using an existing image
 * URL to generate 3D models, bypassing the text-to-image stage. This example shows how to
 * submit an image directly for mesh generation and handle the resulting 3D assets.
 */
import { Snap3D } from "../Snap3D";
import { Snap3DTypes } from "../Snap3DTypes";
import { Logger } from "Utilities.lspkg/Scripts/Utils/Logger";
import { bindStartEvent, bindUpdateEvent, bindLateUpdateEvent, bindDestroyEvent } from "SnapDecorators.lspkg/decorators";
import { Promisfy } from "../../Utils/Promisfy";

@component
export class ExampleSnap3DImageTo3D extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Image-to-3D Configuration</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Generate 3D models directly from image URLs</span>')

  @ui.group_start("Image-to-3D Generation")
  @input
  @widget(new TextAreaWidget())
  @hint("URL of the image to convert to 3D (must be publicly accessible)")
  private imageUrl: string = "https://example.com/image.png";

  @input
  @widget(new TextAreaWidget())
  @hint("Optional prompt to guide 3D generation (e.g., 'a toy car', 'a vase')")
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
  private logger: Logger;  private baseMeshSpinner: SceneObject;
  private refinedMeshSpinner: SceneObject;

  private baseMeshSceneObject: SceneObject = null;
  private refinedMeshSceneObject: SceneObject = null;

  private isRequestInProgress: boolean = false;
  private gestureModule: GestureModule = require("LensStudio:GestureModule");  /**
   * Called when component is initialized
   */
  onAwake(): void {
    // Initialize logger
    this.logger = new Logger("ExampleSnap3DImageTo3D", this.enableLogging || this.enableLoggingLifecycle, true);

    if (this.enableLoggingLifecycle) {
      this.logger.debug("LIFECYCLE: onAwake() - Component initializing");
    }


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

    this.hintText.text = "Tap or Pinch to generate 3D from image";
  }

  private onTap() {
    if (!this.runOnTap) {
      return;
    }
    if (this.isRequestInProgress) {
      this.hintText.text = "Request already in progress...";
      return;
    }
    if (!this.imageUrl || this.imageUrl.trim() === "") {
      this.hintText.text = "Please provide a valid image URL";
      return;
    }

    this.startImageTo3DGeneration();
  }

  /**
   * Starts the image-to-3D generation process using the provided image URL.
   * This bypasses the text-to-image stage and goes directly to mesh generation.
   */
  private startImageTo3DGeneration() {
    this.isRequestInProgress = true;
    this.resetAssets();
    this.hintText.text = "Converting image to 3D. Please wait...";
    this.enableSpinners(true);

    // Load and display the source image first
    this.loadSourceImage(this.imageUrl);

    // Submit with image_url to skip text-to-image generation
    Snap3D.submitAndGetStatus({
      prompt: this.prompt,
      format: "glb",
      refine: this.refineMesh,
      use_vertex_color: this.useVertexColor,
      image_url: this.imageUrl, // This tells the API to use the provided image
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
              "Generation complete! Tap or Pinch to try another image.";
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

  /**
   * Loads and displays the source image from URL
   */
  private async loadSourceImage(url: string) {
    try {
      const internetModule = require("LensStudio:InternetModule") as InternetModule;
      const remoteMediaModule =
        require("LensStudio:RemoteMediaModule") as RemoteMediaModule;

      const httpRequest = RemoteServiceHttpRequest.create();
      httpRequest.url = url;

      internetModule.performHttpRequest(httpRequest, async (response) => {
        if (response.statusCode === 1) {
          try {
            const texture =
              await Promisfy.RemoteMediaModule.loadResourceAsImageTexture(
                remoteMediaModule,
                response.asResource()
              );
            this.sourceImage.mainPass.baseTex = texture;
            this.sourceImage.enabled = true;
            print("Source image loaded successfully");
          } catch (error) {
            print("Failed to load source image: " + error);
          }
        } else {
          print(
            "Failed to fetch image: " +
              response.statusCode +
              " - " +
              response.body
          );
        }
      });
    } catch (error) {
      print("Error loading source image: " + error);
    }
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
