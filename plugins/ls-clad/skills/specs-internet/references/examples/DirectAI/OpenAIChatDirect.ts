// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * OpenAIChatDirect.ts
 *
 * Calls OpenAI's chat completions API directly via InternetModule.fetch — no
 * Remote Service Gateway. Prototype-only; do not publish a lens with a baked-in
 * production key.
 *
 * Endpoint: POST https://api.openai.com/v1/chat/completions
 * Docs:     https://platform.openai.com/docs/api-reference/chat
 */
@component
export class OpenAIChatDirect extends BaseScriptComponent {
  @input
  @hint("OpenAI API key (sk-...). Prototype only — do not ship in published lenses.")
  apiKey: string = ""

  @input
  @hint("Model name, e.g. gpt-4o-mini")
  model: string = "gpt-4o-mini"

  @input
  @hint("Prompt to send")
  prompt: string = "Tell me one surprising fact about octopuses."

  private internetModule: InternetModule = require("LensStudio:InternetModule")

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.run())
  }

  private async run(): Promise<void> {
    if (!this.apiKey) {
      print("[OpenAIChatDirect] Missing apiKey")
      return
    }

    try {
      const response = await this.internetModule.fetch("https://api.openai.com/v1/chat/completions", {
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
          temperature: 0.7,
        }),
      })
      if (response.status !== 200) {
        print("[OpenAIChatDirect] HTTP " + response.status + ": " + (await response.text()))
        return
      }
      const data = await response.json()
      const text = data?.choices?.[0]?.message?.content ?? "(empty response)"
      print("[OpenAIChatDirect] " + text)
    } catch (err) {
      print("[OpenAIChatDirect] Failed: " + err)
    }
  }
}
