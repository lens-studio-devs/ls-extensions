// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * Camera texture cropping utility that allows you to crop camera frames to specific regions.
 * Provides both cropped and original texture access with configurable crop boundaries.
 */
import { bindStartEvent } from "SnapDecorators.lspkg/decorators";
import { Logger } from "Utilities.lspkg/Scripts/Utils/Logger";
import { ValidationUtils } from "Utilities.lspkg/Scripts/Utils/ValidationUtils";

@component
export class CameraTexture extends BaseScriptComponent {
  private logger: Logger;
  private cameraRequest: CameraModule.CameraRequest;
  private cameraTexture: Texture;
  private cropProvider: any;

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">UI Configuration</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Specify the UI image component and texture resources</span>')

  @input
  @hint("The image component that will display the cropped camera frame.")
  uiImage: Image;

  @input
  @hint("Texture used for processing camera frames")
  screenTexture: Texture;

  @input
  @hint("Camera module reference from the scene.")
  camModule: CameraModule;

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Crop Rectangle Settings</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Define the crop region using normalized coordinates (-1 to 1) for left, right, bottom, and top boundaries</span>')

  @input
  @hint("Crop rectangle left boundary (-1 to 1).")
  cropLeft: number = -0.2;

  @input
  @hint("Crop rectangle right boundary (-1 to 1).")
  cropRight: number = 0.2;

  @input
  @hint("Crop rectangle bottom boundary (-1 to 1).")
  cropBottom: number = -0.2;

  @input
  @hint("Crop rectangle top boundary (-1 to 1).")
  cropTop: number = 0.2;

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Logging Configuration</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Control logging output for this script instance</span>')

  @input
  @hint("Enable general logging (camera setup, texture processing, etc.)")
  enableLogging: boolean = false;

  @input
  @hint("Enable lifecycle logging (onAwake, onStart, onUpdate, onDestroy, etc.)")
  enableLoggingLifecycle: boolean = false;

  /**
   * Returns the processed camera texture (always cropped if crop texture is available)
   * @returns The processed texture
   */
  public getCameraTexture(): Texture {
    try {
      if (this.screenTexture && this.cameraTexture) {
        const cropProvider = this.screenTexture.control as any;

        if (!cropProvider) {
          this.logger.warn("Crop texture has no control provider");
          return this.cameraTexture;
        }

        ValidationUtils.ifExists(cropProvider.inputTexture, () => {
          cropProvider.inputTexture = this.cameraTexture;
        });

        ValidationUtils.ifExists(cropProvider.cropRect, (rect) => {
          rect.left = this.cropLeft;
          rect.right = this.cropRight;
          rect.bottom = this.cropBottom;
          rect.top = this.cropTop;
        });

        return this.screenTexture;
      }

      return this.cameraTexture;
    } catch (error) {
      this.logger.error("Error in getCameraTexture: " + error);
      return this.cameraTexture;
    }
  }

  /**
   * Returns the original high-quality camera texture without cropping
   * @returns The original camera texture
   */
  public getOriginalCameraTexture(): Texture {
    return this.cameraTexture;
  }

  /**
   * Called when component wakes up - initialize logger
   */
  onAwake(): void {
    const shouldLog = this.enableLogging || this.enableLoggingLifecycle;
    this.logger = new Logger("CameraTexture", shouldLog, true);

    if (this.enableLoggingLifecycle) {
      this.logger.header("CameraTexture Initialization");
      this.logger.debug("LIFECYCLE: onAwake() - Component waking up");
    }
  }

  /**
   * Called on the first frame when the scene starts
   * Automatically bound to OnStartEvent via SnapDecorators
   */
  @bindStartEvent
  initialize(): void {
    if (this.enableLoggingLifecycle) {
      this.logger.debug("LIFECYCLE: initialize() - Scene started");
    }

    this.setupCamera();
  }

  private setupCamera(): void {
    try {
      if (this.enableLogging) {
        this.logger.info("Starting camera setup");
      }

      ValidationUtils.assertNotNull(this.camModule, "Camera module not provided - please assign it in component settings");

      this.cameraRequest = CameraModule.createCameraRequest();
      if (this.enableLogging) {
        this.logger.debug("Camera request created");
      }

      ValidationUtils.assertNotNull(this.cameraRequest, "Failed to create camera request");

      this.cameraRequest.cameraId = CameraModule.CameraId.Default_Color;

      const isEditor = global.deviceInfoSystem.isEditor();
      this.cameraRequest.imageSmallerDimension = isEditor ? 352 : 756;
      if (this.enableLogging) {
        this.logger.debug(`Resolution: ${this.cameraRequest.imageSmallerDimension} (Editor: ${isEditor})`);
      }

      const camera = global.deviceInfoSystem.getTrackingCameraForId(CameraModule.CameraId.Default_Color);
      if (this.enableLogging) {
        this.logger.debug(`Camera resolution: ${camera.resolution}`);
      }

      this.cameraTexture = this.camModule.requestCamera(this.cameraRequest);
      ValidationUtils.assertNotNull(this.cameraTexture, "Failed to get camera texture");

      this.cropProvider = this.screenTexture.control as any;

      ValidationUtils.ifExists(this.cropProvider?.inputTexture, () => {
        this.cropProvider.inputTexture = this.cameraTexture;
      });

      const cameraControl = this.cameraTexture.control as any;
      ValidationUtils.ifExists(cameraControl?.onNewFrame, (onNewFrame) => {
        onNewFrame.add(() => {
          ValidationUtils.ifExists(this.uiImage, (img) => {
            img.mainPass.baseTex = this.getCameraTexture();
          });
        });
      });

      ValidationUtils.ifExists(this.uiImage, (img) => {
        img.mainPass.baseTex = this.getCameraTexture();
      });

      if (this.enableLogging) {
        this.logger.success("Camera setup successful");
      }
    } catch (error) {
      this.logger.error(`Camera setup failed: ${error}\nStack: ${error.stack}`);
    }
  }
}
