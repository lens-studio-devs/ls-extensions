---
name: specs-audio
description: AudioComponent on Specs — playback modes (LowPower/LowLatency), Mix-to-Snap, mic input profiles (Voice/Analysis, Echo Cancellation, Bystander Speech Rejection). Load for audio playback, ambient sound, button SFX, or mic / AsrModule use.
user-invocable: false
paths: "**/*.ts"
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Audio on Specs

Specs applies several audio behaviors automatically that differ from the standard Lens Studio platform.

## Mix to Snap

The `Mix to Snap` flag on `AudioComponent` (which routes audio into Snap recordings) is **always on** in Specs, regardless of the Inspector value. The flag is ignored on-device.

## Playback Mode

`AudioComponent.playbackMode` is **only settable from script** — there is no Inspector field for it. Specs default every component to `Audio.PlaybackMode.LowPower`.

### `LowPower` (Specs default)

Reduces device power use. Introduces playback latency. Use for ambient sound, background music, or anything where ~tens of ms of delay is acceptable.

### `LowLatency`

Minimizes latency at the cost of higher power use. Use for immediate auditory feedback — button-press SFX, hit confirmations, anything tied to user input.

```ts
// Set in an OnStartEvent handler (not onAwake — property writes belong in OnStartEvent)
// ambient / background:
this.audio.playbackMode = Audio.PlaybackMode.LowPower
// button SFX / user-input:
this.audio.playbackMode = Audio.PlaybackMode.LowLatency
```

Full copy-paste class skeletons: `references/audio-playback-examples.ts`

## Audio Input Profiles

Specs auto-applies microphone profiles based on which features the Lens uses. **No profile is applied by default** — a profile activates only when a feature that needs it is present.

| Profile | Filters applied | Triggered by |
|---|---|---|
| Analysis | Echo Cancellation (removes speaker output from mic signal) | Microphone Audio feeds (e.g. `audio-templates/audio-analyzer`) |
| Voice    | Echo Cancellation + Bystander Speech Rejection (ignores speech not from the wearer) | `LensStudio:AsrModule` use in the project (see `ls-clad:specs-asr`) |

If both Microphone Audio and `AsrModule` are used in the same Lens, the **Voice profile takes precedence** over Analysis.

## See also

- `ls-clad:build-sfx` — generate sound effects to load into AudioComponent
- `ls-clad:build-music` — generate music tracks
- `ls-clad:specs-asr` — speech-to-text on Specs (activates the Voice audio input profile)
