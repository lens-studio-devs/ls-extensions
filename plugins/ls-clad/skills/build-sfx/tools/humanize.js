// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// humanize.js — The anti-machine pass.
// Static parameters → robotic sound. Add 1-D smooth gradient noise, per-event timing/velocity jitter,
// and per-voice parameter wobble, and the same code starts to feel "played" rather than "rendered."

const { SAMPLE_RATE, TWO_PI } = require('./audio_primitives');

// ─── PRNG ──────────────────────────────────────────────────
// Tiny seeded PRNG so a seed gives reproducible humanization.
function mulberry32(seed) {
    let s = seed >>> 0;
    return function () {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ─── 1-D smooth gradient noise ─────────────────────────────
// Pseudo-random gradient at each integer position, smoothstep-interpolated between.
// Output in roughly [-1, 1]. `scale` = how fast values change (lower = slower drift).
function smoothNoise1D(seed = 1, scale = 1) {
    const rng = mulberry32(seed);
    const gradients = new Float32Array(1024);
    for (let i = 0; i < gradients.length; i++) gradients[i] = rng() * 2 - 1;
    const len = gradients.length;
    function smoothstep(t) { return t * t * (3 - 2 * t); }
    return function (t) {
        const x = t * scale;
        const x0 = Math.floor(x);
        const xf = x - x0;
        const g0 = gradients[((x0 % len) + len) % len];
        const g1 = gradients[((x0 + 1) % len + len) % len];
        const u = smoothstep(xf);
        return g0 * (1 - u) + g1 * u;
    };
}

function jitter(value, amount, rng = Math.random) {
    return value + (rng() * 2 - 1) * amount;
}

// ─── Event-level humanization ──────────────────────────────
// Mutates an array of {time, midi, velocity, duration} (and any extras) in place.
// opts.timeJitter: seconds (±). Recommended 0.005–0.015 for naturalness.
// opts.velJitter: 0..1 multiplier of velocity range (0..127). 0.05–0.20 typical.
// opts.pitchDriftCents: subtle pitch jitter (use 0 unless going for vintage tape feel).
// opts.groove: 'swing' adds a swing (delays every other 8th-note); pass `subdivisionBeats`
//   (default 0.5) to control where the swing applies.
function humanizeEvents(events, opts = {}) {
    const timeJitter = opts.timeJitter !== undefined ? opts.timeJitter : 0.008;
    const velJitter = opts.velJitter !== undefined ? opts.velJitter : 0.12;
    const pitchDriftCents = opts.pitchDriftCents || 0;
    const rng = opts.rng || Math.random;
    const swing = opts.groove === 'swing' ? (opts.swingAmount !== undefined ? opts.swingAmount : 0.16) : 0;
    const subdivisionBeats = opts.subdivisionBeats || 0.5;

    for (const e of events) {
        if (timeJitter > 0) e.time = Math.max(0, e.time + (rng() * 2 - 1) * timeJitter);
        if (velJitter > 0 && typeof e.velocity === 'number') {
            const range = 127 * velJitter;
            e.velocity = Math.max(1, Math.min(127, e.velocity + (rng() * 2 - 1) * range));
        }
        if (pitchDriftCents > 0) {
            e.detuneCents = (e.detuneCents || 0) + (rng() * 2 - 1) * pitchDriftCents;
        }
        if (swing && e.beat !== undefined) {
            // Every "off-beat" (odd subdivision) gets pushed later
            const subBeat = e.beat / subdivisionBeats;
            if (Math.round(subBeat) % 2 === 1) {
                e.time += swing * (60 / (opts.bpm || 120)) * subdivisionBeats;
            }
        }
    }
    return events;
}

// ─── Voice-call wobble ─────────────────────────────────────
// Wraps a voice function so every call uses subtly different parameters.
// Pass `paramMutator(ctx, rng)` to mutate the per-call context dict.
// Most callers can use the built-in defaults instead.
function voiceJitter(voiceFn, opts = {}) {
    const cutoffDriftPct = opts.cutoffDriftPct !== undefined ? opts.cutoffDriftPct : 0.06;
    const detuneCents = opts.detuneCents !== undefined ? opts.detuneCents : 3;
    const attackJitterMs = opts.attackJitterMs !== undefined ? opts.attackJitterMs : 1.5;
    const seed = opts.seed || 1;
    let counter = 0;
    return function (midi, durBeats, velocity, bpm, ctx) {
        const rng = mulberry32(seed + (counter++));
        const myCtx = Object.assign({}, ctx || {});
        myCtx.rng = rng;
        myCtx.cutoffMultiplier = 1 + (rng() * 2 - 1) * cutoffDriftPct;
        myCtx.detuneCents = (myCtx.detuneCents || 0) + (rng() * 2 - 1) * detuneCents;
        myCtx.attackMs = (myCtx.attackMs || 0) + (rng() * 2 - 1) * attackJitterMs;
        if (opts.paramMutator) opts.paramMutator(myCtx, rng);
        return voiceFn(midi, durBeats, velocity, bpm, myCtx);
    };
}

// ─── Buffer-level micro-modulation ─────────────────────────

// Slow amplitude breathing via smooth gradient noise. Depth 0..1 — 0.05 subtle, 0.2 obvious.
function ampWobble(samples, rate = 0.4, depth = 0.08, seed = 1) {
    const noise = smoothNoise1D(seed, rate);
    for (let i = 0; i < samples.length; i++) {
        const t = i / SAMPLE_RATE;
        const m = 1 + noise(t) * depth;
        samples[i] *= m;
    }
    return samples;
}

// Smooth-noise-driven pitch drift via fractional-delay resampling.
// cents: maximum pitch deviation in cents (5–20 typical). rate: how fast the wobble moves.
function pitchDrift(samples, cents = 8, rate = 0.7, seed = 7) {
    const len = samples.length;
    const out = new Float32Array(len);
    const noise = smoothNoise1D(seed, rate);
    let readPos = 0;
    for (let i = 0; i < len; i++) {
        const t = i / SAMPLE_RATE;
        // Convert cents-deviation to playback-rate multiplier
        const rateMult = Math.pow(2, (noise(t) * cents) / 1200);
        const idx = Math.floor(readPos);
        const frac = readPos - idx;
        const a = (idx >= 0 && idx < len) ? samples[idx] : 0;
        const b = (idx + 1 >= 0 && idx + 1 < len) ? samples[idx + 1] : 0;
        out[i] = a + frac * (b - a);
        readPos += rateMult;
        if (readPos >= len - 1) readPos = len - 1;
    }
    return out;
}

// Random micro-gain drift between segments — emulates "different player attacks each note."
function segmentGainDrift(samples, segmentSec = 0.2, amount = 0.06, seed = 13) {
    const noise = smoothNoise1D(seed, 1 / segmentSec);
    for (let i = 0; i < samples.length; i++) {
        const t = i / SAMPLE_RATE;
        samples[i] *= 1 + noise(t) * amount;
    }
    return samples;
}

module.exports = {
    mulberry32,
    smoothNoise1D,
    jitter,
    humanizeEvents,
    voiceJitter,
    ampWobble,
    pitchDrift,
    segmentGainDrift,
};
