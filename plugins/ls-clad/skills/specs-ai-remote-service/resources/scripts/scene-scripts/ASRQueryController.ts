// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * ASRQuery Controller for the AI Playground Spectacles lens experience.
 */
import animate from "SpectaclesInteractionKit.lspkg/Utils/animate"
import Event from "SpectaclesInteractionKit.lspkg/Utils/Event"
import {BaseButton} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton"
import {bindStartEvent} from "SnapDecorators.lspkg/decorators"
import {Logger} from "Utilities.lspkg/Scripts/Utils/Logger"

@component
export class ASRQueryController extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">ASRQueryController – voice query button</span><br/><span style="color: #94A3B8; font-size: 11px;">Listens for a single voice query via ASR and fires an event with the transcribed text.</span>')
  @ui.separator

  @input
  @hint("Button that the user pinches to start and stop voice recording")
  private button: BaseButton

  @input
  @hint("RenderMeshVisual used to indicate active recording state")
  private activityRenderMesh: RenderMeshVisual

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Logging</span>')
  @input
  @hint("Enable general logging")
  enableLogging: boolean = false

  @input
  @hint("Enable lifecycle logging (onAwake, onStart, onUpdate, onDestroy)")
  enableLoggingLifecycle: boolean = false

  private logger: Logger
  private activityMaterial: Material
  private asrModule: AsrModule = require("LensStudio:AsrModule")
  private isRecording: boolean = false

  public onQueryEvent: Event<string> = new Event<string>()

  onAwake(): void {
    this.logger = new Logger("ASRQueryController", this.enableLogging || this.enableLoggingLifecycle, true)
    if (this.enableLoggingLifecycle) this.logger.debug("LIFECYCLE: onAwake()")
  }

  @bindStartEvent
  private init(): void {
    if (this.enableLoggingLifecycle) this.logger.debug("LIFECYCLE: onStart()")
    this.activityMaterial = this.activityRenderMesh.mainMaterial.clone()
    this.activityRenderMesh.clearMaterials()
    this.activityRenderMesh.mainMaterial = this.activityMaterial
    this.activityMaterial.mainPass.in_out = 0
    this.button.initialize()
    this.button.onTriggerUp.add(() => {
      this.getVoiceQuery().then((query) => {
        this.onQueryEvent.invoke(query)
      })
    })
  }

  public getVoiceQuery(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.isRecording) {
        this.animateVoiceIndicator(false)
        this.asrModule.stopTranscribing()
        this.isRecording = false
        reject("Already recording, cancel recording")
        return
      }
      this.isRecording = true
      const asrSettings = AsrModule.AsrTranscriptionOptions.create()
      asrSettings.mode = AsrModule.AsrMode.HighAccuracy
      asrSettings.silenceUntilTerminationMs = 1500
      asrSettings.onTranscriptionUpdateEvent.add((asrOutput) => {
        if (asrOutput.isFinal) {
          this.isRecording = false
          this.animateVoiceIndicator(false)
          this.asrModule.stopTranscribing()
          resolve(asrOutput.text)
        }
      })
      asrSettings.onTranscriptionErrorEvent.add((asrOutput) => {
        this.isRecording = false
        this.animateVoiceIndicator(false)
        reject(asrOutput)
      })
      this.animateVoiceIndicator(true)
      this.asrModule.startTranscribing(asrSettings)
    })
  }

  private animateVoiceIndicator(on: boolean): void {
    if (on) {
      animate({
        duration: 0.5,
        easing: "linear",
        update: (t) => {
          this.activityMaterial.mainPass.in_out = t
        }
      })
    } else {
      animate({
        duration: 0.5,
        easing: "linear",
        update: (t) => {
          this.activityMaterial.mainPass.in_out = 1 - t
        }
      })
    }
  }
}
