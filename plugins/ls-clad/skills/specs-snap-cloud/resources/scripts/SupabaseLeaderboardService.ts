// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * Supabase client and auth for leaderboard RPCs (submit_score, get_top_scores).
 * Manages session, sign-in with Snap ID token, and cleanup on destroy.
 */
import { bindStartEvent, bindDestroyEvent } from "SnapDecorators.lspkg/decorators";
import { Logger } from "Utilities.lspkg/Scripts/Utils/Logger";
import { SnapCloudRequirements } from "../../SnapCloudRequirements";
import { createClient, type SupabaseClient } from "SupabaseClient.lspkg/supabase-snapcloud";

/** Row shape returned by get_top_scores RPC. */
export type TopScoreRow = {
  displayname: string;
  score: number;
};

@component
export class SupabaseLeaderboardService extends BaseScriptComponent {

  @ui.separator
  @ui.label('<span style="color: #60A5FA; font-weight: bold;">Snap Cloud configuration</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Reference SnapCloudRequirements (Supabase project lives there). Required for submit_score and get_top_scores.</span>')
  @input
  @hint("Reference to SnapCloudRequirements for centralized Supabase configuration")
  @allowUndefined
  public snapCloudRequirements?: SnapCloudRequirements;

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Logging Configuration</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Control logging output for this script instance. Errors are always logged.</span>')

  @input
  @hint("Enable general logging (RPC calls, auth flow, etc.)")
  enableLogging: boolean = false;

  @input
  @hint("Enable lifecycle logging (onStart, cleanup, etc.)")
  enableLoggingLifecycle: boolean = false;

  private authed: boolean = false;
  private logger: Logger | null = null;
  private client: SupabaseClient | null = null;
  private initialized: boolean = false;

  /**
   * Called on the first frame when the scene starts. Initializes the logger.
   * Automatically bound to OnStartEvent via SnapDecorators.
   */
  @bindStartEvent
  private onStart(): void {
    this.ensureLogger();
    if (this.enableLoggingLifecycle) {
      this.ensureLogger().debug("LIFECYCLE: onStart() - SupabaseLeaderboardService initializing");
    }
  }

  /**
   * Cleans up client and channels. Called when the component is destroyed.
   * Automatically bound to OnDestroyEvent via SnapDecorators.
   */
  @bindDestroyEvent
  private cleanup(): void {
    if (this.enableLoggingLifecycle && this.logger) {
      this.logger.debug("LIFECYCLE: cleanup() - SupabaseLeaderboardService destroying");
    }
    try {
      this.client?.removeAllChannels?.();
    } catch (_) {}
    this.client = null;
  }

  /**
   * Ensures the logger is initialized. Called lazily in case init runs before onStart.
   */
  private ensureLogger(): Logger {
    if (!this.logger) {
      this.logger = new Logger("SupabaseLeaderboardService", this.enableLogging || this.enableLoggingLifecycle, true);
    }
    return this.logger;
  }

  /** Lazy init of Supabase client. No-op if SnapCloudRequirements missing/unconfigured or already initialized. */
  private init(): void {
    if (this.initialized) return;

    if (!this.snapCloudRequirements || !this.snapCloudRequirements.isConfigured()) {
      this.initialized = true;
      return;
    }

    const supabaseProject = this.snapCloudRequirements.getSupabaseProject();
    if (!supabaseProject) {
      this.initialized = true;
      return;
    }

    globalThis.supabaseModule = require("LensStudio:SupabaseModule");

    try {
      this.client = createClient(supabaseProject.url, supabaseProject.publicToken);
    } catch (error) {
      this.logError("Init failure: " + error);
      return;
    }

    this.initialized = true;

  }

  /** Ensures a valid session for submit_score. Throws if client not ready or auth fails. */
  private async ensureAuthed(): Promise<void> {
    this.init();

    if (!this.isReady()) {
      throw new Error("Supabase client not initialized");
    }

    // Use existing session if present
    try {
      const { data: sessionData, error: sessionErr } = await this.client!.auth.getSession();
      if (sessionErr) {
        this.logError("getSession error: " + sessionErr.message);
      }

      const session = sessionData?.session;
      if (session) {
        this.authed = true;
        return;
      }
    } catch (error) {
      this.logError("getSession threw: " + error);
    }

    // Otherwise sign in with Snap id token
    this.log("No session found, signing in with Snap id token...");
    const { data, error } = await this.client!.auth.signInWithIdToken({
      provider: "snapchat",
      token: "",
    });

    if (error) {
      this.authed = false;
      throw new Error("Auth error: " + error.message);
    }

    const hasSession = !!data?.session;
    this.authed = hasSession;

    this.log("Auth OK: " + (data?.user?.id || "no-id") + " session=" + (hasSession ? "yes" : "no"));

    if (!hasSession) {
      this.logError("Auth did not return a session (cannot call submit_score)");
      throw new Error("Auth did not return a session (cannot call submit_score)");
    }
  }

  /**
   * Logs a debug message when enableLogging is true.
   * @param msg - The message to log
   */
  private log(msg: string): void {
    if (this.enableLogging) {
      this.ensureLogger().debug(msg);
    }
  }

  /**
   * Logs an error message. Errors are always logged regardless of enableLogging.
   * @param msg - The error message to log
   */
  private logError(msg: string): void {
    if (this.enableLogging || this.enableLoggingLifecycle) {
      this.ensureLogger().error(msg);
    } else {
      print("[SupabaseLeaderboardService] " + msg);
    }
  }

  /** Public API: True when SnapCloudRequirements is wired and fully configured. Use this to decide whether to attempt RPCs. */
  isConfigured(): boolean {
    return !!(this.snapCloudRequirements && this.snapCloudRequirements.isConfigured());
  }

  /** Public API: True after init() succeeded and client is set. */
  isReady(): boolean {
    return this.initialized && !!this.client;
  }

  /** Public API: True after ensureAuthed() has established a session. */
  isAuthed(): boolean {
    return this.authed;
  }

  /**
   * Public API: Calls submit_score RPC. Requires auth (ensureAuthed). sortMode: "asc" or "desc".
   */
  public async submitScore(score: number, displayname: string, sortMode: string): Promise<void> {
    await this.ensureAuthed();

    const scoreNum = Number(score);
    if (isNaN(scoreNum)) {
      this.logError("submit_score aborted: invalid score " + score);
      throw new Error("Score must be a number");
    }

    this.log("submit_score calling RPC: score=" + scoreNum + " displayname=" + displayname + " sortMode=" + sortMode);

    const { error } = await this.client!.rpc("submit_score", {
      p_score: scoreNum,
      p_displayname: displayname,
      p_sort_mode: sortMode,
    });

    if (error) {
      this.logError("submit_score RPC error: " + error.message);
      throw new Error("submit_score failed: " + error.message);
    }

    this.log("submit_score ok: score=" + scoreNum + " displayname=" + displayname);
  }

  /**
   * Public API: Calls get_top_scores RPC. No auth required. sortMode: "asc" or "desc".
   */
  public async getTopScores(limit: number, sortMode: string): Promise<TopScoreRow[]> {
    this.init();

    if (!this.isReady())
      throw new Error("Supabase client not initialized");

    const { data, error } = await this.client!.rpc("get_top_scores", {
      p_limit: limit,
      p_sort_mode: sortMode,
    });

    if (error) {
      this.logError("get_top_scores RPC error: " + error.message);
      throw new Error("get_top_scores failed: " + error.message);
    }

    const rows = (data || []) as TopScoreRow[];

    this.log("get_top_scores returned " + rows.length + " rows");
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const keys = row ? Object.keys(row) : [];
      this.log("row[" + i + "] keys: " + keys.join(", ") + " | displayname=" + (row?.displayname) + " score=" + (row?.score));
    }

    return rows;
  }
}
