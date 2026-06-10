<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Skinned Meshes

`boneData` encodes up to 4 bone influences per vertex as a `components: 4` attribute. Each component's integer part is the bone index and the fractional part is the weight (e.g. `1.99` → bone 1, weight 0.99). Weights are **not** normalized.

## From scratch with boneData vertex attribute

```ts
@component
export class SkinnedMeshExample extends BaseScriptComponent {
  onAwake(): void {
    const simpleSkin = this.sceneObject;
    simpleSkin.createComponent("Component.Skin");

    const mesh_0 = global.scene.createSceneObject("Mesh_0");
    mesh_0.getTransform().setLocalScale(new vec3(100, 100, 100));
    mesh_0.createComponent("Component.RenderMeshVisual");
    mesh_0.setParent(simpleSkin);

    const renderMeshVisual = mesh_0.getComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    const skin = simpleSkin.getComponent("Component.Skin") as Skin;
    renderMeshVisual.setSkin(skin);

    const armature = global.scene.createSceneObject("Armature");
    armature.getTransform().setLocalScale(new vec3(100, 100, 100));
    armature.getTransform().setLocalRotation(quat.fromEulerVec(new vec3(-90, 0, 0)));
    armature.setParent(simpleSkin);

    const node_1 = global.scene.createSceneObject("Node_1");
    node_1.getTransform().setLocalRotation(quat.fromEulerVec(new vec3(90, 0, 0)));
    node_1.setParent(armature);

    const Node_2 = global.scene.createSceneObject("Node_2");
    Node_2.getTransform().setLocalPosition(new vec3(0, 1, 0));
    Node_2.setParent(node_1);

    const node_2_end = global.scene.createSceneObject("Node_2_end");
    node_2_end.getTransform().setLocalPosition(new vec3(0, 1, 0));
    node_2_end.setParent(Node_2);

    skin.clearBones();
    skin.setSkinBone("Node_1",     node_1);
    skin.setSkinBone("Node_2",     Node_2);
    skin.setSkinBone("Node_2_end", node_2_end);

    const builder = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "normal",   components: 3, normalized: true },
      { name: "boneData", components: 4 },
    ]);
    builder.topology = MeshTopology.Triangles;
    builder.indexType = MeshIndexType.UInt16;

    // prettier-ignore
    builder.appendVerticesInterleaved([
      // position          normal         boneData (idx.weight, ...)
      -0.5, 0,   0,   0,-1,0,   0.99,0,0,0,
       0.5, 0,   0,   0,-1,0,   0.99,0,0,0,
       0.5, 0, 0.5,   0,-1,0,   0.75,1.25,0,0,
      -0.5, 0, 0.5,   0,-1,0,   0.75,1.25,0,0,
       0.5, 0,   1,   0,-1,0,   0.5,1.5,0,0,
      -0.5, 0,   1,   0,-1,0,   0.5,1.5,0,0,
       0.5, 0, 1.5,   0,-1,0,   1.75,0.25,0,0,
      -0.5, 0, 1.5,   0,-1,0,   1.75,0.25,0,0,
       0.5, 0,   2,   0,-1,0,   1.99,0,0,0,
      -0.5, 0,   2,   0,-1,0,   1.99,0,0,0,
    ]);
    builder.appendIndices([0,1,2, 0,2,3, 3,2,4, 3,4,5, 5,4,6, 5,6,7, 7,6,8, 7,8,9]);

    const makeCol = (tx: number, ty: number, tz: number): mat4 => {
      const m = new mat4();
      m.column0 = new vec4(1,0,0,0);
      m.column1 = new vec4(0,0,-1,0);
      m.column2 = new vec4(0,1,0,0);
      m.column3 = new vec4(tx,ty,tz,1);
      return m;
    };
    builder.setBones(
      [node_1.name, Node_2.name, node_2_end.name],
      [makeCol(0,0,0), makeCol(0,-1,0), makeCol(0,-2,0)]
    );

    builder.updateMesh();
    renderMeshVisual.mesh = builder.getMesh();
  }
}
```

## From an existing mesh

```ts
@component
export class MeshFromExisting extends BaseScriptComponent {
  @input sourceMesh: RenderMesh;
  @input targetMeshVisual: RenderMeshVisual;

  onAwake(): void {
    const builder = MeshBuilder.createFromMesh(this.sourceMesh);
    this.targetMeshVisual.mesh = builder.getMesh();
  }
}
```

**Limitation:** adding or deleting vertices/indices is not supported on skinned meshes — only `setVertexInterleaved` modifications. To change topology, rebuild from scratch.
