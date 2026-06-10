// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * Example game: countdown timer, pinch-to-increment score, submit to leaderboard on game end.
 * Toggles between game UI and leaderboard UI. Assign globalLeaderboard for score submission.
 */
import { bindUpdateEvent } from "SnapDecorators.lspkg/decorators";
import { assert } from "SnapDecorators.lspkg/assert";
import { Logger } from "Utilities.lspkg/Scripts/Utils/Logger";
import { GlobalLeaderboard } from "./GlobalLeaderboard";

@component
export class PinchGameController extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA; font-weight: bold;">Game settings</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Timer duration and UI text components for countdown and score.</span>')
  @input
  @hint("Timer duration in seconds for each game round")
  countdownSeconds: number = 10;

  @input
  @hint("Text component displaying the countdown timer")
  countdownText: Text;

  @input
  @hint("Text component displaying the current score")
  scoreText: Text;

  @ui.separator
  @ui.label('<span style="color: #60A5FA; font-weight: bold;">Leaderboard</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Required for score submission. UI roots toggle game vs leaderboard visibility at end of round.</span>')
  @input
  @hint("Assign the SceneObject that has the GlobalLeaderboard script (or the script component)")
  globalLeaderboard: GlobalLeaderboard;

  @input
  @hint("SceneObject root for game UI (timer, score). If unset, this component's SceneObject is toggled.")
  @allowUndefined
  gameUIRoot: SceneObject;

  @input
  @hint("SceneObject root for controls UI (description, Start button). Shown on awake, hidden when game starts.")
  @allowUndefined
  controlsUIRoot: SceneObject;

  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Used when SnapchatUser is unavailable (e.g. in editor)</span>')
  @input
  @hint("Fallback display name when SnapchatUser is unavailable (e.g. in editor). Leaderboard uses SnapchatUser when available.")
  displayName: string = "Player";

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Logging Configuration</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Control logging output for this script instance</span>')

  @input
  @hint("Enable general logging (game events, submit activity, etc.)")
  enableLogging: boolean = false;

  @input
  @hint("Enable lifecycle logging (onAwake, onStart, onUpdate, onDestroy, etc.)")
  enableLoggingLifecycle: boolean = false;

  private logger: Logger;
  private remainingTime: number = 0;
  private score: number = 0;
  private isRunning: boolean = false;

  /** Initializes logger, validates required inputs, and resets UI. Called when component is created. */
  onAwake(): void {
    this.logger = new Logger("PinchGameController", this.enableLogging || this.enableLoggingLifecycle, true);
    if (this.enableLoggingLifecycle) {
      this.logger.debug("LIFECYCLE: onAwake() - PinchGameController initializing");
    }
    assert(this.globalLeaderboard != null, "globalLeaderboard must be assigned");
    assert(this.countdownText != null, "countdownText must be assigned");
    assert(this.scoreText != null, "scoreText must be assigned");
    this.resetUI();
  }

  /**
   * Public API: Starts a new game round. Call this from a button's onTriggerUp (e.g. Start Game button).
   * Enables game UI, resets timer and score, enables update loop. Does not auto-run on scene start.
   */
  public startGame(): void {
    if (this.enableLogging) {
      this.logger.info("Starting game");
    }

    const controlsRoot = this.controlsUIRoot;
    if (controlsRoot) controlsRoot.enabled = false;
    const leaderboardRoot = this.getLeaderboardUIRoot();
    if (leaderboardRoot) leaderboardRoot.enabled = false;
    const gameRoot = this.getGameUIRoot();
    if (gameRoot) gameRoot.enabled = true;

    this.remainingTime = this.countdownSeconds;
    this.score = 0;
    this.isRunning = true;

    this.updateCountdownText();
    this.updateScoreText();
  }

  /** Disables game and leaderboard UI roots, enables controls root. Called on awake. */
  private resetUI(): void {
    const leaderboardRoot = this.getLeaderboardUIRoot();
    if (leaderboardRoot) leaderboardRoot.enabled = false;
    const gameRoot = this.getGameUIRoot();
    if (gameRoot) gameRoot.enabled = false;
    const controlsRoot = this.controlsUIRoot;
    if (controlsRoot) controlsRoot.enabled = true;
    this.remainingTime = this.countdownSeconds;
    this.score = 0;
    this.isRunning = false;
    this.updateCountdownText();
    this.updateScoreText();
  }

  /** Increments score when user pinches during an active game. */
  onPinched(): void {
    if (!this.isRunning) return;

    this.score++;
    this.updateScoreText();
  }

  /**
   * Decrements timer and ends game when time runs out. No-op when game is not running.
   * Automatically bound to UpdateEvent via SnapDecorators.
   */
  @bindUpdateEvent
  private onUpdate(): void {
    if (!this.isRunning) return;

    this.remainingTime -= getDeltaTime();

    if (this.remainingTime <= 0) {
      this.remainingTime = 0;
      this.updateCountdownText();
      this.endGame();
      return;
    }

    this.updateCountdownText();
  }

  /** Ends the current round: submits score, shows leaderboard, hides game UI. */
  private endGame(): void {
    this.isRunning = false;

    const finalScore = this.score;
    if (this.enableLogging) {
      this.logger.info("Game ended. Final score = " + finalScore);
    }

    this.submitScoreToLeaderboard(finalScore);
    const leaderboardRoot = this.getLeaderboardUIRoot();
    const gameRoot = this.getGameUIRoot();
    const controlsRoot = this.controlsUIRoot;
    if (leaderboardRoot) leaderboardRoot.enabled = true;
    if (gameRoot) gameRoot.enabled = false;
    if (controlsRoot) controlsRoot.enabled = false;
  }

  /** Returns the game UI root (timer, score) or this component's SceneObject if unset. */
  private getGameUIRoot(): SceneObject | null {
    return this.gameUIRoot ?? this.getSceneObject();
  }

  /** Returns the leaderboard UI root (GlobalLeaderboard's SceneObject). */
  private getLeaderboardUIRoot(): SceneObject | null {
    return this.globalLeaderboard ? this.globalLeaderboard.getSceneObject() : null;
  }

  /** Submits final score to leaderboard via GlobalLeaderboard. Uses SnapchatUser display name when available. */
  private submitScoreToLeaderboard(scoreToSubmit: number): Promise<void> {
    if (this.enableLogging) {
      this.logger.info("submitScoreToLeaderboard called with score=" + scoreToSubmit);
    }
    if (!this.globalLeaderboard) {
      this.logger.warn("GlobalLeaderboard not assigned, skipping submit");
      return Promise.resolve();
    }
    if (!this.globalLeaderboard.isReady()) {
      if (this.enableLogging) {
        this.logger.debug("Skipping submit: Supabase not configured (assign your project to SnapCloudRequirements)");
      }
      return Promise.resolve();
    }

    return this.getSnapchatDisplayName()
      .then((names) => {
        const displayName = names.displayName;
        if (this.enableLogging) {
          this.logger.info("Submitting to leaderboard: score=" + scoreToSubmit + " displayname=" + displayName);
        }
        return this.globalLeaderboard!.submitScore(scoreToSubmit, displayName);
      })
      .then(() => {
        if (this.enableLogging) {
          this.logger.info("Score submitted and leaderboard refreshed");
        }
      })
      .catch((error: unknown) => {
        const msg = error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : String(error);
        this.logger.error("ERROR submitting score: " + msg);
        if (error && typeof error === "object" && "stack" in error) {
          this.logger.debug("stack: " + (error as { stack: unknown }).stack);
        }
      });
  }

  /**
   * Gets the current user's display name from SnapchatUser (displayName or displayname).
   * Falls back to scene input "displayName" or "Player" in editor or when unavailable.
   */
  private getSnapchatDisplayName(): Promise<{ displayName: string }> {
    const fallback = (this.displayName && this.displayName.trim().length > 0) ? this.displayName.trim() : "Player";

    if (!global.userContextSystem || typeof global.userContextSystem.requestDisplayName !== "function") {
      if (this.enableLogging) {
        this.logger.debug("No userContextSystem/requestDisplayName, using fallback: " + fallback);
      }
      return Promise.resolve({ displayName: fallback });
    }

    return new Promise((resolve) => {
      global.userContextSystem.requestDisplayName((displayName: string) => {
        const name = (displayName && displayName.trim().length > 0) ? displayName.trim() : null;
        const finalDisplayName = name ?? fallback;
        if (this.enableLogging) {
          this.logger.debug("requestDisplayName callback -> displayName=" + (displayName || "null") + " | using " + finalDisplayName);
        }
        resolve({ displayName: finalDisplayName });
      });
    });
  }

  /** Updates the countdown text component with remaining time. */
  private updateCountdownText(): void {
    const countdownTextComponent = this.countdownText;
    if (!countdownTextComponent) return;
    countdownTextComponent.text = "Timer: " + Math.ceil(this.remainingTime).toString();
  }

  /** Updates the score text component with current score. */
  private updateScoreText(): void {
    const scoreTextComponent = this.scoreText;
    if (!scoreTextComponent) return;
    scoreTextComponent.text = "Score: " + this.score.toString();
  }

}
