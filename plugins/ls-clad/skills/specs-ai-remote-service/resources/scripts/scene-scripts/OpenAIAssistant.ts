// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * Open AIAssistant component for the AI Playground Spectacles lens.
 */
import {OpenAI, OpenAIRealtimeWebsocket} from "RemoteServiceGateway.lspkg/HostedExternal/OpenAI"
import {AudioProcessor} from "RemoteServiceGateway.lspkg/Helpers/AudioProcessor"
import {DynamicAudioOutput} from "RemoteServiceGateway.lspkg/Helpers/DynamicAudioOutput"
import {MicrophoneRecorder} from "RemoteServiceGateway.lspkg/Helpers/MicrophoneRecorder"
import {OpenAITypes} from "RemoteServiceGateway.lspkg/HostedExternal/OpenAITypes"
import Event from "SpectaclesInteractionKit.lspkg/Utils/Event"
import {Logger} from "Utilities.lspkg/Scripts/Utils/Logger"

@component
export class OpenAIAssistant extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">OpenAIAssistant – OpenAI Realtime connection</span><br/><span style="color: #94A3B8; font-size: 11px;">Connects to the OpenAI Realtime API via WebSocket for real-time audio streaming and function calls.</span>')
  @ui.separator

  @ui.label('<span style="color: #60A5FA;">Setup</span>')
  @ui.group_start("Setup")
  @input
  @hint("SceneObject that enables the WebSocket requirements when the session starts")
  private websocketRequirementsObj: SceneObject

  @input
  @hint("DynamicAudioOutput component for PCM16 audio playback")
  private dynamicAudioOutput: DynamicAudioOutput

  @input
  @hint("MicrophoneRecorder component for capturing microphone input")
  private microphoneRecorder: MicrophoneRecorder
  @ui.group_end

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Inputs</span>')
  @ui.group_start("Inputs")
  @input
  @hint("System instruction text sent to OpenAI on session setup")
  @widget(new TextAreaWidget())
  private instructions: string = "You are a helpful assistant that loves to make puns"
  @ui.group_end

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Outputs</span>')
  @ui.group_start("Outputs")
  @ui.label(
    '<span style="color: yellow;">⚠️ To prevent audio feedback loop in Lens Studio Editor, use headphones or manage your microphone input.</span>'
  )
  @input
  @hint("Enable audio output from OpenAI responses")
  private haveAudioOutput: boolean = false

  @input
  @hint("Voice name for OpenAI audio output")
  @showIf("haveAudioOutput", true)
  @widget(
    new ComboBoxWidget([
      new ComboBoxItem("alloy", "alloy"),
      new ComboBoxItem("ash", "ash"),
      new ComboBoxItem("ballad", "ballad"),
      new ComboBoxItem("coral", "coral"),
      new ComboBoxItem("echo", "echo"),
      new ComboBoxItem("sage", "sage"),
      new ComboBoxItem("shimmer", "shimmer"),
      new ComboBoxItem("verse", "verse")
    ])
  )
  private voice: string = "coral"
  @ui.group_end

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Logging</span>')
  @input
  @hint("Enable general logging")
  enableLogging: boolean = false

  @input
  @hint("Enable lifecycle logging (onAwake, onStart, onUpdate, onDestroy)")
  enableLoggingLifecycle: boolean = false

  private logger: Logger
  private audioProcessor: AudioProcessor = new AudioProcessor()
  private OAIRealtime: OpenAIRealtimeWebsocket

  public updateTextEvent: Event<{text: string; completed: boolean}> = new Event<{text: string; completed: boolean}>()

  public functionCallEvent: Event<{
    name: string
    args: any
    callId?: string
  }> = new Event<{
    name: string
    args: any
    callId?: string
  }>()

  onAwake(): void {
    this.logger = new Logger("OpenAIAssistant", this.enableLogging || this.enableLoggingLifecycle, true)
    if (this.enableLoggingLifecycle) this.logger.debug("LIFECYCLE: onAwake()")
  }

  createOpenAIRealtimeSession(): void {
    this.websocketRequirementsObj.enabled = true
    let internetStatus = global.deviceInfoSystem.isInternetAvailable() ? "Websocket connected" : "No internet"

    this.updateTextEvent.invoke({text: internetStatus, completed: true})

    global.deviceInfoSystem.onInternetStatusChanged.add((args) => {
      internetStatus = args.isInternetAvailable ? "Reconnected to internet" : "No internet"
      this.updateTextEvent.invoke({text: internetStatus, completed: true})
    })
    this.dynamicAudioOutput.initialize(24000)
    this.microphoneRecorder.setSampleRate(24000)
    this.OAIRealtime = OpenAI.createRealtimeSession({
      model: "gpt-4o-mini-realtime-preview"
    })

    this.OAIRealtime.onOpen.add((event) => {
      this.logger.info("Connection opened")
      this.sessionSetup()
    })

    let completedTextDisplay = true

    this.OAIRealtime.onMessage.add((message) => {
      if (message.type === "response.text.delta" || message.type === "response.audio_transcript.delta") {
        if (!completedTextDisplay) {
          this.updateTextEvent.invoke({
            text: message.delta,
            completed: false
          })
        } else {
          this.updateTextEvent.invoke({
            text: message.delta,
            completed: true
          })
        }
        completedTextDisplay = false
      } else if (message.type === "response.done") {
        completedTextDisplay = true
      } else if (message.type === "response.audio.delta") {
        const delta = Base64.decode(message.delta)
        this.dynamicAudioOutput.addAudioFrame(delta)
      } else if (message.type === "response.output_item.done") {
        if (message.item && message.item.type === "function_call") {
          const functionCall = message.item
          this.logger.info(`Function called: ${functionCall.name}`)
          this.logger.debug(`Function args: ${functionCall.arguments}`)

          const args = JSON.parse(functionCall.arguments)
          this.functionCallEvent.invoke({
            name: functionCall.name,
            args: args,
            callId: functionCall.call_id
          })
        }
      } else if (message.type === "input_audio_buffer.speech_started") {
        this.logger.info("Speech started, interrupting the AI")
        this.dynamicAudioOutput.interruptAudioOutput()
      }
    })

    this.OAIRealtime.onError.add((event) => {
      this.logger.error("" + event)
    })

    this.OAIRealtime.onClose.add((event) => {
      this.logger.info("Connection closed: " + event.reason)
      this.updateTextEvent.invoke({
        text: "Websocket closed: " + event.reason,
        completed: true
      })
    })
  }

  public streamData(stream: boolean): void {
    if (stream) {
      this.microphoneRecorder.startRecording()
    } else {
      this.microphoneRecorder.stopRecording()
    }
  }

  public interruptAudioOutput(): void {
    if (this.dynamicAudioOutput && this.haveAudioOutput) {
      this.dynamicAudioOutput.interruptAudioOutput()
    } else {
      this.logger.warn("DynamicAudioOutput is not initialized")
    }
  }

  private sessionSetup(): void {
    const modalitiesArray = ["text"]
    if (this.haveAudioOutput) {
      modalitiesArray.push("audio")
    }

    const tools = [
      {
        type: "function",
        name: "Snap3D",
        description: "Generates a 3D model based on a text prompt",
        parameters: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description:
                "The text prompt to generate a 3D model from. Cartoonish styles work best. Use 'full body' when generating characters."
            }
          },
          required: ["prompt"]
        }
      } as OpenAITypes.Common.ToolDefinition
    ]

    const sessionUpdateMsg = {
      type: "session.update",
      session: {
        instructions: this.instructions,
        voice: this.voice,
        modalities: modalitiesArray,
        input_audio_format: "pcm16",
        tools: tools,
        output_audio_format: "pcm16",
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500,
          create_response: true
        }
      }
    } as OpenAITypes.Realtime.SessionUpdateRequest

    this.OAIRealtime.send(sessionUpdateMsg)

    this.audioProcessor.onAudioChunkReady.add((encodedAudioChunk) => {
      const audioMsg = {
        type: "input_audio_buffer.append",
        audio: encodedAudioChunk
      } as OpenAITypes.Realtime.ClientMessage
      this.OAIRealtime.send(audioMsg)
    })

    this.microphoneRecorder.onAudioFrame.add((audioFrame) => {
      this.audioProcessor.processFrame(audioFrame)
    })
  }

  public sendFunctionCallUpdate(functionName: string, callId: string, response: string): void {
    this.logger.debug("Call id = " + callId)
    const messageToSend = {
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: response
      }
    } as OpenAITypes.Realtime.ConversationItemCreateRequest

    this.OAIRealtime.send(messageToSend)
  }
}
