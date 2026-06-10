<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Voxel (Blender) backend — full pipeline & templates

On-demand detail for `/build-mesh`'s **voxel** backend (local Blender). This is the only path that produces **rigged** GLBs (skinned skeleton in the asset), with a blocky voxel aesthetic. **Read this only when the voxel backend is selected** — an explicit `backend=voxel`, or the Backend menu picked it (rigged GLB required, or voxel look requested). FAST3D/SPECS builds never need it.

The SKILL.md body keeps the Backend menu, the Pose contract, the per-mesh output contract, and the Scale convention; everything voxel-specific is here.

---

## Voxel (Blender) Pipeline

Used when the Backend menu selects voxel — a blocky aesthetic, or a rigged GLB is specifically required (voxel is the only rigged-GLB path).

### Step 1: Write the Python script

Create `<PROJECT_ROOT>/tempAssetGen/gen_mesh_<Name>.py`, where `<PROJECT_ROOT>` is the directory containing the `.esproj` file. Create the directory if missing.

**IMPORTANT:** The script MUST set `TOOLS_DIR` to the **absolute path** of this skill's `tools/` directory. Do NOT use `os.path.dirname(__file__)` — the generated script is not in the tools directory. Resolve the absolute path from the skill's location before writing the script.

Use the "Voxel Static Template" or "Voxel + Animation Template" below.

**NEVER mix in non-voxel primitives.** Voxel mode imports only `VoxelBuilder` and the scene utilities — no free-floating spheres/cylinders. Mixing produces broken hybrid meshes.

### Step 2: Run Blender

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --python <PROJECT_ROOT>/tempAssetGen/gen_mesh_<Name>.py
```

### Step 3: Verify

- Bash exit code 0 → continue. Non-zero → return `status: BLENDER_FAILED` with the last 30 lines of stderr.
- `Assets/GeneratedMeshes/<Name>.glb` exists and is non-empty.
- Parse the unified AABB lines from stdout (`AABB (Lens Studio cm @ 100x import)` and `AABB center offset (cm)`).
- **Pose & completeness:** `build(center=True)` puts Y at the floor (`grounded: true`, `aabb_min_cm.y == 0`); `upright: true`. Completeness is `verified` — for a **static** voxel mesh by construction (deterministic block-by-block assembly; the Step 4 render is skipped), for an **animated** voxel mesh by the Step 4 preview render. **Facing:** the template's `rot_180z` + export + import net to `+Z` (toward the viewer, same as FAST3D — NOT −Z), so bake the **known** correction to canonical `-Z` and stamp it — you author the voxel model, so the rotation is known and no detection render is needed:
  ```bash
  node <skill-tools-dir>/normalize_glb.js Assets/GeneratedMeshes/<Name>.glb Assets/GeneratedMeshes/<Name>.glb --yaw=180 --mark-canonical
  ```
  Report `forward_axis: -Z`. The caller then treats voxel and FAST3D output identically — both arrive stamped `-Z`.

### Step 4: Visual preview (animated meshes only)

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --python <skill-tools-dir>/preview_glb.py -- Assets/GeneratedMeshes/<Name>.glb
```

This renders preview PNGs to `Assets/GeneratedMeshes/preview/`:
- 3 static views (front, side, 3/4) at rest pose
- 4 animation frames per clip, evenly spaced

The caller (multimodal agent) reads the PNGs to confirm parts are connected, limbs rotate correctly, and silhouette matches description. Skip this step for static voxel meshes — voxel's block-by-block construction makes errors obvious without rendering.

If preview shows broken assembly, edit the script and re-run from Step 2.

Common failures caught by preview:
- Parts displaced → forgot `center=False`, or empties not at origin
- Limbs rotating wrong direction → wrong axis in `make_delta` (see axis reference)
- Model dark/invisible → material issue

---

## Voxel Static Template

```python
import sys, os
TOOLS_DIR = "<ABSOLUTE_PATH_TO_SKILL_TOOLS_DIR>"
sys.path.insert(0, TOOLS_DIR)
from voxel_toolkit import (
    VoxelBuilder, clear_scene, make_empty, set_parent, export_static_glb,
)

OUTPUT_FILENAME = "<Name>.glb"
PROJECT_ASSETS = "<ABSOLUTE_PATH_TO_PROJECT>/Assets/GeneratedMeshes"


def build_model(root):
    vb = VoxelBuilder(block_size=0.05)

    vb.box(0, 0, 0, 4, 4, 4, "stone")   # fill in your geometry here (see Voxel Toolkit API)

    mesh_obj = vb.build("<Name>")
    set_parent(mesh_obj, root)


def main():
    clear_scene()
    root = make_empty("Root_Assembly")
    build_model(root)
    os.makedirs(PROJECT_ASSETS, exist_ok=True)
    export_static_glb(os.path.join(PROJECT_ASSETS, OUTPUT_FILENAME), root)


if __name__ == "__main__":
    main()
```

---

## Voxel + Animation Template

For animated models (characters, creatures, vehicles), build separate `VoxelBuilder` instances per body part.

**CRITICAL: use `center=False`** so all parts share the same voxel coordinate system. Without this, `build()` auto-centers each part at its own bounding box, displacing parts and breaking assembly.

**The correct pattern (3 steps):**

1. **All group empties at `(0,0,0)`** — they exist only for group assignment (so `AnimationBaker.snapshot()` can map meshes to groups via parent chain)
2. **Build parts with `center=False`** and parent to empties using `set_parent()` — mesh stays at its absolute voxel position
3. **After `baker.snapshot()`, override `baker.group_pivots`** with actual joint positions in Blender space

**Pivot coordinate conversion:** voxels are Y-up, Blender is Z-up. A voxel joint at `(vx, vy, vz)` becomes Blender `(vx*BS, -vz*BS, vy*BS)`.

```python
import sys, os, math
import mathutils
import bpy
TOOLS_DIR = "<ABSOLUTE_PATH_TO_SKILL_TOOLS_DIR>"
sys.path.insert(0, TOOLS_DIR)
from voxel_toolkit import VoxelBuilder, clear_scene, make_empty, set_parent
from anim_toolkit import AnimationBaker, make_delta

BS = 0.05


def voxel_pivot(vx, vy, vz):
    """Voxel (Y-up) -> Blender (Z-up): voxel X -> Blender X, voxel Y -> Blender Z, voxel Z -> Blender -Y."""
    return mathutils.Vector((vx * BS, -vz * BS, vy * BS))


def build_voxel_part(name, build_fn):
    vb = VoxelBuilder(block_size=BS)
    build_fn(vb)
    return vb.build(name, center=False)  # CRITICAL: center=False


# All parts use SHARED voxel coordinate grid
def body_blocks(vb):
    vb.box(1, 4, 1, 6, 9, 5, "blue")


def head_blocks(vb):
    vb.box(2, 10, 2, 5, 13, 5, "white")
    vb.block(3, 12, 2, "black")
    vb.block(4, 12, 2, "black")


def left_leg_blocks(vb):
    vb.box(1, 0, 2, 3, 3, 4, "blue")
    vb.box(1, 0, 1, 3, 0, 1, "black")


def right_leg_blocks(vb):
    vb.box(4, 0, 2, 6, 3, 4, "blue")
    vb.box(4, 0, 1, 6, 0, 1, "black")


def idle_deltas(frame, total_frames, pivots):
    t = (frame - 1) / total_frames
    phase = t * 2 * math.pi
    deltas = {}
    deltas["Character"] = mathutils.Matrix.Translation((0, 0, math.sin(phase) * 0.005))
    if "Head" in pivots:
        deltas["Head"] = make_delta(pivots["Head"], math.sin(phase * 0.5) * math.radians(5), 'X')
    return deltas


def walk_deltas(frame, total_frames, pivots):
    t = (frame - 1) / total_frames
    phase = t * 2 * math.pi
    deltas = {}
    deltas["Character"] = mathutils.Matrix.Translation((0, 0, abs(math.sin(phase * 2)) * 0.01))
    for name, offset in [("LeftLeg", 0), ("RightLeg", math.pi)]:
        if name in pivots:
            rot = math.sin(phase + offset) * math.radians(25)
            lift = max(0, math.sin(phase + offset)) * 0.03
            deltas[name] = make_delta(pivots[name], rot, 'X', (0, 0, lift))
    if "Head" in pivots:
        deltas["Head"] = make_delta(pivots["Head"], math.sin(phase) * math.radians(3), 'Z')
    return deltas


def main():
    clear_scene()
    root = make_empty("Root_Assembly")

    # Step 1: Group empties at ORIGIN (just for group assignment)
    char = make_empty("Character"); set_parent(char, root)
    head_grp = make_empty("Head"); set_parent(head_grp, char)
    ll_grp = make_empty("LeftLeg"); set_parent(ll_grp, char)
    rl_grp = make_empty("RightLeg"); set_parent(rl_grp, char)

    # Step 2: Build & parent (set_parent preserves world position)
    body_mesh = build_voxel_part("BodyMesh", body_blocks)
    head_mesh = build_voxel_part("HeadMesh", head_blocks)
    ll_mesh = build_voxel_part("LeftLegMesh", left_leg_blocks)
    rl_mesh = build_voxel_part("RightLegMesh", right_leg_blocks)

    set_parent(body_mesh, char)
    set_parent(head_mesh, head_grp)
    set_parent(ll_mesh, ll_grp)
    set_parent(rl_mesh, rl_grp)
    bpy.context.view_layer.update()

    # Step 2b: Center at origin + fix facing direction for Lens Studio
    import bmesh as _bm
    all_min = [1e9, 1e9, 1e9]; all_max = [-1e9, -1e9, -1e9]
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            co = obj.matrix_world @ mathutils.Vector(corner)
            for i in range(3):
                all_min[i] = min(all_min[i], co[i])
                all_max[i] = max(all_max[i], co[i])
    centering = mathutils.Vector((
        -(all_min[0] + all_max[0]) / 2.0,
        -(all_min[1] + all_max[1]) / 2.0,
        -all_min[2],
    ))
    rot_180z = mathutils.Matrix.Rotation(math.pi, 4, 'Z')
    transform = rot_180z @ mathutils.Matrix.Translation(centering)
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        bm = _bm.new()
        bm.from_mesh(obj.data)
        _bm.ops.transform(bm, matrix=transform, verts=bm.verts)
        bm.to_mesh(obj.data)
        bm.free()
        obj.data.update()
    bpy.context.view_layer.update()

    # Step 3: Animate with manual pivots
    baker = AnimationBaker(
        anim_groups=["Character", "Head", "LeftLeg", "RightLeg"],
        hierarchy={
            "Head":     {"parent": "Character"},
            "LeftLeg":  {"parent": "Character"},
            "RightLeg": {"parent": "Character"},
        },
    )
    baker.snapshot()

    def centered_pivot(vx, vy, vz):
        raw = voxel_pivot(vx, vy, vz)
        return (transform @ mathutils.Matrix.Translation(raw)).translation

    baker.group_pivots["Character"] = centered_pivot(3, 5, 3)
    baker.group_pivots["Head"] = centered_pivot(3, 10, 3)
    baker.group_pivots["LeftLeg"] = centered_pivot(2, 4, 3)
    baker.group_pivots["RightLeg"] = centered_pivot(5, 4, 3)

    baker.unparent_meshes()
    baker.bake("Idle", 48, idle_deltas)
    baker.bake("Walk", 48, walk_deltas)

    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "Assets", "GeneratedMeshes")
    os.makedirs(out_dir, exist_ok=True)
    baker.export_glb(os.path.join(out_dir, "AnimatedVoxelCharacter.glb"))


if __name__ == "__main__":
    main()
```

### Blender axis reference for voxel animation deltas

Voxels are Y-up but Blender is Z-up, so `make_delta` rotation axes have non-obvious meanings:

| Motion | `make_delta` axis | Why |
|---|---|---|
| Leg swing (forward/back) | `'X'` | X is left-right in both systems; rotation around X tilts forward/back |
| Arm raise (up/down) | `'X'` | Same as leg swing — rotation around X lifts upward |
| Head nod (yes) | `'X'` | Tilts head forward/back |
| Head turn (no) | `'Z'` | Z is vertical in Blender; rotation around Z yaws left/right |
| Arm wave (side-to-side) | `'Z'` | Horizontal sweep |
| Body lean/sway | `'Y'` | Y is depth in Blender; rotation around Y tilts sideways |
| Tail/cape wag | `'Z'` | Horizontal sweep |

### Common voxel-animation pitfalls

- **Forgetting `center=False`** — parts fly apart because each mesh auto-centers at its own bounding box. #1 cause of broken voxel animations.
- **Placing empties at pivot positions** — with `center=False`, `set_parent()` bakes the parent position into the mesh via `matrix_parent_inverse`, displacing it. Keep empties at origin; override `baker.group_pivots` instead.
- **Wrong pivot coordinate system** — voxel `(vx, vy, vz)` → Blender `(vx*BS, -vz*BS, vy*BS)`. Use `voxel_pivot()`.
- **Wrong rotation axis for raise/wave** — vertical motions use `'X'` (raise) and `'Z'` (wave/yaw) in Blender's Z-up space, NOT what voxel intuition suggests.
- **Model offset or facing wrong way** — apply the Step 2b vertex-transform AND the same transform to `baker.group_pivots`.

---

## Voxel Toolkit API

```python
vb = VoxelBuilder(block_size=0.05)

# Placement
vb.block(x, y, z, type)
vb.box(x1, y1, z1, x2, y2, z2, type)            # filled, inclusive
vb.line(x1, y1, z1, x2, y2, z2, type)           # DDA-rasterized
vb.sphere(cx, cy, cz, radius, type)
vb.cylinder(cx, cz, y_min, y_max, radius, type)

# Build (face culling + greedy meshing)
mesh_obj = vb.build(name)                # auto-centered (bottom-center) — static meshes
mesh_obj = vb.build(name, center=False)  # origin at (0,0,0) — animated parts
```

`block_size` is meters per voxel cube (default 0.05 = 5 cm). Pick based on desired displayed size and detail (smaller blocks + more of them = higher fidelity). No block-count cap; face culling and greedy meshing keep exports efficient.

**Block types:**

| Category | Types |
|---|---|
| Building | stone, cobblestone, wood_planks, brick, stone_brick, sandstone, concrete, clay, obsidian, mossy_stone, dark_wood_planks, light_wood_planks |
| Nature | grass, dirt, sand, gravel, wood_log, leaves, water, snow, ice, moss, coral |
| Colors | white, black, red, blue, green, yellow, orange, purple, brown, gray, pink, cyan, lime, magenta, light_blue, light_gray |
| Utility | glass, tinted_glass, iron, gold, diamond, copper |
| Light | lamp, lava, glow (emissive) |

Common aliases auto-resolve (`planks` → `wood_planks`, `bricks` → `brick`, `log` → `wood_log`).

Tips:
- Later `block()`/`box()` calls overwrite earlier ones at the same position — carve openings this way.
- Static meshes auto-center at bottom-center; pass `center=False` for animation.
- `sphere()` and `cylinder()` are good for organic voxel shapes (trees, clouds, rounded structures).

---

## AnimationBaker API

```python
baker = AnimationBaker(
    anim_groups=["Character", "Head", "LeftArm", "RightArm", "LeftLeg", "RightLeg"],
    hierarchy={
        "Head":     {"parent": "Character"},
        "LeftArm":  {"parent": "Character"},
        "RightArm": {"parent": "Character"},
        "LeftLeg":  {"parent": "Character"},
        "RightLeg": {"parent": "Character"},
    },
)
baker.snapshot()           # capture rest-pose world matrices
baker.unparent_meshes()    # flatten hierarchy for GLTF compat
baker.bake("Walk", 48, walk_delta_fn)
baker.bake("Idle", 72, idle_delta_fn)
baker.export_glb(output_path)
```

- `anim_groups` = list of group Empty names that will be animated.
- `hierarchy` maps each group to its parent for proper delta chaining.
- Child meshes (e.g. `Sword` under `SwordArm`) should NOT be in `anim_groups` — they follow automatically.
- Deltas chain: `Head` transform = `Character_delta @ Head_delta @ rest_pose`.

### Delta functions

```python
def delta_fn(frame, total_frames, pivots):
    t = (frame - 1) / total_frames
    phase = t * 2.0 * math.pi
    deltas = {}
    deltas["Character"] = mathutils.Matrix.Translation((0, 0, bob))
    deltas["LeftLeg"] = make_delta(pivots["LeftLeg"], angle, 'X', (0, 0, lift))
    return deltas
```

### Delta helpers

```python
make_delta(pivot, rot_angle, axis, translate=(0,0,0))     # rotate around pivot + optional translation
make_multi_rot_delta(pivot, rotations, translate=(0,0,0)) # multiple axes around pivot
lerp(a, b, t)
smoothstep(edge0, edge1, x)
```

---

## Common Animation Patterns

For the cyclic walk pattern (opposite-phase leg swing + body bob), see `walk_deltas` in the Voxel + Animation Template above.

### Phased (attack, spell cast, action)

```python
t = (frame - 1) / total_frames

if t < 0.2:        # Windup
    f = smoothstep(0, 0.2, t)
    angle = lerp(0, math.radians(-60), f)
elif t < 0.4:      # Strike
    f = smoothstep(0.2, 0.4, t)
    angle = lerp(math.radians(-60), math.radians(50), f)
else:               # Recovery
    f = smoothstep(0.4, 1.0, t)
    angle = lerp(math.radians(50), 0, f)
```

### Subtle idle / breathing

```python
bob = math.sin(phase) * 0.01                              # vertical bob
sway = math.sin(phase * 0.5) * 0.005                      # lateral sway
twist = math.sin(phase * 0.7) * math.radians(3)           # torso twist
head_yaw = math.sin(phase * 0.4) * math.radians(5)        # head looking around
```

---
