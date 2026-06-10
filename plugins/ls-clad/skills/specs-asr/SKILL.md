---
name: specs-asr
description: Use the ASR Module for real-time speech-to-text on Specs. Best for dictation, transcription, and chat input (voice → LLM). Supports 40+ languages and mixed input. Not recommended for voice commands or keyword spotting.
user-invocable: false
paths: "**/*.ts"
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# ASR Module — Speech-to-Text

**This is the primary way to do speech-to-text (STT) on Specs.** Use `LensStudio:AsrModule` for **transcription** and **chat input** — voice → final transcript → LLM (Gemini/OpenAI) → response. It is the canonical on-device-streaming STT path.

**Not recommended for voice commands / keyword spotting.** ASR is capable of returning text you can keyword-match against, but in practice keyword detection is unreliable — partial transcripts churn, finals arrive late, and short command words are often misrecognized. If you need voice commands, expect poor results and design a fallback (pinch, button, gaze). Prefer ASR for free-form speech, not trigger phrases.

**Requirements:** Lens Studio v5.9+, Spectacles OS v5.61+. Works in both Lens Studio Preview and on-device.

> Hardcode options in code (silence timeout, mode, logging) — only expose `@input` when a non-engineer needs to tune it.

Full reference docs: [`resources/docs/asr-module.mdx`](resources/docs/asr-module.mdx)

Full script examples (each file is a complete, runnable component):
- [`resources/examples/AsrExample.ts`](resources/examples/AsrExample.ts) — minimal docs example
- [`resources/examples/ASRController-minimal.ts`](resources/examples/ASRController-minimal.ts) — small standalone controller
- [`resources/examples/ASRQueryController.ts`](resources/examples/ASRQueryController.ts) — voice query feeding an AI pipeline
- [`resources/examples/ChatASRController.ts`](resources/examples/ChatASRController.ts) — ASR inside a chat application
- [`resources/examples/SummaryASRController.ts`](resources/examples/SummaryASRController.ts) — capture-and-summarize pattern

---

## Setup

```typescript
private asrModule = require('LensStudio:AsrModule');
```

> `createCameraRequest` and session setup must NOT be called inside `onAwake` — use `OnStartEvent`.

---

## Full Component

```typescript
@component
export class SpeechToText extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">SpeechToText – Real-time speech transcription</span>')
  @ui.separator

  // Configure programmatically — keep these as code constants, not @input fields,
  // unless a non-engineer truly needs to tune them from the Inspector.
  private static readonly SILENCE_UNTIL_TERMINATION_MS = 1000
  private static readonly MODE = "HighAccuracy" // HighAccuracy | Balanced | HighSpeed
  private static readonly ENABLE_LOGGING = false

  // Fired each time text is updated; isFinal=true means phrase is complete
  public onTranscription: Event<{text: string; isFinal: boolean}> =
    new Event<{text: string; isFinal: boolean}>()

  private asrModule = require('LensStudio:AsrModule')
  private logger: Logger

  onAwake(): void {
    this.logger = new Logger("SpeechToText", SpeechToText.ENABLE_LOGGING, false)
    this.createEvent('OnStartEvent').bind(() => this.startSession())
    this.createEvent('OnDestroyEvent').bind(() => this.stopSession())
  }

  private startSession(): void {
    const options = AsrModule.AsrTranscriptionOptions.create()
    options.silenceUntilTerminationMs = SpeechToText.SILENCE_UNTIL_TERMINATION_MS
    options.mode = AsrModule.AsrMode.HighAccuracy  // or Balanced / HighSpeed

    options.onTranscriptionUpdateEvent.add((e: AsrModule.TranscriptionUpdateEvent) => {
      this.logger.info(`ASR: "${e.text}" (final=${e.isFinal})`)
      this.onTranscription.invoke({text: e.text, isFinal: e.isFinal})
    })

    options.onTranscriptionErrorEvent.add((code: AsrModule.AsrStatusCode) => {
      switch (code) {
        case AsrModule.AsrStatusCode.InternalError:
          this.logger.error("ASR: Internal error"); break
        case AsrModule.AsrStatusCode.Unauthenticated:
          this.logger.error("ASR: Unauthenticated"); break
        case AsrModule.AsrStatusCode.NoInternet:
          this.logger.error("ASR: No internet"); break
      }
    })

    this.asrModule.startTranscribing(options)
    this.logger.info("ASR session started")
  }

  public async stopSession(): Promise<void> {
    await this.asrModule.stopTranscribing()
    this.logger.info("ASR session stopped")
  }
}
```

---

## Key API

| Method / Property | Description |
|---|---|
| `AsrModule.AsrTranscriptionOptions.create()` | Creates options object |
| `options.mode` | `HighAccuracy` / `Balanced` / `HighSpeed` |
| `options.silenceUntilTerminationMs` | ms of silence before phrase is finalized |
| `options.onTranscriptionUpdateEvent` | Event: `TranscriptionUpdateEvent` (`text: string`, `isFinal: boolean`) |
| `options.onTranscriptionErrorEvent` | Event: `AsrStatusCode` |
| `asrModule.startTranscribing(options)` | Start listening |
| `asrModule.stopTranscribing()` | Stop — returns `Promise<void>`, use `await` |

## `isFinal` Behavior

- `isFinal: false` — live partial transcript, updates frequently
- `isFinal: true` — phrase complete (silence detected), new phrase begins automatically

## ASR + AI Pattern

Use ASR to capture user voice → send final transcript to Gemini/OpenAI:

```typescript
this.speechToText.onTranscription.add(({text, isFinal}) => {
  if (isFinal && text.trim().length > 0) {
    this.geminiAssistant.sendText(text)
  }
})
```

## Notes

- Internet required (streaming transcription)
- Accessing ASR disables camera frame access (use Extended Permissions for both)
- Mixed languages handled automatically
- Heading accuracy improves as the session runs
