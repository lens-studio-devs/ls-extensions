// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * Centralized Snap Cloud requirements manager for Supabase integration. Validates configuration,
 * provides convenience methods for REST/Storage/Functions API access, manages credentials, and
 * displays setup instructions for connected cloud experiences.
 */
import {Logger} from "Utilities.lspkg/Scripts/Utils/Logger"
import {bindStartEvent, bindUpdateEvent, bindLateUpdateEvent, bindDestroyEvent} from "SnapDecorators.lspkg/decorators"

@component
export class SnapCloudRequirements extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Supabase Configuration</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Centralized Supabase project settings for all Snap Cloud examples</span>')

  @input
  @hint("SupabaseProject asset from Asset Browser (created via Supabase Plugin)")
  @allowUndefined
  public supabaseProject: SupabaseProject

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Warning & Debug Settings</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Configure warning display and debug logging options</span>')

  @input
  @allowUndefined
  @hint("Text component to display warning messages (optional)")
  public text: Text

  @input
  @hint("Disable warnings when requirements are properly set (auto-detected)")
  public disableWarningsWhenConfigured: boolean = true

  @input
  @hint("Show detailed setup instructions in console")
  public showSetupInstructions: boolean = true

  @input
  @hint("Enable debug logging")
  public enableDebugLogs: boolean = true

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Logging Configuration</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Control logging output for this script instance</span>')

  @input
  @hint("Enable general logging (animation cycles, events, etc.)")
  enableLogging: boolean = false

  @input
  @hint("Enable lifecycle logging (onAwake, onStart, onUpdate, onDestroy, etc.)")
  enableLoggingLifecycle: boolean = false

  // Logger instance
  private logger: Logger

  // Status tracking
  private isFullyConfigured: boolean = false
  private hasShownWarning: boolean = false
  private warningMessage: string = "Snap Cloud Requirements not configured! Please assign Supabase Project."

  /**
   * Called when component is initialized
   */
  onAwake(): void {
    // Initialize logger
    this.logger = new Logger("SnapCloudRequirements", this.enableLogging || this.enableLoggingLifecycle, true)

    if (this.enableLoggingLifecycle) {
      this.logger.debug("LIFECYCLE: onAwake() - Component initializing");
    }


    this.validateConfiguration()

    if (this.showSetupInstructions && !this.isFullyConfigured) {
      this.displaySetupInstructions()
    }

    this.createEvent("OnStartEvent").bind(() => {
      this.onStart()
    })
  }

  onStart() {
    if (this.isFullyConfigured) {
      this.log("SnapCloudRequirements fully configured and ready!")
      this.log(`Supabase Project: ${this.supabaseProject ? this.supabaseProject.url : "Missing"}`)

      // Disable text component when configured
      if (this.text) {
        this.text.enabled = false
      }
    } else {
      // Show warning on text component
      this.updateWarningText()
    }
  }

  /**
   * Validate that all required components are configured
   */
  private validateConfiguration(): void {
    const hasSupabaseProject = this.supabaseProject !== null && this.supabaseProject !== undefined

    this.isFullyConfigured = hasSupabaseProject

    if (!this.isFullyConfigured && !this.hasShownWarning) {
      this.showWarning()
      this.hasShownWarning = true
    } else if (this.isFullyConfigured && this.disableWarningsWhenConfigured) {
      this.log("All requirements configured - warnings disabled")
    }
  }

  /**
   * Display warning message when configuration is incomplete
   */
  private showWarning(): void {
    if (!(this.enableLogging || this.enableLoggingLifecycle)) {
      this.updateWarningText();
      return;
    }
    const warningPrefix = "SnapCloudRequirements Warning:"

    print("=".repeat(60))
    print(warningPrefix)
    print(this.warningMessage)
    print("")

    if (!this.supabaseProject) {
      print("Missing: Supabase Project")
      print("   → Create via Window > Supabase > Import Credentials")
    }

    print("For InternetModule, use in your script:")
    print("   private internetModule: InternetModule = require('LensStudio:InternetModule');")

    print("=".repeat(60))

    // Update text component with warning
    this.updateWarningText()
  }

  /**
   * Update warning text on Text component
   */
  private updateWarningText(): void {
    if (!this.text) {
      return
    }

    this.text.enabled = true

    let warningText = this.warningMessage + "\n\n"

    if (!this.supabaseProject) {
      warningText += "Missing: Supabase Project\n"
      warningText += "→ Create via Window > Supabase > Import Credentials"
    }

    this.text.text = warningText
  }

  /**
   * Display detailed setup instructions
   */
  private displaySetupInstructions(): void {
    if (!(this.enableLogging || this.enableLoggingLifecycle)) return;
    print("\nSnapCloudRequirements Setup Instructions:")
    print("─".repeat(60))
    print("")
    print("1. SUPABASE PROJECT:")
    print("   • Go to Window > Supabase")
    print("   • Login to Supabase Plugin")
    print("   • Create/Import a Supabase Project")
    print("   • Click 'Import Credentials' to create SupabaseProject asset")
    print("   • Drag the SupabaseProject asset to this script's input")
    print("")
    print("2. REFERENCE IN YOUR SCRIPTS:")
    print("   Add this to centralize Supabase Project:")
    print("")
    print("   @input")
    print("   public snapCloudRequirements: SnapCloudRequirements;")
    print("")
    print("3. INTERNET MODULE IN YOUR SCRIPTS:")
    print("   Add this directly in each script (no input needed):")
    print("")
    print("   private internetModule: InternetModule = require('LensStudio:InternetModule');")
    print("")
    print("4. USE IN YOUR CODE:")
    print("   const supabase = this.snapCloudRequirements.getSupabaseProject();")
    print("   const url = this.snapCloudRequirements.getRestApiUrl() + 'table_name';")
    print("   const response = await this.internetModule.fetch(url, {...});")
    print("")
    print("─".repeat(60))
    print("")
  }

  /**
   * PUBLIC API - Get Supabase Project
   * Other scripts can call this to get the configured Supabase Project
   */
  public getSupabaseProject(): SupabaseProject {
    if (!this.supabaseProject) {
      this.log("Supabase Project not configured!")
      if (!this.hasShownWarning) {
        this.showWarning()
        this.hasShownWarning = true
      }
    }
    return this.supabaseProject
  }

  /**
   * PUBLIC API - Check if all requirements are configured
   */
  public isConfigured(): boolean {
    return this.isFullyConfigured
  }

  /**
   * PUBLIC API - Get Supabase URL
   * Convenience method to get the Supabase project URL
   */
  public getSupabaseUrl(): string {
    if (!this.supabaseProject) {
      this.log("Cannot get URL - Supabase Project not configured!")
      return ""
    }
    return this.supabaseProject.url
  }

  /**
   * PUBLIC API - Get Supabase Public Token
   * Convenience method to get the Supabase public API token
   */
  public getSupabasePublicToken(): string {
    if (!this.supabaseProject) {
      this.log("Cannot get token - Supabase Project not configured!")
      return ""
    }
    return this.supabaseProject.publicToken
  }

  /**
   * PUBLIC API - Get HTTP headers for Supabase requests
   * Convenience method to get pre-configured headers
   */
  public getSupabaseHeaders(): {[key: string]: string} {
    if (!this.supabaseProject) {
      this.log("Cannot get headers - Supabase Project not configured!")
      return {}
    }

    return {
      "Content-Type": "application/json",
      apikey: this.supabaseProject.publicToken,
      Authorization: `Bearer ${this.supabaseProject.publicToken}`
    }
  }

  /**
   * PUBLIC API - Get Storage API URL
   * Convenience method to get the Supabase Storage base URL
   */
  public getStorageApiUrl(): string {
    if (!this.supabaseProject) {
      this.log("Cannot get Storage URL - Supabase Project not configured!")
      return ""
    }
    return this.supabaseProject.url.replace(/\/$/, "") + "/storage/v1/object/public/"
  }

  /**
   * PUBLIC API - Get REST API URL
   * Convenience method to get the Supabase REST API base URL
   */
  public getRestApiUrl(): string {
    if (!this.supabaseProject) {
      this.log("Cannot get REST URL - Supabase Project not configured!")
      return ""
    }
    return this.supabaseProject.url.replace(/\/$/, "") + "/rest/v1/"
  }

  /**
   * PUBLIC API - Get Functions API URL
   * Convenience method to get the Supabase Edge Functions base URL
   */
  public getFunctionsApiUrl(): string {
    if (!this.supabaseProject) {
      this.log("Cannot get Functions URL - Supabase Project not configured!")
      return ""
    }
    return this.supabaseProject.url.replace(/\/$/, "") + "/functions/v1/"
  }

  /**
   * Logging helper
   */
  private log(message: string): void {
    if (this.enableLogging || this.enableLoggingLifecycle) {
      print(`[SnapCloudRequirements] ${message}`);
    }
  }

  /**
   * PUBLIC API - Enable/Disable debug logging at runtime
   */
  public setDebugLogging(enabled: boolean): void {
    this.enableDebugLogs = enabled
    this.log(`Debug logging ${enabled ? "enabled" : "disabled"}`)
  }

  /**
   * PUBLIC API - Manually trigger validation
   * Useful if configuration is set programmatically
   */
  public revalidate(): void {
    this.validateConfiguration()
  }
}
