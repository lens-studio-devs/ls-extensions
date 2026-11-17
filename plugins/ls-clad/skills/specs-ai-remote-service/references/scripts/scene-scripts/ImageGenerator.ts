// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * SPECS Inc. 2027
 * Image Generator component for the AI Playground Glasses lens.
 */
import {Gemini} from "RemoteServiceGateway.lspkg/HostedExternal/Gemini"
import {GeminiTypes} from "RemoteServiceGateway.lspkg/HostedExternal/GeminiTypes"
import {OpenAI} from "RemoteServiceGateway.lspkg/HostedExternal/OpenAI"
import {OpenAITypes} from "RemoteServiceGateway.lspkg/HostedExternal/OpenAITypes"
import {Promisfy} from "RemoteServiceGateway.lspkg/Utils/Promisfy"
import {Logger} from "Utilities.lspkg/Scripts/Utils/Logger"

export class ImageGenerator {
  private rmm = require("LensStudio:RemoteMediaModule") as RemoteMediaModule
  private model: string
  private logger: Logger

  constructor(model: string, logger?: Logger) {
    this.model = model
    this.logger = logger
  }

  generateImage(prompt: string): Promise<Texture> {
    if (this.model === "OpenAI") {
      return this.generateWithOpenAI(prompt)
    } else {
      return this.generateWithGemini(prompt)
    }
  }

  private generateWithGemini(prompt: string): Promise<Texture> {
    return new Promise((resolve, reject) => {
      const request: GeminiTypes.Models.GenerateContentRequest = {
        model: "gemini-3.1-flash-image",
        type: "generateContent",
        body: {
          contents: [
            {
              parts: [
                {
                  text: prompt
                }
              ],
              role: "user"
            }
          ],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"]
          }
        }
      }

      Gemini.models(request)
        .then((response) => {
          if (!response.candidates || response.candidates.length === 0) {
            reject("No image generated in response")
            return
          }

          let foundImage = false
          for (const part of response.candidates[0].content.parts) {
            if (part?.inlineData) {
              foundImage = true
              const b64Data = part.inlineData.data
              Base64.decodeTextureAsync(
                b64Data,
                (texture) => {
                  resolve(texture)
                },
                () => {
                  reject("Failed to decode texture from base64 data.")
                }
              )
              break
            }
          }

          if (!foundImage) {
            reject("No image data found in response")
          }
        })
        .catch((error) => {
          reject("Error while generating image: " + error)
        })
    })
  }

  private generateWithOpenAI(prompt: string): Promise<Texture> {
    return new Promise((resolve, reject) => {
      const req = {
        prompt: prompt,
        n: 1,
        // gpt-image-2 is OpenAI's latest GPT Image model. It always returns
        // base64 (b64_json) — there is no url field — so the b64 branch below
        // is the path that fires. "low" quality keeps generation fast for the
        // interactive lens; bump to "medium"/"high" for final-asset quality.
        model: "gpt-image-2",
        quality: "low",
        size: "1024x1024"
      } as OpenAITypes.ImageGenerate.Request
      OpenAI.imagesGenerate(req)
        .then((result) => {
          result.data.forEach((datum) => {
            const b64 = datum.b64_json
            const url = datum.url
            if (url) {
              if (this.logger) this.logger.info("Texture loaded as image URL")
              const internetModule = require("LensStudio:InternetModule") as InternetModule
              const request = RemoteServiceHttpRequest.create()
              request.url = url
              Promisfy.InternetModule.performHttpRequest(internetModule, request).then((response) => {
                const resource = response.asResource()
                this.rmm.loadResourceAsImageTexture(
                  resource,
                  (texture) => {
                    // loadResourceAsImageTexture only downloads the texture — its provider is
                    // still unloaded, and would be loaded synchronously mid-render the first
                    // time the texture is drawn. ensureLoaded() moves that work off the render
                    // path. Requires Lens Scripting 370+ (this project is on 372).
                    texture.control
                      .ensureLoaded()
                      .then(() => resolve(texture))
                      .catch(() => reject("Failure to load texture from URL"))
                  },
                  () => {
                    reject("Failure to download texture from URL")
                  }
                )
              })
            } else if (b64) {
              if (this.logger) this.logger.debug("Decoding texture from base64")
              Base64.decodeTextureAsync(
                b64,
                (texture) => {
                  // Same as the URL branch above: decoding produces the Texture but leaves its
                  // provider unloaded until first draw. This is the branch gpt-image-2 actually
                  // takes, since it always returns b64_json.
                  texture.control
                    .ensureLoaded()
                    .then(() => resolve(texture))
                    .catch(() => reject("Failure to load texture from base64"))
                },
                () => {
                  reject("Failure to download texture from base64")
                }
              )
            }
          })
        })
        .catch((error) => reject(error))
    })
  }
}
