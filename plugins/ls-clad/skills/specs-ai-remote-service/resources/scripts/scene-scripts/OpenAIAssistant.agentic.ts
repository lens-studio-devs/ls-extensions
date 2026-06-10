// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * Open AIAssistant component for the Agentic Playground Spectacles lens.
 */
import {OpenAI, OpenAIRealtimeWebsocket} from "RemoteServiceGateway.lspkg/HostedExternal/OpenAI"

import {AudioProcessor} from "RemoteServiceGateway.lspkg/Helpers/AudioProcessor"
import {DynamicAudioOutput} from "RemoteServiceGateway.lspkg/Helpers/DynamicAudioOutput"
import {MicrophoneRecorder} from "RemoteServiceGateway.lspkg/Helpers/MicrophoneRecorder"
import {OpenAITypes} from "RemoteServiceGateway.lspkg/HostedExternal/OpenAITypes"
import Event from "SpectaclesInteractionKit.lspkg/Utils/Event"
import {bindStartEvent} from "SnapDecorators.lspkg/decorators"
import {Logger} from "Utilities.lspkg/Scripts/Utils/Logger"

@component
export class OpenAIAssistant extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">OpenAIAssistant</span>')
  @ui.label("Example of connecting to the OpenAI Realtime API. Change various settings in the inspector to customize!")
  @ui.separator

  @ui.label('<span style="color: #60A5FA;">Setup</span>')
  @input
  @hint("SceneObject holding WebSocket requirements for OpenAI Realtime")
  private websocketRequirementsObj: SceneObject

  @input
  @hint("Dynamic audio output component for OpenAI voice responses")
  private dynamicAudioOutput: DynamicAudioOutput

  @input
  @hint("Microphone recorder component for capturing user voice input")
  private microphoneRecorder: MicrophoneRecorder

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">System Prompt</span>')
  private readonly instructions: string =
    `You are an educational AI tutor designed to help students learn and understand complex topics.

Your primary goals are to:
- Provide clear, accurate explanations of educational concepts
- Break down complex topics into digestible parts
- Use examples  and analogies to enhance understanding
- Ask clarifying questions to gauge comprehension
- Encourage critical thinking and curiosity
- Adapt your teaching style to the student's level

CRITICAL RESPONSE LENGTH REQUIREMENT:
- Your responses MUST be limited to exactly 300 characters or fewer
- This is a HARD LIMIT that cannot be exceeded under any circumstances
- Count characters carefully and stop exactly at 300 characters
- Be concise while maintaining educational value
- If a topic needs more explanation, invite follow-up questions
- Prioritize the most important information within the character limit

Always maintain an encouraging, patient, and supportive tone. Focus on helping students build knowledge and confidence in their learning journey within the strict 300-character limit.`

  @ui.separator
  @ui.label('<span style="color: yellow;">To prevent audio feedback loop in Lens Studio Editor, use headphones or manage your microphone input.</span>')
  @ui.label('<span style="color: #60A5FA;">Outputs</span>')
  @input
  @hint("Enable audio output for OpenAI voice responses")
  private haveAudioOutput: boolean = true

  @input
  @hint("Voice model to use for audio output")
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

  createOpenAIRealtimeSession() {
    this.websocketRequirementsObj.enabled = true
    // Display internet connection status
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
      // DEBUG: Log all message types to see what OpenAI sends for programmatic text
      if (message.type !== "response.audio.delta") {
        // Skip audio delta spam
        this.logger.info(`OpenAIAssistant: 🔍 DEBUG - Received message type: ${message.type}`)
        if (message.delta) {
          this.logger.info(`OpenAIAssistant: 🔍 DEBUG - Message delta: "${message.delta}"`)
        }
      }

      // Listen for text responses
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
      }
      // Handle response.output_item.added for programmatic text responses
      else if (message.type === "response.output_item.added") {
        this.logger.info(`OpenAIAssistant: 🔍 DEBUG - output_item.added: ${JSON.stringify(message.item)}`)
        if (message.item && message.item.type === "message" && message.item.content) {
          // Extract text from message content
          for (const content of message.item.content) {
            if (content.type === "text" && content.text) {
              this.logger.info(`OpenAIAssistant: 🔍 Found text in output_item.added: "${content.text}"`)
              this.updateTextEvent.invoke({
                text: content.text,
                completed: false
              })
              completedTextDisplay = false
            }
          }
        }
      }
      // Handle response.output_item.done for final text responses
      else if (message.type === "response.output_item.done") {
        this.logger.info(`OpenAIAssistant: 🔍 DEBUG - output_item.done: ${JSON.stringify(message.item)}`)
        if (message.item && message.item.type === "message" && message.item.content) {
          // Extract text from message content
          for (const content of message.item.content) {
            if (content.type === "text" && content.text) {
              this.logger.info(`OpenAIAssistant: 🔍 Found text in output_item.done: "${content.text}"`)
              this.updateTextEvent.invoke({
                text: content.text,
                completed: true
              })
              completedTextDisplay = true
            }
          }
        }
        // Also check for function calls
        else if (message.item && message.item.type === "function_call") {
          const functionCall = message.item
          this.logger.info(`Function called: ${functionCall.name}`)
          this.logger.info(`Function args: ${functionCall.arguments}`)

          const args = JSON.parse(functionCall.arguments)
          this.functionCallEvent.invoke({
            name: functionCall.name,
            args: args,
            callId: functionCall.call_id // OpenAI requires a call_id
          })
        }
      } else if (message.type === "response.done") {
        this.logger.info(`OpenAIAssistant: 🔍 DEBUG - response.done received`)
        completedTextDisplay = true
      }

      // Set up Audio Playback
      else if (message.type === "response.audio.delta") {
        const delta = Base64.decode(message.delta)
        this.dynamicAudioOutput.addAudioFrame(delta)
      }
      // Listen for user began speaking
      else if (message.type === "input_audio_buffer.speech_started") {
        this.logger.info("Speech started, interrupting the AI")
        this.dynamicAudioOutput.interruptAudioOutput()
      }
    })

    this.OAIRealtime.onError.add((event) => {
      this.logger.info("Error: " + event)
    })

    this.OAIRealtime.onClose.add((event) => {
      this.logger.info("Connection closed: " + event.reason)
      this.updateTextEvent.invoke({
        text: "Websocket closed: " + event.reason,
        completed: true
      })
    })
  }

  public streamData(stream: boolean) {
    // Check if we're in orchestrated mode - if so, don't handle voice input directly
    // The orchestrator will handle voice input and call us for AI processing only
    this.logger.info(`OpenAIAssistant: streamData called with stream=${stream}`)

    // Don't start/stop recording if we're being controlled by an orchestrator
    // This prevents competing voice input systems
    if (stream) {
      this.logger.info("OpenAIAssistant: 🔒 Voice input disabled - orchestrated system should handle voice input")
      // this.microphoneRecorder.startRecording(); // Commented out to prevent conflicts
    } else {
      this.logger.info("OpenAIAssistant: 🔒 Voice input disabled - orchestrated system should handle voice input")
      // this.microphoneRecorder.stopRecording(); // Commented out to prevent conflicts
    }
  }

  public interruptAudioOutput(): void {
    if (this.dynamicAudioOutput && this.haveAudioOutput) {
      this.dynamicAudioOutput.interruptAudioOutput()
    } else {
      this.logger.info("DynamicAudioOutput is not initialized.")
    }
  }

  private sessionSetup() {
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

    // Set up the session
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

    // Process microphone input to send to the server
    this.audioProcessor.onAudioChunkReady.add((encodedAudioChunk) => {
      const audioMsg = {
        type: "input_audio_buffer.append",
        audio: encodedAudioChunk
      } as OpenAITypes.Realtime.ClientMessage
      this.OAIRealtime.send(audioMsg)
    })

    // Configure the microphone
    this.microphoneRecorder.onAudioFrame.add((audioFrame) => {
      this.audioProcessor.processFrame(audioFrame)
    })
  }

  public sendFunctionCallUpdate(functionName: string, callId: string, response: string): void {
    this.logger.info("Call id = " + callId)
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

  /**
   * Send message to OpenAI session with audio output enabled
   * This will generate both text and audio responses
   */
  public sendMessageWithAudio(content: string): void {
    if (!this.OAIRealtime) {
      this.logger.info("OpenAIAssistant: Realtime session not initialized")
      return
    }

    this.logger.info(`OpenAIAssistant: Sending message with audio: "${content.substring(0, 100)}..."`)

    // Send user message to conversation
    const userMessageToSend = {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: content
          }
        ]
      }
    } as OpenAITypes.Realtime.ConversationItemCreateRequest

    this.OAIRealtime.send(userMessageToSend)

    // Request AI response with audio
    const modalitiesArray = ["text"]
    if (this.haveAudioOutput) {
      modalitiesArray.push("audio")
    }

    const responseRequest = {
      type: "response.create",
      response: {
        modalities: modalitiesArray, // Include audio if available
        instructions: this.instructions
      }
    } as OpenAITypes.Realtime.ResponseCreateRequest

    this.OAIRealtime.send(responseRequest)

    this.logger.info(`OpenAIAssistant: Message sent with modalities: ${modalitiesArray.join(", ")}`)
  }

  /**
   * Send text message directly to OpenAI session for text-only generation
   * This bypasses voice streaming and sends conversation messages directly
   */
  public sendTextMessage(content: string): void {
    if (!this.OAIRealtime) {
      this.logger.info("OpenAIAssistant: Realtime session not initialized")
      return
    }

    this.logger.info(`OpenAIAssistant: 📝 Sending text message: "${content.substring(0, 100)}..."`)

    // Send user message to conversation
    const userMessageToSend = {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: content
          }
        ]
      }
    } as OpenAITypes.Realtime.ConversationItemCreateRequest

    this.OAIRealtime.send(userMessageToSend)

    // Request AI response
    const responseRequest = {
      type: "response.create",
      response: {
        modalities: ["text"], // Text only, no audio
        instructions: this.instructions
      }
    } as OpenAITypes.Realtime.ResponseCreateRequest

    this.OAIRealtime.send(responseRequest)

    this.logger.info("OpenAIAssistant: Text message sent, waiting for AI response")
  }
}
