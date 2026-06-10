# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

# ==============================================================================
# GLB Preview Renderer
#
# Imports a GLB file into Blender and renders preview images from multiple
# angles. For animated models, renders key frames from each animation clip.
#
# Usage:
#   blender --background --python preview_glb.py -- <path_to.glb> [--out <dir>]
#
# Outputs PNG images to <glb_dir>/preview/ (or --out directory).
# ==============================================================================

import math
import os
import sys

import bpy
import mathutils


def parse_args():
    """Parse arguments after '--' separator."""
    argv = sys.argv
    if "--" in argv:
        args = argv[argv.index("--") + 1 :]
    else:
        args = []

    glb_path = None
    out_dir = None
    i = 0
    while i < len(args):
        if args[i] == "--out" and i + 1 < len(args):
            out_dir = args[i + 1]
            i += 2
        elif not args[i].startswith("--"):
            glb_path = args[i]
            i += 1
        else:
            i += 1

    if not glb_path:
        print("Usage: blender --background --python preview_glb.py -- <path.glb> [--out <dir>]")
        sys.exit(1)

    if not out_dir:
        out_dir = os.path.join(os.path.dirname(glb_path), "preview")

    return glb_path, out_dir


def clear_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


def import_glb(glb_path):
    """Import GLB and reconnect NLA actions."""
    bpy.ops.import_scene.gltf(filepath=glb_path)
    for obj in bpy.data.objects:
        if obj.animation_data and obj.animation_data.nla_tracks:
            for track in obj.animation_data.nla_tracks:
                for strip in track.strips:
                    if strip.action:
                        obj.animation_data.action = strip.action
                        break


def get_scene_bounds():
    """Compute bounding box of all mesh objects."""
    all_min = [1e9, 1e9, 1e9]
    all_max = [-1e9, -1e9, -1e9]
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        bb = [obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box]
        for v in bb:
            for i in range(3):
                all_min[i] = min(all_min[i], v[i])
                all_max[i] = max(all_max[i], v[i])
    center = [(all_min[i] + all_max[i]) / 2 for i in range(3)]
    size = [all_max[i] - all_min[i] for i in range(3)]
    return center, size, all_min, all_max


def setup_lighting():
    """Add sun + fill lights."""
    bpy.ops.object.light_add(type="SUN", location=(3, -3, 5))
    sun = bpy.context.object
    sun.data.energy = 3.0
    sun.name = "Preview_Sun"

    bpy.ops.object.light_add(type="POINT", location=(-2, -2, 2))
    fill = bpy.context.object
    fill.data.energy = 80
    fill.name = "Preview_Fill"


def setup_camera(center, size, angle_name="front", yaw_deg=0, pitch_deg=25):
    """Position camera looking at center from a given angle."""
    max_dim = max(size)
    dist = max_dim * 2.8

    yaw = math.radians(yaw_deg)
    pitch = math.radians(pitch_deg)

    cam_x = center[0] + dist * math.sin(yaw) * math.cos(pitch)
    cam_y = center[1] - dist * math.cos(yaw) * math.cos(pitch)
    cam_z = center[2] + dist * math.sin(pitch)

    # Remove old camera if exists
    old_cam = bpy.data.objects.get("Preview_Camera")
    if old_cam:
        bpy.data.objects.remove(old_cam, do_unlink=True)

    bpy.ops.object.camera_add(location=(cam_x, cam_y, cam_z))
    cam = bpy.context.object
    cam.name = "Preview_Camera"

    direction = mathutils.Vector(center) - cam.location
    rot_quat = direction.to_track_quat("-Z", "Y")
    cam.rotation_euler = rot_quat.to_euler()
    cam.data.lens = 55

    bpy.context.scene.camera = cam
    return cam


def detect_animations():
    """Detect animation clips from baked frame ranges.
    Returns list of (name, start_frame, end_frame)."""
    # Check NLA strips first
    clips = []
    seen_ranges = set()
    for obj in bpy.data.objects:
        if not obj.animation_data:
            continue
        for track in obj.animation_data.nla_tracks:
            for strip in track.strips:
                key = (int(strip.frame_start), int(strip.frame_end))
                if key not in seen_ranges:
                    seen_ranges.add(key)
                    clips.append((strip.name, key[0], key[1]))

    # If no NLA, check action frame range
    if not clips:
        for obj in bpy.data.objects:
            if obj.animation_data and obj.animation_data.action:
                act = obj.animation_data.action
                start, end = int(act.frame_range[0]), int(act.frame_range[1])
                if (start, end) not in seen_ranges:
                    seen_ranges.add((start, end))
                    clips.append((act.name, start, end))

    return clips


def render_frame(frame, filepath):
    """Set frame and render to file."""
    bpy.context.scene.frame_set(frame)
    bpy.context.view_layer.update()
    bpy.context.scene.render.filepath = filepath
    bpy.ops.render.render(write_still=True)


def main():
    glb_path, out_dir = parse_args()
    os.makedirs(out_dir, exist_ok=True)

    model_name = os.path.splitext(os.path.basename(glb_path))[0]

    print(f"\n=== Preview: {model_name} ===")
    print(f"  GLB: {glb_path}")
    print(f"  Output: {out_dir}")

    clear_scene()
    import_glb(glb_path)

    center, size, bb_min, bb_max = get_scene_bounds()
    print(f"  Bounds: {bb_min} -> {bb_max}")
    print(f"  Center: {center}, Size: {size}")

    # Setup
    bpy.context.scene.render.engine = "BLENDER_EEVEE"
    bpy.context.scene.render.resolution_x = 600
    bpy.context.scene.render.resolution_y = 800
    bpy.context.scene.render.film_transparent = True

    setup_lighting()

    # Detect if animated
    clips = detect_animations()
    is_animated = len(clips) > 0

    if is_animated:
        print(f"  Animated: {len(clips)} clip(s)")
        for name, start, end in clips:
            print(f"    {name}: frames {start}-{end}")
    else:
        print("  Static mesh")

    rendered = []

    # --- Static views (3 angles at rest pose) ---
    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()
    center, size, _, _ = get_scene_bounds()  # refresh after frame set

    angles = [
        ("front", 20, 20),
        ("side", 90, 15),
        ("3quarter", 45, 25),
    ]
    for angle_name, yaw, pitch in angles:
        setup_camera(center, size, angle_name, yaw, pitch)
        path = os.path.join(out_dir, f"{model_name}_{angle_name}.png")
        render_frame(1, path)
        rendered.append(path)
        print(f"  Rendered: {angle_name}")

    # --- Animation frames (if animated) ---
    if is_animated:
        setup_camera(center, size, "anim", 30, 20)
        for clip_name, start, end in clips:
            duration = end - start
            # Render 4 evenly spaced frames per clip
            for i in range(4):
                frame = start + int(i * duration / 3)
                frame = min(frame, end)
                path = os.path.join(out_dir, f"{model_name}_anim_{frame:03d}.png")
                render_frame(frame, path)
                rendered.append(path)
                print(f"  Rendered: frame {frame} ({clip_name})")

    print(f"\n=== Preview complete: {len(rendered)} images ===")
    for p in rendered:
        print(f"  {p}")
    print("")


if __name__ == "__main__":
    main()
