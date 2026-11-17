// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * SPECS Inc. 2027
 * Gemini Assistant component for the AI Playground Glasses lens.
 */
import {Gemini, GeminiLiveWebsocket} from "RemoteServiceGateway.lspkg/HostedExternal/Gemini"
import {AudioProcessor} from "RemoteServiceGateway.lspkg/Helpers/AudioProcessor"
import {DynamicAudioOutput} from "RemoteServiceGateway.lspkg/Helpers/DynamicAudioOutput"
import {MicrophoneRecorder} from "RemoteServiceGateway.lspkg/Helpers/MicrophoneRecorder"
import {VideoController} from "RemoteServiceGateway.lspkg/Helpers/VideoController"
import {GeminiTypes} from "RemoteServiceGateway.lspkg/HostedExternal/GeminiTypes"
import Event from "InteractionKit.lspkg/Utils/Event"
import {Logger} from "Utilities.lspkg/Scripts/Utils/Logger"
import {PlaygroundLogger} from "./PlaygroundLogger"

@component
export class GeminiAssistant extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">GeminiAssistant – Gemini Live connection</span><br/><span style="color: #94A3B8; font-size: 11px;">Connects to the Gemini Live API via WebSocket for real-time audio and video streaming.</span>')
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
  @hint("System instruction text sent to Gemini on session setup")
  @widget(new TextAreaWidget())
  private instructions: string = "You are a helpful assistant that loves to make puns"

  @input
  @hint("Send camera frames to Gemini alongside microphone audio")
  private haveVideoInput: boolean = false
  @ui.group_end

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Outputs</span>')
  @ui.group_start("Outputs")
  @ui.label(
    '<span style="color: yellow;">⚠️ To prevent audio feedback loop in Lens Studio Editor, use headphones or manage your microphone input.</span>'
  )
  @input
  @hint("Enable audio output from Gemini responses")
  private haveAudioOutput: boolean = false

  @input
  @hint("Voice name for Gemini audio output")
  @showIf("haveAudioOutput", true)
  @widget(
    new ComboBoxWidget([
      new ComboBoxItem("Puck", "Puck"),
      new ComboBoxItem("Charon", "Charon"),
      new ComboBoxItem("Kore", "Kore"),
      new ComboBoxItem("Fenrir", "Fenrir"),
      new ComboBoxItem("Aoede", "Aoede"),
      new ComboBoxItem("Leda", "Leda"),
      new ComboBoxItem("Orus", "Orus"),
      new ComboBoxItem("Zephyr", "Zephyr")
    ])
  )
  private voice: string = "Puck"
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
  private videoController: VideoController = new VideoController(1500, CompressionQuality.HighQuality, EncodingType.Jpg)
  private GeminiLive: GeminiLiveWebsocket
  // Mic/audio/video handlers are wired to component-level events, so they must
  // only be added once even when a session is closed and reopened.
  private inputsWired: boolean = false

  public updateTextEvent: Event<{text: string; completed: boolean}> = new Event<{text: string; completed: boolean}>()

  public functionCallEvent: Event<{
    name: string
    args: any
    callId?: string
  }> = new Event<{
    name: string
    args: any
  }>()

  onAwake(): void {
    this.logger = new Logger("GeminiAssistant", this.enableLogging || this.enableLoggingLifecycle, true)
    if (this.enableLoggingLifecycle) this.logger.debug("LIFECYCLE: onAwake()")
  }

  createGeminiLiveSession(): void {
    PlaygroundLogger.log("Gemini Live: connecting...")
    this.websocketRequirementsObj.enabled = true
    this.dynamicAudioOutput.initialize(24000)
    this.microphoneRecorder.setSampleRate(16000)

    let internetStatus = global.deviceInfoSystem.isInternetAvailable() ? "Connecting to Gemini Live…" : "No internet"
    this.updateTextEvent.invoke({text: internetStatus, completed: true})

    global.deviceInfoSystem.onInternetStatusChanged.add((args) => {
      internetStatus = args.isInternetAvailable ? "Reconnected to internet" : "No internet"
      this.updateTextEvent.invoke({text: internetStatus, completed: true})
    })

    this.GeminiLive = Gemini.liveConnect()

    this.GeminiLive.onOpen.add((event) => {
      PlaygroundLogger.log("Gemini Live: connected — session setup sent")
      this.logger.info("Connection opened")
      this.sessionSetup()
    })

    let completedTextDisplay = true

    this.GeminiLive.onMessage.add((message) => {
      this.logger.debug("Received message: " + JSON.stringify(message))
      if (message.setupComplete) {
        message = message as GeminiTypes.Live.SetupCompleteEvent
        PlaygroundLogger.log("Gemini Live: setup complete — ready")
        this.updateTextEvent.invoke({text: "Ready — activate the orb and start talking", completed: true})
        this.logger.info("Setup complete")
        this.setupInputs()
      }

      if (message?.serverContent) {
        message = message as GeminiTypes.Live.ServerContentEvent
        if (message?.serverContent?.modelTurn?.parts?.[0]?.inlineData?.mimeType?.startsWith("audio/pcm")) {
          const b64Audio = message.serverContent.modelTurn.parts[0].inlineData.data
          const audio = Base64.decode(b64Audio)
          this.dynamicAudioOutput.addAudioFrame(audio)
        }
        if (message.serverContent.interrupted) {
          this.dynamicAudioOutput.interruptAudioOutput()
        } else if (message?.serverContent?.outputTranscription?.text) {
          if (completedTextDisplay) {
            this.updateTextEvent.invoke({
              text: message.serverContent.outputTranscription?.text,
              completed: true
            })
          } else {
            this.updateTextEvent.invoke({
              text: message.serverContent.outputTranscription?.text,
              completed: false
            })
          }
          completedTextDisplay = false
        } else if (message?.serverContent?.modelTurn?.parts?.[0]?.text) {
          if (completedTextDisplay) {
            this.updateTextEvent.invoke({
              text: message.serverContent.modelTurn.parts[0].text,
              completed: true
            })
          } else {
            this.updateTextEvent.invoke({
              text: message.serverContent.modelTurn.parts[0].text,
              completed: false
            })
          }
          completedTextDisplay = false
        } else if (message?.serverContent?.turnComplete) {
          PlaygroundLogger.log("Gemini: response complete")
          completedTextDisplay = true
        }
      }

      if (message.toolCall) {
        message = message as GeminiTypes.Live.ToolCallEvent
        this.logger.debug(JSON.stringify(message))
        message.toolCall.functionCalls.forEach((functionCall) => {
          PlaygroundLogger.log(`Gemini: function call → ${functionCall.name}`)
          this.functionCallEvent.invoke({
            name: functionCall.name,
            args: functionCall.args
          })
        })
      }
    })

    this.GeminiLive.onError.add((event) => {
      PlaygroundLogger.log(`Gemini error: ${event}`)
      this.updateTextEvent.invoke({text: "Couldn't connect to Gemini Live. Check the Remote Service Gateway token.", completed: true})
      this.logger.error("" + event)
    })

    this.GeminiLive.onClose.add((event) => {
      PlaygroundLogger.log(`Gemini Live: closed (${event.reason})`)
      const reason = (event.reason || "").replace(/[\s:]+$/, "")
      this.updateTextEvent.invoke({text: "Connection closed" + (reason ? ": " + reason : ""), completed: true})
      this.logger.info("Connection closed: " + event.reason)
    })
  }

  public streamData(stream: boolean): void {
    PlaygroundLogger.log(stream ? "Gemini: mic streaming started" : "Gemini: mic streaming stopped")
    if (stream) {
      if (this.haveVideoInput) {
        this.videoController.startRecording()
      }
      this.microphoneRecorder.startRecording()
    } else {
      if (this.haveVideoInput) {
        this.videoController.stopRecording()
      }
      this.microphoneRecorder.stopRecording()
    }
  }

  private setupInputs(): void {
    if (this.inputsWired) return
    this.inputsWired = true

    this.audioProcessor.onAudioChunkReady.add((encodedAudioChunk) => {
      const message = {
        realtime_input: {
          media_chunks: [
            {
              mime_type: "audio/pcm",
              data: encodedAudioChunk
            }
          ]
        }
      } as GeminiTypes.Live.RealtimeInput
      this.GeminiLive.send(message)
    })

    this.microphoneRecorder.onAudioFrame.add((audioFrame) => {
      this.audioProcessor.processFrame(audioFrame)
    })

    if (this.haveVideoInput) {
      this.videoController.onEncodedFrame.add((encodedFrame) => {
        const message = {
          realtime_input: {
            media_chunks: [
              {
                mime_type: "image/jpeg",
                data: encodedFrame
              }
            ]
          }
        } as GeminiTypes.Live.RealtimeInput
        this.GeminiLive.send(message)
      })
    }
  }

  public sendFunctionCallUpdate(functionName: string, args: string): void {
    const messageToSend = {
      tool_response: {
        function_responses: [
          {
            name: functionName,
            response: {content: args}
          }
        ]
      }
    } as GeminiTypes.Live.ToolResponse

    this.GeminiLive.send(messageToSend)
  }

  private sessionSetup(): void {
    let generationConfig = {
      responseModalities: ["AUDIO"],
      temperature: 1,
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: this.voice
          }
        }
      }
    } as GeminiTypes.Common.GenerationConfig

    if (!this.haveAudioOutput) {
      generationConfig = {
        responseModalities: ["TEXT"]
      }
    }

    const tools = [
      {
        function_declarations: [
          {
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
          }
        ]
      }
    ]

    const modelUri = `models/gemini-live-2.5-flash`
    const sessionSetupMessage = {
      setup: {
        model: modelUri,
        generation_config: generationConfig,
        system_instruction: {
          parts: [
            {
              text: this.instructions
            }
          ]
        },
        tools: tools,
        contextWindowCompression: {
          triggerTokens: 20000,
          slidingWindow: {targetTokens: 16000}
        },
        output_audio_transcription: {}
      }
    } as GeminiTypes.Live.Setup
    this.GeminiLive.send(sessionSetupMessage)
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
    if (this.haveVideoInput) {
      this.videoController.stopRecording()
    }
    if (this.GeminiLive && this.GeminiLive.isConnected()) {
      PlaygroundLogger.log("Gemini Live: closing session")
      this.GeminiLive.close()
    }
  }
}
