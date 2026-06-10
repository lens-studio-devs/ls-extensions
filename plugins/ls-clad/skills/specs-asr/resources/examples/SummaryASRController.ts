// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * Summary ASRController for the Agentic Playground Spectacles lens experience.
 */
import {RoundButton} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RoundButton"
import Event from "SpectaclesInteractionKit.lspkg/Utils/Event"
import {bindStartEvent, bindUpdateEvent} from "SnapDecorators.lspkg/decorators"
import {Logger} from "Utilities.lspkg/Scripts/Utils/Logger"
import {SummaryStorage} from "../Storage/SummaryStorage"

@component
export class SummaryASRController extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">SummaryASRController – Lecture capture via ASR</span><br/><span style="color: #94A3B8; font-size: 11px;">Records and stores lecture speech for summarization.</span>')
  @ui.separator

  @ui.label('<span style="color: #60A5FA;">References</span>')
  @input
  @hint("Reference to SummaryStorage component")
  private summaryStorage: SummaryStorage

  @input
  @hint("Mic button for starting/stopping recording sessions")
  private micButton: RoundButton

  @input
  @hint("SceneObject shown while recording is active (enabled on start, disabled on stop)")
  private listeningFeedbackObject: SceneObject

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Configuration</span>')
  @input
  @hint("Auto-start recording on awake (for continuous lecture capture)")
  private autoStartRecording: boolean = false

  @input
  @hint("Maximum session duration in seconds")
  private maxSessionDuration: number = 3600

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
  private sessionStartTime: number = 0
  private accumulatedText: string = ""
  private currentTranscription: string = ""

  public onTextAccumulated: Event<string> = new Event<string>()
  public onSessionStarted: Event<void> = new Event<void>()
  public onSessionEnded: Event<void> = new Event<void>()
  public onMaxDurationReached: Event<void> = new Event<void>()

  onAwake(): void {
    this.logger = new Logger("SummaryASRController", this.enableLogging || this.enableLoggingLifecycle, true)
    if (this.enableLoggingLifecycle) this.logger.debug("LIFECYCLE: onAwake()")
  }

  @bindStartEvent
  private initialize(): void {
    if (this.enableLoggingLifecycle) this.logger.debug("LIFECYCLE: onStart()")

    this.logger.info(`Initialize called - summaryStorage: ${!!this.summaryStorage}`)

    if (!this.summaryStorage) {
      this.logger.error("SummaryStorage not assigned")
      return
    }

    this.logger.info("SummaryStorage is assigned and ready")

    this.setupUI()

    if (this.autoStartRecording) {
      this.startRecordingSession()
    }

    this.logger.info("Initialized successfully")
  }

  @bindUpdateEvent
  private checkSessionDuration(): void {
    if (!this.isRecording) return

    const sessionDuration = (Date.now() - this.sessionStartTime) / 1000

    if (sessionDuration > this.maxSessionDuration) {
      this.logger.info(`Maximum session duration reached (${this.maxSessionDuration}s)`)
      this.onMaxDurationReached.invoke()
      this.stopRecordingSession()
    }
  }

  private setupUI(): void {
    this.setListeningFeedback(false)

    if (this.micButton) {
      this.micButton.initialize()
      this.micButton.onTriggerUp.add(() => {
        this.toggleRecordingSession()
      })
      this.logger.debug("Mic button configured")
    }
  }

  private setListeningFeedback(enabled: boolean): void {
    if (this.listeningFeedbackObject) {
      this.listeningFeedbackObject.enabled = enabled
    }
  }

  public toggleRecordingSession(): void {
    if (this.isRecording) {
      this.stopRecordingSession()
    } else {
      this.startRecordingSession()
    }
  }

  public startRecordingSession(): void {
    if (this.isRecording) {
      this.logger.debug("Already recording")
      return
    }

    this.isRecording = true
    this.sessionStartTime = Date.now()
    this.accumulatedText = ""
    this.currentTranscription = ""

    this.setListeningFeedback(true)
    this.asrModule.startTranscribing(this.createASROptions())

    this.onSessionStarted.invoke()
    this.logger.info("Recording session started")
  }

  public stopRecordingSession(): void {
    if (!this.isRecording) {
      this.logger.debug("Not currently recording")
      return
    }

    this.isRecording = false
    this.asrModule.stopTranscribing()
    this.setListeningFeedback(false)

    if (this.accumulatedText.trim().length > 0 && this.summaryStorage) {
      this.summaryStorage.storeText(this.accumulatedText)
      this.logger.info(`Final text stored: ${this.accumulatedText.length} characters`)
    }

    this.onSessionEnded.invoke()

    const sessionDuration = (Date.now() - this.sessionStartTime) / 1000
    this.logger.info(`Recording session ended after ${sessionDuration.toFixed(1)}s`)
  }

  private createASROptions(): any {
    const options = AsrModule.AsrTranscriptionOptions.create()
    options.mode = AsrModule.AsrMode.HighAccuracy
    options.silenceUntilTerminationMs = 3000

    options.onTranscriptionUpdateEvent.add((asrOutput) => {
      this.handleTranscriptionUpdate(asrOutput)
    })

    options.onTranscriptionErrorEvent.add((errorCode) => {
      this.handleTranscriptionError(errorCode)
    })

    return options
  }

  private handleTranscriptionUpdate(asrOutput: any): void {
    this.logger.debug(
      `handleTranscriptionUpdate - isFinal: ${asrOutput.isFinal}, text length: ${asrOutput.text ? asrOutput.text.length : 0}`
    )

    if (asrOutput.isFinal) {
      const newText = asrOutput.text.trim()

      this.logger.info(`FINAL transcription received: "${newText.substring(0, 50)}..."`)

      if (newText.length > 0) {
        if (this.accumulatedText.length > 0) {
          this.accumulatedText += " " + newText
        } else {
          this.accumulatedText = newText
        }

        if (this.summaryStorage) {
          this.logger.debug(`Calling summaryStorage.storeText with ${newText.length} chars`)
          this.summaryStorage.storeText(newText)
        } else {
          this.logger.warn("summaryStorage is null, cannot store text")
        }

        this.onTextAccumulated.invoke(this.accumulatedText)
        this.logger.info(`Text added: "${newText}" (Total: ${this.accumulatedText.length} chars)`)
      }

      this.currentTranscription = ""
    } else {
      this.currentTranscription = asrOutput.text

      if (this.currentTranscription.length > 10) {
        this.logger.debug(`Transcribing: "${this.currentTranscription.substring(0, 50)}..."`)
      }

      if (this.currentTranscription.length > 100 && this.summaryStorage) {
        if (!this.accumulatedText.includes(this.currentTranscription)) {
          this.logger.debug(`WORKAROUND - Storing partial transcription (${this.currentTranscription.length} chars)`)

          if (this.accumulatedText.length > 0) {
            this.accumulatedText += " " + this.currentTranscription
          } else {
            this.accumulatedText = this.currentTranscription
          }

          this.summaryStorage.storeText(this.currentTranscription)

          this.logger.debug(
            `Partial transcription stored. Total accumulated: ${this.accumulatedText.length} chars`
          )
        }
      }
    }
  }

  private handleTranscriptionError(errorCode: any): void {
    this.logger.error(`Transcription error: ${errorCode}`)

    this.setListeningFeedback(false)

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

    this.stopRecordingSession()
  }

  public getSessionStatus(): {
    isRecording: boolean
    duration: number
    textLength: number
    currentTranscription: string
  } {
    const duration = this.isRecording ? (Date.now() - this.sessionStartTime) / 1000 : 0

    return {
      isRecording: this.isRecording,
      duration: duration,
      textLength: this.accumulatedText.length,
      currentTranscription: this.currentTranscription
    }
  }

  public saveCurrentText(): void {
    if (this.accumulatedText.trim().length > 0 && this.summaryStorage) {
      this.summaryStorage.storeText(this.accumulatedText)
      this.logger.info(`Manually saved ${this.accumulatedText.length} characters`)
    }
  }

  public clearAccumulatedText(): void {
    this.accumulatedText = ""
    this.currentTranscription = ""
    this.logger.info("Accumulated text cleared")
  }

  public isUIReady(): boolean {
    return !!(this.micButton && this.listeningFeedbackObject)
  }
}
