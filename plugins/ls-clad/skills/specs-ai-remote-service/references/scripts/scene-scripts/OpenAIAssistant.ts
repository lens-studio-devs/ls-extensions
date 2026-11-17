// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * SPECS Inc. 2027
 * Open AIAssistant component for the AI Playground Glasses lens.
 */
import {OpenAI, OpenAIRealtimeWebsocket} from "RemoteServiceGateway.lspkg/HostedExternal/OpenAI"
import {AudioProcessor} from "RemoteServiceGateway.lspkg/Helpers/AudioProcessor"
import {DynamicAudioOutput} from "RemoteServiceGateway.lspkg/Helpers/DynamicAudioOutput"
import {MicrophoneRecorder} from "RemoteServiceGateway.lspkg/Helpers/MicrophoneRecorder"
import {OpenAITypes} from "RemoteServiceGateway.lspkg/HostedExternal/OpenAITypes"
import Event from "InteractionKit.lspkg/Utils/Event"
import {Logger} from "Utilities.lspkg/Scripts/Utils/Logger"
import {PlaygroundLogger} from "./PlaygroundLogger"

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

  @input
  @hint("Realtime model. gpt-realtime / gpt-realtime-mini are the current GA models; gpt-4o-mini-realtime-preview is the legacy beta-era model.")
  @widget(
    new ComboBoxWidget([
      new ComboBoxItem("gpt-realtime", "gpt-realtime"),
      new ComboBoxItem("gpt-realtime-mini", "gpt-realtime-mini"),
      new ComboBoxItem("gpt-4o-mini-realtime-preview", "gpt-4o-mini-realtime-preview")
    ])
  )
  private realtimeModel: string = "gpt-realtime-mini"
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
  // GA Realtime API session shape is tried first; if the gateway is still on
  // the beta API shape it rejects it and we resend the legacy beta payload.
  private usingGASessionShape: boolean = true
  // Mic/audio handlers are wired to component-level events, so they must only
  // be added once even when a session is closed and reopened.
  private inputsWired: boolean = false

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
    PlaygroundLogger.log("OpenAI Realtime: connecting...")
    this.websocketRequirementsObj.enabled = true
    let internetStatus = global.deviceInfoSystem.isInternetAvailable() ? "Connecting to OpenAI Realtime…" : "No internet"

    this.updateTextEvent.invoke({text: internetStatus, completed: true})

    global.deviceInfoSystem.onInternetStatusChanged.add((args) => {
      internetStatus = args.isInternetAvailable ? "Reconnected to internet" : "No internet"
      this.updateTextEvent.invoke({text: internetStatus, completed: true})
    })
    this.dynamicAudioOutput.initialize(24000)
    this.microphoneRecorder.setSampleRate(24000)
    this.OAIRealtime = OpenAI.createRealtimeSession({
      model: this.realtimeModel
    })

    this.OAIRealtime.onOpen.add((event) => {
      PlaygroundLogger.log("OpenAI Realtime: connected — session setup sent")
      this.logger.info("Connection opened")
      this.sessionSetup()
    })

    let completedTextDisplay = true

    this.OAIRealtime.onMessage.add((message) => {
      // The GA Realtime API renamed the response.* events (text.delta →
      // output_text.delta, audio.delta → output_audio.delta, ...). Handle both
      // families so this works on either side of the gateway migration.
      const msg = message as any
      const msgType = msg.type as string
      if (
        msgType === "response.text.delta" ||
        msgType === "response.audio_transcript.delta" ||
        msgType === "response.output_text.delta" ||
        msgType === "response.output_audio_transcript.delta"
      ) {
        if (!completedTextDisplay) {
          this.updateTextEvent.invoke({
            text: msg.delta,
            completed: false
          })
        } else {
          PlaygroundLogger.log("OpenAI: response streaming...")
          this.updateTextEvent.invoke({
            text: msg.delta,
            completed: true
          })
        }
        completedTextDisplay = false
      } else if (msgType === "session.updated") {
        PlaygroundLogger.log("OpenAI Realtime: session ready")
        this.updateTextEvent.invoke({text: "Ready — activate the orb and start talking", completed: true})
      } else if (msgType === "response.done") {
        PlaygroundLogger.log("OpenAI: response complete")
        completedTextDisplay = true
      } else if (msgType === "response.audio.delta" || msgType === "response.output_audio.delta") {
        const delta = Base64.decode(msg.delta)
        this.dynamicAudioOutput.addAudioFrame(delta)
      } else if (msgType === "response.output_item.done") {
        if (msg.item && msg.item.type === "function_call") {
          const functionCall = msg.item
          PlaygroundLogger.log(`OpenAI: function call → ${functionCall.name}`)
          this.logger.info(`Function called: ${functionCall.name}`)
          this.logger.debug(`Function args: ${functionCall.arguments}`)

          const args = JSON.parse(functionCall.arguments)
          this.functionCallEvent.invoke({
            name: functionCall.name,
            args: args,
            callId: functionCall.call_id
          })
        }
      } else if (msgType === "input_audio_buffer.speech_started") {
        PlaygroundLogger.log("OpenAI: speech detected — listening")
        this.logger.info("Speech started, interrupting the AI")
        this.dynamicAudioOutput.interruptAudioOutput()
      } else if (msgType === "error") {
        const err = msg.error || {}
        PlaygroundLogger.log(`OpenAI server error: ${err.code || ""} ${err.message || JSON.stringify(msg)}`)
        this.logger.error("Server error: " + JSON.stringify(msg))
        // Gateway still on the beta API shape rejects the GA session payload —
        // fall back to the legacy beta session.update once.
        if (
          this.usingGASessionShape &&
          (err.code === "unknown_parameter" ||
            err.code === "invalid_value" ||
            (typeof err.message === "string" && err.message.indexOf("session") !== -1))
        ) {
          this.usingGASessionShape = false
          PlaygroundLogger.log("OpenAI: GA session shape rejected — retrying with beta shape")
          this.OAIRealtime.send(this.buildSessionUpdate(false))
        }
      }
    })

    this.OAIRealtime.onError.add((event) => {
      PlaygroundLogger.log(`OpenAI websocket error: ${JSON.stringify(event)}`)
      this.updateTextEvent.invoke({text: "Couldn't connect to OpenAI Realtime. Check the Remote Service Gateway token.", completed: true})
      this.logger.error("" + event)
    })

    this.OAIRealtime.onClose.add((event) => {
      // Known gateway failure modes: code 4000 "beta_api_shape_disabled" =
      // gateway still sends the legacy OpenAI-Beta header (server-side, needs
      // a Snap fix); code 3008 "internal error" before open = gateway-side
      // endpoint failure. Neither is caused by Lens code.
      PlaygroundLogger.log(`OpenAI Realtime: closed (code=${event.code}, reason=${event.reason || "none"}, clean=${event.wasClean})`)
      this.logger.info("Connection closed: " + event.reason)
      this.updateTextEvent.invoke({
        text: "Websocket closed: " + event.reason,
        completed: true
      })
    })
  }

  public streamData(stream: boolean): void {
    PlaygroundLogger.log(stream ? "OpenAI: mic streaming started" : "OpenAI: mic streaming stopped")
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

  public closeSession(): void {
    this.microphoneRecorder.stopRecording()
    if (this.OAIRealtime && this.OAIRealtime.isConnected()) {
      PlaygroundLogger.log("OpenAI Realtime: closing session")
      this.OAIRealtime.close()
    }
  }

  private sessionSetup(): void {
    // GA shape first; if the gateway is still on the beta API shape, the
    // server "error" handler in onMessage falls back to the beta payload.
    this.usingGASessionShape = true
    this.OAIRealtime.send(this.buildSessionUpdate(true))

    if (this.inputsWired) return
    this.inputsWired = true

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

  /**
   * Builds the session.update payload in either the GA Realtime API shape
   * (session.type "realtime", output_modalities, nested audio config) or the
   * legacy beta shape (modalities, input/output_audio_format, flat
   * turn_detection). See the beta-to-GA migration guide:
   * https://developers.openai.com/api/docs/guides/realtime#beta-to-ga-migration
   */
  private buildSessionUpdate(gaShape: boolean): any {
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

    const turnDetection = {
      type: "server_vad",
      threshold: 0.5,
      prefix_padding_ms: 300,
      silence_duration_ms: 500,
      create_response: true
    }

    if (gaShape) {
      return {
        type: "session.update",
        session: {
          type: "realtime",
          instructions: this.instructions,
          // GA accepts a single output modality; audio responses include
          // transcript events, so text display keeps working either way.
          output_modalities: [this.haveAudioOutput ? "audio" : "text"],
          audio: {
            input: {
              format: {type: "audio/pcm", rate: 24000},
              turn_detection: turnDetection
            },
            output: {
              format: {type: "audio/pcm", rate: 24000},
              voice: this.voice
            }
          },
          tools: tools
        }
      }
    }

    const modalitiesArray = ["text"]
    if (this.haveAudioOutput) {
      modalitiesArray.push("audio")
    }
    return {
      type: "session.update",
      session: {
        instructions: this.instructions,
        voice: this.voice,
        modalities: modalitiesArray,
        input_audio_format: "pcm16",
        tools: tools,
        output_audio_format: "pcm16",
        turn_detection: turnDetection
      }
    } as OpenAITypes.Realtime.SessionUpdateRequest
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
