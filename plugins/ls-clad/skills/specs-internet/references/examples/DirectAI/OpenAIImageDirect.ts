// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * OpenAIImageDirect.ts
 *
 * Generates an image with OpenAI's image API and loads the returned URL as a
 * Texture via RemoteMediaModule. Prototype-only; do not ship a baked-in key.
 *
 * Endpoint: POST https://api.openai.com/v1/images/generations
 * Docs:     https://platform.openai.com/docs/api-reference/images
 */
@component
export class OpenAIImageDirect extends BaseScriptComponent {
  @input
  @hint("OpenAI API key (sk-...). Prototype only.")
  apiKey: string = ""

  @input
  @hint("Model, e.g. gpt-image-1 or dall-e-3")
  model: string = "gpt-image-1"

  @input
  @hint("Prompt for the image generator")
  prompt: string = "A photorealistic baby otter wearing AR glasses."

  @input
  @hint("Image component whose mainPass.baseTex will receive the result")
  targetImage: Image

  private internetModule: InternetModule = require("LensStudio:InternetModule")
  private remoteMediaModule: RemoteMediaModule = require("LensStudio:RemoteMediaModule")

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.run())
  }

  private async run(): Promise<void> {
    if (!this.apiKey) {
      print("[OpenAIImageDirect] Missing apiKey")
      return
    }

    try {
      const response = await this.internetModule.fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + this.apiKey,
        },
        body: JSON.stringify({
          model: this.model,
          prompt: this.prompt,
          n: 1,
          size: "1024x1024",
        }),
      })
      if (response.status !== 200) {
        print("[OpenAIImageDirect] HTTP " + response.status + ": " + (await response.text()))
        return
      }
      const data = await response.json()
      const url: string = data?.data?.[0]?.url
      if (!url) {
        print("[OpenAIImageDirect] No URL in response")
        return
      }
      print("[OpenAIImageDirect] Image URL: " + url)
      this.loadIntoTexture(url)
    } catch (err) {
      print("[OpenAIImageDirect] Failed: " + err)
    }
  }

  private loadIntoTexture(url: string): void {
    const resource = this.internetModule.makeResourceFromUrl(url)
    this.remoteMediaModule.loadResourceAsImageTexture(
      resource,
      (texture) => {
        if (this.targetImage) {
          this.targetImage.mainMaterial.mainPass.baseTex = texture
        }
        print("[OpenAIImageDirect] Texture loaded")
      },
      (err) => print("[OpenAIImageDirect] Texture load error: " + err)
    )
  }
}
