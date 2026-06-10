// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * Example implementations of OpenAI API calls. Demonstrates chat completions with GPT models,
 * DALL-E image generation and editing, TTS speech synthesis, and function calling with color
 * manipulation using tap/pinch gestures.
 */
import { OpenAI } from "../OpenAI";
import { OpenAITypes } from "../OpenAITypes";
import { Promisfy } from "../../Utils/Promisfy";
import { Logger } from "Utilities.lspkg/Scripts/Utils/Logger";
import { bindStartEvent, bindUpdateEvent, bindLateUpdateEvent, bindDestroyEvent } from "SnapDecorators.lspkg/decorators";

@component
export class ExampleOAICalls extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">OpenAI API Examples</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Configure and test OpenAI chat, image, voice, and function calling capabilities</span>')

  @ui.group_start("Chat Completions Example")
  @input
  textDisplay: Text;
  @input
  @widget(new TextAreaWidget())
  private systemPrompt: string =
    "You are an incredibly smart but witty AI assistant who likes to answer life's greatest mysteries in under two sentences";
  @input
  @widget(new TextAreaWidget())
  private userPrompt: string = "Is a hotdog a sandwich";
  @input
  @label("Run On Tap")
  private doChatCompletionsOnTap: boolean = false;
  @ui.group_end
  @ui.separator
  @ui.group_start("Image Generation Example")
  @input
  private imgObject: SceneObject;
  @input
  @widget(new TextAreaWidget())
  private imageGenerationPrompt: string = "The future of augmented reality";
  @input
  @label("Run On Tap")
  private generateImageOnTap: boolean = false;
  @ui.group_end
  @ui.separator
  @ui.group_start("Image Edit Example")
  @input
  private editBaseImg: Texture;
  @input
  private editMaskImg: Texture;
  @input
  private editResultObject: SceneObject;
  @input
  @widget(new TextAreaWidget())
  private imageEditPrompt: string = "Add a cat into the image";
  @input
  @label("Run On Tap")
  private doEditImageOnTap: boolean = false;
  @ui.group_end
  @ui.separator
  @ui.group_start("Voice Generation Example")
  @input
  @widget(new TextAreaWidget())
  private voiceGenerationPrompt: string =
    "Get ready for the future of augmented reality with Lens Studio!";
  @input
  @widget(new TextAreaWidget())
  private voiceGenerationInstructions: string =
    "Serious, movie trailer voice, insert pauses for dramatic effect";
  @input
  @label("Run On Tap")
  private generateVoiceOnTap: boolean = false;
  @ui.group_end
  @ui.separator
  @ui.group_start("Function Calling Example")
  @input
  @widget(new TextAreaWidget())
  private functionCallingPrompt: string = "Make the text display yellow";
  @input
  @label("Run On Tap")
  private doFunctionCallingOnTap: boolean = false;

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
  private rmm = require("LensStudio:RemoteMediaModule") as RemoteMediaModule;
  private internetModule =
    require("LensStudio:InternetModule") as InternetModule;
  private gestureModule: GestureModule = require("LensStudio:GestureModule");
  private loaderSpinnerImage: SceneObject;  /**
   * Called when component is initialized
   */
  onAwake(): void {
    // Initialize logger
    this.logger = new Logger("ExampleOAICalls", this.enableLogging || this.enableLoggingLifecycle, true);

    if (this.enableLoggingLifecycle) {
      this.logger.debug("LIFECYCLE: onAwake() - Component initializing");
    }


    this.initializeSpinner();

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
    if (this.generateVoiceOnTap) {
      this.doSpeechGeneration();
    }

    if (this.generateImageOnTap) {
      this.doImageGeneration();
    }

    if (this.doChatCompletionsOnTap) {
      this.doChatCompletions();
    }

    if (this.doFunctionCallingOnTap) {
      this.doFunctionCalling();
    }

    if (this.doEditImageOnTap) {
      this.doImageEdit();
    }
  }
  doChatCompletions() {
    this.textDisplay.sceneObject.enabled = true;
    this.textDisplay.text = "Generating...";
    OpenAI.chatCompletions({
      model: "gpt-4.1-nano",
      messages: [
        {
          role: "system",
          content: this.systemPrompt,
        },
        {
          role: "user",
          content: this.userPrompt,
        },
      ],
      temperature: 0.7,
    })
      .then((response) => {
        this.textDisplay.text = response.choices[0].message.content;
      })
      .catch((error) => {
        this.textDisplay.text = "Error: " + error;
      });
  }


  doImageGeneration() {
    this.imgObject.enabled = true;
    this.loaderSpinnerImage.enabled = true;
    OpenAI.imagesGenerate({
      model: "dall-e-2",
      prompt: this.imageGenerationPrompt,
      n: 1,
      size: "512x512",
    })
      .then((response) => {
        print("Image Generated");
        const datum = response.data[0];
        const url = datum.url;
        const b64 = datum.b64_json;
        if (url) {
          print("Texture loaded as image URL");
          const httpRequest = RemoteServiceHttpRequest.create();
          httpRequest.url = url;
          return Promisfy.InternetModule.performHttpRequest(
            this.internetModule,
            httpRequest
          ).then((httpResponse) => {
            const resource = httpResponse.asResource();
            return Promisfy.RemoteMediaModule.loadResourceAsImageTexture(
              this.rmm,
              resource
            );
          });
        } else if (b64) {
          print("Decoding texture from base64");
          return new Promise<Texture>((resolve, reject) => {
            Base64.decodeTextureAsync(
              b64,
              (texture) => resolve(texture),
              () => reject("Failure to decode texture from base64")
            );
          });
        }
      })
      .then((texture) => {
        if (texture) {
          this.loaderSpinnerImage.enabled = false;
          const imgComponent = this.imgObject.getComponent("Image");
          const imageMaterial = imgComponent.mainMaterial.clone();
          imgComponent.mainMaterial = imageMaterial;
          imgComponent.mainPass.baseTex = texture;
        }
      })
      .catch((error) => {
        this.loaderSpinnerImage.enabled = false;
        print("Error: " + error);
        this.textDisplay.text = "Error: " + error;
      });
  }

  doImageEdit() {
    if (!this.editBaseImg || !this.editMaskImg) {
      print("Error: Base image or mask image is missing");
      return;
    }

    this.editResultObject.enabled = true;

    // Convert textures to base64
    Promise.all([
      new Promise<Uint8Array>((resolve, reject) => {
        Base64.encodeTextureAsync(
          this.editBaseImg,
          (base64) => resolve(Base64.decode(base64)),
          reject,
          CompressionQuality.LowQuality,
          EncodingType.Png
        );
      }),
      new Promise<Uint8Array>((resolve, reject) => {
        Base64.encodeTextureAsync(
          this.editMaskImg,
          (base64) => resolve(Base64.decode(base64)),
          reject,
          CompressionQuality.LowQuality,
          EncodingType.Png
        );
      }),
    ])
      .then(([baseImageData, maskImageData]) => {
        // Call the OpenAI image edit API
        const imageEditRequest: OpenAITypes.ImageEdits.Request = {
          prompt: this.imageEditPrompt,
          image: baseImageData,
          mask: maskImageData,
          n: 1,
          size: "512x512",
          model: "dall-e-2",
        };
        OpenAI.imagesEdit(imageEditRequest)
          .then((response) => {
            print("Image Edit Generated");
            response.data.forEach(async (datum) => {
              const url = datum.url;
              const b64 = datum.b64_json;
              if (url) {
                print("Texture loaded as image URL");
                const httpRequest = RemoteServiceHttpRequest.create();
                httpRequest.url = url;
                const resource = await Promisfy.InternetModule.performHttpRequest(
                  this.internetModule,
                  httpRequest
                );
                this.rmm.loadResourceAsImageTexture(
                  resource,
                  (texture) => {
                    const imgComponent =
                      this.editResultObject.getComponent("Image");
                    const imageMaterial = imgComponent.mainMaterial.clone();
                    imgComponent.mainMaterial = imageMaterial;
                    imgComponent.mainPass.baseTex = texture;
                  },
                  () => {
                    print("Failure to download texture from URL");
                  }
                );
              } else if (b64) {
                print("Decoding texture from base64");
                Base64.decodeTextureAsync(
                  b64,
                  (texture) => {
                    const imgComponent =
                      this.editResultObject.getComponent("Image");
                    imgComponent.mainPass.baseTex = texture;
                  },
                  () => {
                    print("Failure to download texture from base64");
                  }
                );
              }
            });
          })
          .catch((error) => {
            print("Error: " + error);
            if (this.textDisplay) {
              this.textDisplay.text = "Error: " + error;
            }
          });
      })
      .catch((error) => {
        print("Error encoding textures: " + error);
      });
  }

  doSpeechGeneration() {
    OpenAI.speech({
      model: "gpt-4o-mini-tts",
      input: this.voiceGenerationPrompt,
      voice: "coral",
      instructions: this.voiceGenerationInstructions,
    })
      .then((response) => {
        print("Got speech response");
        const aud = this.sceneObject.createComponent("AudioComponent");
        aud.audioTrack = response;
        aud.play(1);
      })
      .catch((error) => {
        print("Error: " + error);
        this.textDisplay.text = "Error: " + error;
      });
  }

  private initializeSpinner() {
    this.loaderSpinnerImage = this.imgObject.getChild(0);
    this.loaderSpinnerImage.enabled = false;
  }

  doFunctionCalling() {
    this.textDisplay.sceneObject.enabled = true;
    this.textDisplay.text = "Processing function call...";

    // Define available functions
    const tools: OpenAITypes.Common.Tool[] = [
      {
        type: "function",
        function: {
          name: "set-text-color",
          description: "Set the color of the text display",
          parameters: {
            type: "object",
            properties: {
              r: {
                type: "number",
                description: "Red component of the color (0-255)",
              },
              g: {
                type: "number",
                description: "Green component of the color (0-255)",
              },
              b: {
                type: "number",
                description: "Blue component of the color (0-255)",
              },
            },
            required: ["r", "g", "b"],
          },
        },
      },
    ];

    OpenAI.chatCompletions({
      model: "gpt-4.1-nano",
      messages: [
        {
          role: "user",
          content: this.functionCallingPrompt,
        },
      ],
      tools: tools,
      tool_choice: "auto",
      temperature: 0.7,
    })
      .then((response) => {
        const message = response.choices[0].message;

        if (message.tool_calls && message.tool_calls.length > 0) {
          const toolCall = message.tool_calls[0];

          if (toolCall.function.name === "set-text-color") {
            const args = JSON.parse(toolCall.function.arguments);
            this.textDisplay.textFill.color = new vec4(
              args.r / 255,
              args.g / 255,
              args.b / 255,
              1
            );
            this.textDisplay.text = `Text color set to RGB(${args.r}, ${args.g}, ${args.b})`;
          }
        }
      })
      .catch((error) => {
        this.textDisplay.text = "Error: " + error;
      });
  }
}
