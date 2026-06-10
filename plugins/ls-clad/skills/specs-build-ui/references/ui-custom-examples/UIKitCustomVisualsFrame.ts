// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * UIKitCustomVisualsFrame – applies a selectable gradient style to a UIKit Frame component.
 */
import { Logger } from "Utilities.lspkg/Scripts/Utils/Logger"
import { bindStartEvent } from "SnapDecorators.lspkg/decorators"
import { Frame } from "SpectaclesUIKit.lspkg/Scripts/Components/Frame/Frame"
import { RoundedRectangle, GradientParameters } from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle"

// ─── Style: Candy ─────────────────────────────────────────────────────────────
// Hot-pink → magenta → violet → sky-blue linear gradient
const CANDY_GRAD: GradientParameters = {
  enabled: true, type: "Linear",
  start: new vec2(0, 1), end: new vec2(0, -1),
  stop0: { enabled: true, percent: 0,    color: new vec4(1.00, 0.42, 0.71, 1.0) },
  stop1: { enabled: true, percent: 0.35, color: new vec4(0.88, 0.38, 0.82, 1.0) },
  stop2: { enabled: true, percent: 0.65, color: new vec4(0.55, 0.48, 0.90, 1.0) },
  stop3: { enabled: true, percent: 1.0,  color: new vec4(0.26, 0.72, 0.94, 1.0) },
}
const CANDY_BORDER = new vec4(1.00, 1.00, 1.00, 0.70)

// ─── Style: Ocean ─────────────────────────────────────────────────────────────
// Radial gradient: bright cyan center glow → deep navy edges, semi-transparent
const OCEAN_GRAD: GradientParameters = {
  enabled: true, type: "Radial",
  start: new vec2(0, 0), end: new vec2(1, 0),
  stop0: { enabled: true, percent: 0,    color: new vec4(0.55, 0.95, 1.00, 0.85) },
  stop1: { enabled: true, percent: 0.35, color: new vec4(0.08, 0.50, 0.88, 0.80) },
  stop2: { enabled: true, percent: 0.65, color: new vec4(0.02, 0.20, 0.50, 0.85) },
  stop3: { enabled: true, percent: 1.0,  color: new vec4(0.00, 0.08, 0.28, 0.90) },
}
const OCEAN_BORDER = new vec4(0.30, 0.80, 1.00, 0.60)

// ─── Style: Lime ──────────────────────────────────────────────────────────────
// Electric yellow-green → lime → forest green linear gradient
const LIME_GRAD: GradientParameters = {
  enabled: true, type: "Linear",
  start: new vec2(0, 1), end: new vec2(0, -1),
  stop0: { enabled: true, percent: 0,    color: new vec4(0.90, 1.00, 0.05, 1.0) },
  stop1: { enabled: true, percent: 0.35, color: new vec4(0.55, 0.95, 0.05, 1.0) },
  stop2: { enabled: true, percent: 0.65, color: new vec4(0.25, 0.80, 0.10, 1.0) },
  stop3: { enabled: true, percent: 1.0,  color: new vec4(0.12, 0.55, 0.05, 1.0) },
}
const LIME_BORDER = new vec4(0.45, 0.88, 0.18, 0.80)

// ─── Style registry ───────────────────────────────────────────────────────────
type FrameStylePreset = { gradient: GradientParameters; border: vec4 }

const PRESETS: FrameStylePreset[] = [
  /* 0 Candy */ { gradient: CANDY_GRAD, border: CANDY_BORDER },
  /* 1 Ocean */ { gradient: OCEAN_GRAD, border: OCEAN_BORDER },
  /* 2 Lime  */ { gradient: LIME_GRAD,  border: LIME_BORDER  },
]

/**
 * Applies a selectable gradient overlay to a UIKit Frame component.
 *
 * The Frame's glass/frosted shader ignores setBackgroundGradient, so this script
 * spawns a RoundedRectangle panel one render-order step above the glass, fully
 * covering it while remaining below all child content (buttons, labels, etc.).
 *
 * Attach to the same SceneObject as the Frame component.
 */
@component
export class UIKitCustomVisualsFrame extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">UIKitCustomVisualsFrame – gradient overlay for a UIKit Frame</span><br/><span style="color: #94A3B8; font-size: 11px;">Spawns a RoundedRectangle panel on top of the Frame glass. Attach to the same SceneObject as Frame.</span>')
  @ui.separator

  @input("int")
  @hint("Visual style preset applied to the Frame background panel")
  @widget(new ComboBoxWidget([
    new ComboBoxItem("Candy", 0),
    new ComboBoxItem("Ocean", 1),
    new ComboBoxItem("Lime",  2),
  ]))
  styleIndex: number = 0

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Logging</span>')
  @input
  @hint("Enable general logging")
  enableLogging: boolean = false

  @input
  @hint("Enable lifecycle logging (onAwake, onStart, onUpdate, onDestroy)")
  enableLoggingLifecycle: boolean = false

  private _gradientPanel: RoundedRectangle = null
  private _preset: FrameStylePreset
  private logger: Logger

  onAwake() {
    // No Canvas created here — this script decorates an existing Frame on the
    // same SceneObject. The panel root that hosts the Frame must already have
    // a Component.Canvas in SortingType.Hierarchy (UIKit default) so DFS owns
    // paint order. No `renderOrder` anywhere.
    this.logger = new Logger("UIKitCustomVisualsFrame", this.enableLogging || this.enableLoggingLifecycle, true)
    if (this.enableLoggingLifecycle) this.logger.debug("LIFECYCLE: onAwake()")
    this._preset = PRESETS[Math.max(0, Math.min(PRESETS.length - 1, this.styleIndex))]
  }

  @bindStartEvent
  onStart() {
    if (this.enableLoggingLifecycle) this.logger.debug("LIFECYCLE: onStart()")

    const frame = this.sceneObject.getComponent(Frame.getTypeName()) as Frame
    if (!frame) {
      this.logger.error("Frame component not found on this SceneObject")
      return
    }

    const apply = () => {
      this._gradientPanel = this.createGradientPanel(frame)
      frame.onScalingUpdate.add(() => {
        if (this._gradientPanel) {
          this._gradientPanel.size = frame.totalSize
        }
      })
      this.logger.info("Gradient panel created with style index " + this.styleIndex)
    }

    if (frame.roundedRectangle) {
      apply()
    } else {
      frame.onInitialized.add(apply)
    }
  }

  private createGradientPanel(frame: Frame): RoundedRectangle {
    const bgObj = global.scene.createSceneObject("GradientBackground")
    bgObj.setParent(frame.sceneObject)
    bgObj.layer = frame.sceneObject.layer
    bgObj.getTransform().setLocalPosition(new vec3(0, 0, 0))

    const rr = bgObj.createComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
    rr.cornerRadius = frame.roundedRectangle.cornerRadius
    rr.initialize()
    rr.size = frame.totalSize
    rr.setBackgroundGradient(this._preset.gradient)
    rr.borderColor = this._preset.border

    // One step above the Frame glass, below all child content
    const frameOrder = frame.roundedRectangle.renderMeshVisual.getRenderOrder()
    rr.renderMeshVisual.setRenderOrder(frameOrder + 1)

    this.logger.debug("GradientBackground panel render order set to " + (frameOrder + 1))
    return rr
  }
}
