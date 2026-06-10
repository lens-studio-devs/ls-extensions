<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Migration: Speech transcription (VoiceML → ASR)

**When this applies:** any match for `VoiceMLModule`, `VoiceML.ListeningOptions`,
`startListening`, `stopListening`, `onListeningUpdate`, `NlpKeywordModelOptions`, `NlpIntentsModelOptions`,
`enableSystemCommands`, `KeywordDetectionController`, `AudioSpectrogram`, or
`SpeechCommandsLabels`.

Migrates **free-form transcription** uses of `VoiceMLModule` to `LensStudio:AsrModule`.
**Voice-command flows cannot be migrated** — ASR currently has no biased / keyterm-aware
mode, so short target words frequently fail to register at all and homophones routinely
fire false positives (e.g. a target keyword of "two" comes back as "to" or "too"; "no"
as "know"; "right" as "write"). There is no working SPECS 27 replacement, so **remove the
VoiceML voice-command code** rather than leave dead/deprecated VoiceML calls in the migrated
project, and warn the user that those voice commands no longer work. A keyterm-biased ASR
option is on the roadmap; the commands can be reimplemented on ASR once it ships.

ASR requires Lens Studio 5.9+ and Snap OS 5.61+. It works in both Lens Studio Preview and
on-device.

## Detection Patterns

**Transcription (migrate to ASR):**

- `VoiceMLModule`, `VoiceML.ListeningOptions`, `startListening`, `stopListening`
- `onListeningUpdate`, `onListeningEnabled`, `onListeningDisabled`, `onListeningError`
- `shouldReturnAsrTranscription`, `shouldReturnInterimAsrTranscription`

**Voice commands (remove + warn — no ASR replacement):**

- `NlpKeywordModelOptions`, `NlpIntentsModelOptions`
- `getKeywordResponses`, `getIntentResponses`, `getCommandResponses`, `getQnaResponses`
- `enableSystemCommands` (also has no migration path even in the future)
- `KeywordDetectionController`, `AudioSpectrogram`, `SpeechCommandsLabels` (custom ML keyword detectors)

## Migration Steps

### 1. Classify each VoiceML usage as transcription or voice command

Before migrating anything, separate the findings into two buckets:

- **Transcription:** the Lens consumes `eventArgs.transcription` /
  `isFinalTranscription` as free-form text — live captions, dictation, sending the
  transcript to an LLM, search query input, message composition. → Migrate to ASR (steps
  3–4).
- **Voice command:** the Lens uses VoiceML's NLP models, `enableSystemCommands`, or a
  custom ML keyword detector to recognize a **limited vocabulary** (specific words,
  intents, yes/no, "one/two/three", "echo", etc.) and trigger scene behavior. → **Cannot
  migrate to ASR.** Remove the VoiceML voice-command code and warn the user that the
  feature no longer works (step 2).

If a single file mixes both — for example, a script that uses ASR-style transcription
**and** checks an `NlpKeywordModel` response — split the work: migrate the transcription
part to ASR and remove the keyword/intent path, warning the user about the lost commands.

### 2. Remove voice-command code and warn the user

Voice commands have no working SPECS 27 path, so they cannot be carried over. **Remove**
the VoiceML keyword/intent/system-command code (see step 6 for exactly what to strip) and
tell the user verbatim — list every affected command so they know precisely what is lost:

> ⚠️ **Voice commands removed — this feature no longer works.** The following file(s) used
> VoiceML's keyword/intent matching or system commands to trigger scene behavior. ASR does
> not yet support biased / limited-vocabulary recognition, so plain transcription matching
> is not a usable substitute: short target words frequently fail to register, and
> homophones routinely fire false positives (e.g. "two" → "to" / "too", "no" → "know",
> "right" → "write"). The VoiceML voice-command code has been **removed** as part of the
> SPECS 27 migration, and these commands will no longer respond. If you need an interim
> trigger, wire the affected action to a pinch, button, or gaze instead. A keyterm-biased
> ASR option is on the roadmap; the commands can be reimplemented on ASR once it ships.
>
> Voice commands removed:
> - `<path>:<line>` — `<command / matched pattern>`
> - ...

If a command cannot be removed without breaking unrelated logic in the same file (e.g. the
handler also does non-voice work), stop and surface that specific call site to the user for
a decision rather than guessing.

### 3. API map (transcription only)

| VoiceML | ASR |
|---|---|
| `@input Asset.VoiceMLModule vmlModule` | `require("LensStudio:AsrModule")` |
| `VoiceML.ListeningOptions.create()` | `AsrModule.AsrTranscriptionOptions.create()` |
| `vmlModule.startListening(options)` | `asrModule.startTranscribing(options)` |
| `vmlModule.stopListening()` | `asrModule.stopTranscribing()` (returns `Promise<void>`) |
| `onListeningUpdate` | `options.onTranscriptionUpdateEvent` |
| `eventArgs.transcription` | `eventArgs.text` |
| `eventArgs.isFinalTranscription` | `eventArgs.isFinal` |
| `onListeningError` | `options.onTranscriptionErrorEvent` |
| `onListeningEnabled` / `onListeningDisabled` | no direct equivalent |
| `languageCode`, `speechRecognizer`, speech contexts | no direct equivalent |

### 4. TypeScript live transcription component

```typescript
@component
export class LiveTranscription extends BaseScriptComponent {
  @input transcriptText!: Text
  private asrModule = require("LensStudio:AsrModule")

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.start())
    this.createEvent("OnDestroyEvent").bind(() => this.asrModule.stopTranscribing())
  }

  private start(): void {
    const options = AsrModule.AsrTranscriptionOptions.create()
    options.silenceUntilTerminationMs = 1000
    options.mode = AsrModule.AsrMode.Balanced
    options.onTranscriptionUpdateEvent.add((e: AsrModule.TranscriptionUpdateEvent) => {
      this.transcriptText.text = e.text
      if (e.isFinal) print("FINAL: " + e.text)
    })
    options.onTranscriptionErrorEvent.add((code: AsrModule.AsrStatusCode) => print("ASR error/status: " + code))
    this.asrModule.startTranscribing(options)
  }
}
```

### 5. Behavior contracts and lifecycle

- Start ASR on `OnStartEvent` / component start, not at constructor time.
- Gate stable side effects on `eventArgs.isFinal`; only update UI from interim events.
- Preserve existing trigger names, public script methods, callbacks, UI inputs, and scene
  orchestration unless intentionally changing them.

### 6. Cleanup

Both paths end with VoiceML gone from the project:

- **Migrated transcription:** remove the VoiceML input once the ASR path replaces it.
- **Removed voice commands:** delete the keyword/intent/system-command setup — the
  `NlpKeywordModelOptions` / `NlpIntentsModelOptions` config, `enableSystemCommands`, any
  custom ML keyword detector (`KeywordDetectionController`, `AudioSpectrogram`,
  `SpeechCommandsLabels`), their `startListening` calls, and the response handlers that
  fired scene behavior. Leave the downstream action methods themselves in place if they are
  still reachable by other (non-voice) triggers; only the voice wiring is removed.

After both, remove the now-unused `VoiceMLModule` input/asset and any scripts used **only**
by the removed paths — **only after** verifying no `.scene`, `.prefab`, `.meta`, `.js`, or
`.ts` reference remains. If a single `VoiceMLModule` asset/input served both transcription
and voice commands, it can be deleted outright once neither path uses it.

### 7. Guardrails

- Do not replace `NlpKeywordModelOptions`, `NlpIntentsModelOptions`, custom ML keyword
  detectors, or `enableSystemCommands` with ASR transcription matching. It does not work
  reliably and produces silent regressions — remove the voice-command code and warn the
  user (step 2) instead.
- Do not preserve ASR side effects on every interim transcript unless the old UX
  explicitly required live updates — final transcripts are safer.
- Prefer existing scene triggers and callbacks over inventing a new orchestration API.
- If using RSG/LLMs for intent classification, also load the relevant AI/Remote Service
  skill and account for publishing permissions.

### 8. Validation

```bash
# JS syntax
find Assets -name '*.js' -print0 | xargs -0 -n 1 node --check

# TypeScript project check, if tsconfig exists
tsc -p tsconfig.json --noEmit

# transcription leftovers (should be gone — migrated to ASR)
rg -n "VoiceMLModule|VoiceML\.ListeningOptions|startListening|stopListening|onListening(Update|Enabled|Disabled|Error)|shouldReturn(Interim)?AsrTranscription" Assets *.esproj --glob '!Cache/**'

# voice-command leftovers (should be GONE — removed, not migrated)
rg -n "NlpKeyword|NlpIntents|enableSystemCommands|KeywordDetectionController|AudioSpectrogram|SpeechCommandsLabels|get(Keyword|Intent|Command|Qna)Responses" Assets *.esproj --glob '!Cache/**'
```

Device acceptance for migrated transcription:

- ASR starts on Specs without runtime errors.
- Transcribed phrases produce the same downstream behavior (captions, LLM input, etc.) as before.
- ASR errors (`NoInternet`, `Unauthenticated`, `InternalError`) are logged or surfaced without breaking the scene.
- Voice-command code is gone, the project compiles without VoiceML, and the user has been
  told those commands no longer work; any non-voice triggers for the same actions still fire.
