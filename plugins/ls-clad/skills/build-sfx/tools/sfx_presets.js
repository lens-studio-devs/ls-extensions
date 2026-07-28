// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// sfx_presets.js — Curated, multi-layer sound-effect presets.
//
// Why this module exists: hand-assembled 5-line recipes (one sweep + one ADSR)
// are the main source of "janky" SFX — thin, beepy, identical every time. Each
// preset here layers a transient + body + air/texture the way designed foley is
// built, and draws small parameter variations from a seeded RNG so every call
// produces a sibling (not a clone) of the sound. Omit `seed` for a fresh
// variation each run; pass a seed to reproduce a take you liked.
//
// Conventions:
//   - Every preset takes a single opts dict; all knobs optional.
//   - Common knobs: seed, pitch (± semitones), duration/size where meaningful.
//   - Returns Float32Array (mono) or { left, right } (stereo — anything with
//     reverb/pan/texture). Run mix_bus.masterChain before WavBuilder.write.

const {
    SAMPLE_RATE, sine, square, triangle, whiteNoise, pinkNoise, brownNoise,
    adsrExp, fadeOut, sweep, mix, addInto, normalizePeak,
    lowPass2, highPass2, bandPass, lowPassSweep,
} = require('./audio_primitives');
const { fmOperator, detunedStack } = require('./osc_models');
const { mulberry32 } = require('./humanize');
const { applyFx } = require('./mix_bus');
const { designImpact } = require('./transient_designer');
const { grainCloud } = require('./granular');
const { bell, marimba } = require('./synth_voices');

function makeRng(opts) {
    const seed = opts && opts.seed !== undefined ? opts.seed : Math.floor(Math.random() * 1e9);
    return mulberry32(seed);
}
function pick(arr, r) { return arr[Math.floor(r() * arr.length)]; }
function vary(r, pct) { return 1 + (r() * 2 - 1) * pct; }
function semis(s) { return Math.pow(2, (s || 0) / 12); }
function subSeed(r) { return Math.floor(r() * 1e9); }
// Mix a stereo texture into a stereo buffer in place.
function addStereo(dst, src, gain) {
    const n = Math.min(dst.left.length, src.left.length);
    for (let i = 0; i < n; i++) { dst.left[i] += src.left[i] * gain; dst.right[i] += src.right[i] * gain; }
    return dst;
}
// Additive decaying ring modes — the physical differentiator between struck
// materials. modes: [{ r: freq ratio, a: amplitude, d: decay rate (1/s) }].
// Real wood/metal/glass have INHARMONIC ratios; harmonic partials all sound alike.
function ringModes(freq, modes, dur, r) {
    const len = Math.floor(dur * SAMPLE_RATE);
    const out = new Float32Array(len);
    for (const md of modes) {
        const f = freq * md.r * (1 + (r() * 2 - 1) * 0.012);
        if (f > SAMPLE_RATE * 0.45) continue;
        const ph = r() * 2 * Math.PI;
        const st = 2 * Math.PI * f / SAMPLE_RATE;
        for (let i = 0; i < len; i++) out[i] += Math.sin(ph + st * i) * md.a * Math.exp(-md.d * i / SAMPLE_RATE);
    }
    return out;
}

// ─── UI ────────────────────────────────────────────────────────

// Physical-feeling button click: tonal tick + mechanical noise + low "thock" body.
// opts.character: 'soft' (default random) | 'sharp'.
function uiClick(opts = {}) {
    const r = makeRng(opts);
    const character = opts.character || (r() < 0.5 ? 'soft' : 'sharp');
    const base = (character === 'sharp' ? 2100 : 1500) * semis(opts.pitch) * vary(r, 0.06);
    const tick = sweep(base * 1.18, base, 0.018, 'sine', 'exponential');
    adsrExp(tick, 0.0008, 0.006, 0, 0.011, 4);
    const mech = whiteNoise(0.006, 0.8, r);
    bandPass(mech, base * (character === 'sharp' ? 2.4 : 1.6), 1.4);
    adsrExp(mech, 0.0005, 0.002, 0, 0.0035, 4);
    const body = sweep(320, 190, 0.045, 'sine', 'exponential');
    adsrExp(body, 0.001, 0.014, 0, 0.03, 4);
    const out = new Float32Array(Math.floor(0.08 * SAMPLE_RATE));
    addInto(out, tick, 0, 0.7);
    addInto(out, mech, 0, character === 'sharp' ? 0.55 : 0.35);
    addInto(out, body, Math.floor(0.001 * SAMPLE_RATE), character === 'soft' ? 0.5 : 0.3);
    fadeOut(out, 0.004);
    return out;
}

// Bubble pop: down-swept "plop" + a tiny high smack.
function uiPop(opts = {}) {
    const r = makeRng(opts);
    const f0 = 750 * semis(opts.pitch) * vary(r, 0.1);
    const plop = sweep(f0, f0 * 0.32, 0.06, 'sine', 'exponential');
    adsrExp(plop, 0.001, 0.02, 0, 0.038, 4);
    const smack = whiteNoise(0.004, 0.7, r);
    highPass2(smack, 1800, 0.8);
    adsrExp(smack, 0.0004, 0.0015, 0, 0.002, 4);
    const out = new Float32Array(Math.floor(0.09 * SAMPLE_RATE));
    addInto(out, smack, 0, 0.4);
    addInto(out, plop, Math.floor(0.001 * SAMPLE_RATE), 0.9);
    fadeOut(out, 0.005);
    return out;
}

// FM blip — the classic digital confirmation. Ratio/index vary per call.
function uiBlip(opts = {}) {
    const r = makeRng(opts);
    const f = 850 * semis(opts.pitch) * vary(r, 0.08);
    const ratio = pick([2, 3, 4], r);
    const idx = 2.5 + r() * 2.5;
    const b = fmOperator(f, 0.09, ratio, idx, (t) => Math.exp(-14 * t));
    adsrExp(b, 0.001, 0.02, 0, 0.065, 3);
    return applyFx(b, { hpf: 200, gain: 0.7 });
}

// Soft airy hover/focus cue — deliberately quiet.
function uiHover(opts = {}) {
    const r = makeRng(opts);
    const f = 1900 * semis(opts.pitch) * vary(r, 0.1);
    const tone = sine(f, 0.07, 0.5);
    const air = whiteNoise(0.07, 0.5, r);
    bandPass(air, f * 1.4, 2.5);
    const out = mix([tone, air], [0.5, 0.35]);
    adsrExp(out, 0.018, 0.02, 0.3, 0.028, 2);
    fadeOut(out, 0.006);
    return applyFx(out, { gain: 0.5 });
}

// Two-blip toggle: rising pair = on, falling pair = off. opts.on (default true).
function uiToggle(opts = {}) {
    const r = makeRng(opts);
    const on = opts.on !== false;
    const scaleMult = semis(opts.pitch) * vary(r, 0.05);
    const f1 = (on ? 900 : 1250) * scaleMult;
    const f2 = (on ? 1250 : 900) * scaleMult;
    function blip(f, dur) {
        const b = triangle(f, dur, 0.8);
        adsrExp(b, 0.001, dur * 0.4, 0, dur * 0.6, 4);
        return b;
    }
    const out = new Float32Array(Math.floor(0.12 * SAMPLE_RATE));
    addInto(out, blip(f1, 0.04), 0, 0.55);
    addInto(out, blip(f2, 0.05), Math.floor(0.045 * SAMPLE_RATE), 0.6);
    const mech = whiteNoise(0.005, 0.6, r);
    bandPass(mech, 2600, 1.2);
    adsrExp(mech, 0.0005, 0.002, 0, 0.003, 4);
    addInto(out, mech, 0, 0.3);
    fadeOut(out, 0.005);
    return out;
}

// Success chime: ascending mallet/bell arpeggio (random key + shape) + sparkle dust.
function uiSuccess(opts = {}) {
    const r = makeRng(opts);
    const rootMidi = 69 + Math.floor(r() * 8);
    const shape = pick([[0, 4, 7], [0, 4, 7, 12], [0, 7, 12], [0, 4, 9]], r);
    const voiceFn = pick([bell, marimba], r);
    const step = 0.07 + r() * 0.03;
    const out = new Float32Array(Math.floor((shape.length * step + 0.9) * SAMPLE_RATE));
    shape.forEach((iv, i) => {
        const note = voiceFn(rootMidi + iv, 0.4, 96 - i * 6, 240, { rng: r });
        addInto(out, note, Math.floor(i * step * SAMPLE_RATE), 0.6 - i * 0.06);
    });
    const st = applyFx(out, { reverb: 'smallRoom', gain: 0.8 });
    const dust = grainCloud({
        source: 'white', duration: 0.35, grainSizeMs: 12, density: 60, pitchSpread: 8,
        panSpread: 0.5, filter: { type: 'hp', freq: 6000, Q: 0.7 }, seed: subSeed(r), normalize: 0.3,
    });
    addStereo(st, dust, 0.25);
    return st;
}

// Error: two-tone descending buzz — firm but not farty.
function uiError(opts = {}) {
    const r = makeRng(opts);
    const f = 340 * semis(opts.pitch) * vary(r, 0.08);
    function buzz(freq, dur) {
        const b = detunedStack(freq, dur, { voices: 2, detuneCents: 9, waveform: 'square', rng: r });
        lowPass2(b, 1200, 0.8);
        adsrExp(b, 0.004, dur * 0.3, 0.5, dur * 0.5, 3);
        return b;
    }
    const out = new Float32Array(Math.floor(0.45 * SAMPLE_RATE));
    addInto(out, buzz(f, 0.16), 0, 0.55);
    addInto(out, buzz(f * 0.84, 0.22), Math.floor(0.17 * SAMPLE_RATE), 0.6);
    fadeOut(out, 0.02);
    return applyFx(out, { lpf: 1600, gain: 0.6 });
}

// Notification "ding-dong": two bells at a random consonant interval.
function uiNotify(opts = {}) {
    const r = makeRng(opts);
    const root = 76 + Math.floor(r() * 6);
    const interval = pick([5, 7, -3, 4], r);
    const n1 = bell(root, 0.5, 100, 240, { rng: r });
    const n2 = bell(root + interval, 0.7, 92, 240, { rng: r });
    const out = new Float32Array(Math.floor(1.4 * SAMPLE_RATE));
    addInto(out, n1, 0, 0.6);
    addInto(out, n2, Math.floor(0.16 * SAMPLE_RATE), 0.55);
    return applyFx(out, { reverb: 'smallRoom', gain: 0.75 });
}

// ─── Movement / transitions ────────────────────────────────────

// Whoosh with a Doppler-ish spectral arc and a stereo fly-by pan.
// opts.duration (s), opts.size (1 = arm swing, 2+ = big object),
// opts.direction: 'by' (arc, default) | 'up' | 'down'.
function whoosh(opts = {}) {
    const r = makeRng(opts);
    const dur = (opts.duration !== undefined ? opts.duration : 0.7) * vary(r, 0.12);
    const size = opts.size !== undefined ? opts.size : 1;
    const direction = opts.direction || 'by';
    const body = pinkNoise(dur, 1.0, r);
    const fLow = (500 / size) * vary(r, 0.15);
    const fHigh = (3000 + 2500 / size) * vary(r, 0.15);
    if (direction === 'up') {
        lowPassSweep(body, fLow, fHigh, 0.9);
    } else if (direction === 'down') {
        lowPassSweep(body, fHigh, fLow, 0.9);
    } else {
        // Arc: open up over the first 60%, then close down (filter-state reset at
        // the boundary is masked by the noise).
        const upLen = Math.floor(body.length * 0.6);
        lowPassSweep(body.subarray(0, upLen), fLow, fHigh, 0.9);
        lowPassSweep(body.subarray(upLen), fHigh, fLow * 1.4, 0.9);
    }
    highPass2(body, 180, 0.7);
    const N = body.length;
    for (let i = 0; i < N; i++) {
        const t = i / N;
        body[i] *= Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.08)), 1.4);
    }
    // Stereo: pan sweeps across the field for the fly-by.
    const startPan = (r() < 0.5 ? -1 : 1) * (0.4 + r() * 0.4);
    const left = new Float32Array(N), right = new Float32Array(N);
    for (let i = 0; i < N; i++) {
        const p = startPan * (1 - 2 * i / N);
        const a = (p + 1) * 0.25 * Math.PI;
        left[i] = body[i] * Math.cos(a);
        right[i] = body[i] * Math.sin(a);
    }
    const st = { left, right };
    fadeOut(st.left, 0.01); fadeOut(st.right, 0.01);
    return applyFx(st, { gain: 0.8 });
}

// Short arm-swing swish (a fast, small whoosh).
function swish(opts = {}) {
    return whoosh(Object.assign({ duration: 0.28, size: 0.8 }, opts));
}

// Riser: tension build to a peak at the very end. opts.duration (s).
function riser(opts = {}) {
    const r = makeRng(opts);
    const dur = (opts.duration !== undefined ? opts.duration : 1.6) * vary(r, 0.12);
    const f0 = 70 * vary(r, 0.2);
    const tone = sweep(f0, f0 * 14, dur, 'sawtooth', 'exponential');
    const noise = whiteNoise(dur, 0.6, r);
    lowPassSweep(noise, 700, 7000, 1.0);
    const sum = mix([tone, noise], [0.55, 0.4]);
    const N = sum.length;
    for (let i = 0; i < N; i++) { const t = i / N; sum[i] *= 0.15 + 0.85 * t * t; }
    fadeOut(sum, 0.02);
    return applyFx(sum, { chorus: { voices: 3, mix: 0.3 }, reverb: 'largeHall', gain: 0.75 });
}

// Power-down / spin-down faller.
function powerDown(opts = {}) {
    const r = makeRng(opts);
    const dur = 0.8 * vary(r, 0.15);
    const f0 = 880 * semis(opts.pitch) * vary(r, 0.1);
    const b = sweep(f0, f0 * 0.09, dur, pick(['square', 'sawtooth'], r), 'exponential');
    lowPassSweep(b, 3200, 500, 0.8);
    adsrExp(b, 0.002, dur * 0.25, 0.55, dur * 0.4, 3);
    fadeOut(b, 0.02);
    return applyFx(b, { distort: 1.5, gain: 0.6 });
}

// Power-up: ascending tonal step arpeggio. opts.retro: false for a clean (uncrushed) version.
function powerUp(opts = {}) {
    const r = makeRng(opts);
    const rootMidi = 60 + Math.floor(r() * 8);
    const steps = pick([[0, 4, 7, 12], [0, 4, 7, 12, 16], [0, 7, 12, 19]], r);
    const stepDur = 0.07;
    const out = new Float32Array(Math.floor((steps.length * stepDur + 0.35) * SAMPLE_RATE));
    steps.forEach((iv, i) => {
        const f = 440 * Math.pow(2, (rootMidi + iv - 69) / 12);
        const b = square(f, stepDur + 0.06, 0.7);
        adsrExp(b, 0.001, 0.02, 0.5, 0.05, 3);
        addInto(out, b, Math.floor(i * stepDur * SAMPLE_RATE), 0.5);
    });
    fadeOut(out, 0.02);
    return applyFx(out, { crush: opts.retro === false ? undefined : 6, lpf: 7000, gain: 0.55 });
}

// ─── Impacts & foley ───────────────────────────────────────────

// General-purpose impact. opts.material: 'soft' (punch/body, default) | 'wood' |
// 'metal' | 'glass' | 'stone'. opts.size: 1 = hand-scale, 2+ = heavy.
//
// Each material gets its own physics, and the differences are deliberately BIG:
//   soft  = dark thump, pre-swish, no ring          (dull, short, low)
//   wood  = hollow inharmonic "donk", fast decay    (mid, woody, short)
//   metal = long beating inharmonic clang           (bright, rings ~1.5 s)
//   glass = very bright short "tink" + shard rain   (high, brittle)
//   stone = gritty crack + debris, zero ring        (broadband, granular)
function impact(opts = {}) {
    const r = makeRng(opts);
    const material = opts.material || 'soft';
    const size = opts.size !== undefined ? opts.size : 1;
    const v = (f) => f * vary(r, 0.1);
    let core;
    let debris = null;
    let fx;
    if (material === 'metal') {
        // Beating inharmonic clang: the 1 / 1.007 pair beats slowly (the "wow"
        // of struck metal); 1.58 / 2.24 / 2.76 / 3.55 are free-plate ratios.
        const base = v(520 / size);
        const dur = 1.5 * size;
        core = ringModes(base, [
            { r: 1, a: 1.0, d: 2.2 }, { r: 1.007, a: 0.5, d: 2.0 },
            { r: 1.58, a: 0.6, d: 2.8 }, { r: 2.24, a: 0.5, d: 3.5 },
            { r: 2.76, a: 0.4, d: 4.2 }, { r: 3.55, a: 0.28, d: 5.5 },
            { r: 5.42, a: 0.15, d: 8 },
        ], dur, r);
        const clang = whiteNoise(0.008, 1.0, r);
        highPass2(clang, 1800, 0.7);
        adsrExp(clang, 0.0004, 0.003, 0, 0.005, 4);
        addInto(core, clang, 0, 0.6);
        adsrExp(core, 0.0008, dur * 0.3, 0.4, dur * 0.6, 2.5);
        fx = { hpf: 220, reverb: 'smallRoom', gain: 0.8 };
    } else if (material === 'wood') {
        // Hollow block: inharmonic bar modes, ALL decaying fast — wood damps.
        const base = v(185 / Math.sqrt(size));
        core = ringModes(base, [
            { r: 1, a: 1.0, d: 16 }, { r: 2.27, a: 0.5, d: 24 },
            { r: 3.92, a: 0.26, d: 32 }, { r: 5.4, a: 0.12, d: 40 },
        ], 0.4 * Math.sqrt(size), r);
        const knock = whiteNoise(0.004, 1.0, r);
        lowPass2(knock, 4200, 0.7);
        adsrExp(knock, 0.0004, 0.0015, 0, 0.0025, 4);
        addInto(core, knock, 0, 0.5);
        const thump = sweep(v(95), 55, 0.07, 'sine', 'exponential');
        adsrExp(thump, 0.001, 0.025, 0, 0.045, 4);
        addInto(core, thump, 0, 0.5);
        fx = { hpf: 70, lpf: 5000, reverb: 'smallRoom', gain: 0.85 };
    } else if (material === 'glass') {
        // Brittle "tink": very high short modes + splash noise + shard rain.
        const base = v(1450 / Math.sqrt(size));
        core = ringModes(base, [
            { r: 1, a: 1.0, d: 7 }, { r: 2.32, a: 0.6, d: 9 }, { r: 3.86, a: 0.4, d: 12 },
        ], 0.5, r);
        const snap = whiteNoise(0.006, 1.0, r);
        bandPass(snap, v(6200), 2.5);
        adsrExp(snap, 0.0003, 0.002, 0, 0.004, 4);
        addInto(core, snap, 0, 0.8);
        const splash = whiteNoise(0.22 * size, 1.0, r);
        highPass2(splash, 3600, 0.7);
        adsrExp(splash, 0.001, 0.05, 0.1, 0.15 * size, 3);
        addInto(core, splash, Math.floor(0.003 * SAMPLE_RATE), 0.35);
        const shards = 3 + Math.floor(r() * 3);
        for (let k = 0; k < shards; k++) {
            const shard = bell(88 + Math.floor(r() * 12), 0.35, 55 + r() * 30, 240, { rng: r });
            addInto(core, shard, Math.floor((0.01 + r() * 0.09) * SAMPLE_RATE), 0.14 + r() * 0.1);
        }
        fx = { hpf: 450, reverb: 'mediumRoom', gain: 0.8 };
    } else if (material === 'stone') {
        // Gritty and dead: crack + heavy thump + debris. No ring at all.
        core = designImpact({
            attack: { kind: 'noise', durationMs: 14, lpHz: 3000, hpHz: 150, gain: 0.8 },
            body: { kind: 'thump', freq: v(66 / Math.sqrt(size)), decay: 0.2 * size, lpHz: 500, gain: 0.9, dist: 2 },
        });
        debris = grainCloud({
            source: 'white', duration: 0.3 * size, grainSizeMs: 6, density: 160, pitchSpread: 6,
            panSpread: 0.5, filter: { type: 'bp', freq: 2200, Q: 1.3 }, seed: subSeed(r), normalize: 0.4,
            envelope: (t) => Math.exp(-4.5 * t),
        });
        fx = { hpf: 40, lpf: 6500, reverb: 'smallRoom', gain: 0.85 };
    } else { // soft — punch / body hit
        // Dark and dull, with the pre-swish that sells a punch on screen.
        core = new Float32Array(Math.floor((0.35 * size + 0.1) * SAMPLE_RATE));
        const swish = whiteNoise(0.07, 1.0, r);
        bandPass(swish, v(900), 1.2);
        adsrExp(swish, 0.03, 0.02, 0.3, 0.02, 2);
        addInto(core, swish, 0, 0.25);
        const hit = designImpact({
            attack: { kind: 'click', durationMs: 7, lpHz: 3200, hpHz: 250, gain: 0.5 },
            body: { kind: 'thump', freq: v(82 / Math.sqrt(size)), decay: 0.2 * size, lpHz: 600, gain: 0.95, dist: 1.5 },
        });
        addInto(core, hit, Math.floor(0.05 * SAMPLE_RATE), 1.0);
        fx = { hpf: 38, lpf: 1400, reverb: 'smallRoom', gain: 0.9 };
    }
    if (size > 1.5) fx.reverb = 'mediumRoom';
    normalizePeak(core, 0.85); // mode/layer sums can exceed 1.0 before the FX chain
    const st = applyFx(core, fx);
    if (debris) addStereo(st, debris, 0.5);
    fadeOut(st.left, 0.01); fadeOut(st.right, 0.01);
    return st;
}

// Footstep. opts.surface: 'hard' (default) | 'wood' | 'grass' | 'gravel' | 'snow'.
//
// Two-contact model: a real step is heel-strike then toe-roll ~65–95 ms later
// (softer). The surface layer DOMINATES the sound — a heel click defines hard
// floors, a hollow "donk" defines wood, crunch defines gravel/snow, and grass
// is nearly all soft swish with no click at all.
function footstep(opts = {}) {
    const r = makeRng(opts);
    const surface = opts.surface || 'hard';
    const N = Math.floor(0.5 * SAMPLE_RATE);
    const left = new Float32Array(N), right = new Float32Array(N);

    function contact(atSec, strength) {
        const at = Math.floor(atSec * SAMPLE_RATE);
        const addMono = (buf, g) => { addInto(left, buf, at, g); addInto(right, buf, at, g); };
        const addSt = (st, g) => { addInto(left, st.left, at, g); addInto(right, st.right, at, g); };

        // Body-weight thud — present everywhere, but its share of the mix varies.
        const thudGain = { hard: 0.45, wood: 0.5, grass: 0.3, gravel: 0.22, snow: 0.32 }[surface] || 0.45;
        const thud = sweep(60 * vary(r, 0.12), 38, 0.09, 'sine', 'exponential');
        adsrExp(thud, 0.001, 0.03, 0, 0.055, 4);
        addMono(thud, thudGain * strength);

        if (surface === 'hard') {
            const click = whiteNoise(0.003, 1.0, r);
            highPass2(click, 1500, 0.7); lowPass2(click, 8500, 0.7);
            adsrExp(click, 0.0004, 0.001, 0, 0.0018, 4);
            addMono(click, 0.75 * strength);
            const knock = ringModes(900 * vary(r, 0.1), [{ r: 1, a: 1, d: 50 }, { r: 1.7, a: 0.4, d: 70 }], 0.07, r);
            addMono(knock, 0.3 * strength);
        } else if (surface === 'wood') {
            const click = whiteNoise(0.0025, 1.0, r);
            lowPass2(click, 4000, 0.7);
            adsrExp(click, 0.0004, 0.001, 0, 0.0016, 4);
            addMono(click, 0.35 * strength);
            // Hollow board resonance — the "donk" that says wood.
            const donk = ringModes(165 * vary(r, 0.12), [
                { r: 1, a: 1, d: 20 }, { r: 2.32, a: 0.5, d: 28 }, { r: 3.9, a: 0.22, d: 36 },
            ], 0.22, r);
            addMono(donk, 0.65 * strength);
        } else if (surface === 'grass') {
            const tex = grainCloud({
                source: 'pink', duration: 0.16 * vary(r, 0.2), grainSizeMs: 20, density: 220,
                ampJitter: 0.6, panSpread: 0.2, filter: { type: 'bp', freq: 1500 * vary(r, 0.2), Q: 0.8 },
                seed: subSeed(r), normalize: 0.6,
            });
            addSt(tex, 0.6 * strength);
        } else if (surface === 'gravel') {
            const crunch = grainCloud({
                source: 'white', duration: 0.2 * vary(r, 0.2), grainSizeMs: 4, density: 400,
                ampJitter: 0.7, panSpread: 0.3, filter: { type: 'bp', freq: 2600, Q: 1.3 },
                seed: subSeed(r), normalize: 0.6,
            });
            addSt(crunch, 0.55 * strength);
            // Discrete stone clicks on top of the fine crunch.
            const stones = grainCloud({
                source: 'white', duration: 0.16, grainSizeMs: 7, density: 70,
                ampJitter: 0.8, panSpread: 0.4, filter: { type: 'bp', freq: 3900, Q: 2.4 },
                seed: subSeed(r), normalize: 0.6,
            });
            addSt(stones, 0.45 * strength);
        } else if (surface === 'snow') {
            // Muffled compressing crunch that builds as the boot settles.
            const crunch = grainCloud({
                source: 'pink', duration: 0.24 * vary(r, 0.15), grainSizeMs: 12, density: 300,
                ampJitter: 0.6, panSpread: 0.2, filter: { type: 'bp', freq: 640, Q: 0.8 },
                seed: subSeed(r), normalize: 0.6,
                envelope: (t) => Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15)), 0.8),
            });
            addSt(crunch, 0.65 * strength);
        }
    }

    contact(0, 1.0);                        // heel strike
    contact(0.065 + r() * 0.03, 0.55);      // toe roll — softer, fresh texture draws
    fadeOut(left, 0.015); fadeOut(right, 0.015);
    return { left, right };
}

// Water drop: descending "drip" + the rising "bloop" resonance real drops have.
function waterDrop(opts = {}) {
    const r = makeRng(opts);
    const f0 = 2100 * semis(opts.pitch) * vary(r, 0.2);
    const drop = sweep(f0, f0 * 0.45, 0.05, 'sine', 'exponential');
    adsrExp(drop, 0.001, 0.012, 0, 0.038, 4);
    const bloip = sweep(f0 * 0.35, f0 * 0.7, 0.09, 'sine', 'exponential');
    adsrExp(bloip, 0.004, 0.03, 0.2, 0.05, 3);
    const out = new Float32Array(Math.floor(0.35 * SAMPLE_RATE));
    addInto(out, drop, 0, 0.7);
    addInto(out, bloip, Math.floor(0.02 * SAMPLE_RATE), 0.5);
    fadeOut(out, 0.01);
    return applyFx(out, { reverb: 'smallRoom', gain: 0.7 });
}

// ─── Retro / game ──────────────────────────────────────────────

// Coin pickup: two square notes ascending a 4th/5th, crushed. Random key.
function coin(opts = {}) {
    const r = makeRng(opts);
    const base = 880 * semis(pick([0, 2, 3, 5, 7], r)) * semis(opts.pitch);
    const iv = pick([4 / 3, 3 / 2], r);
    const a = square(base, 0.07, 0.8);
    adsrExp(a, 0.001, 0.02, 0.5, 0.045, 3);
    const c = square(base * iv, 0.22, 0.8);
    adsrExp(c, 0.001, 0.05, 0.55, 0.16, 3);
    const out = new Float32Array(Math.floor(0.32 * SAMPLE_RATE));
    addInto(out, a, 0, 0.55);
    addInto(out, c, Math.floor(0.065 * SAMPLE_RATE), 0.5);
    fadeOut(out, 0.01);
    return applyFx(out, { crush: 5, gain: 0.55 });
}

// Jump: quick upward square sweep.
function jump(opts = {}) {
    const r = makeRng(opts);
    const f0 = 380 * semis(opts.pitch) * vary(r, 0.12);
    const b = sweep(f0, f0 * (1.9 + r() * 0.5), 0.16 + r() * 0.05, 'square', 'exponential');
    adsrExp(b, 0.001, 0.05, 0.5, 0.1, 3);
    fadeOut(b, 0.008);
    return applyFx(b, { crush: 5, gain: 0.55 });
}

// Small collect/pickup sparkle (cleaner and shorter than coin).
function pickup(opts = {}) {
    const r = makeRng(opts);
    const root = 84 + Math.floor(r() * 8);
    const b1 = marimba(root, 0.2, 100, 240, { rng: r });
    const b2 = bell(root + pick([7, 12], r), 0.3, 88, 240, { rng: r });
    const out = new Float32Array(Math.floor(0.7 * SAMPLE_RATE));
    addInto(out, b1, 0, 0.55);
    addInto(out, b2, Math.floor(0.05 * SAMPLE_RATE), 0.4);
    fadeOut(out, 0.01);
    return applyFx(out, { hpf: 300, gain: 0.7 });
}

// Hurt/damage blip: descending square + low thump. opts.retro for heavy crush.
function hurt(opts = {}) {
    const r = makeRng(opts);
    const f0 = 300 * semis(opts.pitch) * vary(r, 0.12);
    const b = sweep(f0, f0 * 0.55, 0.12, 'square', 'exponential');
    adsrExp(b, 0.001, 0.04, 0.4, 0.07, 3);
    const thump = sweep(140, 70, 0.09, 'sine', 'exponential');
    adsrExp(thump, 0.001, 0.03, 0, 0.05, 4);
    const out = new Float32Array(Math.floor(0.18 * SAMPLE_RATE));
    addInto(out, b, 0, 0.5);
    addInto(out, thump, 0, 0.6);
    fadeOut(out, 0.008);
    return applyFx(out, { crush: opts.retro ? 5 : 12, lpf: 3400, gain: 0.6 });
}

// Laser zap: saw sweep + FM "pew" layer. opts.size scales it heavier/slower.
function laser(opts = {}) {
    const r = makeRng(opts);
    const size = opts.size !== undefined ? opts.size : 1;
    const f0 = (2400 * vary(r, 0.15)) / Math.sqrt(size);
    const zap = sweep(f0, f0 * 0.1, 0.22 * size, 'sawtooth', 'exponential');
    adsrExp(zap, 0.001, 0.05, 0.6, 0.12, 3);
    const pew = fmOperator(f0 * 0.5, 0.12 * size, 1.4 + r(), 6, (t) => Math.exp(-9 * t));
    adsrExp(pew, 0.0008, 0.03, 0.3, 0.07, 3);
    const out = new Float32Array(Math.floor(0.26 * size * SAMPLE_RATE));
    addInto(out, zap, 0, 0.6);
    addInto(out, pew, 0, 0.4);
    fadeOut(out, 0.01);
    return applyFx(out, { distort: 2.5, lpf: 5200, gain: 0.65 });
}

// Explosion: crack + boom + sub punch + debris crackle. opts.size, opts.retro.
function explosion(opts = {}) {
    const r = makeRng(opts);
    const size = opts.size !== undefined ? opts.size : 1;
    const dur = 1.1 * size * vary(r, 0.1);
    const boom = brownNoise(dur, 1.0, r);
    lowPassSweep(boom, 900 + 500 * size, 90, 0.8);
    adsrExp(boom, 0.002, dur * 0.25, 0.25, dur * 0.6, 3);
    const crack = whiteNoise(0.05, 1.0, r);
    highPass2(crack, 900, 0.7);
    adsrExp(crack, 0.0005, 0.015, 0, 0.03, 4);
    const sub = sweep(120, 38, 0.4 * size, 'sine', 'exponential');
    adsrExp(sub, 0.001, 0.1, 0.3, 0.25, 3);
    const N = Math.floor((dur + 0.3) * SAMPLE_RATE);
    const mono = new Float32Array(N);
    addInto(mono, crack, 0, 0.5);
    addInto(mono, boom, Math.floor(0.008 * SAMPLE_RATE), 0.85);
    addInto(mono, sub, Math.floor(0.004 * SAMPLE_RATE), 0.7);
    fadeOut(mono, 0.03);
    normalizePeak(mono, 0.85); // layer sum can exceed 1.0 before the FX chain
    if (opts.retro) {
        return applyFx(mono, { crush: 5, lpf: 4000, gain: 0.9 });
    }
    const st = applyFx(mono, {
        hpf: 28,
        reverb: { duration: 1.6, roomSize: 0.8, hfDamping: 0.6, wet: 0.25 },
        gain: 0.85,
    });
    const crackle = grainCloud({
        source: 'white', duration: dur * 0.7, grainSizeMs: 6, density: 70, pitchSpread: 8,
        panSpread: 0.8, ampJitter: 0.7, filter: { type: 'bp', freq: 2800, Q: 1.4 },
        seed: subSeed(r), normalize: 0.4, envelope: (t) => Math.exp(-3.5 * t),
    });
    addStereo(st, crackle, 0.35);
    return st;
}

// ─── Magic / fantasy ───────────────────────────────────────────

// Shimmering sparkle cloud + a few discrete bell pings. opts.duration.
function sparkle(opts = {}) {
    const r = makeRng(opts);
    const dur = opts.duration !== undefined ? opts.duration : 1.2;
    const pings = new Float32Array(Math.floor(dur * SAMPLE_RATE));
    const nPings = 3 + Math.floor(r() * 3);
    for (let k = 0; k < nPings; k++) {
        const p = bell(90 + Math.floor(r() * 10), 0.25, 60 + r() * 25, 240, { rng: r });
        addInto(pings, p, Math.floor(r() * dur * 0.6 * SAMPLE_RATE), 0.22);
    }
    const st = applyFx(pings, { reverb: 'plate', gain: 0.8 });
    const cloud = grainCloud({
        source: sine(2800 * vary(r, 0.1), 0.6, 1.0),
        duration: dur, grainSizeMs: 25, density: 45, pitchSpread: 14, panSpread: 0.9,
        ampJitter: 0.6, seed: subSeed(r), normalize: 0.5, envelope: (t) => Math.pow(1 - t, 0.7),
    });
    addStereo(st, cloud, 0.6);
    fadeOut(st.left, 0.03); fadeOut(st.right, 0.03);
    return st;
}

// Rising bell glissando — spell-cast / reveal.
function magicChime(opts = {}) {
    const r = makeRng(opts);
    const rootMidi = 76 + Math.floor(r() * 6);
    const scaleIvs = pick([[0, 2, 4, 7, 9, 12], [0, 3, 5, 7, 10, 12], [0, 4, 7, 11, 14]], r);
    const step = 0.05 + r() * 0.02;
    const out = new Float32Array(Math.floor((scaleIvs.length * step + 1.6) * SAMPLE_RATE));
    scaleIvs.forEach((iv, i) => {
        const n = bell(rootMidi + iv, 0.35, 82 + Math.floor(r() * 14), 240, { rng: r });
        addInto(out, n, Math.floor(i * step * SAMPLE_RATE), 0.4 + i * 0.02);
    });
    return applyFx(out, { chorus: { voices: 2, mix: 0.25 }, reverb: 'plate', gain: 0.7 });
}

// ─── Registry ──────────────────────────────────────────────────

const PRESETS = {
    // UI
    uiClick, uiPop, uiBlip, uiHover, uiToggle, uiSuccess, uiError, uiNotify,
    // Movement / transitions
    whoosh, swish, riser, powerDown, powerUp,
    // Impacts & foley
    impact, footstep, waterDrop,
    // Retro / game
    coin, jump, pickup, hurt, laser, explosion,
    // Magic
    sparkle, magicChime,
};

const PRESET_DESCRIPTIONS = {
    uiClick: "Physical button click (tick + mechanism + thock). opts: character 'soft'|'sharp', pitch.",
    uiPop: 'Bubble pop. opts: pitch.',
    uiBlip: 'FM confirmation blip; ratio/index vary per call. opts: pitch.',
    uiHover: 'Soft airy hover/focus cue (quiet by design). opts: pitch.',
    uiToggle: 'Two-blip toggle; rising = on, falling = off. opts: on (bool), pitch.',
    uiSuccess: 'Ascending mallet/bell arpeggio + sparkle dust; random key/shape.',
    uiError: 'Two-tone descending buzz, firm but controlled. opts: pitch.',
    uiNotify: 'Two-bell ding-dong at a random consonant interval.',
    whoosh: "Doppler-arc noise fly-by with stereo pan sweep. opts: duration, size, direction 'by'|'up'|'down'.",
    swish: 'Short arm-swing swish (fast small whoosh).',
    riser: 'Tension build to a peak at the end. opts: duration.',
    powerDown: 'Descending spin-down. opts: pitch.',
    powerUp: 'Ascending tonal step arpeggio. opts: retro (default true).',
    impact: "Layered impact. opts: material 'soft'|'wood'|'metal'|'glass'|'stone', size.",
    footstep: "Heel+toe two-contact step; surface layer dominates. opts: surface 'hard'|'wood'|'grass'|'gravel'|'snow'.",
    waterDrop: 'Drip + rising bloop resonance. opts: pitch.',
    coin: 'Two ascending crushed squares; random key. opts: pitch.',
    jump: 'Quick upward square sweep, crushed. opts: pitch.',
    pickup: 'Short mallet+bell collect sparkle.',
    hurt: 'Descending square + thump. opts: retro, pitch.',
    laser: 'Saw zap + FM pew. opts: size.',
    explosion: 'Crack + boom + sub + debris crackle. opts: size, retro.',
    sparkle: 'Shimmer grain cloud + bell pings. opts: duration.',
    magicChime: 'Rising bell glissando with chorus + plate.',
};

module.exports = Object.assign({ PRESETS, PRESET_DESCRIPTIONS }, PRESETS);
