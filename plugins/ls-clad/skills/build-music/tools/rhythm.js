// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// rhythm.js — Genre-aware rhythm-section composition: drums and bass.
//
// Before this module the engine had no drum/bass composers — the LLM hand-rolled
// both per piece, which produced (a) silent drums (the renderer drops string-named
// events like 'bd'/'sn', so 'bd ~ sn ~' patterns rendered nothing) and (b) bass
// lines with hard-coded intervals that clashed with the actual chord qualities.
//
// composeDrums({genre, bars, ...})  → ready-to-render track descriptors (one per
//   drum voice) carrying numeric-MIDI events, per-voice EQ, and humanization.
// composeBass({chords, genre/style, ...}) → a numeric-MIDI events array for a
//   bass voice, register-normalized and chord-tone-correct.
//
// Groove templates are canonical genre rhythms encoded as data — uncopyrightable
// musical facts (US Copyright Office Circular 33 excludes short common rhythms).
// They are NOT copied from any single pattern compilation; they are the common
// grooves taught across independent production references, re-encoded here.

// Tiny deterministic PRNG (mulberry32; CC0, Tommy Ettinger).
function rng(seed) {
    let s = (seed >>> 0) || 1;
    return function () {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ─── Drum-name map ─────────────────────────────────────────────
// Symbolic name → { voice (key into synth_voices.VOICES), midi }.
// `oh` uses a high MIDI so the hat voice renders its open (long) variant
// (synth_voices.hat treats midi >= 49 as open).
const DRUM_MAP = {
    bd:     { voice: 'kick',   midi: 36 },  // bass drum / kick
    kick:   { voice: 'kick',   midi: 36 },
    sn:     { voice: 'snare',  midi: 38 },  // snare
    snare:  { voice: 'snare',  midi: 38 },
    rs:     { voice: 'snare',  midi: 37 },  // rim/cross-stick (quieter snare-ish)
    hh:     { voice: 'hat',    midi: 42 },  // closed hat
    hat:    { voice: 'hat',    midi: 42 },
    oh:     { voice: 'hat',    midi: 60 },  // open hat (long)
    ride:   { voice: 'hat',    midi: 62 },  // ride ≈ open-ish hat stand-in
    tom:    { voice: 'tom',    midi: 45 },  // mid tom
    tomL:   { voice: 'tom',    midi: 41 },  // low tom
    tomH:   { voice: 'tom',    midi: 50 },  // high tom
    clap:   { voice: 'clap',   midi: 39 },
    shaker: { voice: 'shaker', midi: 70 },
    cr:     { voice: 'crash',  midi: 49 },
    crash:  { voice: 'crash',  midi: 49 },
};

// ─── Groove templates ──────────────────────────────────────────
// Each lane is a 16-step bar (step 0 = beat 1; step 4 = beat 2; etc.). An entry
// is [step, velocity] (velocity 1..127). Two-bar grooves use bar2 for variation.
// `swing` is the humanize swingAmount (0 = straight). `accent` toggles metric
// velocity accenting. Velocities encode ghost notes (~35-50) vs hits (95-127).
//
// `variants` gives each lane a pool of alternative patterns; composeDrums picks
// ONE per lane per piece (seeded), so two pieces in the same genre don't share
// identical drums. `fills` is the pool of fill shapes used at 4-bar boundaries.

const GROOVES = {
    // Boom-bap / lofi hip-hop: kick on 1 and the "and of 3", backbeat snare,
    // swung 8th hats with alternating accent, sparse ghost snare.
    'boom-bap': {
        swing: 0.18, accent: true,
        bar: {
            kick:  [[0, 112], [10, 100]],
            snare: [[4, 118], [12, 120], [7, 42], [15, 40]],
            hh:    [[0, 90], [2, 60], [4, 88], [6, 58], [8, 90], [10, 60], [12, 86], [14, 58]],
        },
        variants: {
            kick: [
                [[0, 112], [7, 92], [10, 100]],
                [[0, 112], [10, 100], [14, 86]],
                [[0, 112], [6, 88], [11, 100]],
            ],
            snare: [
                [[4, 118], [12, 120], [9, 40], [15, 44]],
                [[4, 118], [12, 120]],
            ],
            hh: [
                [[2, 74], [6, 70], [10, 74], [14, 70]],
                [[0, 88], [1, 44], [2, 62], [4, 86], [6, 60], [7, 44], [8, 88], [10, 62], [11, 44], [12, 84], [14, 60], [15, 50]],
            ],
        },
        fills: ['ramp16', 'snareDrag', 'tomCascade', 'none'],
    },
    // House / four-on-floor: kick every beat, clap on backbeat, OPEN hats on the
    // offbeats (the defining house element), 16th closed-hat shimmer.
    house: {
        swing: 0.0, accent: false,
        bar: {
            kick:  [[0, 122], [4, 122], [8, 122], [12, 122]],
            clap:  [[4, 104], [12, 104]],
            oh:    [[2, 90], [6, 92], [10, 90], [14, 92]],
            hh:    [[0, 70], [2, 40], [4, 70], [6, 40], [8, 70], [10, 40], [12, 70], [14, 40]],
        },
        variants: {
            hh: [
                [],
                [[1, 46], [3, 46], [5, 46], [7, 46], [9, 46], [11, 46], [13, 46], [15, 52]],
            ],
            clap: [
                [[4, 104], [12, 104], [15, 56]],
            ],
            oh: [
                [[2, 90], [6, 92], [10, 90], [14, 96]],
                [[2, 88], [10, 92]],
            ],
        },
        fills: ['stutter', 'ramp16', 'none', 'none'],
    },
    // Pop / rock backbeat: kick on 1 and "and of 2", hard snare backbeat, 8th hats.
    pop: {
        swing: 0.0, accent: true,
        bar: {
            kick:  [[0, 118], [6, 96], [8, 110]],
            snare: [[4, 120], [12, 122], [14, 40]],
            hh:    [[0, 92], [2, 70], [4, 92], [6, 70], [8, 92], [10, 70], [12, 92], [14, 70]],
        },
        variants: {
            kick: [
                [[0, 118], [8, 110], [11, 84]],
                [[0, 118], [5, 90], [8, 110], [14, 72]],
                [[0, 118], [6, 96], [8, 110], [15, 68]],
            ],
            hh: [
                [[0, 92], [4, 92], [8, 92], [12, 92]],
                [[0, 90], [1, 46], [2, 66], [3, 46], [4, 88], [5, 46], [6, 64], [7, 46], [8, 90], [9, 46], [10, 66], [11, 46], [12, 88], [13, 46], [14, 64], [15, 46]],
            ],
            snare: [
                [[4, 120], [12, 122]],
                [[4, 120], [12, 122], [7, 38], [14, 42]],
            ],
        },
        fills: ['ramp16', 'tomCascade', 'snareDrag', 'none'],
    },
    // Jazz swing: ride "spang-a-lang" (beats + swung skip notes), hi-hat foot on
    // 2 and 4, feathered kick quarters. Heavy swing.
    jazz: {
        swing: 0.30, accent: false,
        bar: {
            ride:  [[0, 92], [4, 88], [6, 72], [8, 90], [12, 88], [14, 72]],
            hh:    [[4, 80], [12, 80]],            // hi-hat foot (closed) on 2 & 4
            kick:  [[0, 28], [4, 26], [8, 28], [12, 26]],  // feathered
        },
        variants: {
            ride: [
                [[0, 92], [4, 88], [6, 70], [8, 90], [10, 60], [12, 88], [14, 72]],
                [[0, 94], [4, 86], [8, 92], [12, 86], [14, 70]],
            ],
            kick: [
                [[0, 28], [8, 28]],
                [[0, 30], [4, 26], [8, 28], [12, 26], [14, 44]],
            ],
        },
        fills: ['snareDrag', 'none', 'none'],
    },
    // Trap (half-time): kick syncopation, snare/clap on beat 3 only, hat 8ths
    // with periodic roll bursts added by the fill logic.
    trap: {
        swing: 0.0, accent: false,
        bar: {
            kick:  [[0, 120], [6, 100], [10, 104]],
            snare: [[8, 118]],
            clap:  [[8, 96]],
            hh:    [[0, 86], [2, 70], [4, 86], [6, 70], [8, 86], [10, 70], [12, 86], [14, 70]],
        },
        variants: {
            kick: [
                [[0, 120], [7, 100], [10, 104]],
                [[0, 120], [3, 88], [10, 104], [13, 92]],
                [[0, 120], [6, 100], [11, 104], [14, 84]],
            ],
            hh: [
                [[0, 86], [2, 70], [4, 86], [5, 52], [6, 70], [8, 86], [10, 70], [12, 86], [13, 52], [14, 70], [15, 52]],
                [[0, 88], [3, 60], [4, 86], [6, 70], [8, 88], [11, 60], [12, 86], [14, 70]],
            ],
        },
        fills: ['stutter', 'snareDrag', 'none'],
    },
    // Funk: syncopated 16th kick, hard backbeat with ghost-note chatter, 16th hats.
    funk: {
        swing: 0.0, accent: true,
        bar: {
            kick:  [[0, 118], [2, 80], [7, 96], [10, 104]],
            snare: [[4, 120], [12, 122], [6, 40], [11, 38], [14, 44]],
            hh:    [[0, 88], [1, 46], [2, 64], [3, 46], [4, 86], [5, 46], [6, 62], [7, 46], [8, 88], [9, 46], [10, 62], [11, 46], [12, 84], [13, 46], [14, 64], [15, 46]],
        },
        variants: {
            kick: [
                [[0, 118], [3, 84], [7, 96], [10, 104], [14, 72]],
                [[0, 118], [6, 92], [10, 104], [15, 76]],
            ],
            hh: [
                [[0, 86], [2, 60], [4, 84], [6, 60], [8, 86], [10, 60], [12, 84], [14, 60]],
            ],
            snare: [
                [[4, 120], [12, 122], [7, 40], [9, 36], [15, 44]],
            ],
        },
        fills: ['stutter', 'snareDrag', 'none'],
    },
    // Bossa-style: rim-click cross pattern (2-bar), surdo kick figure, straight shaker.
    bossa: {
        swing: 0.0, accent: false,
        bar:  { rs: [[0, 88], [6, 84], [12, 86]], kick: [[0, 92], [7, 84], [8, 88], [15, 80]], shaker: [[0, 70], [2, 64], [4, 70], [6, 64], [8, 70], [10, 64], [12, 70], [14, 64]] },
        bar2: { rs: [[2, 86], [8, 88]],           kick: [[0, 92], [7, 84], [8, 88], [15, 80]], shaker: [[0, 70], [2, 64], [4, 70], [6, 64], [8, 70], [10, 64], [12, 70], [14, 64]] },
        fills: ['none'],
    },
    // Cinematic / taiko: low taiko quarters with 8th pickups, big downbeat hit.
    cinematic: {
        swing: 0.0, accent: true,
        bar: {
            tomL:  [[0, 124], [4, 96], [8, 110], [12, 96], [14, 80]],
            tom:   [[2, 70], [10, 72]],
        },
        variants: {
            tomL: [
                [[0, 124], [6, 92], [8, 110], [12, 96]],
                [[0, 124], [4, 96], [8, 110], [11, 84], [12, 96], [14, 80]],
            ],
            tom: [
                [[2, 70], [7, 64], [10, 72], [15, 60]],
                [],
            ],
        },
        fills: ['tomRamp', 'tomCascade'],
    },
};

// Maps a build-music genre tag (from harmony.js GENRES) to a groove style.
const GENRE_TO_GROOVE = {
    pop: 'pop', 'sad-pop': 'pop', folk: 'pop', rnb: 'boom-bap',
    lofi: 'boom-bap', 'lofi-jazz': 'jazz', jazz: 'jazz',
    'edm-uplift': 'house', dark: 'house', synthwave: 'pop',
    'cinematic-epic': 'cinematic', 'cinematic-melancholy': 'cinematic', dreamy: 'cinematic',
    ambient: 'cinematic',
    'hip-hop': 'boom-bap', trap: 'trap', house: 'house', bossa: 'bossa', funk: 'funk',
};

// ─── Fill shapes ───────────────────────────────────────────────
// Each fill covers (parts of) the last 2 beats of a fill bar. `emit` is the
// composeDrums event emitter; `base` the bar's beat offset. Which shape plays
// at each 4-bar boundary is a seeded pick from the groove's `fills` pool.
const FILL_KINDS = {
    // 16th snare ramp over the last 2 beats (the classic).
    ramp16(emit, base, stepBeats, fillVoice) {
        for (let s = 8; s < 16; s++) emit(fillVoice, base + s * stepBeats, 70 + (s - 8) / 7 * 50);
    },
    // Descending tom run over the last beat and a half.
    tomCascade(emit, base, stepBeats) {
        const lanes = ['tomH', 'tomH', 'tom', 'tom', 'tomL', 'tomL'];
        for (let k = 0; k < 6; k++) emit(lanes[k], base + (10 + k) * stepBeats, 84 + k * 6);
    },
    // Sparse drag into the downbeat: two ghost 16ths + accent.
    snareDrag(emit, base, stepBeats, fillVoice) {
        emit(fillVoice, base + 13 * stepBeats, 52);
        emit(fillVoice, base + 14 * stepBeats, 66);
        emit(fillVoice, base + 15 * stepBeats, 108);
    },
    // Syncopated stabs across beats 3-4.
    stutter(emit, base, stepBeats, fillVoice) {
        for (const [s, v] of [[8, 100], [11, 84], [13, 92], [15, 110]]) emit(fillVoice, base + s * stepBeats, v);
    },
    // Low-tom ramp (cinematic).
    tomRamp(emit, base, stepBeats) {
        for (let s = 8; s < 16; s++) emit('tomL', base + s * stepBeats, 70 + (s - 8) / 7 * 50);
    },
    none() {},
};

// Default per-voice mix (EQ / reverb / gain) for drum tracks.
const DRUM_FX = {
    kick:   { lpf: 6000, gain: 0.85 },
    snare:  { hpf: 250, reverb: 'smallRoom', gain: 0.6 },
    hat:    { hpf: 3500, gain: 0.42 },
    clap:   { hpf: 400, reverb: 'smallRoom', gain: 0.55 },
    tom:    { lpf: 2400, gain: 0.6 },
    shaker: { hpf: 4000, gain: 0.3 },
    crash:  { hpf: 2500, gain: 0.35 },
};

// ─── composeDrums ──────────────────────────────────────────────
/**
 * Compose a genre-authentic drum pattern across `bars` bars.
 *
 * @param {Object} opts
 * @param {string} [opts.genre='pop']   build-music genre tag OR a groove name (see GROOVES).
 * @param {number} [opts.bars=8]
 * @param {number} [opts.energy=1]      0..1 scales velocities and (low energy) thins ghost/hat notes.
 * @param {number} [opts.seed]          PRNG seed for ghost-note / fill variation.
 * @param {boolean}[opts.fills=true]    Insert fills at 4-bar boundaries (snare/tom 16th ramps) and trap hat rolls.
 * @param {number} [opts.beatsPerBar=4]
 * @returns {Array} track descriptors ({name, voice, events, opts}) — one per drum voice,
 *                  ready to spread directly into render()'s tracks array. Each carries
 *                  numeric-MIDI events, a default per-voice EQ, and humanization (swing where
 *                  the groove calls for it). meta is attached as `.meta` on the returned array.
 */
function composeDrums(opts = {}) {
    const genre = opts.genre || 'pop';
    const grooveName = GROOVES[genre] ? genre : (GENRE_TO_GROOVE[genre] || 'pop');
    const groove = GROOVES[grooveName];
    const bars = opts.bars || 8;
    const energy = opts.energy !== undefined ? opts.energy : 1;
    const fills = opts.fills !== false;
    const beatsPerBar = opts.beatsPerBar || 4;
    const stepBeats = beatsPerBar / 16;
    // No fixed default seed: an omitted seed means a FRESH groove pick each run,
    // so two pieces in the same genre don't share identical drums. Pass a seed
    // only to reproduce/pin a specific take.
    const seed = opts.seed !== undefined ? opts.seed : Math.floor(Math.random() * 1e9);
    const r = rng(seed);
    // 0..1 — probability scale for per-bar embellishments (pickup kicks, extra
    // ghosts, phrase-end open hats). 0 = pure template.
    const embellish = opts.embellish !== undefined ? opts.embellish : 0.5;

    // Resolve lane variants ONCE per piece: index 0 = the base lane, 1.. = the
    // groove's alternatives. A single consistent pick per lane keeps the groove
    // coherent bar-to-bar while varying it piece-to-piece.
    const lanePicks = {};
    const bar1 = Object.assign({}, groove.bar);
    if (groove.variants) {
        for (const lane in groove.variants) {
            const pool = groove.variants[lane];
            const idx = Math.floor(r() * (pool.length + 1));
            lanePicks[lane] = idx;
            if (idx > 0) bar1[lane] = pool[idx - 1];
        }
    }

    // Accumulate numeric-MIDI events per drum-voice (kick/snare/hat/...).
    const byVoice = {}; // voice -> events[]
    function emit(name, beatTime, vel) {
        const d = DRUM_MAP[name];
        if (!d) return;
        const v = Math.max(1, Math.min(127, Math.round(vel * (0.55 + 0.45 * energy))));
        (byVoice[d.voice] || (byVoice[d.voice] = [])).push({ time: beatTime, beats: stepBeats, value: d.midi, velocity: v });
    }

    const fillPool = groove.fills || ['ramp16'];
    const fillVoice = (grooveName === 'cinematic') ? 'tomL' : 'snare';

    for (let bar = 0; bar < bars; bar++) {
        const base = bar * beatsPerBar;
        const pat = (bar % 2 === 1 && groove.bar2) ? groove.bar2 : bar1;
        // Pick this boundary's fill shape from the groove's pool ('none' = no fill).
        const fillKind = (fills && ((bar + 1) % 4 === 0))
            ? fillPool[Math.floor(r() * fillPool.length)]
            : null;
        const isFillBar = !!(fillKind && fillKind !== 'none');

        for (const name in pat) {
            for (const [step, vel] of pat[name]) {
                // On a fill bar, drop the last 2 beats of the main pattern to make room.
                if (isFillBar && step >= 8 && (name === 'snare' || name === 'tom' || name === 'tomL')) continue;
                // Low energy thins ghost notes and some hats.
                if (energy < 0.5 && vel < 55 && r() > energy * 1.6) continue;
                emit(name, base + step * stepBeats, vel);
            }
        }

        if (isFillBar) {
            (FILL_KINDS[fillKind] || FILL_KINDS.ramp16)(emit, base, stepBeats, fillVoice);
        } else if (embellish > 0) {
            const p = Math.min(1.6, embellish * 2); // scale so default 0.5 = base probabilities
            // Occasional kick pickup on the last 16th (not house — keep the 4-floor pure).
            if (grooveName !== 'house' && grooveName !== 'cinematic' && r() < 0.16 * p) {
                emit('kick', base + 15 * stepBeats, 72);
            }
            // Occasional extra ghost snare in backbeat grooves.
            if ((grooveName === 'boom-bap' || grooveName === 'pop' || grooveName === 'funk') && r() < 0.2 * p) {
                emit('sn', base + (r() < 0.5 ? 7 : 9) * stepBeats, 36 + Math.floor(r() * 14));
            }
            // Open-hat lift at the end of a 4-bar phrase.
            if ((bar + 1) % 4 === 0 && (grooveName === 'boom-bap' || grooveName === 'pop' || grooveName === 'house' || grooveName === 'funk') && r() < 0.5 * p) {
                emit('oh', base + 14 * stepBeats, 78);
            }
        }
        // Trap hat rolls: every 2 bars, a burst of 32nd-ish hats on beat 4 ramping up.
        if (grooveName === 'trap' && (bar % 2 === 1)) {
            for (let k = 0; k < 6; k++) {
                emit('hh', base + 3 * stepBeats * 4 / 4 + (12 + k * (4 / 6)) * stepBeats, 60 + k * 9);
            }
        }
    }

    const swingHum = groove.swing > 0
        ? { groove: 'swing', swingAmount: groove.swing }
        : {};
    const accentHum = groove.accent ? { accentAmount: 0.35 } : {};

    const tracks = [];
    for (const voice in byVoice) {
        // Kicks stay tight (no swing/jitter); everything else gets the groove feel.
        const isKick = voice === 'kick';
        const hum = isKick ? { timeJitter: 0.004 } : Object.assign({}, swingHum, accentHum);
        tracks.push({
            name: voice,
            voice,
            events: byVoice[voice],
            opts: { fx: Object.assign({}, DRUM_FX[voice] || { gain: 0.6 }), humanize: hum },
        });
    }
    tracks.meta = { genre, groove: grooveName, bars, swing: groove.swing, seed, lanePicks };
    return tracks;
}

// ─── composeBass ───────────────────────────────────────────────
const BASS_LO = 28; // E1
const BASS_HI = 50; // D3

// Fold a MIDI note by octaves into the bass register.
function toBassRegister(midi) {
    let m = midi;
    while (m > BASS_HI) m -= 12;
    while (m < BASS_LO) m += 12;
    return m;
}

// Genre tag → default bass style.
const GENRE_TO_BASS = {
    pop: 'root-fifth', 'sad-pop': 'root-fifth', folk: 'root-fifth',
    lofi: 'root', 'lofi-jazz': 'walking', jazz: 'walking', rnb: 'syncopated',
    'edm-uplift': 'offbeat-8ths', dark: 'offbeat-8ths', synthwave: 'offbeat-8ths',
    'cinematic-epic': 'root', 'cinematic-melancholy': 'root', dreamy: 'root', ambient: 'root',
    trap: 'root', 'hip-hop': 'root', house: 'offbeat-8ths', funk: 'syncopated',
};

/**
 * Compose a bassline for a chord progression.
 *
 * @param {Object} opts
 * @param {Array}  opts.chords        Output of composeChords ([{root,type,notes}]).
 * @param {string} [opts.genre]       Picks a default style if `style` is omitted.
 * @param {string} [opts.style]       'root' | 'root-fifth' | 'walking' | 'offbeat-8ths' | 'syncopated'.
 * @param {number} [opts.bars]        Total bars (loops the progression). Default chords.length.
 * @param {number} [opts.barsPerChord=1]
 * @param {number} [opts.beatsPerBar=4]
 * @param {number} [opts.velocity=92]
 * @param {number} [opts.seed]
 * @returns {Array<{time,beats,value,velocity}>} numeric-MIDI events for a bass voice.
 */
function composeBass(opts = {}) {
    const chords = opts.chords;
    if (!Array.isArray(chords) || !chords.length) {
        throw new Error('composeBass: opts.chords required');
    }
    const style = opts.style || GENRE_TO_BASS[opts.genre] || 'root';
    const barsPerChord = opts.barsPerChord || 1;
    const beatsPerBar = opts.beatsPerBar || 4;
    const bars = opts.bars || chords.length * barsPerChord;
    const vel = opts.velocity !== undefined ? opts.velocity : 92;
    // Fresh random seed when omitted — see composeDrums. Pass a seed to pin a take.
    const r = rng(opts.seed !== undefined ? opts.seed : Math.floor(Math.random() * 1e9));
    // 0..1 — probability of per-bar embellishments (pickups, octave jumps,
    // re-strikes). 0 = pure style template.
    const variation = opts.variation !== undefined ? opts.variation : 0.35;
    const events = [];

    // Chord tones (pitch classes relative to root) for the current chord.
    function chordToneSemis(ch) {
        return ch.notes.map(n => ((n - ch.root) % 12 + 12) % 12);
    }

    const totalChordSlots = Math.ceil(bars / barsPerChord);
    for (let slot = 0; slot < totalChordSlots; slot++) {
        const ch = chords[slot % chords.length];
        const next = chords[(slot + 1) % chords.length];
        const root = toBassRegister(ch.root);
        const fifth = toBassRegister(ch.root + 7);
        const tones = chordToneSemis(ch);
        const barStart = slot * barsPerChord * beatsPerBar;

        for (let b = 0; b < barsPerChord; b++) {
            const t0 = barStart + b * beatsPerBar;
            const isLastBarOfChord = (b === barsPerChord - 1);

            if (style === 'root') {
                // Occasionally re-strike on beat 3 or add a pickup instead of one long hold.
                if (r() < variation * 0.6) {
                    events.push({ time: t0, beats: 2.4, value: root, velocity: vel });
                    events.push({ time: t0 + 2.5, beats: 1.3, value: root, velocity: vel - 14 });
                } else {
                    events.push({ time: t0, beats: beatsPerBar * 0.9, value: root, velocity: vel });
                }
                if (r() < variation * 0.5) {
                    const pickup = r() < 0.5 ? fifth : toBassRegister(next.root + (r() < 0.5 ? -1 : 1));
                    events.push({ time: t0 + 3.5, beats: 0.4, value: pickup, velocity: vel - 20 });
                }
            } else if (style === 'root-fifth') {
                events.push({ time: t0, beats: 1.9, value: root, velocity: vel });
                // Sometimes swap the fifth for the octave or the 3rd for color.
                const alt = r() < variation
                    ? (r() < 0.5 ? toBassRegister(root + 12) : toBassRegister(ch.root + (tones.find(s => s === 3 || s === 4) || 7)))
                    : fifth;
                events.push({ time: t0 + 2, beats: 1.9, value: alt, velocity: vel - 8 });
                if (r() < variation * 0.6) {
                    events.push({ time: t0 + 3.5, beats: 0.4, value: toBassRegister(next.root + (r() < 0.5 ? -2 : -1)), velocity: vel - 18 });
                }
            } else if (style === 'offbeat-8ths') {
                // Root on every offbeat 8th (house/EDM call-and-response with the kick).
                const oct = toBassRegister(root + 12);
                for (let beat = 0; beat < beatsPerBar; beat++) {
                    // Occasionally the last offbeat jumps the octave for lift.
                    const useOct = beat === beatsPerBar - 1 && r() < variation;
                    events.push({ time: t0 + beat + 0.5, beats: 0.45, value: useOct ? oct : root, velocity: vel });
                }
            } else if (style === 'syncopated') {
                // Funk/R&B: root on 1, octave/5th on syncopated 16ths + ghost notes.
                const oct = toBassRegister(root + 12);
                events.push({ time: t0, beats: 0.75, value: root, velocity: vel });
                // Vary the syncopation figure per bar.
                if (r() < variation) {
                    events.push({ time: t0 + 1.25, beats: 0.35, value: root, velocity: vel - 26 });
                    events.push({ time: t0 + 1.75, beats: 0.4, value: fifth, velocity: vel - 14 });
                    events.push({ time: t0 + 2.5, beats: 0.4, value: oct, velocity: vel - 6 });
                    events.push({ time: t0 + 3.5, beats: 0.35, value: root, velocity: vel - 22 });
                } else {
                    events.push({ time: t0 + 1.5, beats: 0.4, value: fifth, velocity: vel - 18 });
                    events.push({ time: t0 + 2.5, beats: 0.4, value: oct, velocity: vel - 6 });
                    events.push({ time: t0 + 3.25, beats: 0.4, value: root, velocity: vel - 24 });
                }
            } else if (style === 'walking') {
                // Jazz walking bass: beat 1 = root, beats 2-3 = chord/scale tones,
                // beat 4 = approach tone targeting the next chord's root.
                const nextRoot = toBassRegister(next.root);
                events.push({ time: t0, beats: 0.95, value: root, velocity: vel });
                if (isLastBarOfChord) {
                    // Beats 2-3: two chord tones (3rd/5th/7th) in a seeded order, then beat 4 approach.
                    const ct = tones.filter(s => s !== 0);
                    let i2 = ct.length ? Math.floor(r() * ct.length) : -1;
                    let i3 = ct.length > 1 ? Math.floor(r() * ct.length) : i2;
                    if (ct.length > 1 && i3 === i2) i3 = (i2 + 1) % ct.length;
                    const t2 = toBassRegister(ch.root + (i2 >= 0 ? ct[i2] : 7));
                    const t3 = toBassRegister(ch.root + (i3 >= 0 ? ct[i3] : 7));
                    events.push({ time: t0 + 1, beats: 0.95, value: t2, velocity: vel - 10 });
                    events.push({ time: t0 + 2, beats: 0.95, value: t3, velocity: vel - 8 });
                    // Approach: chromatic from below/above or a step (weighted choice).
                    const roll = r();
                    const approach = roll < 0.35 ? nextRoot - 1
                                   : roll < 0.55 ? nextRoot + 1
                                   : roll < 0.8  ? nextRoot - 2
                                   : nextRoot + 2;
                    events.push({ time: t0 + 3, beats: 0.95, value: toBassRegister(approach), velocity: vel - 6 });
                } else {
                    // Inner bars of a multi-bar chord: root, 5th, root, chord tone.
                    events.push({ time: t0 + 1, beats: 0.95, value: fifth, velocity: vel - 10 });
                    events.push({ time: t0 + 2, beats: 0.95, value: root, velocity: vel - 6 });
                    const ct = tones.find(s => s !== 0 && s !== 7);
                    events.push({ time: t0 + 3, beats: 0.95, value: toBassRegister(ch.root + (ct || 7)), velocity: vel - 8 });
                }
            }
        }
    }
    // Trim any events past the requested bar count.
    const endBeat = bars * beatsPerBar;
    return events.filter(e => e.time < endBeat - 1e-6);
}

module.exports = {
    DRUM_MAP,
    GROOVES,
    GENRE_TO_GROOVE,
    DRUM_FX,
    composeDrums,
    composeBass,
    toBassRegister,
};
