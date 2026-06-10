// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// arrangement.js — Section / mask templates for piece structure.
// The single biggest "this sounds like music, not a loop" win: layers enter and exit across
// cycles. These helpers spell out the canonical 8-cycle build (intro/A/B/outro) and a few
// shorter alternatives so callers don't have to hand-craft mask strings.

// All mask strings use parseMini's weighted-sequence syntax: 'x' = active,
// '~' = inactive, '@N' = weight (proportion of the total span this element
// covers). The mask() function evaluates these as a seq, splitting the total
// cycleCount*cycleBeats span proportionally to the weights.
//
// NOTE: do NOT wrap in `<...>` — that's parseMini's cycle-indexed notation
// which picks ONE element per cycleIndex (i.e. drops the rest), not what we
// want for arrangement masks.

const MASKS = {
    // Always on (no masking).
    full:        'x',
    // 8-cycle classic: 2 cycles intro, 4 cycles A, 2 cycles outro.
    intro8:      'x@2 ~@6',
    aSection8:   '~@2 x@4 ~@2',
    bSection8:   '~@6 x@2',
    // 16-cycle longer structure: 2 intro, 6 A, 6 B (denser), 2 outro.
    intro16:     'x@2 ~@14',
    aSection16:  '~@2 x@6 ~@8',
    bSection16:  '~@8 x@6 ~@2',
    outro16:     '~@14 x@2',
    // Half-time variants (active every other cycle).
    every2:      'x ~',
    every4:      'x ~ ~ ~',
    // Build-up: starts inactive, ramps in.
    build8:      '~@2 x@1 ~@1 x@2 ~@1 x@1',
    // Drum drop pattern (silent at intro, kicks in cycle 3+).
    dropAt3of8:  '~@2 x@6',
    // Fade-out: active until last 2 cycles.
    fadeOut8:    'x@6 ~@2',
};

// Quick descriptor for a full 8-cycle arrangement.
// Returns an object mapping section name to its mask.
function arrangement8() {
    return {
        intro:  MASKS.intro8,
        a:      MASKS.aSection8,
        b:      MASKS.bSection8,
        outro:  MASKS.fadeOut8,
        full:   MASKS.full,
    };
}

function arrangement16() {
    return {
        intro:  MASKS.intro16,
        a:      MASKS.aSection16,
        b:      MASKS.bSection16,
        outro:  MASKS.outro16,
        full:   MASKS.full,
    };
}

// Build a custom mask programmatically. cycles is an array of booleans, one per cycle.
//   maskFromCycles([true, true, false, false, true, true, false, false])
//   → 'x@2 ~@2 x@2 ~@2'
function maskFromCycles(cycles) {
    if (!cycles.length) return '~';
    const parts = [];
    let run = cycles[0];
    let count = 1;
    for (let i = 1; i < cycles.length; i++) {
        if (cycles[i] === run) count++;
        else {
            parts.push((run ? 'x' : '~') + (count > 1 ? '@' + count : ''));
            run = cycles[i];
            count = 1;
        }
    }
    parts.push((run ? 'x' : '~') + (count > 1 ? '@' + count : ''));
    return parts.join(' ');
}

module.exports = {
    MASKS,
    arrangement8,
    arrangement16,
    maskFromCycles,
};
