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
    mix, addInto, concat, silence,
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

function synthLead(midi, durBeats, velocity = 100, bpm = 120, ctx) {
    const freq = freqFromCtx(midi, ctx);
    const vel = velocity / 127;
    const gate = beatsToSec(durBeats, bpm);
    const total = gate + 0.18;
    const out = detunedStack(freq, total, {
        voices: 3, detuneCents: 12, waveform: 'sawtooth', rng: ctx && ctx.rng,
    });
    lowPass2(out, applyCutoffMult(2800 + vel * 3500, ctx), 1.3);
    adsrExp(out, attackMs(8, ctx), 0.15, 0.82, 0.2, 3);
    // Subtle vibrato
    const vibed = vibrato(out, 6, 0.002);
    for (let i = 0; i < out.length && i < vibed.length; i++) out[i] = vibed[i];
    gain(out, 0.4 * (0.4 + vel * 0.6));
    return out;
}

// ─── Wind / vocal ──────────────────────────────────────────

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
    // Body: 130 Hz → 50 Hz exponential pitch drop, ~250 ms long.
    const body = sweep(150 + vel * 60, 45, 0.28, 'sine', 'exponential');
    adsrExp(body, 0.001, 0.06, 0, 0.22, 3);
    // Click: short noise burst, lowpassed
    const click = whiteNoise(0.005, 0.7 * vel, ctx && ctx.rng);
    lowPass2(click, 4500, 1.0);
    fadeOut(click, 0.005);
    const out = new Float32Array(Math.floor(0.28 * SAMPLE_RATE));
    for (let i = 0; i < body.length; i++) out[i] = body[i] * 0.9 * (0.6 + vel * 0.4);
    for (let i = 0; i < click.length && i < out.length; i++) out[i] += click[i] * 0.6;
    return out;
}

function snare(midi, durBeats, velocity = 100, bpm = 120, ctx) {
    const vel = velocity / 127;
    // Tonal body — short pitched thump
    const body = sweep(220, 170, 0.12, 'triangle', 'exponential');
    adsrExp(body, 0.001, 0.05, 0, 0.07, 3);
    // Noise — the snares themselves, bandpassed, longer decay
    const noiseLen = 0.18;
    const noise = whiteNoise(noiseLen, 1.0, ctx && ctx.rng);
    bandPass(noise, 2200, 0.9);
    adsrExp(noise, 0.0005, 0.04, 0.15, 0.14, 2.5);
    // Mix
    const len = Math.floor(noiseLen * SAMPLE_RATE);
    const out = new Float32Array(len);
    for (let i = 0; i < body.length && i < len; i++) out[i] += body[i] * 0.45 * (0.6 + vel * 0.4);
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
    piano, electricPiano, bell, marimba, vibraphone,
    // Strings (plucked)
    pluckString, nylonGuitar,
    // Synth
    pad, analogBrass, synthBass, subBass, synthLead,
    // Wind / vocal
    flute, clarinet, choirAh,
    // Drums
    kick, snare, hat, tom, clap, shaker,
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
    synthLead: 'Three-saw stack, resonant LPF, light vibrato. Cuts through pads.',
    flute: 'Digital-waveguide tube (open ends). Breathy attack; clean fundamental.',
    clarinet: 'Digital-waveguide tube (closed-open). Odd-only harmonics; woody.',
    choirAh: 'Detuned saw stack + "a" formant + vibrato. Vocal-pad sound.',
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
    piano, electricPiano, bell, marimba, vibraphone,
    pluckString, nylonGuitar,
    pad, analogBrass, synthBass, subBass, synthLead,
    flute, clarinet, choirAh,
    kick, snare, hat, tom, clap, shaker,
    // Helpers
    midiToFreq, beatsToSec,
};
