<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Verify one GLB (read-only)

Everything a per-mesh verify agent needs. **Read this instead of loading the `build-mesh`
skill** — four of six verifiers in a measured build loaded the full skill (~9.5K tokens,
including the backend menu they are forbidden to use) to run six Bash commands, and the two
slowest were the two that went hand-grepping it.

**You do not modify the GLB.** The mesh parent normalizes, grounds and stamps every file in
one combined `normalize_glb.js` invocation right after download, so the file you are handed
is already final. Verifying read-only is what lets the parent's re-bind run *concurrently*
with you instead of waiting out the tail (~94s of serial mutation in that build).

`<tools>` below is the tools dir your spawn prompt names. Blender is only ever
`/Applications/Blender.app/Contents/MacOS/Blender` — the bare `blender` PATH shim is broken.

## The loop

Numeric checks first (Node, no Blender) — the calls report a missing/0-byte file themselves,
so there is no separate existence precheck:

```bash
node <tools>/analyze_glb.js <glb> --aabb          # the two unified AABB lines
node <tools>/analyze_glb.js <glb> --shape         # flat / sliver heuristic
node <tools>/analyze_glb.js <glb> --orient-meta   # the canonical stamp the parent wrote
```

**Previews default to Lens Studio capture — no Blender.** The parent instantiated an
isolated, identity-rotation probe for your mesh and names its `probeName`, `center` and
`distance` in your spawn prompt. Confirm the probe with `QueryRuntimeSceneTool` (poll a few
times if it has not surfaced yet), then capture it **world-aligned** with
`CaptureRuntimeViewTool` in **scene mode** — no `uniqueIds`, look at `center`, tight
`distance` — at `front` / `back` / `left` / `top`, and judge the inline images. The exact
calls, the Y-up axis map, and the facing→yaw reading are in `orientation-lscapture.md`.

**Fallback order — never hunt for Blender.** If no live preview is reachable / the probe
never surfaces after your bounded poll, fall back to a Blender render ONLY IF it exists at
the one canonical path — a single `test -x` gate and nothing else:

```bash
test -x /Applications/Blender.app/Contents/MacOS/Blender && \
  /Applications/Blender.app/Contents/MacOS/Blender --background \
    --python <tools>/preview_glb.py -- <glb>       # fallback previews → <glb-dir>/preview/
```

**NEVER** run `which blender`, `ls -d /Applications/Blender*.app`, `mdfind`, or any other
install hunt — one improvised `mdfind` hung a verifier for **15 minutes**. If the `test -x`
gate is false, Blender is absent: stop, do not search. If neither capture nor Blender
produced previews, report `completeness: unverified`, `preview_verified: false` and the
numeric fields you did get — do not spend more than one gate on discovering an absent tool.

Then judge three things against the description in your spawn prompt (from the capture
images, or the fallback PNGs in `<glb-dir>/preview/`):

- **Completeness** — the whole subject, not a fragment (a "spaceship" that is only a
  cockpit). `verified` when the images show it; `suspect` when the shape heuristic tripped
  or a part is missing; `unverified` when no render was possible.
- **Upright / facing** — the front faces `-Z` and +Y is up. Your spawn prompt states the
  facing convention verbatim; do not re-derive it, and do not re-flip the mesh.
- **Size** — the AABB matches the `target_size_cm` in your spawn prompt.

If the analyze call reports a missing or 0-byte file, that is `status: GLB_MISSING` — report
it, do not regenerate.

**Only if your spawn prompt says the parent did NOT normalize** do you write to the file, and
then it is exactly one invocation with every flag at once — separate passes cost four of six
meshes an extra bake → re-ground → re-stamp round trip:

```bash
node <tools>/normalize_glb.js <glb> <glb> --max-dim=<N> --yaw=<deg> --ground --mark-canonical
```

## Report fragment

Write it to disk first (`.clad/steps/mesh-verify/<Name>.json`, one `Bash` line) — a reply can
go undelivered, and two of six completions never arrived in that build. Then return the same
object as your final reply:

```
MESH_VERIFY_RESULT
{"name": "<Name>", "path": "<path>", "status": "ok|GLB_MISSING", "backend": "<backend>",
 "aabb_cm": [x,y,z], "aabb_center_offset_cm": [x,y,z], "aabb_min_cm": [x,y,z],
 "forward_axis": "-Z", "upright": true, "completeness": "verified|suspect|unverified",
 "grounded": true, "normalized": true, "size_warning": false, "preview_verified": true,
 "notes": "<what the previews showed, or empty>"}
```

`suspect`, wrong subject, auth failures and timeouts are **verdicts you report**, never
things you fix: backend choice, regeneration and auth all belong to the parent.
