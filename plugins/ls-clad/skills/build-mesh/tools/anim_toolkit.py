# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

# ==============================================================================
# Blender Animation Toolkit
#
# Bakes per-frame animation transforms directly onto mesh objects for
# reliable GLTF/GLB export. Works with any mesh built using the mesh_toolkit.
#
# Key insight: Blender's GLTF exporter drops animations on Empty objects.
# This toolkit works around that by:
#   1. Snapshotting the rest-pose world matrices of all meshes
#   2. Computing animated deltas per group (leg, arm, torso, etc.)
#   3. Unparenting all meshes and keyframing decomposed loc/rot/scale
#   4. Pushing actions to NLA tracks for proper multi-object export
#
# Usage:
#   from anim_toolkit import AnimationBaker
#   baker = AnimationBaker(anim_groups=["Leg_-1", "Leg_1", ...],
#                          hierarchy={"Torso": {"parent": "Knight", ...}})
#   baker.snapshot()
#   baker.unparent_meshes()
#   baker.bake("Walk", 48, walk_delta_fn)
#   baker.bake("Attack", 36, attack_delta_fn)
#   baker.export_glb("/path/to/output.glb")
# ==============================================================================


import bpy
import mathutils

# ===========================================================================
# ANIMATION BAKER
# ===========================================================================


class AnimationBaker:
    """
    Bakes multiple named animations onto mesh objects for GLTF export.

    Args:
        anim_groups: List of empty/group names that will be animated.
        hierarchy: Dict mapping group names to their parent chain info.
            Example: {"Head": {"parent": "Torso"}, "Torso": {"parent": "Knight"}}
            Groups not listed default to having "Knight" (or first group) as parent.
    """

    def __init__(self, anim_groups, hierarchy=None):
        self.anim_groups = set(anim_groups)
        self.hierarchy = hierarchy or {}
        self.all_meshes = []
        self.rest_world = {}
        self.mesh_to_group = {}
        self.group_pivots = {}
        self.frame_offset = 0
        self.animations = []  # list of (name, start_frame, end_frame)

    def snapshot(self):
        """Capture rest-pose world matrices and group assignments for all meshes."""
        bpy.context.scene.frame_set(1)
        bpy.context.view_layer.update()

        self.all_meshes = [o for o in bpy.data.objects if o.type == "MESH"]
        self.rest_world = {obj.name: obj.matrix_world.copy() for obj in self.all_meshes}

        def get_group(obj):
            cur = obj
            while cur:
                if cur.name in self.anim_groups:
                    return cur.name
                cur = cur.parent
            return None

        self.mesh_to_group = {obj.name: get_group(obj) for obj in self.all_meshes}

        for name in self.anim_groups:
            obj = bpy.data.objects.get(name)
            if obj:
                self.group_pivots[name] = obj.matrix_world.translation.copy()

    def unparent_meshes(self):
        """Unparent all meshes preserving world transforms, then remove empties."""
        for obj in self.all_meshes:
            if obj.parent:
                world_mat = obj.matrix_world.copy()
                obj.parent = None
                obj.matrix_world = world_mat
                loc, rot, sca = world_mat.decompose()
                obj.location = loc
                obj.rotation_mode = "QUATERNION"
                obj.rotation_quaternion = rot
                obj.scale = sca
        bpy.context.view_layer.update()
        for obj in list(bpy.data.objects):
            if obj.type == "EMPTY":
                bpy.data.objects.remove(obj, do_unlink=True)

    def _get_parent_chain(self, grp):
        """Walk the hierarchy to build the chain of parent deltas to apply."""
        chain = []
        current = grp
        while current in self.hierarchy:
            parent_name = self.hierarchy[current].get("parent")
            if parent_name:
                chain.append(parent_name)
                current = parent_name
            else:
                break
        return chain  # e.g. ["Torso", "Knight"] for a Head group

    def _apply_deltas(self, deltas, frame):
        """Apply delta transforms to all meshes with proper hierarchy chaining."""
        for obj in self.all_meshes:
            grp = self.mesh_to_group.get(obj.name)
            rest = self.rest_world[obj.name]

            # Build the full transform chain: parent deltas @ own delta @ rest
            combined = mathutils.Matrix.Identity(4)

            if grp and grp in self.anim_groups:
                # Get parent chain for this group
                parents = self._get_parent_chain(grp)
                # Apply from root to leaf: Knight -> Torso -> group
                for parent_name in reversed(parents):
                    if parent_name in deltas:
                        combined = combined @ deltas[parent_name]
                # Apply own delta
                if grp in deltas:
                    combined = combined @ deltas[grp]
            elif grp:
                # Group exists but has no entry in hierarchy - just apply Knight/root
                parents = self._get_parent_chain(grp)
                for parent_name in reversed(parents):
                    if parent_name in deltas:
                        combined = combined @ deltas[parent_name]

            new_mat = combined @ rest
            loc, rot, sca = new_mat.decompose()
            obj.location = loc
            obj.rotation_quaternion = rot
            obj.scale = sca
            obj.keyframe_insert(data_path="location", frame=frame)
            obj.keyframe_insert(data_path="rotation_quaternion", frame=frame)
            obj.keyframe_insert(data_path="scale", frame=frame)

    def bake(self, name, num_frames, delta_fn):
        """
        Bake one animation clip.

        Args:
            name: Animation name (e.g. "Walk", "Guard", "Attack").
            num_frames: Number of frames for this clip.
            delta_fn: Callable(frame, total_frames, pivots) -> dict of deltas.
                Should return {group_name: Matrix4x4} for each animated group.
        """
        start_frame = self.frame_offset + 1
        end_frame = self.frame_offset + num_frames

        print(f"--- Baking '{name}': frames {start_frame}-{end_frame} ({num_frames}f) ---")

        for frame in range(start_frame, end_frame + 1):
            local_frame = frame - self.frame_offset
            deltas = delta_fn(local_frame, num_frames, self.group_pivots)
            self._apply_deltas(deltas, frame)

        self.animations.append((name, start_frame, end_frame))
        self.frame_offset = end_frame

    def finalize(self):
        """Set interpolation to linear and configure timeline."""
        scene = bpy.context.scene
        scene.frame_start = 1
        scene.frame_end = self.frame_offset

        for obj in self.all_meshes:
            if not obj.animation_data or not obj.animation_data.action:
                continue
            action = obj.animation_data.action
            if hasattr(action, "is_action_layered") and action.is_action_layered:
                for layer in action.layers:
                    for strip in layer.strips:
                        for cb in strip.channelbags:
                            for fcurve in cb.fcurves:
                                for kp in fcurve.keyframe_points:
                                    kp.interpolation = "LINEAR"
            elif hasattr(action, "fcurves"):
                for fcurve in action.fcurves:
                    for kp in fcurve.keyframe_points:
                        kp.interpolation = "LINEAR"

        bpy.context.scene.frame_set(1)
        print(f"--- All animations baked: {self.frame_offset} total frames ---")
        for name, start, end in self.animations:
            dur = (end - start + 1) / bpy.context.scene.render.fps
            print(f"  {name}: frames {start}-{end} ({dur:.1f}s)")

    def export_glb(self, output_path):
        """Export as animated GLB with NLA tracks."""
        self.finalize()

        # Push actions to NLA tracks
        for obj in bpy.data.objects:
            if obj.animation_data and obj.animation_data.action:
                action = obj.animation_data.action
                track = obj.animation_data.nla_tracks.new()
                track.name = "Animations"
                strip = track.strips.new("Animations", 1, action)
                strip.name = "Animations"
                obj.animation_data.action = None

        active_obj = None
        for obj in bpy.data.objects:
            obj.select_set(True)
            if obj.type == "MESH" and active_obj is None:
                active_obj = obj
        if active_obj:
            bpy.context.view_layer.objects.active = active_obj

        override = bpy.context.copy()
        override["active_object"] = active_obj
        override["selected_objects"] = list(bpy.data.objects)

        with bpy.context.temp_override(**override):
            bpy.ops.export_scene.gltf(
                filepath=output_path,
                export_format="GLB",
                export_apply=False,
                export_yup=True,
                export_texcoords=True,
                export_normals=True,
                export_materials="EXPORT",
                export_morph=True,
                export_animations=True,
                export_frame_range=True,
                export_nla_strips=True,
                export_current_frame=False,
            )

        total_verts = sum(len(o.data.vertices) for o in bpy.data.objects if o.type == "MESH")
        total_faces = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == "MESH")
        print(f"--- Exported to {output_path} ---")
        print(f"--- {total_verts} verts, {total_faces} faces ---")

        # Compute and print AABB in Blender meters and expected Lens Studio cm
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
            print(
                f"--- AABB (Lens Studio cm @ 100x import): {size_cm[0]:.1f} x {size_cm[1]:.1f} x {size_cm[2]:.1f} ---"
            )
            print(f"--- AABB center offset (cm): {center_cm[0]:.1f}, {center_cm[1]:.1f}, {center_cm[2]:.1f} ---")


# ===========================================================================
# HELPER: DELTA BUILDERS
# ===========================================================================


def make_delta(pivot, rot_angle, axis, translate=(0, 0, 0)):
    """Create a rotation delta around a pivot point with optional translation."""
    p = pivot
    to_o = mathutils.Matrix.Translation(-p)
    from_o = mathutils.Matrix.Translation(p + mathutils.Vector(translate))
    rot_m = mathutils.Matrix.Rotation(rot_angle, 4, axis)
    return from_o @ rot_m @ to_o


def make_multi_rot_delta(pivot, rotations, translate=(0, 0, 0)):
    """Create a delta with multiple rotations around a pivot.
    rotations: list of (angle, axis) tuples applied in order.
    """
    p = pivot
    to_o = mathutils.Matrix.Translation(-p)
    from_o = mathutils.Matrix.Translation(p + mathutils.Vector(translate))
    combined = mathutils.Matrix.Identity(4)
    for angle, axis in rotations:
        combined = mathutils.Matrix.Rotation(angle, 4, axis) @ combined
    return from_o @ combined @ to_o


def lerp(a, b, t):
    """Linear interpolation between a and b."""
    return a + (b - a) * t


def smoothstep(edge0, edge1, x):
    """Hermite smoothstep interpolation."""
    t = max(0, min(1, (x - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)


# ===========================================================================
# VIEWER SCRIPT GENERATOR
# ===========================================================================


def generate_viewer_script(glb_path, total_frames):
    """Create a Python script that opens the GLB in Blender with all animations connected."""
    script = f'''import bpy

for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)

bpy.ops.import_scene.gltf(filepath="{glb_path}")

# Reconnect all actions to their objects
for obj in bpy.data.objects:
    action = bpy.data.actions.get(obj.name + "Action")
    if action:
        if not obj.animation_data:
            obj.animation_data_create()
        obj.animation_data.action = action

bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = {total_frames}
bpy.context.scene.frame_set(1)

for area in bpy.context.screen.areas:
    if area.type == 'VIEW_3D':
        for region in area.regions:
            if region.type == 'WINDOW':
                override = bpy.context.copy()
                override['area'] = area
                override['region'] = region
                with bpy.context.temp_override(**override):
                    bpy.ops.view3d.view_all()
                break
'''
    viewer_path = glb_path.replace(".glb", "_viewer.py").replace(".GLB", "_viewer.py")
    with open(viewer_path, "w") as f:
        f.write(script)
    print(f"--- Viewer script: {viewer_path} ---")
    return viewer_path
