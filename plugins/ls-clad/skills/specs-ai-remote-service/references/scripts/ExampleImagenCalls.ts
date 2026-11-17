// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * SPECS Inc. 2027
 * Example implementation of Google Imagen API for AI image generation. Demonstrates text-to-image
 * generation with generateContent requests
 * using the Gemini image models served by the Imagen route, with tap/pinch gesture triggers.
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
  @allowUndefined
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
        .getPinchDownEvent(1 /* GestureModule.HandType.Right — numeric literal because LS 5.21 runtime doesn't expose the namespace enum as a value */ as unknown as GestureModule.HandType)
        .add(() => {
          this.onTap();
        });
    }
  }

  private onTap() {
    // GestureModule pinches arrive even while this example is disabled.
    if (!this.sceneObject.isEnabledInHierarchy) {
      return;
    }
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
    const request: GoogleGenAITypes.Imagen.GenerateContentRequest = {
      model: "gemini-3.1-flash-image",
      type: "generateContent",
      body: {
        contents: [
          {
            role: "user",
            parts: [
              {
                text: this.generatePrompt,
              },
            ],
          },
        ],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
        },
      },
    };

    Imagen.generateContent(request)
      .then((response) => {
        const parts = response.candidates?.[0]?.content?.parts ?? [];
        const imagePart = parts.find((part) => part?.inlineData?.data);
        if (!imagePart) {
          this.logger.debug("Imagen response has no image part: " + JSON.stringify(response));
          return;
        }
        this.setImageTextureFromBase64(imagePart.inlineData.data);
      })
      .catch((error) => {
        this.logger.debug("Imagen generate error: " + error);
      });
  }
}
