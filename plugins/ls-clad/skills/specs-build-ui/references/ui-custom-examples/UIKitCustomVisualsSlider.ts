// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * UIKitCustomVisualsSlider – applies a selectable gradient style to a UIKit Slider component.
 */
import { Logger } from "Utilities.lspkg/Scripts/Utils/Logger"
import { bindStartEvent } from "SnapDecorators.lspkg/decorators"
import { Slider } from "SpectaclesUIKit.lspkg/Scripts/Components/Slider/Slider"
import {
  RoundedRectangleVisual,
  RoundedRectangleVisualState,
} from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangleVisual"
import { StateName } from "SpectaclesUIKit.lspkg/Scripts/Components/Element"
import { GradientParameters } from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle"

// ─── Style: Candy ─────────────────────────────────────────────────────────────
// Track: deep purple-black pill so the gradient fill pops
const CANDY_TRACK: GradientParameters = {
  enabled: true, type: "Linear", start: new vec2(0, 1), end: new vec2(0, -1),
  stop0: { enabled: true, percent: 0,   color: new vec4(0.20, 0.12, 0.28, 1.0) },
  stop1: { enabled: true, percent: 1.0, color: new vec4(0.12, 0.08, 0.22, 1.0) },
}
// Fill: pink → blue left-to-right progress indicator
const CANDY_FILL: GradientParameters = {
  enabled: true, type: "Linear", start: new vec2(-1, 0), end: new vec2(1, 0),
  stop0: { enabled: true, percent: 0,    color: new vec4(1.00, 0.42, 0.71, 1.0) },
  stop1: { enabled: true, percent: 0.35, color: new vec4(0.88, 0.38, 0.82, 1.0) },
  stop2: { enabled: true, percent: 0.65, color: new vec4(0.55, 0.48, 0.90, 1.0) },
  stop3: { enabled: true, percent: 1.0,  color: new vec4(0.26, 0.72, 0.94, 1.0) },
}
const CANDY_FILL_H: GradientParameters = {
  enabled: true, type: "Linear", start: new vec2(-1, 0), end: new vec2(1, 0),
  stop0: { enabled: true, percent: 0,    color: new vec4(1.00, 0.60, 0.82, 1.0) },
  stop1: { enabled: true, percent: 0.40, color: new vec4(0.68, 0.60, 0.96, 1.0) },
  stop2: { enabled: true, percent: 0.75, color: new vec4(0.68, 0.60, 0.96, 1.0) },
  stop3: { enabled: true, percent: 1.0,  color: new vec4(0.48, 0.82, 0.98, 1.0) },
}
// Knob: diagonal pink → blue
const CANDY_KNOB: GradientParameters = {
  enabled: true, type: "Linear", start: new vec2(-1, 1), end: new vec2(1, -1),
  stop0: { enabled: true, percent: 0,    color: new vec4(1.00, 0.42, 0.71, 1.0) },
  stop1: { enabled: true, percent: 0.40, color: new vec4(0.88, 0.38, 0.82, 1.0) },
  stop2: { enabled: true, percent: 0.75, color: new vec4(0.55, 0.48, 0.90, 1.0) },
  stop3: { enabled: true, percent: 1.0,  color: new vec4(0.26, 0.72, 0.94, 1.0) },
}
const CANDY_KNOB_H: GradientParameters = {
  enabled: true, type: "Linear", start: new vec2(-1, 1), end: new vec2(1, -1),
  stop0: { enabled: true, percent: 0,    color: new vec4(1.00, 0.60, 0.82, 1.0) },
  stop1: { enabled: true, percent: 0.40, color: new vec4(0.68, 0.60, 0.96, 1.0) },
  stop2: { enabled: true, percent: 0.75, color: new vec4(0.68, 0.60, 0.96, 1.0) },
  stop3: { enabled: true, percent: 1.0,  color: new vec4(0.48, 0.82, 0.98, 1.0) },
}

// ─── Style: Ocean ─────────────────────────────────────────────────────────────
// Track: dark navy pill
const OCEAN_TRACK: GradientParameters = {
  enabled: true, type: "Linear", start: new vec2(0, 1), end: new vec2(0, -1),
  stop0: { enabled: true, percent: 0,   color: new vec4(0.00, 0.10, 0.28, 0.90) },
  stop1: { enabled: true, percent: 1.0, color: new vec4(0.00, 0.05, 0.18, 0.90) },
}
// Fill: deep blue → teal → cyan left-to-right
const OCEAN_FILL: GradientParameters = {
  enabled: true, type: "Linear", start: new vec2(-1, 0), end: new vec2(1, 0),
  stop0: { enabled: true, percent: 0,    color: new vec4(0.00, 0.20, 0.55, 0.85) },
  stop1: { enabled: true, percent: 0.45, color: new vec4(0.08, 0.50, 0.88, 0.80) },
  stop2: { enabled: true, percent: 0.80, color: new vec4(0.25, 0.80, 1.00, 0.75) },
  stop3: { enabled: true, percent: 1.0,  color: new vec4(0.55, 0.95, 1.00, 0.70) },
}
const OCEAN_FILL_H: GradientParameters = {
  enabled: true, type: "Linear", start: new vec2(-1, 0), end: new vec2(1, 0),
  stop0: { enabled: true, percent: 0,    color: new vec4(0.05, 0.30, 0.68, 0.88) },
  stop1: { enabled: true, percent: 0.45, color: new vec4(0.15, 0.65, 0.95, 0.84) },
  stop2: { enabled: true, percent: 0.80, color: new vec4(0.40, 0.90, 1.00, 0.80) },
  stop3: { enabled: true, percent: 1.0,  color: new vec4(0.75, 1.00, 1.00, 0.75) },
}
// Knob: radial ocean glow — bright cyan center, deep navy edge
const OCEAN_KNOB: GradientParameters = {
  enabled: true, type: "Radial", start: new vec2(0, 0), end: new vec2(1, 0),
  stop0: { enabled: true, percent: 0,    color: new vec4(0.55, 0.95, 1.00, 0.85) },
  stop1: { enabled: true, percent: 0.40, color: new vec4(0.10, 0.55, 0.90, 0.80) },
  stop2: { enabled: true, percent: 0.75, color: new vec4(0.02, 0.22, 0.52, 0.85) },
  stop3: { enabled: true, percent: 1.0,  color: new vec4(0.00, 0.08, 0.28, 0.90) },
}
const OCEAN_KNOB_H: GradientParameters = {
  enabled: true, type: "Radial", start: new vec2(0, 0), end: new vec2(1, 0),
  stop0: { enabled: true, percent: 0,    color: new vec4(0.78, 1.00, 1.00, 0.90) },
  stop1: { enabled: true, percent: 0.40, color: new vec4(0.22, 0.72, 0.98, 0.85) },
  stop2: { enabled: true, percent: 0.75, color: new vec4(0.05, 0.32, 0.68, 0.85) },
  stop3: { enabled: true, percent: 1.0,  color: new vec4(0.00, 0.12, 0.36, 0.90) },
}

// ─── Style: Lime ──────────────────────────────────────────────────────────────
// Track: dark forest-green pill
const LIME_TRACK: GradientParameters = {
  enabled: true, type: "Linear", start: new vec2(0, 1), end: new vec2(0, -1),
  stop0: { enabled: true, percent: 0,   color: new vec4(0.06, 0.22, 0.03, 1.0) },
  stop1: { enabled: true, percent: 1.0, color: new vec4(0.04, 0.14, 0.02, 1.0) },
}
// Fill: yellow → lime → green left-to-right
const LIME_FILL: GradientParameters = {
  enabled: true, type: "Linear", start: new vec2(-1, 0), end: new vec2(1, 0),
  stop0: { enabled: true, percent: 0,    color: new vec4(0.90, 1.00, 0.05, 1.0) },
  stop1: { enabled: true, percent: 0.35, color: new vec4(0.55, 0.95, 0.05, 1.0) },
  stop2: { enabled: true, percent: 0.65, color: new vec4(0.25, 0.80, 0.10, 1.0) },
  stop3: { enabled: true, percent: 1.0,  color: new vec4(0.12, 0.55, 0.05, 1.0) },
}
const LIME_FILL_H: GradientParameters = {
  enabled: true, type: "Linear", start: new vec2(-1, 0), end: new vec2(1, 0),
  stop0: { enabled: true, percent: 0,    color: new vec4(0.98, 1.00, 0.40, 1.0) },
  stop1: { enabled: true, percent: 0.40, color: new vec4(0.72, 1.00, 0.25, 1.0) },
  stop2: { enabled: true, percent: 0.75, color: new vec4(0.40, 0.90, 0.15, 1.0) },
  stop3: { enabled: true, percent: 1.0,  color: new vec4(0.20, 0.70, 0.08, 1.0) },
}
// Knob: diagonal yellow-green → forest green
const LIME_KNOB: GradientParameters = {
  enabled: true, type: "Linear", start: new vec2(-1, 1), end: new vec2(1, -1),
  stop0: { enabled: true, percent: 0,    color: new vec4(0.90, 1.00, 0.05, 1.0) },
  stop1: { enabled: true, percent: 0.40, color: new vec4(0.55, 0.95, 0.05, 1.0) },
  stop2: { enabled: true, percent: 0.75, color: new vec4(0.25, 0.80, 0.10, 1.0) },
  stop3: { enabled: true, percent: 1.0,  color: new vec4(0.12, 0.55, 0.05, 1.0) },
}
const LIME_KNOB_H: GradientParameters = {
  enabled: true, type: "Linear", start: new vec2(-1, 1), end: new vec2(1, -1),
  stop0: { enabled: true, percent: 0,    color: new vec4(0.98, 1.00, 0.40, 1.0) },
  stop1: { enabled: true, percent: 0.40, color: new vec4(0.72, 1.00, 0.25, 1.0) },
  stop2: { enabled: true, percent: 0.75, color: new vec4(0.40, 0.90, 0.15, 1.0) },
  stop3: { enabled: true, percent: 1.0,  color: new vec4(0.20, 0.70, 0.08, 1.0) },
}

// ─── Style registry ───────────────────────────────────────────────────────────
type SliderStylePreset = {
  trackGrad: GradientParameters
  fillGrad: GradientParameters
  fillHoveredGrad: GradientParameters
  knobGrad: GradientParameters
  knobHoveredGrad: GradientParameters
  border: vec4
  borderH: vec4
}

const PRESETS: SliderStylePreset[] = [
  /* 0 Candy */ {
    trackGrad: CANDY_TRACK, fillGrad: CANDY_FILL, fillHoveredGrad: CANDY_FILL_H,
    knobGrad: CANDY_KNOB, knobHoveredGrad: CANDY_KNOB_H,
    border: new vec4(1.00, 1.00, 1.00, 0.70), borderH: new vec4(1.00, 0.85, 0.95, 1.0),
  },
  /* 1 Ocean */ {
    trackGrad: OCEAN_TRACK, fillGrad: OCEAN_FILL, fillHoveredGrad: OCEAN_FILL_H,
    knobGrad: OCEAN_KNOB, knobHoveredGrad: OCEAN_KNOB_H,
    border: new vec4(0.30, 0.80, 1.00, 0.60), borderH: new vec4(0.55, 0.95, 1.00, 0.80),
  },
  /* 2 Lime  */ {
    trackGrad: LIME_TRACK, fillGrad: LIME_FILL, fillHoveredGrad: LIME_FILL_H,
    knobGrad: LIME_KNOB, knobHoveredGrad: LIME_KNOB_H,
    border: new vec4(0.45, 0.88, 0.18, 0.80), borderH: new vec4(0.65, 1.00, 0.35, 0.90),
  },
]

/**
 * Applies a selectable gradient style to all three parts of a UIKit Slider:
 * track (background rail), trackFill (progress bar), and knob (drag handle).
 *
 * Two-path approach:
 *  A) onAwake:  replaces the track visual before the Slider initializes
 *  B) onStart:  overrides knob and trackFill gradient properties via public API
 *               and re-applies track overrides as a guaranteed fallback
 *
 * Attach to the same SceneObject as the Slider component.
 */
@component
export class UIKitCustomVisualsSlider extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">UIKitCustomVisualsSlider – gradient style for a UIKit Slider</span><br/><span style="color: #94A3B8; font-size: 11px;">Styles the track, progress fill, and knob. Attach to the same SceneObject as Slider.</span>')
  @ui.separator

  @input("int")
  @hint("Visual style preset: Candy = pink/blue, Ocean = teal/navy with radial knob, Lime = yellow/green")
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

  private _slider: Slider = null
  private _preset: SliderStylePreset
  private logger: Logger

  onAwake() {
    // No Canvas created here — this script decorates an existing Slider on the
    // same SceneObject. The panel root that hosts the Slider must already have
    // a Component.Canvas in SortingType.Hierarchy (UIKit default) so DFS owns
    // paint order. No `renderOrder` anywhere.
    this.logger = new Logger("UIKitCustomVisualsSlider", this.enableLogging || this.enableLoggingLifecycle, true)
    if (this.enableLoggingLifecycle) this.logger.debug("LIFECYCLE: onAwake()")

    this._slider = this.sceneObject.getComponent(Slider.getTypeName()) as Slider
    if (!this._slider) {
      this.logger.error("Slider component not found on this SceneObject")
      return
    }

    this._preset = PRESETS[Math.max(0, Math.min(PRESETS.length - 1, this.styleIndex))]
    const p = this._preset

    // Path A — replace track visual before initialization; knob and trackFill
    // are created with default visuals by Slider.createDefaultVisual() and are styled in onStart
    const trackStyle: Partial<Record<StateName, RoundedRectangleVisualState>> = {
      default:   { hasBorder: true, borderSize: 0.08, borderType: "Color", borderColor: p.border,  baseGradient: p.trackGrad },
      hovered:   { hasBorder: true, borderSize: 0.08, borderType: "Color", borderColor: p.borderH, baseGradient: p.trackGrad },
      triggered: { hasBorder: true, borderSize: 0.10, borderType: "Color", borderColor: p.border,  baseGradient: p.trackGrad },
    }
    const customTrackVisual = new RoundedRectangleVisual({ sceneObject: this._slider.sceneObject, style: trackStyle })
    this._slider.visual = customTrackVisual
    this._slider.initialize()

    this.logger.info("Track visual applied (Path A) with style index " + this.styleIndex)
  }

  @bindStartEvent
  onStart() {
    if (this.enableLoggingLifecycle) this.logger.debug("LIFECYCLE: onStart()")
    if (!this._slider) return

    const p = this._preset

    // Track — guaranteed fallback
    const track = this._slider.visual as RoundedRectangleVisual
    if (track) {
      track.defaultBaseType   = "Gradient"
      track.hoveredBaseType   = "Gradient"
      track.triggeredBaseType = "Gradient"
      track.defaultGradient   = p.trackGrad
      track.hoveredGradient   = p.trackGrad
      track.triggeredGradient = p.trackGrad
      track.defaultHasBorder   = true
      track.hoveredHasBorder   = true
      track.triggeredHasBorder = true
      track.defaultBorderSize   = 0.08
      track.hoveredBorderSize   = 0.08
      track.triggeredBorderSize = 0.10
      track.defaultBorderType   = "Color"
      track.hoveredBorderType   = "Color"
      track.triggeredBorderType = "Color"
      track.borderDefaultColor   = p.border
      track.borderHoveredColor   = p.borderH
      track.borderTriggeredColor = p.border
    } else {
      this.logger.warn("Track visual not available in onStart")
    }

    // TrackFill (progress bar inside the rail)
    const fill = this._slider.trackFillVisual as RoundedRectangleVisual
    if (fill) {
      fill.defaultBaseType   = "Gradient"
      fill.hoveredBaseType   = "Gradient"
      fill.triggeredBaseType = "Gradient"
      fill.defaultGradient   = p.fillGrad
      fill.hoveredGradient   = p.fillHoveredGrad
      fill.triggeredGradient = p.fillGrad
    } else {
      this.logger.warn("TrackFill visual not available in onStart")
    }

    // Knob (draggable circular handle)
    const knob = this._slider.knobVisual as RoundedRectangleVisual
    if (knob) {
      knob.defaultBaseType   = "Gradient"
      knob.hoveredBaseType   = "Gradient"
      knob.triggeredBaseType = "Gradient"
      knob.defaultGradient   = p.knobGrad
      knob.hoveredGradient   = p.knobHoveredGrad
      knob.triggeredGradient = p.knobGrad
      knob.defaultHasBorder   = true
      knob.hoveredHasBorder   = true
      knob.triggeredHasBorder = true
      knob.defaultBorderSize   = 0.08
      knob.hoveredBorderSize   = 0.08
      knob.triggeredBorderSize = 0.10
      knob.defaultBorderType   = "Color"
      knob.hoveredBorderType   = "Color"
      knob.triggeredBorderType = "Color"
      knob.borderDefaultColor   = p.border
      knob.borderHoveredColor   = p.borderH
      knob.borderTriggeredColor = p.border
    } else {
      this.logger.warn("Knob visual not available in onStart")
    }

    this.logger.info("All Slider visuals styled (Path B) with style index " + this.styleIndex)
  }
}
