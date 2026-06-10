// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * GeminiDirect.ts
 *
 * Calls Google's Gemini generateContent endpoint directly via InternetModule.fetch.
 * Prototype-only; do not ship a baked-in key.
 *
 * Endpoint: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={API_KEY}
 * Docs:     https://ai.google.dev/api/generate-content
 */
@component
export class GeminiDirect extends BaseScriptComponent {
  @input
  @hint("Google AI Studio API key. Prototype only.")
  apiKey: string = ""

  @input
  @hint("Model name, e.g. gemini-2.0-flash or gemini-1.5-pro")
  model: string = "gemini-2.0-flash"

  @input
  @hint("Prompt to send")
  prompt: string = "Explain quantum entanglement in two sentences."

  private internetModule: InternetModule = require("LensStudio:InternetModule")

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.run())
  }

  private async run(): Promise<void> {
    if (!this.apiKey) {
      print("[GeminiDirect] Missing apiKey")
      return
    }

    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/" +
      this.model +
      ":generateContent?key=" +
      encodeURIComponent(this.apiKey)

    try {
      const response = await this.internetModule.fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: this.prompt }] }],
          generationConfig: { temperature: 0.7 },
        }),
      })
      if (response.status !== 200) {
        print("[GeminiDirect] HTTP " + response.status + ": " + (await response.text()))
        return
      }
      const data = await response.json()
      const text =
        data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "(empty response)"
      print("[GeminiDirect] " + text)
    } catch (err) {
      print("[GeminiDirect] Failed: " + err)
    }
  }
}
