// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// mix_bus.js — Per-voice / per-track FX chain and master limiter.
// applyFx() is the one entry point per-track and per-final-mix. The fixed order is the entire
// point: HPF before LPF before BPF stops cumulative filter resonance from compounding;
// distortion before reverb keeps the reverb tail clean; compressor before final gain prevents
// overload pumping. Skipping a key means "don't apply that step" — no silent defaults.

const {
    SAMPLE_RATE,
    lowPass2, highPass2, bandPass, vowelFormant,
    distortion, bitcrush, delay, gain, panMono,
    softLimit, normalizeRMS, normalizePeak, removeDC,
} = require('./audio_primitives');
const { reverb: irReverb, reverbStereo, PRESETS: REVERB_PRESETS } = require('./ir_generator');

// ─── Per-voice / per-track FX chain ────────────────────────
// fx may include any subset of:
//   { hpf, lpf, bpf, vowel, distort, crush, phaser, delay, reverb, compressor, gain, pan }
// Each value is the parameter(s) for that effect; null/undefined skips it.
//   hpf:        { freq, Q }            or freq:number
//   lpf:        { freq, Q }            or freq:number
//   bpf:        { center, Q }          or center:number
//   vowel:      'a'|'e'|'i'|'o'|'u'    or { vowel, mix }
//   distort:    amount:number          or { amount }
//   crush:      bits:number            or { bits }
//   phaser:     { rate, depth, stages }
//   delay:      { time, feedback, wet }
//   reverb:     { duration, roomSize, hfDamping, wet }  or preset name string
//   compressor: { threshold, ratio, makeup }            or default
//   gain:       linear gain multiplier
//   pan:        -1..+1 (returns stereo)
// Returns either Float32Array (mono) or { left, right } (stereo). When `pan` or any stereo-
// returning effect (e.g., reverb) is present the result is stereo.
function applyFx(input, fx) {
    if (!fx) return input;
    // Normalize input
    let buf = (input && input.left) ? input : Float32Array.from(input);
    let isStereo = !!(input && input.left);

    function mono() {
        return isStereo
            ? (() => { const out = new Float32Array(buf.left.length); for (let i = 0; i < out.length; i++) out[i] = (buf.left[i] + buf.right[i]) * 0.5; return out; })()
            : buf;
    }
    function toMonoInPlace() {
        if (!isStereo) return;
        const m = new Float32Array(buf.left.length);
        for (let i = 0; i < m.length; i++) m[i] = (buf.left[i] + buf.right[i]) * 0.5;
        buf = m;
        isStereo = false;
    }
    function toStereoInPlace() {
        if (isStereo) return;
        buf = { left: Float32Array.from(buf), right: Float32Array.from(buf) };
        isStereo = true;
    }

    // 1. HPF
    if (fx.hpf !== undefined && fx.hpf !== null) {
        const freq = typeof fx.hpf === 'number' ? fx.hpf : fx.hpf.freq;
        const Q = typeof fx.hpf === 'number' ? 0.707 : (fx.hpf.Q || 0.707);
        if (isStereo) { highPass2(buf.left, freq, Q); highPass2(buf.right, freq, Q); }
        else highPass2(buf, freq, Q);
    }
    // 2. LPF
    if (fx.lpf !== undefined && fx.lpf !== null) {
        const freq = typeof fx.lpf === 'number' ? fx.lpf : fx.lpf.freq;
        const Q = typeof fx.lpf === 'number' ? 0.707 : (fx.lpf.Q || 0.707);
        if (isStereo) { lowPass2(buf.left, freq, Q); lowPass2(buf.right, freq, Q); }
        else lowPass2(buf, freq, Q);
    }
    // 3. BPF
    if (fx.bpf !== undefined && fx.bpf !== null) {
        const center = typeof fx.bpf === 'number' ? fx.bpf : fx.bpf.center;
        const Q = typeof fx.bpf === 'number' ? 1 : (fx.bpf.Q || 1);
        if (isStereo) { bandPass(buf.left, center, Q); bandPass(buf.right, center, Q); }
        else bandPass(buf, center, Q);
    }
    // 4. Vowel formant
    if (fx.vowel) {
        const v = typeof fx.vowel === 'string' ? fx.vowel : fx.vowel.vowel;
        const m = typeof fx.vowel === 'string' ? 0.7 : (fx.vowel.mix !== undefined ? fx.vowel.mix : 0.7);
        if (isStereo) { vowelFormant(buf.left, v, m); vowelFormant(buf.right, v, m); }
        else vowelFormant(buf, v, m);
    }
    // 5. Distortion (allocates)
    if (fx.distort) {
        const amt = typeof fx.distort === 'number' ? fx.distort : fx.distort.amount;
        if (isStereo) {
            const L = distortion(buf.left, amt);
            const R = distortion(buf.right, amt);
            buf = { left: L, right: R };
        } else {
            buf = distortion(buf, amt);
        }
    }
    // 6. Bitcrush (allocates)
    if (fx.crush) {
        const bits = typeof fx.crush === 'number' ? fx.crush : fx.crush.bits;
        if (isStereo) {
            buf = { left: bitcrush(buf.left, bits), right: bitcrush(buf.right, bits) };
        } else {
            buf = bitcrush(buf, bits);
        }
    }
    // 7. Phaser — sweeping notch via allpass approximation
    if (fx.phaser) {
        const rate = fx.phaser.rate || 0.5;
        const depth = fx.phaser.depth !== undefined ? fx.phaser.depth : 0.6;
        const stages = fx.phaser.stages || 4;
        const phaseFn = (samples) => {
            const out = Float32Array.from(samples);
            let lfoPhase = 0;
            const lfoStep = 2 * Math.PI * rate / SAMPLE_RATE;
            // Cascade of 1st-order allpass with time-varying cutoff
            const ap = new Float32Array(stages * 2); // [x_prev, y_prev] per stage
            for (let i = 0; i < out.length; i++) {
                const lfo = 0.5 + 0.5 * Math.sin(lfoPhase);
                const cutoff = 400 + lfo * 2400 * depth;
                const w = Math.tan(Math.PI * cutoff / SAMPLE_RATE);
                const a = (w - 1) / (w + 1);
                let x = out[i];
                for (let s = 0; s < stages; s++) {
                    const xp = ap[s * 2];
                    const yp = ap[s * 2 + 1];
                    const y = a * x + xp - a * yp;
                    ap[s * 2] = x;
                    ap[s * 2 + 1] = y;
                    x = y;
                }
                out[i] = out[i] * 0.5 + x * 0.5;
                lfoPhase += lfoStep;
            }
            return out;
        };
        if (isStereo) buf = { left: phaseFn(buf.left), right: phaseFn(buf.right) };
        else buf = phaseFn(buf);
    }
    // 8. Delay (allocates, may extend length)
    if (fx.delay) {
        const time = fx.delay.time || 0.25;
        const feedback = fx.delay.feedback !== undefined ? fx.delay.feedback : 0.35;
        const wet = fx.delay.wet !== undefined ? fx.delay.wet : 0.3;
        if (isStereo) {
            buf = { left: delay(buf.left, time, feedback, wet), right: delay(buf.right, time, feedback, wet) };
        } else {
            buf = delay(buf, time, feedback, wet);
        }
    }
    // 9. Reverb (always promotes to stereo)
    if (fx.reverb) {
        let rvOpts;
        if (typeof fx.reverb === 'string') {
            rvOpts = Object.assign({}, REVERB_PRESETS[fx.reverb] || REVERB_PRESETS.mediumRoom);
        } else {
            rvOpts = Object.assign({}, fx.reverb);
        }
        if (rvOpts.wet === undefined) rvOpts.wet = 0.35;
        buf = isStereo ? reverbStereo(buf, rvOpts) : irReverb(buf, rvOpts);
        isStereo = true;
    }
    // 10. Compressor — soft limiter, transparent at low thresholds
    if (fx.compressor) {
        const threshold = fx.compressor.threshold !== undefined ? fx.compressor.threshold : 0.5;
        const makeup = fx.compressor.makeup !== undefined ? fx.compressor.makeup : 1.0;
        if (isStereo) { softLimit(buf.left, threshold, makeup); softLimit(buf.right, threshold, makeup); }
        else softLimit(buf, threshold, makeup);
    }
    // 11. Gain
    if (fx.gain !== undefined && fx.gain !== null && fx.gain !== 1) {
        if (isStereo) { gain(buf.left, fx.gain); gain(buf.right, fx.gain); }
        else gain(buf, fx.gain);
    }
    // 12. Pan (promotes to stereo)
    if (fx.pan !== undefined && fx.pan !== null && fx.pan !== 0) {
        if (isStereo) {
            // Re-pan stereo: collapse to mono first then re-pan
            toMonoInPlace();
        }
        const panned = panMono(buf, fx.pan);
        buf = panned;
        isStereo = true;
    }
    return buf;
}

// ─── Master chain ──────────────────────────────────────────
// Final pass before WAV write. Removes DC, soft-clips, normalizes.
// opts:
//   normalize: 'peak' (default — preserves dynamics) | 'rms' | 'off'
//   targetRMS: 0.15 (only if normalize === 'rms')
//   peakCeiling: 0.95
//   headroom: 0.0..0.2 — extra dB of softclip below peak
function masterChain(input, opts = {}) {
    const normalize = opts.normalize || 'peak';
    const peakCeiling = opts.peakCeiling !== undefined ? opts.peakCeiling : 0.95;
    const targetRMS = opts.targetRMS !== undefined ? opts.targetRMS : 0.15;
    const isStereo = !!(input && input.left);

    if (isStereo) {
        removeDC(input.left); removeDC(input.right);
        softLimit(input.left, peakCeiling, 1); softLimit(input.right, peakCeiling, 1);
        if (normalize === 'peak') {
            // Find combined peak so the stereo balance stays intact
            let peak = 0;
            for (let i = 0; i < input.left.length; i++) {
                const a = Math.abs(input.left[i]);
                const b = Math.abs(input.right[i]);
                if (a > peak) peak = a;
                if (b > peak) peak = b;
            }
            if (peak > 0) {
                const scale = peakCeiling / peak;
                for (let i = 0; i < input.left.length; i++) {
                    input.left[i] *= scale;
                    input.right[i] *= scale;
                }
            }
        } else if (normalize === 'rms') {
            normalizeRMS(input.left, targetRMS, 0.3, peakCeiling);
            normalizeRMS(input.right, targetRMS, 0.3, peakCeiling);
        }
        return input;
    }
    removeDC(input);
    softLimit(input, peakCeiling, 1);
    if (normalize === 'peak') normalizePeak(input, peakCeiling);
    else if (normalize === 'rms') normalizeRMS(input, targetRMS, 0.3, peakCeiling);
    return input;
}

module.exports = {
    applyFx,
    masterChain,
    REVERB_PRESETS,
};
