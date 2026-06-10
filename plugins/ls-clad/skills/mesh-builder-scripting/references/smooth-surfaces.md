<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Smooth-Surface Helpers

Prefer these over `addBox`/`buildCylinder` for smooth shapes; stacking blocky primitives is the most common overfit. Size the generated mesh to roughly **50-100 cm overall** — tiny `[0..1]` profiles appear invisible from a default camera.

## When to reach for each

| Target shape is... | Use | Example assets |
|---|---|---|
| Rotationally symmetric around an axis | **Lathe** | chess pieces, vases, bottles, goblets, map pins, balloons, columns, fountains, lamp posts, staff shafts, trophies |
| A 2D outline with depth (flat front/back + side walls) | **Extrude** | hearts, stars, coins, gears, keys, shield faces, badges, logos, 3D letters, building footprints, blade shapes |
| A circular cross-section swept along a 3D path | **Tube** | pipes, cables, wires, ropes, vines, snakes, AR navigation trails, suspension-bridge cables, rails, hoses |

All helpers assume the standard layout:

```ts
const builder = new MeshBuilder([
  { name: "position", components: 3 },
  { name: "normal",   components: 3, normalized: true },
  { name: "color",    components: 4 },
]);
builder.topology = MeshTopology.Triangles;
builder.indexType = MeshIndexType.UInt16;
```

All produce **CCW winding from outside** so they render correctly under default back-face culling.

---

## Lathe — revolve a 2D profile around the Y axis

The profile is an array of `[radius, height]` points, bottom to top, with `radius >= 0`. The lathe revolves them around Y with `segments` angular subdivisions. Caps are added automatically when the profile's endpoints have non-zero radius.

Winding is `[bl, br, tr, bl, tr, tl]` where `bl = (angle i, profile j)`, `br = (angle i, profile j+1)`, `tl = (angle i+1, profile j)`, `tr = (angle i+1, profile j+1)`. This is **the opposite** of the cylinder-along-X winding in `primitives.md` — the profile and angle axes switch roles, which flips the sign of the face normal.

```ts
function buildLathe(
  builder: MeshBuilder,
  profile: [number, number][],    // [[r, y], ...] bottom→top, r >= 0
  segments: number,                // angular subdivisions (16–32 typical)
  color: [number, number, number, number],
  baseIdx: number = 0,
): number {
  const P = profile.length;
  let vi = baseIdx;
  const startIdx = vi;
  const indices: number[] = [];

  // Profile tangent → outward 2D normal = (dy, -dx), normalized
  const prof2dN: [number, number][] = [];
  for (let j = 0; j < P; j++) {
    const prev = profile[Math.max(0, j - 1)];
    const next = profile[Math.min(P - 1, j + 1)];
    const dx = next[0] - prev[0], dy = next[1] - prev[1];
    const len = Math.hypot(dy, -dx) || 1;
    prof2dN.push([dy / len, -dx / len]);
  }

  // Emit (segments+1) rings × P vertices (duplicated seam for clean UVs)
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    const c = Math.cos(theta), s = Math.sin(theta);
    for (let j = 0; j < P; j++) {
      const [r, y] = profile[j];
      const [n2x, n2y] = prof2dN[j];
      builder.appendVerticesInterleaved([
        r * c, y, r * s,
        n2x * c, n2y, n2x * s,
        ...color,
      ]);
      vi++;
    }
  }

  // Side quads — correct winding for Y-axis lathe
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < P - 1; j++) {
      const bl = startIdx + i * P + j;
      const br = startIdx + i * P + (j + 1);
      const tl = startIdx + (i + 1) * P + j;
      const tr = startIdx + (i + 1) * P + (j + 1);
      indices.push(bl, br, tr,  bl, tr, tl);
    }
  }

  // Bottom cap (normal -Y) — (center, ring+i, ring+i+1) makes the cross product
  // point in -Y, outward for the bottom face.
  if (profile[0][0] > 1e-6) {
    const y = profile[0][1], r = profile[0][0];
    const center = vi;
    builder.appendVerticesInterleaved([0, y, 0, 0, -1, 0, ...color]); vi++;
    const ring = vi;
    for (let i = 0; i <= segments; i++) {
      const th = (i / segments) * Math.PI * 2;
      builder.appendVerticesInterleaved([r * Math.cos(th), y, r * Math.sin(th), 0, -1, 0, ...color]); vi++;
    }
    for (let i = 0; i < segments; i++) indices.push(center, ring + i, ring + i + 1);
  }

  // Top cap (normal +Y) — reversed order of the bottom cap winding.
  if (profile[P - 1][0] > 1e-6) {
    const y = profile[P - 1][1], r = profile[P - 1][0];
    const center = vi;
    builder.appendVerticesInterleaved([0, y, 0, 0, 1, 0, ...color]); vi++;
    const ring = vi;
    for (let i = 0; i <= segments; i++) {
      const th = (i / segments) * Math.PI * 2;
      builder.appendVerticesInterleaved([r * Math.cos(th), y, r * Math.sin(th), 0, 1, 0, ...color]); vi++;
    }
    for (let i = 0; i < segments; i++) indices.push(center, ring + i + 1, ring + i);
  }

  builder.appendIndices(indices);
  return vi;
}
```

### Example — chess pawn

```ts
// Silhouette: base flange → stem → collar → ball head
const pawnProfile: [number, number][] = [
  [0.0,  0.0],  // tip at axis, bottom
  [1.6,  0.0],  // base radius
  [1.4,  0.3],
  [0.8,  0.6],
  [0.6,  2.2],  // slim stem
  [0.9,  2.5],  // collar
  [0.6,  2.7],
  [1.1,  3.5],  // ball head (apex)
  [0.0,  3.8],  // close at top
];
buildLathe(builder, pawnProfile, 24, [0.95, 0.93, 0.88, 1], 0);
```

Same approach builds rooks (profile ends with battlement steps — add those as a ring of `addBox` calls on top), bishops (add a spike/slit at the apex), queens/kings (lathe the body, add extruded cross or crown points on top). **Composite pieces = lathe body + extruded/box accents.**

---

## Extrude — depth-extrude a 2D polygon

Takes a 2D polygon (array of `[x, y]`, CCW in XY) and produces a front face at `+depth/2`, a back face at `-depth/2`, and side walls connecting them. Concave shapes (heart, star, gear) require ear-clipping triangulation — included below.

> **Winding gotcha:** the ear-clipping triangulator only finds ears on CCW polygons. If you pass a CW polygon (easy to do when tracing a silhouette by hand), it emits almost no triangles and the extruded shape collapses into thin spikes. `buildExtrude` below guards against this by computing the signed area and reversing a CW input before triangulation — keep that guard if you adapt the helper.

```ts
function pointInTri(
  p: [number, number], a: [number, number], b: [number, number], c: [number, number]
): boolean {
  const d1 = (p[0]-b[0])*(a[1]-b[1]) - (a[0]-b[0])*(p[1]-b[1]);
  const d2 = (p[0]-c[0])*(b[1]-c[1]) - (b[0]-c[0])*(p[1]-c[1]);
  const d3 = (p[0]-a[0])*(c[1]-a[1]) - (c[0]-a[0])*(p[1]-a[1]);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

/** O(n²) ear clipping for a simple CCW polygon. Returns triangle indices. */
function triangulate2D(poly: [number, number][]): number[] {
  const n = poly.length;
  if (n < 3) return [];
  const V: number[] = [];
  for (let i = 0; i < n; i++) V.push(i);
  const tris: number[] = [];
  let guard = 3 * n;
  let i = 0;
  while (V.length > 3 && guard-- > 0) {
    const m = V.length;
    const ia = V[(i + m - 1) % m], ib = V[i % m], ic = V[(i + 1) % m];
    const a = poly[ia], b = poly[ib], c = poly[ic];
    const cross = (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]);
    if (cross > 0) {  // convex corner in CCW polygon
      let isEar = true;
      for (let k = 0; k < m; k++) {
        const vk = V[k];
        if (vk === ia || vk === ib || vk === ic) continue;
        if (pointInTri(poly[vk], a, b, c)) { isEar = false; break; }
      }
      if (isEar) { tris.push(ia, ib, ic); V.splice(i % m, 1); continue; }
    }
    i++;
  }
  if (V.length === 3) tris.push(V[0], V[1], V[2]);
  return tris;
}

function buildExtrude(
  builder: MeshBuilder,
  poly: [number, number][],   // CCW in XY plane
  depth: number,
  color: [number, number, number, number],
  baseIdx: number = 0,
): number {
  // Normalize to CCW — triangulate2D and the side-wall outward-normal
  // formula both assume CCW. A CW polygon silently produces a near-empty
  // triangulation (degenerate/spiky output), so reverse if needed.
  let area2 = 0;
  for (let k = 0; k < poly.length; k++) {
    const p0 = poly[k], p1 = poly[(k + 1) % poly.length];
    area2 += p0[0] * p1[1] - p1[0] * p0[1];
  }
  if (area2 < 0) poly = poly.slice().reverse();

  const n = poly.length;
  let vi = baseIdx;
  const startIdx = vi;
  const indices: number[] = [];
  const hd = depth / 2;

  // Front face (+Z) — n verts
  for (let k = 0; k < n; k++) {
    builder.appendVerticesInterleaved([poly[k][0], poly[k][1], +hd, 0, 0, 1, ...color]); vi++;
  }
  // Back face (-Z) — n verts
  for (let k = 0; k < n; k++) {
    builder.appendVerticesInterleaved([poly[k][0], poly[k][1], -hd, 0, 0, -1, ...color]); vi++;
  }

  const tris = triangulate2D(poly);
  // Front: CCW in XY = CCW viewed from +Z → keep order
  for (let t = 0; t < tris.length; t += 3) {
    indices.push(startIdx + tris[t], startIdx + tris[t + 1], startIdx + tris[t + 2]);
  }
  // Back: reverse winding
  const backBase = startIdx + n;
  for (let t = 0; t < tris.length; t += 3) {
    indices.push(backBase + tris[t], backBase + tris[t + 2], backBase + tris[t + 1]);
  }

  // Side walls — 4 fresh verts per edge so normals are crisp
  for (let k = 0; k < n; k++) {
    const p0 = poly[k], p1 = poly[(k + 1) % n];
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
    const len = Math.hypot(dy, -dx) || 1;
    const nx = dy / len, ny = -dx / len;  // outward 2D normal for CCW poly
    const base = vi;
    builder.appendVerticesInterleaved([p0[0], p0[1], -hd, nx, ny, 0, ...color]); // A
    builder.appendVerticesInterleaved([p1[0], p1[1], -hd, nx, ny, 0, ...color]); // B
    builder.appendVerticesInterleaved([p1[0], p1[1], +hd, nx, ny, 0, ...color]); // C
    builder.appendVerticesInterleaved([p0[0], p0[1], +hd, nx, ny, 0, ...color]); // D
    vi += 4;
    indices.push(base, base + 1, base + 2,  base, base + 2, base + 3);
  }

  builder.appendIndices(indices);
  return vi;
}
```

### Example — heart shape (concave)

```ts
const heart: [number, number][] = [];
const N = 40;
for (let i = 0; i < N; i++) {
  const t = (i / N) * Math.PI * 2;
  // Classic heart parametric (x, y), scaled
  const x = 16 * Math.pow(Math.sin(t), 3);
  const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
  heart.push([x * 0.3, y * 0.3]);
}
buildExtrude(builder, heart, 2.0, [1, 0.2, 0.4, 1], 0);
```

### Shape ideas (2D arrays you feed in)

- **Star(N, rOuter, rInner)** — alternate between the two radii around `2N` angles.
- **Gear(teeth, rBase, rTip)** — 4 points per tooth (valley, rise, tip, fall).
- **Coin** — circle (sample N points on `[cos θ, sin θ] * r`).
- **Rounded rect** — 4 line segments + 4 quarter arcs.
- **Keyhole / key profile** — hand-listed points.
- **Building footprint** — any floorplan polygon; extrude by height.

---

## Tube — sweep a circular cross-section along a 3D curve

Takes a curve (array of 3D points) and produces a tube of given `radius` with `radialSegments` around each ring. Uses **parallel transport** to advance the frame so the tube doesn't twist unexpectedly even when the curve bends sharply or crosses the world vertical.

Open tube by default (no end caps). For closed loops (chain links, tires), set `curve[0] === curve[N-1]` and stitch the last ring back to the first manually, or rebuild as a torus.

```ts
function buildTube(
  builder: MeshBuilder,
  curve: [number, number, number][],
  radius: number,
  radialSegments: number,
  color: [number, number, number, number],
  baseIdx: number = 0,
): number {
  const N = curve.length;
  if (N < 2) return baseIdx;
  let vi = baseIdx;
  const startIdx = vi;

  // Per-point tangents (forward diff, mirrored at endpoints)
  const T: [number, number, number][] = [];
  for (let i = 0; i < N; i++) {
    const a = curve[Math.max(0, i - 1)], b = curve[Math.min(N - 1, i + 1)];
    const t: [number, number, number] = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
    const len = Math.hypot(t[0], t[1], t[2]) || 1;
    T.push([t[0]/len, t[1]/len, t[2]/len]);
  }

  // Initial normal: any axis projected perpendicular to T[0]
  const ax: [number, number, number] = Math.abs(T[0][0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const d0 = ax[0]*T[0][0] + ax[1]*T[0][1] + ax[2]*T[0][2];
  let Nf: [number, number, number] = [ax[0]-d0*T[0][0], ax[1]-d0*T[0][1], ax[2]-d0*T[0][2]];
  let nl = Math.hypot(Nf[0], Nf[1], Nf[2]) || 1;
  Nf = [Nf[0]/nl, Nf[1]/nl, Nf[2]/nl];

  // Parallel-transport the normal along the curve (Rodrigues rotation)
  const frames: { n: [number,number,number]; b: [number,number,number] }[] = [];
  for (let i = 0; i < N; i++) {
    if (i > 0) {
      const tp = T[i-1], tc = T[i];
      const kx = tp[1]*tc[2] - tp[2]*tc[1];
      const ky = tp[2]*tc[0] - tp[0]*tc[2];
      const kz = tp[0]*tc[1] - tp[1]*tc[0];
      const kl = Math.hypot(kx, ky, kz);
      if (kl > 1e-6) {
        const cosA = Math.max(-1, Math.min(1, tp[0]*tc[0] + tp[1]*tc[1] + tp[2]*tc[2]));
        const ang = Math.acos(cosA), s = Math.sin(ang), c = Math.cos(ang);
        const k: [number, number, number] = [kx/kl, ky/kl, kz/kl];
        const kxn: [number, number, number] = [k[1]*Nf[2]-k[2]*Nf[1], k[2]*Nf[0]-k[0]*Nf[2], k[0]*Nf[1]-k[1]*Nf[0]];
        const kdn = k[0]*Nf[0] + k[1]*Nf[1] + k[2]*Nf[2];
        Nf = [
          Nf[0]*c + kxn[0]*s + k[0]*kdn*(1-c),
          Nf[1]*c + kxn[1]*s + k[1]*kdn*(1-c),
          Nf[2]*c + kxn[2]*s + k[2]*kdn*(1-c),
        ];
      }
    }
    const t = T[i];
    const Bf: [number, number, number] = [t[1]*Nf[2]-t[2]*Nf[1], t[2]*Nf[0]-t[0]*Nf[2], t[0]*Nf[1]-t[1]*Nf[0]];
    frames.push({ n: [...Nf] as [number,number,number], b: Bf });
  }

  // Emit (radialSegments+1) verts per ring — duplicate seam keeps normals clean
  const R = radialSegments + 1;
  for (let i = 0; i < N; i++) {
    const p = curve[i], { n, b } = frames[i];
    for (let j = 0; j < R; j++) {
      const th = (j / radialSegments) * Math.PI * 2;
      const c = Math.cos(th), s = Math.sin(th);
      const nx = n[0]*c + b[0]*s, ny = n[1]*c + b[1]*s, nz = n[2]*c + b[2]*s;
      builder.appendVerticesInterleaved([
        p[0] + nx*radius, p[1] + ny*radius, p[2] + nz*radius,
        nx, ny, nz,
        ...color,
      ]);
      vi++;
    }
  }

  const indices: number[] = [];
  for (let i = 0; i < N - 1; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const bl = startIdx + i * R + j;
      const br = startIdx + i * R + (j + 1);
      const tl = startIdx + (i + 1) * R + j;
      const tr = startIdx + (i + 1) * R + (j + 1);
      indices.push(bl, br, tr,  bl, tr, tl);
    }
  }
  builder.appendIndices(indices);
  return vi;
}
```

### Example — AR navigation ribbon on the ground

```ts
const path: [number, number, number][] = [];
for (let i = 0; i <= 40; i++) {
  const t = i / 40;
  path.push([t * 50 - 25, 0, Math.sin(t * Math.PI * 2) * 8]);
}
buildTube(builder, path, 0.4, 8, [0.1, 0.7, 1.0, 1], 0);
```

### Composing with lathe and extrude

Real assets usually combine generators — **lathe the body, extrude the flat parts, tube the cables**:

- **Sword** = extrude(blade 2D) + lathe(hilt+pommel) + extrude(crossguard)
- **Map pin** = lathe(teardrop profile) + sphere accent
- **Suspension bridge** = extrude(deck polygon) + tube(cables along curves) + box(towers)
- **Lamp post** = lathe(shaft + base) + extrude(sign plate) + tube(power cable)
- **Bow and arrow** = tube(curved bow) + lathe(arrow shaft) + extrude(fletching + arrowhead)
