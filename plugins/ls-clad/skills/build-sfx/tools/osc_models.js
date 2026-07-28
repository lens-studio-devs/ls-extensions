// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// osc_models.js — Voice cores: physical-modeling + FM synthesis.
// These are the building blocks `synth_voices.js` composes. They aim for "instrument-like"
// timbre — not pretty math waves. The delay-line pluck, multi-operator FM, and detuned-saw
// stack are the three biggest "less synthetic" levers we have without samples.

const { SAMPLE_RATE, TWO_PI, lowPass, lowPass2, highPass2, polyBlep } = require('./audio_primitives');

// ─── Delay-line plucked-string model (Extended Karplus-Strong) ──────────────
// Excite a delay line with a noise burst, then loop it through a damping filter
// with feedback. This is the Jaffe & Smith (CMJ 7(2), 1983) extension of the
// basic Karplus-Strong algorithm — patents US4,622,877 / US4,649,783 expired
// ~2004; implemented clean-room from the published method. Key upgrades over a
// plain integer-delay loop:
//   1. Fractional-delay tuning via a first-order allpass — a plain integer delay
//      is progressively FLAT at high pitch (measured -12 cents at 880 Hz, and
//      tuning fell apart entirely above ~1.5 kHz). The allpass makes up the
//      sub-sample remainder so every pitch is in tune.
//   2. Pitch-independent decay: per-round-trip loop gain rho = 0.001^(1/(f0·t60))
//      gives an exact -60 dB decay in t60 seconds regardless of pitch.
//   3. A brightness-controlled one-zero damping filter inside the loop.
//   4. A pick-position feedforward comb on the excitation (spectral notches a
//      real pluck has).
// opts.damping (0..1): higher = darker / faster HF loss. opts.brightness (0..1):
// exciter spectral content. opts.exciter: 'noise'|'click'|'mallet'. opts.t60:
// decay time in seconds (default derived from damping). opts.pickPos (0..0.5):
// relative pick position along the string (0 disables the comb).
function pluckedString(freq, duration, opts = {}) {
    const damping = opts.damping !== undefined ? opts.damping : 0.5;
    const brightness = opts.brightness !== undefined ? opts.brightness : 0.5;
    const exciter = opts.exciter || 'noise';
    const rng = opts.rng || Math.random;
    const t60 = opts.t60 !== undefined ? opts.t60 : (1.0 + (1 - damping) * 3.5); // seconds to -60 dB
    const pickPos = opts.pickPos !== undefined ? opts.pickPos : 0.0;

    const len = Math.floor(SAMPLE_RATE * duration);
    const out = new Float32Array(len);

    // Total loop delay needed for this pitch, split into integer line + one-zero
    // damping filter (phase delay ≈ b1) + a fractional allpass for the remainder.
    const N = SAMPLE_RATE / freq;
    const b1 = 0.25 + damping * 0.2;   // one-zero damping coefficient (also its LF phase delay)
    const b0 = 1 - b1;
    let L = Math.floor(N - b1 - 0.5);
    if (L < 1) L = 1;
    let D = N - L - b1;                 // fractional delay handed to the allpass
    while (D < 0.1 && L > 1) { L -= 1; D += 1; }
    while (D > 1.1) { L += 1; D -= 1; }
    const eta = (1 - D) / (1 + D);      // first-order allpass coefficient

    // Per-round-trip loop gain for an exact t60 (each delay slot is filtered once
    // per round trip, i.e. once every L samples), so this is the round-trip loss.
    const rho = Math.pow(0.001, 1 / (freq * t60));

    const buf = new Float32Array(L);

    // ─ Excite the delay line ─
    if (exciter === 'click') {
        buf[0] = 1.0;
        if (L > 1) buf[1] = 0.5;
    } else if (exciter === 'mallet') {
        for (let i = 0; i < L; i++) buf[i] = Math.sin(Math.PI * i / L) * (1 - brightness * 0.3);
    } else {
        for (let i = 0; i < L; i++) buf[i] = (rng() * 2 - 1);
        if (brightness < 0.9) {
            const cutoff = 200 + brightness * 8000;
            const rc = 1.0 / (TWO_PI * cutoff);
            const dt = 1.0 / SAMPLE_RATE;
            const alpha = dt / (rc + dt);
            for (let i = 1; i < L; i++) buf[i] = buf[i - 1] + alpha * (buf[i] - buf[i - 1]);
        }
    }

    // ─ Pick-position comb: y[n] = x[n] - x[n - round(pickPos·L)] ─
    // Cancels harmonics with an antinode at the pick point (a real pluck near the
    // bridge is brighter; pickPos≈0.5 thins even harmonics). Applied once to the
    // excitation, outside the loop, so it costs nothing during the ring.
    if (pickPos > 0) {
        const d = Math.max(1, Math.round(pickPos * L));
        const src = Float32Array.from(buf);
        for (let i = 0; i < L; i++) buf[i] = src[i] - (i - d >= 0 ? src[i - d] : 0);
    }

    // ─ Loop: delay → fractional allpass → one-zero damping × rho → feedback ─
    let idx = 0;
    let lastIn = 0;          // x[n-1] for the one-zero damping filter
    let apX1 = 0, apY1 = 0;  // first-order allpass state
    for (let i = 0; i < len; i++) {
        const delayed = buf[idx];
        const apOut = eta * delayed + apX1 - eta * apY1;  // allpass fractional delay
        apX1 = delayed; apY1 = apOut;
        const filtered = rho * (b0 * apOut + b1 * lastIn); // damping + loss
        lastIn = apOut;
        out[i] = filtered;
        buf[idx] = filtered;
        idx = (idx + 1) % L;
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
//   'parallel': (2,3,4 → 1)  (organ-ish, lots of harmonics)
//   'fan'     : 4 → [1, 2, 3] parallel  (chime/bell with rich body)
// Each op envelope is a function (t in 0..1) → 0..1 amplitude multiplier.
// A modulator's `level` is its modulation index in radians (its output is added
// to the carrier's phase), so level ~1–3 gives strong sidebands, <0.5 subtle.
//
// Operators are evaluated in dependency order WITHIN each sample — modulators
// first, then the carriers that read them. (A previous version computed all
// operator outputs before wiring, which silently zeroed every modulation path:
// the "FM" voices were pure sine mixes.)
function fm4op(algo, ops, freq, duration) {
    const len = Math.floor(SAMPLE_RATE * duration);
    const out = new Float32Array(len);
    const phases = [0, 0, 0, 0];
    const steps = ops.map(op => TWO_PI * freq * op.ratio / SAMPLE_RATE);
    const opVal = (o, t, mod) =>
        Math.sin(phases[o] + mod) * ops[o].level * (ops[o].envelope ? ops[o].envelope(t) : 1);

    for (let i = 0; i < len; i++) {
        const t = i / len;
        let mix = 0;
        if (algo === 'stack4') {
            const o3 = opVal(3, t, 0);
            const o2 = opVal(2, t, o3);
            const o1 = opVal(1, t, o2);
            mix = opVal(0, t, o1);
        } else if (algo === 'pair') {
            const o3 = opVal(3, t, 0);
            const o1 = opVal(1, t, 0);
            mix = opVal(2, t, o3) + opVal(0, t, o1);
        } else if (algo === 'parallel') {
            const modSum = opVal(1, t, 0) + opVal(2, t, 0) + opVal(3, t, 0);
            mix = opVal(0, t, modSum);
        } else if (algo === 'fan') {
            const o3 = opVal(3, t, 0);
            mix = opVal(0, t, o3) + opVal(1, t, o3) + opVal(2, t, o3);
        } else {
            // default: pure mix of all ops as carriers
            for (let o = 0; o < ops.length; o++) mix += opVal(o, t, 0);
        }
        out[i] = mix;
        for (let o = 0; o < ops.length; o++) phases[o] += steps[o];
    }
    return out;
}

// ─── Detuned-stack oscillator ("supersaw") ──────────────────
// N voices, slightly detuned in cents, summed. The classic fat pad / supersaw
// voice. Saw and square voices are band-limited per-voice with PolyBLEP — the
// old inline naive saws aliased ~20 dB under the harmonics (audible grit on the
// most-used melodic voices: pad, lead, brass). Random per-voice phase avoids the
// coherent attack flam on repeated notes.
// opts.voices (2..7), opts.detuneCents (total spread), opts.waveform,
// opts.stereoSpread (0..1). opts.hpfTrack: if set, a 2nd-order high-pass tracks
// the fundamental at hpfTrack·freq (≈0.9) — the JP-8000 trick that removes the
// sub-fundamental beating "mud" between detuned voices and tightens the low end.
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
    const phase = new Float32Array(voices); // normalized phase 0..1
    const dts = new Float32Array(voices);   // per-sample phase increment
    const pans = new Float32Array(voices);  // -1..1
    for (let v = 0; v < voices; v++) {
        const cents = ((v / Math.max(1, voices - 1)) - 0.5) * detuneCents + (rng() - 0.5) * 1.5;
        const f = freq * Math.pow(2, cents / 1200);
        dts[v] = f / SAMPLE_RATE;
        phase[v] = rng();                    // random start phase (no coherent attack flam)
        pans[v] = ((v / Math.max(1, voices - 1)) - 0.5) * 2 * stereoSpread;
    }

    const gainPerVoice = 1 / Math.sqrt(voices); // equal-power sum
    const bl = waveform === 'sawtooth' || waveform === 'square';

    for (let i = 0; i < len; i++) {
        for (let v = 0; v < voices; v++) {
            let p = phase[v];
            const dt = dts[v];
            let sample;
            switch (waveform) {
                case 'square':
                    sample = (p < 0.5 ? 1 : -1) + polyBlep(p, dt) - polyBlep((p + 0.5) % 1, dt);
                    break;
                case 'triangle': sample = 4 * Math.abs(p - 0.5) - 1; break;
                case 'sine':     sample = Math.sin(TWO_PI * p); break;
                default:         sample = (2 * p - 1) - polyBlep(p, dt); break; // band-limited saw
            }
            sample *= gainPerVoice;
            if (left) {
                const angle = (pans[v] + 1) * 0.25 * Math.PI;
                left[i] += sample * Math.cos(angle);
                right[i] += sample * Math.sin(angle);
            } else {
                mono[i] += sample;
            }
            p += dt;
            if (p >= 1) p -= 1;
            phase[v] = p;
        }
    }

    // Optional fundamental-tracking high-pass (supersaw "mud" removal).
    if (opts.hpfTrack) {
        const hpf = Math.min(SAMPLE_RATE * 0.45, opts.hpfTrack * freq);
        if (left) { highPass2(left, hpf, 0.707); highPass2(right, hpf, 0.707); }
        else highPass2(mono, hpf, 0.707);
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
