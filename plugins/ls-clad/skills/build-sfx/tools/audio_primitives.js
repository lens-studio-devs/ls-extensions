// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// audio_primitives.js — Procedural audio synthesis primitives.
// 44.1 kHz mono Float32Array unless a function says otherwise. Stereo helpers at the bottom.

const SAMPLE_RATE = 44100;
const TWO_PI = 2 * Math.PI;

// ─── Oscillators ───────────────────────────────────────────
// Saw/square/triangle are band-limited via PolyBLEP: a 2-sample polynomial
// correction at each waveform discontinuity that cancels the aliased images.
// (Naive versions measured alias energy only ~19 dB under the harmonics at C5 —
// clearly audible grit.) Naive variants stay exported for callers that *want*
// aliasing as an effect; prefer bitcrush for retro color instead.

// PolyBLEP residual. t = normalized phase 0..1, dt = phase increment per sample.
function polyBlep(t, dt) {
    if (t < dt) {
        const x = t / dt;
        return x + x - x * x - 1;
    }
    if (t > 1 - dt) {
        const x = (t - 1) / dt;
        return x * x + x + x + 1;
    }
    return 0;
}

function sine(freq, duration, amplitude = 1.0) {
    const len = Math.floor(SAMPLE_RATE * duration);
    const out = new Float32Array(len);
    const step = (TWO_PI * freq) / SAMPLE_RATE;
    for (let i = 0; i < len; i++) out[i] = amplitude * Math.sin(step * i);
    return out;
}

function square(freq, duration, amplitude = 1.0) {
    const len = Math.floor(SAMPLE_RATE * duration);
    const out = new Float32Array(len);
    const dt = freq / SAMPLE_RATE;
    let phase = 0;
    for (let i = 0; i < len; i++) {
        let v = phase < 0.5 ? 1 : -1;
        v += polyBlep(phase, dt);                  // rising edge at phase 0
        v -= polyBlep((phase + 0.5) % 1, dt);      // falling edge at phase 0.5
        out[i] = amplitude * v;
        phase += dt;
        if (phase >= 1) phase -= 1;
    }
    return out;
}

function sawtooth(freq, duration, amplitude = 1.0) {
    const len = Math.floor(SAMPLE_RATE * duration);
    const out = new Float32Array(len);
    const dt = freq / SAMPLE_RATE;
    let phase = 0;
    for (let i = 0; i < len; i++) {
        let v = 2 * phase - 1;
        v -= polyBlep(phase, dt);
        out[i] = amplitude * v;
        phase += dt;
        if (phase >= 1) phase -= 1;
    }
    return out;
}

// Triangle stays naive on purpose: its harmonics roll off at k^-2, so aliasing
// is already ~24 dB below a saw's at the same fundamental — inaudible for the
// pitches this engine uses. A leaky-integrator band-limited triangle was tried
// and rejected: it injects DC and overshoots on short/swept buffers (it broke
// the 20 ms triangle-sweep "click"). If an exact triangle is ever needed, build
// it additively (sum odd partials at k^-2), not by integration.
function triangle(freq, duration, amplitude = 1.0) {
    const len = Math.floor(SAMPLE_RATE * duration);
    const out = new Float32Array(len);
    const period = SAMPLE_RATE / freq;
    for (let i = 0; i < len; i++) {
        const phase = (i % period) / period;
        out[i] = amplitude * (4 * Math.abs(phase - 0.5) - 1);
    }
    return out;
}

// Naive (non-band-limited) saw/square. Aliasing is intentional here — use only
// when the aliasing itself is the desired character (e.g. raw retro tones).
function squareNaive(freq, duration, amplitude = 1.0) {
    const len = Math.floor(SAMPLE_RATE * duration);
    const out = new Float32Array(len);
    const period = SAMPLE_RATE / freq;
    for (let i = 0; i < len; i++) out[i] = amplitude * ((i % period) < period / 2 ? 1 : -1);
    return out;
}

function sawtoothNaive(freq, duration, amplitude = 1.0) {
    const len = Math.floor(SAMPLE_RATE * duration);
    const out = new Float32Array(len);
    const period = SAMPLE_RATE / freq;
    for (let i = 0; i < len; i++) out[i] = amplitude * (2 * ((i % period) / period) - 1);
    return out;
}

function whiteNoise(duration, amplitude = 1.0, rng = Math.random) {
    const len = Math.floor(SAMPLE_RATE * duration);
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) out[i] = amplitude * (rng() * 2 - 1);
    return out;
}

// Pink noise via a 7-pole approximation that yields roughly -3 dB/octave. Sounds far more
// natural than white for ambient textures, wind, "room tone."
// Provenance: filter design by Paul Kellett (music-dsp list, ~2000; archived at
// musicdsp.org / firstpr.com.au, placed in the public domain by its author). The
// coefficients ARE the filter design (functional, uncopyrightable). PD — Apache-safe.
function pinkNoise(duration, amplitude = 1.0, rng = Math.random) {
    const len = Math.floor(SAMPLE_RATE * duration);
    const out = new Float32Array(len);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
        const w = rng() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.96900 * b2 + w * 0.1538520;
        b3 = 0.86650 * b3 + w * 0.3104856;
        b4 = 0.55000 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.0168980;
        const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
        b6 = w * 0.115926;
        out[i] = amplitude * pink * 0.11; // scale so peak sits near ±1
    }
    return out;
}

// Brown noise (integrated white). Deeper "rumble," good for distant thunder / wind cores.
function brownNoise(duration, amplitude = 1.0, rng = Math.random) {
    const len = Math.floor(SAMPLE_RATE * duration);
    const out = new Float32Array(len);
    let last = 0;
    for (let i = 0; i < len; i++) {
        const w = (rng() * 2 - 1) * 0.02;
        last = Math.max(-1, Math.min(1, last + w));
        out[i] = amplitude * last * 3.5;
    }
    return out;
}

// ─── Envelopes ─────────────────────────────────────────────

function adsr(samples, attack, decay, sustainLevel, release) {
    const len = samples.length;
    const aSamples = Math.floor(attack * SAMPLE_RATE);
    const dSamples = Math.floor(decay * SAMPLE_RATE);
    const rSamples = Math.floor(release * SAMPLE_RATE);
    const rStart = len - rSamples;
    for (let i = 0; i < len; i++) {
        let env;
        if (i < aSamples) env = i / aSamples;
        else if (i < aSamples + dSamples) {
            const t = (i - aSamples) / dSamples;
            env = 1 - t * (1 - sustainLevel);
        } else if (i < rStart) env = sustainLevel;
        else {
            const t = (i - rStart) / rSamples;
            env = sustainLevel * (1 - t);
        }
        samples[i] *= env;
    }
    return samples;
}

function adsrExp(samples, attack, decay, sustainLevel, release, curve = 3) {
    const len = samples.length;
    const aSamples = Math.max(1, Math.floor(attack * SAMPLE_RATE));
    const dSamples = Math.max(1, Math.floor(decay * SAMPLE_RATE));
    const rSamples = Math.max(1, Math.floor(release * SAMPLE_RATE));
    const rStart = len - rSamples;
    // Continuous-state envelope. After the attack, the level decays
    // exponentially TOWARD sustainLevel and keeps approaching it through the
    // "sustain" region (no boundary step); the release then takes the CURRENT
    // level to exactly 0. The previous sustainLevel·exp(-curve·t) release had
    // two bugs: a ~5% step at the decay→sustain boundary, and — fatally — with
    // sustainLevel=0 the entire release region rendered as digital silence, so
    // every sustain-0 impact/click recipe lost ~60% of its declared decay.
    const eC = Math.exp(-curve);
    const releaseNorm = (t) => (Math.exp(-curve * t) - eC) / (1 - eC); // 1→0 over t 0..1
    const envBody = (i) => {
        if (i < aSamples) {
            const t = i / aSamples;
            return (1 - Math.exp(-curve * 2 * t)) / (1 - Math.exp(-curve * 2));
        }
        const t = (i - aSamples) / dSamples; // keeps running past t=1 (sustain region)
        return sustainLevel + (1 - sustainLevel) * Math.exp(-curve * t);
    };
    const envAtRelease = rStart > 0 ? envBody(rStart) : 1;
    for (let i = 0; i < len; i++) {
        let env;
        if (i < rStart) env = envBody(i);
        else {
            const t = (i - rStart) / rSamples;
            env = envAtRelease * releaseNorm(t);
        }
        samples[i] *= env;
    }
    return samples;
}

function fadeIn(samples, duration) {
    const len = Math.min(Math.floor(duration * SAMPLE_RATE), samples.length);
    for (let i = 0; i < len; i++) samples[i] *= i / len;
    return samples;
}

function fadeOut(samples, duration) {
    const len = Math.min(Math.floor(duration * SAMPLE_RATE), samples.length);
    const start = samples.length - len;
    for (let i = 0; i < len; i++) samples[start + i] *= 1 - i / len;
    return samples;
}

// ─── Frequency Effects ─────────────────────────────────────

function sweep(startFreq, endFreq, duration, waveform = 'sine', curve = 'linear') {
    const len = Math.floor(SAMPLE_RATE * duration);
    const out = new Float32Array(len);
    let phase = 0;
    for (let i = 0; i < len; i++) {
        const t = i / len;
        const freq = (curve === 'exponential' && startFreq > 0 && endFreq > 0)
            ? startFreq * Math.pow(endFreq / startFreq, t)
            : startFreq + (endFreq - startFreq) * t;
        const dt = freq / SAMPLE_RATE;
        const p = ((phase % 1) + 1) % 1;
        switch (waveform) {
            case 'square': {
                let v = p < 0.5 ? 1 : -1;
                v += polyBlep(p, dt);
                v -= polyBlep((p + 0.5) % 1, dt);
                out[i] = v;
                break;
            }
            case 'sawtooth': {
                out[i] = 2 * p - 1 - polyBlep(p, dt);
                break;
            }
            case 'triangle': out[i] = 4 * Math.abs(p - 0.5) - 1; break; // naive: k^-2, minimal aliasing
            default:         out[i] = Math.sin(TWO_PI * phase); break;
        }
        phase += dt;
    }
    return out;
}

function vibrato(samples, rate = 5, depth = 0.005) {
    const len = samples.length;
    const out = new Float32Array(len);
    const maxDelay = Math.floor(depth * SAMPLE_RATE);
    for (let i = 0; i < len; i++) {
        const offset = maxDelay * Math.sin(TWO_PI * rate * i / SAMPLE_RATE);
        const readPos = i + offset;
        const idx = Math.floor(readPos);
        const frac = readPos - idx;
        const a = (idx >= 0 && idx < len) ? samples[idx] : 0;
        const b = (idx + 1 >= 0 && idx + 1 < len) ? samples[idx + 1] : 0;
        out[i] = a + frac * (b - a);
    }
    return out;
}

// ─── Amplitude Effects ─────────────────────────────────────

function tremolo(samples, rate = 5, depth = 0.5) {
    for (let i = 0; i < samples.length; i++) {
        const mod = 1 - depth * (0.5 + 0.5 * Math.sin(TWO_PI * rate * i / SAMPLE_RATE));
        samples[i] *= mod;
    }
    return samples;
}

function gain(samples, amount) {
    for (let i = 0; i < samples.length; i++) samples[i] *= amount;
    return samples;
}

// ─── Filters ───────────────────────────────────────────────

// One-pole low-pass. Very mild slope, good for "gentle warmth."
function lowPass(samples, cutoffFreq) {
    const rc = 1.0 / (TWO_PI * cutoffFreq);
    const dt = 1.0 / SAMPLE_RATE;
    const alpha = dt / (rc + dt);
    let prev = samples[0];
    for (let i = 1; i < samples.length; i++) {
        prev = prev + alpha * (samples[i] - prev);
        samples[i] = prev;
    }
    return samples;
}

function highPass(samples, cutoffFreq) {
    const rc = 1.0 / (TWO_PI * cutoffFreq);
    const dt = 1.0 / SAMPLE_RATE;
    const alpha = rc / (rc + dt);
    let prevIn = samples[0];
    let prevOut = samples[0];
    for (let i = 1; i < samples.length; i++) {
        const curr = samples[i];
        prevOut = alpha * (prevOut + curr - prevIn);
        prevIn = curr;
        samples[i] = prevOut;
    }
    return samples;
}

// Biquad filters below use the Robert Bristow-Johnson "Audio EQ Cookbook"
// coefficient formulas (w0/alpha parametrization; republished by W3C with the
// author's permission: w3.org/TR/audio-eq-cookbook). The formulas are mathematics
// (uncopyrightable); the implementations here are original. Apache-safe.

// Biquad low-pass (2-pole, 12 dB/oct). Q=0.707 is maximally flat, >1 resonant.
function lowPass2(samples, cutoffFreq, Q = 0.707) {
    const w0 = TWO_PI * cutoffFreq / SAMPLE_RATE;
    const sinW0 = Math.sin(w0), cosW0 = Math.cos(w0);
    const alpha = sinW0 / (2 * Q);
    const a0 = 1 + alpha;
    const nb0 = ((1 - cosW0) / 2) / a0;
    const nb1 = (1 - cosW0) / a0;
    const nb2 = nb0;
    const na1 = (-2 * cosW0) / a0;
    const na2 = (1 - alpha) / a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < samples.length; i++) {
        const x0 = samples[i];
        const y0 = nb0 * x0 + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;
        x2 = x1; x1 = x0; y2 = y1; y1 = y0;
        samples[i] = y0;
    }
    return samples;
}

// Biquad high-pass (2-pole).
function highPass2(samples, cutoffFreq, Q = 0.707) {
    const w0 = TWO_PI * cutoffFreq / SAMPLE_RATE;
    const sinW0 = Math.sin(w0), cosW0 = Math.cos(w0);
    const alpha = sinW0 / (2 * Q);
    const a0 = 1 + alpha;
    const nb0 = ((1 + cosW0) / 2) / a0;
    const nb1 = -(1 + cosW0) / a0;
    const nb2 = nb0;
    const na1 = (-2 * cosW0) / a0;
    const na2 = (1 - alpha) / a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < samples.length; i++) {
        const x0 = samples[i];
        const y0 = nb0 * x0 + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;
        x2 = x1; x1 = x0; y2 = y1; y1 = y0;
        samples[i] = y0;
    }
    return samples;
}

// Biquad band-pass (constant 0 dB peak gain). Q controls width.
function bandPass(samples, centerFreq, Q = 1.0) {
    const w0 = TWO_PI * centerFreq / SAMPLE_RATE;
    const sinW0 = Math.sin(w0), cosW0 = Math.cos(w0);
    const alpha = sinW0 / (2 * Q);
    const a0 = 1 + alpha;
    const nb0 = alpha / a0;
    const nb1 = 0;
    const nb2 = -alpha / a0;
    const na1 = (-2 * cosW0) / a0;
    const na2 = (1 - alpha) / a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < samples.length; i++) {
        const x0 = samples[i];
        const y0 = nb0 * x0 + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;
        x2 = x1; x1 = x0; y2 = y1; y1 = y0;
        samples[i] = y0;
    }
    return samples;
}

// Time-varying low-pass cutoff sweep.
function lowPassSweep(samples, startCutoff, endCutoff, Q = 0.707, curve = 'exponential') {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    const len = samples.length;
    const minCutoff = 20, maxCutoff = SAMPLE_RATE * 0.45;
    const sc = Math.max(minCutoff, Math.min(maxCutoff, startCutoff));
    const ec = Math.max(minCutoff, Math.min(maxCutoff, endCutoff));
    for (let i = 0; i < len; i++) {
        const t = i / len;
        const cutoff = (curve === 'exponential' && sc > 0 && ec > 0)
            ? sc * Math.pow(ec / sc, t)
            : sc + (ec - sc) * t;
        const w0 = TWO_PI * cutoff / SAMPLE_RATE;
        const sinW0 = Math.sin(w0), cosW0 = Math.cos(w0);
        const alpha = sinW0 / (2 * Q);
        const a0 = 1 + alpha;
        const nb0 = ((1 - cosW0) / 2) / a0;
        const nb1 = (1 - cosW0) / a0;
        const nb2 = nb0;
        const na1 = (-2 * cosW0) / a0;
        const na2 = (1 - alpha) / a0;
        const x0 = samples[i];
        const y0 = nb0 * x0 + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;
        x2 = x1; x1 = x0; y2 = y1; y1 = y0;
        samples[i] = y0;
    }
    return samples;
}

// Three-band vowel formant. vowel: 'a'|'e'|'i'|'o'|'u'. Adds "throat" to drones / pads.
// Center frequencies are standard acoustic-phonetics measurements (cf. Peterson &
// Barney 1952) — facts, uncopyrightable; the gain weights are tuned for this synth.
const VOWEL_FORMANTS = {
    a: [[700, 1.2], [1220, 0.9], [2600, 0.5]],
    e: [[400, 1.0], [2000, 1.1], [2550, 0.5]],
    i: [[300, 1.0], [2300, 1.0], [3000, 0.5]],
    o: [[450, 1.2], [800, 0.9], [2830, 0.4]],
    u: [[300, 1.2], [800, 0.8], [2240, 0.3]],
};
function vowelFormant(samples, vowel = 'a', mix = 0.7, Q = 8) {
    const formants = VOWEL_FORMANTS[vowel] || VOWEL_FORMANTS.a;
    const original = Float32Array.from(samples);
    const sum = new Float32Array(samples.length);
    for (const [freq, gainAmt] of formants) {
        const band = Float32Array.from(original);
        bandPass(band, freq, Q); // Q 8 = strong vowel color; 4-5 = soft/distant
        for (let i = 0; i < sum.length; i++) sum[i] += band[i] * gainAmt;
    }
    for (let i = 0; i < samples.length; i++) {
        samples[i] = samples[i] * (1 - mix) + sum[i] * mix;
    }
    return samples;
}

// ─── Mixing & Utilities ────────────────────────────────────

// Mix N Float32Arrays. Gains default to 1/N (equal mix).
function mix(samplesArray, gains) {
    const maxLen = Math.max(...samplesArray.map(s => s.length));
    const out = new Float32Array(maxLen);
    const g = gains || samplesArray.map(() => 1 / samplesArray.length);
    for (let ch = 0; ch < samplesArray.length; ch++) {
        const src = samplesArray[ch];
        const vol = g[ch] !== undefined ? g[ch] : 1 / samplesArray.length;
        for (let i = 0; i < src.length; i++) out[i] += src[i] * vol;
    }
    return out;
}

// Add `src` into `dst` starting at offset (in samples), scaled by `vol`.
// Extends nothing — caller must size `dst` appropriately.
function addInto(dst, src, offset = 0, vol = 1) {
    const end = Math.min(dst.length, offset + src.length);
    for (let i = Math.max(0, offset); i < end; i++) {
        dst[i] += src[i - offset] * vol;
    }
    return dst;
}

function concat(samplesArray) {
    const totalLen = samplesArray.reduce((sum, s) => sum + s.length, 0);
    const out = new Float32Array(totalLen);
    let offset = 0;
    for (const s of samplesArray) {
        out.set(s, offset);
        offset += s.length;
    }
    return out;
}

function silence(duration) {
    return new Float32Array(Math.floor(SAMPLE_RATE * duration));
}

function repeat(samples, times) {
    const arr = [];
    for (let i = 0; i < times; i++) arr.push(samples);
    return concat(arr);
}

function reverse(samples) {
    const out = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) out[i] = samples[samples.length - 1 - i];
    return out;
}

// Tape-style delay. Returns new array longer than input by the decay tail.
function delay(samples, delayTime = 0.2, feedback = 0.4, wetMix = 0.3) {
    const delaySamples = Math.floor(delayTime * SAMPLE_RATE);
    const tailLen = Math.floor(delaySamples * Math.ceil(Math.log(0.001) / Math.log(Math.abs(feedback) + 1e-10)));
    const outLen = samples.length + Math.min(Math.abs(tailLen), SAMPLE_RATE * 5);
    const out = new Float32Array(outLen);
    const buf = new Float32Array(outLen);
    for (let i = 0; i < samples.length; i++) buf[i] = samples[i];
    for (let i = delaySamples; i < outLen; i++) buf[i] += buf[i - delaySamples] * feedback;
    for (let i = 0; i < outLen; i++) {
        const dry = i < samples.length ? samples[i] : 0;
        out[i] = dry * (1 - wetMix) + buf[i] * wetMix;
    }
    return out;
}

function distortion(samples, amount = 10) {
    const out = new Float32Array(samples.length);
    const k = amount;
    for (let i = 0; i < samples.length; i++) {
        const x = samples[i];
        out[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    return out;
}

function bitcrush(samples, bits = 8) {
    const out = new Float32Array(samples.length);
    const levels = Math.pow(2, bits);
    for (let i = 0; i < samples.length; i++) {
        out[i] = Math.round(samples[i] * levels) / levels;
    }
    return out;
}

// Feed-forward, log-domain dynamics compressor with soft knee and a smooth
// branching one-pole on the gain-reduction signal (Giannoulis, Massberg & Reiss,
// "Digital Dynamic Range Compressor Design — A Tutorial and Analysis", JAES 2012).
// Unlike a tanh soft-clipper (which distorts continuously regardless of level and
// has no time constants), this rides gain with real attack/release and only acts
// above the threshold. Mutates in place.
//   opts.threshold (dBFS, default -18), opts.ratio (default 3), opts.knee (dB, 6),
//   opts.attack/release (seconds), opts.makeup (dB or 'auto'),
//   opts.detector (Float32Array — sidechain key signal; defaults to `samples`).
function compress(samples, opts = {}) {
    const threshold = opts.threshold !== undefined ? opts.threshold : -18;
    const ratio = opts.ratio !== undefined ? opts.ratio : 3;
    const knee = opts.knee !== undefined ? opts.knee : 6;
    const attack = opts.attack !== undefined ? opts.attack : 0.01;
    const release = opts.release !== undefined ? opts.release : 0.12;
    const det = opts.detector || samples;
    const aA = Math.exp(-Math.log(9) / (SAMPLE_RATE * Math.max(1e-4, attack)));
    const aR = Math.exp(-Math.log(9) / (SAMPLE_RATE * Math.max(1e-4, release)));
    // Static gain-computer curve (returns scaled level in dB).
    const curve = (xdB) => {
        if (xdB < threshold - knee / 2) return xdB;
        if (xdB <= threshold + knee / 2) {
            const d = xdB - threshold + knee / 2;
            return xdB + (1 / ratio - 1) * d * d / (2 * knee);
        }
        return threshold + (xdB - threshold) / ratio;
    };
    let M = 0;
    if (opts.makeup === 'auto') M = -(curve(0));     // normalize 0 dBFS in → 0 dBFS out
    else if (typeof opts.makeup === 'number') M = opts.makeup;
    let gs = 0; // smoothed gain reduction (dB, ≤ 0)
    for (let i = 0; i < samples.length; i++) {
        const xdB = 20 * Math.log10(Math.max(Math.abs(det[i]), 1e-6));
        const gc = curve(xdB) - xdB; // ≤ 0
        gs = (gc < gs ? aA : aR) * gs + (gc < gs ? (1 - aA) : (1 - aR)) * gc;
        samples[i] *= Math.pow(10, (gs + M) / 20);
    }
    return samples;
}

function softLimit(samples, threshold = 0.5, makeup = 1.0) {
    for (let i = 0; i < samples.length; i++) {
        const x = samples[i] * makeup;
        if (Math.abs(x) > threshold) {
            const sign = x >= 0 ? 1 : -1;
            const excess = (Math.abs(x) - threshold) / (1 - threshold);
            samples[i] = sign * (threshold + (1 - threshold) * Math.tanh(excess));
        } else {
            samples[i] = x;
        }
    }
    return samples;
}

function normalizeRMS(samples, targetRMS = 0.15, windowSec = 0.3, peakCeiling = 0.95) {
    const winLen = Math.floor(windowSec * SAMPLE_RATE);
    let maxRMS = 0;
    for (let start = 0; start + winLen <= samples.length; start += Math.floor(winLen / 2)) {
        let sumSq = 0;
        for (let i = start; i < start + winLen; i++) sumSq += samples[i] * samples[i];
        const rms = Math.sqrt(sumSq / winLen);
        if (rms > maxRMS) maxRMS = rms;
    }
    if (maxRMS <= 0) return samples;
    let scale = targetRMS / maxRMS;
    let peak = 0;
    for (let i = 0; i < samples.length; i++) {
        const abs = Math.abs(samples[i]);
        if (abs > peak) peak = abs;
    }
    if (peak * scale > peakCeiling) scale = peakCeiling / peak;
    for (let i = 0; i < samples.length; i++) samples[i] *= scale;
    return samples;
}

function normalizePeak(samples, peakCeiling = 0.95) {
    let peak = 0;
    for (let i = 0; i < samples.length; i++) {
        const abs = Math.abs(samples[i]);
        if (abs > peak) peak = abs;
    }
    if (peak <= 0) return samples;
    const scale = peakCeiling / peak;
    for (let i = 0; i < samples.length; i++) samples[i] *= scale;
    return samples;
}

// Remove DC offset (subtract running mean). Defends against gradual filter drift / asymmetric
// rectification (the silent killer that makes a buffer sound "stuck").
function removeDC(samples) {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i];
    const mean = sum / samples.length;
    if (Math.abs(mean) < 1e-6) return samples;
    for (let i = 0; i < samples.length; i++) samples[i] -= mean;
    return samples;
}

// ─── FFT (radix-2, in-place Cooley–Tukey) ──────────────────
// Plain JS, no external deps. Inputs are paired Float64Arrays for real/imaginary parts;
// length MUST be a power of two. Used by convolve() and is also exported for callers that
// want to do their own spectral work (e.g. test_battery.js spectral checks).

function _fftRadix2(real, imag) {
    const N = real.length;
    if (N <= 1) return;
    if ((N & (N - 1)) !== 0) throw new Error(`FFT requires power-of-2 length, got ${N}`);
    // Bit-reversal permutation
    let j = 0;
    for (let i = 0; i < N; i++) {
        if (i < j) {
            const tr = real[i]; real[i] = real[j]; real[j] = tr;
            const ti = imag[i]; imag[i] = imag[j]; imag[j] = ti;
        }
        let k = N >> 1;
        while (k > 0 && k <= j) { j -= k; k >>= 1; }
        j += k;
    }
    // Butterflies
    for (let size = 2; size <= N; size <<= 1) {
        const halfSize = size >> 1;
        const phaseStep = -2 * Math.PI / size;
        for (let i = 0; i < N; i += size) {
            for (let k = 0; k < halfSize; k++) {
                const angle = phaseStep * k;
                const c = Math.cos(angle);
                const s = Math.sin(angle);
                const l = i + k + halfSize;
                const tre = real[l] * c - imag[l] * s;
                const tim = real[l] * s + imag[l] * c;
                real[l] = real[i + k] - tre;
                imag[l] = imag[i + k] - tim;
                real[i + k] += tre;
                imag[i + k] += tim;
            }
        }
    }
}

function fft(real, imag) { _fftRadix2(real, imag); }

function ifft(real, imag) {
    const N = real.length;
    for (let i = 0; i < N; i++) imag[i] = -imag[i];
    _fftRadix2(real, imag);
    const invN = 1 / N;
    for (let i = 0; i < N; i++) {
        real[i] *= invN;
        imag[i] = -imag[i] * invN;
    }
}

// ─── Convolution ────────────────────────────────────────────
// Linear convolution via FFT (overlap-save not needed at our sizes — one big FFT pair
// each way is faster on Node than overlap-add for finite signals up to ~10 s at 44.1 kHz).
// O((N+M)·log(N+M)) vs. the previous time-domain O(N·M). Speedup vs. naive is ~50× for
// 7 s signal × 1 s IR; the music pipeline depends on this for usable render times.
function convolve(samples, ir, wet = 1.0) {
    const sLen = samples.length;
    const iLen = ir.length;
    const outLen = sLen + iLen - 1;
    // Round up to next power of 2
    let N = 1;
    while (N < outLen) N <<= 1;
    const sRe = new Float64Array(N);
    const sIm = new Float64Array(N);
    const iRe = new Float64Array(N);
    const iIm = new Float64Array(N);
    for (let i = 0; i < sLen; i++) sRe[i] = samples[i];
    for (let i = 0; i < iLen; i++) iRe[i] = ir[i];
    _fftRadix2(sRe, sIm);
    _fftRadix2(iRe, iIm);
    // Pointwise complex multiply: (sRe + j·sIm) * (iRe + j·iIm)
    for (let i = 0; i < N; i++) {
        const r = sRe[i] * iRe[i] - sIm[i] * iIm[i];
        const m = sRe[i] * iIm[i] + sIm[i] * iRe[i];
        sRe[i] = r;
        sIm[i] = m;
    }
    // Inverse FFT
    for (let i = 0; i < N; i++) sIm[i] = -sIm[i];
    _fftRadix2(sRe, sIm);
    const invN = 1 / N;
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) out[i] = sRe[i] * invN;
    if (wet === 1.0) return out;
    for (let i = 0; i < sLen; i++) out[i] = out[i] * wet + samples[i] * (1 - wet);
    return out;
}

// Naive time-domain convolution. Kept exported for tests / sparse inputs where the
// O(N·M) cost is tiny (e.g. an impulse train convolved with a short response).
function convolveDirect(samples, ir, wet = 1.0) {
    const sLen = samples.length;
    const iLen = ir.length;
    const out = new Float32Array(sLen + iLen - 1);
    for (let i = 0; i < sLen; i++) {
        const s = samples[i];
        if (s === 0) continue;
        for (let j = 0; j < iLen; j++) out[i + j] += s * ir[j];
    }
    if (wet === 1.0) return out;
    for (let i = 0; i < sLen; i++) out[i] = out[i] * wet + samples[i] * (1 - wet);
    return out;
}

// ─── Stereo Helpers ────────────────────────────────────────

// Pan a mono buffer with constant-power panning. pan: -1 (full left) to +1 (full right).
function panMono(samples, pan = 0) {
    const p = Math.max(-1, Math.min(1, pan));
    const angle = (p + 1) * 0.25 * Math.PI; // 0..π/2
    const gL = Math.cos(angle);
    const gR = Math.sin(angle);
    const left = new Float32Array(samples.length);
    const right = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
        left[i] = samples[i] * gL;
        right[i] = samples[i] * gR;
    }
    return { left, right };
}

function mixStereo(stereosArray) {
    const maxLen = Math.max(...stereosArray.map(s => s.left.length));
    const left = new Float32Array(maxLen);
    const right = new Float32Array(maxLen);
    for (const s of stereosArray) {
        for (let i = 0; i < s.left.length; i++) {
            left[i] += s.left[i];
            right[i] += s.right[i];
        }
    }
    return { left, right };
}

function stereoFromMono(samples) {
    return { left: Float32Array.from(samples), right: Float32Array.from(samples) };
}

function monoFromStereo(stereo) {
    const len = Math.max(stereo.left.length, stereo.right.length);
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) {
        out[i] = ((stereo.left[i] || 0) + (stereo.right[i] || 0)) * 0.5;
    }
    return out;
}

// Mid/Side stereo width. width 0 = mono, 1 = unchanged, >1 = wider. Optionally
// keeps low frequencies mono (lowMonoHz) so the bass stays centered/phase-coherent.
function stereoWidth(stereo, width = 1.0, lowMonoHz = 0) {
    const L = stereo.left, R = stereo.right;
    const n = Math.min(L.length, R.length);
    let sideLow = null;
    if (lowMonoHz > 0) {
        // Extract the low-frequency content of the side signal to leave it mono.
        sideLow = new Float32Array(n);
        for (let i = 0; i < n; i++) sideLow[i] = (L[i] - R[i]) * 0.5;
        lowPass2(sideLow, lowMonoHz, 0.707);
    }
    for (let i = 0; i < n; i++) {
        const m = (L[i] + R[i]) * 0.5;
        let s = (L[i] - R[i]) * 0.5;
        s = s * width - (sideLow ? sideLow[i] * (width - 1) : 0); // don't widen the lows
        L[i] = m + s;
        R[i] = m - s;
    }
    return stereo;
}

// Ensemble chorus via modulated delay lines (Dattorro, "Effect Design Part 2",
// JAES 1997; BBD chorus prior art). `voices` modulated taps with LFO phases spread
// across the cycle make a single oscillator read as a section — the lush treatment
// for pads/strings/choir, and a stereo widener. Mono in → stereo out.
//   opts.voices (default 3), opts.rateHz (0.5–1.5 typical), opts.depthMs (±, ~1–4),
//   opts.delayMs (nominal, ~5), opts.mix (0..1 wet), opts.seed.
function chorus(samples, opts = {}) {
    const voices = opts.voices || 3;
    const rate = opts.rateHz !== undefined ? opts.rateHz : 0.8;
    const depthMs = opts.depthMs !== undefined ? opts.depthMs : 2.5;
    const delayMs = opts.delayMs !== undefined ? opts.delayMs : 5;
    const mix = opts.mix !== undefined ? opts.mix : 0.4;
    const n = samples.length;
    const left = new Float32Array(n);
    const right = new Float32Array(n);
    const nominal = delayMs * 0.001 * SAMPLE_RATE;
    const depth = depthMs * 0.001 * SAMPLE_RATE;
    const maxDelay = Math.ceil(nominal + depth) + 4;
    for (let v = 0; v < voices; v++) {
        const phase0 = (v / voices) * TWO_PI;          // spread LFO phases
        const rateV = rate * (1 + (v - (voices - 1) / 2) * 0.12); // slight per-voice rate spread
        const pan = voices > 1 ? (v / (voices - 1)) * 2 - 1 : 0;
        const gL = Math.cos((pan + 1) * 0.25 * Math.PI);
        const gR = Math.sin((pan + 1) * 0.25 * Math.PI);
        for (let i = 0; i < n; i++) {
            const lfo = Math.sin(phase0 + TWO_PI * rateV * i / SAMPLE_RATE);
            const d = nominal + lfo * depth;
            const readPos = i - d;
            let s = 0;
            if (readPos >= 0) {
                const idx = Math.floor(readPos);
                const frac = readPos - idx;
                const a = samples[idx] || 0;
                const b = samples[idx + 1] || 0;
                s = a + frac * (b - a);
            }
            left[i] += s * gL;
            right[i] += s * gR;
        }
    }
    const wetScale = mix / Math.sqrt(voices);
    for (let i = 0; i < n; i++) {
        const dry = samples[i] * (1 - mix);
        left[i] = dry + left[i] * wetScale;
        right[i] = dry + right[i] * wetScale;
    }
    return { left, right };
}

module.exports = {
    SAMPLE_RATE, TWO_PI,
    // Oscillators
    sine, square, sawtooth, triangle, whiteNoise, pinkNoise, brownNoise,
    squareNaive, sawtoothNaive, polyBlep,
    // Envelopes
    adsr, adsrExp, fadeIn, fadeOut,
    // Frequency effects
    sweep, vibrato,
    // Amplitude effects
    tremolo, gain, compress, softLimit, normalizeRMS, normalizePeak, removeDC,
    // Filters
    lowPass, highPass, lowPass2, highPass2, bandPass, lowPassSweep, vowelFormant,
    // Mixing & utilities
    mix, addInto, concat, silence, repeat, reverse, delay, distortion, bitcrush,
    // FFT + convolution
    fft, ifft, convolve, convolveDirect,
    // Stereo
    panMono, mixStereo, stereoFromMono, monoFromStereo, stereoWidth, chorus,
};
