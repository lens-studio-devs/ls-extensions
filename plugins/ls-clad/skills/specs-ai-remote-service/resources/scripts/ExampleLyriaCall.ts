// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * Example implementation of Google Lyria API for AI music generation. Demonstrates creating
 * original music compositions with customizable prompts, negative prompts, seed values, and
 * playback through dynamic audio output with tap/pinch gestures.
 */
import { Lyria } from "../Lyria";
import { GoogleGenAITypes } from "../GoogleGenAITypes";
import { DynamicAudioOutput } from "../../Helpers/DynamicAudioOutput";
import { Logger } from "Utilities.lspkg/Scripts/Utils/Logger";
import { bindStartEvent, bindUpdateEvent, bindLateUpdateEvent, bindDestroyEvent } from "SnapDecorators.lspkg/decorators";

@component
export class ExampleLyriaCall extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Lyria Music Generation</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Configure and test AI-powered music generation</span>')

  @ui.group_start("Music Generation Example")
  @input
  @widget(new TextAreaWidget())
  private musicPrompt: string =
    "An energetic electronic dance track with a fast tempo";

  @input
  @widget(new TextAreaWidget())
  private negativePrompt: string = "vocals, slow tempo";

  @input
  private seed: number = 12345;

  @input
  private sampleCount: number = 1;

  @input
  @label("Generate Music on tap")
  private generateMusicOnTap: boolean = false;

  @input
  dynamicAudioOutput: DynamicAudioOutput;

  @ui.group_end
  @ui.separator
  @ui.group_start("Audio Output")
  @input
  @label("Play Generated Audio")
  private playAudioOnTap: boolean = false;

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
  private gestureModule: GestureModule = require("LensStudio:GestureModule");
  private isGeneratingMusic: boolean = false;  /**
   * Called when component is initialized
   */
  onAwake(): void {
    // Initialize logger
    this.logger = new Logger("ExampleLyriaCall", this.enableLogging || this.enableLoggingLifecycle, true);

    if (this.enableLoggingLifecycle) {
      this.logger.debug("LIFECYCLE: onAwake() - Component initializing");
    }


    if (this.playAudioOnTap) {
      this.createEvent("TapEvent").bind(() => {
        this.onTap();
      });
      this.gestureModule
        .getPinchDownEvent(GestureModule.HandType.Right)
        .add(() => {
          this.onTap();
        });
    }
  }

  onTap() {
    if (this.generateMusicOnTap) {
      this.generateMusic();
    }
  }
  private generateMusic() {
    // Check if a music generation is already in progress
    if (this.isGeneratingMusic) {
      print("Music generation is already in progress. Please wait...");
      return;
    }

    this.isGeneratingMusic = true;
    print("Generating music... This may take a moment.");

    // Create the music generation request using the exact Lyria API specification
    const musicRequest: GoogleGenAITypes.Lyria.LyriaRequest = {
      model: "lyria-002",
      type: "predict",
      body: {
        instances: [
          {
            prompt: this.musicPrompt,
            negative_prompt: this.negativePrompt || undefined,
            seed: this.seed || undefined,
          },
        ],
        parameters: {
          sample_count: this.sampleCount || undefined,
        },
      },
    };
    this.dynamicAudioOutput.initialize(48000);
    // Call the Lyria API
    Lyria.performLyriaRequest(musicRequest)
      .then((response) => {
        response.predictions.forEach((prediction) => {
          const b64 = prediction.bytesBase64Encoded;
          this.dynamicAudioOutput.addAudioFrame(Base64.decode(b64), 2);
        });
      })
      .catch((error) => {
        this.isGeneratingMusic = false;
        print(`Music generation failed: ${error.message || error}`);
        print(`[Lyria Error] ${error}`);
      });
  }
}
