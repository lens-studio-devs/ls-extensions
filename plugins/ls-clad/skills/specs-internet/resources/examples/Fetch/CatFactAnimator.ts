// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * Cat Fact Animator component for the Fetch Spectacles lens.
 */
import {LSTween} from "LSTween.lspkg/LSTween"
import Easing from "LSTween.lspkg/TweenJS/Easing"
import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {FetchCatFacts} from "./FetchCatFacts"
import { Logger } from "Utilities.lspkg/Scripts/Utils/Logger"

const TEXT_NO_INTERNET = "Purr... I can't share my secrets without internet!"
const TEXT_SLEEPING = "Zzz... I'm napping. Come back later for more purr-fect facts!"
const TEXT_ACTIVE = "Meow! I'm back and ready to share some pawsome facts!"

@component
export class CatFactAnimator extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">CatFactAnimator – Controls cat animations and UI</span><br/><span style="color: #94A3B8; font-size: 11px;">Manages the thought bubble, interaction handling, and animation state in response to fetch events.</span>')
  @ui.separator

  @ui.label('<span style="color: #60A5FA;">UI References</span>')
  @input
  @hint("Image component for the thought bubble")
  thoughtBubbleImage: Image

  @input
  @hint("Text component for the thought bubble")
  thoughtBubbleText: Text

  @input
  @hint("Image component for the interaction hint overlay")
  hintImage: Image

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Components</span>')
  @input
  @hint("Component that fetches cat facts from the remote API")
  fetchCatFacts: FetchCatFacts

  @input
  @hint("Interactable component attached to the cat")
  catInteractable: Interactable

  @input
  @hint("Animation player component for the cat")
  animationPlayer: AnimationPlayer

  @input("Component.ScriptComponent")
  @hint("State machine that drives the cat animation states")
  animationStateMachine: any

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Logging</span>')
  @input
  @hint("Enable general logging")
  enableLogging: boolean = false

  @input
  @hint("Enable lifecycle logging (onAwake, onStart, onUpdate, onDestroy)")
  enableLoggingLifecycle: boolean = false

  private hasBeenActivatedOnce = false
  private catIsActive = false
  private textBubbleIsShown = false
  private logger: Logger

  onAwake() {
    this.logger = new Logger("CatFactAnimator", this.enableLogging || this.enableLoggingLifecycle, true)
    if (this.enableLoggingLifecycle) this.logger.debug("LIFECYCLE: onAwake()")

    this.initializeThoughtBubble()

    this.createEvent("OnPauseEvent").bind(() => {
      if (this.catIsActive) {
        this.logger.debug("App paused — deactivating cat")
        this.dectivateCat()
        this.thoughtBubbleText.text = TEXT_SLEEPING
      }
    })

    this.createEvent("OnResumeEvent").bind(() => {
      if (this.hasBeenActivatedOnce) {
        this.logger.debug("App resumed — reactivating cat")
        this.activateCat(false)
        this.thoughtBubbleText.text = TEXT_ACTIVE
      }
    })

    global.deviceInfoSystem.onInternetStatusChanged.add((args) => {
      if (args.isInternetAvailable) {
        this.logger.info("Internet available")
        if (this.hasBeenActivatedOnce) {
          this.activateCat(false)
          this.thoughtBubbleText.text = TEXT_ACTIVE
        }
      } else {
        this.logger.warn("Internet unavailable — deactivating cat")
        this.dectivateCat()
        this.thoughtBubbleText.text = TEXT_NO_INTERNET
      }
    })

    this.catInteractable.onTriggerStart.add((args) => {
      if (global.deviceInfoSystem.isInternetAvailable()) {
        this.activateCat(true)
      } else {
        this.logger.warn("Interaction triggered but no internet available")
        this.animateShowingTextBubble()
        this.thoughtBubbleText.text = TEXT_NO_INTERNET
      }
    })

    this.fetchCatFacts.catFactReceived.add((args) => {
      this.thoughtBubbleText.text = args
    })
  }

  private activateCat(fetchFacts: boolean) {
    if (!this.catIsActive) {
      this.catIsActive = true
      this.hasBeenActivatedOnce = true
      this.logger.debug("Activating cat")
      this.animateShowingTextBubble()
      this.animationStateMachine.setTrigger("stand")
    }

    if (fetchFacts) {
      this.fetchCatFacts.getCatFacts()
    }
  }

  private animateShowingTextBubble() {
    if (this.textBubbleIsShown) return
    this.textBubbleIsShown = true

    LSTween.rawTween(1500)
      .onComplete(() => {
        LSTween.moveFromToLocal(
          this.thoughtBubbleImage.sceneObject.getTransform(),
          new vec3(2, 25, 0),
          new vec3(2, 31, 0),
          500
        )
          .easing(Easing.Cubic.Out)
          .start()

        LSTween.alphaTo(this.thoughtBubbleImage.mainMaterial, 1, 600).easing(Easing.Cubic.Out).start()
        LSTween.textAlphaTo(this.thoughtBubbleText, 1, 600).easing(Easing.Cubic.Out).start()
      })
      .start()

    LSTween.alphaTo(this.hintImage.mainMaterial, 0, 300).easing(Easing.Cubic.Out).start()
  }

  private dectivateCat() {
    this.catIsActive = false
    this.logger.debug("Deactivating cat")
    this.animationStateMachine.setTrigger("sleep")
  }

  private initializeThoughtBubble() {
    const imageColorNoAlpha = this.thoughtBubbleImage.mainPass.baseColor
    imageColorNoAlpha.a = 0
    this.thoughtBubbleImage.mainPass.baseColor = imageColorNoAlpha

    const textColorNoAlpha = this.thoughtBubbleText.textFill.color
    textColorNoAlpha.a = 0
    this.thoughtBubbleText.textFill.color = textColorNoAlpha
  }
}
