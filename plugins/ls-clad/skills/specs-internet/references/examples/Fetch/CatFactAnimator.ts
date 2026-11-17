// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * SPECS Inc. 2027
 * Cat Fact Animator component for the Fetch Glasses lens.
 */
import animate from "InteractionKit.lspkg/Utils/animate"
import {Interactable} from "InteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
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

    // LSTween was removed; this uses the native InteractionKit
    // `animate` utility. Durations are in seconds (LSTween used milliseconds).
    // Wait 1.5s, then slide the bubble up and fade in the bubble + text.
    animate({
      duration: 1.5,
      update: () => {},
      ended: () => {
        const bubbleTransform = this.thoughtBubbleImage.sceneObject.getTransform()
        const from = new vec3(2, 25, 0)
        const to = new vec3(2, 31, 0)
        bubbleTransform.setLocalPosition(from)
        animate({
          duration: 0.5,
          easing: "ease-out-cubic",
          update: (t: number) => {
            bubbleTransform.setLocalPosition(vec3.lerp(from, to, t))
          },
        })
        this.animateMaterialAlpha(this.thoughtBubbleImage.mainMaterial, 1, 0.6)
        this.animateTextAlpha(this.thoughtBubbleText, 1, 0.6)
      },
    })

    this.animateMaterialAlpha(this.hintImage.mainMaterial, 0, 0.3)
  }

  private animateMaterialAlpha(material: Material, targetAlpha: number, durationSec: number) {
    const startAlpha = material.mainPass.baseColor.a
    animate({
      duration: durationSec,
      easing: "ease-out-cubic",
      update: (t: number) => {
        const color = material.mainPass.baseColor
        color.a = startAlpha + (targetAlpha - startAlpha) * t
        material.mainPass.baseColor = color
      },
    })
  }

  private animateTextAlpha(text: Text, targetAlpha: number, durationSec: number) {
    const startAlpha = text.textFill.color.a
    animate({
      duration: durationSec,
      easing: "ease-out-cubic",
      update: (t: number) => {
        const color = text.textFill.color
        color.a = startAlpha + (targetAlpha - startAlpha) * t
        text.textFill.color = color
      },
    })
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
