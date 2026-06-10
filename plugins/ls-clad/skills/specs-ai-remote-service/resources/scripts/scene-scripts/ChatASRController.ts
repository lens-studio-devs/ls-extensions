// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * Chat ASRController for the Agentic Playground Spectacles lens experience.
 */
import {RoundButton} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RoundButton"
import Event from "SpectaclesInteractionKit.lspkg/Utils/Event"
import {bindStartEvent, bindUpdateEvent} from "SnapDecorators.lspkg/decorators"
import {Logger} from "Utilities.lspkg/Scripts/Utils/Logger"
import {AgentOrchestrator} from "../Agents/AgentOrchestrator"
import {ChatStorage} from "../Storage/ChatStorage"

@component
export class ChatASRController extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">ChatASRController – Voice input for agentic chat flow</span><br/><span style="color: #94A3B8; font-size: 11px;">Connects voice input to AgentOrchestrator via ASR.</span>')
  @ui.separator

  @ui.label('<span style="color: #60A5FA;">References</span>')
  @input
  @hint("Reference to AgentOrchestrator component")
  private agentOrchestrator: AgentOrchestrator

  @input
  @hint("Reference to ChatStorage component for storing conversation history")
  private chatStorage: ChatStorage

  @input
  @hint("Mic button for starting/stopping chat sessions")
  private micButton: RoundButton

  @input
  @hint("SceneObject shown while recording is active (enabled on start, disabled on stop)")
  private listeningFeedbackObject: SceneObject

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Configuration</span>')
  @input
  @hint("Auto-timeout for chat sessions in seconds")
  private sessionTimeout: number = 300

  @input
  @hint("Enable continuous listening mode")
  private continuousListening: boolean = false

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Logging</span>')
  @input
  @hint("Enable general logging")
  enableLogging: boolean = false

  @input
  @hint("Enable lifecycle logging (onAwake, onStart, onUpdate, onDestroy)")
  enableLoggingLifecycle: boolean = false

  private logger: Logger

  private asrModule: AsrModule = require("LensStudio:AsrModule")
  private isRecording: boolean = false
  private isProcessingQuery: boolean = false
  private lastActivityTime: number = 0
  private sessionActive: boolean = false

  private pendingResolve: ((value: string) => void) | null = null
  private pendingReject: ((reason?: any) => void) | null = null

  public onQueryReceived: Event<string> = new Event<string>()
  public onQueryProcessed: Event<{query: string; response: string}> = new Event()
  public onSessionStarted: Event<void> = new Event<void>()
  public onSessionEnded: Event<void> = new Event<void>()
  public onSessionTimeout: Event<void> = new Event<void>()

  onAwake(): void {
    this.logger = new Logger("ChatASRController", this.enableLogging || this.enableLoggingLifecycle, true)
    if (this.enableLoggingLifecycle) this.logger.debug("LIFECYCLE: onAwake()")
  }

  @bindStartEvent
  private initialize(): void {
    if (this.enableLoggingLifecycle) this.logger.debug("LIFECYCLE: onStart()")

    if (!this.agentOrchestrator) {
      this.logger.error("AgentOrchestrator not assigned")
      return
    }

    if (!this.chatStorage) {
      this.logger.error("ChatStorage not assigned")
      return
    }

    this.setupUI()

    if (this.continuousListening) {
      this.startChatSession()
    }

    this.logger.info("Initialized and connected to AgentOrchestrator + ChatStorage")
  }

  @bindUpdateEvent
  private update(): void {
    this.checkSessionTimeout()
  }

  private setupUI(): void {
    this.setListeningFeedback(false)

    if (this.micButton) {
      this.micButton.initialize()
      this.micButton.onTriggerUp.add(() => {
        this.handleMicButtonPress()
      })
      this.logger.debug("Mic button configured")
    }
  }

  private setListeningFeedback(enabled: boolean): void {
    if (this.listeningFeedbackObject) {
      this.listeningFeedbackObject.enabled = enabled
    }
  }

  private async handleMicButtonPress(): Promise<void> {
    // Second press while recording → stop and cancel
    if (this.isRecording) {
      this.logger.info("Mic button pressed while recording – stopping")
      this.stopListening()
      return
    }

    if (this.isProcessingQuery) {
      this.logger.debug("Already processing a query")
      return
    }

    if (!this.sessionActive) {
      this.startChatSession()
    }

    try {
      const response = await this.processVoiceQuery()
      this.logger.info(`Voice interaction completed: "${response.substring(0, 50)}..."`)
    } catch (error) {
      this.logger.error(`Voice interaction failed: ${error}`)
    }
  }

  public startChatSession(): void {
    if (this.sessionActive) {
      this.logger.debug("Chat session already active")
      return
    }

    this.sessionActive = true
    this.lastActivityTime = Date.now()

    if (this.chatStorage) {
      this.chatStorage.startNewSession(`Chat Session ${Date.now()}`)
    }

    this.onSessionStarted.invoke()
    this.logger.info("Chat session started")
  }

  public endChatSession(): void {
    if (!this.sessionActive) {
      return
    }

    this.sessionActive = false

    if (this.isRecording) {
      this.stopListening()
    }

    if (this.chatStorage) {
      this.chatStorage.endCurrentSession()
    }

    this.onSessionEnded.invoke()

    const duration = (Date.now() - this.lastActivityTime) / 1000
    this.logger.info(`Chat session ended after ${duration.toFixed(1)}s`)
  }

  public startListening(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.isRecording) {
        reject("Already recording")
        return
      }

      this.pendingResolve = resolve
      this.pendingReject = reject

      try {
        this.asrModule.stopTranscribing()
      } catch (error) {
        // Ignore errors from stopping a non-active session
      }

      if (!this.sessionActive) {
        this.startChatSession()
      }

      this.isRecording = true
      this.lastActivityTime = Date.now()

      this.setListeningFeedback(true)

      const asrOptions = this.createASROptions(resolve, reject)
      this.asrModule.startTranscribing(asrOptions)

      this.logger.info("Started listening for voice input")
    })
  }

  public stopListening(): void {
    if (!this.isRecording) {
      return
    }

    this.isRecording = false
    this.asrModule.stopTranscribing()
    this.setListeningFeedback(false)

    if (this.pendingReject) {
      this.pendingReject("Recording stopped manually")
      this.pendingResolve = null
      this.pendingReject = null
    }

    this.logger.info("Stopped listening")
  }

  public async processVoiceQuery(): Promise<string> {
    if (this.isProcessingQuery) {
      return "I'm still processing your previous question. Please wait..."
    }

    try {
      const query = await this.startListening()
      return await this.sendQueryToOrchestrator(query)
    } catch (error) {
      this.logger.error(`Voice query failed: ${error}`)
      return "I couldn't understand that. Could you try again?"
    }
  }

  private async sendQueryToOrchestrator(query: string): Promise<string> {
    if (!query || query.trim().length === 0) {
      return "I didn't catch that. Could you repeat your question?"
    }

    this.isProcessingQuery = true
    this.onQueryReceived.invoke(query)

    try {
      this.logger.info(`Routing query to AgentOrchestrator: "${query}"`)

      const response = await this.agentOrchestrator.processUserQuery(query)

      this.onQueryProcessed.invoke({query, response})

      this.logger.info(`Orchestrator response: "${response.substring(0, 100)}..."`)

      return response
    } catch (error) {
      const errorMessage = `Sorry, I encountered an error: ${error}`
      this.logger.error(`Orchestrator error: ${error}`)
      return errorMessage
    } finally {
      this.isProcessingQuery = false
      this.lastActivityTime = Date.now()
    }
  }

  private createASROptions(resolve: (value: string) => void, reject: (reason?: any) => void): any {
    const options = AsrModule.AsrTranscriptionOptions.create()
    options.mode = AsrModule.AsrMode.HighAccuracy
    options.silenceUntilTerminationMs = 2000

    options.onTranscriptionUpdateEvent.add((asrOutput) => {
      if (asrOutput.isFinal) {
        this.isRecording = false
        this.pendingResolve = null
        this.pendingReject = null
        this.setListeningFeedback(false)

        const query = asrOutput.text.trim()

        if (query.length > 0) {
          resolve(query)
        } else {
          reject("Empty transcription")
        }
      } else {
        if (asrOutput.text.length > 5) {
          this.logger.debug(`Transcribing: "${asrOutput.text.substring(0, 30)}..."`)
        }
      }
    })

    options.onTranscriptionErrorEvent.add((errorCode) => {
      this.isRecording = false
      this.pendingResolve = null
      this.pendingReject = null
      this.setListeningFeedback(false)
      this.handleTranscriptionError(errorCode)
      reject(`Transcription error: ${errorCode}`)
    })

    return options
  }

  private handleTranscriptionError(errorCode: any): void {
    this.logger.error(`Transcription error: ${errorCode}`)

    switch (errorCode) {
      case AsrModule.AsrStatusCode.InternalError:
        this.logger.error("Internal ASR error")
        break
      case AsrModule.AsrStatusCode.Unauthenticated:
        this.logger.error("ASR authentication failed")
        break
      case AsrModule.AsrStatusCode.NoInternet:
        this.logger.warn("No internet connection")
        break
      default:
        this.logger.warn(`Unknown error code: ${errorCode}`)
    }
  }

  private checkSessionTimeout(): void {
    if (!this.sessionActive) return

    const timeSinceActivity = (Date.now() - this.lastActivityTime) / 1000

    if (timeSinceActivity > this.sessionTimeout) {
      this.logger.info(`Session timeout after ${this.sessionTimeout}s of inactivity`)
      this.onSessionTimeout.invoke()
      this.endChatSession()
    }
  }

  public extendSession(): void {
    if (this.sessionActive) {
      this.lastActivityTime = Date.now()
      this.logger.debug("Session activity extended")
    }
  }

  public getSessionStatus(): {
    active: boolean
    isRecording: boolean
    isProcessing: boolean
    timeSinceActivity: number
  } {
    const timeSinceActivity = this.sessionActive ? (Date.now() - this.lastActivityTime) / 1000 : 0

    return {
      active: this.sessionActive,
      isRecording: this.isRecording,
      isProcessing: this.isProcessingQuery,
      timeSinceActivity: timeSinceActivity
    }
  }

  public isReady(): boolean {
    return this.agentOrchestrator && this.agentOrchestrator.isSystemReady() && !this.isProcessingQuery
  }

  public isUIReady(): boolean {
    return !!(this.micButton && this.listeningFeedbackObject)
  }

  public getStorageStatus(): {
    hasStorage: boolean
    currentSession: any
    totalMessages: number
  } {
    const storageStats = this.chatStorage?.getStorageStats()

    return {
      hasStorage: !!this.chatStorage,
      currentSession: this.chatStorage?.getCurrentSession(),
      totalMessages: storageStats?.totalStoredMessages || 0
    }
  }
}
