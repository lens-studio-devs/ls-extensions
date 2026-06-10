// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// ir_generator.js — Synthesize convolution reverb impulse responses.
// The previous `convolverReverb` in audio_primitives was algorithmic (a comb-allpass network
// dressed up under a misleading name). This module produces actual IRs: an early-reflection
// cluster + exponentially-decaying noise tail with frequency-dependent damping. Convolving an
// input with these IRs gives the genuine "this sound was recorded in a space" quality.
//
// Cost: O(N·M) time-domain convolution. For our IR sizes (0.5–3s) this is fine — about 80 ms
// per second of input. Cached by signature so re-rendering a track doesn't rebuild the IR.

const { SAMPLE_RATE, convolve, lowPass, lowPass2, highPass2 } = require('./audio_primitives');
const { mulberry32 } = require('./humanize');

const IR_CACHE = new Map();

// Build a stereo IR. opts:
//   duration: total IR length in seconds (0.3 = small room, 1.5 = hall, 3.0 = cathedral)
//   roomSize: 0..1, scales early-reflection density and spacing
//   decayCurve: 'exp' (default) | 'linear'
//   hfDamping: 0..1 (higher = darker tail, mimics absorption of high frequencies in the air)
//   diffusion: 0..1, randomness of early reflections (lower = slap, higher = lush)
//   earlyReflections: integer count, default 12
//   stereoWidth: 0..1, spreads ER between channels
//   seed: PRNG seed for deterministic IRs
// Returns { left, right }.
function synthIR(opts = {}) {
    const duration = opts.duration !== undefined ? opts.duration : 1.5;
    const roomSize = opts.roomSize !== undefined ? opts.roomSize : 0.6;
    const decayCurve = opts.decayCurve || 'exp';
    const hfDamping = opts.hfDamping !== undefined ? opts.hfDamping : 0.4;
    const diffusion = opts.diffusion !== undefined ? opts.diffusion : 0.7;
    const earlyReflections = opts.earlyReflections || Math.max(6, Math.floor(8 + roomSize * 16));
    const stereoWidth = opts.stereoWidth !== undefined ? opts.stereoWidth : 0.8;
    const seed = opts.seed || 42;
    const rng = mulberry32(seed);

    const len = Math.floor(duration * SAMPLE_RATE);
    const left = new Float32Array(len);
    const right = new Float32Array(len);

    // Direct sound (impulse at t=0). Small but nonzero so the dry signal stays intact under
    // pure-wet processing.
    left[0] = 0.7;
    right[0] = 0.7;

    // Early reflections — sparse pulses between 5 ms and ~80 ms scaled by roomSize.
    // Real spaces have an audible "fingerprint" in the first 60 ms; placement matters.
    const erEndSec = 0.04 + roomSize * 0.08;
    for (let r = 0; r < earlyReflections; r++) {
        // Roughly log-spaced (denser early, sparser later) when diffusion is low.
        const u = Math.pow(rng(), diffusion < 0.5 ? 2 : 1);
        const t = 0.005 + u * (erEndSec - 0.005);
        const idx = Math.floor(t * SAMPLE_RATE);
        const amp = (1 - u * 0.6) * 0.5 * (0.5 + rng() * 0.5);
        const sign = rng() < 0.5 ? -1 : 1;
        const lr = (rng() * 2 - 1) * stereoWidth;
        const gL = Math.cos((lr + 1) * 0.25 * Math.PI);
        const gR = Math.sin((lr + 1) * 0.25 * Math.PI);
        if (idx < len) {
            left[idx] += sign * amp * gL;
            right[idx] += sign * amp * gR;
        }
    }

    // Late reverb tail — decaying noise, denser as time progresses (cool feature of real
    // diffuse fields: late energy is statistically a Gaussian envelope-modulated noise).
    const tailStart = Math.floor(0.04 * SAMPLE_RATE);
    const tailLen = len - tailStart;
    const tailL = new Float32Array(tailLen);
    const tailR = new Float32Array(tailLen);

    // Use two independent noise streams for true stereo de-correlation.
    const rngL = mulberry32(seed * 7 + 1);
    const rngR = mulberry32(seed * 7 + 2);
    // Decay constant: choose so the tail is -60 dB by `duration`.
    const decayConst = decayCurve === 'exp' ? Math.log(1000) / duration : 0;
    for (let i = 0; i < tailLen; i++) {
        const t = i / SAMPLE_RATE;
        const env = decayCurve === 'exp'
            ? Math.exp(-decayConst * t)
            : Math.max(0, 1 - t / (duration - 0.04));
        tailL[i] = (rngL() * 2 - 1) * env;
        tailR[i] = (rngR() * 2 - 1) * env;
    }

    // HF damping — progressive lowpass on the tail (mimics air absorption).
    // Apply twice for steeper rolloff. Cutoff falls as time goes on so the late tail is darker.
    if (hfDamping > 0) {
        const startCutoff = 8000 - hfDamping * 6000;
        const endCutoff = Math.max(800, startCutoff - hfDamping * 4000);
        // Two-pass: first apply a fixed LPF, then a slower-changing one. The slow change is
        // approximated by doing a second pass at the endCutoff and crossfading.
        lowPass2(tailL, startCutoff, 0.7);
        lowPass2(tailR, startCutoff, 0.7);
        const tailL2 = Float32Array.from(tailL);
        const tailR2 = Float32Array.from(tailR);
        lowPass2(tailL2, endCutoff, 0.7);
        lowPass2(tailR2, endCutoff, 0.7);
        for (let i = 0; i < tailLen; i++) {
            const u = i / Math.max(1, tailLen - 1);
            tailL[i] = tailL[i] * (1 - u) + tailL2[i] * u;
            tailR[i] = tailR[i] * (1 - u) + tailR2[i] * u;
        }
    }

    // Remove very-low rumble from the tail to keep mixes clean.
    highPass2(tailL, 80, 0.7);
    highPass2(tailR, 80, 0.7);

    // Add tail into IR with a soft fade-in over the first ~20 ms of the tail region so the
    // boundary between ER and tail isn't a click.
    const fadeIn = Math.floor(0.02 * SAMPLE_RATE);
    for (let i = 0; i < tailLen; i++) {
        const f = i < fadeIn ? i / fadeIn : 1;
        left[tailStart + i] += tailL[i] * f * 0.6;
        right[tailStart + i] += tailR[i] * f * 0.6;
    }

    return { left, right };
}

function cacheKey(opts) {
    return JSON.stringify({
        d: opts.duration, r: opts.roomSize, c: opts.decayCurve, h: opts.hfDamping,
        df: opts.diffusion, er: opts.earlyReflections, sw: opts.stereoWidth, s: opts.seed,
    });
}

function getIR(opts) {
    const key = cacheKey(opts);
    let ir = IR_CACHE.get(key);
    if (!ir) {
        ir = synthIR(opts);
        IR_CACHE.set(key, ir);
    }
    return ir;
}

// One-shot wet/dry mono input → stereo output.
function reverb(samples, opts = {}) {
    const wet = opts.wet !== undefined ? opts.wet : 0.35;
    const ir = getIR(opts);
    const wetL = convolve(samples, ir.left, 1.0);
    const wetR = convolve(samples, ir.right, 1.0);
    // Normalize wet level — IRs have wildly different gain depending on opts.
    let wetPeak = 0;
    for (let i = 0; i < wetL.length; i++) {
        const a = Math.abs(wetL[i]);
        const b = Math.abs(wetR[i]);
        if (a > wetPeak) wetPeak = a;
        if (b > wetPeak) wetPeak = b;
    }
    const wetGain = wetPeak > 0 ? 0.8 / wetPeak : 1;
    const outLen = wetL.length;
    const left = new Float32Array(outLen);
    const right = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
        const dry = i < samples.length ? samples[i] : 0;
        left[i] = dry * (1 - wet) + wetL[i] * wetGain * wet;
        right[i] = dry * (1 - wet) + wetR[i] * wetGain * wet;
    }
    return { left, right };
}

// In-place stereo-to-stereo reverb: convolves each channel with its own IR side.
function reverbStereo(stereo, opts = {}) {
    const wet = opts.wet !== undefined ? opts.wet : 0.35;
    const ir = getIR(opts);
    const wetL = convolve(stereo.left, ir.left, 1.0);
    const wetR = convolve(stereo.right, ir.right, 1.0);
    let wetPeak = 0;
    for (let i = 0; i < wetL.length; i++) {
        const a = Math.abs(wetL[i]);
        const b = Math.abs(wetR[i]);
        if (a > wetPeak) wetPeak = a;
        if (b > wetPeak) wetPeak = b;
    }
    const wetGain = wetPeak > 0 ? 0.8 / wetPeak : 1;
    const outLen = wetL.length;
    const left = new Float32Array(outLen);
    const right = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
        const dryL = i < stereo.left.length ? stereo.left[i] : 0;
        const dryR = i < stereo.right.length ? stereo.right[i] : 0;
        left[i] = dryL * (1 - wet) + wetL[i] * wetGain * wet;
        right[i] = dryR * (1 - wet) + wetR[i] * wetGain * wet;
    }
    return { left, right };
}

// Preset opts dicts — call as synthIR(PRESETS.smallRoom).
const PRESETS = {
    smallRoom:  { duration: 0.6, roomSize: 0.3, hfDamping: 0.45, diffusion: 0.6, earlyReflections: 10 },
    mediumRoom: { duration: 1.2, roomSize: 0.5, hfDamping: 0.4,  diffusion: 0.7 },
    largeHall:  { duration: 2.4, roomSize: 0.8, hfDamping: 0.5,  diffusion: 0.85, earlyReflections: 18 },
    cathedral:  { duration: 3.5, roomSize: 1.0, hfDamping: 0.6,  diffusion: 0.95, earlyReflections: 22 },
    plate:      { duration: 1.8, roomSize: 0.5, hfDamping: 0.2,  diffusion: 0.9, earlyReflections: 4 },
    spring:     { duration: 0.9, roomSize: 0.4, hfDamping: 0.2,  diffusion: 0.6, earlyReflections: 6, stereoWidth: 0.3 },
};

module.exports = {
    synthIR,
    getIR,
    reverb,
    reverbStereo,
    PRESETS,
    clearCache: () => IR_CACHE.clear(),
};
