// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// music_theory.js — Western music theory: notes, scales, chords, progressions, rhythm
// Pure data + math. No audio generation, no dependencies.

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Flat-to-sharp mapping for normalization
const FLAT_MAP = { 'Db': 'C#', 'Eb': 'D#', 'Fb': 'E', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#', 'Cb': 'B' };

// ─── Note / Frequency Conversion ──────────────────────────────

// Parse note name like 'C4', 'C#3', 'Db5' into { name, octave }
function parseNote(str) {
    const match = str.match(/^([A-Ga-g][b#]?)(-?\d+)$/);
    if (!match) throw new Error(`Invalid note: "${str}"`);
    let name = match[1][0].toUpperCase() + match[1].slice(1);
    if (FLAT_MAP[name]) name = FLAT_MAP[name];
    return { name, octave: parseInt(match[2]) };
}

// 'C4' → 60, 'A4' → 69
function noteToMidi(str) {
    const { name, octave } = parseNote(str);
    const semitone = NOTE_NAMES.indexOf(name);
    if (semitone < 0) throw new Error(`Unknown note name: "${name}"`);
    return (octave + 1) * 12 + semitone;
}

// 60 → 'C4', 69 → 'A4'
function midiToNote(midi) {
    const octave = Math.floor(midi / 12) - 1;
    const semitone = midi % 12;
    return NOTE_NAMES[semitone] + octave;
}

// MIDI number → frequency (A4 = 440 Hz, equal temperament)
function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
}

// Frequency → nearest MIDI number
function freqToMidi(freq) {
    return Math.round(69 + 12 * Math.log2(freq / 440));
}

// Convenience: 'C4' → 261.63
function noteToFreq(str) {
    return midiToFreq(noteToMidi(str));
}

// ─── Intervals ────────────────────────────────────────────────

const INTERVALS = {
    unison: 0, m2: 1, M2: 2, m3: 3, M3: 4, P4: 5,
    tritone: 6, P5: 7, m6: 8, M6: 9, m7: 10, M7: 11, octave: 12,
};

// ─── Scales ───────────────────────────────────────────────────

const SCALES = {
    major:           [0, 2, 4, 5, 7, 9, 11],
    minor:           [0, 2, 3, 5, 7, 8, 10],
    harmonicMinor:   [0, 2, 3, 5, 7, 8, 11],
    melodicMinor:    [0, 2, 3, 5, 7, 9, 11],
    pentatonicMajor: [0, 2, 4, 7, 9],
    pentatonicMinor: [0, 3, 5, 7, 10],
    blues:           [0, 3, 5, 6, 7, 10],
    dorian:          [0, 2, 3, 5, 7, 9, 10],
    phrygian:        [0, 1, 3, 5, 7, 8, 10],
    lydian:          [0, 2, 4, 6, 7, 9, 11],
    mixolydian:      [0, 2, 4, 5, 7, 9, 10],
    locrian:         [0, 1, 3, 5, 6, 8, 10],
    chromatic:       [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    wholeTone:       [0, 2, 4, 6, 8, 10],
};

// Get one octave of scale as MIDI numbers. root: 'C4' or MIDI number.
function getScale(root, scaleName) {
    const rootMidi = typeof root === 'string' ? noteToMidi(root) : root;
    const pattern = SCALES[scaleName];
    if (!pattern) throw new Error(`Unknown scale: "${scaleName}"`);
    return pattern.map(offset => rootMidi + offset);
}

// Get multi-octave scale. Returns MIDI numbers spanning the given octave count.
function getScaleMultiOctave(root, scaleName, octaves = 2) {
    const rootMidi = typeof root === 'string' ? noteToMidi(root) : root;
    const pattern = SCALES[scaleName];
    if (!pattern) throw new Error(`Unknown scale: "${scaleName}"`);
    const notes = [];
    for (let oct = 0; oct < octaves; oct++) {
        for (const offset of pattern) {
            notes.push(rootMidi + oct * 12 + offset);
        }
    }
    notes.push(rootMidi + octaves * 12); // include top note
    return notes;
}

// Same as getScale but returns frequencies
function getScaleFreqs(root, scaleName) {
    return getScale(root, scaleName).map(midiToFreq);
}

// ─── Chords ───────────────────────────────────────────────────

const CHORDS = {
    major:  [0, 4, 7],
    minor:  [0, 3, 7],
    dim:    [0, 3, 6],
    aug:    [0, 4, 8],
    sus2:   [0, 2, 7],
    sus4:   [0, 5, 7],
    dom7:   [0, 4, 7, 10],
    maj7:   [0, 4, 7, 11],
    min7:   [0, 3, 7, 10],
    dim7:   [0, 3, 6, 9],
    halfDim7: [0, 3, 6, 10],
    aug7:   [0, 4, 8, 10],
    add9:   [0, 4, 7, 14],
    min9:   [0, 3, 7, 10, 14],
    power:  [0, 7],
    sixth:  [0, 4, 7, 9],
    min6:   [0, 3, 7, 9],
};

// Get chord as MIDI numbers. root: 'C4' or MIDI number, inversion: 0-based.
function getChord(root, chordName, inversion = 0) {
    const rootMidi = typeof root === 'string' ? noteToMidi(root) : root;
    const pattern = CHORDS[chordName];
    if (!pattern) throw new Error(`Unknown chord: "${chordName}"`);
    const notes = pattern.map(offset => rootMidi + offset);
    // Apply inversion: move bottom N notes up an octave
    for (let i = 0; i < inversion && i < notes.length; i++) {
        notes[i] += 12;
    }
    notes.sort((a, b) => a - b);
    return notes;
}

// Same as getChord but returns frequencies
function getChordFreqs(root, chordName, inversion = 0) {
    return getChord(root, chordName, inversion).map(midiToFreq);
}

// ─── Progressions ─────────────────────────────────────────────

// Scale degree info for diatonic progressions.
// Each entry: [scale degree offset (0-indexed), chord quality]
// Derived from the scale's interval pattern.
const MAJOR_DEGREE_QUALITIES = ['major', 'minor', 'minor', 'major', 'major', 'minor', 'dim'];
const MINOR_DEGREE_QUALITIES = ['minor', 'dim', 'major', 'minor', 'minor', 'major', 'major'];

// Roman numeral parsing
const ROMAN_MAP = {
    'I': 0, 'II': 1, 'III': 2, 'IV': 3, 'V': 4, 'VI': 5, 'VII': 6,
    'i': 0, 'ii': 1, 'iii': 2, 'iv': 3, 'v': 4, 'vi': 5, 'vii': 6,
};

// Named progressions as roman numeral strings
const PROGRESSIONS = {
    'I-IV-V-I':      ['I', 'IV', 'V', 'I'],
    'I-V-vi-IV':     ['I', 'V', 'vi', 'IV'],       // pop
    'ii-V-I':        ['ii', 'V', 'I'],              // jazz
    'I-vi-IV-V':     ['I', 'vi', 'IV', 'V'],        // 50s
    'I-IV-vi-V':     ['I', 'IV', 'vi', 'V'],        // modern pop
    'i-iv-V':        ['i', 'iv', 'V'],              // minor common
    'i-VI-III-VII':  ['i', 'VI', 'III', 'VII'],     // epic/cinematic
    'i-iv-v-i':      ['i', 'iv', 'v', 'i'],         // natural minor
    'I-IV-V':        ['I', 'IV', 'V'],              // basic major
    'vi-IV-I-V':     ['vi', 'IV', 'I', 'V'],        // axis
    '12-bar-blues':  ['I', 'I', 'I', 'I', 'IV', 'IV', 'I', 'I', 'V', 'IV', 'I', 'V'],
};

// Parse a single roman numeral → { degree (0-6), isMinor, modifier }
function parseRoman(numeral) {
    let s = numeral.trim();
    let modifier = null;

    // Check for trailing chord modifiers: 7, maj7, dim, aug, sus2, sus4
    if (s.endsWith('dim7')) { modifier = 'dim7'; s = s.slice(0, -4); }
    else if (s.endsWith('dim')) { modifier = 'dim'; s = s.slice(0, -3); }
    else if (s.endsWith('aug')) { modifier = 'aug'; s = s.slice(0, -3); }
    else if (s.endsWith('maj7')) { modifier = 'maj7'; s = s.slice(0, -4); }
    else if (s.endsWith('7')) { modifier = '7'; s = s.slice(0, -1); }
    else if (s.endsWith('sus2')) { modifier = 'sus2'; s = s.slice(0, -4); }
    else if (s.endsWith('sus4')) { modifier = 'sus4'; s = s.slice(0, -4); }

    const isMinor = s === s.toLowerCase();
    const degree = ROMAN_MAP[s];
    if (degree === undefined) throw new Error(`Unknown roman numeral: "${numeral}"`);
    return { degree, isMinor, modifier };
}

/**
 * Build a chord progression from a key and progression name or array.
 * @param {string|number} key - Root note, e.g. 'C4' or 60
 * @param {string} scaleName - 'major' or 'minor'
 * @param {string|string[]} progression - Name from PROGRESSIONS or array of roman numerals
 * @returns {Array<{root: number, type: string, notes: number[]}>}
 */
function buildProgression(key, scaleName, progression) {
    const keyMidi = typeof key === 'string' ? noteToMidi(key) : key;
    const scalePattern = SCALES[scaleName] || SCALES.major;
    const degreeQualities = scaleName === 'minor' || scaleName === 'harmonicMinor' || scaleName === 'melodicMinor'
        ? MINOR_DEGREE_QUALITIES
        : MAJOR_DEGREE_QUALITIES;

    const numerals = Array.isArray(progression)
        ? progression
        : PROGRESSIONS[progression];
    if (!numerals) throw new Error(`Unknown progression: "${progression}"`);

    return numerals.map(numeral => {
        const { degree, isMinor, modifier } = parseRoman(numeral);
        const rootOffset = scalePattern[degree] || 0;
        const root = keyMidi + rootOffset;

        let type;
        if (modifier) {
            // Explicit modifier overrides
            if (modifier === '7') type = isMinor ? 'min7' : 'dom7';
            else type = modifier;
        } else if (isMinor) {
            type = degreeQualities[degree] === 'dim' ? 'dim' : 'minor';
        } else {
            type = degreeQualities[degree] === 'dim' ? 'dim' : 'major';
        }

        return { root, type, notes: getChord(root, type) };
    });
}

// ─── Rhythm Helpers ───────────────────────────────────────────

// Duration values in beats (quarter note = 1 beat)
const DURATIONS = {
    whole: 4,
    half: 2,
    quarter: 1,
    eighth: 0.5,
    sixteenth: 0.25,
    thirtySecond: 0.125,
    dottedWhole: 6,
    dottedHalf: 3,
    dottedQuarter: 1.5,
    dottedEighth: 0.75,
    tripletQuarter: 2 / 3,
    tripletEighth: 1 / 3,
    tripletSixteenth: 1 / 6,
};

// Convert beats to seconds at a given BPM
function beatsToSeconds(beats, bpm) {
    return (beats / bpm) * 60;
}

// Convert bars to seconds
function barsToSeconds(bars, bpm, beatsPerBar = 4) {
    return beatsToSeconds(bars * beatsPerBar, bpm);
}

// Get the number of beats in a bar
function secondsToBeats(seconds, bpm) {
    return (seconds * bpm) / 60;
}

// ─── Utility ──────────────────────────────────────────────────

// Transpose an array of MIDI numbers by semitones
function transpose(notes, semitones) {
    return notes.map(n => n + semitones);
}

// Get a random note from a scale
function randomScaleNote(root, scaleName, octaves = 2) {
    const notes = getScaleMultiOctave(root, scaleName, octaves);
    return notes[Math.floor(Math.random() * notes.length)];
}

module.exports = {
    NOTE_NAMES, FLAT_MAP,
    // Note/frequency
    noteToMidi, midiToNote, midiToFreq, freqToMidi, noteToFreq, parseNote,
    // Intervals
    INTERVALS,
    // Scales
    SCALES, getScale, getScaleMultiOctave, getScaleFreqs,
    // Chords
    CHORDS, getChord, getChordFreqs,
    // Progressions
    PROGRESSIONS, buildProgression, parseRoman,
    // Rhythm
    DURATIONS, beatsToSeconds, barsToSeconds, secondsToBeats,
    // Utility
    transpose, randomScaleNote,
};
