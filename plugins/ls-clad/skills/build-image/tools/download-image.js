#!/usr/bin/env node
// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// Download a finished text-to-image asset to disk. The image URL on a succeeded job is a
// signed S3 URL, so this is an UNauthenticated GET — auth happened earlier on the
// create/poll calls. In node so it runs under the plugin's Bash(node:*) allowlist.
//
// Usage: node download-image.js --url "<image_url>" --out "Assets/GeneratedImages/<Name>.png"
//        node download-image.js --url-file "<path>" --out "Assets/GeneratedImages/<Name>.png"
//
// `--url-file` keeps the ~1.5 KB signed URL off the command line and out of Bash permission prompts (supply exactly one of `--url` / `--url-file`).
//
// A freshly minted signed URL can 403 for a beat while the object settles in S3 (S3 answers
// 403, not 404, for an object that is not readable yet), so this tool RETRIES that class on
// its own — a transient 403 no longer forces a re-poll. Exit codes:
//   0  wrote the file
//   2  bad arguments
//   3  URL still rejected after retries (expired or wrong): re-poll the job for a fresh
//      processed_preview_image_url / uncropped_cutout_image_url / preview_image_url, then re-run
//   1  any other hard failure
//
// Requires Node 18+ (global fetch).

'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Retry the transient classes (fresh-URL 403, throttles, 5xx, network blips, a signed-URL
// error page served with HTTP 200) a few times with growing backoff before giving up.
const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [400, 800, 1600, 3200]; // between attempts; the last value repeats if needed

function usage() {
  process.stderr.write('Usage: node download-image.js (--url "<url>" | --url-file "<path>") --out "Assets/GeneratedImages/<Name>.png"\n');
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    if (arg === '--help' || arg === '-h') { usage(); process.exit(0); }
    let value;
    const eq = arg.indexOf('=');
    if (eq !== -1) { value = arg.slice(eq + 1); arg = arg.slice(0, eq); }
    else {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        process.stderr.write(`download-image: missing value for ${arg}\n`);
        process.exit(2);
      }
      value = argv[++i];
    }
    if (arg === '--url') out.url = value;
    else if (arg === '--url-file') out.urlFile = value;
    else if (arg === '--out') out.dest = value;
    else { process.stderr.write(`download-image: unknown argument: ${arg}\n`); process.exit(2); }
  }
  return out;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The generated preview is a PNG; the API may also hand back a JPEG or WebP. Accept
// any of those by their magic bytes and reject anything else, so a signed URL that
// returns an HTML error page with HTTP 200 is not written verbatim as an image.
function detectImage(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return 'png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'jpeg';
  }
  if (
    buf.length >= 12 &&
    buf.toString('latin1', 0, 4) === 'RIFF' &&
    buf.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

// Pull pixel dimensions straight from the image header so the skill's output contract can
// report width/height. Returns nulls if the header can't be read (never throws).
function readDimensions(buf, kind) {
  try {
    if (kind === 'png') {
      // 8-byte signature, then the IHDR chunk (4-byte length + "IHDR" + width/height as BE uint32).
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (kind === 'jpeg') {
      // Walk the marker segments to the first Start-Of-Frame (SOFn), which carries the size.
      let off = 2; // past SOI
      while (off + 9 < buf.length) {
        if (buf[off] !== 0xff) { off++; continue; }
        const marker = buf[off + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
        }
        const segLen = buf.readUInt16BE(off + 2);
        if (segLen < 2) break;
        off += 2 + segLen;
      }
      return { width: null, height: null };
    }
    if (kind === 'webp') {
      const fmt = buf.toString('latin1', 12, 16);
      if (fmt === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (fmt === 'VP8L') {
        const bits = buf.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
      if (fmt === 'VP8X') {
        return {
          width: (buf[24] | (buf[25] << 8) | (buf[26] << 16)) + 1,
          height: (buf[27] | (buf[28] << 8) | (buf[29] << 16)) + 1,
        };
      }
      return { width: null, height: null };
    }
  } catch (_e) {
    // fall through to nulls
  }
  return { width: null, height: null };
}

const MAX_BYTES = 128 * 1024 * 1024; // generous cap; a generated image is far smaller — guards against a runaway/huge response

// One GET attempt. Returns a tagged outcome:
//   { kind: 'ok', buf, imgKind }          — a valid image
//   { kind: 'reauth', message }           — 401/403: signed URL rejected (retryable; if it
//                                            never clears the caller must re-poll)
//   { kind: 'retry', message }            — throttle / 5xx / network blip / non-image 200
//   { kind: 'hard', message }             — a failure retrying cannot fix
async function attemptDownload(url) {
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    return { kind: 'retry', message: `network error: ${e && e.message ? e.message : e}` };
  }
  if (!res.ok) {
    const s = res.status;
    if (s === 401 || s === 403) return { kind: 'reauth', message: `HTTP ${s} ${res.statusText}` };
    if (s === 408 || s === 429 || (s >= 500 && s <= 599)) return { kind: 'retry', message: `HTTP ${s} ${res.statusText}` };
    return { kind: 'hard', message: `HTTP ${s} ${res.statusText}` };
  }
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    return { kind: 'hard', message: `refusing response of ${declared} bytes (> ${MAX_BYTES}-byte cap); not a normal image.` };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  // A signed URL can return HTTP 200 with an error page (expired/misconfigured CDN, or an
  // object still settling), which would otherwise be written verbatim as a .png. Reject
  // anything without a known image header and let the retry loop try again.
  const imgKind = detectImage(buf);
  if (!imgKind) {
    const peek = buf.toString('utf8', 0, 200).replace(/\s+/g, ' ').trim();
    return { kind: 'retry', message: `response is not an image (no PNG/JPEG/WebP magic; ${buf.length} bytes). First bytes: ${peek}` };
  }
  return { kind: 'ok', buf, imgKind };
}

async function main() {
  const { url, urlFile, dest } = parseArgs(process.argv.slice(2));
  if ((!url && !urlFile) || (url && urlFile) || !dest) { usage(); process.exit(2); }

  let targetUrl = url;
  if (urlFile) {
    try {
      targetUrl = fs.readFileSync(urlFile, 'utf8').trim();
    } catch (e) {
      process.stderr.write(`download-image: cannot read --url-file ${urlFile}: ${e && e.message ? e.message : e}\n`);
      process.exit(2);
    }
    if (!targetUrl) {
      process.stderr.write(`download-image: --url-file ${urlFile} is empty\n`);
      process.exit(2);
    }
  }

  let last = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    last = await attemptDownload(targetUrl);
    if (last.kind === 'ok') {
      const { width, height } = readDimensions(last.buf, last.imgKind);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, last.buf);
      process.stdout.write(JSON.stringify({ status: 'DOWNLOADED', out: dest, bytes: last.buf.length, kind: last.imgKind, width, height, attempts: attempt }) + '\n');
      return;
    }
    if (last.kind === 'hard') {
      process.stderr.write(`download-image: ${last.message}\n`);
      process.exit(1);
    }
    if (attempt < MAX_ATTEMPTS) {
      const wait = BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)];
      process.stderr.write(`download-image: attempt ${attempt}/${MAX_ATTEMPTS} failed (${last.message}); retrying in ${wait}ms\n`);
      await sleep(wait);
    }
  }

  // Retries exhausted. A lingering 401/403 means the signed URL itself is bad — the caller
  // has to re-poll for a fresh one (exit 3). Everything else is a plain hard failure.
  if (last && last.kind === 'reauth') {
    process.stderr.write(
      `download-image: signed URL still rejected after ${MAX_ATTEMPTS} attempts (${last.message}). ` +
      'It is expired or wrong: re-poll GET /v1/generations/<job_id> via text-to-image-request.ts ' +
      'for a fresh processed_preview_image_url / uncropped_cutout_image_url / preview_image_url, then re-run.\n'
    );
    process.exit(3);
  }
  process.stderr.write(`download-image: giving up after ${MAX_ATTEMPTS} attempts (${last ? last.message : 'unknown'}).\n`);
  process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`download-image: ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});
