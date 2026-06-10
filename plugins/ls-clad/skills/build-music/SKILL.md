---
name: build-music
description: Generate musical phrases, chord progressions, beats, jingles, and short pieces via local algorithmic synthesis. Sample-free, license-clean, fully offline. Scale-degree composition, pattern-based arrangement, frequency-separated mixing rules. Outputs 44.1 kHz stereo WAV to Assets/GeneratedSFX/.
user-invocable: true
argument-hint: description of the musical piece to generate (genre, mood, tempo, length)
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Build Music — Musical Phrase / Beat / Jingle Generator

Compose a short musical piece (4–60 s) from a description: melody, harmony, rhythm. Output: 44.1 kHz stereo WAV in `Assets/GeneratedSFX/` (same folder as `/build-sfx`).

**User's request:** $ARGUMENTS

> **Looking for sound effects?** UI clicks, impacts, foley, ambient textures, and any non-pitched sound design belong in `/build-sfx`.

## Script setup, preflight, and output path rules

> See **[references/audio-gen-preflight.md](references/audio-gen-preflight.md)** for the full procedure (shared with `/build-sfx`). Script name token: `gen_music_<name>`.

Key deltas from the shared reference:
- The acoustic gate (step 5) is required here too — add it after step 4:
  ```bash
  ffmpeg -nostats -i <PROJECT_ROOT>/Assets/GeneratedSFX/<name>.wav -af volumedetect -f null - 2>&1 | grep max_volume
  ```
  Parse `max_volume: -XX.X dB`. Below `-30 dB` or absent → `status: "SILENT_OUTPUT"` with peak value and script path. A healthy render lands at `-1` to `-0.1 dB`; even a quiet ambient bed should clear `-20 dB`. `ffmpeg` missing → `status: "VERIFY_TOOL_MISSING"`.
- `WavBuilder.write` auto-detects stereo: this skill's renderer always returns `{ left, right }`, so the WAV header writes as stereo automatically.

## Engine entry point

Load the engine + music modules via the skill's barrel re-export:

```js
const ENGINE = '<ABSOLUTE_PATH_TO_BUILD_MUSIC>/tools';
const m = require(ENGINE);
```

This gives you the full audio engine (`m.audio_primitives`, `m.synth_voices`, `m.mix_bus`, etc.) plus music-only modules: `m.pattern`, `m.arrangement`, `m.renderer`, with convenience aliases `m.parseMini`, `m.scale`, `m.stack`, `m.mask`, `m.track`, `m.render`, `m.WavBuilder`.

## Pipeline overview

```
parseMini(string)      → events [{time, beats, value, velocity}]
  ↓
scale(events, scaleName, root)   → events with MIDI-note values
  ↓
mask(events, maskStr, cycles)    → subset of events (arrangement)
  ↓
track(name, voice, events, fx)   → track descriptor
  ↓
render([tracks], { bpm })         → stereo {left, right}
  ↓
masterChain  (automatic inside render)
  ↓
WavBuilder.write
```

## Mini-notation reference

Parse with `parseMini(str, { cycleBeats })`. Default `cycleBeats: 4` (one bar of 4/4).

| Syntax | Meaning |
|---|---|
| `c4 e4 g4` | Three notes, equal duration |
| `0 2 4 6` | Scale-degree pattern (use `scale()` to map to MIDI) |
| `~` | Rest |
| `[a b]` | Group: a and b each take half the parent's slot |
| `{c4, e4, g4}` | Polyphonic stack (chord hit at one time) |
| `<a b c>` | Cycle: one element per cycle index (use `cycleIndex` in opts) |
| `a*4` | Repeat 4× inside one slot |
| `a/2` | Slow by 2 (note takes 2× the slot) |
| `a@3` | Weight: this element takes 3× a regular slot |
| `a:0.7` | Velocity 0..1 (here 0.7 → MIDI velocity 89) |

Examples:
```js
m.parseMini('0 [2 4] 6 7')                 // 4 events over 4 beats; the [2 4] group splits beat 2
m.parseMini('c4 e4 g4 b4', { cycleBeats: 2 })  // same notes over 2 beats (= 8th notes)
m.parseMini('{c4, e4, g4} ~ ~ ~')          // a chord hit on beat 1, rest until end
m.parseMini('bd ~ sn ~')                    // drum pattern (use string values like 'bd', 'sn')
```

## Scale-degree composition (USE THIS, not absolute pitches)

Strongest rule for tonal coherence: compose melody and chords in **scale degrees** (`0 2 4 6`), then map them through `scale(events, scaleName, root)`. This prevents accidental out-of-key notes and lets you transpose the whole piece by changing the root.

```js
const melody = m.parseMini('0 2 4 6 4 2 0 ~');
m.scale(melody, 'pentatonicMinor', 'A3');    // 0→A3, 2→C4, 4→E4, 6→G4, etc.
```

Available scales (from `music_theory.SCALES`): `major`, `minor`, `harmonicMinor`, `melodicMinor`, `pentatonicMajor`, `pentatonicMinor`, `blues`, `dorian`, `phrygian`, `lydian`, `mixolydian`, `locrian`, `wholeTone`.

Tip: when degrees go past the top of the scale, they wrap to the next octave automatically. `0 2 4 7 9` covers more than one octave fluidly.

## Chord progressions

**Default path — `m.composeChords({ genre, seed })`.** Picks a progression, key, voicing strategy, and chord-extension policy from genre-appropriate pools. Two requests with the same vibe but different seeds produce **genuinely different chords** (different key, different changes, different voicing), not just the same chord with different effects on top.

```js
const { chords, meta } = m.composeChords({ genre: 'lofi-jazz', seed: 42 });
// chords = [{ root, type, notes: [midi...] }, ...]  — already voiced and voice-led
// meta   = { genre, seed, scale, key, progression, voicing, extension }
```

Pass an integer `seed` if you want reproducibility (regenerating the same piece, or pinning the harmony while iterating on rhythm/mix). Omit it for a fresh random pick each run.

Available genre tags: `pop`, `sad-pop`, `lofi`, `lofi-jazz`, `jazz`, `cinematic-epic`, `cinematic-melancholy`, `dreamy`, `folk`, `edm-uplift`, `dark`, `rnb`. Unknown tags fall back to `pop`. Pick the *closest* tag — vibes are described to the user in their own words, but the genre tag is what determines harmonic flavor.

To pin one axis while letting the helper vary the rest (e.g. force C major but vary the progression):
```js
const { chords } = m.composeChords({ genre: 'pop', seed, key: 'C4', scale: 'major' });
```

Other overrides: `progression` (array of roman numerals or named-progression string), `voicing` (`closeVoiced` / `spread` / `drop2` / `rootless7th` / `shellVoicing` / `wideOpen`), `extension` (`none` / `7` / `9` / `add9` / `sus2` / `sus4`), `voiceLeading: false` to disable octave-rotation voice-leading.

**To turn chords into comp events: use `m.chordEvents(chords, { voice, bars })`.** It picks the right note duration per voice — long-sustain voices (`pad`, `choirAh`) get a short gate (~45% of the bar) so their release tails decay *before* the next chord lands; piano-family voices get ~85%; plucks/mallets get the full bar. Hand-rolling `beats: 4` on a sustained pad chord causes chord N's release to bleed into chord N+1, producing accidental composite harmonies — `chordEvents` fixes this.

```js
const { chords } = m.composeChords({ genre: 'lofi-jazz', seed: 42, voice: 'electricPiano' });
const compEvents = m.chordEvents(chords, { voice: 'electricPiano', bars: 8 });
const compTrack = m.track('comp', 'electricPiano', compEvents, { fx: { reverb: 'mediumRoom', gain: 0.45 } });
```

Pass `voice` to `composeChords` so the voicing picker can also avoid pairings that beat against the voice's own detuning (e.g. `wideOpen` voicing under `pad` creates audible warble — filtered out automatically when `voice` is set).

Other `chordEvents` knobs:
- `stagger: 0.1..0.3` — beats between successive chord notes (low→high), for a "strum" or "swell" feel instead of block-chord-on-beat-1.
- `gateOverride: 0..1` — force a specific gate fraction, bypassing the voice profile.
- `barsPerChord` — default 1; set to 2 for slow ballad pacing.

**Layered comp** — for cinematic / dark / dreamy beds, a single voice often sounds hollow (strings up high + sub-bass down low with nothing in the midrange). Stack a soft secondary voice that fills the mid:

```js
const pianoEv = m.chordEvents(chords, { voice: 'piano', bars: 8, velocity: 75 });
const padEv   = m.chordEvents(chords, { voice: 'pad',   bars: 8, velocity: 50 });
tracks.push(m.track('piano', 'piano', pianoEv, { fx: { hpf: 250, lpf: 4500, reverb: 'cathedral', gain: 0.4 } }));
tracks.push(m.track('pad',   'pad',   padEv,   { fx: { hpf: 180, lpf: 2400, reverb: 'largeHall', gain: 0.20 } }));
```

**Escape hatch — `m.music_theory.buildProgression(key, scaleName, progression)`** returns raw root-position triads/7ths with no voicing or voice-leading. Use only when you need full manual control; otherwise stick with `composeChords` — it's strictly more expressive. Named progressions still available there: `I-IV-V-I`, `I-V-vi-IV`, `ii-V-I`, `I-vi-IV-V`, `I-IV-vi-V`, `i-iv-V`, `i-VI-III-VII`, `vi-IV-I-V`, `12-bar-blues`.

## Melody / lead

For a tonal piece, the foreground layer (melody / lead) usually sits on top of the chord layer. There are **three options**, in order of complexity:

### 1. `m.composeMelody({ chords, contour, scale, scaleRoot, ... })` — recommended

A real melodic line, NOT a fixed motif looped. Strong beats (beat 1 and 3 of every bar) are anchored on the *current chord's* tones — so the melody never clashes with the harmony. Weak beats use scale tones near the previous pitch for smooth stepwise motion. Phrase contour (`rising` / `falling` / `arch` / `descend-ascend`) shapes the trajectory across the whole piece.

```js
const { chords, meta } = m.composeChords({ genre: 'cinematic-epic', seed: 42, voice: 'pad' });
const keyMatch = meta.key.match(/^([A-Ga-g][#b]?)(-?\d+)$/);
const scaleRoot = keyMatch[1] + (parseInt(keyMatch[2]) + 1);  // melody an octave above key

const melodyEvents = m.composeMelody({
    chords, bars: 8, notesPerBar: 4,
    octaveShift: 1, contour: 'arch',
    scale: meta.scale, scaleRoot,
    seed: 100, restProbability: 0.18,
});
const melodyTrack = m.track('lead', 'flute', melodyEvents, {
    fx: { hpf: 400, lpf: 5000, reverb: 'largeHall', gain: 0.4 },
});
```

Knobs:
- `notesPerBar` — 4 (quarters), 8 (8ths), 16 (16ths). Higher = busier melody.
- `octaveShift` — typically 1 or 2 (melody sits above the chord register).
- `contour` — `rising`, `falling`, `arch` (default, up-then-down), `descend-ascend`, `flat`.
- `restProbability` — 0..1 chance of resting on a weak beat. 0 = continuous (busy), 0.3 = breathy.
- `scale` + `scaleRoot` — optional but recommended. Without them, weak-beat passing tones use chromatic neighbors; with them, they use diatonic scale steps which sounds smoother.

**Always pair the melody with arrangement masking** so it enters/exits (`arrangement8().a` or `.b` typically) — a melody that plays every bar from start to finish feels wallpapery.

### 2. `m.composeArpeggio({ chords, style })` — chord-tone foreground without a "tune"

Every emitted pitch is a chord tone of the current chord — by construction it cannot clash with harmony, but it's also not a real melody (no contour, no phrasing). Use for "animation on top" rather than "song with a melody." Same example as the chord progressions section above.

### 3. Hand-author with `parseMini` + `scale` — for tightly composed pieces

When you have a specific tune in mind, write it directly:
```js
const melody = m.parseMini('0 2 4 7 4 2 0 ~', { cycleBeats: 4 });
m.scale(melody, meta.scale, scaleRoot);
```
**Warning:** if the chord progression is `composeChords`-generated and changes underneath, a fixed scale-degree melody can clash on chord 2/3/4 because the pitches you picked may not be chord tones for the later chords. Either use `composeMelody` (which anchors automatically) or pick scale degrees that happen to be chord tones for every chord in the progression.

## Voice catalog

All voices live in `m.synth_voices`. Each takes `(midi, durBeats, velocity, bpm, ctx?)` and returns a Float32Array. Voices preserve their natural decay — buffer length will exceed `durBeats * 60 / bpm`.

| Voice | One-liner | Best use |
|---|---|---|
| `piano` | Inharmonic additive piano with double-decay | Jazz, lofi, ballads, **cinematic comp** |
| `electricPiano` | FM electric piano (tine-like top + warm body) | Jazz, R&B, lofi comping |
| `bell` | 4-op FM bell, long ring-out | Ear candy, intros |
| `marimba` | FM mallet, short woody decay | Ostinatos, tonal accents |
| `vibraphone` | FM with 5 Hz tremolo (motor-disk-style) | Jazz, ambient |
| `pluckString` | Delay-line pluck, bright with velocity | Harp/koto ostinatos |
| `nylonGuitar` | Delay-line pluck + body thump | Finger-style chords |
| `pad` | Detuned-saw + slow filter sweep | Warm pad bed, **cinematic body** |
| `analogBrass` | Saws + velocity-tracking filter | Fanfare, brass stabs |
| `synthBass` | Saws + sub + filter envelope | Electronic bass |
| `subBass` | Pure sine + triangle harmonic | Sub-200 Hz weight |
| `synthLead` | Three-saw stack, resonant LPF | Cut-through leads (synthwave/edm) |
| `flute` | Digital-waveguide tube, breathy | **Cinematic / emotional melody** |
| `clarinet` | Waveguide tube, woody (odd harmonics) | **Cinematic / mournful melody** |
| `choirAh` | Detuned saws + 'a' formant + vibrato | Vocal pad — use sparingly, only as a swell accent in B sections (detuned-saw character is obvious if exposed). |
| `kick` | Pitch-dropping sine + click | All genres |
| `snare` | Triangle thump + bandpassed noise | All genres |
| `hat` | Bandpassed noise (open if midi ≥ 49) | All genres |
| `tom` | Pitch-sweeping sine, tunable | Taiko fills, cinematic accents |
| `clap` | Four staggered noise bursts + tail | House, hip-hop |
| `shaker` | Filtered noise burst | Top-end groove |

**Cinematic comp recommendation:** layer `piano` (chord hits with cathedral reverb — gives harmonic definition + iconic Hans-Zimmer feel) + `pad` (sustained body underneath). There is no "strings" voice in this skill — pure-DSP synthesis can't convincingly fake bowed strings (no Helmholtz physics, no body convolution). If you need string-section character, use sampled assets, not synthesis.

## Per-track FX & mixing rules (frequency separation)

Frequency separation is the single biggest mix-quality lever. Apply these via each track's `fx` dict (passed to `mix_bus.applyFx`).

| Layer | Rule | Why |
|---|---|---|
| Sub-bass / kick low end | `lpf: 100..150` | Keep it tight and weighty; no harmonic clutter |
| Bass line | `lpf: 800..1400`, `hpf: 50` | Defined fundamental, no boom |
| Pad / strings | `hpf: 200, lpf: 3000..4500`, gain 0.15–0.30 | Pad sits mid; doesn't fight bass or lead |
| Lead / melody | `hpf: 400..600` | Cuts above pad, doesn't mud with bass |
| Drums (kick) | `lpf: 6000` (subtle), gain 0.7 | Body + click together |
| Drums (hat/snare) | `hpf: 300+` | Get them above the bass |
| Glue | `compressor: { threshold: 0.6 }` | Optional on noisy mixes |

Common reverb assignments: pad/strings/lead → `largeHall`, piano → `mediumRoom`, percussion → none or `smallRoom`, sub-bass → none.

## Arrangement (`mask`)

Static loops sound like loops. Have layers enter and exit across cycles using `mask(events, maskStr, cycles, cycleBeats)`.

```js
const a = m.arrangement.arrangement8();   // intro/A/B/outro template, 8 cycles total

const drums = m.parseMini('bd ~ sn ~', { cycleBeats: 4 });
const drumsAll = m.repeat(drums, 8);       // repeat across 8 cycles
const drumsMasked = m.mask(drumsAll, a.a, 8, 4);   // only active in section A

const pad = m.parseMini('{0,2,4} ~ ~ ~', { cycleBeats: 4 });
m.scale(pad, 'minor', 'C3');
const padAll = m.repeat(pad, 8);
const padMasked = m.mask(padAll, a.full, 8, 4);    // pad plays through

const lead = m.parseMini('~ ~ 0 2 4 ~ ~ 7', { cycleBeats: 4 });
m.scale(lead, 'minor', 'C5');
const leadAll = m.repeat(lead, 8);
const leadMasked = m.mask(leadAll, a.b, 8, 4);     // lead only in section B (climax)
```

Available masks in `m.arrangement.MASKS` and `arrangement8()` / `arrangement16()`. Or build your own with `maskFromCycles([true, true, false, ...])`.

## Humanization (defaults on)

Every track is automatically humanized:
- **Event-level timing jitter**: ±8 ms (default)
- **Velocity jitter**: ±12% of velocity range
- **Voice-level wobble**: filter cutoff and detune drift slightly per note

To disable on a specific track (e.g. for tight quantized drums): `m.track(..., { quantize: 'strict' })`.

To dial humanization up or down per track: `m.track(..., { humanize: { timeJitter: 0.015, velJitter: 0.18 } })`.

To add swing (jazz/lofi): `m.track(..., { humanize: { groove: 'swing', swingAmount: 0.16 } })`.

## Mastering

Default normalization is `'peak'` (preserves dynamics — leave it alone unless making a loud-and-flat loop).

For loudness-targeted output (radio-style):
```js
m.render(tracks, { bpm, master: { normalize: 'rms', targetRMS: 0.18 } });
```

## Worked examples

### 1. Lofi jazz — 16 s

```js
const m = require('/abs/path/to/build-music/tools');

// composeChords: genre-aware harmony, seed pins this run.
const { chords, meta } = m.composeChords({ genre: 'lofi-jazz', seed: 42, voice: 'electricPiano' });
// meta = { key, progression, voicing, scale, ... } — useful for logging

const compEvents = m.chordEvents(chords, { voice: 'electricPiano', bars: 8, velocity: 70 });

// Walking bass: roots and fifths
const bassEvents = [];
chords.forEach((ch, i) => {
    bassEvents.push({ time: i * 4 + 0, beats: 1, value: ch.root - 24, velocity: 90 });
    bassEvents.push({ time: i * 4 + 1, beats: 1, value: ch.root - 24 + 4, velocity: 80 });
    bassEvents.push({ time: i * 4 + 2, beats: 1, value: ch.root - 24 + 7, velocity: 85 });
    bassEvents.push({ time: i * 4 + 3, beats: 1, value: ch.root - 24 + 4, velocity: 75 });
});

// Soft hat groove
const hat = m.parseMini('h*8', { cycleBeats: 4 });
m.noteEvents(hat); for (const e of hat) e.value = 42;  // closed hat midi
const hats = m.repeat(hat, 4);

const tracks = [
    m.track('ep',  'electricPiano', compEvents, {
        fx: { hpf: 200, lpf: 3500, reverb: 'mediumRoom', gain: 0.45 },
        humanize: { groove: 'swing' },
    }),
    m.track('bass',    'subBass',  bassEvents, {
        fx: { lpf: 200, gain: 0.7 },
    }),
    m.track('hats',    'hat',      hats, {
        fx: { hpf: 4000, gain: 0.18 },
        humanize: { groove: 'swing', velJitter: 0.25 },
    }),
];

const out = m.render(tracks, { bpm: 80, master: { normalize: 'peak' } });
m.WavBuilder.write(out, '/abs/path/to/Assets/GeneratedSFX/lofi_jazz.wav');
```

### 2. 8-bit jingle — 8 s

```js
const melody = m.parseMini('0 2 4 7 4 2 0 ~ 7 4 0 ~', { cycleBeats: 8 });
m.scale(melody, 'major', 'C5');

const bass = m.parseMini('0 ~ 4 ~ 0 ~ 4 ~', { cycleBeats: 8 });
m.scale(bass, 'major', 'C2');

const tracks = [
    m.track('lead', (midi, db, v, bpm, ctx) => {
        // Hand-roll an 8-bit voice: pure square + bitcrush
        const b = m.audio_primitives.square(440 * Math.pow(2, (midi - 69) / 12), db * 60 / bpm + 0.05);
        m.audio_primitives.adsrExp(b, 0.001, 0.04, 0.5, 0.04, 3);
        return b;
    }, melody, { fx: { crush: 4, gain: 0.45 }, quantize: 'strict' }),
    m.track('bass', (midi, db, v, bpm, ctx) => {
        const b = m.audio_primitives.triangle(440 * Math.pow(2, (midi - 69) / 12), db * 60 / bpm + 0.05);
        m.audio_primitives.adsrExp(b, 0.001, 0.03, 0.6, 0.04, 3);
        return b;
    }, bass, { fx: { crush: 5, gain: 0.5 }, quantize: 'strict' }),
];

const out = m.render(tracks, { bpm: 120 });
m.WavBuilder.write(out, '/abs/path/to/Assets/GeneratedSFX/eight_bit_jingle.wav');
```

### 3. Cinematic full piece — chords + melody + arrangement, ~50 s

A real cinematic piece needs all three: chord progression, melody, and section-aware arrangement. The melody is what makes it sound like *music* rather than a *bed*.

```js
// 1. Chord progression. Cinematic-epic = minor key (i-VI-III-VII variants).
// Pass voice='pad' so the picker avoids voicings that beat against detuned-saw voices.
const { chords, meta } = m.composeChords({ genre: 'cinematic-epic', seed: 7, voice: 'pad' });

const a = m.arrangement.arrangement16();  // intro / A / B / outro section masks
const BARS = 16;  // arrangement16 expects 16 cycles; cycleBeats = 4

// 2. Comp layer: piano (cathedral reverb — harmonic definition) + pad (sustained body).
const pianoEv = m.chordEvents(chords, { voice: 'piano', bars: BARS, velocity: 75 });
const pianoMasked = m.mask(pianoEv, a.full, BARS, 4);                 // piano throughout

const padEv = m.chordEvents(chords, { voice: 'pad', bars: BARS, velocity: 55 });
const padMasked = m.mask(padEv, a.full, BARS, 4);                     // pad throughout

// 3. Sub bass: one note per chord, two octaves below — loop across all bars
const subEv = [];
for (let bar = 0; bar < BARS; bar++) {
    const ch = chords[bar % chords.length];
    subEv.push({ time: bar * 4, beats: 4, value: ch.root - 12, velocity: 95 });
}
const subMasked = m.mask(subEv, a.a, BARS, 4);                        // sub enters in A section

// 4. MELODY: chord-anchored, arch contour, diatonic passing tones.
const keyMatch = meta.key.match(/^([A-Ga-g][#b]?)(-?\d+)$/);
const scaleRoot = keyMatch[1] + (parseInt(keyMatch[2]) + 1); // melody one octave above key
const melodyEv = m.composeMelody({
    chords, bars: BARS, notesPerBar: 4,
    octaveShift: 1, contour: 'arch',
    scale: meta.scale, scaleRoot,
    seed: 8, restProbability: 0.20,
});
const melodyMasked = m.mask(melodyEv, a.b, BARS, 4);                  // melody only in B (climax)

// 5. Percussion — taiko-style toms in B section
const tomEv = m.parseMini('0 ~ ~ ~ ~ ~ 0 ~', { cycleBeats: 4 });
for (const e of tomEv) e.value = 45;
const tomFull = m.repeat(tomEv, BARS, 4);  // 8 bar-long cycles, each offset by 4 beats
const tomMasked = m.mask(tomFull, a.b, BARS, 4);

const tracks = [
    m.track('piano',  'piano',   pianoMasked,  { fx: { hpf: 250, lpf: 4500, reverb: 'cathedral', gain: 0.4 } }),
    m.track('pad',    'pad',     padMasked,    { fx: { hpf: 200, lpf: 2400, reverb: 'largeHall', gain: 0.22 } }),
    m.track('sub',    'subBass', subMasked,    { fx: { lpf: 130, gain: 0.6 } }),
    m.track('melody', 'flute',   melodyMasked, { fx: { hpf: 400, lpf: 5000, reverb: 'largeHall', gain: 0.38 } }),
    m.track('tom',    'tom',     tomMasked,    { fx: { lpf: 1800, gain: 0.45, reverb: 'largeHall' } }),
];

const out = m.render(tracks, { bpm: 75 });
m.WavBuilder.write(out, '/abs/path/to/Assets/GeneratedSFX/cinematic_piece.wav');
```

The arrangement gives the piece **shape**: intro (piano + pad only) → A section (sub bass enters) → B section / climax (flute melody + taiko toms enter) → outro (decay). Without these section masks, all five layers play start-to-finish and the piece feels static.

### 4. Ambient pad-only — 30 s

```js
// Slow-moving chord pad, no rhythm. Heavy reverb. Just one track.
const chord = [m.music_theory.noteToMidi('A3'), m.music_theory.noteToMidi('C4'), m.music_theory.noteToMidi('E4'), m.music_theory.noteToMidi('G4')];
const events = chord.map(note => ({ time: 0, beats: 14, value: note, velocity: 70 }));
// Crossfade to next chord at beat 14
const chord2 = [m.music_theory.noteToMidi('F3'), m.music_theory.noteToMidi('A3'), m.music_theory.noteToMidi('C4'), m.music_theory.noteToMidi('E4')];
chord2.forEach(note => events.push({ time: 14, beats: 14, value: note, velocity: 65 }));

const tracks = [
    m.track('pad', 'choirAh', events, {
        fx: { hpf: 150, lpf: 3500, reverb: 'cathedral', gain: 0.35 },
    }),
];

const out = m.render(tracks, { bpm: 60, duration: 30 });
m.WavBuilder.write(out, '/abs/path/to/Assets/GeneratedSFX/ambient_pad.wav');
```

## Anti-synthetic checklist

Before writing the WAV, confirm you did the relevant items:

- [ ] **Harmony uses `composeChords({ genre, seed })`** for any tonal piece — not `buildProgression()` directly. The genre-aware composer varies key, progression, voicing, and extensions across runs so two pieces with the same vibe don't share identical chords.
- [ ] **Melody uses `composeMelody({ chords, ... })`** for any piece that needs a foreground tune — not a fixed `parseMini` motif looped over a moving progression. Mask it through `arrangement8()` sections so it enters and exits rather than playing every bar.
- [ ] **Comp events via `m.chordEvents(chords, { voice, bars })`**, not hand-rolled `beats: 4` event arrays. Pass the same `voice` to `composeChords` so it can filter voicings that beat against the comp voice.
- [ ] **Cinematic comp uses `piano` + `pad` layered.** There is no `analogStrings` voice in this skill (removed — pure-DSP synthesis can't convincingly fake bowed strings). Piano with cathedral reverb + pad underneath delivers actual cinematic gravitas.
- [ ] **Composition uses scale degrees** (`0 2 4 6` + `scale()`), not absolute pitch names where it doesn't matter.
- [ ] **Humanization is enabled** (default) on at least every melodic and pad track. Only use `quantize: 'strict'` for 8-bit or hand-coded tight grids.
- [ ] **Mask-based arrangement** for any piece longer than 8 s — sections must enter/exit, not loop unchanged.
- [ ] **Per-track EQ applied** — HPF + LPF rules above, not a flat full-range mix.
- [ ] **Voices fit the genre** — `electricPiano` (not `synthLead`) for lofi; `pluckString` (not `bell`) for folk; `kick` + `snare` + `hat` together for any beat.
- [ ] **Reverb on tonal tracks** — even small (`smallRoom`) on dry pianos makes a huge difference.
- [ ] **No clipping** — master chain handles soft-limit, but check peak in the WavBuilder log line if you're stacking 6+ tracks.

## Common failure modes

- **"Everything is muddy"** — Missing HPF on midrange tracks. Apply `hpf: 300` to pad, `hpf: 500` to lead, `hpf: 4000` to hats.
- **"Sounds robotic / static"** — Humanization disabled or all `quantize: 'strict'`. Re-enable defaults.
- **"It's just a loop"** — No arrangement masks. Use `arrangement8()` and route different tracks through different sections.
- **"The piano is plinky"** — Used a sharp ADSR release that killed the natural decay. Don't pass `quantize: 'strict'`, don't manually re-envelope the voice output.
- **"Stops abruptly"** — Manually set `duration` lower than the longest event's release tail. Either leave `duration` unset (renderer estimates) or add 3+ seconds of tail.
- **"The melody on top sounds wrong / clashes with the chords"** — A hand-rolled scale-degree lead is looping the same motif over a moving progression; non-chord-tones land on strong beats. Use `composeMelody({ chords, scale, scaleRoot })` instead (see Melody / lead section for how strong-beat anchoring works).
- **"Pad chords sound smeared, woozy, or out of tune"** — Long-release voices playing full-bar chords back-to-back cause release-tail bleed. Use `m.chordEvents(chords, { voice })` — see the chordEvents paragraph for gate details.
- **"Cinematic/dark mix sounds hollow"** — Comp voice (strings) is high, bass is sub-low, nothing in between. Add a soft `pad` layer at ~50% velocity to fill the 200–500 Hz mid.
- **"The piece sounds like a static loop / no progression or song shape"** — Likely no melody and no arrangement masking. Add `composeMelody` for a foreground tune and route different layers through `arrangement8()` sections so they enter and exit.
- **"Top voice of the chord layer reads as melody, but I want one anyway"** — This was previously documented as a problem; it's actually a feature of harmonic music. If you don't want it, see the textural / atmospheric branch (`granular.*` from build-sfx) — but most music *should* have a moving top voice. Don't reach for `voicingMode: 'topAnchored'` unless the piece is meant to be a held bed with no progression.
