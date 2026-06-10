<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Using Raw Blender API (voxel backend only)

The toolkit primitives are helpers, not limits. For geometry the toolkit can't produce, use raw Blender Python:

```python
import bpy, bmesh

# Custom mesh via bmesh
bm = bmesh.new()
# ... add custom geometry ...
mesh = bpy.data.meshes.new("CustomMesh")
bm.to_mesh(mesh)
bm.free()
obj = bpy.data.objects.new("CustomMesh", mesh)
link_obj(obj)

# Modifiers
obj.modifiers.new("Subsurf", 'SUBSURF')
obj.modifiers["Subsurf"].levels = 2

# Boolean ops
bool_mod = obj.modifiers.new("Bool", 'BOOLEAN')
bool_mod.operation = 'DIFFERENCE'
bool_mod.object = cutter_obj
bpy.context.view_layer.objects.active = obj
bpy.ops.object.modifier_apply(modifier="Bool")
```

Use `create_material(name, color_rgba, roughness, metallic, emission)` for hand-rolled PBR materials. For procedural textures, use Blender's shader node system — materials bake into the exported GLB automatically.
