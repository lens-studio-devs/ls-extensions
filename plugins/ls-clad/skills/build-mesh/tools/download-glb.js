#!/usr/bin/env node
// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// Download a finished text-to-3D asset to disk. The `asset_url` on a succeeded job is a signed
// URL, so this is an UNauthenticated GET — auth happened earlier on the
// create/poll calls. In node so it runs under the plugin's Bash(node:*) allowlist.
//
// Usage: node download-glb.js --url "<asset_url>" --out "Assets/GeneratedMeshes/<Name>.glb"
//
// Requires Node 18+ (global fetch). On HTTP 401/403 the asset URL needs an
// authorized download instead — fetch it via text-to-3d-request.ts in the editor.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

function usage() {
  process.stderr.write('Usage: node download-glb.js --url "<asset_url>" --out "Assets/GeneratedMeshes/<Name>.glb"\n');
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
        process.stderr.write(`download-glb: missing value for ${arg}\n`);
        process.exit(2);
      }
      value = argv[++i];
    }
    if (arg === '--url') out.url = value;
    else if (arg === '--out') out.dest = value;
    else { process.stderr.write(`download-glb: unknown argument: ${arg}\n`); process.exit(2); }
  }
  return out;
}

async function main() {
  const { url, dest } = parseArgs(process.argv.slice(2));
  if (!url || !dest) { usage(); process.exit(2); }

  const res = await fetch(url);
  if (!res.ok) {
    process.stderr.write(
      `download-glb: HTTP ${res.status} ${res.statusText}. ` +
      (res.status === 401 || res.status === 403
        ? 'The asset URL requires an authorized download — fetch it via text-to-3d-request.ts in the editor instead.\n'
        : '\n')
    );
    process.exit(1);
  }
  const MAX_BYTES = 512 * 1024 * 1024; // generous cap; a generated GLB is far smaller — guards against a runaway/huge response
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    process.stderr.write(`download-glb: refusing response of ${declared} bytes (> ${MAX_BYTES}-byte cap); not a normal GLB.\n`);
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  // A signed URL can return HTTP 200 with an error page (expired/misconfigured CDN), which would
  // otherwise be written verbatim as a .glb. GLB files begin with the 12-byte header whose first
  // 4 bytes are the ASCII magic "glTF" — reject anything else before writing.
  if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'glTF') {
    const peek = buf.toString('utf8', 0, 200).replace(/\s+/g, ' ').trim();
    process.stderr.write(
      `download-glb: response is not a GLB (missing 'glTF' magic; ${buf.length} bytes). ` +
      `The URL likely returned an error page despite HTTP 200. First bytes: ${peek}\n`
    );
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  process.stdout.write(JSON.stringify({ status: 'DOWNLOADED', out: dest, bytes: buf.length }) + '\n');
}

main().catch((err) => {
  process.stderr.write(`download-glb: ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});
