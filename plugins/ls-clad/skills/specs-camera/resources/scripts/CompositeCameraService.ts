// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

import { Logger } from "Utilities.lspkg/Scripts/Utils/Logger";
import { bindStartEvent } from "SnapDecorators.lspkg/decorators";

/**
 * Specs Inc. 2026
 * Camera service for managing composite camera textures. Handles camera requests and texture
 * composition for both editor and device environments with different camera configurations.
 */
@component
export class CameraService extends BaseScriptComponent {
    @ui.separator
    @ui.label('<span style="color: #60A5FA;">Camera Configuration</span>')
    @ui.label('<span style="color: #94A3B8; font-size: 11px;">Configure camera and texture resources for composite camera output</span>')

    @input editorCamera: Camera;
    @input screenCropTexture: Texture;
    @input
    private camModule: CameraModule;

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
  private logger: Logger;

    private isEditor = global.deviceInfoSystem.isEditor();

    /**
     * Called when component is initialized
     */
    onAwake(): void {
        this.logger = new Logger("CameraService", this.enableLogging || this.enableLoggingLifecycle, true);
        if (this.enableLoggingLifecycle) {
            this.logger.debug("LIFECYCLE: onAwake() - Component initializing");
        }
    }

    @bindStartEvent
    start(): void {
        if (this.enableLoggingLifecycle) {
            this.logger.debug("LIFECYCLE: start() - Initializing camera service");
        }

        const camID = this.isEditor
            ? CameraModule.CameraId.Default_Color
            : CameraModule.CameraId.Right_Color;
        const camRequest = CameraModule.createCameraRequest();
        camRequest.cameraId = camID;
        //camRequest.imageSmallerDimension = this.isEditor ? 352 : 756;

        const camTexture = this.camModule.requestCamera(camRequest);

        if (this.enableLogging) {
            this.logger.debug(`Camera texture requested: ${camTexture}`);
        }

        const camTexControl = camTexture.control as CameraTextureProvider;
        const cropTexControl = this.screenCropTexture.control as CropTextureProvider;
        cropTexControl.inputTexture = camTexture;
        camTexControl.onNewFrame.add(() => { });

        if (this.enableLoggingLifecycle) {
            this.logger.debug("LIFECYCLE: start() - Camera service initialized");
        }
    }
}
