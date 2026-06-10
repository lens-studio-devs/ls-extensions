#!/usr/bin/env node
// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// normalize_glb.js — Bake a size correction into GLB vertices so every downstream
// SceneObject runs at unit scale. Used by /build-mesh's FAST3D pipeline when the
// orchestrator supplies a target_size_cm.
//
// Why: FAST3D's natural output is often human-scale (~100 cm). The temptation is
// to compensate downstream with `transform.setLocalScale(0.12)`. That leaks the
// scale into every component on the node — ColliderComponent.shape.size reads
// local units, so a 12 cm collider becomes 144 cm in world space. Hard Rule 6.2.
//
// The fix lives at the asset boundary: scale POSITION accessors (and translation
// components of node transforms) so the GLB's AABB matches the intended size.
// Rotations are preserved (orientation, not size). Downstream nodes stay at
// unit scale; colliders sized to `aabb_cm` actually match the visual.
//
// Usage:
//   node normalize_glb.js <input.glb> <output.glb> --max-dim=<cm>
//   node normalize_glb.js <input.glb> <output.glb> --target=W,H,D    (cm, per-axis)
//   node normalize_glb.js <input.glb> <output.glb> --ground          (re-seat only)
//   node normalize_glb.js <input.glb> <output.glb> --yaw=<deg>       (bake a Y rotation)
//   node normalize_glb.js <input.glb> <output.glb> --max-dim=<cm> --yaw=180 --ground
//
// --max-dim:  uniform scale; chosen so max(aabb_cm) === cm.
// --target:   per-axis scale; resulting aabb_cm matches exactly. Use sparingly
//             (warps proportions). Prefer --max-dim for organic FAST3D output.
// --yaw:      bake a rotation (degrees, about world +Y) into the GLB so the mesh's
//             canonical facing is part of the ASSET, not a per-caller fixup. Prepends
//             the rotation to each root node's transform — rotates the node, not the
//             vertices, so normals/tangents stay correct and any hierarchy is honored.
//             Use --yaw=180 to turn an asset that imports facing +Z to face Lens
//             Studio forward (-Z).
// --rotate:   rx,ry,rz euler degrees (applied Rz∘Ry∘Rx) for arbitrary orientation —
//             e.g. an externally-authored mesh lying on its side. General form of --yaw.
// --mark-canonical: stamp asset.extras.lsCanonical = {forward_axis:-Z, upright, grounded,
//             version} so downstream skills know this mesh is already oriented (read it
//             with analyze_glb.js --orient-meta). Pass only AFTER verifying the result
//             faces -Z (a render + look).
//             NOTE: the rotation *value* must be known by the caller — deterministic for
//             our own backends, but for FAST3D / externally-authored meshes the front has
//             to be detected first (render + identify). These tools apply and record the
//             rotation; they do not decide it.
// --ground:   foot-on-floor — translate the roots so the (scaled) world min-Y lands
//             on 0. This unifies the per-backend origin convention: voxel static
//             already bottom-centers, but FAST3D and procedural center on the origin
//             (so half the mesh sits below y=0). With --ground every backend returns
//             a mesh that rests ON the ground plane, so a caller placing it at
//             (x, 0, z) gets feet-on-floor instead of half-buried. Composable with
//             --max-dim / --target / --yaw; applied in order scale → yaw → ground.

const fs = require('fs');

const argv = process.argv.slice(2);
const positional = argv.filter(a => !a.startsWith('--'));
const flags = Object.fromEntries(argv.filter(a => a.startsWith('--')).map(a => {
    const i = a.indexOf('=');
    return i === -1 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)];
}));

const inputPath = positional[0];
const outputPath = positional[1];

if (!inputPath || !outputPath || (!flags['max-dim'] && !flags.target && !flags.ground && flags.yaw === undefined && !flags.rotate && !flags['mark-canonical'])) {
    console.error('Usage: node normalize_glb.js <input.glb> <output.glb> [--max-dim=<cm> | --target=W,H,D] [--yaw=<deg> | --rotate=rx,ry,rz] [--ground] [--mark-canonical]');
    process.exit(1);
}

const buf = fs.readFileSync(inputPath);
if (buf.readUInt32LE(0) !== 0x46546C67) {
    console.error('Not a valid GLB file');
    process.exit(1);
}

const totalLength = buf.readUInt32LE(8);
let offset = 12;
let jsonData = null;
let binBuffer = null;

while (offset < totalLength) {
    const chunkLength = buf.readUInt32LE(offset);
    const chunkType = buf.readUInt32LE(offset + 4);
    const chunkData = buf.slice(offset + 8, offset + 8 + chunkLength);
    if (chunkType === 0x4E4F534A) jsonData = JSON.parse(chunkData.toString('utf8'));
    else if (chunkType === 0x004E4942) binBuffer = Buffer.from(chunkData);
    offset += 8 + chunkLength;
}

if (!jsonData || !binBuffer) {
    console.error('Malformed GLB: missing JSON or BIN chunk');
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Walk scene graph, accumulate current world AABB (same logic as analyze_glb --aabb).
// ---------------------------------------------------------------------------
function makeMatrix(node) {
    if (node.matrix) {
        const m = node.matrix;
        return [m[0], m[4], m[8], m[12],  m[1], m[5], m[9], m[13],  m[2], m[6], m[10], m[14],  m[3], m[7], m[11], m[15]];
    }
    const t = node.translation || [0, 0, 0];
    const r = node.rotation || [0, 0, 0, 1];
    const s = node.scale || [1, 1, 1];
    const [x, y, z, w] = r;
    const xx = x*x, yy = y*y, zz = z*z, xy = x*y, xz = x*z, yz = y*z, wx = w*x, wy = w*y, wz = w*z;
    return [
        s[0]*(1-2*(yy+zz)), s[1]*(2*(xy-wz)),   s[2]*(2*(xz+wy)),   t[0],
        s[0]*(2*(xy+wz)),   s[1]*(1-2*(xx+zz)), s[2]*(2*(yz-wx)),   t[1],
        s[0]*(2*(xz-wy)),   s[1]*(2*(yz+wx)),   s[2]*(1-2*(xx+yy)), t[2],
        0, 0, 0, 1,
    ];
}
function matMul(a, b) {
    const r = new Array(16).fill(0);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) {
        r[i*4+j] += a[i*4+k] * b[k*4+j];
    }
    return r;
}
function xformPoint(m, p) {
    return [
        m[0]*p[0] + m[1]*p[1] + m[2] *p[2] + m[3],
        m[4]*p[0] + m[5]*p[1] + m[6] *p[2] + m[7],
        m[8]*p[0] + m[9]*p[1] + m[10]*p[2] + m[11],
    ];
}

const sceneMin = [Infinity, Infinity, Infinity];
const sceneMax = [-Infinity, -Infinity, -Infinity];
const positionAccessorsUsed = new Set();
const nodes = jsonData.nodes || [];
const rootIds = (jsonData.scenes && jsonData.scenes[jsonData.scene || 0]?.nodes) || nodes.map((_, i) => i);
const identity = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];

function visit(nodeIdx, parentMat) {
    const node = nodes[nodeIdx];
    if (!node) return;
    const worldMat = matMul(parentMat, makeMatrix(node));
    if (node.mesh !== undefined) {
        const mesh = jsonData.meshes[node.mesh];
        for (const prim of mesh.primitives) {
            const posIdx = prim.attributes && prim.attributes.POSITION;
            if (posIdx === undefined) continue;
            positionAccessorsUsed.add(posIdx);
            const acc = jsonData.accessors[posIdx];
            if (!acc.min || !acc.max) continue;
            const [mnX, mnY, mnZ] = acc.min;
            const [mxX, mxY, mxZ] = acc.max;
            const corners = [
                [mnX, mnY, mnZ], [mxX, mnY, mnZ], [mnX, mxY, mnZ], [mxX, mxY, mnZ],
                [mnX, mnY, mxZ], [mxX, mnY, mxZ], [mnX, mxY, mxZ], [mxX, mxY, mxZ],
            ];
            for (const c of corners) {
                const w = xformPoint(worldMat, c);
                for (let i = 0; i < 3; i++) {
                    sceneMin[i] = Math.min(sceneMin[i], w[i]);
                    sceneMax[i] = Math.max(sceneMax[i], w[i]);
                }
            }
        }
    }
    for (const child of node.children || []) visit(child, worldMat);
}
for (const id of rootIds) visit(id, identity);

if (!isFinite(sceneMin[0])) {
    console.error('--- NORMALIZE ERROR: no POSITION accessors found ---');
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Compute scale factors (cm).
// ---------------------------------------------------------------------------
const currentCm = [
    (sceneMax[0] - sceneMin[0]) * 100,
    (sceneMax[1] - sceneMin[1]) * 100,
    (sceneMax[2] - sceneMin[2]) * 100,
];

let scale;
if (flags.target) {
    const [tw, th, td] = flags.target.split(',').map(Number);
    if ([tw, th, td].some(v => !isFinite(v) || v <= 0)) {
        console.error(`--- NORMALIZE ERROR: bad --target=${flags.target} ---`);
        process.exit(1);
    }
    scale = [tw / currentCm[0], th / currentCm[1], td / currentCm[2]];
} else if (flags['max-dim']) {
    const targetMaxCm = Number(flags['max-dim']);
    if (!isFinite(targetMaxCm) || targetMaxCm <= 0) {
        console.error(`--- NORMALIZE ERROR: bad --max-dim=${flags['max-dim']} ---`);
        process.exit(1);
    }
    const currentMaxCm = Math.max(...currentCm);
    const f = targetMaxCm / currentMaxCm;
    scale = [f, f, f];
} else {
    scale = [1, 1, 1]; // --ground only: re-seat on the floor without resizing
}

const willScale = scale.some(s => s !== 1);
console.log(`--- Normalize: current=[${currentCm.map(v => v.toFixed(1)).join(' x ')}] cm, scale=[${scale.map(s => s.toFixed(4)).join(', ')}]${flags.yaw !== undefined ? `, yaw=${flags.yaw}°` : ''}${flags.rotate ? `, rotate=[${flags.rotate}]` : ''}${flags.ground ? ', ground=on' : ''}${flags['mark-canonical'] ? ', mark-canonical' : ''} ---`);

// ---------------------------------------------------------------------------
// Apply scale to BIN positions and to node transforms.
// Positions: multiply per-vertex by `scale` componentwise (BIN buffer in place).
// Node TRS: multiply `translation` and `scale` by `scale`. Rotations untouched.
// Node `matrix` (if present): scale columns 0/1/2 (basis) by `scale`, and
// translation column (col 3) by `scale`.
// ---------------------------------------------------------------------------
function scaleAccessorPositions(accIdx) {
    const acc = jsonData.accessors[accIdx];
    if (acc.componentType !== 5126 || acc.type !== 'VEC3') return; // floats VEC3 only
    const bv = jsonData.bufferViews[acc.bufferView];
    const baseOffset = (bv.byteOffset || 0) + (acc.byteOffset || 0);
    const stride = bv.byteStride || 12;
    for (let i = 0; i < acc.count; i++) {
        const o = baseOffset + i * stride;
        binBuffer.writeFloatLE(binBuffer.readFloatLE(o)     * scale[0], o);
        binBuffer.writeFloatLE(binBuffer.readFloatLE(o + 4) * scale[1], o + 4);
        binBuffer.writeFloatLE(binBuffer.readFloatLE(o + 8) * scale[2], o + 8);
    }
    if (acc.min) acc.min = acc.min.map((v, i) => v * scale[i]);
    if (acc.max) acc.max = acc.max.map((v, i) => v * scale[i]);
}
if (willScale) {
    for (const idx of positionAccessorsUsed) scaleAccessorPositions(idx);

    for (const node of nodes) {
        if (node.matrix) {
            // m is column-major in glTF. Scale columns 0/1/2 basis by scale[col], and col 3 (translation) componentwise.
            const m = node.matrix.slice();
            for (let col = 0; col < 3; col++) {
                for (let row = 0; row < 3; row++) {
                    m[col * 4 + row] *= scale[col];
                }
            }
            m[12] *= scale[0];
            m[13] *= scale[1];
            m[14] *= scale[2];
            node.matrix = m;
            continue;
        }
        if (node.translation) {
            node.translation = node.translation.map((v, i) => v * scale[i]);
        }
        if (node.scale) {
            node.scale = node.scale.map((v, i) => v * scale[i]);
        }
    }
}

// ---------------------------------------------------------------------------
// Bake a rotation into the roots — turn an asset to its canonical facing/upright
// as part of the ASSET. --yaw=<deg> rotates about +Y (the common facing fix:
// +Z→-Z is --yaw=180). --rotate=rx,ry,rz (degrees, applied Rz∘Ry∘Rx) corrects
// arbitrary orientation, e.g. an external mesh lying on its side. Prepends R to
// each root's transform, rotating the subtree about the origin (meshes are
// ~centered in X/Z, so this turns them in place). Rotates the node transform,
// NOT the vertices, so normals/tangents are untouched and any hierarchy holds.
// ---------------------------------------------------------------------------
function rotX(a) { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0,  0, c, -s, 0,  0, s, c, 0,  0, 0, 0, 1]; }
function rotY(a) { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0,  0, 1, 0, 0,  -s, 0, c, 0,  0, 0, 0, 1]; }
function rotZ(a) { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, 0,  s, c, 0, 0,  0, 0, 1, 0,  0, 0, 0, 1]; }

let bakeR = null;
if (flags.yaw !== undefined) {
    const deg = Number(flags.yaw);
    if (!isFinite(deg)) { console.error(`--- NORMALIZE ERROR: bad --yaw=${flags.yaw} ---`); process.exit(1); }
    bakeR = rotY((deg * Math.PI) / 180);
} else if (flags.rotate) {
    const e = flags.rotate.split(',').map(Number);
    if (e.length !== 3 || e.some(v => !isFinite(v))) { console.error(`--- NORMALIZE ERROR: bad --rotate=${flags.rotate} ---`); process.exit(1); }
    const [rx, ry, rz] = e.map(d => (d * Math.PI) / 180);
    bakeR = matMul(rotZ(rz), matMul(rotY(ry), rotX(rx)));
}
if (bakeR) {
    // glTF node.matrix is column-major; makeMatrix returns row-major. Transpose back.
    const toGltf = (M) => {
        const G = new Array(16);
        for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) G[col * 4 + row] = M[row * 4 + col];
        return G;
    };
    for (const id of rootIds) {
        const node = nodes[id];
        if (!node) continue;
        node.matrix = toGltf(matMul(bakeR, makeMatrix(node)));
        delete node.translation;  // can't have matrix AND TRS on the same node
        delete node.rotation;
        delete node.scale;
    }
}

// ---------------------------------------------------------------------------
// Re-walk the scene graph for the current world AABB. Reads the (now scaled
// and/or rotated) accessor min/max + node transforms, so it reflects every
// edit above. Same corner-transform logic as the initial pass / analyze --aabb.
// ---------------------------------------------------------------------------
function worldAabb() {
    const mn = [Infinity, Infinity, Infinity];
    const mx = [-Infinity, -Infinity, -Infinity];
    function walk(nodeIdx, parentMat) {
        const node = nodes[nodeIdx];
        if (!node) return;
        const worldMat = matMul(parentMat, makeMatrix(node));
        if (node.mesh !== undefined) {
            for (const prim of jsonData.meshes[node.mesh].primitives) {
                const posIdx = prim.attributes && prim.attributes.POSITION;
                if (posIdx === undefined) continue;
                const acc = jsonData.accessors[posIdx];
                if (!acc.min || !acc.max) continue;
                const [mnX, mnY, mnZ] = acc.min;
                const [mxX, mxY, mxZ] = acc.max;
                const corners = [
                    [mnX, mnY, mnZ], [mxX, mnY, mnZ], [mnX, mxY, mnZ], [mxX, mxY, mnZ],
                    [mnX, mnY, mxZ], [mxX, mnY, mxZ], [mnX, mxY, mxZ], [mxX, mxY, mxZ],
                ];
                for (const c of corners) {
                    const w = xformPoint(worldMat, c);
                    for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], w[i]); mx[i] = Math.max(mx[i], w[i]); }
                }
            }
        }
        for (const child of node.children || []) walk(child, worldMat);
    }
    for (const id of rootIds) walk(id, identity);
    return { mn, mx };
}

// ---------------------------------------------------------------------------
// Foot-on-floor: translate each root so the scaled world min-Y lands on 0.
// The same global dy applied to every root shifts the whole scene in world
// space regardless of hierarchy depth — no per-vertex rewrite needed, and
// rotations stay intact.
// ---------------------------------------------------------------------------
if (flags.ground) {
    const dy = -worldAabb().mn[1];
    for (const id of rootIds) {
        const node = nodes[id];
        if (!node) continue;
        if (node.matrix) {
            node.matrix[13] += dy;            // column-major translation-Y
        } else {
            const t = node.translation ? node.translation.slice() : [0, 0, 0];
            t[1] += dy;
            node.translation = t;
        }
    }
}

// ---------------------------------------------------------------------------
// Re-emit GLB.
// ---------------------------------------------------------------------------
// Pad BIN to 4-byte alignment.
const binPad = (4 - (binBuffer.length % 4)) % 4;
const binPadded = binPad > 0 ? Buffer.concat([binBuffer, Buffer.alloc(binPad)]) : binBuffer;
// Stamp the canonical-orientation marker so downstream skills know this mesh is
// already oriented (read via analyze_glb.js --orient-meta). Caller passes this only
// after verifying the result faces LS forward (-Z).
if (flags['mark-canonical']) {
    jsonData.asset = jsonData.asset || {};
    jsonData.asset.extras = jsonData.asset.extras || {};
    const prev = jsonData.asset.extras.lsCanonical || {};
    jsonData.asset.extras.lsCanonical = {
        forward_axis: '-Z',
        upright: true,
        grounded: flags.ground ? true : (prev.grounded || false),
        version: 1,
    };
}

// Update buffer length in JSON to match padded BIN, then serialize once.
if (jsonData.buffers && jsonData.buffers[0]) {
    jsonData.buffers[0].byteLength = binPadded.length;
}
let jsonStr = JSON.stringify(jsonData);
while (jsonStr.length % 4 !== 0) jsonStr += ' ';
const jsonBufFinal = Buffer.from(jsonStr, 'utf8');

const totalSize = 12 + 8 + jsonBufFinal.length + 8 + binPadded.length;
const out = Buffer.alloc(totalSize);
let p = 0;
out.writeUInt32LE(0x46546C67, p); p += 4;
out.writeUInt32LE(2, p); p += 4;
out.writeUInt32LE(totalSize, p); p += 4;
out.writeUInt32LE(jsonBufFinal.length, p); p += 4;
out.writeUInt32LE(0x4E4F534A, p); p += 4;
jsonBufFinal.copy(out, p); p += jsonBufFinal.length;
out.writeUInt32LE(binPadded.length, p); p += 4;
out.writeUInt32LE(0x004E4942, p); p += 4;
binPadded.copy(out, p);

fs.writeFileSync(outputPath, out);

// Final report — re-walk so scale AND any ground shift are both reflected.
const fin = worldAabb();
const finCm = fin.mx.map((v, i) => (v - fin.mn[i]) * 100);
const finCenter = fin.mn.map((v, i) => (v + fin.mx[i]) * 0.5 * 100);
console.log(`--- AABB (Lens Studio cm @ 100x import): ${finCm[0].toFixed(1)} x ${finCm[1].toFixed(1)} x ${finCm[2].toFixed(1)} ---`);
console.log(`--- AABB center offset (cm): ${finCenter[0].toFixed(1)}, ${finCenter[1].toFixed(1)}, ${finCenter[2].toFixed(1)} ---`);
if (flags.ground) {
    console.log(`--- AABB min corner (cm): ${(fin.mn[0] * 100).toFixed(1)}, ${(fin.mn[1] * 100).toFixed(1)}, ${(fin.mn[2] * 100).toFixed(1)} ---`);
}
console.log(`--- NORMALIZED: wrote ${outputPath} (${(totalSize / 1024).toFixed(1)} KB) ---`);
