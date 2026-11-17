#!/usr/bin/env python3
# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0
"""
Canonical proxy-GLB generator for the Specs build `proxy` step.

Writes a primitive placeholder GLB at a mesh's FINAL path so the skeleton scene is
visible early; the real generation later overwrites the same file. This is a
DETERMINISTIC emitter — the agent invokes it with the plan's size/primitive instead
of hand-writing a GLB writer, so the one detail that must never drift is baked in:

  The GLB is authored in METERS. Lens Studio imports GLBs at 100x (glTF is meters,
  LS world is cm), so a 30 cm box is 0.30 raw units, NOT 30. `--size-cm` is the
  human/plan unit (centimeters); this tool divides by 100 internally so the proxy
  imports at the identical scale as the real, meter-native SPECS/Blender GLB. A
  cm-native proxy renders fine on its own but is 100x oversize the moment the real
  mesh overwrites it under the same placement (the wrapper double-scale bug).

Shape fidelity is irrelevant — nothing here survives the swap — so what matters and
is guaranteed: correct AABB (from `--size-cm`), grounding (bottom on the floor with
`--ground`, matching how the real mesh is normalized), and meter units.

Usage:
  gen-proxy-glb.py --out <abs path> --size-cm SX,SY,SZ [--primitive box|plane|cylinder|sphere|capsule] [--ground]

Prints one JSON line: {"out","primitive","aabb_cm":[x,y,z],"grounded",bytes}.
"""

import argparse
import json
import math
import os
import struct
import sys

CM_PER_M = 100.0


def _box(sx, sy, sz, y0):
    hx, hz = sx / 2, sz / 2
    y1 = y0 + sy
    v = [
        (-hx, y0, -hz),
        (hx, y0, -hz),
        (hx, y0, hz),
        (-hx, y0, hz),  # bottom
        (-hx, y1, -hz),
        (hx, y1, -hz),
        (hx, y1, hz),
        (-hx, y1, hz),  # top
    ]
    f = [
        (0, 2, 1),
        (0, 3, 2),  # bottom
        (4, 5, 6),
        (4, 6, 7),  # top
        (0, 1, 5),
        (0, 5, 4),  # -z
        (2, 3, 7),
        (2, 7, 6),  # +z
        (1, 2, 6),
        (1, 6, 5),  # +x
        (3, 0, 4),
        (3, 4, 7),  # -x
    ]
    return v, f


def _plane(sx, sy, sz, y0):
    # thin flat quad in the XZ plane at the grounded height
    hx, hz = sx / 2, sz / 2
    y = y0
    v = [(-hx, y, -hz), (hx, y, -hz), (hx, y, hz), (-hx, y, hz)]
    f = [(0, 2, 1), (0, 3, 2), (0, 1, 2), (0, 2, 3)]  # double-sided
    return v, f


def _cylinder(sx, sy, sz, y0, seg=20):
    rx, rz = sx / 2, sz / 2
    y1 = y0 + sy
    v, f = [], []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        v.append((rx * math.cos(a), y0, rz * math.sin(a)))
        v.append((rx * math.cos(a), y1, rz * math.sin(a)))
    cb, ct = len(v), len(v) + 1
    v.append((0.0, y0, 0.0))
    v.append((0.0, y1, 0.0))
    for i in range(seg):
        b0, t0 = 2 * i, 2 * i + 1
        b1, t1 = 2 * ((i + 1) % seg), 2 * ((i + 1) % seg) + 1
        f.append((b0, b1, t1))
        f.append((b0, t1, t0))
        f.append((cb, b1, b0))  # bottom cap
        f.append((ct, t0, t1))  # top cap
    return v, f


def _sphere(sx, sy, sz, y0, seg=16):
    r = min(sx, sy, sz) / 2
    cy = y0 + r  # grounded: center a radius above the floor
    v, f = [], []
    rings = seg // 2
    for i in range(rings + 1):
        theta = math.pi * i / rings
        for j in range(seg + 1):
            phi = 2 * math.pi * j / seg
            v.append(
                (r * math.sin(theta) * math.cos(phi), cy + r * math.cos(theta), r * math.sin(theta) * math.sin(phi))
            )
    w = seg + 1
    for i in range(rings):
        for j in range(seg):
            a = i * w + j
            f.append((a, a + 1, a + w))
            f.append((a + 1, a + w + 1, a + w))
    return v, f


PRIMS = {"box": _box, "plane": _plane, "cylinder": _cylinder, "sphere": _sphere, "capsule": _cylinder}


def write_glb(out, v, f):
    pos = b"".join(struct.pack("<3f", *p) for p in v)
    flat = [i for tri in f for i in tri]
    idx = b"".join(struct.pack("<H", i) for i in flat)
    if len(pos) % 4:
        pos += b"\x00" * (4 - len(pos) % 4)
    idx_off = len(pos)
    if len(idx) % 4:
        idx += b"\x00" * (4 - len(idx) % 4)
    bin_chunk = pos + idx
    xs = [p[0] for p in v]
    ys = [p[1] for p in v]
    zs = [p[2] for p in v]
    gltf = {
        "asset": {"version": "2.0", "generator": "ls-clad gen-proxy-glb (meters)"},
        "scenes": [{"nodes": [0]}],
        "nodes": [{"name": "geometry_0", "mesh": 0}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "indices": 1}]}],
        "buffers": [{"byteLength": len(bin_chunk)}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(pos), "target": 34962},
            {"buffer": 0, "byteOffset": idx_off, "byteLength": len(idx), "target": 34963},
        ],
        "accessors": [
            {
                "bufferView": 0,
                "componentType": 5126,
                "count": len(v),
                "type": "VEC3",
                "min": [min(xs), min(ys), min(zs)],
                "max": [max(xs), max(ys), max(zs)],
            },
            {"bufferView": 1, "componentType": 5123, "count": len(flat), "type": "SCALAR"},
        ],
    }
    js = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    if len(js) % 4:
        js += b" " * (4 - len(js) % 4)
    total = 12 + 8 + len(js) + 8 + len(bin_chunk)
    with open(out, "wb") as fp:
        fp.write(struct.pack("<III", 0x46546C67, 2, total))
        fp.write(struct.pack("<II", len(js), 0x4E4F534A))
        fp.write(js)
        fp.write(struct.pack("<II", len(bin_chunk), 0x004E4942))
        fp.write(bin_chunk)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--out", required=True, help="absolute output path, the mesh's FINAL Assets/GeneratedMeshes/<Name>.glb"
    )
    ap.add_argument("--size-cm", required=True, help="SX,SY,SZ in centimeters (plan target_size_cm)")
    ap.add_argument("--primitive", default="box", choices=sorted(PRIMS))
    ap.add_argument(
        "--ground", action="store_true", help="place the bottom on the floor (min-Y = 0), matching real-mesh grounding"
    )
    ap.add_argument(
        "--force",
        action="store_true",
        help="write even if the path already exists (default: skip, to never clobber a real mesh)",
    )
    a = ap.parse_args()
    try:
        cm = [float(x) for x in a.size_cm.split(",")]
        if len(cm) != 3 or any(d <= 0 for d in cm):
            raise ValueError
    except ValueError:
        print("--size-cm must be three positive numbers SX,SY,SZ", file=sys.stderr)
        sys.exit(2)
    # NEVER clobber an existing file. The proxy step runs concurrently with the mesh
    # step and both write to the same final path; the mesh is authoritative and
    # overwrites the proxy, but the proxy must never overwrite the mesh. If a fast/
    # cached real generation (or a prior placeholder) already landed here, skip — a
    # late proxy write would otherwise replace the real GLB with a ~1KB box and force
    # a full regeneration (measured race). The proxy only fills EMPTY paths.
    if os.path.exists(a.out) and not a.force:
        print(
            json.dumps(
                {"out": a.out, "skipped": "path already exists — not clobbering", "bytes": os.path.getsize(a.out)}
            )
        )
        return
    # cm -> meters: the whole point of the tool
    sx, sy, sz = (d / CM_PER_M for d in cm)
    y0 = 0.0 if a.ground else -sy / 2
    v, f = PRIMS[a.primitive](sx, sy, sz, y0)
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    write_glb(a.out, v, f)
    print(
        json.dumps(
            {
                "out": a.out,
                "primitive": a.primitive,
                "aabb_cm": cm,
                "grounded": a.ground,
                "bytes": os.path.getsize(a.out),
            }
        )
    )


if __name__ == "__main__":
    main()
