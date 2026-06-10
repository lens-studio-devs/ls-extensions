// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

import {Frame} from "SpectaclesUIKit.lspkg/Scripts/Components/Frame/Frame"
import {RectangleButton} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton"
import animate, {CancelSet} from "SpectaclesInteractionKit.lspkg/Utils/animate"

/**
 * UI States for the application
 */
enum UIState {
  MainMenu = "MainMenu",
  Home = "Home",
  ScreenA = "ScreenA",
  ScreenB = "ScreenB",
  ScreenC = "ScreenC"
}

@component
export class UIManager extends BaseScriptComponent {
  // ===== Frame Reference =====
  @ui.group_start("Frame Settings")
  @input
  @hint("Reference to the Frame component that will be resized")
  frame: Frame

  @input
  @hint("Initial frame size (for Home/main menu) - only X and Y matter")
  initialFrameSize: vec2 = new vec2(33, 18)

  @input
  @hint("Expanded frame size for Screen A state - only X and Y matter")
  expandedSize1: vec2 = new vec2(33, 28)

  @input
  @hint("Expanded frame size for Screen C state - only X and Y matter")
  expandedSize2: vec2 = new vec2(33, 35)

  @input
  @hint("Duration for frame resize animation (in seconds)")
  resizeAnimationDuration: number = 0.4
  @ui.group_end

  // ===== Main Menu Buttons =====
  @ui.group_start("Main Menu Buttons")
  @input
  @hint("Home button")
  homeButton: RectangleButton

  @input
  @hint("Screen A button")
  screenAButton: RectangleButton

  @input
  @hint("Screen C button")
  screenCButton: RectangleButton
  @ui.group_end

  // ===== State Content Objects =====
  @ui.group_start("Content Objects")
  @input
  @hint("Scene object containing Home content (text, etc.)")
  homeContent: SceneObject

  @input
  @hint("Scene object containing Screen A content (instructions and buttons)")
  screenAContent: SceneObject

  @input
  @hint("Scene object containing Screen B content (exit button)")
  screenBContent: SceneObject

  @input
  @hint("Scene object containing Screen C grid content")
  screenCContent: SceneObject

  @input
  @hint("Scene object containing the side menu buttons (will be hidden in some states)")
  sideMenuContent: SceneObject
  @ui.group_end

  // ===== Screen A Buttons =====
  @ui.group_start("Screen A Buttons")
  @input
  @hint("Start Screen B button in Screen A")
  startScreenBButton: RectangleButton

  @input
  @hint("Exit button in Screen A")
  exitScreenAButton: RectangleButton
  @ui.group_end

  // ===== Screen B Buttons =====
  @ui.group_start("Screen B Buttons")
  @input
  @hint("Exit button in Screen B")
  exitScreenBButton: RectangleButton
  @ui.group_end

  // ===== Internal State =====
  private currentState: UIState = UIState.Home
  private resizeAnimationCancel: CancelSet = new CancelSet()
  private initialized: boolean = false

  onAwake() {
    // No Canvas created here — this script orchestrates a pre-existing UIKit
    // Frame referenced via @input. The Frame's panel root must already have a
    // Component.Canvas in SortingType.Hierarchy (UIKit default) so DFS over its
    // subtree owns paint order. No `renderOrder` anywhere.
    this.createEvent("OnStartEvent").bind(this.initialize.bind(this))
  }

  /**
   * Initialize the UI Manager and set up button event handlers
   */
  initialize() {
    if (this.initialized) {
      return
    }

    // Validate required references
    if (!this.frame) {
      print("ERROR: UIManager - Frame reference is required!")
      return
    }

    // Set up main menu button handlers
    if (this.homeButton) {
      this.homeButton.onTriggerUp.add(() => {
        this.transitionToHome()
      })
    }

    if (this.screenAButton) {
      this.screenAButton.onTriggerUp.add(() => {
        this.transitionToScreenA()
      })
    }

    if (this.screenCButton) {
      this.screenCButton.onTriggerUp.add(() => {
        this.transitionToScreenC()
      })
    }

    // Set up Screen A button handlers
    if (this.startScreenBButton) {
      this.startScreenBButton.onTriggerUp.add(() => {
        this.transitionToScreenB()
      })
    }

    if (this.exitScreenAButton) {
      this.exitScreenAButton.onTriggerUp.add(() => {
        this.transitionToHome()
      })
    }

    // Set up Screen B button handlers
    if (this.exitScreenBButton) {
      this.exitScreenBButton.onTriggerUp.add(() => {
        this.transitionToHome()
      })
    }

    // Initialize to Home state (with initial content visible)
    this.transitionToHome()

    this.initialized = true
  }

  /**
   * Transition to Home state
   * Shows home content and hides other content
   */
  private transitionToHome() {
    print("UIManager: Transitioning to Home")
    this.currentState = UIState.Home

    // Hide all content
    this.hideAllContent()

    // Show Home content
    if (this.homeContent) {
      this.homeContent.enabled = true
    }

    // Keep side menu visible
    if (this.sideMenuContent) {
      this.sideMenuContent.enabled = true
    }

    // Resize frame to initial size
    this.animateFrameSize(this.initialFrameSize)
  }

  /**
   * Transition to Screen A state
   * Shows Screen A content and resizes frame
   */
  private transitionToScreenA() {
    print("UIManager: Transitioning to Screen A")
    this.currentState = UIState.ScreenA

    // Hide all content
    this.hideAllContent()

    // Show Screen A content
    if (this.screenAContent) {
      this.screenAContent.enabled = true
    }

    // Hide side menu
    if (this.sideMenuContent) {
      this.sideMenuContent.enabled = false
    }

    // Resize frame to expanded size 1 (vertically expanded)
    this.animateFrameSize(this.expandedSize1)
  }

  /**
   * Transition to Screen B state
   * Shows Screen B content
   */
  private transitionToScreenB() {
    print("UIManager: Transitioning to Screen B")
    this.currentState = UIState.ScreenB

    // Hide all content
    this.hideAllContent()

    // Show Screen B content
    if (this.screenBContent) {
      this.screenBContent.enabled = true
    }

    // Keep frame at same size as Screen A
    // (already at expandedSize1 from previous state)
  }

  /**
   * Transition to Screen C state
   * Shows Screen C content and resizes frame, keeps side menu visible
   */
  private transitionToScreenC() {
    print("UIManager: Transitioning to Screen C")
    this.currentState = UIState.ScreenC

    // Hide all content
    this.hideAllContent()

    // Show Screen C content
    if (this.screenCContent) {
      this.screenCContent.enabled = true
    }

    // Keep side menu visible
    if (this.sideMenuContent) {
      this.sideMenuContent.enabled = true
    }

    // Resize frame to expanded size 2
    this.animateFrameSize(this.expandedSize2)
  }

  /**
   * Transition to Main Menu state
   * This is essentially the same as Home (shows home content by default)
   */
  private transitionToMainMenu() {
    // Main menu is same as Home state
    this.transitionToHome()
  }

  /**
   * Hide all content objects
   */
  private hideAllContent() {
    if (this.homeContent) {
      this.homeContent.enabled = false
    }
    if (this.screenAContent) {
      this.screenAContent.enabled = false
    }
    if (this.screenBContent) {
      this.screenBContent.enabled = false
    }
    if (this.screenCContent) {
      this.screenCContent.enabled = false
    }
  }

  /**
   * Animate frame's innerSize smoothly
   * @param targetSize - Target innerSize as vec2 (width, height)
   */
  private animateFrameSize(targetSize: vec2) {
    if (!this.frame) {
      return
    }

    // Cancel any ongoing resize animation
    this.resizeAnimationCancel.cancel()

    const startSize = this.frame.innerSize
    const endSize = targetSize

    // Animate the frame's innerSize property
    animate({
      duration: this.resizeAnimationDuration,
      cancelSet: this.resizeAnimationCancel,
      easing: "ease-in-out-cubic",
      update: (t: number) => {
        const newSize = vec2.lerp(startSize, endSize, t)
        this.frame.innerSize = newSize
      }
    })
  }

  /**
   * Get current UI state (for debugging or external access)
   */
  getCurrentState(): UIState {
    return this.currentState
  }

  /**
   * Manually set state (useful for testing or external control)
   */
  setState(state: UIState) {
    switch (state) {
      case UIState.MainMenu:
        this.transitionToMainMenu()
        break
      case UIState.Home:
        this.transitionToHome()
        break
      case UIState.ScreenA:
        this.transitionToScreenA()
        break
      case UIState.ScreenB:
        this.transitionToScreenB()
        break
      case UIState.ScreenC:
        this.transitionToScreenC()
        break
      default:
        print("UIManager: Unknown state - " + state)
    }
  }
}
