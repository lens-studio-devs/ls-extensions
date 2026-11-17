// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * DeepseekDirect.ts
 *
 * Calls DeepSeek's chat completions endpoint directly via InternetModule.fetch.
 * DeepSeek's API is OpenAI-compatible, so the request shape mirrors OpenAIChatDirect.
 * Prototype-only; do not ship a baked-in key.
 *
 * Endpoint: POST https://api.deepseek.com/chat/completions
 * Docs:     https://api-docs.deepseek.com/
 */
@component
export class DeepseekDirect extends BaseScriptComponent {
  @input
  @hint("DeepSeek API key. Prototype only.")
  apiKey: string = ""

  @input
  @hint("Model name, e.g. deepseek-chat or deepseek-reasoner")
  model: string = "deepseek-chat"

  @input
  @hint("Prompt to send")
  prompt: string = "What's the time complexity of quicksort, in one sentence?"

  private internetModule: InternetModule = require("LensStudio:InternetModule")

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.run())
  }

  private async run(): Promise<void> {
    if (!this.apiKey) {
      print("[DeepseekDirect] Missing apiKey")
      return
    }

    const request = new Request("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + this.apiKey,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: "You are a concise assistant." },
          { role: "user", content: this.prompt },
        ],
        stream: false,
      }),
    })

    try {
      const response = await this.internetModule.fetch(request)
      if (response.status !== 200) {
        print("[DeepseekDirect] HTTP " + response.status + ": " + (await response.text()))
        return
      }
      const data = await response.json()
      const text = data?.choices?.[0]?.message?.content ?? "(empty response)"
      print("[DeepseekDirect] " + text)
    } catch (err) {
      print("[DeepseekDirect] Failed: " + err)
    }
  }
}
