// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * Snap-hosted DeepSeek R1 AI integration for chat completions. Provides access to DeepSeek's
 * advanced reasoning model with function calling, streaming, and tool use capabilities through
 * Snap's Remote Service Gateway infrastructure.
 */
import { RemoteServiceGatewayCredentials, AvaliableApiTypes } from "../RemoteServiceGatewayCredentials";
import { DeepSeekTypes } from "./DeepSeekTypes";

const RSM_COMPLETIONS = requireAsset(
  "./RemoteServiceModules/Deepseek_Completions.remoteServiceModule"
) as RemoteServiceModule

export class DeepSeek {
    /**
     * Performs a chat completion request to Snap hosted DeepSeek API.
     * @param deepSeekRequest The request object containing the chat completion parameters.
     * @returns A promise that resolves with the chat completion response.
     * @link https://api-docs.deepseek.com/api/create-chat-completion
     */
    static chatCompletions(
        deepSeekRequest: DeepSeekTypes.ChatCompletions.Request
      ): Promise<DeepSeekTypes.ChatCompletions.Response> {
        return new Promise<DeepSeekTypes.ChatCompletions.Response>((resolve, reject) => {
          const submitApiRequest = RemoteApiRequest.create();
          const apiToken = RemoteServiceGatewayCredentials.getApiToken(
                AvaliableApiTypes.Snap
          );
          submitApiRequest.endpoint = "chat_completions";
          submitApiRequest.parameters = {
            "api-token": apiToken
          }
          const textBody = JSON.stringify(deepSeekRequest)
          submitApiRequest.body = textBody

          RSM_COMPLETIONS.performApiRequest(submitApiRequest, function (resp) {
            if (resp.statusCode == 1) {
              const bodyJson = JSON.parse(resp.body) as DeepSeekTypes.ChatCompletions.Response;
              resolve(bodyJson);
            }
            else {
              reject(resp.body);
            }
          });
        });
    };
}
