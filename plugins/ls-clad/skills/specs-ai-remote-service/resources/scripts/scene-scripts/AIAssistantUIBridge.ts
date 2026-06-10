// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * AIAssistant UIBridge component for the AI Playground Spectacles lens.
 */
import {GeminiAssistant} from "./GeminiAssistant"
import {OpenAIAssistant} from "./OpenAIAssistant"
import {Snap3DInteractableFactory} from "./Snap3DInteractableFactory"
import {SphereController} from "./SphereController"
import animate from "SpectaclesInteractionKit.lspkg/Utils/animate"
import {BaseButton} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton"
import {bindStartEvent} from "SnapDecorators.lspkg/decorators"
import {Logger} from "Utilities.lspkg/Scripts/Utils/Logger"
import {MathUtils} from "Utilities.lspkg/Scripts/Utils/MathUtils"

enum AssistantType {
  Gemini = "Gemini",
  OpenAI = "OpenAI"
}

@component
export class AIAssistantUIBridge extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">AIAssistantUIBridge – AI assistant to UI bridge</span><br/><span style="color: #94A3B8; font-size: 11px;">Connects AI assistants (Gemini Live, OpenAI Realtime) to the Sphere Controller UI.</span>')
  @ui.separator

  @ui.label('<span style="color: #60A5FA;">Assistants</span>')
  @ui.group_start("Assistants")
  @input
  @hint("GeminiAssistant component for Gemini Live interactions")
  private geminiAssistant: GeminiAssistant

  @input
  @hint("OpenAIAssistant component for OpenAI Realtime interactions")
  private openAIAssistant: OpenAIAssistant
  @ui.group_end

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">UI Elements</span>')
  @ui.group_start("UI Elements")
  @input
  @hint("SphereController managing the orb UI and hand tracking")
  private sphereController: SphereController

  @input
  @hint("Factory for creating interactable Snap3D scene objects")
  private snap3DInteractableFactory: Snap3DInteractableFactory

  @input
  @hint("Text element displaying the hint title")
  private hintTitle: Text

  @input
  @hint("Text element displaying hint instructions to the user")
  private hintText: Text

  @input
  @hint("Button that activates the Gemini assistant")
  private geminiButton: BaseButton

  @input
  @hint("Button that activates the OpenAI assistant")
  private openAIButton: BaseButton
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
  private assistantType: string = AssistantType.Gemini
  private textIsVisible: boolean = true
  private currentAssistant: GeminiAssistant | OpenAIAssistant

  onAwake(): void {
    this.logger = new Logger("AIAssistantUIBridge", this.enableLogging || this.enableLoggingLifecycle, true)
    if (this.enableLoggingLifecycle) this.logger.debug("LIFECYCLE: onAwake()")
  }

  @bindStartEvent
  private onStart(): void {
    if (this.enableLoggingLifecycle) this.logger.debug("LIFECYCLE: onStart()")
    this.geminiButton.initialize()
    this.geminiButton.onTriggerUp.add(() => {
      this.assistantType = AssistantType.Gemini
      this.hintTitle.text = "Gemini Live Example"
      this.startWebsocketAndUI()
    })

    this.openAIButton.initialize()
    this.openAIButton.onTriggerUp.add(() => {
      this.assistantType = AssistantType.OpenAI
      this.hintTitle.text = "OpenAI Realtime Example"
      this.startWebsocketAndUI()
    })
  }

  private hideButtons(): void {
    this.geminiButton.enabled = false
    this.openAIButton.enabled = false
    {
      const tr = this.geminiButton.sceneObject.getTransform()
      const start = tr.getLocalScale()
      const end = vec3.zero()
      const duration = 0.5
      animate({
        duration,
        easing: "ease-out-quad",
        update: (t) => {
          tr.setLocalScale(new vec3(
            MathUtils.lerp(start.x, end.x, t),
            MathUtils.lerp(start.y, end.y, t),
            MathUtils.lerp(start.z, end.z, t)
          ))
        },
        ended: () => {
          this.geminiButton.sceneObject.enabled = false
        }
      })
    }

    {
      const tr = this.openAIButton.sceneObject.getTransform()
      const start = tr.getLocalScale()
      const end = vec3.zero()
      const duration = 0.5
      animate({
        duration,
        easing: "ease-out-quad",
        update: (t) => {
          tr.setLocalScale(new vec3(
            MathUtils.lerp(start.x, end.x, t),
            MathUtils.lerp(start.y, end.y, t),
            MathUtils.lerp(start.z, end.z, t)
          ))
        },
        ended: () => {
          this.openAIButton.sceneObject.enabled = false
        }
      })
    }
  }

  private startWebsocketAndUI(): void {
    this.hideButtons()
    this.hintText.text = "Pinch on the orb next to your left hand to activate"
    if (global.deviceInfoSystem.isEditor()) {
      this.hintText.text = "Look down and click on the orb to activate"
    }
    this.sphereController.initializeUI()
    this.currentAssistant = this.assistantType === AssistantType.Gemini ? this.geminiAssistant : this.openAIAssistant

    if (this.assistantType === AssistantType.Gemini) {
      this.geminiAssistant.createGeminiLiveSession()
    } else if (this.assistantType === AssistantType.OpenAI) {
      this.openAIAssistant.createOpenAIRealtimeSession()
    }

    this.connectAssistantEvents()

    this.sphereController.isActivatedEvent.add((isActivated) => {
      this.currentAssistant.streamData(isActivated)
      if (!isActivated) {
        this.currentAssistant.interruptAudioOutput()
      }
    })
  }

  private connectAssistantEvents(): void {
    this.currentAssistant.updateTextEvent.add((data) => {
      this.sphereController.setText(data)
    })

    this.currentAssistant.functionCallEvent.add((data) => {
      if (data.name === "Snap3D") {
        if (this.assistantType === AssistantType.Gemini) {
          this.geminiAssistant.sendFunctionCallUpdate(data.name, "Beginning to create 3D object...")
        } else {
          this.openAIAssistant.sendFunctionCallUpdate(
            data.name,
            data.callId,
            "Beginning to create 3D object..."
          )
        }

        this.snap3DInteractableFactory
          .createInteractable3DObject(data.args.prompt)
          .then((status) => {
            if (this.assistantType === AssistantType.Gemini) {
              this.geminiAssistant.sendFunctionCallUpdate(data.name, status)
            } else {
              this.openAIAssistant.sendFunctionCallUpdate(data.name, data.callId, status)
            }
          })
          .catch((error) => {
            if (this.assistantType === AssistantType.Gemini) {
              this.geminiAssistant.sendFunctionCallUpdate(data.name, error)
            } else {
              this.openAIAssistant.sendFunctionCallUpdate(data.name, data.callId, error)
            }
          })
      }
    })
  }
}
