// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * AnthropicDirect.ts
 *
 * Calls Anthropic's Messages API directly via InternetModule.fetch.
 * Prototype-only; do not ship a baked-in key.
 *
 * Endpoint: POST https://api.anthropic.com/v1/messages
 * Docs:     https://docs.anthropic.com/en/api/messages
 *
 * NOTE: Anthropic requires the `anthropic-version` header. The standard browser
 * Fetch would also need CORS, but InternetModule.fetch runs server-side from the
 * device and is not subject to CORS preflight.
 */
@component
export class AnthropicDirect extends BaseScriptComponent {
  @input
  @hint("Anthropic API key (sk-ant-...). Prototype only.")
  apiKey: string = ""

  @input
  @hint("Model name, e.g. claude-sonnet-4-6 or claude-haiku-4-5-20251001")
  model: string = "claude-haiku-4-5-20251001"

  @input
  @hint("Prompt to send")
  prompt: string = "Give me one tip for writing concise prompts."

  @input
  @hint("Max tokens to generate")
  maxTokens: number = 256

  private internetModule: InternetModule = require("LensStudio:InternetModule")

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.run())
  }

  private async run(): Promise<void> {
    if (!this.apiKey) {
      print("[AnthropicDirect] Missing apiKey")
      return
    }

    const request = new Request("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        messages: [{ role: "user", content: this.prompt }],
      }),
    })

    try {
      const response = await this.internetModule.fetch(request)
      if (response.status !== 200) {
        print("[AnthropicDirect] HTTP " + response.status + ": " + (await response.text()))
        return
      }
      const data = await response.json()
      // content is an array of blocks; pull the first text block
      const text =
        Array.isArray(data?.content)
          ? data.content.find((b: any) => b.type === "text")?.text
          : undefined
      print("[AnthropicDirect] " + (text ?? "(empty response)"))
    } catch (err) {
      print("[AnthropicDirect] Failed: " + err)
    }
  }
}
