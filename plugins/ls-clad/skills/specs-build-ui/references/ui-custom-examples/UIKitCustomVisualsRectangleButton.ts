// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * UIKitCustomVisualsRectangleButton – applies a selectable gradient style to a UIKit RectangleButton.
 */
import { Logger } from "Utilities.lspkg/Scripts/Utils/Logger"
import { bindStartEvent } from "SnapDecorators.lspkg/decorators"
import { RectangleButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton"
import {
  RoundedRectangleVisual,
  RoundedRectangleVisualState,
} from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangleVisual"
import { StateName } from "SpectaclesUIKit.lspkg/Scripts/Components/Element"
import { GradientParameters } from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle"

// ─── Style: Candy ─────────────────────────────────────────────────────────────
const CANDY_DEFAULT: GradientParameters = {
  enabled: true, type: "Linear", start: new vec2(0, 1), end: new vec2(0, -1),
  stop0: { enabled: true, percent: 0,    color: new vec4(1.00, 0.42, 0.71, 1.0) },
  stop1: { enabled: true, percent: 0.35, color: new vec4(0.88, 0.38, 0.82, 1.0) },
  stop2: { enabled: true, percent: 0.65, color: new vec4(0.55, 0.48, 0.90, 1.0) },
  stop3: { enabled: true, percent: 1.0,  color: new vec4(0.26, 0.72, 0.94, 1.0) },
}
const CANDY_HOVERED: GradientParameters = {
  enabled: true, type: "Linear", start: new vec2(0, 1), end: new vec2(0, -1),
  stop0: { enabled: true, percent: 0,    color: new vec4(1.00, 0.60, 0.82, 1.0) },
  stop1: { enabled: true, percent: 0.40, color: new vec4(0.68, 0.60, 0.96, 1.0) },
  stop2: { enabled: true, percent: 0.75, color: new vec4(0.68, 0.60, 0.96, 1.0) },
  stop3: { enabled: true, percent: 1.0,  color: new vec4(0.48, 0.82, 0.98, 1.0) },
}

// ─── Style: Ocean ─────────────────────────────────────────────────────────────
const OCEAN_DEFAULT: GradientParameters = {
  enabled: true, type: "Radial", start: new vec2(0, 0), end: new vec2(1, 0),
  stop0: { enabled: true, percent: 0,    color: new vec4(0.55, 0.95, 1.00, 0.85) },
  stop1: { enabled: true, percent: 0.40, color: new vec4(0.10, 0.55, 0.90, 0.80) },
  stop2: { enabled: true, percent: 0.75, color: new vec4(0.02, 0.22, 0.52, 0.85) },
  stop3: { enabled: true, percent: 1.0,  color: new vec4(0.00, 0.08, 0.28, 0.90) },
}
const OCEAN_HOVERED: GradientParameters = {
  enabled: true, type: "Radial", start: new vec2(0, 0), end: new vec2(1, 0),
  stop0: { enabled: true, percent: 0,    color: new vec4(0.78, 1.00, 1.00, 0.90) },
  stop1: { enabled: true, percent: 0.40, color: new vec4(0.22, 0.72, 0.98, 0.85) },
  stop2: { enabled: true, percent: 0.75, color: new vec4(0.05, 0.32, 0.68, 0.85) },
  stop3: { enabled: true, percent: 1.0,  color: new vec4(0.00, 0.12, 0.36, 0.90) },
}

// ─── Style: Lime ──────────────────────────────────────────────────────────────
const LIME_DEFAULT: GradientParameters = {
  enabled: true, type: "Linear", start: new vec2(0, 1), end: new vec2(0, -1),
  stop0: { enabled: true, percent: 0,    color: new vec4(0.90, 1.00, 0.05, 1.0) },
  stop1: { enabled: true, percent: 0.35, color: new vec4(0.55, 0.95, 0.05, 1.0) },
  stop2: { enabled: true, percent: 0.65, color: new vec4(0.25, 0.80, 0.10, 1.0) },
  stop3: { enabled: true, percent: 1.0,  color: new vec4(0.12, 0.55, 0.05, 1.0) },
}
const LIME_HOVERED: GradientParameters = {
  enabled: true, type: "Linear", start: new vec2(0, 1), end: new vec2(0, -1),
  stop0: { enabled: true, percent: 0,    color: new vec4(0.98, 1.00, 0.40, 1.0) },
  stop1: { enabled: true, percent: 0.40, color: new vec4(0.72, 1.00, 0.25, 1.0) },
  stop2: { enabled: true, percent: 0.75, color: new vec4(0.40, 0.90, 0.15, 1.0) },
  stop3: { enabled: true, percent: 1.0,  color: new vec4(0.20, 0.70, 0.08, 1.0) },
}

// ─── Style registry ───────────────────────────────────────────────────────────
type StylePreset = {
  defaultGrad: GradientParameters
  hoveredGrad: GradientParameters
  border: vec4
  borderH: vec4
}

const PRESETS: StylePreset[] = [
  /* 0 Candy */ {
    defaultGrad: CANDY_DEFAULT, hoveredGrad: CANDY_HOVERED,
    border: new vec4(1.00, 1.00, 1.00, 0.70), borderH: new vec4(1.00, 0.85, 0.95, 1.0),
  },
  /* 1 Ocean */ {
    defaultGrad: OCEAN_DEFAULT, hoveredGrad: OCEAN_HOVERED,
    border: new vec4(0.30, 0.80, 1.00, 0.60), borderH: new vec4(0.55, 0.95, 1.00, 0.80),
  },
  /* 2 Lime  */ {
    defaultGrad: LIME_DEFAULT,  hoveredGrad: LIME_HOVERED,
    border: new vec4(0.45, 0.88, 0.18, 0.80), borderH: new vec4(0.65, 1.00, 0.35, 0.90),
  },
]

/**
 * Applies a selectable gradient style to a UIKit RectangleButton.
 *
 * Two-path approach handles both pre-initialized and not-yet-initialized buttons:
 *  A) onAwake:  sets a custom RoundedRectangleVisual before the button auto-initializes
 *  B) onStart:  overrides the visual's gradient via public API as a guaranteed fallback
 *
 * Attach to the same SceneObject as the RectangleButton component.
 */
@component
export class UIKitCustomVisualsRectangleButton extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">UIKitCustomVisualsRectangleButton – gradient style for a UIKit RectangleButton</span><br/><span style="color: #94A3B8; font-size: 11px;">Replaces the default visual with a custom gradient. Attach to the same SceneObject as RectangleButton.</span>')
  @ui.separator

  @input("int")
  @hint("Visual style preset applied to the button: Candy = pink/blue, Ocean = teal/navy radial, Lime = yellow/green")
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

  private _button: RectangleButton = null
  private _preset: StylePreset
  private logger: Logger

  onAwake() {
    // No Canvas created here — this script decorates an existing RectangleButton
    // on the same SceneObject. The panel root that hosts the button must already
    // have a Component.Canvas in SortingType.Hierarchy (UIKit default) so DFS
    // owns paint order. No `renderOrder` anywhere.
    this.logger = new Logger("UIKitCustomVisualsRectangleButton", this.enableLogging || this.enableLoggingLifecycle, true)
    if (this.enableLoggingLifecycle) this.logger.debug("LIFECYCLE: onAwake()")

    this._button = this.sceneObject.getComponent(RectangleButton.getTypeName()) as RectangleButton
    if (!this._button) {
      this.logger.error("RectangleButton component not found on this SceneObject")
      return
    }

    this._preset = PRESETS[Math.max(0, Math.min(PRESETS.length - 1, this.styleIndex))]
    const p = this._preset

    // Path A — set visual before the button's own OnStartEvent fires
    const style: Partial<Record<StateName, RoundedRectangleVisualState>> = {
      default:   { hasBorder: true, borderSize: 0.08, borderType: "Color", borderColor: p.border,  baseGradient: p.defaultGrad },
      hovered:   { hasBorder: true, borderSize: 0.08, borderType: "Color", borderColor: p.borderH, baseGradient: p.hoveredGrad },
      triggered: { hasBorder: true, borderSize: 0.10, borderType: "Color", borderColor: p.border,  baseGradient: p.defaultGrad },
    }
    const customVisual = new RoundedRectangleVisual({ sceneObject: this._button.sceneObject, style })
    this._button.visual = customVisual
    this._button.initialize()

    this.logger.info("Custom visual applied (Path A) with style index " + this.styleIndex)
  }

  @bindStartEvent
  onStart() {
    if (this.enableLoggingLifecycle) this.logger.debug("LIFECYCLE: onStart()")
    if (!this._button) return

    const p = this._preset

    // Path B — guaranteed override via public API regardless of initialization timing
    const vis = this._button.visual as RoundedRectangleVisual
    if (!vis) {
      this.logger.warn("RoundedRectangleVisual not available on button in onStart")
      return
    }

    vis.defaultBaseType   = "Gradient"
    vis.hoveredBaseType   = "Gradient"
    vis.triggeredBaseType = "Gradient"

    vis.defaultGradient   = p.defaultGrad
    vis.hoveredGradient   = p.hoveredGrad
    vis.triggeredGradient = p.defaultGrad

    vis.defaultHasBorder   = true
    vis.hoveredHasBorder   = true
    vis.triggeredHasBorder = true

    vis.defaultBorderSize   = 0.08
    vis.hoveredBorderSize   = 0.08
    vis.triggeredBorderSize = 0.10

    vis.defaultBorderType   = "Color"
    vis.hoveredBorderType   = "Color"
    vis.triggeredBorderType = "Color"

    vis.borderDefaultColor   = p.border
    vis.borderHoveredColor   = p.borderH
    vis.borderTriggeredColor = p.border

    this.logger.info("Custom visual confirmed (Path B) with style index " + this.styleIndex)
  }
}
