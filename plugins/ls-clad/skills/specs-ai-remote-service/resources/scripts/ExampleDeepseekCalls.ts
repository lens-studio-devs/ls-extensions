// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * Example implementation of DeepSeek R1 chat completions with reasoning. Demonstrates how to
 * configure prompts, handle responses with reasoning content, and display results using tap or
 * pinch gestures for interactive AI chat experiences.
 */
import { DeepSeek } from "../Deepseek";
import { DeepSeekTypes } from "../DeepSeekTypes";
import { Logger } from "Utilities.lspkg/Scripts/Utils/Logger";
import { bindStartEvent, bindUpdateEvent, bindLateUpdateEvent, bindDestroyEvent } from "SnapDecorators.lspkg/decorators";

@component
export class ExampleDeepseekCalls extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Chat Completions Configuration</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Configure DeepSeek R1 chat completion parameters and text display</span>')

  @ui.group_start("Chat Completions Example")
  @input
  textDisplay: Text;
  @input
  @widget(new TextAreaWidget())
  // DeepSeek-R1 is a reasoning model. Adding this prompt reduces reasoning for faster response.
  private systemPrompt: string =
    "Give your reasoning in no more than one sentence.";
  @input
  @widget(new TextAreaWidget())
  private userPrompt: string = "Is a hotdog a sandwich";
  @input
  private runOnTap: boolean = false;

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
  private gestureModule: GestureModule = require("LensStudio:GestureModule");  /**
   * Called when component is initialized
   */
  onAwake(): void {
    // Initialize logger
    this.logger = new Logger("ExampleDeepseekCalls", this.enableLogging || this.enableLoggingLifecycle, true);

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
    if (this.runOnTap) {
      this.doChatCompletions();
    }
  }
  doChatCompletions() {
    this.textDisplay.sceneObject.enabled = true;
    this.textDisplay.text = "Generating...";
    const messageArray: Array<DeepSeekTypes.ChatCompletions.Message> = [
      {
        role: "system",
        content: this.systemPrompt,
      },
      {
        role: "user",
        content: this.userPrompt,
      },
    ];

    const deepSeekRequest: DeepSeekTypes.ChatCompletions.Request = {
      model: "DeepSeek-R1",
      messages: messageArray,
      max_tokens: 2048,
      temperature: 0.7,
    };

    DeepSeek.chatCompletions(deepSeekRequest)
      .then((response) => {
        const reasoningContent = response?.choices[0]?.message?.reasoning_content;
        const messageContent = response?.choices[0]?.message?.content;
        this.textDisplay.text = "Reasoning: " + reasoningContent + "\n\n";
        this.textDisplay.text += "Final answer: " + messageContent;
      })
      .catch((error) => {
        this.textDisplay.text = "Error: " + error;
      });
  }
}
