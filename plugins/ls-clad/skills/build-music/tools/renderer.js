// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// renderer.js — Voice-based multi-track renderer.
// Replaces the legacy midi_renderer.js. Each track binds an events array to a voice, optional
// FX dict, and gain. The renderer humanizes events (timing + velocity), renders every note
// through the voice (with per-call wobble), sums tracks into a stereo bus, then runs the
// master chain.

const {
    SAMPLE_RATE,
    audio_primitives,
    synth_voices,
    humanize,
    mix_bus,
} = require('../../build-sfx/tools');
const { applyFx, masterChain } = mix_bus;
const { humanizeEvents, voiceJitter } = humanize;
const { addInto, mixStereo, panMono } = audio_primitives;
const { VOICES } = synth_voices;

// Create a track descriptor. The renderer consumes an array of these.
// Args:
//   name:     friendly track name (for logging / debugging)
//   voice:    voice name (key into VOICES) OR a function (midi, durBeats, vel, bpm, ctx) → Float32Array
//   events:   array of { time, beats, value, velocity }
//   opts:
//     fx:        per-track FX dict for applyFx
//     gain:      linear gain multiplier (default 1)
//     pan:       -1..+1 (placed onto the track's FX chain if not already set)
//     quantize:  'strict' to disable timing humanization (velocity humanize still applies)
//     humanize:  { timeJitter, velJitter, pitchDriftCents } override
//     ctx:       extra ctx passed to the voice (e.g. detuneCents)
//     seed:      humanization seed (deterministic if set)
function track(name, voice, events, opts = {}) {
    return { name, voice, events, opts };
}

// Render a list of tracks. Returns { left, right }.
// renderOpts:
//   bpm:           tempo
//   duration:      seconds — if omitted, derived from the latest event end + 1.5s tail
//   master:        opts for masterChain ({ normalize, peakCeiling, targetRMS })
//   defaultHumanize: { timeJitter, velJitter } applied unless track sets quantize:'strict'
function render(tracks, renderOpts = {}) {
    const bpm = renderOpts.bpm || 120;
    const masterOpts = renderOpts.master || {};
    const defaultHumanize = renderOpts.defaultHumanize || { timeJitter: 0.008, velJitter: 0.12 };

    // Pre-pass: humanize events per track
    const tracksReady = tracks.map((tr, idx) => {
        const seed = tr.opts.seed !== undefined ? tr.opts.seed : 11 + idx * 7;
        const evCopy = tr.events.map(e => Object.assign({ time: e.time, beats: e.beats, value: e.value, velocity: e.velocity }));
        // Translate beat-time to seconds-time
        for (const e of evCopy) e.time = e.time * 60 / bpm;
        if (tr.opts.quantize !== 'strict') {
            humanizeEvents(evCopy, Object.assign({ rng: humanize.mulberry32(seed) }, defaultHumanize, tr.opts.humanize || {}));
        }
        // Resolve voice
        const voiceFn = typeof tr.voice === 'function'
            ? tr.voice
            : VOICES[tr.voice];
        if (!voiceFn) throw new Error(`Unknown voice: ${tr.voice}`);
        // Wrap with voice-level wobble (cutoff / detune jitter per call)
        const wobbled = voiceJitter(voiceFn, { seed });
        return { tr, evCopy, voiceFn: wobbled };
    });

    // Figure out total duration in samples
    let maxEndSec = 0;
    for (const { evCopy } of tracksReady) {
        for (const e of evCopy) {
            const endSec = e.time + (e.beats * 60 / bpm) + 3.5; // generous decay tail
            if (endSec > maxEndSec) maxEndSec = endSec;
        }
    }
    const duration = renderOpts.duration !== undefined ? renderOpts.duration : Math.max(2.0, maxEndSec);
    const totalSamples = Math.floor(duration * SAMPLE_RATE);

    // Render each track to its own mono buffer first, then process FX, then mix.
    const trackStereos = [];
    for (const { tr, evCopy, voiceFn } of tracksReady) {
        const trackMono = new Float32Array(totalSamples);
        for (const e of evCopy) {
            if (e.value === '~' || e.value === null || e.value === undefined) continue;
            const midi = typeof e.value === 'number' ? e.value : null;
            if (midi === null) continue;
            const startSample = Math.floor(e.time * SAMPLE_RATE);
            if (startSample >= totalSamples) continue;
            const ctx = Object.assign({}, tr.opts.ctx || {});
            const noteBuf = voiceFn(midi, e.beats, e.velocity, bpm, ctx);
            addInto(trackMono, noteBuf, startSample, 1.0);
        }
        // Per-track FX
        let processed = trackMono;
        const trackFx = Object.assign({}, tr.opts.fx || {});
        if (tr.opts.gain !== undefined && trackFx.gain === undefined) trackFx.gain = tr.opts.gain;
        if (tr.opts.pan !== undefined && trackFx.pan === undefined) trackFx.pan = tr.opts.pan;
        processed = applyFx(processed, trackFx);
        // Promote to stereo if still mono
        if (!processed.left) {
            const stereo = panMono(processed, 0);
            processed = stereo;
        }
        // Ensure length matches totalSamples (FX like delay/reverb can extend it)
        if (processed.left.length !== totalSamples) {
            const L = new Float32Array(totalSamples);
            const R = new Float32Array(totalSamples);
            for (let i = 0; i < Math.min(totalSamples, processed.left.length); i++) {
                L[i] = processed.left[i];
                R[i] = processed.right[i];
            }
            processed = { left: L, right: R };
        }
        trackStereos.push(processed);
    }

    // Mix all tracks
    const bus = mixStereo(trackStereos);
    // Master chain
    masterChain(bus, masterOpts);
    return bus;
}

module.exports = {
    track,
    render,
};
