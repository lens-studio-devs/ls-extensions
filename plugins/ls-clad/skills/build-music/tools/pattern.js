// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// pattern.js — Mini-notation parser and pattern combinators.
// Compact text representation of rhythmic patterns for offline rendering.
//
// Supported syntax:
//   "c4 e4 g4"        → three quarter-notes (when divisor=1)
//   "0 2 4 6"         → scale-degree pattern (use with scale())
//   "[a b]"           → group: a and b each take half the parent's slot
//   "{c4, e4, g4}"    → polyphonic stack (notes hit together)
//   "a*4"             → repeat 4× inside one slot
//   "a/2"             → slow by 2 (note takes 2 slots)
//   "a:0.7"           → velocity 0..1 (0.7 here → MIDI velocity 89)
//   "~"               → rest
//   "<a b c>"         → cycle between elements (one per cycle index)
//   "a@3"             → weight (extend) — a takes 3× the slot of a regular element
//
// Output: events array of { time, beats, value, velocity }.
//   time:     beat offset within one cycle, 0..cycleBeats
//   beats:    duration in beats
//   value:    string token (e.g. "c4", "0", "kick", "~", or number)
//   velocity: 1..127 (default 100, scaled by :velocity suffix and any humanize pass)

const NOTE_RE = /^([a-gA-G][#b]?)(-?\d+)$/;
const NUMERIC_RE = /^-?\d+(\.\d+)?$/;

// ─── Tokenization ──────────────────────────────────────────

function tokenize(str) {
    const tokens = [];
    let i = 0;
    while (i < str.length) {
        const c = str[i];
        if (/\s/.test(c)) { i++; continue; }
        if (c === '[' || c === ']' || c === '{' || c === '}' || c === '<' || c === '>' || c === ',') {
            tokens.push({ kind: c, value: c });
            i++;
            continue;
        }
        // Atom — read until whitespace or special char
        let j = i;
        while (j < str.length && !/[\s\[\]{}<>,]/.test(str[j])) j++;
        const atom = str.slice(i, j);
        tokens.push({ kind: 'atom', value: atom });
        i = j;
    }
    return tokens;
}

// ─── Parser → AST ──────────────────────────────────────────
// AST node shapes:
//   { type: 'seq', items: [...] }
//   { type: 'group', items: [...] }
//   { type: 'stack', items: [...] }
//   { type: 'cycle', items: [...] }
//   { type: 'atom', value: 'c4', velocity, repeat, slow, weight }

function parseAtom(tok) {
    let v = tok.value;
    let velocity = null;
    let repeat = 1;
    let slow = 1;
    let weight = 1;
    // Strip suffixes in order: :velocity, *repeat, /slow, @weight
    let m;
    while (true) {
        if ((m = v.match(/^(.*?):(-?\d+(\.\d+)?)$/))) {
            velocity = parseFloat(m[2]);
            v = m[1];
        } else if ((m = v.match(/^(.*?)\*(\d+)$/))) {
            repeat = parseInt(m[2]);
            v = m[1];
        } else if ((m = v.match(/^(.*?)\/(\d+(\.\d+)?)$/))) {
            slow = parseFloat(m[2]);
            v = m[1];
        } else if ((m = v.match(/^(.*?)@(\d+(\.\d+)?)$/))) {
            weight = parseFloat(m[2]);
            v = m[1];
        } else break;
    }
    return { type: 'atom', value: v, velocity, repeat, slow, weight };
}

function parseSeq(tokens, end) {
    const items = [];
    while (tokens.length && tokens[0].kind !== end) {
        const tok = tokens[0];
        if (tok.kind === '[') {
            tokens.shift();
            const group = parseSeq(tokens, ']');
            if (tokens.length && tokens[0].kind === ']') tokens.shift();
            items.push({ type: 'group', items: group.items });
        } else if (tok.kind === '{') {
            tokens.shift();
            const stack = parseStack(tokens);
            if (tokens.length && tokens[0].kind === '}') tokens.shift();
            items.push({ type: 'stack', items: stack });
        } else if (tok.kind === '<') {
            tokens.shift();
            const cyc = parseSeq(tokens, '>');
            if (tokens.length && tokens[0].kind === '>') tokens.shift();
            items.push({ type: 'cycle', items: cyc.items });
        } else if (tok.kind === 'atom') {
            tokens.shift();
            items.push(parseAtom(tok));
        } else {
            // unknown — skip
            tokens.shift();
        }
    }
    return { type: 'seq', items };
}

function parseStack(tokens) {
    const branches = [];
    let current = parseSeq(tokens, ',');
    branches.push(current);
    while (tokens.length && tokens[0].kind === ',') {
        tokens.shift();
        current = parseSeq(tokens, ',');
        branches.push(current);
    }
    // Stop at '}'
    return branches;
}

// ─── AST → events ──────────────────────────────────────────
// Each call to `expand` lays children inside a slot of length `len`, starting at `start`.
function expand(node, start, len, ctx, out) {
    if (node.type === 'atom') {
        if (node.value === '~') return;
        const dur = len * (node.slow || 1);
        if (node.repeat > 1) {
            const sub = dur / node.repeat;
            for (let k = 0; k < node.repeat; k++) {
                out.push({
                    time: start + sub * k,
                    beats: sub,
                    value: node.value,
                    velocity: node.velocity !== null && node.velocity !== undefined
                        ? Math.max(1, Math.min(127, Math.round(node.velocity * 127)))
                        : 100,
                });
            }
        } else {
            out.push({
                time: start,
                beats: dur,
                value: node.value,
                velocity: node.velocity !== null && node.velocity !== undefined
                    ? Math.max(1, Math.min(127, Math.round(node.velocity * 127)))
                    : 100,
            });
        }
        return;
    }
    if (node.type === 'seq' || node.type === 'group') {
        // Split `len` proportionally to weights
        const weights = node.items.map(it => (it.weight || 1));
        const totalWeight = weights.reduce((a, b) => a + b, 0);
        let cursor = start;
        for (let i = 0; i < node.items.length; i++) {
            const childLen = len * weights[i] / totalWeight;
            expand(node.items[i], cursor, childLen, ctx, out);
            cursor += childLen;
        }
        return;
    }
    if (node.type === 'stack') {
        for (const branch of node.items) {
            expand(branch, start, len, ctx, out);
        }
        return;
    }
    if (node.type === 'cycle') {
        const idx = (ctx.cycleIndex || 0) % node.items.length;
        expand(node.items[idx], start, len, ctx, out);
        return;
    }
}

// ─── Public API ────────────────────────────────────────────

// Parse mini-notation. opts.cycleBeats: how many beats one cycle takes (default 4).
function parseMini(str, opts = {}) {
    const cycleBeats = opts.cycleBeats !== undefined ? opts.cycleBeats : 4;
    const cycleIndex = opts.cycleIndex || 0;
    const tokens = tokenize(str);
    const ast = parseSeq(tokens, null);
    const events = [];
    expand(ast, 0, cycleBeats, { cycleIndex }, events);
    return events;
}

// Convert scale-degree events (with numeric `value`) to MIDI-note events.
//   scaleName: 'major', 'minor', 'pentatonicMinor', etc.
//   root: 'C4' or MIDI number — default 'C4'.
// Modifies events in place (changes value to MIDI note number).
function scale(events, scaleName = 'major', root = 'C4') {
    const mt = require('../../build-sfx/tools/music_theory');
    const rootMidi = typeof root === 'string' ? mt.noteToMidi(root) : root;
    const pattern = mt.SCALES[scaleName];
    if (!pattern) throw new Error(`Unknown scale: ${scaleName}`);
    const span = pattern.length;
    for (const e of events) {
        if (typeof e.value === 'string' && NUMERIC_RE.test(e.value)) {
            e.value = parseFloat(e.value);
        }
        if (typeof e.value !== 'number') continue;
        const deg = Math.floor(e.value);
        const octaveOffset = Math.floor(deg / span);
        const inOctave = ((deg % span) + span) % span;
        e.value = rootMidi + octaveOffset * 12 + pattern[inOctave];
    }
    return events;
}

// Convert string note-names to MIDI numbers (e.g. "c4" → 60).
function noteEvents(events) {
    const mt = require('../../build-sfx/tools/music_theory');
    for (const e of events) {
        if (typeof e.value === 'string' && NOTE_RE.test(e.value)) {
            e.value = mt.noteToMidi(e.value[0].toUpperCase() + e.value.slice(1));
        }
    }
    return events;
}

// Combine N events arrays in parallel (events at same time hit together).
function stack(...eventsArrays) {
    const combined = [];
    for (const arr of eventsArrays) for (const e of arr) combined.push(Object.assign({}, e));
    combined.sort((a, b) => a.time - b.time);
    return combined;
}

// Repeat an events array `times`, each copy offset by cycleBeats.
function repeat(events, times, cycleBeats = 4) {
    const out = [];
    for (let r = 0; r < times; r++) {
        for (const e of events) out.push(Object.assign({}, e, { time: e.time + r * cycleBeats }));
    }
    return out;
}

// Mask events with a pattern of 'x' (keep) and '~' (drop), cycled over `cycleCount` cycles.
// maskStr: a pattern like "<x ~@3>/8" or just "x x ~ x" (parsed via parseMini).
// cycleCount: total cycles the source covers.
// cycleBeats: beats per cycle.
function mask(events, maskStr, cycleCount = 1, cycleBeats = 4) {
    // Parse the mask pattern over the full timeline (cycleCount cycles)
    // by treating the mask as a single big cycle of cycleCount * cycleBeats beats.
    const maskEvents = parseMini(maskStr, { cycleBeats: cycleCount * cycleBeats });
    // For each event, check if any mask 'x' overlaps its time window.
    const kept = [];
    for (const e of events) {
        const tStart = e.time;
        const tEnd = e.time + e.beats * 0.5; // any partial overlap counts
        let active = false;
        for (const m of maskEvents) {
            if (m.value === '~') continue;
            const mStart = m.time;
            const mEnd = m.time + m.beats;
            if (tStart < mEnd && tEnd > mStart) {
                active = true;
                break;
            }
        }
        if (active) kept.push(e);
    }
    return kept;
}

// Transpose pitch by semitones (skips non-numeric events).
function transpose(events, semitones) {
    for (const e of events) {
        if (typeof e.value === 'number') e.value += semitones;
    }
    return events;
}

// Map velocity through a function (e.g., make accent on beat 1).
function accent(events, predicate, scale = 1.2) {
    for (const e of events) {
        if (predicate(e)) e.velocity = Math.min(127, Math.round(e.velocity * scale));
    }
    return events;
}

module.exports = {
    parseMini,
    scale,
    noteEvents,
    stack,
    repeat,
    mask,
    transpose,
    accent,
};
