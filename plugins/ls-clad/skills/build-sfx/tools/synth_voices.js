// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// synth_voices.js — High-level instrument voices.
// Each voice is (midi, durBeats, velocity, bpm, ctx?) → Float32Array.
//   durBeats is the gate time (how long the note is "held"); the buffer is always longer
//   than that to preserve the natural decay tail. This is the single most important rule
//   for not sounding synthetic: don't clip the release.
//
// `ctx` (optional) supports:
//   rng:               () => number — seedable randomness
//   cutoffMultiplier:  multiplier on filter cutoffs (humanization)
//   detuneCents:       fine-tune in cents
//   attackMs:          extra attack jitter

const {
    SAMPLE_RATE, TWO_PI, sine, square, sawtooth, triangle, whiteNoise, pinkNoise,
    adsr, adsrExp, fadeIn, fadeOut, sweep, vibrato, tremolo, gain,
    lowPass, lowPass2, highPass2, bandPass, lowPassSweep,
    mix, addInto, concat, silence, polyBlep, distortion,
} = require('./audio_primitives');
const { pluckedString, waveguideTube, fmOperator, fm4op, detunedStack, pianoModel } = require('./osc_models');
const { smoothNoise1D, mulberry32 } = require('./humanize');

function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
}

function beatsToSec(beats, bpm) {
    return beats * 60 / bpm;
}

function applyCtxDetune(midi, ctx) {
    const cents = (ctx && ctx.detuneCents) || 0;
    return cents !== 0 ? midi + cents / 100 : midi;
}

function freqFromCtx(midi, ctx) {
    return midiToFreq(applyCtxDetune(midi, ctx));
}

function applyCutoffMult(cutoff, ctx) {
    const m = ctx && ctx.cutoffMultiplier !== undefined ? ctx.cutoffMultiplier : 1;
    return Math.max(20, Math.min(SAMPLE_RATE * 0.45, cutoff * m));
}

function attackMs(base, ctx) {
    const j = (ctx && ctx.attackMs) || 0;
    return Math.max(0.0005, (base + j) / 1000);
}

// ─── Keyboards ─────────────────────────────────────────────

function piano(midi, durBeats, velocity = 100, bpm = 120, ctx) {
    const gate = beatsToSec(durBeats, bpm);
    const total = gate + 1.6; // long natural decay
    return pianoModel(applyCtxDetune(midi, ctx), total, velocity, ctx || {});
}

// FM electric piano (tine-style). Two operator pairs in parallel.
function electricPiano(midi, durBeats, velocity = 100, bpm = 120, ctx) {
    const freq = freqFromCtx(midi, ctx);
    const vel = velocity / 127;
    const gate = beatsToSec(durBeats, bpm);
    const total = gate + 1.2;

    const ops = [
        {
            ratio: 1,
            level: 1.0,
            envelope: (t) => Math.exp(-2.5 * t),
        },
        {
            ratio: 14,
            level: 0.35 + vel * 0.5, // brighter on harder hits
            envelope: (t) => Math.exp(-12 * t), // very fast bell-like decay
        },
        {
            ratio: 1,
            level: 0.6,
            envelope: (t) => Math.exp(-1.8 * t),
        },
        {
            ratio: 2,
            level: 0.4 + vel * 0.3,
            envelope: (t) => Math.exp(-6 * t),
        },
    ];
    const out = fm4op('pair', ops, freq, total);
    // Velocity-dependent body gain
    gain(out, 0.5 * (0.4 + vel * 0.6));
    // Soft lowpass for warmth
    lowPass2(out, applyCutoffMult(3500 + vel * 4000, ctx), 0.6);
    return out;
}

// FM bell — fan-algorithm 4-op stack. Sharp metallic attack with slow decay.
function bell(midi, durBeats, velocity = 100, bpm = 120, ctx) {
    const freq = freqFromCtx(midi, ctx);
    const vel = velocity / 127;
    const total = beatsToSec(durBeats, bpm) + 3.0; // long ring-out
    const ops = [
        { ratio: 1,    level: 1.0,             envelope: (t) => Math.exp(-1.2 * t) },
        { ratio: 3.5,  level: 0.6 * vel,       envelope: (t) => Math.exp(-3 * t) },
        { ratio: 7,    level: 0.3 + vel * 0.4, envelope: (t) => Math.exp(-6 * t) },
        { ratio: 14,   level: 0.15 * vel,      envelope: (t) => Math.exp(-12 * t) },
    ];
    const out = fm4op('fan', ops, freq, total);
    gain(out, 0.35 * (0.4 + vel * 0.6));
    return out;
}

// Marimba: FM with fast attack and short decay, lowpass for warmth.
function marimba(midi, durBeats, velocity = 100, bpm = 120, ctx) {
    const freq = freqFromCtx(midi, ctx);
    const vel = velocity / 127;
    const total = beatsToSec(durBeats, bpm) + 0.8;
    const ops = [
        { ratio: 1,   level: 1.0,        envelope: (t) => Math.exp(-3.5 * t) },
        { ratio: 4,   level: 0.5 * vel,  envelope: (t) => Math.exp(-12 * t) },
        { ratio: 1,   level: 0.0,        envelope: () => 0 },
        { ratio: 1,   level: 0.0,        envelope: () => 0 },
    ];
    const out = fm4op('stack4', ops, freq, total);
    lowPass2(out, applyCutoffMult(4500, ctx), 0.7);
    gain(out, 0.4 * (0.4 + vel * 0.6));
    return out;
}

// Vibraphone — bell-like but with tremolo at ~5 Hz (the mechanical vibrato of the disks).
function vibraphone(midi, durBeats, velocity = 100, bpm = 120, ctx) {
    const freq = freqFromCtx(midi, ctx);
    const vel = velocity / 127;
    const total = beatsToSec(durBeats, bpm) + 3.5; // very long ring-out
    const ops = [
        { ratio: 1,   level: 1.0,       envelope: (t) => Math.exp(-0.45 * t) },
        { ratio: 4,   level: 0.4 * vel, envelope: (t) => Math.exp(-2.5 * t) },
        { ratio: 1,   level: 0.5,       envelope: (t) => Math.exp(-0.45 * t) },
        { ratio: 8,   level: 0.2 * vel, envelope: (t) => Math.exp(-5 * t) },
    ];
    const out = fm4op('pair', ops, freq, total);
    tremolo(out, 5, 0.35);
    lowPass2(out, applyCutoffMult(3800, ctx), 0.6);
    gain(out, 0.35 * (0.4 + vel * 0.6));
    return out;
}

// ─── Strings (plucked) ─────────────────────────────────────

function pluckString(midi, durBeats, velocity = 100, bpm = 120, ctx) {
    const freq = freqFromCtx(midi, ctx);
    const vel = velocity / 127;
    const total = beatsToSec(durBeats, bpm) + 1.5;
    const out = pluckedString(freq, total, {
        damping: 0.45 - vel * 0.15,
        brightness: 0.5 + vel * 0.35,
        exciter: 'noise',
        rng: ctx && ctx.rng,
    });
    gain(out, 0.55 * (0.4 + vel * 0.6));
    return out;
}

// Nylon guitar — plucked string + body resonance (lowpassed noise burst that fades).
function nylonGuitar(midi, durBeats, velocity = 100, bpm = 120, ctx) {
    const freq = freqFromCtx(midi, ctx);
    const vel = velocity / 127;
    const total = beatsToSec(durBeats, bpm) + 1.3;
    const string = pluckedString(freq, total, {
        damping: 0.55,
        brightness: 0.4 + vel * 0.3,
        exciter: 'mallet',
        rng: ctx && ctx.rng,
    });
    // Body thump — a lowpassed noise blip at the start
    const bodyLen = Math.floor(0.04 * SAMPLE_RATE);
    const body = whiteNoise(0.04, 0.4 * vel);
    lowPass2(body, 250, 1.5);
    adsrExp(body, 0.001, 0.02, 0, 0.02, 4);
    for (let i = 0; i < bodyLen && i < string.length; i++) {
        string[i] += body[i] * 0.3;
    }
    lowPass2(string, applyCutoffMult(4500, ctx), 0.7);
    gain(string, 0.45 * (0.4 + vel * 0.6));
    return string;
}

// ─── Synth voices ──────────────────────────────────────────

function pad(midi, durBeats, velocity = 100, bpm = 120, ctx) {
    const freq = freqFromCtx(midi, ctx);
    const vel = velocity / 127;
    const gate = beatsToSec(durBeats, bpm);
    const total = gate + 0.8; // slow release
    const out = detunedStack(freq, total, {
        voices: 5,
        detuneCents: 16,
        waveform: 'sawtooth',
        hpfTrack: 0.85,   // tighten the low end / remove inter-voice mud
        rng: ctx && ctx.rng,
    });
    // Slow filter sweep: opens slightly during note
    lowPassSweep(out, applyCutoffMult(900, ctx), applyCutoffMult(2400, ctx), 0.7);
    adsrExp(out, attackMs(60, ctx), 0.4, 0.85, 0.6, 2);
    gain(out, 0.32 * (0.5 + vel * 0.5));
    return out;
}

function analogBrass(midi, durBeats, velocity = 100, bpm = 120, ctx) {
    const freq = freqFromCtx(midi, ctx);
    const vel = velocity / 127;
    const gate = beatsToSec(durBeats, bpm);
    const total = gate + 0.4;
    const out = detunedStack(freq, total, {
        voices: 4,
        detuneCents: 8,
        waveform: 'sawtooth',
        hpfTrack: 0.8,
        rng: ctx && ctx.rng,
    });
    // Brass: filter envelope tracks velocity — louder = brighter
    const peakCutoff = applyCutoffMult(1500 + vel * 4500, ctx);
    lowPassSweep(out, applyCutoffMult(600, ctx), peakCutoff, 1.0);
    adsrExp(out, attackMs(20, ctx), 0.18, 0.78, 0.22, 3);
    gain(out, 0.35 * (0.4 + vel * 0.6));
    return out;
}

// NOTE: analogStrings was removed. Multiple iterations of DSP improvements
// (body resonance formants, bow noise, per-voice ensemble decorrelation,
// saturation) failed to make a 6-voice detuned-saw stack sound like real
// bowed strings — the underlying excitation model is wrong for that timbre.
// For cinematic comp, use `piano` + `pad` layered (see build-music SKILL.md).

function synthBass(midi, durBeats, velocity = 100, bpm = 120, ctx) {
    const freq = freqFromCtx(midi, ctx);
    const vel = velocity / 127;
    const gate = beatsToSec(durBeats, bpm);
    const total = gate + 0.15;
    // Two saws + sub sine for weight
    const saws = detunedStack(freq, total, {
        voices: 2, detuneCents: 6, waveform: 'sawtooth', rng: ctx && ctx.rng,
    });
    const sub = sine(freq / 2, total);
    const out = new Float32Array(saws.length);
    for (let i = 0; i < out.length; i++) out[i] = saws[i] * 0.7 + sub[i] * 0.5;
    // Filter envelope: sharp punch then close down
    lowPassSweep(out, applyCutoffMult(400 + vel * 2200, ctx), applyCutoffMult(280 + vel * 600, ctx), 1.2);
    adsrExp(out, attackMs(2, ctx), 0.12, 0.6, 0.12, 3);
    gain(out, 0.55 * (0.5 + vel * 0.5));
    return out;
}

function subBass(midi, durBeats, velocity = 100, bpm = 120, ctx) {
    const freq = freqFromCtx(midi, ctx);
    const vel = velocity / 127;
    const gate = beatsToSec(durBeats, bpm);
    const total = gate + 0.2;
    const out = sine(freq, total);
    // Slight harmonic — a triangle at 2x for definition
    const harm = triangle(freq * 2, total);
    for (let i = 0; i < out.length; i++) out[i] = out[i] * 0.85 + harm[i] * 0.12;
    adsrExp(out, attackMs(8, ctx), 0.05, 0.92, 0.18, 2);
    lowPass2(out, 220, 0.7);
    gain(out, 0.65 * (0.6 + vel * 0.4));
    return out;
}

// Analog-style mono lead. Redesigned (2026-07) after the 3-saw ±12-cent unison
// version kept reading as "synth strings" — static wide unison beats slowly,
// which is exactly the string-machine effect. Applied lead-design principles:
//   - Restrained 2-osc architecture: saw + PWM pulse detuned only ~5 cents
//     (different waveforms mask coherent beating), + square sub an octave down
//     for body/focus. "Detune until you just hear it, then back off."
//   - PWM (slow pulse-width LFO) supplies the movement a lead needs WITHOUT
//     unison beating.
//   - Per-note resonant filter ENVELOPE (bright attack decaying ~90 ms to a
//     velocity/key-tracked sustain cutoff) instead of a static LPF.
//   - DELAYED vibrato: ~6 Hz, silent for the first ~180 ms then ramping in —
//     constant-from-onset vibrato is a machine tell.
//   - Analog VCO settle: +10 cents drifting to pitch over the first 25 ms.
//   - Mild tanh drive after the filter for harmonics/glue.
function synthLead(midi, durBeats, velocity = 100, bpm = 120, ctx) {
    const freq = freqFromCtx(midi, ctx);
    const vel = velocity / 127;
    const gate = beatsToSec(durBeats, bpm);
    const total = gate + 0.25;
    const len = Math.floor(total * SAMPLE_RATE);
    const rng = (ctx && ctx.rng) || Math.random;

    const detuneCents = 5 * (0.8 + rng() * 0.4);           // 4–6 cents
    const det = Math.pow(2, detuneCents / 1200);
    const pwmRate = 0.5 + rng() * 0.4;                     // slow PWM drift
    const vibRate = 5.8 + rng() * 0.8;
    const out = new Float32Array(len);
    let p1 = rng(), p2 = rng(), p3 = rng();

    for (let i = 0; i < len; i++) {
        const t = i / SAMPLE_RATE;
        const settle = t < 0.025 ? Math.pow(2, (10 * (1 - t / 0.025)) / 1200) : 1;
        const vibRamp = t < 0.18 ? 0 : Math.min(1, (t - 0.18) / 0.27);
        const vib = vibRamp > 0
            ? Math.pow(2, (Math.sin(TWO_PI * vibRate * t) * 6 * vibRamp) / 1200)
            : 1;
        const f = freq * settle * vib;
        const dt1 = f / SAMPLE_RATE;
        const dt2 = (f * det) / SAMPLE_RATE;
        const dt3 = (f / 2) / SAMPLE_RATE;
        // Osc 1: band-limited saw.
        const saw = (2 * p1 - 1) - polyBlep(p1, dt1);
        // Osc 2: band-limited PWM pulse (comparator + BLEP at both edges).
        const width = 0.35 + 0.12 * Math.sin(TWO_PI * pwmRate * t);
        let pulse = p2 < width ? 1 : -1;
        pulse += polyBlep(p2, dt2);
        pulse -= polyBlep(((p2 - width) % 1 + 1) % 1, dt2);
        pulse -= 2 * width - 1; // remove the pulse's inherent DC (mean of a width-w pulse)
        // Sub: band-limited square one octave down.
        let sub = p3 < 0.5 ? 1 : -1;
        sub += polyBlep(p3, dt3);
        sub -= polyBlep((p3 + 0.5) % 1, dt3);
        out[i] = saw * 0.48 + pulse * 0.36 + sub * 0.22;
        p1 += dt1; if (p1 >= 1) p1 -= 1;
        p2 += dt2; if (p2 >= 1) p2 -= 1;
        p3 += dt3; if (p3 >= 1) p3 -= 1;
    }

    // Filter envelope: velocity-scaled bright peak decaying to a key-tracked
    // sustain cutoff with a ~90 ms time constant (time-varying biquad, same
    // approach as lowPassSweep but with an exponential-decay cutoff curve).
    const kt = Math.pow(freq / 261.6, 0.5); // gentle key tracking
    const peakC = Math.max(200, Math.min(9000, applyCutoffMult((2600 + vel * 4800) * kt, ctx)));
    const susC = Math.max(150, Math.min(6500, applyCutoffMult((1100 + vel * 1700) * kt, ctx)));
    const Q = 1.1;
    {
        let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
        for (let i = 0; i < len; i++) {
            const t = i / SAMPLE_RATE;
            const cutoff = susC + (peakC - susC) * Math.exp(-t / 0.09);
            const w0 = TWO_PI * cutoff / SAMPLE_RATE;
            const sinW0 = Math.sin(w0), cosW0 = Math.cos(w0);
            const alpha = sinW0 / (2 * Q);
            const a0 = 1 + alpha;
            const nb0 = ((1 - cosW0) / 2) / a0;
            const nb1 = (1 - cosW0) / a0;
            const na1 = (-2 * cosW0) / a0;
            const na2 = (1 - alpha) / a0;
            const x0 = out[i];
            const y0 = nb0 * x0 + nb1 * x1 + nb0 * x2 - na1 * y1 - na2 * y2;
            x2 = x1; x1 = x0; y2 = y1; y1 = y0;
            out[i] = y0;
        }
    }

    // Mild drive: adds harmonics back post-filter and glues the three oscs.
    const driven = distortion(out, 1.8);
    out.set(driven);

    adsrExp(out, attackMs(3, ctx), 0.06, 0.85, 0.22, 3);
    gain(out, 0.34 * (0.4 + vel * 0.6));
    return out;
}

// ─── Keys / mallets / plucks (additions 2026-07) ───────────
// Built on the synthLead-redesign lessons: restrained detune, per-note
// envelopes, delayed/structured modulation, natural decay tails.

// Drawbar organ: additive sines at Hammond drawbar ratios + percussion ping +
// key click + rotary (shared-phase pitch/amp wobble). Sustains while gated.
function organ(midi, durBeats, velocity = 100, bpm = 120, ctx) {
    const freq = freqFromCtx(midi, ctx);
    const vel = velocity / 127;
    const gate = beatsToSec(durBeats, bpm);
    const total = gate + 0.12;
    const len = Math.floor(total * SAMPLE_RATE);
    const rng = (ctx && ctx.rng) || Math.random;
    // 16', 8', 5-1/3', 4', 2-2/3', 2', 1-1/3', 1' — a jazz-ish registration.
    const ratios = [0.5, 1, 1.5, 2, 3, 4, 6, 8];
    const levels = [0.5, 0.9, 0.45, 0.55, 0.18, 0.1, 0.05, 0.14];
    const phases = ratios.map(() => rng() * TWO_PI);
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) {
        const t = i / SAMPLE_RATE;
        const rot = Math.sin(TWO_PI * 6.3 * t);
        const vib = 1 + 0.0035 * rot;                       // rotary pitch wobble
        const trem = 1 - 0.12 * (0.5 + 0.5 * Math.sin(TWO_PI * 6.3 * t + 1.3));
        let s = 0;
        for (let h = 0; h < ratios.length; h++) {
            const f = freq * ratios[h] * vib;
            if (f > SAMPLE_RATE * 0.45) continue;
            phases[h] += TWO_PI * f / SAMPLE_RATE;
            s += Math.sin(phases[h]) * levels[h];
        }
        // Hammond-style percussion ping on the 3rd harmonic, fast decay.
        s += Math.sin(TWO_PI * freq * 3 * t) * 0.45 * vel * Math.exp(-t * 16);
        out[i] = s * trem;
    }
    // Key click — tiny filtered noise at the very start.
    for (let i = 0; i < Math.floor(0.003 * SAMPLE_RATE) && i < len; i++) {
        out[i] += (rng() * 2 - 1) * 0.08 * vel * (1 - i / (0.003 * SAMPLE_RATE));
    }
    adsrExp(out, attackMs(4, ctx), 0.01, 1.0, 0.07, 2);
    gain(out, 0.17 * (0.5 + vel * 0.5));
    return out;
}

// Music box: plucked steel comb tooth — inharmonic high partials, bright tick,
// ~1.5 s ring. Best above C5.
function musicBox(midi, durBeats, velocity = 100, bpm = 120, ctx) {
    const freq = freqFromCtx(midi, ctx);
    const vel = velocity / 127;
    const total = beatsToSec(durBeats, bpm) + 1.6;
    const len = Math.floor(total * SAMPLE_RATE);
    const rng = (ctx && ctx.rng) || Math.random;
    const partials = [
        { r: 1,   a: 1.0,              d: 2.8 },
        { r: 3.9, a: 0.35 + vel * 0.2, d: 5.5 },
        { r: 9.2, a: 0.12 * vel,       d: 9 },
    ];
    const out = new Float32Array(len);
    for (const p of partials) {
        const f = freq * p.r;
        if (f > SAMPLE_RATE * 0.45) continue;
        const phase0 = rng() * TWO_PI;
        const step = TWO_PI * f / SAMPLE_RATE;
        for (let i = 0; i < len; i++) {
            const t = i / SAMPLE_RATE;
            out[i] += Math.sin(phase0 + step * i) * p.a * Math.exp(-p.d * t);
        }
    }
    // Pluck tick.
    for (let i = 0; i < Math.floor(0.002 * SAMPLE_RATE); i++) {
        out[i] += (rng() * 2 - 1) * 0.15 * vel * (1 - i / (0.002 * SAMPLE_RATE));
    }
    highPass2(out, Math.max(180, freq * 0.5), 0.707);
    adsrExp(out, 0.0008, 0.05, 0.5, total * 0.55, 2.5);
    gain(out, 0.4 * (0.4 + vel * 0.6));
    return out;
}

// Kalimba: plucked tine — strong fundamental, one high inharmonic partial,
// soft thumb thump, short warm decay.
function kalimba(midi, durBeats, velocity = 100, bpm = 120, ctx) {
    const freq = freqFromCtx(midi, ctx);
    const vel = velocity / 127;
    const total = beatsToSec(durBeats, bpm) + 0.9;
    const len = Math.floor(total * SAMPLE_RATE);
    const rng = (ctx && ctx.rng) || Math.random;
    const out = new Float32Array(len);
    const p2 = 5.9 + (rng() - 0.5) * 0.3;   // tine partial varies tine-to-tine
    const ph1 = rng() * TWO_PI, ph2 = rng() * TWO_PI;
    const s1 = TWO_PI * freq / SAMPLE_RATE, s2 = TWO_PI * freq * p2 / SAMPLE_RATE;
    for (let i = 0; i < len; i++) {
        const t = i / SAMPLE_RATE;
        out[i] = Math.sin(ph1 + s1 * i) * Math.exp(-4.2 * t)
               + (freq * p2 < SAMPLE_RATE * 0.45 ? Math.sin(ph2 + s2 * i) * (0.2 + vel * 0.25) * Math.exp(-13 * t) : 0);
    }
    // Thumb thump.
    const thump = sweep(190, 90, 0.03, 'sine', 'exponential');
    adsrExp(thump, 0.001, 0.012, 0, 0.018, 4);
    addInto(out, thump, 0, 0.25 * vel);
    lowPass2(out, applyCutoffMult(5200, ctx), 0.7);
    adsrExp(out, attackMs(1.5, ctx), 0.04, 0.6, total * 0.5, 2.5);
    gain(out, 0.5 * (0.4 + vel * 0.6));
    return out;
}

// Steel drum: FM fan with the pan's characteristic octave + shimmer partials.
function steelDrum(midi, durBeats, velocity = 100, bpm = 120, ctx) {
    const freq = freqFromCtx(midi, ctx);
    const vel = velocity / 127;
    const total = beatsToSec(durBeats, bpm) + 1.1;
    const ops = [
        { ratio: 1,    level: 1.0,             envelope: (t) => Math.exp(-2.2 * t) },
        { ratio: 2,    level: 0.55,            envelope: (t) => Math.exp(-3.2 * t) },
        { ratio: 2.38, level: 0.28 + vel * 0.2, envelope: (t) => Math.exp(-4.5 * t) },
        { ratio: 3.8,  level: 0.9 + vel * 0.6,  envelope: (t) => Math.exp(-9 * t) },
    ];
    const out = fm4op('fan', ops, freq, total);
    lowPass2(out, applyCutoffMult(6500, ctx), 0.8);
    adsrExp(out, attackMs(2, ctx), 0.08, 0.4, total * 0.5, 3);
    gain(out, 0.4 * (0.4 + vel * 0.6));
    return out;
}

// EDM pluck: two lightly-detuned saws through a fast filter-envelope decay.
// The trance/pop "pluck" — percussive front, quickly darkening tail.
function pluckSynth(midi, durBeats, velocity = 100, bpm = 120, ctx) {
    const freq = freqFromCtx(midi, ctx);
    const vel = velocity / 127;
    const total = beatsToSec(durBeats, bpm) + 0.5;
    const len = Math.floor(total * SAMPLE_RATE);
    const rng = (ctx && ctx.rng) || Math.random;
    const det = Math.pow(2, (6 * (0.8 + rng() * 0.4)) / 1200);
    const out = new Float32Array(len);
    let p1 = rng(), p2 = rng();
    const dt1 = freq / SAMPLE_RATE, dt2 = freq * det / SAMPLE_RATE;
    for (let i = 0; i < len; i++) {
        out[i] = ((2 * p1 - 1) - polyBlep(p1, dt1)) * 0.55
               + ((2 * p2 - 1) - polyBlep(p2, dt2)) * 0.45;
        p1 += dt1; if (p1 >= 1) p1 -= 1;
        p2 += dt2; if (p2 >= 1) p2 -= 1;
    }
    // Fast filter-envelope decay (~110 ms): the defining pluck gesture.
    const peakC = Math.max(300, Math.min(9500, applyCutoffMult(3500 + vel * 4500, ctx)));
    const susC = Math.max(150, Math.min(2000, applyCutoffMult(450 + vel * 350, ctx)));
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    const Q = 1.0;
    for (let i = 0; i < len; i++) {
        const t = i / SAMPLE_RATE;
        const cutoff = susC + (peakC - susC) * Math.exp(-t / 0.11);
        const w0 = TWO_PI * cutoff / SAMPLE_RATE;
        const sinW0 = Math.sin(w0), cosW0 = Math.cos(w0);
        const alpha = sinW0 / (2 * Q);
        const a0 = 1 + alpha;
        const nb0 = ((1 - cosW0) / 2) / a0, nb1 = (1 - cosW0) / a0;
        const na1 = (-2 * cosW0) / a0, na2 = (1 - alpha) / a0;
        const x0 = out[i];
        const y0 = nb0 * x0 + nb1 * x1 + nb0 * x2 - na1 * y1 - na2 * y2;
        x2 = x1; x1 = x0; y2 = y1; y1 = y0;
        out[i] = y0;
    }
    adsrExp(out, attackMs(1.5, ctx), 0.12, 0.25, 0.3, 3.5);
    gain(out, 0.5 * (0.4 + vel * 0.6));
    return out;
}

// Acid bass (303-style): mono BLEP saw, high-resonance filter envelope, drive.
function acidBass(midi, durBeats, velocity = 100, bpm = 120, ctx) {
    const freq = freqFromCtx(midi, ctx);
    const vel = velocity / 127;
    const gate = beatsToSec(durBeats, bpm);
    const total = gate + 0.12;
    const len = Math.floor(total * SAMPLE_RATE);
    const rng = (ctx && ctx.rng) || Math.random;
    const out = new Float32Array(len);
    let p = rng();
    const dt = freq / SAMPLE_RATE;
    for (let i = 0; i < len; i++) {
        out[i] = (2 * p - 1) - polyBlep(p, dt);
        p += dt; if (p >= 1) p -= 1;
    }
    const peakC = Math.max(200, Math.min(6000, applyCutoffMult(500 + vel * 2600, ctx)));
    const susC = Math.max(80, Math.min(900, applyCutoffMult(160 + vel * 260, ctx)));
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    const Q = 3.2;                                       // the squelch
    for (let i = 0; i < len; i++) {
        const t = i / SAMPLE_RATE;
        const cutoff = susC + (peakC - susC) * Math.exp(-t / 0.13);
        const w0 = TWO_PI * cutoff / SAMPLE_RATE;
        const sinW0 = Math.sin(w0), cosW0 = Math.cos(w0);
        const alpha = sinW0 / (2 * Q);
        const a0 = 1 + alpha;
        const nb0 = ((1 - cosW0) / 2) / a0, nb1 = (1 - cosW0) / a0;
        const na1 = (-2 * cosW0) / a0, na2 = (1 - alpha) / a0;
        const x0 = out[i];
        const y0 = nb0 * x0 + nb1 * x1 + nb0 * x2 - na1 * y1 - na2 * y2;
        x2 = x1; x1 = x0; y2 = y1; y1 = y0;
        out[i] = y0;
    }
    const driven = distortion(out, 3);
    out.set(driven);
    // The fast-modulated high-Q biquad pumps near-DC; strip it below the audio band.
    highPass2(out, 28, 0.707);
    adsrExp(out, attackMs(2, ctx), 0.08, 0.65, 0.1, 3);
    gain(out, 0.5 * (0.5 + vel * 0.5));
    return out;
}

// Palm-muted electric guitar: heavily-damped Karplus-Strong + drive + cab-ish LPF.
function mutedGuitar(midi, durBeats, velocity = 100, bpm = 120, ctx) {
    const freq = freqFromCtx(midi, ctx);
    const vel = velocity / 127;
    const total = beatsToSec(durBeats, bpm) + 0.45;
    const out = pluckedString(freq, total, {
        damping: 0.75, brightness: 0.35 + vel * 0.25, exciter: 'noise',
        t60: 0.28 + vel * 0.15, pickPos: 0.12, rng: ctx && ctx.rng,
    });
    // Body thump gives the chug its chest.
    const thump = sweep(160, 85, 0.04, 'sine', 'exponential');
    adsrExp(thump, 0.001, 0.015, 0, 0.025, 4);
    addInto(out, thump, 0, 0.35 * vel);
    const driven = distortion(out, 2.5 + vel * 2);
    out.set(driven);
    lowPass2(out, applyCutoffMult(2600 + vel * 800, ctx), 0.8);
    adsrExp(out, attackMs(1, ctx), 0.05, 0.6, 0.2, 3);
    gain(out, 0.5 * (0.4 + vel * 0.6));
    return out;
}

// ─── Wind / vocal ──────────────────────────────────────────

// Human-style whistle: near-pure sine, pitch scoop into the note, delayed
// vibrato, soft breath-noise bed.
function whistle(midi, durBeats, velocity = 100, bpm = 120, ctx) {
    const freq = freqFromCtx(midi, ctx);
    const vel = velocity / 127;
    const gate = beatsToSec(durBeats, bpm);
    const total = gate + 0.18;
    const len = Math.floor(total * SAMPLE_RATE);
    const rng = (ctx && ctx.rng) || Math.random;
    const vibRate = 5.2 + rng() * 0.9;
    const out = new Float32Array(len);
    let ph = rng() * TWO_PI, ph2 = rng() * TWO_PI;
    for (let i = 0; i < len; i++) {
        const t = i / SAMPLE_RATE;
        const scoop = t < 0.04 ? Math.pow(2, (-35 * (1 - t / 0.04)) / 1200) : 1;
        const vibRamp = t < 0.22 ? 0 : Math.min(1, (t - 0.22) / 0.3);
        const vib = vibRamp > 0 ? Math.pow(2, (Math.sin(TWO_PI * vibRate * t) * 18 * vibRamp) / 1200) : 1;
        const f = freq * scoop * vib;
        ph += TWO_PI * f / SAMPLE_RATE;
        ph2 += TWO_PI * f * 2 / SAMPLE_RATE;
        out[i] = Math.sin(ph) + Math.sin(ph2) * 0.07;
    }
    // Breath bed around the fundamental's octave.
    const breath = whiteNoise(total, 1.0, rng);
    bandPass(breath, Math.min(freq * 2, 9000), 2.2);
    for (let i = 0; i < len; i++) out[i] += breath[i] * 0.05 * (0.5 + vel * 0.5);
    adsrExp(out, attackMs(30, ctx), 0.1, 0.9, 0.14, 2);
    gain(out, 0.35 * (0.4 + vel * 0.6));
    return out;
}

function flute(midi, durBeats, velocity = 100, bpm = 120, ctx) {
    const freq = freqFromCtx(midi, ctx);
    const vel = velocity / 127;
    const gate = beatsToSec(durBeats, bpm);
    const total = gate + 0.3;
    const out = waveguideTube(freq, total, {
        kind: 'flute',
        breath: 0.4 + vel * 0.3,
        brightness: 0.4 + vel * 0.3,
        rng: ctx && ctx.rng,
    });
    adsrExp(out, attackMs(30, ctx), 0.15, 0.92, 0.18, 2);
    gain(out, 0.4 * (0.4 + vel * 0.6));
    return out;
}

function clarinet(midi, durBeats, velocity = 100, bpm = 120, ctx) {
    const freq = freqFromCtx(midi, ctx);
    const vel = velocity / 127;
    const gate = beatsToSec(durBeats, bpm);
    const total = gate + 0.3;
    const out = waveguideTube(freq, total, {
        kind: 'clarinet',
        breath: 0.3 + vel * 0.2,
        brightness: 0.45 + vel * 0.25,
        rng: ctx && ctx.rng,
    });
    adsrExp(out, attackMs(20, ctx), 0.12, 0.88, 0.2, 2);
    gain(out, 0.4 * (0.4 + vel * 0.6));
    return out;
}

// Choir "Ah" — additive vowel-formant pad.
function choirAh(midi, durBeats, velocity = 100, bpm = 120, ctx) {
    const freq = freqFromCtx(midi, ctx);
    const vel = velocity / 127;
    const gate = beatsToSec(durBeats, bpm);
    const total = gate + 0.6;
    // Soft saw + multiple slightly detuned voices give the "choir" thickness.
    // ±14 by default (real choirs vary ~10–18 cents per singer); override via ctx.detuneCents.
    const detuneCents = (ctx && ctx.detuneCents !== undefined) ? ctx.detuneCents : 14;
    const out = detunedStack(freq, total, {
        voices: 4, detuneCents, waveform: 'sawtooth', rng: ctx && ctx.rng,
    });
    // Apply 'a' formant (already does its own bandpass network) at moderate mix
    const ap = require('./audio_primitives');
    ap.vowelFormant(out, 'a', 0.7);
    adsrExp(out, attackMs(100, ctx), 0.4, 0.85, 0.5, 2);
    // Subtle vibrato
    const vibed = vibrato(out, 5, 0.0025);
    for (let i = 0; i < out.length && i < vibed.length; i++) out[i] = vibed[i];
    gain(out, 0.3 * (0.4 + vel * 0.6));
    return out;
}

// ─── Drums ─────────────────────────────────────────────────

function kick(midi, durBeats, velocity = 100, bpm = 120, ctx) {
    const vel = velocity / 127;
    // Body: pitch drops from a brief >1-octave attack jump down to the ~48 Hz
    // resonant pitch (808 circuit analysis: the EG raises the resonator center
    // by more than an octave for the first few ms, which is what makes the
    // attack "knock"). A short initial sweep + a longer body sweep approximates
    // the attack-jump-then-sigh shape better than a single sweep.
    const punch = sweep(420 + vel * 120, 90, 0.012, 'sine', 'exponential');
    adsrExp(punch, 0.0005, 0.006, 0, 0.006, 4);
    const body = sweep(95, 45, 0.30, 'sine', 'exponential');
    adsrExp(body, 0.001, 0.07, 0, 0.22, 3);
    // Click: short noise burst, lowpassed
    const click = whiteNoise(0.005, 0.7 * vel, ctx && ctx.rng);
    lowPass2(click, 4500, 1.0);
    fadeOut(click, 0.005);
    const out = new Float32Array(Math.floor(0.30 * SAMPLE_RATE));
    for (let i = 0; i < body.length; i++) out[i] = body[i] * 0.9 * (0.6 + vel * 0.4);
    for (let i = 0; i < punch.length && i < out.length; i++) out[i] += punch[i] * 0.5 * (0.5 + vel * 0.5);
    for (let i = 0; i < click.length && i < out.length; i++) out[i] += click[i] * 0.6;
    return out;
}

function snare(midi, durBeats, velocity = 100, bpm = 120, ctx) {
    const vel = velocity / 127;
    // Two inharmonic decaying tonal modes (~180/330 Hz, the 909-style detuned
    // pair) instead of one triangle sweep — the second mode decays faster, which
    // gives the "crack + body" separation a single sweep can't. Each gets a tiny
    // downward pitch sweep on the attack for fatness.
    const noiseLen = 0.18;
    const len = Math.floor(noiseLen * SAMPLE_RATE);
    const mode1 = sweep(200, 180, 0.14, 'sine', 'exponential');
    adsrExp(mode1, 0.001, 0.05, 0, 0.09, 3);
    const mode2 = sweep(360, 330, 0.08, 'sine', 'exponential');
    adsrExp(mode2, 0.001, 0.03, 0, 0.05, 3);
    // Noise — the snares themselves, bandpassed, longer decay
    const noise = whiteNoise(noiseLen, 1.0, ctx && ctx.rng);
    bandPass(noise, 2200, 0.9);
    adsrExp(noise, 0.0005, 0.04, 0.15, 0.14, 2.5);
    // Mix — body modes coupled, noise on top
    const out = new Float32Array(len);
    const bodyGain = 0.42 * (0.6 + vel * 0.4);
    for (let i = 0; i < len; i++) {
        if (i < mode1.length) out[i] += mode1[i] * bodyGain;
        if (i < mode2.length) out[i] += mode2[i] * bodyGain * 0.6;
    }
    for (let i = 0; i < noise.length && i < len; i++) out[i] += noise[i] * 0.55 * (0.6 + vel * 0.4);
    return out;
}

function hat(midi, durBeats, velocity = 100, bpm = 120, ctx) {
    const vel = velocity / 127;
    const open = midi >= 49; // crude: high MIDI = open hat
    const len = open ? 0.32 : 0.06;
    const out = whiteNoise(len, 1.0, ctx && ctx.rng);
    bandPass(out, 8500, 0.6);
    highPass2(out, 6000, 0.7);
    adsrExp(out, 0.0005, len * 0.4, 0, len * 0.6, open ? 2.2 : 4);
    gain(out, 0.45 * (0.5 + vel * 0.5));
    return out;
}

function tom(midi, durBeats, velocity = 100, bpm = 120, ctx) {
    const vel = velocity / 127;
    const baseFreq = midiToFreq(midi);
    const out = sweep(baseFreq * 1.6, baseFreq * 0.85, 0.32, 'sine', 'exponential');
    adsrExp(out, 0.001, 0.12, 0, 0.2, 3);
    // Subtle noise for stick attack
    const click = whiteNoise(0.006, 0.4 * vel, ctx && ctx.rng);
    lowPass2(click, 3000, 1.0);
    for (let i = 0; i < click.length && i < out.length; i++) out[i] += click[i] * 0.25;
    gain(out, 0.65 * (0.6 + vel * 0.4));
    return out;
}

function clap(midi, durBeats, velocity = 100, bpm = 120, ctx) {
    const vel = velocity / 127;
    // Four staggered short noise bursts (canonical vintage-drum-machine clap pattern)
    const totalLen = Math.floor(0.16 * SAMPLE_RATE);
    const out = new Float32Array(totalLen);
    const offsets = [0, 0.009, 0.018, 0.027];
    const rng = ctx && ctx.rng;
    for (const off of offsets) {
        const burst = whiteNoise(0.012, 1.0, rng);
        bandPass(burst, 1500, 0.7);
        adsrExp(burst, 0.0005, 0.005, 0, 0.007, 4);
        addInto(out, burst, Math.floor(off * SAMPLE_RATE), 0.6);
    }
    // Final longer "ring" tail
    const tail = whiteNoise(0.13, 1.0, rng);
    bandPass(tail, 1800, 0.5);
    adsrExp(tail, 0.001, 0.025, 0.2, 0.1, 2.5);
    addInto(out, tail, Math.floor(0.027 * SAMPLE_RATE), 0.4);
    gain(out, 0.5 * (0.5 + vel * 0.5));
    return out;
}

// Crash cymbal: long bright noise wash with two shimmer bands and a slow
// spectral settle (band centers drift down as it rings out).
function crash(midi, durBeats, velocity = 100, bpm = 120, ctx) {
    const vel = velocity / 127;
    const total = 1.9;
    const out = whiteNoise(total, 1.0, ctx && ctx.rng);
    highPass2(out, 3200, 0.707);
    const shimmerA = Float32Array.from(out);
    bandPass(shimmerA, 7500, 0.8);
    const shimmerB = Float32Array.from(out);
    bandPass(shimmerB, 11500, 1.2);
    for (let i = 0; i < out.length; i++) {
        out[i] = out[i] * 0.5 + shimmerA[i] * 0.45 + shimmerB[i] * 0.3;
    }
    adsrExp(out, 0.0008, 0.25, 0.25, 1.5, 2.2);
    gain(out, 0.4 * (0.5 + vel * 0.5));
    return out;
}

function shaker(midi, durBeats, velocity = 100, bpm = 120, ctx) {
    const vel = velocity / 127;
    const out = whiteNoise(0.09, 1.0, ctx && ctx.rng);
    bandPass(out, 6500, 0.4);
    highPass2(out, 4000, 0.7);
    adsrExp(out, 0.001, 0.025, 0.15, 0.06, 3);
    gain(out, 0.32 * (0.5 + vel * 0.5));
    return out;
}

// ─── Voice registry ─────────────────────────────────────────

const VOICES = {
    // Keyboards & melodic percussion
    piano, electricPiano, bell, marimba, vibraphone, organ, musicBox, kalimba, steelDrum,
    // Strings (plucked)
    pluckString, nylonGuitar, mutedGuitar,
    // Synth
    pad, analogBrass, synthBass, subBass, synthLead, pluckSynth, acidBass,
    // Wind / vocal
    flute, clarinet, choirAh, whistle,
    // Drums
    kick, snare, hat, tom, clap, shaker, crash,
};

// One-line descriptions surfaced to the SKILL.md voice catalog.
const VOICE_DESCRIPTIONS = {
    piano: 'Mass-spring additive piano with inharmonicity. Lush long decay; cuts well in jazz/lofi.',
    electricPiano: 'FM electric piano with tine-like top and warm body. Best for jazz, lofi, R&B comping.',
    bell: 'Fan-algorithm 4-op FM bell. Glassy and long-ringing. Use as ear-candy, not as melody.',
    marimba: 'FM mallet percussion. Short, woody. Great for ostinatos and tonal accents.',
    vibraphone: 'FM bell with 5 Hz tremolo (motor-disk-style). Sits well in jazz and ambient.',
    pluckString: 'Delay-line plucked string. Harp/koto-like; bright with velocity. No body resonance.',
    nylonGuitar: 'Delay-line pluck + body thump. Soft, intimate; finger-style plucks.',
    pad: 'Detuned-saw + slow filter sweep. The "warm pad" workhorse; layer under leads.',
    analogBrass: 'Detuned saws + velocity-tracking filter. Punchy fanfare voice.',
    synthBass: 'Two saws + sub sine + filter envelope. Punchy electronic bass.',
    subBass: 'Pure sine with hint of triangle harmonic. Deep, clean weight under 220 Hz.',
    synthLead: 'Analog-style lead: saw + PWM pulse (~5c detune) + sub, filter envelope, delayed vibrato, mild drive.',
    flute: 'Digital-waveguide tube (open ends). Breathy attack; clean fundamental.',
    clarinet: 'Digital-waveguide tube (closed-open). Odd-only harmonics; woody.',
    choirAh: 'Detuned saw stack + "a" formant + vibrato. Vocal-pad sound.',
    organ: 'Additive drawbar organ + rotary wobble + percussion ping. Funk/gospel/rnb comping.',
    musicBox: 'Plucked steel comb tooth — inharmonic sparkle, ~1.5 s ring. Cute/dreamy; best above C5.',
    kalimba: 'Plucked tine with thumb thump. Lofi/cute ostinatos.',
    steelDrum: 'FM pan with octave + shimmer partials. Tropical/island.',
    pluckSynth: 'Two-saw pluck with fast filter decay. Trance/pop/EDM arpeggios.',
    acidBass: '303-style mono saw + high-resonance filter envelope + drive. Squelchy electronic bass.',
    mutedGuitar: 'Palm-muted Karplus-Strong + drive. Pop/rock/funk chug riffs.',
    whistle: 'Near-pure sine with pitch scoop, delayed vibrato, breath bed. Playful melodies.',
    crash: 'Long bright cymbal wash with shimmer bands. Section starts / fills.',
    kick: 'Pitch-dropping sine + click. Drum-machine kick; tune midi up/down for size.',
    snare: 'Triangle thump + bandpassed noise. Classic punchy snare.',
    hat: 'Bandpassed white noise. midi ≥ 49 → open (long); else closed (short).',
    tom: 'Pitch-sweeping sine + click. midi sets the tom\'s tuning.',
    clap: 'Four staggered noise bursts + ring tail. Drum-machine-style clap.',
    shaker: 'Filtered noise burst. Adds top-end texture.',
};

module.exports = {
    VOICES,
    VOICE_DESCRIPTIONS,
    // Direct re-exports for ergonomic require()
    piano, electricPiano, bell, marimba, vibraphone, organ, musicBox, kalimba, steelDrum,
    pluckString, nylonGuitar, mutedGuitar,
    pad, analogBrass, synthBass, subBass, synthLead, pluckSynth, acidBass,
    flute, clarinet, choirAh, whistle,
    kick, snare, hat, tom, clap, shaker, crash,
    // Helpers
    midiToFreq, beatsToSec,
};
