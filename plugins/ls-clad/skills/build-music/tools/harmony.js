// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// harmony.js — Genre-aware chord progression composer.
//
// Smart-default helper that picks a progression, key, voicing, and extensions
// from a genre tag, seeded for reproducibility. Layers on top of music_theory
// (which is intentionally low-level and deterministic) to produce harmonically
// varied output across runs without the caller having to make every decision.
//
//   const { chords, meta } = composeChords({ genre: 'lofi-jazz', seed: 42 });
//
// Returns:
//   chords: [{ root, type, notes: [midi...] }, ...] — voiced and voice-led
//   meta:   { genre, seed, scale, key, progression, voicing, extension }
//
// All knobs are overridable: pass { progression, key, voicing, extension, scale }
// to pin any individual axis. Voice leading can be disabled with voiceLeading: false.

const mt = require('../../build-sfx/tools/music_theory');

// Tiny deterministic PRNG (mulberry32). Same seed → same sequence.
function rng(seed) {
    let s = (seed >>> 0) || 1;
    return function() {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function pick(arr, r) {
    return arr[Math.floor(r() * arr.length)];
}

// ─── Genre catalog ────────────────────────────────────────────
//
// Each genre defines pools of musically idiomatic choices. The composer picks
// from each pool with the seeded RNG. Progressions are arrays of roman numerals
// in the syntax supported by music_theory.parseRoman: I/i (major/minor triad),
// V7 (dom7), ii7 (min7), Imaj7 (maj7), Isus2/Isus4, etc.

const GENRES = {
    pop: {
        scales: ['major'],
        keys: ['C4', 'D4', 'F4', 'G4', 'A3', 'Bb3', 'E3'],
        progressions: [
            ['I', 'V', 'vi', 'IV'],
            ['vi', 'IV', 'I', 'V'],
            ['I', 'vi', 'IV', 'V'],
            ['I', 'IV', 'vi', 'V'],
            ['IV', 'I', 'V', 'vi'],
            ['I', 'V', 'IV', 'V'],
            ['vi', 'V', 'IV', 'V'],
        ],
        extensions: ['none', 'none', 'none', 'add9'],
        voicings: ['closeVoiced', 'closeVoiced', 'spread'],
    },
    'sad-pop': {
        scales: ['minor'],
        keys: ['A3', 'D3', 'E3', 'C3', 'F#3', 'B3', 'G3'],
        progressions: [
            ['i', 'VI', 'III', 'VII'],
            ['i', 'VII', 'VI', 'VII'],
            ['i', 'iv', 'VI', 'V'],
            ['i', 'III', 'VII', 'VI'],
            ['VI', 'III', 'VII', 'i'],
            ['i', 'VI', 'iv', 'V'],
        ],
        extensions: ['none', 'none', 'add9', '7'],
        voicings: ['closeVoiced', 'spread'],
    },
    lofi: {
        scales: ['major'],
        keys: ['Eb4', 'F4', 'Bb3', 'G4', 'Ab3', 'Db4', 'C4'],
        progressions: [
            ['Imaj7', 'iii7', 'vi7', 'IVmaj7'],
            ['Imaj7', 'vi7', 'ii7', 'V7'],
            ['IVmaj7', 'iii7', 'ii7', 'Imaj7'],
            ['ii7', 'V7', 'Imaj7', 'vi7'],
            ['Imaj7', 'IVmaj7', 'iii7', 'vi7'],
            ['vi7', 'ii7', 'V7', 'Imaj7'],
        ],
        extensions: ['none', 'none', 'add9'],
        voicings: ['drop2', 'rootless7th', 'spread'],
    },
    'lofi-jazz': {
        scales: ['major'],
        keys: ['Eb4', 'Bb3', 'F4', 'Ab3', 'Db4', 'G3'],
        progressions: [
            ['ii7', 'V7', 'Imaj7', 'vi7'],
            ['Imaj7', 'vi7', 'ii7', 'V7'],
            ['iii7', 'vi7', 'ii7', 'V7'],
            ['Imaj7', 'iii7', 'ii7', 'V7'],
            ['vi7', 'ii7', 'V7', 'iii7'],
        ],
        extensions: ['none', 'add9', '9'],
        voicings: ['rootless7th', 'drop2', 'shellVoicing'],
    },
    jazz: {
        scales: ['major'],
        keys: ['Bb3', 'F4', 'Eb4', 'C4', 'Ab3', 'G3', 'D4'],
        progressions: [
            ['ii7', 'V7', 'Imaj7', 'vi7'],
            ['Imaj7', 'vi7', 'ii7', 'V7'],
            ['iii7', 'vi7', 'ii7', 'V7'],
            ['Imaj7', 'iii7', 'IVmaj7', 'V7'],
            ['ii7', 'V7', 'iii7', 'vi7'],
            ['Imaj7', 'iii7', 'vi7', 'ii7'],
        ],
        extensions: ['none', '9', 'add9'],
        voicings: ['rootless7th', 'drop2', 'shellVoicing'],
    },
    'cinematic-epic': {
        scales: ['minor', 'harmonicMinor'],
        keys: ['D3', 'A3', 'E3', 'C3', 'F#3', 'G3', 'B3'],
        progressions: [
            ['i', 'VI', 'III', 'VII'],
            ['i', 'iv', 'VII', 'III'],
            ['i', 'V', 'VI', 'iv'],
            ['VI', 'VII', 'i', 'i'],
            ['i', 'VII', 'VI', 'V'],
            ['iv', 'VI', 'III', 'VII'],
        ],
        extensions: ['none', 'add9'],
        voicings: ['closeVoiced', 'spread'],
        // Note: topAnchored was previously the default here. Removed — cinematic
        // music has harmonic motion, and pinning the top voice killed the
        // chord-progression feel. Pass voicingMode: 'topAnchored' explicitly only
        // for true ambient/textural beds.
    },
    'cinematic-melancholy': {
        scales: ['minor'],
        keys: ['F#3', 'B3', 'D3', 'G3', 'C#3', 'A3', 'E3'],
        progressions: [
            ['i', 'VI', 'iv', 'VII'],
            ['i', 'iv', 'i', 'V'],
            ['i', 'III', 'VII', 'VI'],
            ['iv', 'i', 'V', 'i'],
            ['i', 'iv', 'VII', 'VI'],
        ],
        extensions: ['add9', 'none', 'sus2'],
        voicings: ['closeVoiced', 'spread'],
    },
    dreamy: {
        scales: ['major'],
        keys: ['F4', 'C4', 'G4', 'D4', 'A3', 'E4'],
        progressions: [
            ['Imaj7', 'IVmaj7', 'iii7', 'vi7'],
            ['Imaj7', 'IVmaj7', 'Imaj7', 'IVmaj7'],
            ['IVmaj7', 'Imaj7', 'vi7', 'iii7'],
            ['vi7', 'IVmaj7', 'Imaj7', 'iii7'],
            ['Imaj7', 'iii7', 'IVmaj7', 'Imaj7'],
        ],
        extensions: ['add9', 'sus2', 'add9'],
        voicings: ['closeVoiced', 'spread', 'drop2'],
    },
    folk: {
        scales: ['major'],
        keys: ['G3', 'D3', 'C4', 'A3', 'E3', 'F4'],
        progressions: [
            ['I', 'IV', 'V', 'I'],
            ['I', 'V', 'IV', 'I'],
            ['I', 'vi', 'IV', 'V'],
            ['I', 'IV', 'I', 'V'],
            ['I', 'IV', 'vi', 'V'],
            ['I', 'V', 'vi', 'IV'],
        ],
        extensions: ['none', 'none', 'sus4', 'sus2'],
        voicings: ['closeVoiced', 'spread'],
    },
    'edm-uplift': {
        scales: ['minor'],
        keys: ['A3', 'C3', 'F3', 'G3', 'E3', 'D3'],
        progressions: [
            ['i', 'VI', 'III', 'VII'],
            ['i', 'VII', 'VI', 'V'],
            ['vi', 'IV', 'I', 'V'],
            ['i', 'III', 'VII', 'VI'],
            ['VI', 'VII', 'i', 'V'],
        ],
        extensions: ['none', 'add9'],
        voicings: ['closeVoiced', 'spread'],
    },
    dark: {
        scales: ['minor', 'harmonicMinor'],
        keys: ['D3', 'A3', 'E3', 'C3', 'F3', 'B3'],
        progressions: [
            ['i', 'iv', 'V', 'i'],
            ['i', 'VI', 'V', 'i'],
            ['i', 'VII', 'VI', 'V'],
            ['iv', 'V', 'i', 'i'],
            ['i', 'iv', 'VII', 'V'],
        ],
        extensions: ['none', 'none', '7'],
        voicings: ['closeVoiced', 'shellVoicing'],
    },
    rnb: {
        scales: ['major'],
        keys: ['Eb4', 'F4', 'Bb3', 'Ab3', 'C4', 'G3'],
        progressions: [
            ['Imaj7', 'iii7', 'vi7', 'ii7'],
            ['Imaj7', 'vi7', 'IVmaj7', 'V7'],
            ['ii7', 'V7', 'iii7', 'vi7'],
            ['Imaj7', 'IVmaj7', 'iii7', 'vi7'],
            ['vi7', 'V7', 'IVmaj7', 'iii7'],
        ],
        extensions: ['9', 'add9', '7'],
        voicings: ['rootless7th', 'drop2', 'spread'],
    },
};

// ─── Voice profiles (sustain behavior per voice) ──────────────
//
// Used by chordEvents to pick the right note gate (duration) per voice.
// Long-sustain voices (pad, choirAh) need a *shorter* gate so
// their long release tails don't bleed into the next chord and smear the
// harmony. Short voices and plucks can use the full bar — their natural decay
// handles the rest.

const VOICE_PROFILES = {
    // Heavy sustain + long release — shorten the gate aggressively.
    pad: { sustain: 'long' },
    choirAh: { sustain: 'long' },
    analogBrass: { sustain: 'long' },
    // Medium — natural decay covers the rest of the bar.
    piano: { sustain: 'medium' },
    electricPiano: { sustain: 'medium' },
    vibraphone: { sustain: 'medium' },
    bell: { sustain: 'medium' },
    flute: { sustain: 'medium' },
    clarinet: { sustain: 'medium' },
    synthLead: { sustain: 'medium' },
    synthBass: { sustain: 'medium' },
    subBass: { sustain: 'medium' },
    // Plucks / mallets — fast decay; full bar is fine.
    pluckString: { sustain: 'short' },
    nylonGuitar: { sustain: 'short' },
    marimba: { sustain: 'short' },
};

// Fraction of the bar a chord note actually plays for, per sustain bias.
// The renderer's natural release tail fills the remainder. Long-sustain
// voices need a much smaller gate or they bleed into the next chord.
const GATE_FACTOR = {
    long:   0.45,
    medium: 0.85,
    short:  1.0,
};

// Voices that don't pair well with extra-wide voicings (each voice already
// detunes/spreads internally; layering wideOpen on top exaggerates beating
// and creates a hollow mid).
const HEAVY_VOICES_FOR_VOICING = new Set(['pad', 'choirAh', 'analogBrass']);

// ─── Voicing strategies ───────────────────────────────────────
//
// Each takes a root-position MIDI array and returns a reordered/octave-shifted
// MIDI array. Voicings shape the chord's vertical layout (close vs. spread,
// rootless for jazz, drop-2 for warm comping, etc.).

const VOICINGS = {
    closeVoiced(notes) {
        return notes.slice();
    },
    spread(notes) {
        // Drop the root an octave for a wider open feel.
        if (notes.length < 2) return notes.slice();
        return [notes[0] - 12, ...notes.slice(1)];
    },
    drop2(notes) {
        // Move the second-from-top note down an octave (classic jazz comping).
        if (notes.length < 3) return notes.slice();
        const sorted = notes.slice().sort((a, b) => b - a);
        sorted[1] -= 12;
        return sorted.sort((a, b) => a - b);
    },
    rootless7th(notes) {
        // Jazz pianist's left-hand: drop root, keep 3-5-7(-9).
        if (notes.length >= 4) return notes.slice(1);
        return notes.slice();
    },
    shellVoicing(notes) {
        // Sparse jazz voicing: root + 3rd + 7th (drop the 5th).
        if (notes.length >= 4) return [notes[0], notes[1], notes[3]];
        return notes.slice();
    },
    wideOpen(notes) {
        // Cinematic open voicing: root low, then 5th, 3rd up an octave, 7th higher.
        if (notes.length < 3) return notes.slice();
        const out = [notes[0] - 12];
        if (notes.length >= 3) out.push(notes[2]);     // 5th
        if (notes.length >= 2) out.push(notes[1] + 12); // 3rd up an octave
        for (let i = 3; i < notes.length; i++) out.push(notes[i] + 12);
        return out.sort((a, b) => a - b);
    },
};

// ─── Extensions ───────────────────────────────────────────────
//
// Applied to each chord after roman-numeral resolution. Roman numerals already
// can encode '7' / 'maj7' / 'sus2' / 'sus4' directly; this layer adds optional
// extra color (add9, 9, sus2/4 overrides) without changing the progression.

function applyExtension(ch, ext) {
    if (!ext || ext === 'none') return ch;
    const root = ch.root;
    if (ext === 'add9') {
        const notes = ch.notes.slice();
        if (!notes.includes(root + 14)) notes.push(root + 14);
        return Object.assign({}, ch, { notes: notes.sort((a, b) => a - b) });
    }
    if (ext === '7') {
        const has7 = ch.notes.some(n => n - root === 10 || n - root === 11);
        if (has7) return ch;
        const notes = ch.notes.slice();
        const seventh = (ch.type === 'major' || ch.type === 'maj7') ? 11 : 10;
        notes.push(root + seventh);
        return Object.assign({}, ch, { notes: notes.sort((a, b) => a - b) });
    }
    if (ext === '9') {
        const notes = ch.notes.slice();
        const has7 = notes.some(n => n - root === 10 || n - root === 11);
        if (!has7) {
            const seventh = (ch.type === 'major' || ch.type === 'maj7') ? 11 : 10;
            notes.push(root + seventh);
        }
        if (!notes.includes(root + 14)) notes.push(root + 14);
        return Object.assign({}, ch, { notes: notes.sort((a, b) => a - b) });
    }
    if (ext === 'sus2') {
        return Object.assign({}, ch, { type: 'sus2', notes: [root, root + 2, root + 7] });
    }
    if (ext === 'sus4') {
        return Object.assign({}, ch, { type: 'sus4', notes: [root, root + 5, root + 7] });
    }
    return ch;
}

// ─── Voice leading ────────────────────────────────────────────
//
// Two modes:
//
//   'centroid' (default) — Shift the chord by whole octaves to minimize the
//     centroid distance to the previous chord. Smooth average motion across
//     the progression. Good for pop/jazz/folk where harmonic *movement* is
//     part of the song.
//
//   'topAnchored' — Pick an inversion (chord rotation + octave shift) that
//     keeps the *highest* note as close as possible to the previous chord's
//     top. Eliminates the perceived top-voice melody — the chord layer reads
//     as flat texture instead of as a moving line. Right for cinematic/dark/
//     dreamy/ambient where you want a held bed, not a song.

function leadVoicing(prevNotes, currNotes) {
    if (!prevNotes || !prevNotes.length) return currNotes.slice();
    const prevCentroid = prevNotes.reduce((a, b) => a + b, 0) / prevNotes.length;
    let best = currNotes.slice();
    let bestDist = Infinity;
    for (let oct = -2; oct <= 2; oct++) {
        const shifted = currNotes.map(n => n + oct * 12);
        const c = shifted.reduce((a, b) => a + b, 0) / shifted.length;
        const d = Math.abs(c - prevCentroid);
        if (d < bestDist) { bestDist = d; best = shifted; }
    }
    return best;
}

// Generate inversion candidates by rotating the bottom note up an octave.
// Each rotation produces a new vertical layout while preserving the chord's
// note set (mod 12). Useful for searching for a voicing whose top note
// matches a target.
function inversionsOf(notes) {
    const sorted = notes.slice().sort((a, b) => a - b);
    const candidates = [sorted];
    let curr = sorted;
    for (let i = 0; i < sorted.length; i++) {
        const next = curr.slice();
        next[0] += 12;
        next.sort((a, b) => a - b);
        candidates.push(next);
        curr = next;
    }
    return candidates;
}

function topAnchoredVoicing(prevNotes, currNotes) {
    if (!prevNotes || !prevNotes.length) return currNotes.slice().sort((a, b) => a - b);
    const prevTop = Math.max(...prevNotes);
    let best = currNotes.slice().sort((a, b) => a - b);
    let bestDist = Math.abs(Math.max(...best) - prevTop);
    // Search across inversions (rotations) and octave shifts (-2..+2).
    for (const inv of inversionsOf(currNotes)) {
        for (let oct = -2; oct <= 2; oct++) {
            const cand = inv.map(n => n + oct * 12);
            const dTop = Math.abs(Math.max(...cand) - prevTop);
            if (dTop < bestDist) { bestDist = dTop; best = cand; }
        }
    }
    return best;
}

// ─── Public API ───────────────────────────────────────────────

/**
 * Compose a chord progression with smart defaults driven by a genre tag.
 *
 * @param {Object} opts
 * @param {string} [opts.genre='pop']  Genre tag — picks pools for progression/key/voicing/extension.
 *                                      Available: pop, sad-pop, lofi, lofi-jazz, jazz, cinematic-epic,
 *                                      cinematic-melancholy, dreamy, folk, edm-uplift, dark, rnb.
 * @param {number} [opts.seed]          PRNG seed. Same seed → same chords. Omit for fresh random each run.
 * @param {string|string[]} [opts.progression]  Override the picked progression (roman numerals).
 * @param {string} [opts.key]           Override the picked key, e.g. 'C4'.
 * @param {string} [opts.scale]         Override the picked scale, e.g. 'minor', 'harmonicMinor'.
 * @param {string} [opts.voicing]       Override the voicing strategy.
 * @param {string} [opts.extension]     Override the extension policy.
 * @param {string} [opts.voice]         Voice name that will play this comp. Used to filter
 *                                       voicing candidates that pair poorly with heavy sustained
 *                                       voices (e.g. drops `wideOpen` if voice is `pad`).
 * @param {string} [opts.voicingMode]   'centroid' (default for most genres) tracks chord centroid
 *                                       — produces smooth harmonic motion. 'topAnchored' pins the
 *                                       highest voice across chord changes — eliminates the
 *                                       perceived top-line melody, right for cinematic/dark/dreamy
 *                                       beds. Genre catalog sets sensible defaults.
 * @param {boolean} [opts.voiceLeading=true]  Apply octave-rotation voice leading between chords.
 * @returns {{ chords: Array<{root:number,type:string,notes:number[]}>, meta: Object }}
 */
function composeChords(opts = {}) {
    const genre = opts.genre || 'pop';
    const def = GENRES[genre] || GENRES.pop;
    const seed = opts.seed !== undefined
        ? opts.seed
        : Math.floor(Math.random() * 1e9);
    const r = rng(seed);

    const scale = opts.scale || pick(def.scales, r);
    const key = opts.key || pick(def.keys, r);
    const numerals = opts.progression || pick(def.progressions, r);
    // If the caller tells us which voice will play the comp, drop voicings that
    // pair poorly with heavy sustained-saw voices (pad, choirAh).
    // `wideOpen` is the worst offender: heavy voices already detune internally,
    // and stacking a 2-octave-wide voicing on top creates beating between voices.
    let voicingPool = def.voicings;
    if (opts.voice && HEAVY_VOICES_FOR_VOICING.has(opts.voice)) {
        const filtered = voicingPool.filter(v => v !== 'wideOpen');
        if (filtered.length) voicingPool = filtered;
    }
    const voicingName = opts.voicing || pick(voicingPool, r);
    const extension = opts.extension || pick(def.extensions, r);
    const voiceLeading = opts.voiceLeading !== false;

    const voiceFn = VOICINGS[voicingName] || VOICINGS.closeVoiced;

    const raw = mt.buildProgression(key, scale, numerals);
    const extended = raw.map(ch => applyExtension(ch, extension));
    const voiced = extended.map(ch => Object.assign({}, ch, { notes: voiceFn(ch.notes) }));

    const voicingMode = opts.voicingMode || def.voicingMode || 'centroid';
    const voiceLeader = voicingMode === 'topAnchored' ? topAnchoredVoicing : leadVoicing;

    let final = voiced;
    if (voiceLeading) {
        final = [];
        let prev = null;
        for (const ch of voiced) {
            const led = voiceLeader(prev, ch.notes);
            final.push(Object.assign({}, ch, { notes: led }));
            prev = led;
        }
    }

    return {
        chords: final,
        meta: { genre, seed, scale, key, progression: numerals, voicing: voicingName, extension, voicingMode },
    };
}

// Return the list of available genre tags (for SKILL.md / introspection).
function listGenres() {
    return Object.keys(GENRES);
}

// ─── Chord events helper ──────────────────────────────────────
//
// Produce comp events for a chord progression — handles two failure modes that
// the hand-rolled boilerplate gets wrong:
//
//   1. Note-gate-vs-release smear. Long-sustain voices (pad, choirAh) have
//      multi-second release tails. Holding a chord for the full
//      bar means chord N's release bleeds into chord N+1, creating composite
//      harmonies. chordEvents shortens the gate based on the voice profile.
//
//   2. Wooden chord-on-beat-1 rhythm. Pass `stagger` (in beats) to spread the
//      chord notes across a short window — sorted low-to-high — for a "strum"
//      or "swell" effect. 0 = block chord (default), 0.1 = subtle, 0.25 = strum.
//
//   chordEvents(chords, { voice: 'pad', bars: 8, stagger: 0.12 })

/**
 * Build comp events for a chord progression with voice-aware gating.
 *
 * @param {Array}  chords         Output of composeChords (or any [{root,type,notes}]).
 * @param {Object} opts
 * @param {string} [opts.voice]   Voice name — used to look up sustain bias and pick a gate.
 *                                 Unknown voices fall back to 'medium' sustain.
 * @param {number} [opts.bars]    Total bars to render (loops the progression). Defaults to chords.length.
 * @param {number} [opts.barsPerChord=1]  How many bars each chord lasts.
 * @param {number} [opts.beatsPerBar=4]
 * @param {number} [opts.velocity=70]
 * @param {number} [opts.stagger=0]       Beat-offset between successive chord notes (low→high).
 * @param {number} [opts.gateOverride]    Force a specific gate fraction (0..1). Bypasses voice profile.
 * @returns {Array<{time:number,beats:number,value:number,velocity:number}>}
 */
function chordEvents(chords, opts = {}) {
    if (!Array.isArray(chords) || !chords.length) {
        throw new Error('chordEvents: chords array required');
    }
    const voice = opts.voice;
    const barsPerChord = opts.barsPerChord || 1;
    const beatsPerBar = opts.beatsPerBar || 4;
    const bars = opts.bars || chords.length * barsPerChord;
    const velocity = opts.velocity !== undefined ? opts.velocity : 70;
    const stagger = opts.stagger || 0;
    const profile = VOICE_PROFILES[voice] || { sustain: 'medium' };
    const gate = opts.gateOverride !== undefined ? opts.gateOverride : (GATE_FACTOR[profile.sustain] || 0.85);
    const chordSlotBeats = barsPerChord * beatsPerBar;
    const noteBeats = chordSlotBeats * gate;

    const events = [];
    const totalBeats = bars * beatsPerBar;
    const chordCycles = Math.ceil(bars / (chords.length * barsPerChord));

    for (let c = 0; c < chordCycles; c++) {
        for (let i = 0; i < chords.length; i++) {
            const t = (c * chords.length + i) * chordSlotBeats;
            if (t >= totalBeats) break;
            const sortedNotes = chords[i].notes.slice().sort((a, b) => a - b);
            for (let n = 0; n < sortedNotes.length; n++) {
                const noteTime = t + n * stagger;
                // Each successive (staggered) note plays for slightly less so they all end together.
                const noteDur = Math.max(0.05, noteBeats - n * stagger);
                events.push({ time: noteTime, beats: noteDur, value: sortedNotes[n], velocity });
            }
        }
    }
    return events;
}

// ─── Melody composition ───────────────────────────────────────
//
// A real melody — chord-tone-anchored at strong beats (beat 1 and 3 of each
// bar), connected with passing tones on weak beats. Phrase shape via contour
// (rising / falling / arch / descend-ascend). This is the missing piece that
// makes generated music feel like music rather than texture.
//
// Why this works where the naïve looped motif failed:
//   - Strong beats land on CURRENT chord's tones — never clashes with harmony
//   - Weak beats use scale tones near the previous pitch — smooth motion
//   - Contour gives the melody a shape (rises then falls, etc.) — not flat
//   - Optional `restProbability` adds breath; melodies that play every beat
//     sound robotic
//   - Output is hand-authored melody-like, not a fixed motif repeated

const CONTOUR_BIAS = {
    flat:           (t) => 0,
    rising:         (t) => -0.6 + t * 1.6,
    falling:        (t) =>  0.6 - t * 1.6,
    arch:           (t) => Math.sin(t * Math.PI) * 1.4 - 0.5,
    'descend-ascend': (t) => -Math.sin(t * Math.PI) * 1.4 + 0.5,
};

/**
 * Compose a melody over a chord progression.
 *
 * @param {Object} opts
 * @param {Array}  opts.chords        Output of composeChords ([{root,type,notes}]).
 * @param {number} [opts.bars]        Total bars to fill. Defaults to chords.length.
 * @param {number} [opts.barsPerChord=1]
 * @param {number} [opts.beatsPerBar=4]
 * @param {number} [opts.notesPerBar=4]  Note grid density (4 = quarters, 8 = 8ths).
 * @param {number} [opts.octaveShift=1]  Octaves above chord root (typical melody range).
 * @param {string} [opts.contour='arch'] Phrase shape — see CONTOUR_BIAS.
 * @param {number} [opts.restProbability=0.18]  Chance of resting on a weak beat.
 * @param {string} [opts.scale]       Optional scale name for passing tones (e.g. 'minor').
 * @param {string|number} [opts.scaleRoot]  Root for the scale (e.g. 'A3' or MIDI 57).
 * @param {number} [opts.seed]        PRNG seed.
 * @param {number} [opts.velocityStrong=95]
 * @param {number} [opts.velocityWeak=70]
 * @returns {Array<{time:number,beats:number,value:number,velocity:number}>}
 */
function composeMelody(opts = {}) {
    const chords = opts.chords;
    if (!Array.isArray(chords) || !chords.length) {
        throw new Error('composeMelody: opts.chords required');
    }
    const bars = opts.bars || chords.length;
    const barsPerChord = opts.barsPerChord || 1;
    const beatsPerBar = opts.beatsPerBar || 4;
    const notesPerBar = opts.notesPerBar || 4;
    const octaveShift = opts.octaveShift !== undefined ? opts.octaveShift : 1;
    const contour = opts.contour || 'arch';
    const restProbability = opts.restProbability !== undefined ? opts.restProbability : 0.18;
    const velocityStrong = opts.velocityStrong !== undefined ? opts.velocityStrong : 95;
    const velocityWeak = opts.velocityWeak !== undefined ? opts.velocityWeak : 70;
    const seed = opts.seed !== undefined ? opts.seed : Math.floor(Math.random() * 1e9);
    const r = rng(seed);
    const contourFn = CONTOUR_BIAS[contour] || CONTOUR_BIAS.arch;

    // Optional scale tone pool — used for passing/neighbor tones on weak beats.
    let scaleTones = null;
    if (opts.scale && opts.scaleRoot !== undefined) {
        const mt = require('../../build-sfx/tools/music_theory');
        const pattern = mt.SCALES[opts.scale];
        if (pattern) {
            const rootMidi = typeof opts.scaleRoot === 'string' ? mt.noteToMidi(opts.scaleRoot) : opts.scaleRoot;
            scaleTones = [];
            for (let oct = -1; oct <= 2; oct++) {
                for (const off of pattern) scaleTones.push(rootMidi + oct * 12 + off + octaveShift * 12);
            }
            scaleTones.sort((a, b) => a - b);
        }
    }

    const events = [];
    const noteDur = beatsPerBar / notesPerBar;
    const totalBeats = bars * beatsPerBar;
    const totalNotes = bars * notesPerBar;

    let prevPitch = null;

    for (let n = 0; n < totalNotes; n++) {
        const tBeats = n * noteDur;
        if (tBeats >= totalBeats) break;

        const chordIdx = Math.floor(tBeats / (beatsPerBar * barsPerChord)) % chords.length;
        const ch = chords[chordIdx];
        const beatInBar = tBeats % beatsPerBar;
        const isBeatOne = beatInBar < noteDur * 0.5;
        const isBeatThree = Math.abs(beatInBar - beatsPerBar / 2) < noteDur * 0.5;
        const isStrong = isBeatOne || isBeatThree;

        // Rest on weak beats sometimes — gives the melody breath
        if (!isStrong && r() < restProbability) {
            continue;
        }

        // Compute chord tones in the melody's octave range
        const targetCenter = ch.root + octaveShift * 12;
        const chordTones = ch.notes.map(t => {
            let p = t + octaveShift * 12;
            while (p < targetCenter - 6) p += 12;
            while (p > targetCenter + 12) p -= 12;
            return p;
        });
        chordTones.sort((a, b) => a - b);

        // Pick candidate set
        let candidates;
        if (isStrong || prevPitch === null) {
            // Strong beat or first note: chord tones only — never clashes
            candidates = chordTones;
        } else if (scaleTones) {
            // Weak beat with scale info: scale tones within stepwise distance of prev
            candidates = scaleTones.filter(t => Math.abs(t - prevPitch) <= 4);
            if (!candidates.length) candidates = chordTones;
        } else {
            // Weak beat without scale: chord tones + chromatic neighbors of previous pitch
            candidates = chordTones.concat([prevPitch - 2, prevPitch - 1, prevPitch + 1, prevPitch + 2]);
        }

        // Pick by minimizing distance to (prev + contour drift), with small jitter
        const tNorm = n / totalNotes;
        const bias = contourFn(tNorm);
        const target = prevPitch !== null
            ? prevPitch + bias * 2.5 + (r() - 0.5) * 1.5
            : chordTones[chordTones.length - 1] + bias * 3;

        let best = candidates[0];
        let bestDist = Infinity;
        for (const c of candidates) {
            const d = Math.abs(c - target);
            if (d < bestDist) { bestDist = d; best = c; }
        }

        const velocity = isBeatOne ? velocityStrong + 5
                        : (isStrong ? velocityStrong : velocityWeak);
        events.push({
            time: tBeats,
            beats: noteDur * 0.85,
            value: best,
            velocity,
        });
        prevPitch = best;
    }

    return events;
}

// ─── Arpeggio composition ─────────────────────────────────────
//
// Animate a chord progression with chord-tone arpeggios. Unlike a melodic lead,
// every emitted pitch is drawn from the current chord's note set — so the
// arpeggio cannot clash with the harmony underneath, no matter how the chords
// move. This is the recommended top-line for generated music: rule-based lead
// melodies are a hard problem and tend to sound algorithmic; chord-tone
// movement gives "more going on" with no dissonance risk.

const ARPEGGIO_STYLES = ['up', 'down', 'up-down', 'stab', 'pedal', 'random', 'alberti'];

/**
 * Compose a chord-tone arpeggio over a chord progression.
 *
 * @param {Object} opts
 * @param {Array}  opts.chords         Chord array from composeChords (or any [{root,type,notes}]).
 * @param {number} [opts.barsPerChord=1]  How many bars each chord sustains.
 * @param {string} [opts.style='up']   Arpeggio shape — see ARPEGGIO_STYLES.
 *                                     'up' / 'down' / 'up-down' cycle through chord tones.
 *                                     'stab' fires the whole chord on every step.
 *                                     'pedal' repeats the top chord tone (drone-like).
 *                                     'random' picks chord tones with the seed.
 *                                     'alberti' is the classic bottom-top-middle-top pattern.
 * @param {number} [opts.density=4]    Steps per bar (4 = quarters, 8 = 8ths, 16 = 16ths).
 * @param {number} [opts.velocity=70]  Default velocity for emitted notes (1..127).
 * @param {number} [opts.octave=0]     Octave shift applied to every emitted pitch.
 * @param {number} [opts.seed]         Required for 'random' style; ignored otherwise.
 * @returns {Array<{time:number,beats:number,value:number,velocity:number}>}
 */
function composeArpeggio(opts = {}) {
    const chords = opts.chords;
    if (!Array.isArray(chords) || !chords.length) {
        throw new Error('composeArpeggio: opts.chords must be a non-empty array');
    }
    const barsPerChord = opts.barsPerChord || 1;
    const beatsPerBar = 4;
    const density = opts.density || 4;
    const velocity = opts.velocity !== undefined ? opts.velocity : 70;
    const octave = opts.octave || 0;
    const style = opts.style || 'up';
    const seed = opts.seed !== undefined ? opts.seed : Math.floor(Math.random() * 1e9);
    const r = rng(seed);

    const stepDur = beatsPerBar / density;
    const events = [];

    chords.forEach((ch, chIdx) => {
        const tones = ch.notes.slice().sort((a, b) => a - b).map(n => n + octave * 12);
        const steps = density * barsPerChord;
        const baseTime = chIdx * barsPerChord * beatsPerBar;

        for (let s = 0; s < steps; s++) {
            const t = baseTime + s * stepDur;

            if (style === 'stab') {
                for (const p of tones) {
                    events.push({ time: t, beats: stepDur * 0.9, value: p, velocity });
                }
                continue;
            }

            let pitch;
            switch (style) {
                case 'down':
                    pitch = tones[(tones.length - 1) - (s % tones.length)];
                    break;
                case 'up-down': {
                    const period = Math.max(1, (tones.length - 1) * 2);
                    const k = s % period;
                    pitch = tones[k < tones.length ? k : period - k];
                    break;
                }
                case 'pedal':
                    pitch = tones[tones.length - 1];
                    break;
                case 'random':
                    pitch = tones[Math.floor(r() * tones.length)];
                    break;
                case 'alberti': {
                    const top = tones.length - 1;
                    const mid = Math.floor(tones.length / 2);
                    const pattern = [0, top, mid, top];
                    pitch = tones[pattern[s % pattern.length]];
                    break;
                }
                case 'up':
                default:
                    pitch = tones[s % tones.length];
            }

            events.push({ time: t, beats: stepDur * 0.9, value: pitch, velocity });
        }
    });

    return events;
}

module.exports = {
    composeChords,
    composeArpeggio,
    composeMelody,
    chordEvents,
    listGenres,
    GENRES,
    VOICINGS,
    VOICE_PROFILES,
    GATE_FACTOR,
    ARPEGGIO_STYLES,
    CONTOUR_BIAS,
    applyExtension,
    leadVoicing,
    topAnchoredVoicing,
};
