// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * Google Lyria API integration for AI-generated music and vocals. Provides access to Lyria models
 * for creating original music compositions and vocal performances through Google's Vertex AI platform
 * with error handling and response parsing.
 */
import {
  AvaliableApiTypes,
  RemoteServiceGatewayCredentials,
} from "../RemoteServiceGatewayCredentials";

import { GoogleGenAITypes } from "./GoogleGenAITypes";

const RSM_LYRIA = requireAsset(
  "./RemoteServiceModules/Lyria_Sync.remoteServiceModule"
) as RemoteServiceModule;

export class Lyria {
  /**
   * Perform a generic Lyria API request
   * @private
   * @param lyriaRequest The Lyria request object
   * @returns A promise that resolves with the Lyria response
   */
  public static performLyriaRequest(
    lyriaRequest: GoogleGenAITypes.Lyria.LyriaRequest
  ): Promise<GoogleGenAITypes.Lyria.LyriaResponse> {
    return new Promise((resolve, reject) => {
      const submitApiRequest = RemoteApiRequest.create();

      let apiToken;
      try {
        apiToken = RemoteServiceGatewayCredentials.getApiToken(
          AvaliableApiTypes.Google
        );
      } catch (error) {
        reject(
          new Error(
            "Lyria API token not configured. Please configure credentials for Lyria API."
          )
        );
        return;
      }

      submitApiRequest.endpoint = "lyria";
      submitApiRequest.parameters = {
        "api-token": apiToken,
        model: lyriaRequest.model,
        type: lyriaRequest.type,
      };

      const textBody = JSON.stringify(lyriaRequest.body);
      submitApiRequest.body = textBody;

      RSM_LYRIA.performApiRequest(submitApiRequest, (response) => {
        if (response.statusCode == 1) {
          try {
            const bodyJson = JSON.parse(
              response.body
            ) as GoogleGenAITypes.Lyria.LyriaResponse;
            resolve(bodyJson);
          } catch (parseError) {
            reject(
              new Error("Failed to parse Lyria API response: " + parseError)
            );
          }
        } else {
          print("Lyria API Error: " + response.body);
          print("Status code: " + response.statusCode);
          reject(new Error(response.body));
        }
      });
    });
  }
}
