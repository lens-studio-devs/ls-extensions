// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// granular.js — Grain-cloud textural synthesis.
// Builds large textures (wind, rain, room ambience, crowd murmur) by scattering hundreds of
// short windowed "grains" of a source signal. Each grain has its own start time, pitch shift,
// amplitude, and stereo position. The collective result is far richer than any single filter
// chain on white noise.

const {
    SAMPLE_RATE, TWO_PI, sine, whiteNoise, pinkNoise, brownNoise, sawtooth,
    lowPass2, highPass2, bandPass, panMono, mixStereo,
    addInto, gain, removeDC, adsrExp, vowelFormant,
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
    // No fixed default: an omitted seed means a fresh texture each run (two
    // lenses shouldn't share bit-identical rain). Pass a seed to reproduce one.
    const seed = opts.seed !== undefined ? opts.seed : Math.floor(Math.random() * 1e9);
    const rng = mulberry32(seed);

    const src = typeof opts.source === 'string'
        ? defaultSource(opts.source, mulberry32(seed * 3))
        : (opts.source instanceof Float32Array ? opts.source : defaultSource('white', mulberry32(seed * 3)));

    const totalSamples = Math.floor(duration * SAMPLE_RATE);
    const left = new Float32Array(totalSamples);
    const right = new Float32Array(totalSamples);
    const grainSamples = Math.max(4, Math.floor(grainSizeMs * 0.001 * SAMPLE_RATE));
    const grainHalf = grainSamples / 2;
    const grainCount = Math.max(1, Math.floor(duration * density));
    const window = raisedCosineWindow(grainSamples);

    // Density compensation: when many grains overlap, their windowed sum grows ~
    // as sqrt(overlap), overlap ≈ density·grainSizeSec. Without this, a dense cloud
    // (rain) clipped at >1.7 while a sparse one (wind) sat near 0.15 — unusable
    // together. Normalizing by sqrt(overlap) makes loudness roughly density-independent.
    const overlap = density * (grainSamples / SAMPLE_RATE);
    const norm = 1 / Math.sqrt(Math.max(1, overlap));

    // Per-grain filtering. When pitchSpread is set, the filter center is shifted
    // per grain by the same ratio as the pitch — otherwise the static filter erased
    // any per-grain pitch variation (resampled noise is statistically unchanged), so
    // pitchSpread was inaudible on noise sources and every texture sat at one pitch.
    function applyFilter(buf, centerMult) {
        if (!opts.filter) return buf;
        const out = Float32Array.from(buf);
        const f = opts.filter.freq * centerMult;
        if (opts.filter.type === 'lp') lowPass2(out, Math.min(f, SAMPLE_RATE * 0.45), opts.filter.Q || 0.7);
        else if (opts.filter.type === 'hp') highPass2(out, Math.min(f, SAMPLE_RATE * 0.45), opts.filter.Q || 0.7);
        else if (opts.filter.type === 'bp') bandPass(out, Math.min(f, SAMPLE_RATE * 0.45), opts.filter.Q || 1);
        return out;
    }

    for (let g = 0; g < grainCount; g++) {
        const pitchSemis = (rng() * 2 - 1) * pitchSpread;
        const rate = Math.pow(2, pitchSemis / 12);
        const amp = (1 - rng() * ampJitter) * norm;
        const pan = (rng() * 2 - 1) * panSpread;

        // Confine the grain center so the whole window fits inside the buffer — a
        // grain truncated mid-window leaves a step at the boundary (this was the
        // 0.46 end-of-buffer click in rain). Edges lose a little density; inaudible.
        const tCenter = grainHalf / SAMPLE_RATE + rng() * Math.max(0, duration - grainSamples / SAMPLE_RATE);
        const startIdx = Math.floor(tCenter * SAMPLE_RATE - grainHalf);
        if (startIdx < 0 || startIdx + grainSamples > totalSamples) continue;

        // Build grain — read from src at fractional rate.
        const grain = new Float32Array(grainSamples);
        const srcStart = rng() * Math.max(0, src.length - grainSamples * rate - 1);
        for (let i = 0; i < grainSamples; i++) {
            grain[i] = readFrac(src, srcStart + i * rate);
        }
        // Filter center tracks the grain's pitch shift (only matters for noise sources).
        const filtered = applyFilter(grain, pitchSpread > 0 ? rate : 1);
        // Window AFTER filtering so the grain is exactly zero at both ends — a
        // highpass/bandpass rings energy back into a pre-windowed grain's tail,
        // which produced inter-grain clicks (and the rain tail click).
        for (let i = 0; i < grainSamples; i++) filtered[i] *= window[i];

        // Constant-power pan
        const angle = (pan + 1) * 0.25 * Math.PI;
        const gL = Math.cos(angle) * amp;
        const gR = Math.sin(angle) * amp;

        const end = startIdx + grainSamples;
        for (let i = startIdx; i < end; i++) {
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

    // Brown/pink sources through a lowpass pass DC; strip it so output is centered
    // (the master chain would too, but presets are often used/measured raw).
    removeDC(left); removeDC(right);

    // Optional peak normalization to a target — makes preset levels predictable
    // and clip-proof regardless of density/source amplitude.
    if (opts.normalize) {
        let pk = 0;
        for (let i = 0; i < totalSamples; i++) pk = Math.max(pk, Math.abs(left[i]), Math.abs(right[i]));
        if (pk > 0) {
            const s = opts.normalize / pk;
            for (let i = 0; i < totalSamples; i++) { left[i] *= s; right[i] *= s; }
        }
    }
    // Edge fades as a final guard against boundary discontinuity. Raised-cosine
    // and long enough (12 ms) that the final few ms are deeply attenuated — dense
    // transient textures (rain) otherwise leave a sharp grain at the very edge.
    const fade = Math.min(Math.floor(0.012 * SAMPLE_RATE), totalSamples >> 1);
    for (let i = 0; i < fade; i++) {
        const f = 0.5 * (1 - Math.cos(Math.PI * i / fade));
        left[i] *= f; right[i] *= f;
        left[totalSamples - 1 - i] *= f; right[totalSamples - 1 - i] *= f;
    }

    return { left, right };
}

// ─── Texture presets ──────────────────────────────────────
//
// Rewritten 2026-07: the old presets were all "grainCloud + one static filter",
// which reads as processed noise, not weather/spaces (rain = resonant frying,
// wind = constantly-ringing whistle band, crowd = noise pulses, thunder =
// muffled blobs). Each texture is now dedicated DSP modeled on how the real
// phenomenon behaves. grainCloud itself is unchanged and still the right tool
// for debris/crunch/shimmer layers.

// Shared helpers for the presets.
function normalizeStereo(st, target) {
    let pk = 0;
    for (let i = 0; i < st.left.length; i++) pk = Math.max(pk, Math.abs(st.left[i]), Math.abs(st.right[i]));
    if (pk > 0) { const s = target / pk; gain(st.left, s); gain(st.right, s); }
    return st;
}
function edgeFades(st, sec = 0.03) {
    const n = st.left.length;
    const fade = Math.min(Math.floor(sec * SAMPLE_RATE), n >> 1);
    for (let i = 0; i < fade; i++) {
        const f = 0.5 * (1 - Math.cos(Math.PI * i / fade));
        st.left[i] *= f; st.right[i] *= f;
        st.left[n - 1 - i] *= f; st.right[n - 1 - i] *= f;
    }
    return st;
}

// Wind: decorrelated pink noise through a time-varying lowpass whose CUTOFF and
// LEVEL both follow the gust envelope (a stronger gust is louder AND brighter —
// that coupling is what makes it read as air, not filtered noise). A whistle
// resonance is gated to gust PEAKS only, instead of ringing constantly.
function windTexture(duration = 3.0, intensity = 0.5, opts = {}) {
    const seed = opts.seed !== undefined ? opts.seed : Math.floor(Math.random() * 1e9);
    const n = Math.floor(duration * SAMPLE_RATE);
    const gustSlow = smoothNoise1D(seed * 7 + 1, 0.22);   // main gusting ~0.2 Hz
    const gustFast = smoothNoise1D(seed * 7 + 2, 1.3);    // small flutter on top
    const chans = [];
    for (let ch = 0; ch < 2; ch++) {
        const noise = pinkNoise(duration, 1.0, mulberry32(seed + ch * 977));
        const out = new Float32Array(n);
        let lp1 = 0, lp2 = 0;
        for (let i = 0; i < n; i++) {
            const t = i / SAMPLE_RATE;
            const g = Math.max(0, Math.min(1, 0.5 + 0.5 * gustSlow(t) + 0.12 * gustFast(t)));
            const cutoff = 180 + Math.pow(g, 1.6) * (500 + intensity * 1600);
            const a = 1 - Math.exp(-TWO_PI * cutoff / SAMPLE_RATE);
            lp1 += a * (noise[i] - lp1);       // two cascaded one-poles: 12 dB/oct,
            lp2 += a * (lp1 - lp2);            // stable under per-sample modulation
            out[i] = lp2 * (0.22 + 0.78 * g);
        }
        chans.push(out);
    }
    const st = { left: chans[0], right: chans[1] };
    // Gust-gated whistle: only audible above ~60% gust strength.
    const wl = whiteNoise(duration, 1.0, mulberry32(seed + 5));
    const wr = whiteNoise(duration, 1.0, mulberry32(seed + 6));
    bandPass(wl, 1050, 6); bandPass(wr, 1350, 6);
    for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        const g = Math.max(0, Math.min(1, 0.5 + 0.5 * gustSlow(t)));
        const w = Math.max(0, g - 0.62) * 2.6 * intensity * 0.14;
        st.left[i] += wl[i] * w;
        st.right[i] += wr[i] * w;
    }
    highPass2(st.left, 40, 0.707); highPass2(st.right, 40, 0.707);
    return edgeFades(normalizeStereo(st, 0.6));
}

// Rain: three layers — a broadband wash (thousands of distant drops), sparse
// DISCRETE close-drop transients ("patter", each with its own band/pan/decay),
// and a low roll. The discrete layer is what makes it rain instead of hiss.
function rainTexture(duration = 3.0, density = 0.6, opts = {}) {
    const seed = opts.seed !== undefined ? opts.seed : Math.floor(Math.random() * 1e9);
    const rng = mulberry32(seed);
    const n = Math.floor(duration * SAMPLE_RATE);
    const left = new Float32Array(n), right = new Float32Array(n);
    const intensityAM = smoothNoise1D(seed * 3 + 1, 0.15); // rain waxes/wanes slowly

    // 1. Wash — shaped white noise, decorrelated, HF-tilted like distant drops.
    for (let ch = 0; ch < 2; ch++) {
        const wash = whiteNoise(duration, 1.0, mulberry32(seed + 11 + ch));
        highPass2(wash, 900, 0.707);
        lowPass2(wash, 7800, 0.707);
        const dst = ch === 0 ? left : right;
        for (let i = 0; i < n; i++) {
            const t = i / SAMPLE_RATE;
            dst[i] += wash[i] * 0.34 * (0.85 + 0.15 * intensityAM(t));
        }
    }

    // 2. Patter — individual drop transients: short noise ticks in random bands,
    //    plus occasional pitched "plips" (drops hitting puddles/hard surfaces).
    const drops = Math.floor(duration * (30 + density * 100));
    for (let d = 0; d < drops; d++) {
        const tStart = rng() * (duration - 0.05);
        const isPlip = rng() < 0.12;
        let buf;
        if (isPlip) {
            const f0 = 1800 + rng() * 3200;
            buf = sine(f0, 0.02 + rng() * 0.015, 1.0);
            // quick downward chirp feel via exponential amp decay
            adsrExp(buf, 0.0008, buf.length / SAMPLE_RATE * 0.4, 0, buf.length / SAMPLE_RATE * 0.55, 4);
        } else {
            buf = whiteNoise(0.002 + rng() * 0.005, 1.0, rng);
            bandPass(buf, 1400 + rng() * 4800, 1.2 + rng() * 1.8);
            adsrExp(buf, 0.0005, buf.length / SAMPLE_RATE * 0.35, 0, buf.length / SAMPLE_RATE * 0.6, 4);
        }
        const amp = (0.1 + rng() * 0.4) * (isPlip ? 0.5 : 1);
        const pan = rng() * 2 - 1;
        const a = (pan + 1) * 0.25 * Math.PI;
        addInto(left, buf, Math.floor(tStart * SAMPLE_RATE), amp * Math.cos(a));
        addInto(right, buf, Math.floor(tStart * SAMPLE_RATE), amp * Math.sin(a));
    }

    // 3. Low roll — the distant body of the rain.
    const roll = brownNoise(duration, 1.0, mulberry32(seed + 31));
    lowPass2(roll, 240, 0.707);
    for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        const g = 0.16 * (0.8 + 0.2 * intensityAM(t + 7));
        left[i] += roll[i] * g;
        right[i] += roll[i] * g;
    }
    const st = { left, right };
    removeDC(st.left); removeDC(st.right);
    return edgeFades(normalizeStereo(st, 0.65));
}

// Crowd murmur — "walla" synthesis. Humanness lives in the details a robotic
// drone lacks:
//   - the vowel changes EVERY syllable (mouths move), not once per talker
//   - every syllable has a pitch CONTOUR (fall/rise) plus cycle-level jitter —
//     a perfectly steady buzz reads as a creepy moan
//   - voicing is blended with breath noise through the same formants
//   - phrases decline in pitch/level like real utterances, syllables run at
//     conversational rate (~4-7/s)
//   - MANY quiet talkers rather than a few loud ones, so no individual voice
//     is followable
function crowdMurmur(duration = 3.0, density = 0.5, opts = {}) {
    const seed = opts.seed !== undefined ? opts.seed : Math.floor(Math.random() * 1e9);
    const rng = mulberry32(seed);
    const n = Math.floor(duration * SAMPLE_RATE);
    const left = new Float32Array(n), right = new Float32Array(n);
    const NV = Math.round(16 + density * 16);
    const vowels = ['a', 'e', 'i', 'o', 'u'];

    // One spoken syllable: jittered glottal saw with a pitch glide + breath,
    // soft raised-cosine envelope, then a per-syllable vowel formant.
    function syllable(pitchStart, pitchEnd, dur) {
        const len = Math.floor(dur * SAMPLE_RATE);
        const out = new Float32Array(len);
        let phase = 0, jit = 0;
        for (let i = 0; i < len; i++) {
            const u = i / len;
            // Pitch contour + slow random-walk jitter (vocal-fold instability).
            jit = 0.999 * jit + (rng() * 2 - 1) * 0.002;
            const f = pitchStart * Math.pow(pitchEnd / pitchStart, u) * (1 + Math.max(-0.04, Math.min(0.04, jit)));
            phase += f / SAMPLE_RATE;
            if (phase >= 1) phase -= 1;
            const env = Math.pow(0.5 * (1 - Math.cos(TWO_PI * Math.min(u * 1.15, 1))), 0.7);
            out[i] = (2 * phase - 1) * env;   // naive saw is fine: <300 Hz, formant-filtered next
        }
        lowPass2(out, 2400, 0.707);
        // Aspiration — breath through the same mouth. Distant murmur is more
        // breath than buzz; strong voicing is what reads as synthetic moaning.
        const breath = pinkNoise(dur, 1.0, rng);
        for (let i = 0; i < len; i++) {
            const u = i / len;
            const env = Math.pow(0.5 * (1 - Math.cos(TWO_PI * Math.min(u * 1.15, 1))), 0.7);
            out[i] = out[i] * 0.48 + breath[i] * 0.52 * env;
        }
        // Soft, wide formants (Q 4.5, mix 0.55) — vowel *hint*, not a synth vowel.
        vowelFormant(out, vowels[Math.floor(rng() * vowels.length)], 0.55, 4.5);
        return out;
    }

    // A quiet laugh: rapid repeated syllables on one vowel, falling pitch and
    // level — the one instantly-human gesture, kept subtle.
    function laughInto(vbuf, tStart, f0) {
        const puffs = 4 + Math.floor(rng() * 3);
        let t = tStart;
        const base = f0 * (1.3 + rng() * 0.25);
        for (let k = 0; k < puffs && t < duration - 0.15; k++) {
            const p = base * Math.pow(0.93, k) * (0.97 + rng() * 0.06);
            const syl = syllable(p, p * 0.85, 0.07 + rng() * 0.03);
            addInto(vbuf, syl, Math.floor(t * SAMPLE_RATE), 0.75 * Math.pow(0.85, k));
            t += 0.085 + rng() * 0.04;
        }
        return t;
    }

    for (let v = 0; v < NV; v++) {
        const f0 = 120 + rng() * 130;                // tighter, mid pitch range
        const pan = (rng() * 2 - 1) * 0.85;
        const dist = 0.25 + rng() * 0.45;            // everyone further away
        const vbuf = new Float32Array(n);
        let t = rng() * 0.7;
        while (t < duration - 0.2) {
            if (rng() < 0.12) {                      // sometimes: a quiet laugh
                t = laughInto(vbuf, t, f0);
                t += 0.4 + rng() * 1.2;
                continue;
            }
            const phraseSyls = 3 + Math.floor(rng() * 6);
            const phrasePitch = f0 * (0.95 + rng() * 0.15);
            for (let s = 0; s < phraseSyls && t < duration - 0.2; s++) {
                const decl = 1 - 0.12 * (s / phraseSyls);          // pitch declination
                const p1 = phrasePitch * decl * (0.94 + rng() * 0.16);
                const contour = s === phraseSyls - 1 && rng() < 0.3
                    ? 1.15 + rng() * 0.15                          // occasional question rise
                    : 0.82 + rng() * 0.14;                         // usual fall
                const sylDur = 0.06 + rng() * 0.1;
                const syl = syllable(p1, p1 * contour, sylDur);
                const lvl = (0.7 + rng() * 0.3) * (1 - 0.25 * (s / phraseSyls)); // phrase fade
                addInto(vbuf, syl, Math.floor(t * SAMPLE_RATE), lvl);
                // Soft consonant transient between syllables.
                if (rng() < 0.45) {
                    const cons = whiteNoise(0.01, 1.0, rng);
                    highPass2(cons, 1600, 0.707);
                    adsrExp(cons, 0.001, 0.004, 0, 0.005, 4);
                    addInto(vbuf, cons, Math.floor(t * SAMPLE_RATE), 0.12);
                }
                t += sylDur * (1.02 + rng() * 0.35);               // conversational rate
            }
            t += 0.3 + rng() * 1.3;                                // listen / pause
        }
        highPass2(vbuf, 180, 0.707);   // remove chesty drone build-up
        lowPass2(vbuf, 2600, 0.707);   // distance rolls the presence off
        const a = (pan + 1) * 0.25 * Math.PI;
        const g = dist / Math.sqrt(NV);
        for (let i = 0; i < n; i++) {
            left[i] += vbuf[i] * g * Math.cos(a);
            right[i] += vbuf[i] * g * Math.sin(a);
        }
    }

    // Babble bed — the blur of the fifty conversations you can't pick out:
    // speech-band noise with syllabic + slow AM, decorrelated per channel.
    // It glues the discrete talkers and masks any residual synthetic vowel tone.
    {
        // Match the bed level to the talker layer so it supports, not drowns.
        let talkerRms = 0;
        for (let i = 0; i < n; i++) talkerRms += left[i] * left[i] + right[i] * right[i];
        talkerRms = Math.sqrt(talkerRms / (2 * n));
        for (let ch = 0; ch < 2; ch++) {
            const bed = pinkNoise(duration, 1.0, mulberry32(seed + 71 + ch));
            bandPass(bed, 650, 0.8);
            const am1 = smoothNoise1D(seed * 11 + ch, 3.8);   // syllabic flicker
            const am2 = smoothNoise1D(seed * 13 + ch, 0.35);  // conversation swells
            const dst = ch === 0 ? left : right;
            let bedRms = 0;
            for (let i = 0; i < n; i++) bedRms += bed[i] * bed[i];
            bedRms = Math.sqrt(bedRms / n);
            const g = bedRms > 0 ? (talkerRms * 0.9) / bedRms : 0;
            for (let i = 0; i < n; i++) {
                const t = i / SAMPLE_RATE;
                dst[i] += bed[i] * g * (0.6 + 0.25 * am1(t) + 0.3 * am2(t));
            }
        }
    }
    // Light room around the crowd so it reads as a shared space.
    const { reverbStereo } = require('./ir_generator');
    let st = reverbStereo({ left, right }, { duration: 1.1, roomSize: 0.6, hfDamping: 0.55, wet: 0.3, seed: seed + 99 });
    // reverb extends the buffer; trim back to the requested duration
    st = { left: st.left.subarray(0, n), right: st.right.subarray(0, n) };
    removeDC(st.left); removeDC(st.right);
    return edgeFades(normalizeStereo(st, 0.55));
}

// Distant thunder — one or two discrete EVENTS, each with an onset, a long
// rolling decay re-energized by random "peals", and a filter that darkens as
// the rumble dies out. Decorrelated noise per channel = natural width.
function thunderRumble(duration = 4.0, opts = {}) {
    const seed = opts.seed !== undefined ? opts.seed : Math.floor(Math.random() * 1e9);
    const rng = mulberry32(seed);
    const n = Math.floor(duration * SAMPLE_RATE);
    const left = new Float32Array(n), right = new Float32Array(n);
    const events = duration >= 7 ? 2 : 1;

    for (let e = 0; e < events; e++) {
        const t0 = e === 0 ? 0.1 + rng() * duration * 0.15 : duration * 0.45 + rng() * duration * 0.2;
        const evDur = Math.min(duration - t0 - 0.1, 2.8 + rng() * 2.5);
        if (evDur < 1) continue;
        const evLen = Math.floor(evDur * SAMPLE_RATE);
        const attack = 0.1 + rng() * 0.3;
        // Random secondary peals that re-energize the roll.
        const peals = [];
        const nPeals = 2 + Math.floor(rng() * 3);
        for (let p = 0; p < nPeals; p++) peals.push({ t: attack + rng() * evDur * 0.7, w: 0.15 + rng() * 0.25, a: 0.4 + rng() * 0.6 });

        for (let ch = 0; ch < 2; ch++) {
            const src = brownNoise(evDur, 1.0, mulberry32(seed + e * 7 + ch * 131));
            const dst = ch === 0 ? left : right;
            let lp1 = 0, lp2 = 0;
            const base = Math.floor(t0 * SAMPLE_RATE);
            for (let i = 0; i < evLen && base + i < n; i++) {
                const t = i / SAMPLE_RATE;
                // Envelope: onset ramp, exponential roll-off, plus gaussian peals.
                let env = (t < attack ? t / attack : 1) * Math.exp(-(Math.max(0, t - attack)) / (evDur * 0.35));
                for (const p of peals) env *= 1 + p.a * Math.exp(-Math.pow((t - p.t) / p.w, 2));
                // Filter darkens as the roll decays: 420 Hz → 55 Hz.
                const cutoff = 55 + 365 * Math.exp(-t / (evDur * 0.4));
                const a = 1 - Math.exp(-TWO_PI * cutoff / SAMPLE_RATE);
                lp1 += a * (src[i] - lp1);
                lp2 += a * (lp1 - lp2);
                dst[base + i] += lp2 * env;
            }
        }
        // Occasional faint HF "crack" right at the onset (closer strike).
        if (rng() < 0.5) {
            const crack = whiteNoise(0.12, 1.0, rng);
            bandPass(crack, 1500 + rng() * 1200, 1.2);
            adsrExp(crack, 0.002, 0.03, 0.1, 0.08, 3);
            const g = 0.1 + rng() * 0.08;
            addInto(left, crack, Math.floor(t0 * SAMPLE_RATE), g);
            addInto(right, crack, Math.floor((t0 + 0.004) * SAMPLE_RATE), g * 0.8);
        }
    }
    const st = { left, right };
    highPass2(st.left, 24, 0.707); highPass2(st.right, 24, 0.707);
    removeDC(st.left); removeDC(st.right);
    return edgeFades(normalizeStereo(st, 0.7), 0.05);
}

// Room tone — continuous low bed (pink+brown through a double lowpass) with a
// faint "air" hiss on top and a barely-there slow breathing. No grains: a real
// quiet room is continuous, not granular blobs.
function roomTone(duration = 3.0, opts = {}) {
    const seed = opts.seed !== undefined ? opts.seed : Math.floor(Math.random() * 1e9);
    const n = Math.floor(duration * SAMPLE_RATE);
    const breathe = smoothNoise1D(seed * 5 + 3, 0.1);
    const chans = [];
    for (let ch = 0; ch < 2; ch++) {
        const p = pinkNoise(duration, 0.65, mulberry32(seed + ch * 313));
        const b = brownNoise(duration, 0.45, mulberry32(seed + 41 + ch));
        const bed = new Float32Array(n);
        for (let i = 0; i < n; i++) bed[i] = p[i] + b[i];
        lowPass2(bed, 380, 0.707);
        lowPass2(bed, 380, 0.707);
        // Air: very quiet high hiss (HVAC/electronics presence).
        const air = whiteNoise(duration, 1.0, mulberry32(seed + 61 + ch));
        highPass2(air, 4000, 0.707);
        lowPass2(air, 9500, 0.707);
        for (let i = 0; i < n; i++) {
            const t = i / SAMPLE_RATE;
            bed[i] = (bed[i] + air[i] * 0.035) * (1 + 0.05 * breathe(t));
        }
        highPass2(bed, 35, 0.707);
        chans.push(bed);
    }
    const st = { left: chans[0], right: chans[1] };
    removeDC(st.left); removeDC(st.right);
    return edgeFades(normalizeStereo(st, 0.35)); // intentionally quiet — background presence
}

module.exports = {
    grainCloud,
    windTexture,
    rainTexture,
    crowdMurmur,
    thunderRumble,
    roomTone,
};
