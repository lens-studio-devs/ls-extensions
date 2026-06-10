// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * OpenAI API integration for chat, image generation/editing, speech synthesis, and realtime
 * interactions. Provides access to GPT models, DALL-E image generation, TTS speech, and
 * WebSocket-based realtime conversations with multipart form data support.
 */
import {
  AvaliableApiTypes,
  RemoteServiceGatewayCredentials,
} from "../RemoteServiceGatewayCredentials";

import { OpenAITypes } from "./OpenAITypes";

import Event from "../Utils/Event";

const RSM_CHATCOMPLETIONS = requireAsset(
  "./RemoteServiceModules/OpenAi_Completions.remoteServiceModule"
) as RemoteServiceModule;

const RSM_IMAGEGENERATIONS = requireAsset(
  "./RemoteServiceModules/OpenAi_Generations.remoteServiceModule"
) as RemoteServiceModule;

const RSM_IMAGEEDITS = requireAsset(
  "./RemoteServiceModules/OpenAi_ImageEdits.remoteServiceModule"
) as RemoteServiceModule;

const RSM_SPEECH = requireAsset(
  "./RemoteServiceModules/OpenAi_Speech.remoteServiceModule"
) as RemoteServiceModule;

const RSM_REALTIME = requireAsset(
  "./RemoteServiceModules/OpenAi_Realtime.remoteServiceModule"
) as RemoteServiceModule;

const RMM = require("LensStudio:RemoteMediaModule") as RemoteMediaModule;

export class OpenAI {
  /**
   * Performs a chat completion request to the OpenAI API.
   * @param gptRequest The request object containing the chat completion parameters.
   * @returns A promise that resolves with the chat completion response.
   * @link https://platform.openai.com/docs/api-reference/chat/create
   */
  static chatCompletions(
    gptRequest: OpenAITypes.ChatCompletions.Request
  ): Promise<OpenAITypes.ChatCompletions.Response> {
    return new Promise<OpenAITypes.ChatCompletions.Response>(
      (resolve, reject) => {
        const submitApiRequest = RemoteApiRequest.create();
        const apiToken = RemoteServiceGatewayCredentials.getApiToken(
          AvaliableApiTypes.OpenAI
        );
        submitApiRequest.endpoint = "chat_completions";
        submitApiRequest.parameters = {
          "api-token": apiToken,
        };
        const textBody = JSON.stringify(gptRequest);
        submitApiRequest.body = textBody;

        RSM_CHATCOMPLETIONS.performApiRequest(
          submitApiRequest,
          function (resp) {
            if (resp.statusCode == 1) {
              const bodyJson = JSON.parse(
                resp.body
              ) as OpenAITypes.ChatCompletions.Response;
              resolve(bodyJson);
            } else {
              reject(resp.body);
            }
          }
        );
      }
    );
  }

  /**
   *
   * @param imagesGenerateRequest The request object containing the image generation parameters.
   * @returns a promise that resolves with the image generation response.
   * @link https://platform.openai.com/docs/api-reference/images/create
   */
  static imagesGenerate(
    imagesGenerateRequest: OpenAITypes.ImageGenerate.Request
  ): Promise<OpenAITypes.ImageGenerate.Response> {
    return new Promise<OpenAITypes.ImageGenerate.Response>(
      (resolve, reject) => {
        const submitApiRequest = RemoteApiRequest.create();
        const apiToken = RemoteServiceGatewayCredentials.getApiToken(
          AvaliableApiTypes.OpenAI
        );
        submitApiRequest.endpoint = "images_generations";
        submitApiRequest.parameters = {
          "api-token": apiToken,
        };
        const textBody = JSON.stringify(imagesGenerateRequest);
        submitApiRequest.body = textBody;

        RSM_IMAGEGENERATIONS.performApiRequest(
          submitApiRequest,
          function (resp) {
            if (resp.statusCode == 1) {
              const bodyJson = JSON.parse(
                resp.body
              ) as OpenAITypes.ImageGenerate.Response;
              resolve(bodyJson);
            } else {
              reject(resp.body);
            }
          }
        );
      }
    );
  }

  /**
   *
   * @param imagesEditRequest The request object containing the image edit parameters.
   * @link https://platform.openai.com/docs/api-reference/images/createEdit
   * @description This method allows you to edit an image by providing a prompt, an image, or a mask
   * @returns a promise that resolves with the image edits response.
   */
  static imagesEdit(
    imagesEditRequest: OpenAITypes.ImageEdits.Request
  ): Promise<OpenAITypes.ImageGenerate.Response> {
    return new Promise<OpenAITypes.ImageGenerate.Response>(
      (resolve, reject) => {
        const submitApiRequest = RemoteApiRequest.create();
        const apiToken = RemoteServiceGatewayCredentials.getApiToken(
          AvaliableApiTypes.OpenAI
        );
        const boundary = "boundary-" + Math.random().toString(36).substring(2);
        submitApiRequest.endpoint = "image_edit";
        submitApiRequest.parameters = {
          "api-token": apiToken,
          "Content-Type": "multipart/form-data; boundary=" + boundary,
        };

        // Prepare fields from the request
        const fields = {
          prompt: imagesEditRequest.prompt,
        };

        // Add optional fields if they exist
        if (imagesEditRequest.n) fields["n"] = imagesEditRequest.n.toString();
        if (imagesEditRequest.size) fields["size"] = imagesEditRequest.size;
        if (imagesEditRequest.response_format)
          fields["response_format"] = imagesEditRequest.response_format;
        if (imagesEditRequest.model) fields["model"] = imagesEditRequest.model;

        // Prepare files
        const files = {
          image: ["image.png", imagesEditRequest.image, "image/png"],
        };

        // Add mask if provided
        if (imagesEditRequest.mask) {
          files["mask"] = ["mask.png", imagesEditRequest.mask, "image/png"];
        }

        // Build multipart form data
        const textBody = buildMultipartFormData(fields, files, boundary);
        submitApiRequest.body = textBody;

        RSM_IMAGEEDITS.performApiRequest(submitApiRequest, function (resp) {
          if (resp.statusCode == 1) {
            const bodyJson = JSON.parse(
              resp.body
            ) as OpenAITypes.ImageGenerate.Response;
            resolve(bodyJson);
          } else {
            reject(resp.body);
          }
        });
      }
    );
  }

  /**
   * Performs a speech synthesis request to the OpenAI API.
   * @param speechRequest The request object containing the speech synthesis parameters.
   * @returns A promise that resolves with an AudioTrackAsset containing the synthesized speech.
   * @link https://platform.openai.com/docs/api-reference/audio/createSpeech
   */
  static speech(speechRequest: OpenAITypes.Speech.Request) {
    return new Promise<AudioTrackAsset>((resolve, reject) => {
      const submitApiRequest = RemoteApiRequest.create();
      const apiToken = RemoteServiceGatewayCredentials.getApiToken(
        AvaliableApiTypes.OpenAI
      );
      submitApiRequest.endpoint = "audio_speech";
      submitApiRequest.parameters = {
        "api-token": apiToken,
      };
      const textBody = JSON.stringify(speechRequest);
      submitApiRequest.body = textBody;

      RSM_SPEECH.performApiRequest(submitApiRequest, function (resp) {
        if (resp.statusCode == 1) {
          const resource = resp.asResource();
          RMM.loadResourceAsAudioTrackAsset(
            resource,
            (aud) => {
              resolve(aud);
            },
            (error) => {
              reject(error);
            }
          );
        } else {
          reject(resp.body);
        }
      });
    });
  }

  /**
   * Creates a new OpenAI Realtime WebSocket session.
   * @param sessionRequest The request object containing the session parameters.
   * @returns An instance of OpenAIRealtimeWebsocket.
   * @link https://platform.openai.com/docs/api-reference/realtime-sessions/create
   */
  static createRealtimeSession(
    sessionRequest: OpenAITypes.Realtime.RequestSession
  ): OpenAIRealtimeWebsocket {
    const openAIWebsocket = new OpenAIRealtimeWebsocket(sessionRequest);
    return openAIWebsocket;
  }
}

export class OpenAIRealtimeWebsocket {
  private _websocket: WebSocket;

  /**
   * Event triggered when a message is received from the OpenAI Realtime API.
   * @type {Event<OpenAITypes.Realtime.ServerMessage>}
   */
  public onMessage = new Event<OpenAITypes.Realtime.ServerMessage>();
  public onError = new Event<WebSocketEvent>();
  public onOpen = new Event<WebSocketEvent>();
  public onClose = new Event<WebSocketCloseEvent>();

  constructor(sessionRequest: OpenAITypes.Realtime.RequestSession) {
    this.connect(sessionRequest);
  }

  private connect(sessionRequest: OpenAITypes.Realtime.RequestSession) {
    const apiToken = RemoteServiceGatewayCredentials.getApiToken(
      AvaliableApiTypes.OpenAI
    );

    this._websocket = RSM_REALTIME.createAPIWebSocket("real_time", {
      "api-token": apiToken,
      "OpenAI-Beta": "realtime=v1",
      model: sessionRequest.model,
    });

    this._websocket.addEventListener("error", (event) => {
      this.onError.invoke(event);
    });

    this._websocket.addEventListener(
      "message",
      (event: WebSocketMessageEvent) => {
        const msg = JSON.parse(
          event.data.toString()
        ) as OpenAITypes.Realtime.ServerMessage;
        this.onMessage.invoke(msg);
      }
    );

    this._websocket.addEventListener("open", (event) => {
      this.onOpen.invoke(event);
    });

    this._websocket.addEventListener("close", (event: WebSocketCloseEvent) => {
      this.onClose.invoke(event);
    });
  }

  /**
   *  Sends a message to the OpenAI Realtime WebSocket.
   * @param message The message to send to the OpenAI Realtime WebSocket.
   */
  send(message: OpenAITypes.Realtime.ClientMessage) {
    if (this._websocket.readyState == WebSocketReadyState.OPEN) {
      this._websocket.send(JSON.stringify(message));
    }
  }

  /**
   * Overrides the default send method to allow sending raw messages.
   * @param message The raw message to send.
   */
  overrideSend(message: any) {
    if (this._websocket.readyState == WebSocketReadyState.OPEN) {
      this._websocket.send(message);
    }
  }

  /**
   * Checks if the WebSocket connection is currently connected.
   * @returns {boolean} True if the WebSocket is connected, false otherwise.
   */
  isConnected() {
    return this._websocket.readyState == WebSocketReadyState.OPEN;
  }

  /**
   * Closes the WebSocket connection.
   */
  close() {
    this._websocket.close();
  }
}

function buildMultipartFormData(fields, files, boundary) {
  const encoder = new TextEncoder();
  const CRLF = "\r\n";
  const chunks = [];

  // Add fields
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(encoder.encode(`--${boundary}${CRLF}`));
    chunks.push(
      encoder.encode(
        `Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}`
      )
    );
    chunks.push(encoder.encode(`${value}${CRLF}`));
  }

  // Add files
  for (const [name, [filename, filedata, contentType]] of Object.entries(
    files as Record<string, [string, any, string]>
  )) {
    chunks.push(encoder.encode(`--${boundary}${CRLF}`));
    chunks.push(
      encoder.encode(
        `Content-Disposition: form-data; name="${name}"; filename="${filename}"${CRLF}`
      )
    );
    chunks.push(encoder.encode(`Content-Type: ${contentType}${CRLF}${CRLF}`));

    if (filedata instanceof Uint8Array || filedata instanceof ArrayBuffer) {
      chunks.push(
        filedata instanceof Uint8Array ? filedata : new Uint8Array(filedata)
      );
    } else if (typeof filedata === "string") {
      chunks.push(encoder.encode(filedata));
    }

    chunks.push(encoder.encode(CRLF));
  }

  // Add final boundary (just one CRLF here)
  chunks.push(encoder.encode(`--${boundary}--${CRLF}`));
  chunks.push(encoder.encode(CRLF));
  // Combine all chunks into a single Uint8Array
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const body = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }

  return body;
}

enum WebSocketReadyState {
  CONNECTING = 0,
  OPEN = 1,
  CLOSING = 2,
  CLOSED = 3,
}
