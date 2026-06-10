// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * Example implementation of Google Imagen API for AI image generation. Demonstrates text-to-image
 * generation with customizable parameters including aspect ratio, watermarking, and prompt enhancement
 * using Imagen 3.0 models with tap/pinch gesture triggers.
 */
import { Imagen } from "../Imagen";
import { GoogleGenAITypes } from "../GoogleGenAITypes";
import { Logger } from "Utilities.lspkg/Scripts/Utils/Logger";
import { bindStartEvent, bindUpdateEvent, bindLateUpdateEvent, bindDestroyEvent } from "SnapDecorators.lspkg/decorators";

@component
export class ExampleImagenCalls extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Imagen Image Generation</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Configure and test AI-powered image generation</span>')

  @ui.group_start("Generate Image Example")
  @input
  private imgObject: SceneObject;
  @input
  @widget(new TextAreaWidget())
  private generatePrompt: string = "A futuristic cityscape at sunset";
  @input
  @label("Run On Tap")
  private doGenerateOnTap: boolean = false;

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
  private logger: Logger;  @ui.group_end
  // Edit and Upscale are not supported by current proxy; removed from example
  private gestureModule: GestureModule = require("LensStudio:GestureModule");  /**
   * Called when component is initialized
   */
  onAwake(): void {
    // Initialize logger
    this.logger = new Logger("ExampleImagenCalls", this.enableLogging || this.enableLoggingLifecycle, true);

    if (this.enableLoggingLifecycle) {
      this.logger.debug("LIFECYCLE: onAwake() - Component initializing");
    }


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
    if (this.doGenerateOnTap) {
      this.generateImageExample();
    }
  }

  private setImageTextureFromBase64(base64PngOrJpeg: string) {
    if (!this.imgObject) {
      this.logger.debug("ExampleImagenCalls: imgObject not assigned.");
      return;
    }
    this.imgObject.enabled = true;
    Base64.decodeTextureAsync(
      base64PngOrJpeg,
      (texture) => {
        const imgComponent = this.imgObject.getComponent("Image");
        if (!imgComponent) {
          this.logger.debug("ExampleImagenCalls: SceneObject has no Image component.");
          return;
        }
        const imageMaterial = imgComponent.mainMaterial.clone();
        imgComponent.mainMaterial = imageMaterial;
        imgComponent.mainPass.baseTex = texture;
      },
      () => {
        this.logger.debug("ExampleImagenCalls: Failed to decode texture from base64 data.");
      }
    );
  }

  private generateImageExample() {
    this.logger.debug("Generating image with prompt: " + this.generatePrompt);
    const request: GoogleGenAITypes.Imagen.ImagenRequest = {
      model: "imagen-3.0-generate-002",
      body: {
        parameters: {
          sampleCount: 1,
          addWatermark: false,
          aspectRatio: "1:1",
          enhancePrompt: true,
          language: "en",
          seed: 0,
        },
        instances: [
          {
            prompt: this.generatePrompt,
          },
        ],
      },
    };

    Imagen.generateImage(request)
      .then((response) => {
        this.logger.debug("Response: " + JSON.stringify(response));
        response.predictions.forEach((prediction) => {
          const b64 = prediction.bytesBase64Encoded;
          Base64.decodeTextureAsync(
            b64,
            (texture) => {
              this.imgObject.getComponent("Image").mainPass.baseTex = texture;
            },
            () => {
              this.logger.debug("Failed to decode texture from base64 data.");
            }
          );
        });
      })
      .catch((error) => {
        this.logger.debug("Imagen generate error: " + error);
      });
  }
}
