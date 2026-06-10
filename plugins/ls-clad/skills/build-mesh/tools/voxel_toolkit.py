# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

# ==============================================================================
# Voxel Mesh Toolkit
#
# Block-based voxel model builder for Blender. Place blocks on an integer grid,
# then build() converts them into an optimized mesh using face culling and
# greedy meshing.
#
# Usage:
#   from voxel_toolkit import VoxelBuilder
#   vb = VoxelBuilder()
#   vb.box(0, 0, 0, 10, 0, 10, "grass")
#   vb.box(3, 1, 3, 7, 5, 7, "stone")
#   mesh_obj = vb.build("MyVoxelModel")
# ==============================================================================


import bmesh
import bpy
import mathutils

# ===========================================================================
# SCENE UTILITIES — foundational Blender helpers shared by the voxel +
# animation pipelines. Previously lived in mesh_toolkit.py.
# ===========================================================================


def clear_scene():
    """Delete all objects, meshes, materials, and non-root collections."""
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        bpy.data.meshes.remove(mesh)
    for mat in list(bpy.data.materials):
        bpy.data.materials.remove(mat)
    root_col = bpy.context.scene.collection
    for col in list(bpy.data.collections):
        if col != root_col:
            bpy.data.collections.remove(col)


def link_obj(obj):
    """Link a newly created object to the scene."""
    bpy.context.scene.collection.objects.link(obj)
    return obj


def make_empty(name):
    """Create an empty for grouping/parenting."""
    emp = bpy.data.objects.new(name, None)
    emp.empty_display_size = 0.1
    return link_obj(emp)


def set_parent(child, parent):
    """Parent an object to another while maintaining world transforms."""
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_world.inverted()


def create_material(name, color, roughness=0.5, metallic=0.0, emission=None):
    """Principled BSDF material with color/roughness/metallic and optional emission."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Alpha"].default_value = color[3]
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
        if emission:
            bsdf.inputs["Emission Color"].default_value = emission
            bsdf.inputs["Emission Strength"].default_value = 3.0
    return mat


def export_static_glb(output_path, root=None):
    """Export the scene as a static GLB (no animation).
    export_yup=True handles Blender Z-up -> GLB Y-up automatically; no manual root rotation."""
    bpy.context.view_layer.update()
    for obj in bpy.data.objects:
        obj.select_set(True)
    active = root or next((o for o in bpy.data.objects if o.type == "MESH"), None)
    if active:
        bpy.context.view_layer.objects.active = active
    override = bpy.context.copy()
    override["active_object"] = active
    override["selected_objects"] = list(bpy.data.objects)
    with bpy.context.temp_override(**override):
        bpy.ops.export_scene.gltf(
            filepath=output_path,
            export_format="GLB",
            export_apply=True,
            export_yup=True,
            export_texcoords=True,
            export_normals=True,
            export_materials="EXPORT",
            export_morph=True,
        )
    total_verts = sum(len(o.data.vertices) for o in bpy.data.objects if o.type == "MESH")
    total_faces = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == "MESH")
    print(f"--- Exported to {output_path} ---")
    print(f"--- {total_verts} verts, {total_faces} faces ---")

    mesh_objs = [o for o in bpy.data.objects if o.type == "MESH"]
    if mesh_objs:
        bb_min = [float("inf")] * 3
        bb_max = [float("-inf")] * 3
        for obj in mesh_objs:
            for corner in obj.bound_box:
                co = obj.matrix_world @ mathutils.Vector(corner)
                for i in range(3):
                    bb_min[i] = min(bb_min[i], co[i])
                    bb_max[i] = max(bb_max[i], co[i])
        size_m = [bb_max[i] - bb_min[i] for i in range(3)]
        size_cm = [s * 100.0 for s in size_m]
        center_cm = [((bb_min[i] + bb_max[i]) * 0.5) * 100.0 for i in range(3)]
        print(f"--- AABB (Blender meters): {size_m[0]:.4f} x {size_m[1]:.4f} x {size_m[2]:.4f} ---")
        print(f"--- AABB (Lens Studio cm @ 100x import): {size_cm[0]:.1f} x {size_cm[1]:.1f} x {size_cm[2]:.1f} ---")
        print(f"--- AABB center offset (cm): {center_cm[0]:.1f}, {center_cm[1]:.1f}, {center_cm[2]:.1f} ---")


# ===========================================================================
# BLOCK PALETTE — generic material names mapped to (R, G, B, A)
# ===========================================================================

BLOCK_PALETTE = {
    # Building
    "stone": (0.50, 0.50, 0.50, 1.0),
    "cobblestone": (0.42, 0.42, 0.42, 1.0),
    "wood_planks": (0.72, 0.56, 0.33, 1.0),
    "brick": (0.60, 0.30, 0.25, 1.0),
    "stone_brick": (0.48, 0.48, 0.48, 1.0),
    "sandstone": (0.82, 0.76, 0.55, 1.0),
    "concrete": (0.60, 0.60, 0.60, 1.0),
    "clay": (0.65, 0.55, 0.50, 1.0),
    "obsidian": (0.12, 0.08, 0.16, 1.0),
    "mossy_stone": (0.40, 0.48, 0.38, 1.0),
    "dark_wood_planks": (0.35, 0.22, 0.12, 1.0),
    "light_wood_planks": (0.80, 0.68, 0.45, 1.0),
    # Nature
    "grass": (0.36, 0.60, 0.22, 1.0),
    "dirt": (0.55, 0.38, 0.22, 1.0),
    "sand": (0.85, 0.80, 0.60, 1.0),
    "gravel": (0.52, 0.50, 0.48, 1.0),
    "wood_log": (0.40, 0.30, 0.15, 1.0),
    "leaves": (0.20, 0.50, 0.10, 1.0),
    "water": (0.25, 0.46, 0.89, 0.60),
    "snow": (0.92, 0.94, 0.96, 1.0),
    "ice": (0.60, 0.78, 0.92, 0.75),
    "moss": (0.30, 0.52, 0.18, 1.0),
    "coral": (0.85, 0.35, 0.40, 1.0),
    # Colors
    "white": (0.95, 0.95, 0.95, 1.0),
    "black": (0.10, 0.10, 0.10, 1.0),
    "red": (0.70, 0.15, 0.15, 1.0),
    "blue": (0.20, 0.25, 0.70, 1.0),
    "green": (0.20, 0.55, 0.15, 1.0),
    "yellow": (0.85, 0.80, 0.20, 1.0),
    "orange": (0.85, 0.50, 0.15, 1.0),
    "purple": (0.45, 0.15, 0.65, 1.0),
    "brown": (0.45, 0.30, 0.15, 1.0),
    "gray": (0.40, 0.40, 0.40, 1.0),
    "pink": (0.85, 0.50, 0.60, 1.0),
    "cyan": (0.15, 0.60, 0.65, 1.0),
    "lime": (0.50, 0.80, 0.15, 1.0),
    "magenta": (0.70, 0.20, 0.60, 1.0),
    "light_blue": (0.45, 0.60, 0.85, 1.0),
    "light_gray": (0.65, 0.65, 0.65, 1.0),
    # Utility / metals
    "glass": (0.85, 0.90, 0.95, 0.30),
    "tinted_glass": (0.30, 0.30, 0.35, 0.50),
    "iron": (0.75, 0.75, 0.75, 1.0),
    "gold": (0.85, 0.70, 0.20, 1.0),
    "diamond": (0.35, 0.85, 0.80, 1.0),
    "copper": (0.72, 0.45, 0.30, 1.0),
    # Light / emissive
    "lamp": (0.90, 0.80, 0.40, 1.0),
    "lava": (0.85, 0.30, 0.05, 1.0),
    "glow": (0.70, 0.90, 0.60, 1.0),
}

EMISSIVE_BLOCKS = {"lamp", "lava", "glow"}
TRANSPARENT_BLOCKS = {"glass", "tinted_glass", "water", "ice"}

TYPE_ALIASES = {
    "planks": "wood_planks",
    "plank": "wood_planks",
    "wood": "wood_planks",
    "oak_planks": "wood_planks",
    "oak_plank": "wood_planks",
    "birch_planks": "light_wood_planks",
    "dark_planks": "dark_wood_planks",
    "spruce_planks": "dark_wood_planks",
    "log": "wood_log",
    "oak_log": "wood_log",
    "wood_log_top": "wood_log",
    "trunk": "wood_log",
    "bricks": "brick",
    "stone_bricks": "stone_brick",
    "stones": "stone",
    "grass_block": "grass",
    "oak_leaves": "leaves",
    "leaf": "leaves",
    "snow_block": "snow",
    "ice_block": "ice",
    "iron_block": "iron",
    "gold_block": "gold",
    "diamond_block": "diamond",
    "copper_block": "copper",
    "glowstone": "lamp",
    "sea_lantern": "lamp",
    "lantern": "lamp",
    "wool": "white",
    "white_wool": "white",
    "black_wool": "black",
    "red_wool": "red",
    "blue_wool": "blue",
    "green_wool": "green",
    "yellow_wool": "yellow",
    "orange_wool": "orange",
    "purple_wool": "purple",
    "brown_wool": "brown",
    "gray_wool": "gray",
    "pink_wool": "pink",
    "cyan_wool": "cyan",
    "lime_wool": "lime",
    "magenta_wool": "magenta",
    "light_blue_wool": "light_blue",
    "light_gray_wool": "light_gray",
    "glass_block": "glass",
    "cobble": "cobblestone",
    "concrete_block": "concrete",
    "terracotta": "clay",
}

# Face directions: neighbor offset + projection from voxel (x,y,z) to (depth, u, v).
#
# The voxel API uses Y-up (intuitive: y=height). Blender uses Z-up internally,
# and export_static_glb sets export_yup=True to convert Z-up → Y-up GLB.
# We must also negate the forward axis: Blender -Y is forward, voxel +Z is forward.
# So we emit Blender vertices as (bx, by, bz) = (voxel_x, -voxel_z, voxel_y)
# to get correct orientation in the final GLB without extra rotation.
#
# Voxel coords:  X = right, Y = up,    Z = forward
# Blender coords: X = right, Y = -forward, Z = up
# Mapping: blender(x, y, z) = voxel(x, -z, y)
#
# Direction | depth | u | v | voxel world axes          | Blender (x,y,z) = voxel (x,-z,y)
# east  +X  | x+1   | y | z | vx=depth, vy=u, vz=v     | bx=depth, by=-v, bz=u
# west  -X  | x     | y | z | vx=depth, vy=u, vz=v     | bx=depth, by=-v, bz=u
# up    +Y  | y+1   | x | z | vx=u, vy=depth, vz=v     | bx=u, by=-v, bz=depth
# down  -Y  | y     | x | z | vx=u, vy=depth, vz=v     | bx=u, by=-v, bz=depth
# south +Z  | z+1   | x | y | vx=u, vy=v, vz=depth     | bx=u, by=-depth, bz=v
# north -Z  | z     | x | y | vx=u, vy=v, vz=depth     | bx=u, by=-depth, bz=v

_FACE_EAST = 0
_FACE_WEST = 1
_FACE_UP = 2
_FACE_DOWN = 3
_FACE_SOUTH = 4
_FACE_NORTH = 5

_DIRS = [
    # (dx, dy, dz) neighbor offset for face visibility check (in voxel coords)
    (1, 0, 0),  # east
    (-1, 0, 0),  # west
    (0, 1, 0),  # up
    (0, -1, 0),  # down
    (0, 0, 1),  # south
    (0, 0, -1),  # north
]


def _project(face, x, y, z):
    """Project block position to (depth, u, v) for a given face direction."""
    if face == _FACE_EAST:
        return (x + 1, y, z)
    if face == _FACE_WEST:
        return (x, y, z)
    if face == _FACE_UP:
        return (y + 1, x, z)
    if face == _FACE_DOWN:
        return (y, x, z)
    if face == _FACE_SOUTH:
        return (z + 1, x, y)
    if face == _FACE_NORTH:
        return (z, x, y)


def _make_quad(face, depth, u0, v0, u1, v1, cx, cy, cz, s):
    """Create 4 quad vertices from (depth, u, v) rectangle.

    Converts from voxel Y-up coords to Blender Z-up coords with negated forward:
        Blender (bx, by, bz) = Voxel (vx, -vz, vy)

    cx/cy/cz are centering offsets in voxel space (cx=X center, cy=Y/up center, cz=Z center).
    recalc_face_normals is called after all quads are emitted to fix winding.
    """
    # For east/west: voxel (depth=vx, u=vy, v=vz) → blender (depth, -v, u)
    if face == _FACE_EAST:  # +X
        d = (depth - cx) * s
        return [
            (d, (cz - v0) * s, (u0 - cy) * s),
            (d, (cz - v0) * s, (u1 - cy) * s),
            (d, (cz - v1) * s, (u1 - cy) * s),
            (d, (cz - v1) * s, (u0 - cy) * s),
        ]
    if face == _FACE_WEST:  # -X
        d = (depth - cx) * s
        return [
            (d, (cz - v1) * s, (u0 - cy) * s),
            (d, (cz - v1) * s, (u1 - cy) * s),
            (d, (cz - v0) * s, (u1 - cy) * s),
            (d, (cz - v0) * s, (u0 - cy) * s),
        ]
    # For up/down: voxel (u=vx, depth=vy, v=vz) → blender (u, -v, depth)
    if face == _FACE_UP:  # +Y → Blender +Z
        d = (depth - cy) * s
        return [
            ((u0 - cx) * s, (cz - v1) * s, d),
            ((u1 - cx) * s, (cz - v1) * s, d),
            ((u1 - cx) * s, (cz - v0) * s, d),
            ((u0 - cx) * s, (cz - v0) * s, d),
        ]
    if face == _FACE_DOWN:  # -Y → Blender -Z
        d = (depth - cy) * s
        return [
            ((u0 - cx) * s, (cz - v0) * s, d),
            ((u1 - cx) * s, (cz - v0) * s, d),
            ((u1 - cx) * s, (cz - v1) * s, d),
            ((u0 - cx) * s, (cz - v1) * s, d),
        ]
    # For south/north: voxel (u=vx, v=vy, depth=vz) → blender (u, -depth, v)
    if face == _FACE_SOUTH:  # +Z → Blender -Y
        d = (cz - depth) * s
        return [
            ((u1 - cx) * s, d, (v0 - cy) * s),
            ((u1 - cx) * s, d, (v1 - cy) * s),
            ((u0 - cx) * s, d, (v1 - cy) * s),
            ((u0 - cx) * s, d, (v0 - cy) * s),
        ]
    if face == _FACE_NORTH:  # -Z → Blender +Y
        d = (cz - depth) * s
        return [
            ((u0 - cx) * s, d, (v0 - cy) * s),
            ((u0 - cx) * s, d, (v1 - cy) * s),
            ((u1 - cx) * s, d, (v1 - cy) * s),
            ((u1 - cx) * s, d, (v0 - cy) * s),
        ]


def _normalize_type(raw_type):
    """Normalize a block type string using aliases and palette lookup."""
    t = raw_type.strip().lower().replace("-", "_")
    if t in BLOCK_PALETTE:
        return t
    if t in TYPE_ALIASES:
        return TYPE_ALIASES[t]
    # Try without trailing 's'
    if t.endswith("s") and t[:-1] in BLOCK_PALETTE:
        return t[:-1]
    return raw_type  # keep original, will get fallback color


def _is_opaque(block_type):
    """Check if a block type is opaque (occludes neighbors)."""
    return block_type not in TRANSPARENT_BLOCKS


_NEIGHBOR_OFFSETS = [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]


def _is_buried(pos, blocks):
    """Check if a block is completely surrounded by opaque blocks."""
    x, y, z = pos
    for dx, dy, dz in _NEIGHBOR_OFFSETS:
        neighbor = blocks.get((x + dx, y + dy, z + dz))
        if neighbor is None:
            return False
        if not _is_opaque(neighbor):
            return False
    return True


def _greedy_merge(cells):
    """Greedy rectangle merging on a set of (u, v) cells.

    Returns list of (u, v, width, height) rectangles that cover all cells.
    """
    if not cells:
        return []

    min_u = min(c[0] for c in cells)
    min_v = min(c[1] for c in cells)
    max_u = max(c[0] for c in cells)
    max_v = max(c[1] for c in cells)

    width = max_u - min_u + 1
    height = max_v - min_v + 1
    mask = bytearray(width * height)

    for u, v in cells:
        mask[(v - min_v) * width + (u - min_u)] = 1

    rects = []
    for v in range(height):
        for u in range(width):
            idx = v * width + u
            if mask[idx] == 0:
                continue

            # Extend width
            rect_w = 1
            while u + rect_w < width and mask[v * width + u + rect_w] == 1:
                rect_w += 1

            # Extend height
            rect_h = 1
            can_extend = True
            while can_extend and v + rect_h < height:
                for x in range(rect_w):
                    if mask[(v + rect_h) * width + u + x] == 0:
                        can_extend = False
                        break
                if can_extend:
                    rect_h += 1

            # Clear consumed cells
            for dy in range(rect_h):
                for dx in range(rect_w):
                    mask[(v + dy) * width + u + dx] = 0

            rects.append((min_u + u, min_v + v, rect_w, rect_h))

    return rects


class VoxelBuilder:
    """Accumulate voxel blocks and build an optimized Blender mesh object."""

    def __init__(self, block_size=0.05):
        """
        Args:
            block_size: Size of each voxel cube in meters (default 0.05 = 5cm).

        No cap on block count or grid coordinates. Use as many blocks as the
        model needs to be recognizable and well-detailed — face culling and
        greedy meshing at build() time keep the exported mesh efficient
        regardless of input block count.
        """
        self._blocks = {}  # (x, y, z) -> block_type (normalized)
        self._block_size = block_size

    def block(self, x, y, z, block_type):
        """Place a single block at integer coordinates."""
        x, y, z = int(x), int(y), int(z)
        self._blocks[(x, y, z)] = _normalize_type(block_type)

    def box(self, x1, y1, z1, x2, y2, z2, block_type):
        """Fill a rectangular prism with blocks (inclusive on all axes)."""
        bt = _normalize_type(block_type)
        lx, hx = min(int(x1), int(x2)), max(int(x1), int(x2))
        ly, hy = min(int(y1), int(y2)), max(int(y1), int(y2))
        lz, hz = min(int(z1), int(z2)), max(int(z1), int(z2))
        for yy in range(ly, hy + 1):
            for zz in range(lz, hz + 1):
                for xx in range(lx, hx + 1):
                    self._blocks[(xx, yy, zz)] = bt

    def line(self, x1, y1, z1, x2, y2, z2, block_type):
        """Place blocks along a line using DDA rasterization."""
        bt = _normalize_type(block_type)
        x1, y1, z1 = int(x1), int(y1), int(z1)
        x2, y2, z2 = int(x2), int(y2), int(z2)
        dx, dy, dz = abs(x2 - x1), abs(y2 - y1), abs(z2 - z1)
        steps = max(dx, dy, dz)
        if steps == 0:
            self._blocks[(x1, y1, z1)] = bt
            return
        sx = (x2 - x1) / steps
        sy = (y2 - y1) / steps
        sz = (z2 - z1) / steps
        for i in range(steps + 1):
            x = round(x1 + sx * i)
            y = round(y1 + sy * i)
            z = round(z1 + sz * i)
            self._blocks[(x, y, z)] = bt

    def sphere(self, cx, cy, cz, radius, block_type):
        """Fill a spherical region with blocks."""
        bt = _normalize_type(block_type)
        cx, cy, cz = int(cx), int(cy), int(cz)
        r = int(radius)
        r_sq = radius * radius
        for yy in range(cy - r, cy + r + 1):
            for zz in range(cz - r, cz + r + 1):
                for xx in range(cx - r, cx + r + 1):
                    dist_sq = (xx - cx) ** 2 + (yy - cy) ** 2 + (zz - cz) ** 2
                    if dist_sq <= r_sq:
                        self._blocks[(xx, yy, zz)] = bt

    def cylinder(self, cx, cz, y_min, y_max, radius, block_type):
        """Fill a vertical cylindrical region with blocks."""
        bt = _normalize_type(block_type)
        r = int(radius)
        r_sq = radius * radius
        for yy in range(int(y_min), int(y_max) + 1):
            for zz in range(int(cz) - r, int(cz) + r + 1):
                for xx in range(int(cx) - r, int(cx) + r + 1):
                    dist_sq = (xx - cx) ** 2 + (zz - cz) ** 2
                    if dist_sq <= r_sq:
                        self._blocks[(xx, yy, zz)] = bt

    def build(self, name="VoxelMesh", center=True):
        """Convert accumulated blocks into an optimized Blender mesh object.

        Applies face culling and greedy meshing, then emits geometry via bmesh.
        Returns the linked Blender object.

        Args:
            name: Name for the Blender mesh object.
            center: Controls mesh origin placement.
                True  (default) — auto-center at bottom-center of bounding box.
                False — origin at voxel grid (0, 0, 0). Use this when building
                        multiple parts for animation so all parts share the same
                        coordinate system.
                (cx, cy, cz) tuple — custom center point in voxel coordinates.
        """
        blocks = self._blocks
        if not blocks:
            print("[VoxelBuilder] Warning: no blocks placed, returning empty mesh")
            mesh = bpy.data.meshes.new(name)
            obj = bpy.data.objects.new(name, mesh)
            return link_obj(obj)

        total_blocks = len(blocks)

        # --- Phase 1: Remove buried blocks ---
        visible = {}
        for pos, bt in blocks.items():
            if not _is_buried(pos, blocks):
                visible[pos] = bt
        buried_count = total_blocks - len(visible)

        # --- Phase 2: Collect exposed faces & greedy merge ---
        # planes[(face_index, block_type, depth)] = set of (u, v)
        planes = {}
        for pos, bt in visible.items():
            x, y, z = pos
            for face_idx in range(6):
                dx, dy, dz = _DIRS[face_idx]
                neighbor = blocks.get((x + dx, y + dy, z + dz))
                if neighbor is not None:
                    if neighbor == bt:
                        continue
                    if _is_opaque(neighbor):
                        continue
                # Face is exposed
                depth, u, v = _project(face_idx, x, y, z)
                key = (face_idx, bt, depth)
                if key not in planes:
                    planes[key] = set()
                planes[key].add((u, v))

        # --- Phase 3: Greedy merge and emit bmesh geometry ---
        bm = bmesh.new()
        block_size = self._block_size

        # Compute centering offset in voxel space
        if center is True:
            # Auto-center: center X/Z at midpoint, Y at floor (min)
            min_x = min(p[0] for p in blocks)
            max_x = max(p[0] for p in blocks)
            min_y = min(p[1] for p in blocks)
            min_z = min(p[2] for p in blocks)
            max_z = max(p[2] for p in blocks)
            cx = (min_x + max_x + 1) / 2.0
            cy = float(min_y)
            cz = (min_z + max_z + 1) / 2.0
        elif center is False:
            # No centering — origin at voxel (0,0,0). Use for multi-part animation.
            cx, cy, cz = 0.0, 0.0, 0.0
        else:
            # Custom center point
            cx, cy, cz = float(center[0]), float(center[1]), float(center[2])

        # Track materials needed
        mat_cache = {}  # block_type -> material_index
        materials = []  # ordered list of materials

        total_faces = 0
        for (face_idx, bt, depth), cells in planes.items():
            rects = _greedy_merge(cells)

            # Ensure material exists
            if bt not in mat_cache:
                color = BLOCK_PALETTE.get(bt, (1.0, 0.0, 1.0, 1.0))
                if bt not in BLOCK_PALETTE:
                    print(f"[VoxelBuilder] Warning: unknown block type '{bt}', using fallback color")
                emission = None
                if bt in EMISSIVE_BLOCKS:
                    emission = (color[0], color[1], color[2], 1.0)
                mat = create_material(f"Voxel_{bt}", color, roughness=0.7, metallic=0.0, emission=emission)
                mat_idx = len(materials)
                materials.append(mat)
                mat_cache[bt] = mat_idx

            mat_idx = mat_cache[bt]

            for u, v, w, h in rects:
                u0, v0 = u, v
                u1, v1 = u + w, v + h
                verts_co = _make_quad(face_idx, depth, u0, v0, u1, v1, cx, cy, cz, block_size)
                bm_verts = [bm.verts.new(co) for co in verts_co]
                try:
                    face = bm.faces.new(bm_verts)
                    face.material_index = mat_idx
                    face.smooth = False
                    total_faces += 1
                except ValueError:
                    pass  # degenerate face, skip

        bm.verts.ensure_lookup_table()
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

        mesh = bpy.data.meshes.new(name)
        bm.to_mesh(mesh)
        bm.free()

        obj = bpy.data.objects.new(name, mesh)
        for mat in materials:
            obj.data.materials.append(mat)
        link_obj(obj)

        print(
            f"--- Voxel build: {total_blocks} blocks, {buried_count} buried, "
            f"{len(visible)} visible, {total_faces} faces (greedy merged) ---"
        )

        # Compute and print AABB in Blender meters and expected Lens Studio cm
        if obj.data.vertices:
            import mathutils as _mu

            bb_min_v = [float("inf")] * 3
            bb_max_v = [float("-inf")] * 3
            for corner in obj.bound_box:
                co = obj.matrix_world @ _mu.Vector(corner)
                for i in range(3):
                    bb_min_v[i] = min(bb_min_v[i], co[i])
                    bb_max_v[i] = max(bb_max_v[i], co[i])
            size_m = [bb_max_v[i] - bb_min_v[i] for i in range(3)]
            size_cm = [s * 100.0 for s in size_m]
            center_cm = [((bb_min_v[i] + bb_max_v[i]) * 0.5) * 100.0 for i in range(3)]
            print(f"--- AABB (Blender meters): {size_m[0]:.4f} x {size_m[1]:.4f} x {size_m[2]:.4f} ---")
            print(
                f"--- AABB (Lens Studio cm @ 100x import): {size_cm[0]:.1f} x {size_cm[1]:.1f} x {size_cm[2]:.1f} ---"
            )
            # Offset from object origin to AABB center, in Lens Studio cm.
            # Wrapper-pattern colliders need this to land on the visual centroid
            # instead of assuming bottom-center (which only holds for voxel center=True).
            print(f"--- AABB center offset (cm): {center_cm[0]:.1f}, {center_cm[1]:.1f}, {center_cm[2]:.1f} ---")

        return obj
