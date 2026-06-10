<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Topology Examples

Code fragments for each `MeshTopology` variant. Each snippet assumes `rmv` is a `RenderMeshVisual` created via `this.sceneObject.createComponent("Component.RenderMeshVisual") as RenderMeshVisual`.

For `Triangles` topology, see the canonical quad example in `SKILL.md` and the `addBox` / `buildCylinder` helpers in `references/primitives.md`.

## Points — scatter 10 000 random points

```ts
const builder = new MeshBuilder([{ name: "position", components: 3 }]);
builder.topology = MeshTopology.Points;

for (let i = 0; i < 10000; i++) {
  builder.appendVerticesInterleaved([Math.random(), Math.random(), Math.random()]);
  builder.appendIndices([i]);
}
rmv.mesh = builder.getMesh();
builder.updateMesh();
```

## Lines — disconnected colored segments

Each pair of indices draws one line. Vertices can be reused across pairs.

```ts
const builder = new MeshBuilder([
  { name: "position", components: 3 },
  { name: "color",    components: 4 },
]);
builder.topology = MeshTopology.Lines;
builder.indexType = MeshIndexType.UInt16;

builder.appendVerticesInterleaved([
  // position        color (RGBA)
   0,  0, 0,   1, 0, 0, 1,  // 0 red
   0, 10, 0,   0, 1, 0, 1,  // 1 green
  10,  0, 0,   0, 0, 1, 1,  // 2 blue
  10, 10, 10,  1, 1, 0, 1,  // 3 yellow
]);
builder.appendIndices([0, 1,  2, 3]);  // two separate lines

rmv.mesh = builder.getMesh();
builder.updateMesh();
```

## LineStrip — continuous connected path

Each new index extends the strip from the previous vertex.

```ts
const builder = new MeshBuilder([{ name: "position", components: 3 }]);
builder.topology = MeshTopology.LineStrip;
builder.indexType = MeshIndexType.UInt16;

builder.appendVerticesInterleaved([
   0,  0, 0,  // 0
   0, 10, 0,  // 1
  10,  0, 0,  // 2
]);
builder.appendIndices([0, 1, 2, 0]);  // triangle outline, back to start

rmv.mesh = builder.getMesh();
builder.updateMesh();
```

## TriangleStrip — each new vertex adds a triangle with the previous two

```ts
const builder = new MeshBuilder([{ name: "position", components: 3 }]);
builder.topology = MeshTopology.TriangleStrip;
builder.indexType = MeshIndexType.UInt16;

builder.appendVerticesInterleaved([
   0,  0, 0,  // 0
   0, 10, 0,  // 1
  10,  0, 0,  // 2
  10, 10, 0,  // 3
]);
builder.appendIndices([0, 1, 2, 3]);  // forms two triangles

rmv.mesh = builder.getMesh();
builder.updateMesh();
```

## TriangleFan — each new vertex forms a triangle with the previous vertex and vertex 0

```ts
const builder = new MeshBuilder([{ name: "position", components: 3 }]);
builder.topology = MeshTopology.TriangleFan;
builder.indexType = MeshIndexType.UInt16;

builder.appendVerticesInterleaved([
  0,  0, 0,   // 0 — hub
  1,  0, 0,   // 1
  0,  1, 0,   // 2
 -1,  0, 0,   // 3
  0, -1, 0,   // 4
]);
builder.appendIndices([0, 1, 2, 3, 4, 1]);  // 4 triangles, closes fan back to 1

rmv.mesh = builder.getMesh();
builder.updateMesh();
```
