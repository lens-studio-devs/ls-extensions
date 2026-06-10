// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * Interactable Image Generator component for the AI Playground Spectacles lens.
 */
import {ASRQueryController} from "./ASRQueryController"
import {Snap3DInteractableFactory} from "./Snap3DInteractableFactory"
import {bindStartEvent} from "SnapDecorators.lspkg/decorators"
import {Logger} from "Utilities.lspkg/Scripts/Utils/Logger"

@component
export class InteractableImageGenerator extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">InteractableSnap3DGenerator – voice-driven 3D generation</span><br/><span style="color: #94A3B8; font-size: 11px;">Connects ASR voice queries to the Snap3D factory to generate 3D objects in the scene.</span>')
  @ui.separator

  @input
  @hint("Snap3DInteractableFactory used to create 3D objects from text prompts")
  snap3DFactory: Snap3DInteractableFactory

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">References</span>')
  @input
  @hint("ASRQueryController that fires voice query events")
  private asrQueryController: ASRQueryController

  @input
  @hint("SceneObject whose world position is used as the spawn target for generated objects")
  private targetPosition: SceneObject

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Logging</span>')
  @input
  @hint("Enable general logging")
  enableLogging: boolean = false

  @input
  @hint("Enable lifecycle logging (onAwake, onStart, onUpdate, onDestroy)")
  enableLoggingLifecycle: boolean = false

  private logger: Logger

  onAwake(): void {
    this.logger = new Logger("InteractableSnap3DGenerator", this.enableLogging || this.enableLoggingLifecycle, true)
    if (this.enableLoggingLifecycle) this.logger.debug("LIFECYCLE: onAwake()")
  }

  @bindStartEvent
  private onStart(): void {
    if (this.enableLoggingLifecycle) this.logger.debug("LIFECYCLE: onStart()")
    this.asrQueryController.onQueryEvent.add((query) => {
      this.snap3DFactory.createInteractable3DObject(query, this.targetPosition.getTransform().getWorldPosition())
    })
  }
}
