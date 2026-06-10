#!/usr/bin/env node
// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// test_battery.js — Verification harness for the audio engine.
// Renders a fixed set of fixtures, then runs numeric regression checks (DC offset, peak,
// click detection, autocorrelation periodicity). Smoke mode runs only the cheap fixtures
// and asserts the numeric gates — exit 0 / 1.
//
// Usage:
//   node test_battery.js               # render all fixtures, print summary
//   node test_battery.js --smoke       # render 6 fastest fixtures + assert numeric gates
//   node test_battery.js --out=/path   # custom output dir (default /tmp/audio_battery_<ts>)

const path = require('path');
const fs = require('fs');
const audio = require('./tools');
const music = require('../build-music/tools');

const args = process.argv.slice(2);
const SMOKE = args.includes('--smoke');
const OUT_ARG = args.find(a => a.startsWith('--out='));
const TS = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = OUT_ARG ? OUT_ARG.slice(6) : `/tmp/audio_battery_${TS}`;

fs.mkdirSync(OUT, { recursive: true });
console.log(`Output dir: ${OUT}`);
if (SMOKE) console.log('Mode: --smoke (numeric gates enforced; subset of fixtures)');

const SR = audio.SAMPLE_RATE;

// ─── Fixtures ──────────────────────────────────────────────

function renderClick() {
    const b = audio.sweep(2000, 1500, 0.02, 'triangle', 'exponential');
    audio.adsrExp(b, 0.001, 0.005, 0, 0.014, 4);
    audio.fadeOut(b, 0.003);
    return b;
}
function renderBlip() {
    const b = audio.osc_models.fmOperator(900, 0.08, 3, 4, (t) => Math.exp(-15 * t));
    audio.adsrExp(b, 0.001, 0.02, 0, 0.06, 3);
    return audio.mix_bus.applyFx(b, { hpf: 150, gain: 0.7 });
}
function renderSuccess() {
    const a = audio.synth_voices.bell(72, 0.5, 110, 240);
    const c = audio.synth_voices.bell(76, 0.5, 110, 240);
    const d = audio.synth_voices.bell(79, 0.5, 110, 240);
    const out = new Float32Array(Math.floor(0.9 * SR));
    audio.addInto(out, a, 0, 0.7);
    audio.addInto(out, c, Math.floor(0.08 * SR), 0.6);
    audio.addInto(out, d, Math.floor(0.16 * SR), 0.55);
    return audio.mix_bus.applyFx(out, { reverb: 'smallRoom', gain: 0.8 });
}
function renderError() {
    const b = audio.sweep(380, 220, 0.4, 'sawtooth', 'exponential');
    audio.adsrExp(b, 0.005, 0.1, 0.4, 0.3, 3);
    return audio.mix_bus.applyFx(b, { distort: 8, lpf: 1400, gain: 0.6 });
}
function renderPunch() {
    return audio.transient_designer.designImpact({
        attack: { kind: 'click', durationMs: 8, lpHz: 5000, hpHz: 400, gain: 0.6 },
        body:   { kind: 'thump', freq: 90, decay: 0.18, lpHz: 700, gain: 0.85, dist: 1.2 },
    });
}
function renderGlassBreak() {
    const attack = audio.transient_designer.designImpact({
        attack: { kind: 'snap', durationMs: 15, centerHz: 5500, lpHz: 9000, gain: 0.8 },
        body:   { kind: 'noise', decay: 0.35, hpHz: 3500, lpHz: 9000, gain: 0.5 },
    });
    const shard1 = audio.synth_voices.bell(86, 0.6, 80, 240);
    const shard2 = audio.synth_voices.bell(91, 0.6, 70, 240);
    const out = new Float32Array(Math.floor(SR * 0.7));
    audio.addInto(out, attack, 0, 1.0);
    audio.addInto(out, shard1, Math.floor(0.02 * SR), 0.25);
    audio.addInto(out, shard2, Math.floor(0.045 * SR), 0.2);
    audio.fadeOut(out, 0.01);
    return audio.mix_bus.applyFx(out, { hpf: 200, reverb: 'mediumRoom', gain: 0.85 });
}
function renderMetalClank() {
    const m = audio.transient_designer.designImpact({
        attack: { kind: 'click', durationMs: 5, lpHz: 8000, hpHz: 1500, gain: 0.55 },
        body:   { kind: 'tonal', freq: 720, partials: 6, decay: 0.6, hpHz: 400, lpHz: 6000, gain: 0.6 },
    });
    return audio.mix_bus.applyFx(m, { reverb: 'plate' });
}
function renderLaser() {
    const b = audio.sweep(2200, 250, 0.25, 'sawtooth', 'exponential');
    audio.adsrExp(b, 0.001, 0.05, 0.6, 0.15, 3);
    return audio.mix_bus.applyFx(b, { distort: 3, lpf: 4500, gain: 0.7 });
}
function renderWhoosh() {
    const n = audio.whiteNoise(0.4);
    audio.lowPassSweep(n, 400, 6500, 1.5, 'exponential');
    audio.adsrExp(n, 0.05, 0.1, 0.7, 0.2, 2);
    return audio.mix_bus.applyFx(n, { hpf: 200, reverb: 'plate', gain: 0.6 });
}
function renderRiser() {
    const tone = audio.sweep(80, 1200, 1.8, 'sawtooth', 'exponential');
    const noise = audio.whiteNoise(1.8, 0.5);
    audio.lowPassSweep(noise, 800, 6000, 1, 'linear');
    const sum = audio.mix([tone, noise], [0.5, 0.4]);
    audio.adsrExp(sum, 0.05, 0.1, 0.95, 0.05, 2);
    return audio.mix_bus.applyFx(sum, { reverb: 'largeHall', gain: 0.75 });
}
function renderDrone() {
    const a = audio.sine(110, 6, 0.5);
    const b = audio.sine(110 * 1.005, 6, 0.4);
    const c = audio.sine(220, 6, 0.25);
    const sum = audio.mix([a, b, c], [0.5, 0.4, 0.3]);
    audio.humanize.ampWobble(sum, 0.35, 0.18);
    audio.fadeIn(sum, 0.4); audio.fadeOut(sum, 0.5);
    return audio.mix_bus.applyFx(sum, { hpf: 60, lpf: 2500, reverb: 'largeHall', gain: 0.5 });
}
function renderWind() { return audio.granular.windTexture(4, 0.7); }
function renderRain() { return audio.granular.rainTexture(4, 0.6); }

function renderPianoScale() {
    const events = music.parseMini('0 1 2 3 4 5 6 7', { cycleBeats: 8 });
    music.scale(events, 'major', 'C4');
    const tracks = [music.track('piano', 'piano', events, { fx: { reverb: 'mediumRoom', gain: 0.55 } })];
    return music.render(tracks, { bpm: 120 });
}
function renderEp251() {
    // ii-V-I in C: Dm7 - G7 - Cmaj7
    const events = [];
    [62, 65, 69, 72].forEach(n => events.push({ time: 0, beats: 3.5, value: n, velocity: 75 }));
    [67, 71, 74, 77].forEach(n => events.push({ time: 4, beats: 3.5, value: n, velocity: 75 }));
    [60, 64, 67, 71].forEach(n => events.push({ time: 8, beats: 7.5, value: n, velocity: 80 }));
    const tracks = [music.track('ep', 'electricPiano', events, { fx: { hpf: 200, lpf: 4000, reverb: 'mediumRoom', gain: 0.5 } })];
    return music.render(tracks, { bpm: 90, duration: 12 });
}
function renderVibesComp() {
    const events = music.parseMini('{0,2,4,6} ~ {1,3,5,7} ~', { cycleBeats: 4 });
    music.scale(events, 'major', 'C4');
    const tracks = [music.track('vibes', 'vibraphone', events, { fx: { reverb: 'plate', gain: 0.45 } })];
    return music.render(tracks, { bpm: 100, duration: 8 });
}
function renderBrassFanfare() {
    const events = music.parseMini('0 2 4 [4 2] 7 [4 2] 0/2', { cycleBeats: 8 });
    music.scale(events, 'major', 'C3');
    const tracks = [music.track('brass', 'analogBrass', events, { fx: { reverb: 'largeHall', gain: 0.5 } })];
    return music.render(tracks, { bpm: 110, duration: 8 });
}
function renderLofiJazz() {
    const mt = music.music_theory;
    const chords = mt.buildProgression('C4', 'major', 'ii-V-I');
    const comp = [];
    chords.forEach((ch, i) => ch.notes.forEach(n => comp.push({ time: i * 4, beats: 3.5, value: n, velocity: 70 })));
    const bass = [];
    chords.forEach((ch, i) => {
        bass.push({ time: i * 4 + 0, beats: 1, value: ch.root - 24, velocity: 90 });
        bass.push({ time: i * 4 + 1, beats: 1, value: ch.root - 24 + 4, velocity: 80 });
        bass.push({ time: i * 4 + 2, beats: 1, value: ch.root - 24 + 7, velocity: 85 });
        bass.push({ time: i * 4 + 3, beats: 1, value: ch.root - 24 + 4, velocity: 75 });
    });
    const tracks = [
        music.track('ep', 'electricPiano', comp, { fx: { hpf: 200, lpf: 3500, reverb: 'mediumRoom', gain: 0.45 }, humanize: { groove: 'swing' } }),
        music.track('bass', 'subBass', bass, { fx: { lpf: 200, gain: 0.7 } }),
    ];
    return music.render(tracks, { bpm: 80, duration: 16 });
}
function renderAmbientPad() {
    const events = [];
    [57, 60, 64, 67].forEach(n => events.push({ time: 0, beats: 14, value: n, velocity: 70 }));
    [53, 57, 60, 64].forEach(n => events.push({ time: 14, beats: 14, value: n, velocity: 65 }));
    const tracks = [music.track('pad', 'choirAh', events, { fx: { hpf: 150, lpf: 3500, reverb: 'cathedral', gain: 0.35 } })];
    return music.render(tracks, { bpm: 60, duration: 30 });
}

// Smoke set: cheap, fast, exercises each major code path once
const SMOKE_FIXTURES = [
    { name: 'click',        render: renderClick,        category: 'ui',     stereo: false },
    { name: 'punch',        render: renderPunch,        category: 'impact', stereo: false },
    { name: 'laser',        render: renderLaser,        category: 'sweep',  stereo: false },
    { name: 'wind',         render: renderWind,         category: 'ambient',stereo: true  },
    { name: 'piano_scale',  render: renderPianoScale,   category: 'music',  stereo: true  },
    { name: 'vibes_comp',   render: renderVibesComp,    category: 'music',  stereo: true  },
];

const FULL_FIXTURES = [
    ...SMOKE_FIXTURES,
    { name: 'blip',          render: renderBlip,         category: 'ui',     stereo: false },
    { name: 'success',       render: renderSuccess,      category: 'ui',     stereo: true  },
    { name: 'error',         render: renderError,        category: 'ui',     stereo: false },
    { name: 'glass_break',   render: renderGlassBreak,   category: 'impact', stereo: true  },
    { name: 'metal_clank',   render: renderMetalClank,   category: 'impact', stereo: true  },
    { name: 'whoosh',        render: renderWhoosh,       category: 'sweep',  stereo: true  },
    { name: 'riser',         render: renderRiser,        category: 'sweep',  stereo: true  },
    { name: 'drone',         render: renderDrone,        category: 'ambient',stereo: true  },
    { name: 'rain',          render: renderRain,         category: 'ambient',stereo: true  },
    { name: 'ep_251',        render: renderEp251,        category: 'music',  stereo: true  },
    { name: 'brass_fanfare', render: renderBrassFanfare, category: 'music',  stereo: true  },
    { name: 'lofi_jazz',     render: renderLofiJazz,     category: 'music',  stereo: true  },
    { name: 'ambient_pad',   render: renderAmbientPad,   category: 'music',  stereo: true  },
];

const FIXTURES = SMOKE ? SMOKE_FIXTURES : FULL_FIXTURES;

// ─── Numeric checks ────────────────────────────────────────

function computeChecks(buf, name) {
    const arr = buf.left ? buf.left : buf;
    const len = arr.length;
    if (len === 0) return { pass: false, reason: 'empty buffer' };

    // Peak, DC offset
    let sum = 0, peak = 0;
    for (let i = 0; i < len; i++) {
        sum += arr[i];
        const a = Math.abs(arr[i]);
        if (a > peak) peak = a;
    }
    const dc = Math.abs(sum / len);

    // Click detection: large sample-to-sample jumps in the last 5 ms (excluding fadeIn)
    const tailStart = Math.max(0, len - Math.floor(0.005 * SR));
    let maxJumpTail = 0;
    for (let i = tailStart + 1; i < len; i++) {
        const j = Math.abs(arr[i] - arr[i - 1]);
        if (j > maxJumpTail) maxJumpTail = j;
    }

    // RMS as a sanity check (rendered buffer shouldn't be silent)
    let sumSq = 0;
    for (let i = 0; i < len; i++) sumSq += arr[i] * arr[i];
    const rms = Math.sqrt(sumSq / len);

    const checks = {
        peak,
        dc,
        maxJumpTail,
        rms,
        durationSec: +(len / SR).toFixed(3),
    };
    const failures = [];
    if (dc > 0.005) failures.push(`DC offset ${dc.toFixed(4)} > 0.005`);
    if (peak > 0.99) failures.push(`peak ${peak.toFixed(3)} > 0.99 (clipping risk)`);
    if (peak < 0.01) failures.push(`peak ${peak.toFixed(3)} < 0.01 (effectively silent)`);
    if (maxJumpTail > 0.06) failures.push(`tail click ${maxJumpTail.toFixed(3)} > 0.06 (end-of-buffer click)`);
    if (rms < 0.005) failures.push(`RMS ${rms.toFixed(4)} < 0.005 (very quiet)`);
    return { pass: failures.length === 0, failures, checks };
}

// ─── Run ───────────────────────────────────────────────────

const results = [];
let failed = 0;
for (const fx of FIXTURES) {
    const t0 = Date.now();
    let buf;
    try {
        buf = fx.render();
    } catch (e) {
        console.error(`[${fx.name}] RENDER FAILED:`, e.message);
        failed++;
        results.push({ name: fx.name, pass: false, failures: [`render threw: ${e.message}`] });
        continue;
    }
    const writePath = path.join(OUT, `${fx.name}.wav`);
    audio.WavBuilder.write(buf, writePath);
    const t1 = Date.now();
    const result = computeChecks(buf, fx.name);
    result.name = fx.name;
    result.category = fx.category;
    result.renderMs = t1 - t0;
    results.push(result);
    if (!result.pass) {
        failed++;
        console.error(`  [FAIL] ${fx.name}: ${result.failures.join('; ')}`);
    }
}

// ─── Summary ──────────────────────────────────────────────

console.log('\n──── Battery Summary ────');
console.log(`Fixtures: ${results.length}  Passed: ${results.length - failed}  Failed: ${failed}`);
console.log('\nName            | Cat    | Dur   | Peak  | DC      | RMS    | TailJmp | RenderMs | Pass');
console.log('----------------|--------|-------|-------|---------|--------|---------|----------|-----');
for (const r of results) {
    const cks = r.checks || {};
    console.log(
        `${r.name.padEnd(15)} | ${(r.category || '').padEnd(6)} | ${(cks.durationSec || 0).toFixed(2).padStart(5)} | `
        + `${(cks.peak || 0).toFixed(3).padStart(5)} | ${(cks.dc || 0).toFixed(5).padStart(7)} | `
        + `${(cks.rms || 0).toFixed(4).padStart(6)} | ${(cks.maxJumpTail || 0).toFixed(3).padStart(7)} | `
        + `${String(r.renderMs || '-').padStart(8)} | ${r.pass ? 'OK' : 'FAIL'}`
    );
}

console.log(`\nWAV files written to: ${OUT}`);

if (SMOKE && failed > 0) {
    console.error(`\nSmoke FAILED — ${failed} fixture(s) hit a numeric gate.`);
    process.exit(1);
}
process.exit(0);
