// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * AIAssistant – Hold-to-Talk voice assistant with ASR + AI response via RSG
 *
 * Flow:
 *  1. User pinches/holds the "Hold to Talk" button → ASR starts
 *  2. User releases → ASR stops, final transcript is captured
 *  3. "You: [transcript]" shown on panel
 *  4. Transcript sent to AI via RSG (OpenAI Chat Completions)
 *  5. "AI: [response]" shown below on panel
 *
 * Requirements (install via Window > Asset Library in Lens Studio):
 *  - SpectaclesInteractionKit (already installed)
 *  - SpectaclesUIKit (already installed)
 *  - RemoteServiceGateway v0.2.0
 *
 * After installing RemoteServiceGateway, set your API token:
 *  - Window > Remote Service Gateway Token > Generate (uses your Snap login)
 *  - OR create a SceneObject "RemoteServiceGatewayCredentials [EDIT ME]"
 *    and set the openAIToken field in the Inspector
 */

import {buildUI, UIElements} from "./AIAssistantUI"
import {OpenAI} from "RemoteServiceGateway.lspkg/HostedExternal/OpenAI"
import {OpenAITypes} from "RemoteServiceGateway.lspkg/HostedExternal/OpenAITypes"

@component
export class AIAssistant extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">AIAssistant – Hold-to-Talk voice assistant</span><br/><span style="color: #94A3B8; font-size: 11px;">Hold the button to speak. Release to get an AI response.</span>')
  @ui.separator

  @input
  @hint("System prompt — instructions for the AI assistant")
  systemPrompt: string = "You are a helpful AI assistant on Spectacles AR glasses. Keep responses concise — 1-3 sentences max."

  @input
  @hint("OpenAI model to use for responses")
  model: string = "gpt-4o-mini"

  @input
  @hint("Max conversation turns to keep in memory (older turns are dropped)")
  maxHistoryTurns: number = 10

  @input
  @hint("Silence duration in ms before ASR finalizes the transcript")
  silenceMs: number = 1500

  @input
  @hint("Enable verbose logging to the console")
  enableLogging: boolean = true

  // ── Private state ──────────────────────────────────────────────────────────
  private ui!: UIElements
  private asrModule: any = null

  // Conversation history for multi-turn context
  private conversationHistory: OpenAITypes.ChatCompletions.Message[] = []

  // All transcript lines (we show last 6 in the panel)
  private transcriptLines: string[] = []

  // ASR recording state
  private isRecording: boolean = false
  private pendingTranscript: string = ""
  private liveTranscriptSlot: number = -1

  // Button held state
  private buttonHeld: boolean = false

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  onAwake(): void {
    this.log("AIAssistant awakening")

    // Initialize conversation with system context
    this.conversationHistory = [
      {role: "system", content: this.systemPrompt}
    ]

    // Get ASR module reference
    this.asrModule = require("LensStudio:AsrModule")

    this.createEvent("OnStartEvent").bind(() => this.onStart())
    this.createEvent("OnDestroyEvent").bind(() => this.onDestroy())
  }

  private onStart(): void {
    this.log("AIAssistant starting")

    // Build the UI hierarchy — creates the transcript panel + button
    const root = this.getSceneObject()
    this.ui = buildUI(this, root)

    // Wire button: hold = start recording, release = stop + send
    // UIKit Button uses onTriggerDown (pinch starts) and onTriggerUp (pinch ends)
    this.ui.holdToTalkButton.onTriggerDown.add(() => this.onButtonHold())
    this.ui.holdToTalkButton.onTriggerUp.add(() => this.onButtonRelease())

    // Show a hint to get started
    this.addLine("Hold the button and speak.")
  }

  // ── Button Events ─────────────────────────────────────────────────────────
  private onButtonHold(): void {
    if (this.buttonHeld) return
    this.buttonHeld = true
    this.log("Button held — starting ASR")
    this.startASR()
  }

  private onButtonRelease(): void {
    if (!this.buttonHeld) return
    this.buttonHeld = false
    this.log("Button released — stopping ASR")
    this.stopASR()
  }

  // ── ASR ───────────────────────────────────────────────────────────────────
  private startASR(): void {
    if (this.isRecording) return
    this.isRecording = true
    this.pendingTranscript = ""
    this.ui.setListening(true)

    const opts = this.asrModule.AsrTranscriptionOptions.create()
    opts.mode = this.asrModule.AsrMode.HighAccuracy
    opts.silenceUntilTerminationMs = this.silenceMs

    opts.onTranscriptionUpdateEvent.add((e: any) => {
      this.pendingTranscript = e.text
      this.log(`ASR update: "${e.text}" (final=${e.isFinal})`)
      this.updateLiveLine("You: " + e.text + "…")
    })

    opts.onTranscriptionErrorEvent.add((code: any) => {
      this.log("ASR error code: " + code)
      this.ui.setListening(false)
      this.isRecording = false
      this.addLine("ASR error — check internet + device permissions.")
    })

    this.asrModule.startTranscribing(opts)
    this.log("ASR started")
  }

  private stopASR(): void {
    if (!this.isRecording) return
    this.ui.setListening(false)

    this.asrModule.stopTranscribing().then(() => {
      this.isRecording = false
      const text = this.pendingTranscript.trim()
      this.log(`ASR stopped. Final: "${text}"`)

      if (text.length === 0) {
        this.finalizeLiveLine("(Nothing heard — try again)")
        return
      }

      // Commit the "You: …" line as final
      this.finalizeLiveLine("You: " + text)

      // Send to AI
      this.sendToAI(text)
    }).catch((err: any) => {
      this.isRecording = false
      this.log("ASR stop error: " + err)
    })
  }

  // ── AI via RSG ────────────────────────────────────────────────────────────
  private sendToAI(userText: string): void {
    // Show placeholder while waiting
    this.addLine("AI: …")

    this.conversationHistory.push({role: "user", content: userText})

    // Trim history to prevent runaway token usage
    if (this.conversationHistory.length > this.maxHistoryTurns * 2 + 1) {
      const system = this.conversationHistory[0]
      const recent = this.conversationHistory.slice(-(this.maxHistoryTurns * 2))
      this.conversationHistory = [system, ...recent]
    }

    OpenAI.chatCompletions({
      model: this.model,
      messages: this.conversationHistory,
      temperature: 0.7,
      max_tokens: 256
    } as any)
    .then((response: any) => {
      const reply: string = response?.choices?.[0]?.message?.content ?? "(empty response)"
      this.log(`AI replied: "${reply}"`)
      this.replaceLastLine("AI: " + reply)
      this.conversationHistory.push({role: "assistant", content: reply})
    })
    .catch((err: any) => {
      this.log("AI request failed: " + err)
      this.replaceLastLine("AI: (Error — check RSG token in Inspector)")
    })
  }

  // ── Transcript Management ─────────────────────────────────────────────────

  /** Update/create a live partial ASR line while recording */
  private updateLiveLine(text: string): void {
    if (this.liveTranscriptSlot >= 0 && this.liveTranscriptSlot < this.transcriptLines.length) {
      this.transcriptLines[this.liveTranscriptSlot] = text
    } else {
      this.liveTranscriptSlot = this.transcriptLines.length
      this.transcriptLines.push(text)
    }
    this.refresh()
  }

  /** Finalize the live ASR line (replace the "…" version) */
  private finalizeLiveLine(text: string): void {
    if (this.liveTranscriptSlot >= 0 && this.liveTranscriptSlot < this.transcriptLines.length) {
      this.transcriptLines[this.liveTranscriptSlot] = text
      this.liveTranscriptSlot = -1
    } else {
      this.transcriptLines.push(text)
    }
    this.refresh()
  }

  /** Append a new line unconditionally */
  private addLine(text: string): void {
    this.transcriptLines.push(text)
    this.refresh()
  }

  /** Replace the last line in the transcript (AI placeholder → response) */
  private replaceLastLine(text: string): void {
    if (this.transcriptLines.length > 0) {
      this.transcriptLines[this.transcriptLines.length - 1] = text
    } else {
      this.transcriptLines.push(text)
    }
    this.refresh()
  }

  /** Push last 6 lines to the UI */
  private refresh(): void {
    this.ui.setTranscript(this.transcriptLines.slice(-6))
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  private log(msg: string): void {
    if (this.enableLogging) print("[AIAssistant] " + msg)
  }

  private onDestroy(): void {
    if (this.isRecording && this.asrModule) {
      this.asrModule.stopTranscribing()
    }
  }
}
