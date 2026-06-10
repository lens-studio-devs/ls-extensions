// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * Google Imagen API integration for AI-powered image generation. Provides text-to-image generation
 * capabilities with customizable parameters including aspect ratio, watermarking, prompt enhancement,
 * and multi-language support through Google's Vertex AI Imagen models.
 */
import {
  AvaliableApiTypes,
  RemoteServiceGatewayCredentials,
} from "../RemoteServiceGatewayCredentials";

import { GoogleGenAITypes } from "./GoogleGenAITypes";

const RSM_IMAGEN = requireAsset(
  "./RemoteServiceModules/Imagen_Sync.remoteServiceModule"
) as RemoteServiceModule;

export class Imagen {
  /**
   * Edit images using the Imagen API (inpainting/outpainting)
   * @param request The image editing request
   * @returns A promise that resolves with the edited image
   */
  // Edit/upscale are currently not supported by the proxy contract; intentionally omitted

  /**
   * Perform a generic Imagen API request
   * @param imagenRequest The Imagen request object
   * @returns A promise that resolves with the Imagen response
   */
  static generateImage(
    imagenRequest: GoogleGenAITypes.Imagen.ImagenRequest
  ): Promise<GoogleGenAITypes.Imagen.ImagenResponse> {
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
            "Imagen API token not configured. Please configure credentials for Imagen API."
          )
        );
        return;
      }

      submitApiRequest.endpoint = "imagen";
      submitApiRequest.parameters = {
        "api-token": apiToken,
        model: imagenRequest.model,
      };
      submitApiRequest.body = JSON.stringify(imagenRequest.body);

      RSM_IMAGEN.performApiRequest(submitApiRequest, (response) => {
        if (response.statusCode == 1) {
          try {
            const bodyJson = JSON.parse(
              response.body
            ) as GoogleGenAITypes.Imagen.ImagenResponse;
            resolve(bodyJson);
          } catch (parseError) {
            reject(
              new Error("Failed to parse Imagen API response: " + parseError)
            );
          }
        } else {
          print("Imagen API Error: " + response.body);
          reject(new Error(response.body));
        }
      });
    });
  }
}
