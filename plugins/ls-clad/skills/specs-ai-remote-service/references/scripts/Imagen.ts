// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * SPECS Inc. 2027
 * Google Imagen API integration for AI-powered image generation. Provides text-to-image generation
 * capabilities through the Remote Service Gateway "imagen" route. The route serves the Gemini image
 * models (gemini-3.1-flash-image, gemini-3.1-flash-lite-image) with generateContent requests; the
 * older Imagen predict models are no longer available.
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
   * Generate an image with a Gemini image model through the Imagen route.
   * The image comes back as an inlineData part in candidates[].content.parts[].
   * @param request The model, request type ("generateContent") and Gemini request body
   * @returns A promise that resolves with the Gemini generateContent response
   * @link https://ai.google.dev/api/generate-content
   */
  static generateContent(
    request: GoogleGenAITypes.Imagen.GenerateContentRequest
  ): Promise<GoogleGenAITypes.Gemini.Models.GenerateContentResponse> {
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
        model: request.model,
        type: request.type ?? "generateContent",
      };
      submitApiRequest.body = JSON.stringify(request.body);

      RSM_IMAGEN.performApiRequest(submitApiRequest, (response) => {
        if (response.statusCode == 1) {
          try {
            const bodyJson = JSON.parse(
              response.body
            ) as GoogleGenAITypes.Gemini.Models.GenerateContentResponse;
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

  /**
   * Perform a generic Imagen predict request.
   * @deprecated The Remote Service Gateway no longer serves the Imagen predict models
   * (imagen-3.0 / imagen-4.0): requests fail. Use Imagen.generateContent with
   * gemini-3.1-flash-image or gemini-3.1-flash-lite-image instead.
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
