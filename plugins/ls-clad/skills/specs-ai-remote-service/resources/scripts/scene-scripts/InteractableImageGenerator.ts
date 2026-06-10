// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * Interactable Image Generator component for the AI Playground Spectacles lens.
 */
import {ASRQueryController} from "./ASRQueryController"
import {ImageGenerator} from "./ImageGenerator"
import {bindStartEvent} from "SnapDecorators.lspkg/decorators"
import {Logger} from "Utilities.lspkg/Scripts/Utils/Logger"

@component
export class InteractableImageGenerator extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">InteractableImageGenerator – text-to-image generation</span><br/><span style="color: #94A3B8; font-size: 11px;">Generates images from ASR voice queries using OpenAI or Gemini image APIs.</span>')
  @ui.separator

  @input
  @hint("AI provider used for image generation")
  @widget(new ComboBoxWidget([new ComboBoxItem("OpenAI", "OpenAI"), new ComboBoxItem("Gemini", "Gemini")]))
  private modelProvider: string = "OpenAI"

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">UI References</span>')
  @input
  @hint("Image component where the generated texture will be displayed")
  private image: Image

  @input
  @hint("Text element showing the current generation status or prompt")
  private textDisplay: Text

  @input
  @hint("ASRQueryController that fires voice query events")
  private asrQueryController: ASRQueryController

  @input
  @hint("SceneObject shown as a loading spinner during generation")
  private spinner: SceneObject

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Logging</span>')
  @input
  @hint("Enable general logging")
  enableLogging: boolean = false

  @input
  @hint("Enable lifecycle logging (onAwake, onStart, onUpdate, onDestroy)")
  enableLoggingLifecycle: boolean = false

  private logger: Logger
  private imageGenerator: ImageGenerator = null

  onAwake(): void {
    this.logger = new Logger("InteractableImageGenerator", this.enableLogging || this.enableLoggingLifecycle, true)
    if (this.enableLoggingLifecycle) this.logger.debug("LIFECYCLE: onAwake()")
    this.imageGenerator = new ImageGenerator(this.modelProvider, this.logger)
    const imgMat = this.image.mainMaterial.clone()
    this.image.clearMaterials()
    this.image.mainMaterial = imgMat
  }

  @bindStartEvent
  private onStart(): void {
    if (this.enableLoggingLifecycle) this.logger.debug("LIFECYCLE: onStart()")
    this.spinner.enabled = false
    this.asrQueryController.onQueryEvent.add((query) => {
      this.createImage(query)
    })
  }

  createImage(prompt: string): void {
    this.spinner.enabled = true
    this.textDisplay.text = "Generating: " + prompt
    this.imageGenerator
      .generateImage(prompt)
      .then((image) => {
        this.logger.success("Image generated successfully: " + image)
        this.textDisplay.text = prompt
        this.image.mainMaterial.mainPass.baseTex = image
        this.textDisplay.text = prompt
        this.spinner.enabled = false
      })
      .catch((error) => {
        this.logger.error("Error generating image: " + error)
        this.textDisplay.text = "Error Generating Image"
        this.spinner.enabled = false
      })
  }
}
