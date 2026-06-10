// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// granular.js — Grain-cloud textural synthesis.
// Builds large textures (wind, rain, room ambience, crowd murmur) by scattering hundreds of
// short windowed "grains" of a source signal. Each grain has its own start time, pitch shift,
// amplitude, and stereo position. The collective result is far richer than any single filter
// chain on white noise.

const {
    SAMPLE_RATE, sine, whiteNoise, pinkNoise, brownNoise,
    lowPass2, highPass2, bandPass, panMono, mixStereo,
    addInto, gain,
} = require('./audio_primitives');
const { mulberry32, smoothNoise1D } = require('./humanize');

// Raised-cosine window — smooth amplitude envelope per grain to prevent clicks.
function raisedCosineWindow(N) {
    const w = new Float32Array(N);
    if (N < 2) return w;
    for (let i = 0; i < N; i++) w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1)));
    return w;
}

// Read a fractional-index sample from a source buffer with linear interpolation.
function readFrac(buf, pos) {
    if (pos < 0 || pos >= buf.length - 1) return 0;
    const i = Math.floor(pos);
    const f = pos - i;
    return buf[i] * (1 - f) + buf[i + 1] * f;
}

// Generate a default 1-second source if the caller didn't provide one.
function defaultSource(kind, rng) {
    if (kind === 'sine')  return sine(440, 1.0, 1.0);
    if (kind === 'white') return whiteNoise(1.0, 1.0, rng);
    if (kind === 'pink')  return pinkNoise(1.0, 1.0, rng);
    if (kind === 'brown') return brownNoise(1.0, 1.0, rng);
    return whiteNoise(1.0, 1.0, rng);
}

// Core grain-cloud synthesizer.
// opts:
//   source:        Float32Array | string ('sine'|'white'|'pink'|'brown'). Default 'white'.
//   duration:      total output duration in seconds.
//   grainSizeMs:   per-grain length (10..120 ms typical). Smaller → more "metallic" texture.
//   density:       grains per second (10..500 typical). Higher → denser cloud.
//   pitchSpread:   ± semitones of random pitch per grain.
//   panSpread:     0..1 stereo width.
//   ampJitter:     0..1 random gain per grain.
//   filter:        optional { type: 'lp'|'hp'|'bp', freq, Q } applied to each grain.
//   seed:          PRNG seed.
//   envelope:      optional function (tNormalized: 0..1) → overall amp multiplier.
function grainCloud(opts = {}) {
    const duration = opts.duration !== undefined ? opts.duration : 2.0;
    const grainSizeMs = opts.grainSizeMs !== undefined ? opts.grainSizeMs : 50;
    const density = opts.density !== undefined ? opts.density : 80;
    const pitchSpread = opts.pitchSpread !== undefined ? opts.pitchSpread : 0;
    const panSpread = opts.panSpread !== undefined ? opts.panSpread : 0.6;
    const ampJitter = opts.ampJitter !== undefined ? opts.ampJitter : 0.3;
    const seed = opts.seed || 17;
    const rng = mulberry32(seed);

    const src = typeof opts.source === 'string'
        ? defaultSource(opts.source, mulberry32(seed * 3))
        : (opts.source instanceof Float32Array ? opts.source : defaultSource('white', mulberry32(seed * 3)));

    const totalSamples = Math.floor(duration * SAMPLE_RATE);
    const left = new Float32Array(totalSamples);
    const right = new Float32Array(totalSamples);
    const grainSamples = Math.max(4, Math.floor(grainSizeMs * 0.001 * SAMPLE_RATE));
    const grainCount = Math.max(1, Math.floor(duration * density));
    const window = raisedCosineWindow(grainSamples);

    const filterCache = new Map();
    function applyFilter(buf) {
        if (!opts.filter) return buf;
        const out = Float32Array.from(buf);
        if (opts.filter.type === 'lp') lowPass2(out, opts.filter.freq, opts.filter.Q || 0.7);
        else if (opts.filter.type === 'hp') highPass2(out, opts.filter.freq, opts.filter.Q || 0.7);
        else if (opts.filter.type === 'bp') bandPass(out, opts.filter.freq, opts.filter.Q || 1);
        return out;
    }

    for (let g = 0; g < grainCount; g++) {
        const tCenter = rng() * duration;
        const startIdx = Math.floor(tCenter * SAMPLE_RATE - grainSamples / 2);
        if (startIdx + grainSamples < 0 || startIdx >= totalSamples) continue;

        const pitchSemis = (rng() * 2 - 1) * pitchSpread;
        const rate = Math.pow(2, pitchSemis / 12);
        const amp = 1 - rng() * ampJitter;
        const pan = (rng() * 2 - 1) * panSpread;

        // Build grain — read from src at fractional rate, window with raised cosine
        const grain = new Float32Array(grainSamples);
        const srcStart = rng() * Math.max(0, src.length - grainSamples * rate - 1);
        for (let i = 0; i < grainSamples; i++) {
            grain[i] = readFrac(src, srcStart + i * rate) * window[i];
        }
        const filtered = applyFilter(grain);

        // Constant-power pan
        const angle = (pan + 1) * 0.25 * Math.PI;
        const gL = Math.cos(angle) * amp;
        const gR = Math.sin(angle) * amp;

        // Mix into output
        const end = Math.min(totalSamples, startIdx + grainSamples);
        const beg = Math.max(0, startIdx);
        for (let i = beg; i < end; i++) {
            const gi = i - startIdx;
            const s = filtered[gi];
            left[i] += s * gL;
            right[i] += s * gR;
        }
    }

    // Optional envelope curve over the whole texture
    if (opts.envelope) {
        for (let i = 0; i < totalSamples; i++) {
            const env = opts.envelope(i / totalSamples);
            left[i] *= env;
            right[i] *= env;
        }
    }

    return { left, right };
}

// ─── Texture presets ──────────────────────────────────────

// Wind: pink-noise base + slow smooth-noise gain modulation + bandpassed gusts.
function windTexture(duration = 3.0, intensity = 0.5, opts = {}) {
    const seed = opts.seed || 21;
    // Base layer — pink-noise grains, very dense for "rush" sound
    const base = grainCloud({
        source: 'pink',
        duration,
        grainSizeMs: 90,
        density: 50,
        pitchSpread: 6,
        panSpread: 0.9,
        ampJitter: 0.5,
        filter: { type: 'lp', freq: 1800 + intensity * 1500, Q: 0.6 },
        seed,
    });
    // Bandpassed midrange "whistle" layer
    const whistle = grainCloud({
        source: 'white',
        duration,
        grainSizeMs: 200,
        density: 4,
        pitchSpread: 12,
        panSpread: 0.7,
        ampJitter: 0.7,
        filter: { type: 'bp', freq: 2400, Q: 4 },
        seed: seed + 1,
    });
    // Smooth-noise gain modulation
    const noise = smoothNoise1D(seed * 7, 0.35);
    const len = base.left.length;
    for (let i = 0; i < len; i++) {
        const t = i / SAMPLE_RATE;
        const m = 0.7 + 0.5 * noise(t) * intensity;
        base.left[i] = base.left[i] * m + whistle.left[i] * 0.4;
        base.right[i] = base.right[i] * m + whistle.right[i] * 0.4;
    }
    gain(base.left, 0.55 * intensity);
    gain(base.right, 0.55 * intensity);
    return base;
}

// Rain: tons of very short high-frequency clicks at varying density.
function rainTexture(duration = 3.0, density = 0.6, opts = {}) {
    const seed = opts.seed || 31;
    return grainCloud({
        source: 'white',
        duration,
        grainSizeMs: 6,
        density: 800 * density,
        pitchSpread: 8,
        panSpread: 0.95,
        ampJitter: 0.7,
        filter: { type: 'hp', freq: 1800, Q: 0.7 },
        seed,
    });
}

// Crowd murmur — overlapping low-mid grains from pink noise to suggest voice-band texture.
function crowdMurmur(duration = 3.0, density = 0.5, opts = {}) {
    const seed = opts.seed || 41;
    return grainCloud({
        source: 'pink',
        duration,
        grainSizeMs: 180,
        density: 35 * density,
        pitchSpread: 4,
        panSpread: 0.85,
        ampJitter: 0.6,
        filter: { type: 'bp', freq: 900, Q: 1.5 },
        seed,
    });
}

// Distant thunder — brown-noise rumbles, very low density, panned wide.
function thunderRumble(duration = 4.0, opts = {}) {
    const seed = opts.seed || 51;
    return grainCloud({
        source: 'brown',
        duration,
        grainSizeMs: 600,
        density: 1.5,
        pitchSpread: 2,
        panSpread: 0.6,
        ampJitter: 0.3,
        filter: { type: 'lp', freq: 350, Q: 0.7 },
        seed,
    });
}

// Room tone — extremely sparse, very lowpassed white noise. The audio equivalent of a
// "quiet room with subtle HVAC."
function roomTone(duration = 3.0, opts = {}) {
    const seed = opts.seed || 61;
    return grainCloud({
        source: 'pink',
        duration,
        grainSizeMs: 250,
        density: 6,
        pitchSpread: 1,
        panSpread: 0.4,
        ampJitter: 0.2,
        filter: { type: 'lp', freq: 600, Q: 0.6 },
        seed,
    });
}

module.exports = {
    grainCloud,
    windTexture,
    rainTexture,
    crowdMurmur,
    thunderRumble,
    roomTone,
};
