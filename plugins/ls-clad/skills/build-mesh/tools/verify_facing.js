#!/usr/bin/env node
// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * verify_facing.js — guards the Lens Studio facing convention across the two places
 * the mesh pipeline encodes it, so a sign regression in either fails the commit
 * instead of shipping silently.
 *
 *   (A) RUNTIME side — specs-experience-builder.md, Essential Pattern 10
 *       `faceDirection()` rotates a moving mesh per-frame from the baked -Z
 *       baseline toward its travel vector.
 *   (B) BAKE side — normalize_glb.js `rotY()` rotates GLB node transforms so a
 *       mesh's front is baked to Lens Studio forward (-Z) in the first place.
 *
 * Why this exists: the runtime formula once shipped `yaw = atan2(-dir.x, -dir.z)`,
 * which negates the yaw — correct only for +/-Z travel, 180-degrees-reversed
 * (tail-first) for any +/-X travel. A live helicopter build flew tail-first between
 * two pads that shared a Z coordinate (pure-X travel) before it was caught.
 *
 * Lens Studio runtime convention (right-handed, -Z is forward), verified against a
 * live build: a -Z front yawed by t about +Y via quat.fromEulerAngles(0,t,0) points
 * to world (sin t, 0, -cos t). The correct heading formula is atan2(dir.x, -dir.z).
 *
 * normalize_glb's rotY is the standard right-handed glTF Y-rotation, which sends -Z
 * to (-sin t, 0, -cos t) in glTF node space. Note the X sign is OPPOSITE the runtime
 * convention: that is expected and fine. The bake and the runtime never equate their
 * numeric yaws — they meet only at the geometric -Z canonical pose, which the bake
 * reaches by re-render verification, not by sharing a sign. This check pins each side
 * to its correct form AND pins that known relationship, so drift in either is caught.
 *
 * Run it directly (or in CI) when touching the facing convention:
 *   node plugins/ls-clad/skills/build-mesh/tools/verify_facing.js
 * Exit 0 = pass, 1 = a convention regression.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let failures = 0;
const fail = (m) => { console.error(`  x ${m}`); failures++; };
const pass = (m) => { console.log(`  ok ${m}`); };
const warn = (m) => { console.log(`  - ${m}`); };
const approx = (a, b) => Math.abs(a - b) < 1e-9;

const TOOLS_DIR = __dirname;
// tools -> build-mesh -> skills -> ls-clad -> plugins -> repo root
const REPO = path.join(__dirname, '..', '..', '..', '..', '..');
const AGENT_MD = path.join(REPO, 'plugins', 'ls-clad', 'agents', 'specs-experience-builder.md');
const NORMALIZE = path.join(TOOLS_DIR, 'normalize_glb.js');

// --- ground truth: where a -Z front points after a runtime yaw t about +Y ----------
const runtimeForward = (t) => ({ x: Math.sin(t), z: -Math.cos(t) });

// row-major mat4 (flat 16) applied to (x,y,z,1) -> {x,y,z}
const applyMat = (m, x, y, z) => ({
  x: m[0] * x + m[1] * y + m[2] * z + m[3],
  y: m[4] * x + m[5] * y + m[6] * z + m[7],
  z: m[8] * x + m[9] * y + m[10] * z + m[11],
});

const shippedYaw = (d) => Math.atan2(d.x, -d.z);
const buggyYaw = (d) => Math.atan2(-d.x, -d.z);
const norm2 = (d) => { const m = Math.hypot(d.x, d.z); return m < 1e-9 ? { x: 0, z: 0 } : { x: d.x / m, z: d.z / m }; };
const dot = (a, b) => a.x * b.x + a.z * b.z;
const rad = (deg) => (deg * Math.PI) / 180;

const CASES = [
  { name: '+X (right)', dir: { x: 1, z: 0 }, deg: 90 },
  { name: '-X (left)', dir: { x: -1, z: 0 }, deg: -90 },
  { name: '-Z (forward)', dir: { x: 0, z: -1 }, deg: 0 },
  { name: '+Z (toward viewer)', dir: { x: 0, z: 1 }, deg: 180 },
  { name: 'diagonal +X / -Z', dir: { x: 1, z: -1 }, deg: 45 },
];

console.log('Facing convention checks\n');

// === A) RUNTIME: faceDirection in the orchestrator =================================
console.log('A) runtime faceDirection (specs-experience-builder.md)');
for (const c of CASES) {
  const yaw = shippedYaw(c.dir);
  const deg = (yaw * 180) / Math.PI;
  if (dot(runtimeForward(yaw), norm2(c.dir)) > 1 - 1e-6 && approx(deg, c.deg)) {
    pass(`${c.name}: yaw=${deg.toFixed(0)} deg -> front faces travel`);
  } else {
    fail(`${c.name}: yaw=${deg.toFixed(1)} deg (want ${c.deg}) -> front does NOT face travel`);
  }
}
{
  const d = { x: 1, z: 0 };
  if (dot(runtimeForward(buggyYaw(d)), norm2(d)) < -1 + 1e-6) {
    pass('legacy atan2(-dir.x,-dir.z) still reverses on +X -> bug stays documented, not reintroduced');
  } else {
    fail('legacy formula no longer reverses on +X -> the convention assumption changed; revisit this check');
  }
}
// source guard: the shipped formula must still be atan2(dir.x, -dir.z)
{
  if (!fs.existsSync(AGENT_MD)) {
    warn(`agent markdown not present at ${path.relative(REPO, AGENT_MD)} (skipping source guard)`);
  } else {
    const src = fs.readFileSync(AGENT_MD, 'utf8');
    const i = src.indexOf('function faceDirection');
    const m = i >= 0 && src.slice(i).match(/Math\.atan2\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)/);
    if (!m) {
      fail('faceDirection Math.atan2(...) not found in agent markdown -> format changed; update this check');
    } else if (m[1].trim() === 'dir.x' && m[2].trim() === '-dir.z') {
      pass(`agent markdown ships Math.atan2(${m[1].trim()}, ${m[2].trim()})`);
    } else {
      fail(`agent markdown ships Math.atan2(${m[1].trim()}, ${m[2].trim()}); expected (dir.x, -dir.z) -> movers fly tail-first on +/-X`);
    }
  }
}

// === B) BAKE: normalize_glb.js rotY() ==============================================
console.log('\nB) bake rotation (normalize_glb.js rotY)');
let rotY = null;
{
  if (!fs.existsSync(NORMALIZE)) {
    fail(`normalize_glb.js not found at ${NORMALIZE}`);
  } else {
    const m = fs.readFileSync(NORMALIZE, 'utf8').match(/function\s+rotY\s*\([^)]*\)\s*\{[\s\S]*?\}/);
    if (!m) fail('rotY() not found in normalize_glb.js -> format changed; update this check');
    else {
      try { rotY = new Function('return (' + m[0] + ')')(); }
      catch (e) { fail(`could not evaluate rotY from source: ${e.message}`); }
    }
  }
}
if (rotY) {
  let ok = true;
  for (const deg of [0, 45, 90, 180]) {
    const t = rad(deg);
    const f = applyMat(rotY(t), 0, 0, -1);
    if (!(approx(f.x, -Math.sin(t)) && approx(f.z, -Math.cos(t)))) {
      ok = false;
      fail(`rotY(${deg}) . (-Z) = (${f.x.toFixed(3)}, _, ${f.z.toFixed(3)}); expected (${(-Math.sin(t)).toFixed(3)}, _, ${(-Math.cos(t)).toFixed(3)})`);
    }
  }
  if (ok) pass('rotY is the standard right-handed glTF Y-rotation: -Z -> (-sin t, 0, -cos t)');
}

// === C) BAKE <-> RUNTIME relationship (drift guard) ================================
console.log('\nC) bake <-> runtime relationship');
if (rotY) {
  // Invariant: bake (glTF space) and LS runtime (LS space) are opposite-handed about
  // +Y -> same Z, opposite X for the same angle. They meet only at the geometric -Z
  // canonical pose (re-render-verified), never by equating numeric yaws. If either
  // side's sign drifts this relationship breaks and the commit fails.
  let ok = true;
  for (const deg of [30, 90, 135]) {
    const t = rad(deg);
    const b = applyMat(rotY(t), 0, 0, -1);
    const r = runtimeForward(t);
    if (!(approx(b.z, r.z) && approx(b.x, -r.x))) {
      ok = false;
      fail(`angle=${deg}: bake(-Z)=(${b.x.toFixed(3)},_,${b.z.toFixed(3)}) vs runtime=(${r.x.toFixed(3)},_,${r.z.toFixed(3)}) -> handedness relationship changed`);
    }
  }
  if (ok) pass('bake and runtime Y-rotation differ only by X sign (expected) -> neither side has drifted');
}

if (failures) {
  console.error(`\nFAILED: ${failures} check(s). See specs-experience-builder.md Essential Pattern 10 and normalize_glb.js rotY.`);
  process.exit(1);
}
console.log('\nOK: runtime faceDirection and bake rotation both match the verified Lens Studio facing convention.');
