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

@component
export class BasicAuth extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Supabase Configuration</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Supabase project for authentication</span>')

  @input
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

  async initSupabase() {
    print("Initializing Supabase client...")
    print("Project URL: " + this.supabaseProject.url)

    const options = {
      realtime: {
        // Temporary fix due to a known alpha limitation, set the heartbeatIntervalMs to 2500
        heartbeatIntervalMs: 2500
      }
    }

    this.client = createClient(this.supabaseProject.url, this.supabaseProject.publicToken, options)

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
