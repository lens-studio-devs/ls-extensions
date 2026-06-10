// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * UIKitCustomVisualsSwitch – applies a selectable gradient style to a UIKit Switch component.
 */
import { Logger } from "Utilities.lspkg/Scripts/Utils/Logger"
import { bindStartEvent } from "SnapDecorators.lspkg/decorators"
import { Switch } from "SpectaclesUIKit.lspkg/Scripts/Components/Switch/Switch"
import {
  RoundedRectangleVisual,
  RoundedRectangleVisualState,
} from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangleVisual"
import { StateName } from "SpectaclesUIKit.lspkg/Scripts/Components/Element"
import { GradientParameters } from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle"

// ─── Shared: neutral knob (OFF state, used by all styles) ─────────────────────
// A soft lavender-gray circle that reads cleanly against any dark OFF track
const KNOB_OFF: GradientParameters = {
  enabled: true, type: "Linear", start: new vec2(-1, 1), end: new vec2(1, -1),
  stop0: { enabled: true, percent: 0,   color: new vec4(0.88, 0.85, 0.92, 1.0) },
  stop1: { enabled: true, percent: 1.0, color: new vec4(0.65, 0.62, 0.72, 1.0) },
}
const KNOB_OFF_H: GradientParameters = {
  enabled: true, type: "Linear", start: new vec2(-1, 1), end: new vec2(1, -1),
  stop0: { enabled: true, percent: 0,   color: new vec4(0.96, 0.93, 1.00, 1.0) },
  stop1: { enabled: true, percent: 1.0, color: new vec4(0.78, 0.75, 0.88, 1.0) },
}

// ─── Style: Candy ─────────────────────────────────────────────────────────────
const CANDY_TRACK_OFF: GradientParameters = {
  enabled: true, type: "Linear", start: new vec2(0, 1), end: new vec2(0, -1),
  stop0: { enabled: true, percent: 0,   color: new vec4(0.20, 0.12, 0.28, 1.0) },
  stop1: { enabled: true, percent: 1.0, color: new vec4(0.12, 0.08, 0.22, 1.0) },
}
const CANDY_TRACK_ON: GradientParameters = {
  enabled: true, type: "Linear", start: new vec2(-1, 0), end: new vec2(1, 0),
  stop0: { enabled: true, percent: 0,    color: new vec4(1.00, 0.42, 0.71, 1.0) },
  stop1: { enabled: true, percent: 0.35, color: new vec4(0.88, 0.38, 0.82, 1.0) },
  stop2: { enabled: true, percent: 0.65, color: new vec4(0.55, 0.48, 0.90, 1.0) },
  stop3: { enabled: true, percent: 1.0,  color: new vec4(0.26, 0.72, 0.94, 1.0) },
}
const CANDY_TRACK_ON_H: GradientParameters = {
  enabled: true, type: "Linear", start: new vec2(-1, 0), end: new vec2(1, 0),
  stop0: { enabled: true, percent: 0,    color: new vec4(1.00, 0.60, 0.82, 1.0) },
  stop1: { enabled: true, percent: 0.40, color: new vec4(0.68, 0.60, 0.96, 1.0) },
  stop2: { enabled: true, percent: 0.75, color: new vec4(0.68, 0.60, 0.96, 1.0) },
  stop3: { enabled: true, percent: 1.0,  color: new vec4(0.48, 0.82, 0.98, 1.0) },
}
const CANDY_FILL_OFF: GradientParameters = {
  enabled: true, type: "Linear", start: new vec2(-1, 0), end: new vec2(1, 0),
  stop0: { enabled: true, percent: 0,   color: new vec4(0.28, 0.14, 0.38, 1.0) },
  stop1: { enabled: true, percent: 1.0, color: new vec4(0.22, 0.10, 0.30, 1.0) },
}
const CANDY_FILL_ON: GradientParameters = {
  enabled: true, type: "Linear", start: new vec2(-1, 0), end: new vec2(1, 0),
  stop0: { enabled: true, percent: 0,    color: new vec4(1.00, 0.42, 0.71, 1.0) },
  stop1: { enabled: true, percent: 0.60, color: new vec4(0.88, 0.38, 0.82, 1.0) },
  stop2: { enabled: true, percent: 1.0,  color: new vec4(0.55, 0.48, 0.90, 1.0) },
}
const CANDY_FILL_ON_H: GradientParameters = {
  enabled: true, type: "Linear", start: new vec2(-1, 0), end: new vec2(1, 0),
  stop0: { enabled: true, percent: 0,    color: new vec4(1.00, 0.60, 0.82, 1.0) },
  stop1: { enabled: true, percent: 0.60, color: new vec4(0.68, 0.60, 0.96, 1.0) },
  stop2: { enabled: true, percent: 1.0,  color: new vec4(0.48, 0.82, 0.98, 1.0) },
}
const CANDY_KNOB_ON: GradientParameters = {
  enabled: true, type: "Linear", start: new vec2(-1, 1), end: new vec2(1, -1),
  stop0: { enabled: true, percent: 0,    color: new vec4(1.00, 0.42, 0.71, 1.0) },
  stop1: { enabled: true, percent: 0.40, color: new vec4(0.88, 0.38, 0.82, 1.0) },
  stop2: { enabled: true, percent: 0.75, color: new vec4(0.55, 0.48, 0.90, 1.0) },
  stop3: { enabled: true, percent: 1.0,  color: new vec4(0.26, 0.72, 0.94, 1.0) },
}
const CANDY_KNOB_ON_H: GradientParameters = {
  enabled: true, type: "Linear", start: new vec2(-1, 1), end: new vec2(1, -1),
  stop0: { enabled: true, percent: 0,    color: new vec4(1.00, 0.60, 0.82, 1.0) },
  stop1: { enabled: true, percent: 0.40, color: new vec4(0.68, 0.60, 0.96, 1.0) },
  stop2: { enabled: true, percent: 0.75, color: new vec4(0.68, 0.60, 0.96, 1.0) },
  stop3: { enabled: true, percent: 1.0,  color: new vec4(0.48, 0.82, 0.98, 1.0) },
}

// ─── Style: Ocean ─────────────────────────────────────────────────────────────
const OCEAN_TRACK_OFF: GradientParameters = {
  enabled: true, type: "Linear", start: new vec2(0, 1), end: new vec2(0, -1),
  stop0: { enabled: true, percent: 0,   color: new vec4(0.00, 0.10, 0.28, 0.90) },
  stop1: { enabled: true, percent: 1.0, color: new vec4(0.00, 0.05, 0.18, 0.90) },
}
const OCEAN_TRACK_ON: GradientParameters = {
  enabled: true, type: "Linear", start: new vec2(-1, 0), end: new vec2(1, 0),
  stop0: { enabled: true, percent: 0,    color: new vec4(0.00, 0.20, 0.55, 0.85) },
  stop1: { enabled: true, percent: 0.45, color: new vec4(0.08, 0.50, 0.88, 0.80) },
  stop2: { enabled: true, percent: 0.80, color: new vec4(0.25, 0.80, 1.00, 0.75) },
  stop3: { enabled: true, percent: 1.0,  color: new vec4(0.55, 0.95, 1.00, 0.70) },
}
const OCEAN_TRACK_ON_H: GradientParameters = {
  enabled: true, type: "Linear", start: new vec2(-1, 0), end: new vec2(1, 0),
  stop0: { enabled: true, percent: 0,    color: new vec4(0.05, 0.30, 0.68, 0.88) },
  stop1: { enabled: true, percent: 0.45, color: new vec4(0.15, 0.65, 0.95, 0.84) },
  stop2: { enabled: true, percent: 0.80, color: new vec4(0.40, 0.90, 1.00, 0.80) },
  stop3: { enabled: true, percent: 1.0,  color: new vec4(0.75, 1.00, 1.00, 0.75) },
}
const OCEAN_FILL_OFF: GradientParameters = {
  enabled: true, type: "Linear", start: new vec2(-1, 0), end: new vec2(1, 0),
  stop0: { enabled: true, percent: 0,   color: new vec4(0.00, 0.14, 0.35, 0.85) },
  stop1: { enabled: true, percent: 1.0, color: new vec4(0.00, 0.08, 0.24, 0.85) },
}
const OCEAN_FILL_ON: GradientParameters = {
  enabled: true, type: "Linear", start: new vec2(-1, 0), end: new vec2(1, 0),
  stop0: { enabled: true, percent: 0,    color: new vec4(0.00, 0.22, 0.58, 0.88) },
  stop1: { enabled: true, percent: 0.55, color: new vec4(0.10, 0.58, 0.92, 0.82) },
  stop2: { enabled: true, percent: 1.0,  color: new vec4(0.30, 0.85, 1.00, 0.75) },
}
const OCEAN_FILL_ON_H: GradientParameters = {
  enabled: true, type: "Linear", start: new vec2(-1, 0), end: new vec2(1, 0),
  stop0: { enabled: true, percent: 0,    color: new vec4(0.05, 0.32, 0.70, 0.90) },
  stop1: { enabled: true, percent: 0.55, color: new vec4(0.18, 0.68, 0.98, 0.85) },
  stop2: { enabled: true, percent: 1.0,  color: new vec4(0.45, 0.92, 1.00, 0.80) },
}
const OCEAN_KNOB_ON: GradientParameters = {
  enabled: true, type: "Radial", start: new vec2(0, 0), end: new vec2(1, 0),
  stop0: { enabled: true, percent: 0,    color: new vec4(0.55, 0.95, 1.00, 0.85) },
  stop1: { enabled: true, percent: 0.40, color: new vec4(0.10, 0.55, 0.90, 0.80) },
  stop2: { enabled: true, percent: 0.75, color: new vec4(0.02, 0.22, 0.52, 0.85) },
  stop3: { enabled: true, percent: 1.0,  color: new vec4(0.00, 0.08, 0.28, 0.90) },
}
const OCEAN_KNOB_ON_H: GradientParameters = {
  enabled: true, type: "Radial", start: new vec2(0, 0), end: new vec2(1, 0),
  stop0: { enabled: true, percent: 0,    color: new vec4(0.78, 1.00, 1.00, 0.90) },
  stop1: { enabled: true, percent: 0.40, color: new vec4(0.22, 0.72, 0.98, 0.85) },
  stop2: { enabled: true, percent: 0.75, color: new vec4(0.05, 0.32, 0.68, 0.85) },
  stop3: { enabled: true, percent: 1.0,  color: new vec4(0.00, 0.12, 0.36, 0.90) },
}

// ─── Style: Lime ──────────────────────────────────────────────────────────────
const LIME_TRACK_OFF: GradientParameters = {
  enabled: true, type: "Linear", start: new vec2(0, 1), end: new vec2(0, -1),
  stop0: { enabled: true, percent: 0,   color: new vec4(0.06, 0.22, 0.03, 1.0) },
  stop1: { enabled: true, percent: 1.0, color: new vec4(0.04, 0.14, 0.02, 1.0) },
}
const LIME_TRACK_ON: GradientParameters = {
  enabled: true, type: "Linear", start: new vec2(-1, 0), end: new vec2(1, 0),
  stop0: { enabled: true, percent: 0,    color: new vec4(0.90, 1.00, 0.05, 1.0) },
  stop1: { enabled: true, percent: 0.35, color: new vec4(0.55, 0.95, 0.05, 1.0) },
  stop2: { enabled: true, percent: 0.65, color: new vec4(0.25, 0.80, 0.10, 1.0) },
  stop3: { enabled: true, percent: 1.0,  color: new vec4(0.12, 0.55, 0.05, 1.0) },
}
const LIME_TRACK_ON_H: GradientParameters = {
  enabled: true, type: "Linear", start: new vec2(-1, 0), end: new vec2(1, 0),
  stop0: { enabled: true, percent: 0,    color: new vec4(0.98, 1.00, 0.40, 1.0) },
  stop1: { enabled: true, percent: 0.40, color: new vec4(0.72, 1.00, 0.25, 1.0) },
  stop2: { enabled: true, percent: 0.75, color: new vec4(0.40, 0.90, 0.15, 1.0) },
  stop3: { enabled: true, percent: 1.0,  color: new vec4(0.20, 0.70, 0.08, 1.0) },
}
const LIME_FILL_OFF: GradientParameters = {
  enabled: true, type: "Linear", start: new vec2(-1, 0), end: new vec2(1, 0),
  stop0: { enabled: true, percent: 0,   color: new vec4(0.08, 0.28, 0.04, 1.0) },
  stop1: { enabled: true, percent: 1.0, color: new vec4(0.05, 0.18, 0.03, 1.0) },
}
const LIME_FILL_ON: GradientParameters = {
  enabled: true, type: "Linear", start: new vec2(-1, 0), end: new vec2(1, 0),
  stop0: { enabled: true, percent: 0,    color: new vec4(0.90, 1.00, 0.05, 1.0) },
  stop1: { enabled: true, percent: 0.55, color: new vec4(0.55, 0.95, 0.05, 1.0) },
  stop2: { enabled: true, percent: 1.0,  color: new vec4(0.25, 0.80, 0.10, 1.0) },
}
const LIME_FILL_ON_H: GradientParameters = {
  enabled: true, type: "Linear", start: new vec2(-1, 0), end: new vec2(1, 0),
  stop0: { enabled: true, percent: 0,    color: new vec4(0.98, 1.00, 0.40, 1.0) },
  stop1: { enabled: true, percent: 0.55, color: new vec4(0.72, 1.00, 0.25, 1.0) },
  stop2: { enabled: true, percent: 1.0,  color: new vec4(0.40, 0.90, 0.15, 1.0) },
}
const LIME_KNOB_ON: GradientParameters = {
  enabled: true, type: "Linear", start: new vec2(-1, 1), end: new vec2(1, -1),
  stop0: { enabled: true, percent: 0,    color: new vec4(0.90, 1.00, 0.05, 1.0) },
  stop1: { enabled: true, percent: 0.40, color: new vec4(0.55, 0.95, 0.05, 1.0) },
  stop2: { enabled: true, percent: 0.75, color: new vec4(0.25, 0.80, 0.10, 1.0) },
  stop3: { enabled: true, percent: 1.0,  color: new vec4(0.12, 0.55, 0.05, 1.0) },
}
const LIME_KNOB_ON_H: GradientParameters = {
  enabled: true, type: "Linear", start: new vec2(-1, 1), end: new vec2(1, -1),
  stop0: { enabled: true, percent: 0,    color: new vec4(0.98, 1.00, 0.40, 1.0) },
  stop1: { enabled: true, percent: 0.40, color: new vec4(0.72, 1.00, 0.25, 1.0) },
  stop2: { enabled: true, percent: 0.75, color: new vec4(0.40, 0.90, 0.15, 1.0) },
  stop3: { enabled: true, percent: 1.0,  color: new vec4(0.20, 0.70, 0.08, 1.0) },
}

// ─── Style registry ───────────────────────────────────────────────────────────
type SwitchStylePreset = {
  trackOffGrad: GradientParameters
  trackOnGrad: GradientParameters
  trackOnHoveredGrad: GradientParameters
  fillOffGrad: GradientParameters
  fillOnGrad: GradientParameters
  fillOnHoveredGrad: GradientParameters
  knobOnGrad: GradientParameters
  knobOnHoveredGrad: GradientParameters
  border: vec4
  borderH: vec4
}

const PRESETS: SwitchStylePreset[] = [
  /* 0 Candy */ {
    trackOffGrad: CANDY_TRACK_OFF, trackOnGrad: CANDY_TRACK_ON, trackOnHoveredGrad: CANDY_TRACK_ON_H,
    fillOffGrad:  CANDY_FILL_OFF,  fillOnGrad:  CANDY_FILL_ON,  fillOnHoveredGrad:  CANDY_FILL_ON_H,
    knobOnGrad:   CANDY_KNOB_ON,   knobOnHoveredGrad: CANDY_KNOB_ON_H,
    border: new vec4(1.00, 1.00, 1.00, 0.70), borderH: new vec4(1.00, 0.85, 0.95, 1.0),
  },
  /* 1 Ocean */ {
    trackOffGrad: OCEAN_TRACK_OFF, trackOnGrad: OCEAN_TRACK_ON, trackOnHoveredGrad: OCEAN_TRACK_ON_H,
    fillOffGrad:  OCEAN_FILL_OFF,  fillOnGrad:  OCEAN_FILL_ON,  fillOnHoveredGrad:  OCEAN_FILL_ON_H,
    knobOnGrad:   OCEAN_KNOB_ON,   knobOnHoveredGrad: OCEAN_KNOB_ON_H,
    border: new vec4(0.30, 0.80, 1.00, 0.60), borderH: new vec4(0.55, 0.95, 1.00, 0.80),
  },
  /* 2 Lime  */ {
    trackOffGrad: LIME_TRACK_OFF,  trackOnGrad: LIME_TRACK_ON,  trackOnHoveredGrad: LIME_TRACK_ON_H,
    fillOffGrad:  LIME_FILL_OFF,   fillOnGrad:  LIME_FILL_ON,   fillOnHoveredGrad:  LIME_FILL_ON_H,
    knobOnGrad:   LIME_KNOB_ON,    knobOnHoveredGrad: LIME_KNOB_ON_H,
    border: new vec4(0.45, 0.88, 0.18, 0.80), borderH: new vec4(0.65, 1.00, 0.35, 0.90),
  },
]

/**
 * Applies a selectable gradient style to all three parts of a UIKit Switch:
 * track pill, trackFill, and knob — covering both OFF and ON (toggled) states.
 *
 * Two-path approach:
 *  A) onAwake:  replaces the track visual (with toggled states) before the Switch initializes
 *  B) onStart:  overrides knob and trackFill gradient properties via public API for all states,
 *               and re-applies track overrides as a guaranteed fallback
 *
 * Attach to the same SceneObject as the Switch component.
 */
@component
export class UIKitCustomVisualsSwitch extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">UIKitCustomVisualsSwitch – gradient style for a UIKit Switch</span><br/><span style="color: #94A3B8; font-size: 11px;">Styles the track, fill, and knob for both OFF and ON states. Attach to the same SceneObject as Switch.</span>')
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

  private _switch: Switch = null
  private _preset: SwitchStylePreset
  private logger: Logger

  onAwake() {
    // No Canvas created here — this script decorates an existing Switch on the
    // same SceneObject. The panel root that hosts the Switch must already have
    // a Component.Canvas in SortingType.Hierarchy (UIKit default) so DFS owns
    // paint order. No `renderOrder` anywhere.
    this.logger = new Logger("UIKitCustomVisualsSwitch", this.enableLogging || this.enableLoggingLifecycle, true)
    if (this.enableLoggingLifecycle) this.logger.debug("LIFECYCLE: onAwake()")

    this._switch = this.sceneObject.getComponent(Switch.getTypeName()) as Switch
    if (!this._switch) {
      this.logger.error("Switch component not found on this SceneObject")
      return
    }

    this._preset = PRESETS[Math.max(0, Math.min(PRESETS.length - 1, this.styleIndex))]
    const p = this._preset

    // Path A — replace track visual (with toggled states) before initialization
    const trackStyle: Partial<Record<StateName, RoundedRectangleVisualState>> = {
      default:          { hasBorder: true, borderSize: 0.08, borderType: "Color", borderColor: p.border,  baseGradient: p.trackOffGrad       },
      hovered:          { hasBorder: true, borderSize: 0.08, borderType: "Color", borderColor: p.borderH, baseGradient: p.trackOffGrad       },
      triggered:        { hasBorder: true, borderSize: 0.10, borderType: "Color", borderColor: p.border,  baseGradient: p.trackOffGrad       },
      toggledDefault:   { hasBorder: true, borderSize: 0.08, borderType: "Color", borderColor: p.border,  baseGradient: p.trackOnGrad        },
      toggledHovered:   { hasBorder: true, borderSize: 0.08, borderType: "Color", borderColor: p.borderH, baseGradient: p.trackOnHoveredGrad },
      toggledTriggered: { hasBorder: true, borderSize: 0.10, borderType: "Color", borderColor: p.border,  baseGradient: p.trackOnGrad        },
    }
    const customTrackVisual = new RoundedRectangleVisual({ sceneObject: this._switch.sceneObject, style: trackStyle })
    this._switch.visual = customTrackVisual
    this._switch.initialize()

    this.logger.info("Track visual applied (Path A) with style index " + this.styleIndex)
  }

  @bindStartEvent
  onStart() {
    if (this.enableLoggingLifecycle) this.logger.debug("LIFECYCLE: onStart()")
    if (!this._switch) return

    const p = this._preset

    // Track — guaranteed fallback for all 6 states
    const track = this._switch.visual as RoundedRectangleVisual
    if (track) {
      track.defaultBaseType          = "Gradient"
      track.hoveredBaseType          = "Gradient"
      track.triggeredBaseType        = "Gradient"
      track.toggledDefaultBaseType   = "Gradient"
      track.toggledHoveredBaseType   = "Gradient"
      track.toggledTriggeredBaseType = "Gradient"

      track.defaultGradient          = p.trackOffGrad
      track.hoveredGradient          = p.trackOffGrad
      track.triggeredGradient        = p.trackOffGrad
      track.toggledDefaultGradient   = p.trackOnGrad
      track.toggledHoveredGradient   = p.trackOnHoveredGrad
      track.toggledTriggeredGradient = p.trackOnGrad

      track.defaultHasBorder          = true
      track.hoveredHasBorder          = true
      track.triggeredHasBorder        = true
      track.toggledDefaultHasBorder   = true
      track.toggledHoveredHasBorder   = true
      track.toggledTriggeredHasBorder = true

      track.defaultBorderSize          = 0.08
      track.hoveredBorderSize          = 0.08
      track.triggeredBorderSize        = 0.10
      track.toggledDefaultBorderSize   = 0.08

      track.defaultBorderType          = "Color"
      track.hoveredBorderType          = "Color"
      track.triggeredBorderType        = "Color"
      track.toggledDefaultBorderType   = "Color"

      track.borderDefaultColor          = p.border
      track.borderHoveredColor          = p.borderH
      track.borderTriggeredColor        = p.border
      track.borderToggledDefaultColor   = p.border
      track.borderToggledHoveredColor   = p.borderH
      track.borderToggledTriggeredColor = p.border
    } else {
      this.logger.warn("Track visual not available in onStart")
    }

    // TrackFill — OFF and ON states
    const fill = this._switch.trackFillVisual as RoundedRectangleVisual
    if (fill) {
      fill.defaultBaseType          = "Gradient"
      fill.hoveredBaseType          = "Gradient"
      fill.triggeredBaseType        = "Gradient"
      fill.toggledDefaultBaseType   = "Gradient"
      fill.toggledHoveredBaseType   = "Gradient"
      fill.toggledTriggeredBaseType = "Gradient"

      fill.defaultGradient          = p.fillOffGrad
      fill.hoveredGradient          = p.fillOffGrad
      fill.triggeredGradient        = p.fillOffGrad
      fill.toggledDefaultGradient   = p.fillOnGrad
      fill.toggledHoveredGradient   = p.fillOnHoveredGrad
      fill.toggledTriggeredGradient = p.fillOnGrad
    } else {
      this.logger.warn("TrackFill visual not available in onStart")
    }

    // Knob — shared neutral OFF state, style-specific ON state
    const knob = this._switch.knobVisual as RoundedRectangleVisual
    if (knob) {
      knob.defaultBaseType          = "Gradient"
      knob.hoveredBaseType          = "Gradient"
      knob.triggeredBaseType        = "Gradient"
      knob.toggledDefaultBaseType   = "Gradient"
      knob.toggledHoveredBaseType   = "Gradient"
      knob.toggledTriggeredBaseType = "Gradient"

      knob.defaultGradient          = KNOB_OFF
      knob.hoveredGradient          = KNOB_OFF_H
      knob.triggeredGradient        = KNOB_OFF
      knob.toggledDefaultGradient   = p.knobOnGrad
      knob.toggledHoveredGradient   = p.knobOnHoveredGrad
      knob.toggledTriggeredGradient = p.knobOnGrad

      knob.defaultHasBorder          = true
      knob.hoveredHasBorder          = true
      knob.triggeredHasBorder        = true
      knob.toggledDefaultHasBorder   = true
      knob.toggledHoveredHasBorder   = true
      knob.toggledTriggeredHasBorder = true

      knob.defaultBorderSize   = 0.08
      knob.hoveredBorderSize   = 0.08
      knob.triggeredBorderSize = 0.10

      knob.defaultBorderType          = "Color"
      knob.hoveredBorderType          = "Color"
      knob.triggeredBorderType        = "Color"
      knob.toggledDefaultBorderType   = "Color"

      knob.borderDefaultColor          = p.border
      knob.borderHoveredColor          = p.borderH
      knob.borderTriggeredColor        = p.border
      knob.borderToggledDefaultColor   = p.border
      knob.borderToggledHoveredColor   = p.borderH
      knob.borderToggledTriggeredColor = p.border
    } else {
      this.logger.warn("Knob visual not available in onStart")
    }

    this.logger.info("All Switch visuals styled (Path B) with style index " + this.styleIndex)
  }
}
