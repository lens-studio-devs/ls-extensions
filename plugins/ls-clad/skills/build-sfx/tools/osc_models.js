// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// osc_models.js — Voice cores: physical-modeling + FM synthesis.
// These are the building blocks `synth_voices.js` composes. They aim for "instrument-like"
// timbre — not pretty math waves. The delay-line pluck, multi-operator FM, and detuned-saw
// stack are the three biggest "less synthetic" levers we have without samples.

const { SAMPLE_RATE, TWO_PI, lowPass, lowPass2, highPass2 } = require('./audio_primitives');

// ─── Delay-line plucked-string model ────────────────────────
// Excite a delay line of length floor(SR/freq) with a noise burst, then loop with
// lowpass + feedback. Result: plucked harp/guitar/koto with natural decay.
// opts.damping (0..1): higher = darker, faster decay. opts.brightness (0..1): exciter
// spectral content; lower = warmer pluck. opts.exciter: 'noise'|'click'|'mallet'.
function pluckedString(freq, duration, opts = {}) {
    const damping = opts.damping !== undefined ? opts.damping : 0.5;
    const brightness = opts.brightness !== undefined ? opts.brightness : 0.5;
    const exciter = opts.exciter || 'noise';
    const rng = opts.rng || Math.random;

    const len = Math.floor(SAMPLE_RATE * duration);
    const out = new Float32Array(len);
    const delayLen = Math.max(2, Math.floor(SAMPLE_RATE / freq));
    const buf = new Float32Array(delayLen);

    // Excite the delay line
    if (exciter === 'click') {
        buf[0] = 1.0;
        buf[1] = 0.5;
    } else if (exciter === 'mallet') {
        // Soft mallet: half-sine bump
        for (let i = 0; i < delayLen; i++) {
            buf[i] = Math.sin(Math.PI * i / delayLen) * (1 - brightness * 0.3);
        }
    } else {
        for (let i = 0; i < delayLen; i++) buf[i] = (rng() * 2 - 1);
        // Optionally tame brightness with a one-pole on the noise burst
        if (brightness < 0.9) {
            const cutoff = 200 + brightness * 8000;
            const rc = 1.0 / (TWO_PI * cutoff);
            const dt = 1.0 / SAMPLE_RATE;
            const alpha = dt / (rc + dt);
            for (let i = 1; i < delayLen; i++) buf[i] = buf[i - 1] + alpha * (buf[i] - buf[i - 1]);
        }
    }

    // Loop: each sample is averaged with the next (1-pole lowpass inside the feedback loop)
    // and scaled by (1 - damping*0.001) to allow long decay tails.
    const lpMix = 0.5 + damping * 0.15;          // 0.5..0.65 — heavier LP = darker
    const feedback = 1 - 0.0008 - damping * 0.003; // close to 1 for ring
    let idx = 0;
    let last = buf[delayLen - 1];
    for (let i = 0; i < len; i++) {
        const curr = buf[idx];
        const next = lpMix * curr + (1 - lpMix) * last;
        const filtered = next * feedback;
        out[i] = filtered;
        buf[idx] = filtered;
        last = curr;
        idx = (idx + 1) % delayLen;
    }
    return out;
}

// ─── Digital waveguide tube (flute / clarinet) ─────────────
// Bi-directional delay line with reflections. Flute: both ends open (sign-preserving
// reflection). Clarinet: closed at mouth, open at bell (one inverted reflection).
// opts.kind: 'flute'|'clarinet'. opts.breath (0..1): noise intensity blown into mouth.
function waveguideTube(freq, duration, opts = {}) {
    const kind = opts.kind || 'flute';
    const breath = opts.breath !== undefined ? opts.breath : 0.3;
    const brightness = opts.brightness !== undefined ? opts.brightness : 0.5;
    const rng = opts.rng || Math.random;

    const len = Math.floor(SAMPLE_RATE * duration);
    const out = new Float32Array(len);
    // For flute, the open tube's fundamental is c/2L → length = SR / (2*freq).
    // For clarinet (closed-open), fundamental is c/4L → length = SR / (4*freq) per direction,
    // but odd-only harmonics emerge naturally from inversion.
    const tubeLen = Math.max(8, Math.floor(SAMPLE_RATE / (kind === 'clarinet' ? freq * 4 : freq * 2)));
    const fwd = new Float32Array(tubeLen);
    const bwd = new Float32Array(tubeLen);

    const reflMouth = kind === 'clarinet' ? -0.97 : 0.97;
    const reflBell = -0.95; // partial loss at open end
    const lossPerPass = 0.999;
    const breathLPCutoff = 800 + brightness * 4000;
    const rc = 1.0 / (TWO_PI * breathLPCutoff);
    const dt = 1.0 / SAMPLE_RATE;
    const alpha = dt / (rc + dt);
    let breathPrev = 0;

    // Attack envelope: breath ramps in over first 20 ms
    const attackSamples = Math.floor(0.02 * SAMPLE_RATE);

    let fwdIdx = 0;
    let bwdIdx = 0;
    for (let i = 0; i < len; i++) {
        const attackEnv = i < attackSamples ? i / attackSamples : 1;
        // Generate breath noise, lowpassed
        const noise = (rng() * 2 - 1) * breath * attackEnv;
        breathPrev = breathPrev + alpha * (noise - breathPrev);
        const exciter = breathPrev * 0.3;

        // Read end of forward delay (arrives at bell)
        const fwdOut = fwd[fwdIdx] * lossPerPass;
        // Reflect at bell into backward direction (with sign change for clarinet, less so flute)
        bwd[bwdIdx] = fwdOut * reflBell;

        // Read end of backward delay (arrives back at mouth)
        const bwdOut = bwd[(bwdIdx + 1) % tubeLen] * lossPerPass;
        // Add exciter + reflect at mouth back into forward direction
        const fwdNext = (fwdIdx + 1) % tubeLen;
        fwd[fwdNext] = exciter + bwdOut * reflMouth;

        // Output = pressure at bell (forward end)
        out[i] = fwdOut;
        fwdIdx = (fwdIdx + 1) % tubeLen;
        bwdIdx = (bwdIdx + 1) % tubeLen;
    }
    return out;
}

// ─── FM operators ──────────────────────────────────────────
// Classic 2-op: modulator sin(2π·freq·ratio·t) modulates carrier phase.
// modEnv: function(t in 0..1) → multiplier on modIndex (use for decaying brightness).
function fmOperator(freq, duration, ratio, modIndex, modEnvFn) {
    const len = Math.floor(SAMPLE_RATE * duration);
    const out = new Float32Array(len);
    const carrStep = TWO_PI * freq / SAMPLE_RATE;
    const modStep = TWO_PI * freq * ratio / SAMPLE_RATE;
    let carrPhase = 0, modPhase = 0;
    const envFn = modEnvFn || (() => 1);
    for (let i = 0; i < len; i++) {
        const t = i / len;
        const idx = modIndex * envFn(t);
        const mod = Math.sin(modPhase) * idx;
        out[i] = Math.sin(carrPhase + mod);
        carrPhase += carrStep;
        modPhase += modStep;
    }
    return out;
}

// 4-operator FM stack. `ops` is [{ratio, level, envelope}, ...]. `algo` is one of:
//   'stack4'  : 4 → 3 → 2 → 1  (serial, super-bright bells)
//   'pair'    : (4 → 3) + (2 → 1)  (electric piano)
//   'parallel': (4 → 1) + (3 → 1) + (2 → 1)  (organ-ish, lots of harmonics)
//   'fan'     : 4 → [1, 2, 3] parallel  (chime/bell with rich body)
// Each op envelope is a function (t in 0..1) → 0..1 amplitude multiplier.
function fm4op(algo, ops, freq, duration) {
    const len = Math.floor(SAMPLE_RATE * duration);
    const out = new Float32Array(len);
    const phases = ops.map(() => 0);
    const steps = ops.map(op => TWO_PI * freq * op.ratio / SAMPLE_RATE);

    for (let i = 0; i < len; i++) {
        const t = i / len;
        const phaseMod = new Array(ops.length).fill(0);
        const opOut = new Array(ops.length).fill(0);

        // Compute each op (modulators first, carriers reference them)
        for (let o = ops.length - 1; o >= 0; o--) {
            const env = ops[o].envelope ? ops[o].envelope(t) : 1;
            opOut[o] = Math.sin(phases[o] + phaseMod[o]) * ops[o].level * env;
        }

        // Apply algorithm — wire op outputs into next phase mods
        let mix = 0;
        if (algo === 'stack4') {
            phaseMod[2] = opOut[3];
            phaseMod[1] = opOut[2];
            phaseMod[0] = opOut[1];
            mix = opOut[0];
        } else if (algo === 'pair') {
            phaseMod[2] = opOut[3];
            phaseMod[0] = opOut[1];
            mix = opOut[2] + opOut[0];
        } else if (algo === 'parallel') {
            phaseMod[0] = opOut[1] + opOut[2] + opOut[3];
            mix = opOut[0];
        } else if (algo === 'fan') {
            phaseMod[0] = opOut[3];
            phaseMod[1] = opOut[3];
            phaseMod[2] = opOut[3];
            mix = opOut[0] + opOut[1] + opOut[2];
        } else {
            // default: pure mix of carriers
            for (let o = 0; o < ops.length; o++) mix += opOut[o];
        }
        out[i] = mix;

        for (let o = 0; o < ops.length; o++) phases[o] += steps[o];
    }
    return out;
}

// ─── Detuned-stack oscillator ──────────────────────────────
// N voices, slightly detuned in cents, summed. The classic "supersaw" / fat pad voice.
// opts.voices (3..7), opts.detuneCents (total spread), opts.waveform, opts.stereoSpread (0..1).
// Returns stereo {left, right} when stereoSpread > 0, mono Float32Array otherwise.
function detunedStack(freq, duration, opts = {}) {
    const voices = opts.voices || 5;
    const detuneCents = opts.detuneCents !== undefined ? opts.detuneCents : 14;
    const waveform = opts.waveform || 'sawtooth';
    const stereoSpread = opts.stereoSpread !== undefined ? opts.stereoSpread : 0;
    const rng = opts.rng || Math.random;

    const len = Math.floor(SAMPLE_RATE * duration);
    const mono = new Float32Array(len);
    const left = stereoSpread > 0 ? new Float32Array(len) : null;
    const right = stereoSpread > 0 ? new Float32Array(len) : null;

    // Voice detunings: spread evenly from -detuneCents/2 to +detuneCents/2, plus a small jitter
    const phases = new Float32Array(voices);
    const freqs = new Float32Array(voices);
    const pans = new Float32Array(voices); // -1..1
    for (let v = 0; v < voices; v++) {
        const cents = ((v / (voices - 1)) - 0.5) * detuneCents + (rng() - 0.5) * 1.5;
        freqs[v] = freq * Math.pow(2, cents / 1200);
        phases[v] = rng() * TWO_PI; // random phase = no coherent flam at attack
        pans[v] = ((v / Math.max(1, voices - 1)) - 0.5) * 2 * stereoSpread;
    }

    const gainPerVoice = 1 / Math.sqrt(voices); // equal-power sum

    for (let i = 0; i < len; i++) {
        for (let v = 0; v < voices; v++) {
            const p = (phases[v] % TWO_PI) / TWO_PI;
            let sample;
            switch (waveform) {
                case 'square':   sample = p < 0.5 ? 1 : -1; break;
                case 'triangle': sample = 4 * Math.abs(p - 0.5) - 1; break;
                case 'sine':     sample = Math.sin(phases[v]); break;
                default:         sample = 2 * p - 1; break;
            }
            sample *= gainPerVoice;
            if (left) {
                const pan = pans[v];
                const angle = (pan + 1) * 0.25 * Math.PI;
                left[i] += sample * Math.cos(angle);
                right[i] += sample * Math.sin(angle);
            } else {
                mono[i] += sample;
            }
            phases[v] += TWO_PI * freqs[v] / SAMPLE_RATE;
        }
    }
    if (left) return { left, right };
    return mono;
}

// ─── Piano model ───────────────────────────────────────────
// Additive: a stack of partials at slightly stretched harmonic ratios (inharmonicity).
// Each partial has its own decay rate (higher partials decay faster) and a velocity-shaped
// initial amplitude. Then a double-decay envelope (fast initial drop, slow tail).
// Built on the existing renderNoteV2 approach but cleaner and parameterized.
function pianoModel(midi, duration, velocity = 100, opts = {}) {
    const rng = opts.rng || Math.random;
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const vel = Math.max(1, Math.min(127, velocity)) / 127;

    const len = Math.floor(SAMPLE_RATE * duration);
    const out = new Float32Array(len);

    // Inharmonicity: f_n = n·f0·sqrt(1 + B·n²). Lower notes have less B than upper notes.
    const B = midi < 36 ? 0.00005 : midi < 60 ? 0.00008 : midi < 84 ? 0.00018 : 0.0005;

    // Number of partials and their relative amplitudes — based on rough analysis of real piano.
    const partials = [
        { n: 1, amp: 1.00, decay: 0.85 },
        { n: 2, amp: 0.45, decay: 0.45 },
        { n: 3, amp: 0.32, decay: 0.30 },
        { n: 4, amp: 0.22, decay: 0.20 },
        { n: 5, amp: 0.18, decay: 0.16 },
        { n: 6, amp: 0.12, decay: 0.12 },
        { n: 7, amp: 0.08, decay: 0.10 },
        { n: 8, amp: 0.06, decay: 0.08 },
        { n: 9, amp: 0.04, decay: 0.06 },
        { n: 10, amp: 0.03, decay: 0.05 },
    ];

    // Brightness scales with velocity: harder hits emphasize higher partials.
    const brightness = 0.4 + vel * 0.6;

    for (const p of partials) {
        const partialFreq = p.n * freq * Math.sqrt(1 + B * p.n * p.n);
        if (partialFreq > SAMPLE_RATE * 0.45) continue;
        // Tiny per-partial phase randomization removes coherent attack click
        const phase0 = rng() * TWO_PI;
        const step = TWO_PI * partialFreq / SAMPLE_RATE;
        const partialAmp = p.amp * brightness * (p.n === 1 ? 1 : Math.pow(brightness, 0.5));
        const decayRate = p.decay * (1 + (p.n - 1) * 0.1); // higher partials decay even faster
        for (let i = 0; i < len; i++) {
            const t = i / SAMPLE_RATE;
            const env = Math.exp(-decayRate * t);
            out[i] += Math.sin(phase0 + step * i) * partialAmp * env;
        }
    }

    // Double-decay envelope: very fast initial drop (hammer phase) then slow tail.
    const hammerSamples = Math.floor(0.01 * SAMPLE_RATE);
    const sustainScale = 0.55 + vel * 0.4;
    for (let i = 0; i < len; i++) {
        const t = i / SAMPLE_RATE;
        let env;
        if (i < hammerSamples) {
            env = 1 + (1 - sustainScale) * (1 - i / hammerSamples);
        } else {
            env = sustainScale * Math.exp(-0.5 * (t - 0.01));
        }
        out[i] *= env * vel * 0.4;
    }

    // Quick attack click (hammer striking string) — a tiny noise burst, lowpassed
    const clickSamples = Math.floor(0.003 * SAMPLE_RATE);
    for (let i = 0; i < clickSamples; i++) {
        out[i] += (rng() * 2 - 1) * 0.05 * vel * (1 - i / clickSamples);
    }
    // LP the click region a bit so it isn't harsh
    lowPass(out.subarray(0, clickSamples * 4), 4000 + vel * 4000);

    return out;
}

module.exports = {
    pluckedString,
    waveguideTube,
    fmOperator,
    fm4op,
    detunedStack,
    pianoModel,
};
