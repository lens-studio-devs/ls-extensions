// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// Engine barrel — single import surface for build-sfx; also re-exported by build-music.
// Usage:
//   const audio = require('<absolute path to build-sfx>/tools');
//   audio.synth_voices.piano(60, 1, 100, 120);
//   audio.WavBuilder.write(samples, '/abs/out.wav');

const audio_primitives = require('./audio_primitives');
const music_theory = require('./music_theory');
const osc_models = require('./osc_models');
const synth_voices = require('./synth_voices');
const humanize = require('./humanize');
const mix_bus = require('./mix_bus');
const ir_generator = require('./ir_generator');
const granular = require('./granular');
const transient_designer = require('./transient_designer');
const { WavBuilder } = require('./wav_builder');

module.exports = {
    // Sub-modules (preferred — namespaced)
    audio_primitives,
    music_theory,
    osc_models,
    synth_voices,
    humanize,
    mix_bus,
    ir_generator,
    granular,
    transient_designer,
    // WAV writer
    WavBuilder,
    // Flat re-export of audio_primitives for terse SFX recipes
    ...audio_primitives,
};
