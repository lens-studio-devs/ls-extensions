// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// build-music/tools/index.js — re-export the build-sfx audio engine + add music-only modules.
// build-sfx owns the synthesis engine (oscillators, voices, mix bus, IR generator, etc.).
// This skill layers pattern parsing, arrangement masks, and a track-based renderer on top.
const engine = require('../../build-sfx/tools');
const pattern = require('./pattern');
const arrangement = require('./arrangement');
const renderer = require('./renderer');
const harmony = require('./harmony');

module.exports = {
    ...engine,
    pattern,
    arrangement,
    renderer,
    harmony,
    // Convenience re-exports of common music-pipeline entry points.
    // NOTE: `repeat` MUST be the pattern.js (events-array) version, not the
    // build-sfx audio_primitives sample-buffer version that `...engine` spreads
    // in above. Without this explicit alias `m.repeat(events, N)` resolves to
    // the sample-buffer repeat, which silently coerces event objects to NaN
    // and the renderer writes 100% digital silence. The audio-primitive form
    // is still reachable via `m.audio_primitives.repeat` if needed.
    parseMini: pattern.parseMini,
    scale: pattern.scale,
    stack: pattern.stack,
    mask: pattern.mask,
    repeat: pattern.repeat,
    track: renderer.track,
    render: renderer.render,
    composeChords: harmony.composeChords,
    composeArpeggio: harmony.composeArpeggio,
    composeMelody: harmony.composeMelody,
    chordEvents: harmony.chordEvents,
};
