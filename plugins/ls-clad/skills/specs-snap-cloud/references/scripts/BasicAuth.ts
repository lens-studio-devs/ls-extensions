// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * Basic Snap Cloud authentication example using Snapchat provider. Demonstrates Supabase client
 * initialization, user sign-in with ID token, session management, and authentication verification
 * for connected experiences.
 */
import {createClient, SupabaseClient} from "SupabaseClient.lspkg/supabase-snapcloud"
import { Logger } from "Utilities.lspkg/Scripts/Utils/Logger";
import {SnapCloudRequirements} from "../SnapCloudRequirements"

@component
export class BasicAuth extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Supabase Configuration</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Supabase project for authentication</span>')

  @input
  @allowUndefined
  @hint("SnapCloudRequirements component holding the Supabase project")
  snapCloudRequirements: SnapCloudRequirements

  @input
  @allowUndefined
  @hint("Deprecated: use snapCloudRequirements. Only read when snapCloudRequirements isn't wired.")
  supabaseProject: SupabaseProject

  private client: SupabaseClient
  private uid

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => {
      this.onStart()
    })
  }

  onStart() {
    this.initSupabase()
  }

  /** The project from SnapCloudRequirements, or the deprecated supabaseProject input when it isn't wired. */
  private getSupabaseProject(): SupabaseProject | undefined {
    if (this.snapCloudRequirements) {
      return this.snapCloudRequirements.isConfigured() ? this.snapCloudRequirements.getSupabaseProject() : undefined
    }
    return this.supabaseProject
  }

  async initSupabase() {
    const supabaseProject = this.getSupabaseProject()
    if (!supabaseProject) {
      print("Supabase not configured: assign your project to SnapCloudRequirements")
      return
    }
    print("Initializing Supabase client...")
    print("Project URL: " + supabaseProject.url)

    const options = {
      realtime: {
        // Temporary fix due to a known alpha limitation, set the heartbeatIntervalMs to 2500
        heartbeatIntervalMs: 2500
      }
    }

    this.client = createClient(supabaseProject.url, supabaseProject.publicToken, options)

    if (this.client) {
      print("Supabase client created successfully")
      await this.signInUser()
    } else {
      print("Failed to create Supabase client")
    }
  }

  async signInUser() {
    print("Attempting to sign in...")

    const {data, error} = await this.client.auth.signInWithIdToken({
      provider: "snapchat",
      token: ""
    })

    if (error) {
      print("Sign in FAILED: " + JSON.stringify(error))
      return
    }

    if (data && data.user) {
      const {user, session} = data
      this.uid = JSON.stringify(user.id).replace(/^"(.*)"$/, "$1")

      print("Sign in SUCCESS!")
      print("User ID: " + this.uid)
      print("User Email: " + (user.email || "N/A"))

      if (session) {
        print("Session Active: YES")
        print("Access Token (first 20 chars): " + session.access_token.substring(0, 20) + "...")
        print("Token Type: " + session.token_type)
        print("Expires At: " + new Date(session.expires_at * 1000).toISOString())
      } else {
        print("Session: No session data")
      }

      print("Authentication verified and ready!")
    } else {
      print("Sign in completed but no user data returned")
    }
  }

  onDestroy() {
    if (this.client) {
      this.client.removeAllChannels()
    }
  }
}
