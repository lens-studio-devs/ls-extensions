---
name: build-sfx
description: Generate non-pitched sound effects (UI, impacts, sweeps, foley, ambient textures, retro 8-bit) via local algorithmic synthesis. Outputs 44.1 kHz WAV to Assets/GeneratedSFX/. For musical phrases or chord progressions use /build-music instead.
user-invocable: true
argument-hint: description of the sound effect to generate
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Build SFX — Sound Effect Generator

**User's request:** $ARGUMENTS

> **Music instead?** Use `/build-music` for pitched phrases, chords, or beats.

## Script setup & preflight (MANDATORY)

See [`references/asset-gen-preflight.md`](references/asset-gen-preflight.md) for: script location and `rm -f` guard, `node --version` probe, relative-path lint, post-run WAV verification, and output path construction.

## CRITICAL: Output Path Rules

Every generated WAV MUST land at `<PROJECT_ROOT>/Assets/GeneratedSFX/<name>.wav`. Not the `Assets/` root. Not `tempAssetGen/` (that's for the script, not the output). The Lens references SFX via `requireAsset('../GeneratedSFX/<name>.wav')`.

For the absolute-path construction pattern (`PROJECT_ASSETS_SFX`, `fs.mkdirSync`, `path.join`), see [`references/asset-gen-preflight.md`](references/asset-gen-preflight.md).

`WavBuilder.write` auto-detects stereo: pass either a Float32Array (mono) or `{ left, right }` (stereo) and the right header is written automatically. SFX with a `reverb` step or a `pan` step will be stereo; others stay mono.

## Engine entry point

Load the engine via an absolute `require` to this skill's `tools/`:

```js
const ENGINE = '<ABSOLUTE_PATH_TO_PROJECT>/<repo>/plugins/ls-clad/skills/build-sfx/tools';
const audio = require(ENGINE);
```

Exported namespaces: `audio.audio_primitives`, `audio.osc_models`, `audio.synth_voices`, `audio.humanize`, `audio.mix_bus`, `audio.ir_generator`, `audio.granular`, `audio.transient_designer`, plus the flat re-exports of audio_primitives (`audio.sine`, `audio.lowPass2`, etc.) and `audio.WavBuilder`.

## Categories with recipes

Each recipe is ~5–10 lines; combine and tune parameters.

### UI sounds

UI sounds are short (< 200 ms), bright, and predictable. They SHOULD sound synthetic — that's the genre.

```js
// Click — short triangle blip with sharp envelope
function click() {
    const b = audio.sweep(2000, 1500, 0.02, 'triangle', 'exponential');
    audio.adsrExp(b, 0.001, 0.005, 0, 0.014, 4);
    audio.fadeOut(b, 0.003);
    return b;
}

// Blip — slightly longer FM tone
function blip() {
    const b = audio.osc_models.fmOperator(900, 0.08, 3, 4, (t) => Math.exp(-15 * t));
    audio.adsrExp(b, 0.001, 0.02, 0, 0.06, 3);
    return audio.mix_bus.applyFx(b, { hpf: 150, gain: 0.7 });
}

// Success chime — major-triad arpeggio of mallet hits
function success() {
    const a = audio.synth_voices.bell(72, 0.5, 110, 240);  // C5
    const b = audio.synth_voices.bell(76, 0.5, 110, 240);  // E5
    const c = audio.synth_voices.bell(79, 0.5, 110, 240);  // G5
    const out = new Float32Array(Math.floor(0.9 * audio.SAMPLE_RATE));
    audio.addInto(out, a, 0, 0.7);
    audio.addInto(out, b, Math.floor(0.08 * audio.SAMPLE_RATE), 0.6);
    audio.addInto(out, c, Math.floor(0.16 * audio.SAMPLE_RATE), 0.55);
    return audio.mix_bus.applyFx(out, { reverb: 'smallRoom', gain: 0.8 });
}

// Error — descending dissonant tone, lightly distorted
function error() {
    const b = audio.sweep(380, 220, 0.4, 'sawtooth', 'exponential');
    audio.adsrExp(b, 0.005, 0.1, 0.4, 0.3, 3);
    return audio.mix_bus.applyFx(b, { distort: 8, lpf: 1400, gain: 0.6 });
}
```

### Impacts

Real impacts have two parts: a sharp transient (knuckle/glass/wood) and a tonal/noisy body (flesh/shards/ring). Use `transient_designer.designImpact` to layer them.

```js
// Punch
audio.transient_designer.designImpact({
    attack: { kind: 'click', durationMs: 8, lpHz: 5000, hpHz: 400, gain: 0.6 },
    body:   { kind: 'thump', freq: 90, decay: 0.18, lpHz: 700, gain: 0.85, dist: 1.2 },
});

// Glass break — bright attack + ringing body of bandpassed noise
const attack = audio.transient_designer.designImpact({
    attack: { kind: 'snap', durationMs: 15, centerHz: 5500, lpHz: 9000, gain: 0.8 },
    body:   { kind: 'noise', decay: 0.35, hpHz: 3500, lpHz: 9000, gain: 0.5 },
});
// Add bell-like shards
const shard1 = audio.synth_voices.bell(86, 0.6, 80, 240);
const shard2 = audio.synth_voices.bell(91, 0.6, 70, 240);
const out = new Float32Array(audio.SAMPLE_RATE * 0.6);
audio.addInto(out, attack, 0, 1.0);
audio.addInto(out, shard1, Math.floor(0.02 * audio.SAMPLE_RATE), 0.25);
audio.addInto(out, shard2, Math.floor(0.04 * audio.SAMPLE_RATE), 0.2);
return audio.mix_bus.applyFx(out, { hpf: 200, reverb: 'mediumRoom', gain: 0.85 });

// Wood knock
audio.transient_designer.designImpact({
    attack: { kind: 'click', durationMs: 6, lpHz: 4000, hpHz: 500, gain: 0.5 },
    body:   { kind: 'tonal', freq: 280, partials: 4, decay: 0.18, hpHz: 100, lpHz: 4000, gain: 0.7 },
});

// Metal clank — tonal body with longer ring + slight reverb
const m = audio.transient_designer.designImpact({
    attack: { kind: 'click', durationMs: 5, lpHz: 8000, hpHz: 1500, gain: 0.55 },
    body:   { kind: 'tonal', freq: 720, partials: 6, decay: 0.6, hpHz: 400, lpHz: 6000, gain: 0.6 },
});
return audio.mix_bus.applyFx(m, { reverb: 'plate' });
```

### Sweeps

```js
// Laser zap — fast exponential downward sweep
const b = audio.sweep(2200, 250, 0.25, 'sawtooth', 'exponential');
audio.adsrExp(b, 0.001, 0.05, 0.6, 0.15, 3);
return audio.mix_bus.applyFx(b, { distort: 3, lpf: 4500, gain: 0.7 });

// Whoosh — filtered noise rising in pitch via filter sweep
const n = audio.whiteNoise(0.4);
audio.lowPassSweep(n, 400, 6500, 1.5, 'exponential');
audio.adsrExp(n, 0.05, 0.1, 0.7, 0.2, 2);
return audio.mix_bus.applyFx(n, { hpf: 200, reverb: 'plate', gain: 0.6 });

// Riser — pitched sweep + filter sweep + noise layer
const tone = audio.sweep(80, 1200, 1.8, 'sawtooth', 'exponential');
const noise = audio.whiteNoise(1.8, 0.5);
audio.lowPassSweep(noise, 800, 6000, 1, 'linear');
const sum = audio.mix([tone, noise], [0.5, 0.4]);
audio.adsrExp(sum, 0.05, 0.1, 0.95, 0.05, 2);
return audio.mix_bus.applyFx(sum, { reverb: 'largeHall', gain: 0.75 });

// Power-down faller
const b2 = audio.sweep(900, 80, 0.7, 'square', 'exponential');
audio.adsrExp(b2, 0.001, 0.15, 0.5, 0.3, 3);
return audio.mix_bus.applyFx(b2, { distort: 2, lpf: 3000, gain: 0.6 });
```

### Foley

Foley = textural sound effects of real-world objects (footsteps, cloth, water, paper). Use `granular.grainCloud` for textures and stack short pulses for one-shot foley.

```js
// Footstep — short low transient + dust noise
const thud = audio.transient_designer.designImpact({
    attack: { kind: 'click', durationMs: 5, lpHz: 1200, gain: 0.6 },
    body:   { kind: 'thump', freq: 60, decay: 0.12, lpHz: 400, gain: 0.5 },
});
const dust = audio.granular.grainCloud({
    source: 'pink', duration: 0.15, grainSizeMs: 8, density: 90, panSpread: 0.3,
    filter: { type: 'hp', freq: 2200, Q: 0.6 },
});
const out = audio.audio_primitives.stereoFromMono(thud);
// Mix dust under thud
for (let i = 0; i < dust.left.length; i++) { out.left[i] += dust.left[i] * 0.25; out.right[i] += dust.right[i] * 0.25; }
return out;

// Cloth rustle — short bandpassed pink-noise grain cloud
return audio.granular.grainCloud({
    source: 'pink', duration: 0.4, grainSizeMs: 18, density: 130, ampJitter: 0.6,
    filter: { type: 'bp', freq: 2400, Q: 1.5 }, panSpread: 0.4,
});

// Paper crumple — denser, sharper
return audio.granular.grainCloud({
    source: 'white', duration: 0.5, grainSizeMs: 9, density: 220, pitchSpread: 6,
    filter: { type: 'hp', freq: 3500, Q: 0.7 }, panSpread: 0.5,
});

// Water drop — pitched click descending into ring
const drop = audio.sweep(2400, 1100, 0.05, 'sine', 'exponential');
audio.adsrExp(drop, 0.001, 0.01, 0, 0.04, 4);
const ring = audio.osc_models.fmOperator(1400, 0.25, 1, 1, (t) => Math.exp(-12 * t));
audio.adsrExp(ring, 0.001, 0.02, 0.3, 0.22, 3);
const out2 = new Float32Array(audio.SAMPLE_RATE * 0.3);
audio.addInto(out2, drop, 0, 0.8);
audio.addInto(out2, ring, Math.floor(0.01 * audio.SAMPLE_RATE), 0.5);
return audio.mix_bus.applyFx(out2, { reverb: 'smallRoom', gain: 0.7 });
```

### Ambient textures

For drones longer than a second, ALWAYS run `humanize.ampWobble` and use the granular preset functions. Static drones sound synthetic. Moving drones sound alive.

```js
// Drone — sine + detuned sine + ampWobble + reverb
const a = audio.sine(110, 6, 0.5);
const b = audio.sine(110 * 1.005, 6, 0.4); // slight detune for chorus shimmer
const c = audio.sine(220, 6, 0.25);
const mix = audio.mix([a, b, c], [0.5, 0.4, 0.3]);
audio.humanize.ampWobble(mix, 0.35, 0.18);
audio.fadeIn(mix, 0.4); audio.fadeOut(mix, 0.5);
return audio.mix_bus.applyFx(mix, { hpf: 60, lpf: 2500, reverb: 'largeHall', gain: 0.5 });

// Wind — preset
return audio.granular.windTexture(6, 0.7);

// Rain — preset
return audio.granular.rainTexture(6, 0.6);

// Crowd murmur (background ambience)
return audio.granular.crowdMurmur(6, 0.45);

// Room tone — extremely subtle background presence
return audio.granular.roomTone(6);

// Distant thunder — brown-noise rumble bursts
return audio.granular.thunderRumble(5);
```

### Retro / 8-bit

Bitcrush + square waves + simple FM. These are the one category where pure synthesis IS the goal — keep them lo-fi.

```js
// 8-bit blip
const b = audio.square(880, 0.08);
audio.adsrExp(b, 0.001, 0.04, 0.4, 0.04, 3);
return audio.mix_bus.applyFx(b, { crush: 4, gain: 0.5 });

// Coin pickup — two square notes ascending, crushed
const a = audio.square(988, 0.06); audio.adsrExp(a, 0.001, 0.02, 0.5, 0.04, 3);
const c = audio.square(1320, 0.18); audio.adsrExp(c, 0.001, 0.04, 0.6, 0.14, 3);
const out = new Float32Array(audio.SAMPLE_RATE * 0.26);
audio.addInto(out, a, 0, 0.6);
audio.addInto(out, c, Math.floor(0.06 * audio.SAMPLE_RATE), 0.55);
return audio.mix_bus.applyFx(out, { crush: 4, gain: 0.55 });

// Jump — quick upward sweep, square wave, crushed
const jump = audio.sweep(440, 880, 0.15, 'square', 'exponential');
audio.adsrExp(jump, 0.001, 0.05, 0.5, 0.1, 3);
return audio.mix_bus.applyFx(jump, { crush: 5, gain: 0.55 });
```

## FX chain reference

Pass to `audio.mix_bus.applyFx(buf, fx)`. The chain order is fixed inside `applyFx`; specifying a key means "apply that step." Order:

`hpf → lpf → bpf → vowel → distort → crush → phaser → delay → reverb → compressor → gain → pan`

| Key | Value form | Notes |
|---|---|---|
| `hpf` | `freq` or `{ freq, Q }` | High-pass. Default Q 0.707 (maximally flat). |
| `lpf` | `freq` or `{ freq, Q }` | Low-pass. |
| `bpf` | `center` or `{ center, Q }` | Band-pass. Q ~1 wide, 4+ narrow. |
| `vowel` | `'a'\|'e'\|'i'\|'o'\|'u'` or `{ vowel, mix }` | Three-band formant. |
| `distort` | `amount` or `{ amount }` | tanh-based; 1 mild, 30+ extreme. |
| `crush` | `bits` or `{ bits }` | 1–8 retro; 12+ subtle. |
| `phaser` | `{ rate, depth, stages }` | Allpass sweep. |
| `delay` | `{ time, feedback, wet }` | Tape delay. |
| `reverb` | preset name or `{ duration, roomSize, hfDamping, wet }` | Convolution. Presets: `smallRoom`, `mediumRoom`, `largeHall`, `cathedral`, `plate`, `spring`. Promotes mono → stereo. |
| `compressor` | `{ threshold, makeup }` | Soft limiter. |
| `gain` | linear multiplier | |
| `pan` | -1..+1 | Constant-power. Promotes mono → stereo. |

## Mixing rules for SFX

- Always HPF below 80 Hz unless the SFX IS sub-bass (kick, sub-thump). Stray rumble eats headroom.
- Always end with a 5–10 ms `fadeOut` if your envelope didn't already. Tail clicks are the most common bug.
- One-shots > 1 s: run `humanize.ampWobble(buf, 0.4, 0.08)` to prevent the "static drone" smell.
- For impactful SFX, layer attack + body. A single sweep ≠ a punch.

## Anti-synthetic checklist

Before writing the WAV, check that you did at least the relevant ones for the request:

- [ ] **Impact-style SFX** → used `transient_designer.designImpact` or hand-rolled attack + body layers.
- [ ] **Drones / pads / ambients longer than 1 s** → ran `humanize.ampWobble` and/or used a `granular.*` texture.
- [ ] **Reverb where appropriate** → used `mix_bus.applyFx({ reverb: ... })` (convolution IR) instead of bare `delay`.
- [ ] **Pitched body** → has at least a hint of natural decay (don't truncate ringing tails with sharp ADSR releases).
- [ ] **Stereo movement on textures** → granular presets do this automatically; manual stereo via `panMono`.
- [ ] **No DC offset / clipping** → masterChain handles it but check peak when in doubt.

## Common failure modes

- **Click at the end of the buffer** — Missing `fadeOut` or zero-length release in the ADSR. Always `fadeOut(buf, 0.005)` as a final step.
- **DC offset whoosh on play** — Asymmetric distortion or filter ringing. `audio.removeDC(buf)` before write.
- **Output too quiet** — Single-layer ADSR with `sustainLevel: 0.1`. Increase sustain, or run through `mix_bus.applyFx({ gain: 1.5 })` and let the master chain handle headroom.
- **Output too loud / clipped** — Stacking 4+ sines/saws unscaled. Per-layer gains should sum near 1.0; the master chain soft-limits but you'll hear it.

## Script scaffold

After assembling your sound via the recipes above, finalize with:

```js
const result = render();
audio.mix_bus.masterChain(result, { normalize: 'peak' });
audio.WavBuilder.write(result, path.join(PROJECT_ASSETS_SFX, '<name>.wav'));
```

For the full script setup pattern (path construction, `rm -f` guard, node preflight), see [`references/asset-gen-preflight.md`](references/asset-gen-preflight.md).
