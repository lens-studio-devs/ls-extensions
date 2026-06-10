<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Dynamic Mesh Updates

Use `setVertexInterleaved(index, data)` to move vertices each frame without rebuilding the mesh. The index is a **0-based vertex index**, and `data` is the full interleaved attribute array for that single vertex — must match the builder's original layout order and component count.

```ts
@component
export class DynamicMeshExample extends BaseScriptComponent {
  @input material: Material;

  private builder: MeshBuilder;
  private rmv: RenderMeshVisual;

  onAwake(): void {
    this.rmv = this.sceneObject.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;

    this.builder = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "normal",   components: 3, normalized: true },
    ]);
    this.builder.topology = MeshTopology.Triangles;
    this.builder.indexType = MeshIndexType.UInt16;

    this.builder.appendVerticesInterleaved([
       0, 5, 0,   0, 0, 1,
      -5, 0, 0,   0, 0, 1,
       5, 0, 0,   0, 0, 1,
    ]);
    this.builder.appendIndices([0, 1, 2]);
    this.rmv.mesh = this.builder.getMesh();
    if (this.material) this.rmv.mainMaterial = this.material;
    this.builder.updateMesh();

    this.createEvent("UpdateEvent").bind(() => {
      this.builder.setVertexInterleaved(0, [
        10 * Math.sin(getTime()), 5, 10 * Math.cos(getTime()),
        0, 0, 1,
      ]);
      this.builder.updateMesh();
    });
  }
}
```

Call `updateMesh()` after every `setVertexInterleaved` batch (typically once per frame, not per vertex).
