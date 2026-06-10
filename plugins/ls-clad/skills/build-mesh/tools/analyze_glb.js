#!/usr/bin/env node
// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// analyze_glb.js — Parse GLB files and extract mesh geometry statistics
// Usage: node analyze_glb.js <file.glb> [--dump-positions] [--dump-json] [--aabb] [--shape]
//
// --aabb:  emit only the unified AABB lines (Lens Studio cm + center offset).
//          Used by the FAST3D pipeline to align with voxel_toolkit's stdout format.
// --shape: emit a SHAPE line (axis-sorted dims, flatness ratio, flat/sliver flags).
//          Cheap, no-dependency sanity check for the pose-and-completeness contract —
//          catches the "asked for a sphere, got a flat disc" failure mode from AABB alone.
//          Combine with --aabb to get both.

const fs = require('fs');
const path = require('path');

const filePath = process.argv[2];
const dumpPositions = process.argv.includes('--dump-positions');
const dumpJson = process.argv.includes('--dump-json');
const aabbOnly = process.argv.includes('--aabb');
const shapeOnly = process.argv.includes('--shape');
const orientMeta = process.argv.includes('--orient-meta');

if (!filePath) {
    console.error('Usage: node analyze_glb.js <file.glb> [--dump-positions] [--dump-json] [--aabb]');
    process.exit(1);
}

const buf = fs.readFileSync(filePath);

// Parse GLB header
const magic = buf.readUInt32LE(0);
if (magic !== 0x46546C67) {
    console.error('Not a valid GLB file');
    process.exit(1);
}

const version = buf.readUInt32LE(4);
const totalLength = buf.readUInt32LE(8);

// Parse chunks
let offset = 12;
let jsonData = null;
let binBuffer = null;

while (offset < totalLength) {
    const chunkLength = buf.readUInt32LE(offset);
    const chunkType = buf.readUInt32LE(offset + 4);
    const chunkData = buf.slice(offset + 8, offset + 8 + chunkLength);

    if (chunkType === 0x4E4F534A) { // JSON
        jsonData = JSON.parse(chunkData.toString('utf8'));
    } else if (chunkType === 0x004E4942) { // BIN
        binBuffer = chunkData;
    }

    offset += 8 + chunkLength;
}

if (dumpJson) {
    console.log(JSON.stringify(jsonData, null, 2));
    process.exit(0);
}

if (orientMeta) {
    // The canonical-orientation stamp written by normalize_glb.js --mark-canonical.
    // A skill reads this to know whether a mesh is already oriented to LS forward.
    // Absent → the mesh came from outside the system (or pre-dates canonicalization)
    // and must be detected + baked + stamped before use.
    const m = jsonData.asset && jsonData.asset.extras && jsonData.asset.extras.lsCanonical;
    if (m) {
        console.log(`--- ORIENT-META: canonical=true, forward_axis=${m.forward_axis}, upright=${m.upright}, grounded=${m.grounded}, v=${m.version} ---`);
    } else {
        console.log('--- ORIENT-META: none (uncanonicalized — detect + bake before use) ---');
    }
    process.exit(0);
}

if (aabbOnly || shapeOnly) {
    // Walk every node, compose world transforms, transform each mesh primitive's
    // 8 AABB corners (from accessor.min/max) by the node's world matrix, and
    // aggregate into a scene AABB. Output matches voxel_toolkit.py.
    function makeMatrix(node) {
        if (node.matrix) {
            // glTF stores column-major; we use row-major math so transpose.
            const m = node.matrix;
            return [
                m[0], m[4], m[8],  m[12],
                m[1], m[5], m[9],  m[13],
                m[2], m[6], m[10], m[14],
                m[3], m[7], m[11], m[15],
            ];
        }
        const t = node.translation || [0, 0, 0];
        const r = node.rotation || [0, 0, 0, 1]; // quat xyzw
        const s = node.scale || [1, 1, 1];
        const [x, y, z, w] = r;
        const xx = x * x, yy = y * y, zz = z * z;
        const xy = x * y, xz = x * z, yz = y * z;
        const wx = w * x, wy = w * y, wz = w * z;
        return [
            s[0] * (1 - 2 * (yy + zz)), s[1] * (2 * (xy - wz)),     s[2] * (2 * (xz + wy)),     t[0],
            s[0] * (2 * (xy + wz)),     s[1] * (1 - 2 * (xx + zz)), s[2] * (2 * (yz - wx)),     t[1],
            s[0] * (2 * (xz - wy)),     s[1] * (2 * (yz + wx)),     s[2] * (1 - 2 * (xx + yy)), t[2],
            0,                          0,                          0,                          1,
        ];
    }
    function mul(a, b) {
        const r = new Array(16).fill(0);
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) {
            r[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j];
        }
        return r;
    }
    function xform(m, p) {
        return [
            m[0] * p[0] + m[1] * p[1] + m[2]  * p[2] + m[3],
            m[4] * p[0] + m[5] * p[1] + m[6]  * p[2] + m[7],
            m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
        ];
    }

    const sceneMin = [Infinity, Infinity, Infinity];
    const sceneMax = [-Infinity, -Infinity, -Infinity];
    const nodes = jsonData.nodes || [];
    const rootIds = (jsonData.scenes && jsonData.scenes[jsonData.scene || 0]?.nodes) || nodes.map((_, i) => i);

    function visit(nodeIdx, parentMat) {
        const node = nodes[nodeIdx];
        if (!node) return;
        const worldMat = mul(parentMat, makeMatrix(node));
        if (node.mesh !== undefined) {
            const mesh = jsonData.meshes[node.mesh];
            for (const prim of mesh.primitives) {
                const acc = jsonData.accessors[prim.attributes.POSITION];
                if (!acc || !acc.min || !acc.max) continue;
                const [mnX, mnY, mnZ] = acc.min;
                const [mxX, mxY, mxZ] = acc.max;
                const corners = [
                    [mnX, mnY, mnZ], [mxX, mnY, mnZ], [mnX, mxY, mnZ], [mxX, mxY, mnZ],
                    [mnX, mnY, mxZ], [mxX, mnY, mxZ], [mnX, mxY, mxZ], [mxX, mxY, mxZ],
                ];
                for (const c of corners) {
                    const w = xform(worldMat, c);
                    for (let i = 0; i < 3; i++) {
                        sceneMin[i] = Math.min(sceneMin[i], w[i]);
                        sceneMax[i] = Math.max(sceneMax[i], w[i]);
                    }
                }
            }
        }
        for (const child of node.children || []) visit(child, worldMat);
    }

    const identity = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
    for (const id of rootIds) visit(id, identity);

    if (!isFinite(sceneMin[0])) {
        console.error('--- AABB ERROR: no POSITION accessors found ---');
        process.exit(1);
    }
    const sizeCm = sceneMax.map((v, i) => (v - sceneMin[i]) * 100);
    const centerCm = sceneMin.map((v, i) => ((v + sceneMax[i]) * 0.5) * 100);
    if (aabbOnly) {
        console.log(`--- AABB (Lens Studio cm @ 100x import): ${sizeCm[0].toFixed(1)} x ${sizeCm[1].toFixed(1)} x ${sizeCm[2].toFixed(1)} ---`);
        console.log(`--- AABB center offset (cm): ${centerCm[0].toFixed(1)}, ${centerCm[1].toFixed(1)}, ${centerCm[2].toFixed(1)} ---`);
    }
    if (shapeOnly) {
        // Sort axes so the descriptor is rotation-invariant: [thinnest, mid, longest].
        const sorted = [...sizeCm].sort((a, b) => a - b);
        const flatness = sorted[2] > 0 ? sorted[0] / sorted[2] : 1;   // thinnest / longest
        const midRatio = sorted[2] > 0 ? sorted[1] / sorted[2] : 1;   // mid / longest
        const flat = flatness < 0.15;              // one axis ≪ the other two → disc / card / plate
        const sliver = flat && midRatio < 0.3;     // TWO axes ≪ the third → needle / rod
        console.log(`--- SHAPE: sorted_cm=[${sorted.map(v => v.toFixed(1)).join(', ')}], flatness=${flatness.toFixed(3)}, mid_ratio=${midRatio.toFixed(3)}, flat=${flat}, sliver=${sliver} ---`);
    }
    process.exit(0);
}

console.log(`\n=== ${path.basename(filePath)} ===`);
console.log(`GLB Version: ${version}, Total Size: ${(totalLength / 1024).toFixed(1)} KB`);
console.log(`Asset: ${jsonData.asset.generator || 'unknown'}`);

// Helper to read accessor data
function readAccessor(accessorIdx) {
    const accessor = jsonData.accessors[accessorIdx];
    const bv = jsonData.bufferViews[accessor.bufferView];
    const byteOffset = (bv.byteOffset || 0) + (accessor.byteOffset || 0);
    const count = accessor.count;

    const componentSizes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
    const componentSize = componentSizes[accessor.componentType];
    const typeCounts = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
    const typeCount = typeCounts[accessor.type];
    const stride = bv.byteStride || (componentSize * typeCount);

    const result = [];
    for (let i = 0; i < count; i++) {
        const elemOffset = byteOffset + i * stride;
        const elem = [];
        for (let c = 0; c < typeCount; c++) {
            const cOffset = elemOffset + c * componentSize;
            if (accessor.componentType === 5126) {
                elem.push(binBuffer.readFloatLE(cOffset));
            } else if (accessor.componentType === 5123) {
                elem.push(binBuffer.readUInt16LE(cOffset));
            } else if (accessor.componentType === 5125) {
                elem.push(binBuffer.readUInt32LE(cOffset));
            } else if (accessor.componentType === 5121) {
                elem.push(binBuffer.readUInt8(cOffset));
            } else if (accessor.componentType === 5122) {
                elem.push(binBuffer.readInt16LE(cOffset));
            }
        }
        result.push(elem.length === 1 ? elem[0] : elem);
    }
    return { data: result, accessor };
}

// Analyze each mesh
const meshes = jsonData.meshes || [];
let totalVerts = 0;
let totalTris = 0;

for (let mi = 0; mi < meshes.length; mi++) {
    const mesh = meshes[mi];
    console.log(`\nMesh ${mi}: "${mesh.name || 'unnamed'}"`);

    for (let pi = 0; pi < mesh.primitives.length; pi++) {
        const prim = mesh.primitives[pi];
        const attrs = prim.attributes;

        console.log(`  Primitive ${pi}:`);
        console.log(`    Attributes: ${Object.keys(attrs).join(', ')}`);

        // Position data
        if (attrs.POSITION !== undefined) {
            const posData = readAccessor(attrs.POSITION);
            const positions = posData.data;
            const acc = posData.accessor;
            console.log(`    Vertices: ${positions.length}`);
            totalVerts += positions.length;

            if (acc.min && acc.max) {
                const size = acc.max.map((v, i) => v - acc.min[i]);
                console.log(`    Bounding Box: min=[${acc.min.map(v => v.toFixed(3)).join(', ')}] max=[${acc.max.map(v => v.toFixed(3)).join(', ')}]`);
                console.log(`    Size: [${size.map(v => v.toFixed(3)).join(', ')}]`);
            }

            if (dumpPositions) {
                console.log(`    First 10 positions:`);
                for (let i = 0; i < Math.min(10, positions.length); i++) {
                    console.log(`      [${positions[i].map(v => v.toFixed(4)).join(', ')}]`);
                }
            }
        }

        // Normal data
        if (attrs.NORMAL !== undefined) {
            const normData = readAccessor(attrs.NORMAL);
            // Check normal quality
            let badNormals = 0;
            for (const n of normData.data) {
                const len = Math.sqrt(n[0]*n[0] + n[1]*n[1] + n[2]*n[2]);
                if (Math.abs(len - 1.0) > 0.01) badNormals++;
            }
            console.log(`    Normals: ${normData.data.length}${badNormals > 0 ? ` (${badNormals} non-unit!)` : ' (all unit-length)'}`);
        }

        // UV data
        if (attrs.TEXCOORD_0 !== undefined) {
            const uvData = readAccessor(attrs.TEXCOORD_0);
            let outOfRange = 0;
            for (const uv of uvData.data) {
                if (uv[0] < 0 || uv[0] > 1 || uv[1] < 0 || uv[1] > 1) outOfRange++;
            }
            console.log(`    UVs: ${uvData.data.length}${outOfRange > 0 ? ` (${outOfRange} outside [0,1])` : ' (all in [0,1])'}`);
        }

        // Tangent data
        if (attrs.TANGENT !== undefined) {
            console.log(`    Has TANGENT data`);
        }

        // Index data
        if (prim.indices !== undefined) {
            const idxData = readAccessor(prim.indices);
            const triCount = idxData.data.length / 3;
            totalTris += triCount;
            console.log(`    Indices: ${idxData.data.length} (${triCount} triangles)`);

            // Compute triangle quality metrics
            if (attrs.POSITION !== undefined) {
                const positions = readAccessor(attrs.POSITION).data;
                const indices = idxData.data;

                // Analyze triangle sizes and angles
                let totalArea = 0;
                let minArea = Infinity;
                let maxArea = -Infinity;
                let degenerateCount = 0;
                let minAngle = Infinity;
                let maxAngle = -Infinity;

                // Count shared vertices (connectivity)
                const vertexTriCount = new Array(positions.length).fill(0);

                for (let t = 0; t < triCount; t++) {
                    const i0 = indices[t * 3];
                    const i1 = indices[t * 3 + 1];
                    const i2 = indices[t * 3 + 2];

                    vertexTriCount[i0]++;
                    vertexTriCount[i1]++;
                    vertexTriCount[i2]++;

                    const p0 = positions[i0];
                    const p1 = positions[i1];
                    const p2 = positions[i2];

                    // Edge vectors
                    const e1 = [p1[0]-p0[0], p1[1]-p0[1], p1[2]-p0[2]];
                    const e2 = [p2[0]-p0[0], p2[1]-p0[1], p2[2]-p0[2]];

                    // Cross product for area
                    const cx = e1[1]*e2[2] - e1[2]*e2[1];
                    const cy = e1[2]*e2[0] - e1[0]*e2[2];
                    const cz = e1[0]*e2[1] - e1[1]*e2[0];
                    const area = 0.5 * Math.sqrt(cx*cx + cy*cy + cz*cz);

                    totalArea += area;
                    if (area < 1e-8) {
                        degenerateCount++;
                    } else {
                        minArea = Math.min(minArea, area);
                        maxArea = Math.max(maxArea, area);
                    }

                    // Min angle in triangle
                    const edges = [
                        [p1[0]-p0[0], p1[1]-p0[1], p1[2]-p0[2]],
                        [p2[0]-p1[0], p2[1]-p1[1], p2[2]-p1[2]],
                        [p0[0]-p2[0], p0[1]-p2[1], p0[2]-p2[2]]
                    ];
                    const lens = edges.map(e => Math.sqrt(e[0]*e[0]+e[1]*e[1]+e[2]*e[2]));
                    if (lens[0] > 0 && lens[1] > 0 && lens[2] > 0) {
                        // Angle at vertex 0
                        const dot01 = -(edges[0][0]*edges[2][0]+edges[0][1]*edges[2][1]+edges[0][2]*edges[2][2]);
                        const ang0 = Math.acos(Math.max(-1, Math.min(1, dot01/(lens[0]*lens[2])))) * 180/Math.PI;
                        // Angle at vertex 1
                        const dot12 = -(edges[1][0]*edges[0][0]+edges[1][1]*edges[0][1]+edges[1][2]*edges[0][2]);
                        const ang1 = Math.acos(Math.max(-1, Math.min(1, dot12/(lens[1]*lens[0])))) * 180/Math.PI;
                        const ang2 = 180 - ang0 - ang1;

                        const triMin = Math.min(ang0, ang1, ang2);
                        const triMax = Math.max(ang0, ang1, ang2);
                        minAngle = Math.min(minAngle, triMin);
                        maxAngle = Math.max(maxAngle, triMax);
                    }
                }

                // Vertices-per-triangle ratio
                const vpt = positions.length / triCount;
                // Average triangles sharing a vertex
                const avgShared = vertexTriCount.reduce((a,b)=>a+b,0) / positions.length;

                console.log(`    --- Triangle Quality ---`);
                console.log(`    Total surface area: ${totalArea.toFixed(4)}`);
                console.log(`    Triangle area range: [${minArea.toFixed(6)}, ${maxArea.toFixed(4)}] (ratio: ${(maxArea/minArea).toFixed(1)}x)`);
                console.log(`    Degenerate triangles: ${degenerateCount}`);
                console.log(`    Angle range: [${minAngle.toFixed(1)}°, ${maxAngle.toFixed(1)}°]`);
                console.log(`    Vertex/triangle ratio: ${vpt.toFixed(2)} (ideal ~0.5-0.6 for closed mesh)`);
                console.log(`    Avg triangles per vertex: ${avgShared.toFixed(1)} (smooth mesh ~5-6)`);
            }
        }

        // Mode
        const modes = { 0:'POINTS', 1:'LINES', 2:'LINE_LOOP', 3:'LINE_STRIP', 4:'TRIANGLES', 5:'TRIANGLE_STRIP', 6:'TRIANGLE_FAN' };
        console.log(`    Mode: ${modes[prim.mode || 4] || prim.mode}`);

        // Material
        if (prim.material !== undefined && jsonData.materials) {
            const mat = jsonData.materials[prim.material];
            console.log(`    Material: "${mat.name || 'unnamed'}"`);
            if (mat.pbrMetallicRoughness) {
                const pbr = mat.pbrMetallicRoughness;
                if (pbr.baseColorFactor) console.log(`      Base color: [${pbr.baseColorFactor.join(', ')}]`);
                if (pbr.metallicFactor !== undefined) console.log(`      Metallic: ${pbr.metallicFactor}`);
                if (pbr.roughnessFactor !== undefined) console.log(`      Roughness: ${pbr.roughnessFactor}`);
                if (pbr.baseColorTexture) console.log(`      Has base color texture`);
                if (pbr.metallicRoughnessTexture) console.log(`      Has metallic-roughness texture`);
            }
            if (mat.normalTexture) console.log(`      Has normal map`);
            if (mat.occlusionTexture) console.log(`      Has AO texture`);
            if (mat.emissiveTexture) console.log(`      Has emissive texture`);
        }
    }
}

console.log(`\n--- TOTALS ---`);
console.log(`Total meshes: ${meshes.length}`);
console.log(`Total vertices: ${totalVerts}`);
console.log(`Total triangles: ${totalTris}`);
console.log(`Geometry size estimate: ${((totalVerts * 32 + totalTris * 6) / 1024).toFixed(1)} KB`);

// Scene hierarchy
if (jsonData.nodes) {
    console.log(`\nScene nodes: ${jsonData.nodes.length}`);
}
if (jsonData.textures) {
    console.log(`Textures: ${jsonData.textures.length}`);
}
if (jsonData.images) {
    console.log(`Images: ${jsonData.images.length}`);
    for (const img of jsonData.images) {
        if (img.bufferView !== undefined) {
            const bv = jsonData.bufferViews[img.bufferView];
            console.log(`  ${img.mimeType || 'unknown'}: ${(bv.byteLength / 1024).toFixed(1)} KB`);
        }
    }
}
