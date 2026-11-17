// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0
//
// measure-world-aabb · Editor API helper for the refit / placement-verify pass.
//   Returns each requested mesh's world-space AABB in cm by transforming the mesh's
//   LOCAL AABB corners (RenderMeshVisual mesh.info.aabbMin/aabbMax) by the geometry
//   node's world ROTATION *and* SCALE. Composing rotation is the whole point: a mesh
//   whose orientation was baked into its node transform (normalize_glb.js --rotate
//   writes it onto node.matrix, NOT the vertices) has a local extent that does not
//   match what renders. The old `aabbSize x worldScale` (scale only) silently dropped
//   that rotation and mis-reported the axes — a mark rotated 90deg about X reads local
//   [8,8,1] (on edge) but renders [8,1,8] (flat). Transforming the 8 corners reports
//   the RENDERED size/orientation.
//   Caveat: the engine's authoritative RenderMeshVisual.worldAabbMin()/worldAabbMax()
//   is NOT exposed editor-side, so we reconstruct from worldTransform, whose rotation
//   is EULER degrees (no quaternion) — exact for single-axis rotations (what
//   canonicalization produces) and axis-aligned scale; a compound world rotation under
//   non-uniform scale is approximated (Euler order Rz*Ry*Rx, shear dropped). For the
//   ground-truth engine AABB see the runtime QueryRuntimeScene.
// Compiled (not inline TS in a doc) so CI type-checks it against editor.d.ts.
// Run via make-eec-script.py (fills CONFIG) -> ExecuteEditorCode path:
//   --json TARGETS=<[{ "name": "Board" } | { "id": "<uuid>" }, ...]>
// Returns { measured: [{ name, id, found, localAabb, worldScale, worldRotationEuler, worldAabbCm, note }] }.

// ===================== CONFIG — replace per call =====================
const TARGETS: Array<{ name?: string; id?: string }> = [];
// =====================================================================

const model = pluginSystem.findInterface(Editor.Model.IModel) as Editor.Model.IModel;
if (!model) {
  return { error: "no IModel" };
}
const scene = model.project.scene;

function v3(v: any): { x: number; y: number; z: number } | null {
  return v ? { x: v.x, y: v.y, z: v.z } : null;
}

function compType(c: any): string {
  try {
    return c.getTypeName ? c.getTypeName() : (c.constructor ? c.constructor.name : "");
  } catch (e) {
    return "";
  }
}

// The local vertex-extent AABB corners of a RenderMeshVisual's mesh, in the mesh's own
// (raw) units. Returns aabbMin/aabbMax (corners, not just size) so a rotation can be
// composed onto them; falls back to +/-aabbSize/2 if only aabbSize is present.
function meshAabb(so: any): { min: any; max: any; node: any } | null {
  const comps = so.components || [];
  for (const c of comps) {
    if (compType(c).indexOf("RenderMeshVisual") < 0) {
      continue;
    }
    try {
      const info = (c as any).mesh ? (c as any).mesh.info : null;
      if (info && info.aabbMin && info.aabbMax) {
        return { min: info.aabbMin, max: info.aabbMax, node: so };
      }
      if (info && info.aabbSize) {
        const s = info.aabbSize;
        return { min: { x: -s.x / 2, y: -s.y / 2, z: -s.z / 2 }, max: { x: s.x / 2, y: s.y / 2, z: s.z / 2 }, node: so };
      }
    } catch (e) {
      // fall through to children
    }
  }
  const kids = so.children || [];
  for (const k of kids) {
    const r = meshAabb(k);
    if (r) {
      return r;
    }
  }
  return null;
}

// The geometry node's cumulative WORLD transform. rotation is Euler degrees (editor
// worldTransform exposes no quaternion and no matrix); scale is the cumulative world
// scale (import x wrappers).
function worldRotScale(so: any): { rot: { x: number; y: number; z: number }; scale: { x: number; y: number; z: number } } | null {
  try {
    const wt = (so as any).worldTransform;
    const rot = v3(wt.rotation) || { x: 0, y: 0, z: 0 };
    const scale = v3(wt.getWorldScale ? wt.getWorldScale() : wt.scale);
    if (!scale) {
      return null;
    }
    return { rot, scale };
  } catch (e) {
    return null;
  }
}

// Rotate a vector by Euler degrees, order Rz*Ry*Rx (v' = Rz*Ry*Rx*v). Exact for
// single-axis rotations; the engine's Euler convention for compound rotations may
// differ (see header caveat).
function rotEuler(vx: number, vy: number, vz: number, rx: number, ry: number, rz: number): [number, number, number] {
  const D2R = Math.PI / 180;
  let x = vx, y = vy, z = vz;
  let c = Math.cos(rx * D2R), s = Math.sin(rx * D2R);
  let ny = y * c - z * s, nz = y * s + z * c; y = ny; z = nz;
  c = Math.cos(ry * D2R); s = Math.sin(ry * D2R);
  let nx = x * c + z * s; nz = -x * s + z * c; x = nx; z = nz;
  c = Math.cos(rz * D2R); s = Math.sin(rz * D2R);
  nx = x * c - y * s; ny = x * s + y * c; x = nx; y = ny;
  return [x, y, z];
}

// World AABB size in cm: transform the 8 local corners by world scale then rotation,
// and take the axis-aligned extent (max - min). Composes rotation, unlike size x scale.
function worldAabbCmOf(mn: any, mx: any, rot: { x: number; y: number; z: number }, scale: { x: number; y: number; z: number }): [number, number, number] {
  const lo = [mn.x, mn.y, mn.z], hi = [mx.x, mx.y, mx.z];
  const wmn = [Infinity, Infinity, Infinity], wmx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const cx = (i & 1 ? hi[0] : lo[0]) * scale.x;
    const cy = (i & 2 ? hi[1] : lo[1]) * scale.y;
    const cz = (i & 4 ? hi[2] : lo[2]) * scale.z;
    const w = rotEuler(cx, cy, cz, rot.x, rot.y, rot.z);
    for (let d = 0; d < 3; d++) {
      if (w[d] < wmn[d]) { wmn[d] = w[d]; }
      if (w[d] > wmx[d]) { wmx[d] = w[d]; }
    }
  }
  return [wmx[0] - wmn[0], wmx[1] - wmn[1], wmx[2] - wmn[2]];
}

function idOf(so: any): string {
  try {
    return String(so.uniqueIdentifier || (so.id && so.id.value) || "");
  } catch (e) {
    return "";
  }
}

function matches(so: any, t: { name?: string; id?: string }): boolean {
  if (t.id && idOf(so) === t.id) {
    return true;
  }
  if (t.name && so.name === t.name) {
    return true;
  }
  return false;
}

function find(t: { name?: string; id?: string }): any {
  let hit: any = null;
  function walk(so: any): void {
    if (hit) {
      return;
    }
    if (matches(so, t)) {
      hit = so;
      return;
    }
    for (const k of so.children || []) {
      walk(k);
    }
  }
  for (const r of scene.rootSceneObjects) {
    walk(r);
  }
  return hit;
}

const measured = TARGETS.map((t) => {
  const so = find(t);
  if (!so) {
    return { name: t.name || null, id: t.id || null, found: false };
  }
  const ma = meshAabb(so);
  if (!ma) {
    return { name: so.name, id: idOf(so), found: true, note: "no RenderMeshVisual mesh under this object" };
  }
  const rs = worldRotScale(ma.node);
  const localMin = v3(ma.min);
  const localMax = v3(ma.max);
  const localSize = (localMin && localMax)
    ? [localMax.x - localMin.x, localMax.y - localMin.y, localMax.z - localMin.z]
    : null;
  const worldAabbCm = (localMin && localMax && rs)
    ? worldAabbCmOf(localMin, localMax, rs.rot, rs.scale)
    : null;
  return {
    name: so.name,
    id: idOf(so),
    found: true,
    localAabb: localSize,             // raw local vertex extent (pre node rotation/scale; meters for a meter GLB)
    worldScale: rs ? rs.scale : null, // cumulative world scale on the geometry node
    worldRotationEuler: rs ? rs.rot : null, // world rotation (Euler degrees) composed into worldAabbCm
    worldAabbCm,                      // rendered size in cm: local corners x scale then rotation
    note: "worldAabbCm composes node ROTATION+scale (the rendered size); compare to target_size_cm. localAabb alone omits rotation.",
  };
});

return { measured };
