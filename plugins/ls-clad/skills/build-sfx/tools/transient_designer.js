// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// transient_designer.js — Attack/body split for impactful SFX.
// Real foley is rarely one sound. A punch is "knuckle slap + flesh thump." A glass break is
// "shatter crack + ringing shards." A kick is "click + boom." This module exposes that pattern
// cleanly: build the attack (sharp, brief) and the body (tonal or noisy, longer) separately,
// then layer them.

const {
    SAMPLE_RATE, whiteNoise, pinkNoise, sine, sawtooth, triangle, sweep,
    adsrExp, lowPass2, highPass2, bandPass, fadeOut, addInto, distortion, normalizePeak,
} = require('./audio_primitives');

// Split a single buffer into attack vs body at `splitMs`. Useful when you generated a tone
// and want to separately treat its first few milliseconds (e.g., to enhance them).
function splitTransient(samples, splitMs = 8) {
    const splitIdx = Math.min(samples.length, Math.floor(splitMs * 0.001 * SAMPLE_RATE));
    const attack = samples.slice(0, splitIdx);
    const body = samples.slice(splitIdx);
    return { attack, body };
}

// Build an impact from two layers.
// opts.attack: { kind: 'click'|'noise'|'snap', durationMs, lpHz, gain }
// opts.body:   { kind: 'tonal'|'noise'|'thump', freq, decay, lpHz, hpHz, gain, dist }
// opts.totalDuration: seconds (defaults to attack.dur + body.decay)
function designImpact(opts = {}) {
    const a = Object.assign({
        kind: 'click', durationMs: 10, lpHz: 6000, hpHz: 200, gain: 0.7,
    }, opts.attack || {});
    const b = Object.assign({
        kind: 'thump', freq: 80, decay: 0.25, lpHz: 800, hpHz: 40, gain: 0.7, dist: 0,
    }, opts.body || {});
    const total = opts.totalDuration || Math.max(a.durationMs / 1000, b.decay) + 0.05;
    const out = new Float32Array(Math.floor(total * SAMPLE_RATE));

    // ─ Attack layer ─
    const attackDur = a.durationMs / 1000;
    let attack;
    if (a.kind === 'click') {
        attack = sweep(a.freqStart || 4000, a.freqEnd || 600, attackDur, 'triangle', 'exponential');
    } else if (a.kind === 'snap') {
        attack = whiteNoise(attackDur);
        bandPass(attack, a.centerHz || 2500, 4);
    } else {
        attack = whiteNoise(attackDur);
    }
    if (a.hpHz) highPass2(attack, a.hpHz);
    if (a.lpHz) lowPass2(attack, a.lpHz);
    // Very fast attack envelope — ~0.5 ms attack, exponential decay across the layer.
    adsrExp(attack, 0.0005, attackDur * 0.6, 0.0, attackDur * 0.4, 4);
    fadeOut(attack, Math.min(0.005, attackDur * 0.3));
    addInto(out, attack, 0, a.gain);

    // ─ Body layer ─
    let body;
    const bodyLen = Math.floor(b.decay * SAMPLE_RATE);
    if (b.kind === 'tonal') {
        body = sine(b.freq, b.decay, 1.0);
        // Optional second partial for richness
        if (b.partials) {
            for (let p = 2; p <= b.partials; p++) {
                const partial = sine(b.freq * p, b.decay, 1 / (p * 1.8));
                for (let i = 0; i < body.length; i++) body[i] += partial[i];
            }
        }
    } else if (b.kind === 'thump') {
        // Pitch-sweep that drops, classic kick / impact thump
        body = sweep(b.freq * 3, b.freq, b.decay, 'sine', 'exponential');
    } else if (b.kind === 'noise') {
        body = whiteNoise(b.decay);
    } else if (b.kind === 'pink') {
        body = pinkNoise(b.decay);
    } else {
        body = sine(b.freq, b.decay, 1.0);
    }
    if (b.hpHz) highPass2(body, b.hpHz);
    if (b.lpHz) lowPass2(body, b.lpHz);
    if (b.dist) {
        const distorted = distortion(body, b.dist);
        for (let i = 0; i < body.length; i++) body[i] = distorted[i];
    }
    adsrExp(body, 0.001, b.decay * 0.4, 0.0, b.decay * 0.6, 3);
    // Body starts slightly before the attack ends so the layers blend
    const bodyStart = Math.max(0, Math.floor(attackDur * SAMPLE_RATE) - Math.floor(0.002 * SAMPLE_RATE));
    addInto(out, body, bodyStart, b.gain);

    // Final fade-out tail to prevent clicks at the end
    fadeOut(out, 0.005);
    normalizePeak(out, 0.95);
    return out;
}

// Enhance the transient of an existing buffer — boost the attack region by `attackGain`
// and lightly compress the body. Useful for layering with an already-rendered note.
function enhanceTransient(samples, opts = {}) {
    const splitMs = opts.splitMs || 8;
    const attackGain = opts.attackGain !== undefined ? opts.attackGain : 1.8;
    const bodyGain = opts.bodyGain !== undefined ? opts.bodyGain : 0.85;
    const out = Float32Array.from(samples);
    const splitIdx = Math.min(out.length, Math.floor(splitMs * 0.001 * SAMPLE_RATE));
    for (let i = 0; i < splitIdx; i++) out[i] *= attackGain;
    // Smooth crossfade over 5 ms after the split
    const fadeLen = Math.min(out.length - splitIdx, Math.floor(0.005 * SAMPLE_RATE));
    for (let i = 0; i < fadeLen; i++) {
        const u = i / fadeLen;
        out[splitIdx + i] *= attackGain * (1 - u) + bodyGain * u;
    }
    for (let i = splitIdx + fadeLen; i < out.length; i++) out[i] *= bodyGain;
    return out;
}

module.exports = {
    splitTransient,
    designImpact,
    enhanceTransient,
};
