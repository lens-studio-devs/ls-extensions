<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Primitive Helpers

Canonical `Triangles`-topology builders for common primitives. All produce **CCW winding from outside** so they render correctly under default back-face culling. Every triangle in this file has been verified numerically: `(v1 − v0) × (v2 − v0)` points along the face's outward normal. If you modify a helper or write a new one, re-verify the same way — do not trust an index pattern copied from a different vertex labeling.

All helpers assume the builder was constructed with this layout:

```ts
const builder = new MeshBuilder([
  { name: "position", components: 3 },
  { name: "normal",   components: 3, normalized: true },
  { name: "color",    components: 4 },
]);
builder.topology = MeshTopology.Triangles;
builder.indexType = MeshIndexType.UInt16;
```

## Box / cube — all 6 faces with verified CCW winding

Copying a single quad's `[0,1,2, 0,2,3]` index pattern to all 6 faces with only positions rotated produces CW winding on at least 3 faces. Use this helper instead.

```ts
function addBox(
  builder: MeshBuilder,
  indices: number[],
  cx: number, cy: number, cz: number,
  hw: number, hh: number, hd: number,   // half-extents on x, y, z
  color: [number, number, number, number],
  baseIdx: number
): number {
  const x0 = cx - hw, x1 = cx + hw;
  const y0 = cy - hh, y1 = cy + hh;
  const z0 = cz - hd, z1 = cz + hd;

  const verts: number[] = [];
  let vi = baseIdx;

  const face = (
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
    n:  [number, number, number],
  ) => {
    verts.push(
      ...p0, ...n, ...color,
      ...p1, ...n, ...color,
      ...p2, ...n, ...color,
      ...p3, ...n, ...color,
    );
    // CCW from outside: p0 → p1 → p2 → p3 traces counter-clockwise
    indices.push(vi, vi+1, vi+2,  vi, vi+2, vi+3);
    vi += 4;
  };

  face([x1,y0,z0], [x1,y1,z0], [x1,y1,z1], [x1,y0,z1], [ 1, 0, 0]); // +X
  face([x0,y0,z1], [x0,y1,z1], [x0,y1,z0], [x0,y0,z0], [-1, 0, 0]); // -X
  face([x0,y1,z0], [x0,y1,z1], [x1,y1,z1], [x1,y1,z0], [ 0, 1, 0]); // +Y
  face([x0,y0,z1], [x0,y0,z0], [x1,y0,z0], [x1,y0,z1], [ 0,-1, 0]); // -Y
  face([x0,y0,z1], [x1,y0,z1], [x1,y1,z1], [x0,y1,z1], [ 0, 0, 1]); // +Z
  face([x1,y0,z0], [x0,y0,z0], [x0,y1,z0], [x1,y1,z0], [ 0, 0,-1]); // -Z

  builder.appendVerticesInterleaved(verts);
  return vi;
}
```

Usage:

```ts
const indices: number[] = [];
let vi = 0;
vi = addBox(builder, indices, 0, 0, 0, 5, 5, 5, [1, 0.5, 0.2, 1], vi);
builder.appendIndices(indices);

rmv.mesh = builder.getMesh();
builder.updateMesh();
```

## Cylinder — capped tube along the X-axis

Side-face winding is the most common mistake — and index patterns are **only valid for the exact vertex labeling they were written for**. The `[bl, tr, br, bl, tl, tr]` pattern below is correct for THIS layout (bl/br = left/right verts of angle *i*, tl/tr = angle *i+1*); applied to a screen-space-labeled quad it is CW and gets culled. Never copy a winding pattern across helpers — check each triangle with the cross-product rule instead. Caps use opposite winding directions — left cap (−X normal) is CCW `[center, a1, a0]`; right cap (+X normal) is CCW `[center, a0, a1]`.

```ts
function buildCylinder(
  builder: MeshBuilder,
  radius: number,
  halfWidth: number,
  segments: number,
  r: number, g: number, b: number, a: number
) {
  // --- Side surface: 2*(segments+1) verts ---
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const cy = Math.cos(angle) * radius;
    const cz = Math.sin(angle) * radius;
    const ny = Math.cos(angle), nz = Math.sin(angle);
    builder.appendVerticesInterleaved([-halfWidth, cy, cz, 0, ny, nz, r, g, b, a]); // left
    builder.appendVerticesInterleaved([ halfWidth, cy, cz, 0, ny, nz, r, g, b, a]); // right
  }
  // Winding [bl, tr, br,  bl, tl, tr] is CCW for THIS labeling (bl/br = angle i,
  // tl/tr = angle i+1) — verified by cross-product. Not a universal quad pattern.
  for (let i = 0; i < segments; i++) {
    const bl = i * 2, br = i * 2 + 1, tl = (i + 1) * 2, tr = (i + 1) * 2 + 1;
    builder.appendIndices([bl, tr, br,  bl, tl, tr]);
  }

  const sideCount = (segments + 1) * 2;

  // --- Left cap (normal = -X): CCW when viewed from -X → [center, a1, a0] ---
  const leftCenter = sideCount;
  builder.appendVerticesInterleaved([-halfWidth, 0, 0, -1, 0, 0, r, g, b, a]);
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    builder.appendVerticesInterleaved([-halfWidth, Math.cos(angle) * radius, Math.sin(angle) * radius, -1, 0, 0, r, g, b, a]);
  }
  for (let i = 0; i < segments; i++) {
    builder.appendIndices([leftCenter, leftCenter + 1 + i + 1, leftCenter + 1 + i]);
  }

  // --- Right cap (normal = +X): CCW when viewed from +X → [center, a0, a1] ---
  const rightCenter = leftCenter + 1 + (segments + 1);
  builder.appendVerticesInterleaved([halfWidth, 0, 0, 1, 0, 0, r, g, b, a]);
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    builder.appendVerticesInterleaved([halfWidth, Math.cos(angle) * radius, Math.sin(angle) * radius, 1, 0, 0, r, g, b, a]);
  }
  for (let i = 0; i < segments; i++) {
    builder.appendIndices([rightCenter, rightCenter + 1 + i, rightCenter + 1 + i + 1]);
  }
}
```
