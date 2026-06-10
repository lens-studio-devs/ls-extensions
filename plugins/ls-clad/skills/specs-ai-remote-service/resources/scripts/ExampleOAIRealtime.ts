// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * Example implementation of OpenAI Realtime API with streaming audio conversations. Demonstrates
 * WebSocket-based real-time chat with voice selection, microphone input, audio output, function
 * calling, and bidirectional communication using GPT-4o-mini-realtime.
 */
import { AudioProcessor } from "../../Helpers/AudioProcessor";
import { DynamicAudioOutput } from "../../Helpers/DynamicAudioOutput";
import { MicrophoneRecorder } from "../../Helpers/MicrophoneRecorder";
import { OpenAI } from "../OpenAI";
import { OpenAITypes } from "../OpenAITypes";
import { Logger } from "Utilities.lspkg/Scripts/Utils/Logger";
import { bindStartEvent, bindUpdateEvent, bindLateUpdateEvent, bindDestroyEvent } from "SnapDecorators.lspkg/decorators";

@component
export class ExampleOAIRealtime extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">OpenAI Realtime Configuration</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Configure real-time voice AI interaction with audio streaming</span>')

  @ui.group_start("Setup")
  @input
  private websocketRequirementsObj: SceneObject;
  @input
  private dynamicAudioOutput: DynamicAudioOutput;
  @input
  private microphoneRecorder: MicrophoneRecorder;
  @input
  private textDisplay: Text;
  @ui.group_end
  @ui.separator
  @ui.group_start("Inputs")
  @input
  @widget(new TextAreaWidget())
  private instructions: string =
    "You are a helpful assistant that loves to make puns";
  @ui.group_end
  @ui.separator
  @ui.group_start("Outputs")
  @ui.label(
    '<span style="color: yellow;">⚠️ To prevent audio feedback loop in Lens Studio Editor, use headphones or manage your microphone input.</span>'
  )
  @input
  private audioOutput: boolean = false;

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
  private logger: Logger;  @input
  @showIf("audioOutput", true)
  @widget(
    new ComboBoxWidget([
      new ComboBoxItem("alloy", "alloy"),
      new ComboBoxItem("ash", "ash"),
      new ComboBoxItem("ballad", "ballad"),
      new ComboBoxItem("coral", "coral"),
      new ComboBoxItem("echo", "echo"),
      new ComboBoxItem("sage", "sage"),
      new ComboBoxItem("shimmer", "shimmer"),
      new ComboBoxItem("verse", "verse"),
    ])
  )
  private voice: string = "coral";
  @ui.group_end
  @ui.separator
  private audioProcessor: AudioProcessor = new AudioProcessor();  /**
   * Called when component is initialized
   */
  onAwake(): void {
    // Initialize logger
    this.logger = new Logger("ExampleOAIRealtime", this.enableLogging || this.enableLoggingLifecycle, true);

    if (this.enableLoggingLifecycle) {
      this.logger.debug("LIFECYCLE: onAwake() - Component initializing");
    }


    this.websocketRequirementsObj.enabled = true;
    this.createEvent("OnStartEvent").bind(() => {
      this.dynamicAudioOutput.initialize(24000);
      this.connectToWebsocket();
    });

    // Display internet connection status
    this.textDisplay.text = global.deviceInfoSystem.isInternetAvailable()
      ? "Websocket connected"
      : "No internet";

    global.deviceInfoSystem.onInternetStatusChanged.add((args) => {
      this.textDisplay.text = args.isInternetAvailable
        ? "Reconnected to internete"
        : "No internet";
    });
  }

  connectToWebsocket() {
    const OAIRealtime = OpenAI.createRealtimeSession({
      model: "gpt-4o-mini-realtime-preview",
    });

    OAIRealtime.onOpen.add((event) => {
      print("Connection opened");
      const modalitiesArray = ["text"];
      if (this.audioOutput) {
        modalitiesArray.push("audio");
      }

      const setTextColor: OpenAITypes.Common.ToolDefinition = {
        type: "function",
        name: "set-text-color",
        description:
          "Use this function to set the text color of the text display",
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
      };

      // Set up the session
      const sessionUpdateMsg: OpenAITypes.Realtime.SessionUpdateRequest = {
        type: "session.update",
        session: {
          instructions: this.instructions,
          voice: this.voice,
          modalities: modalitiesArray,
          input_audio_format: "pcm16",
          tools: [setTextColor],
          output_audio_format: "pcm16",
          turn_detection: {
            type: "server_vad",
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
            create_response: true,
          },
        },
      };
      OAIRealtime.send(sessionUpdateMsg);

      // Process microphone input to send to the server
      this.audioProcessor.onAudioChunkReady.add((encodedAudioChunk) => {
        const audioMsg: OpenAITypes.Realtime.ClientMessage = {
          type: "input_audio_buffer.append",
          audio: encodedAudioChunk,
        };
        OAIRealtime.send(audioMsg);
      });

      // Configure the microphone
      this.microphoneRecorder.setSampleRate(24000);
      this.microphoneRecorder.onAudioFrame.add((audioFrame) => {
        this.audioProcessor.processFrame(audioFrame);
      });

      this.microphoneRecorder.startRecording();
    });

    let completedTextDisplay = true;

    OAIRealtime.onMessage.add((message) => {
      // Listen for text responses
      if (
        message.type === "response.text.delta" ||
        message.type === "response.audio_transcript.delta"
      ) {
        if (!completedTextDisplay) {
          this.textDisplay.text += message.delta;
        } else {
          this.textDisplay.text = message.delta;
        }
        completedTextDisplay = false;
      } else if (message.type === "response.done") {
        completedTextDisplay = true;
      }

      // Set up Audio Playback
      else if (message.type === "response.audio.delta") {
        const delta = Base64.decode(message.delta);
        this.dynamicAudioOutput.addAudioFrame(delta);
      }
      // Listen for function calls
      else if (message.type === "response.output_item.done") {
        if (message.item && message.item.type === "function_call") {
          const functionCall = message.item;
          print(`Function called: ${functionCall.name}`);
          print(`Function args : ${functionCall.arguments}`);
          print("call_id: " + functionCall.call_id);
          const args = JSON.parse(functionCall.arguments);
          this.textDisplay.textFill.color = new vec4(
            args.r / 255,
            args.g / 255,
            args.b / 255,
            1
          );

          // Send a message back to the server indicating the function call was successful
          const messageToSend: OpenAITypes.Realtime.ConversationItemCreateRequest =
            {
              type: "conversation.item.create",
              item: {
                type: "function_call_output",
                call_id: functionCall.call_id,
                output:
                  "You have successfully called the function to set the text color.",
              },
            };

          OAIRealtime.send(messageToSend);
        }
      }
    });

    OAIRealtime.onError.add((event) => {
      print("Websocket error: " + event);
    });

    OAIRealtime.onClose.add((event) => {
      this.textDisplay.text = "Websocket closed: " + event.reason;
      print("Websocket closed: " + event.reason);
    });
  }
}
