// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * Displays one leaderboard row. Implements bind(entry) for LeaderboardRowInstantiator.
 */
import { Logger } from "Utilities.lspkg/Scripts/Utils/Logger";

/** Data for a single leaderboard row (rank, display name, score). */
export type LeaderboardEntryUI = {
  rank: number;
  displayname: string;
  score: number;
};

@component
export class LeaderboardRowItem extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA; font-weight: bold;">Text targets</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">SceneObjects with Text component for rank, display name, and score. Used by bind(entry).</span>')
  @input
  @hint("SceneObject with Text component for rank display (e.g. #1)")
  @allowUndefined
  rankText: SceneObject;

  @input
  @hint("SceneObject with Text component for display name")
  @allowUndefined
  displaynameText: SceneObject;

  @input
  @hint("SceneObject with Text component for score")
  @allowUndefined
  scoreText: SceneObject;

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Logging Configuration</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Control logging output for this script instance</span>')

  @input
  @hint("Enable general logging (animation cycles, events, etc.)")
  enableLogging: boolean = false;

  @input
  @hint("Enable lifecycle logging (onAwake, onStart, onUpdate, onDestroy, etc.)")
  enableLoggingLifecycle: boolean = false;

  private logger: Logger;

  /** Initializes logger. Called when component is created. */
  onAwake(): void {
    this.logger = new Logger("LeaderboardRowItem", this.enableLogging || this.enableLoggingLifecycle, true);
    if (this.enableLoggingLifecycle) {
      this.logger.debug("LIFECYCLE: onAwake() - LeaderboardRowItem initializing");
    }
  }

  /** Public API: Updates rank, name, and score text from entry. Called by LeaderboardRowInstantiator.render(). */
  bind(entry: LeaderboardEntryUI): void {
    const scoreVal = entry.score != null ? Number(entry.score) : 0;
    const scoreStr = String(scoreVal);
    const rank = entry.rank != null ? entry.rank : 0;
    this.setTextSafe(this.rankText, `#${rank}`);
    this.setTextSafe(this.displaynameText, entry.displayname || "---");
    this.setTextSafe(this.scoreText, scoreStr);
  }

  /**
   * Sets Text component text if obj and component exist; no-op otherwise.
   * @param obj - SceneObject with a Text component (may be undefined)
   * @param value - String to set on the Text component
   */
  private setTextSafe(obj: SceneObject | undefined, value: string): void {
    if (!obj) return;
    const textComponent = obj.getComponent("Component.Text");
    if (textComponent) {
      textComponent.text = value != null ? String(value) : "";
    }
  }
}
