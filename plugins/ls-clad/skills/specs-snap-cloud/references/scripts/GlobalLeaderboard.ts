// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * Main leaderboard controller: submit scores to Supabase, refresh list via get_top_scores,
 * and pass entries to rowInstantiator.render(). Assign supabaseService and rowInstantiator in the scene.
 * Supabase credentials flow: assign the project on SnapCloudRequirements, referenced by SupabaseLeaderboardService.
 */
import { bindStartEvent } from "SnapDecorators.lspkg/decorators";
import { assert } from "SnapDecorators.lspkg/assert";
import { Logger } from "Utilities.lspkg/Scripts/Utils/Logger";
import { SupabaseLeaderboardService, type TopScoreRow } from './SupabaseLeaderboardService';
import { LeaderboardRowInstantiator } from "./LeaderboardRowInstantiator";
import { LeaderboardEntryUI } from "./LeaderboardRowItem";

@component
export class GlobalLeaderboard extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA; font-weight: bold;">Required</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Assign both for submit and refresh to work.</span>')
  @input
  @hint("SupabaseLeaderboardService component for RPC calls (submit_score, get_top_scores)")
  supabaseService: SupabaseLeaderboardService;

  @input
  @hint("LeaderboardRowInstantiator that renders row entries")
  rowInstantiator: LeaderboardRowInstantiator;

  @ui.separator
  @ui.label('<span style="color: #60A5FA; font-weight: bold;">List options</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Sort order and how many rows to fetch and display.</span>')
  @input
  @hint("If true: lowest score ranks first (ascending). If false: highest score ranks first (descending).")
  ascending: boolean = true;

  @input
  @hint("Top N to show (10/20/30...). If DB has fewer, it will show fewer.")
  itemsCount: number = 10;

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Logging Configuration</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Control logging output for this script instance</span>')

  @input
  @hint("Enable general logging (refresh, submit activity, etc.)")
  enableLogging: boolean = false;

  @input
  @hint("Enable lifecycle logging (onAwake, onStart, onUpdate, onDestroy, etc.)")
  enableLoggingLifecycle: boolean = false;

  private logger: Logger;

  /** Initializes logger and validates required inputs. Called when component is created. */
  onAwake(): void {
    this.logger = new Logger("GlobalLeaderboard", this.enableLogging || this.enableLoggingLifecycle, true);
    if (this.enableLoggingLifecycle) {
      this.logger.debug("LIFECYCLE: onAwake() - GlobalLeaderboard initializing");
    }
    assert(this.supabaseService != null, "supabaseService must be assigned");
    assert(this.rowInstantiator != null, "rowInstantiator must be assigned");
  }

  /** Public API: True when your project is assigned on SnapCloudRequirements (via SupabaseLeaderboardService) so refresh/submit can run. Client init is lazy (runs on first RPC). */
  isReady(): boolean {
    return this.supabaseService != null && this.supabaseService.isConfigured();
  }

  /**
   * Called on the first frame when the scene starts. Triggers initial leaderboard refresh if the project is set on SnapCloudRequirements.
   * Automatically bound to OnStartEvent via SnapDecorators.
   */
  @bindStartEvent
  private onStart(): void {
    if (!this.isReady()) {
      const timestamp = new Date().toISOString().slice(11, 19);
      print(`${timestamp} | GlobalLeaderboard | Please assign your project to SnapCloudRequirements for the leaderboard to work`);
      return;
    }
    this.refresh().catch(error => this.logger.error("refresh error: " + (error && (error as Error).message ? (error as Error).message : String(error))));
  }

  /**
   * Returns sort mode string for Supabase RPC ("asc" or "desc").
   * @returns Sort mode based on ascending flag
   */
  private getSortMode(): string {
    return this.ascending ? "asc" : "desc";
  }

  /**
   * Public API: Call from the game (e.g. PinchGameController) when a round ends.
   * Submits score and displayName to Supabase (service handles init/auth) and refreshes the list.
   * @param score - The score to submit
   * @param displayName - The player's display name for the leaderboard
   */
  async submitScore(score: number, displayName: string): Promise<void> {
    if (!this.isReady()) {
      throw new Error("Supabase not configured (assign your project to SnapCloudRequirements)");
    }
    const scoreNum = Number(score);
    if (!Number.isFinite(scoreNum)) {
      const msg = "submitScore: invalid score " + score;
      this.logger.error(msg);
      throw new Error(msg);
    }
    const name = typeof displayName === "string" ? displayName.trim() : "";
    if (name.length === 0) {
      const msg = "submitScore: display name is required";
      this.logger.error(msg);
      throw new Error(msg);
    }
    await this.supabaseService.submitScore(scoreNum, name, this.getSortMode());
    await this.refresh();
  }

  /**
   * Public API: Can be called any time. Service init is done inside getTopScores.
   * Callers should handle rejection (e.g. .catch or try/catch around await).
   * No-op if your project is not set on SnapCloudRequirements (avoids "Supabase client not initialized" errors).
   */
  async refresh(): Promise<void> {
    if (!this.isReady() || !this.rowInstantiator) return;
    try {
      const rows = await this.supabaseService.getTopScores(this.itemsCount, this.getSortMode());
      const ui: LeaderboardEntryUI[] = rows.map((row: TopScoreRow, idx: number) => {
        const displayname = (row?.displayname) as string || "---";
        const scoreVal = Number(row?.score || 0);
        if (this.enableLogging) {
          this.logger.debug("refresh row " + idx + ": displayname=" + displayname + " score=" + scoreVal);
        }
        return {
          rank: idx + 1,
          displayname,
          score: scoreVal,
        };
      });

      if (this.enableLogging) {
        this.logger.info("refresh rendering " + ui.length + " items");
      }
      this.rowInstantiator.render(ui);
    } catch (error) {
      this.logger.error("refresh error: " + (error && (error as Error).message ? (error as Error).message : String(error)));
      throw error;
    }
  }
}
