// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

import { Logger } from "Utilities.lspkg/Scripts/Utils/Logger";
import { bindStartEvent, bindUpdateEvent, bindLateUpdateEvent, bindDestroyEvent } from "SnapDecorators.lspkg/decorators";

/**
 * Specs Inc. 2026
 * API credentials manager for Remote Service Gateway. Securely stores and provides access to
 * API tokens for Snap, OpenAI, and Google services used in remote AI service integrations.
 */
export enum AvaliableApiTypes {
  Snap = "Snap",
  OpenAI = "OpenAI",
  Google = "Google",
}

@component
export class RemoteServiceGatewayCredentials extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">API Credentials</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Enter your API tokens for each service provider</span>')

  @input
  @label("OpenAI Token")
  openAIToken: string = "[INSERT OPENAI TOKEN HERE]";
  @input
  @label("Google Token")
  googleToken: string = "[INSERT GOOGLE TOKEN HERE]";
  @input
  @label("Snap Token")
  snapToken: string = "[INSERT SNAP TOKEN HERE]";

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Logging Configuration</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Control logging output for this script instance</span>')

  @input
  @hint("Enable general logging (animation cycles, events, etc.)")
  enableLogging: boolean = false;

  @input
  @hint("Enable lifecycle logging (onAwake, onStart, onUpdate, onDestroy, etc.)")
  enableLoggingLifecycle: boolean = false;

  // Logger instance
  private logger: Logger;  @ui.label(
    '<span style="color: red;">⚠️ Do not include your API token when sharing or uploading this project to version control.</span>'
  )
  @ui.label(
    'For setup instructions, please visit: <a href="https://developers.snap.com/spectacles/about-spectacles-features/apis/remoteservice-gateway#setup-instructions" target="_blank">Remote Service Gateway Setup</a>'
  )
  private static snapToken: string = "";
  private static googleToken: string = "";
  private static openAIToken: string = "";  /**
   * Called when component is initialized
   */
  onAwake(): void {
    // Initialize logger
    this.logger = new Logger("RemoteServiceGatewayCredentials", this.enableLogging || this.enableLoggingLifecycle, true);

    if (this.enableLoggingLifecycle) {
      this.logger.debug("LIFECYCLE: onAwake() - Component initializing");
    }


    RemoteServiceGatewayCredentials.snapToken = this.snapToken;
    RemoteServiceGatewayCredentials.googleToken = this.googleToken;
    RemoteServiceGatewayCredentials.openAIToken = this.openAIToken;
  }

  static getApiToken(avaliableType: AvaliableApiTypes) {
    switch (avaliableType) {
      case AvaliableApiTypes.Snap:
        return RemoteServiceGatewayCredentials.snapToken;
      case AvaliableApiTypes.Google:
        return RemoteServiceGatewayCredentials.googleToken;
      case AvaliableApiTypes.OpenAI:
        return RemoteServiceGatewayCredentials.openAIToken;
      default:
        return "";
    }
  }

  static setApiToken(avaliableType: AvaliableApiTypes, token: string) {
    switch (avaliableType) {
      case AvaliableApiTypes.Snap:
        RemoteServiceGatewayCredentials.snapToken = token;
        break;
    }
  }
}
