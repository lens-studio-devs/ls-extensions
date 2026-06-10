// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// wav_builder.js — Minimal WAV writer (16-bit PCM, 44.1 kHz, mono or stereo).
// Usage:
//   const { WavBuilder } = require('<ENGINE>/tools/wav_builder');
//   WavBuilder.write(float32Mono, '/abs/path.wav');
//   WavBuilder.write({ left, right }, '/abs/path.wav');         // auto-stereo
//   WavBuilder.writeStereo(left, right, '/abs/path.wav');       // explicit
// outputPath MUST be absolute. Relative paths resolve against process.cwd().

const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 44100;
const BIT_DEPTH = 16;

function writeBuffer(samplesPerChannel, numChannels, outputPath) {
    const numSamples = samplesPerChannel[0].length;
    const bytesPerSample = BIT_DEPTH / 8;
    const dataSize = numSamples * numChannels * bytesPerSample;
    const fileSize = 44 + dataSize;

    const buf = Buffer.alloc(fileSize);
    let off = 0;
    buf.write('RIFF', off); off += 4;
    buf.writeUInt32LE(fileSize - 8, off); off += 4;
    buf.write('WAVE', off); off += 4;
    buf.write('fmt ', off); off += 4;
    buf.writeUInt32LE(16, off); off += 4;
    buf.writeUInt16LE(1, off); off += 2;
    buf.writeUInt16LE(numChannels, off); off += 2;
    buf.writeUInt32LE(SAMPLE_RATE, off); off += 4;
    buf.writeUInt32LE(SAMPLE_RATE * numChannels * bytesPerSample, off); off += 4;
    buf.writeUInt16LE(numChannels * bytesPerSample, off); off += 2;
    buf.writeUInt16LE(BIT_DEPTH, off); off += 2;
    buf.write('data', off); off += 4;
    buf.writeUInt32LE(dataSize, off); off += 4;

    // Interleave channels (LRLR... for stereo, mono for 1 channel)
    for (let i = 0; i < numSamples; i++) {
        for (let c = 0; c < numChannels; c++) {
            const s = samplesPerChannel[c][i] || 0;
            const clamped = Math.max(-1, Math.min(1, s));
            const int16 = Math.floor(clamped * 32767);
            buf.writeInt16LE(int16, off);
            off += 2;
        }
    }

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outputPath, buf);

    const duration = numSamples / SAMPLE_RATE;
    const result = {
        path: outputPath,
        size: fileSize,
        duration: Math.round(duration * 1000) / 1000,
        samples: numSamples,
        channels: numChannels,
    };
    console.log(`${outputPath} (${(fileSize / 1024).toFixed(1)} KB, ${result.duration}s, ${numChannels === 2 ? 'stereo' : 'mono'}, ${numSamples} samples)`);
    return result;
}

class WavBuilder {
    static write(input, outputPath) {
        if (input && typeof input === 'object' && !ArrayBuffer.isView(input) && 'left' in input && 'right' in input) {
            return WavBuilder.writeStereo(input.left, input.right, outputPath);
        }
        return writeBuffer([input], 1, outputPath);
    }

    static writeStereo(left, right, outputPath) {
        const len = Math.max(left.length, right.length);
        // Pad shorter channel to match length
        const L = left.length === len ? left : (() => { const a = new Float32Array(len); a.set(left); return a; })();
        const R = right.length === len ? right : (() => { const a = new Float32Array(len); a.set(right); return a; })();
        return writeBuffer([L, R], 2, outputPath);
    }
}

module.exports = { WavBuilder };
