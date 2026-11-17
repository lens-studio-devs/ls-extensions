<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Orientation verification via Lens Studio capture (no Blender)

Default preview path for the mesh verify step: confirm completeness / facing /
upright by capturing the mesh in the running Lens Studio preview — no Blender. The
numeric checks (`analyze_glb.js --aabb/--shape/--orient-meta`) and the facing bake
(`normalize_glb.js --yaw --mark-canonical`) are unchanged.

**Fallback:** no live preview / probe never surfaces → Blender via a single
`test -x /Applications/Blender.app/Contents/MacOS/Blender` gate. Never `which` /
`ls …*.app` / `mdfind` (one `mdfind` hunt hung a verifier 15 min). Neither → report
`completeness: unverified`.

## Parent (`step-mesh`): probe setup / teardown

Run the type-checked helper `tools/orient-probes.ts` via `make-eec-script.py` →
`ExecuteEditorCode` (never hand-write its CONFIG consts):

```bash
# setup — MESHES = [{ "name": "<Name>", "aabbMaxCm": <max dim from analyze_glb --aabb> }, ...]
python3 <skill-dir>/tools/make-eec-script.py <skill-dir>/tools/orient-probes.ts --set MODE=setup --json MESHES=$FILE
# teardown — after the fan-out
python3 <skill-dir>/tools/make-eec-script.py <skill-dir>/tools/orient-probes.ts --set MODE=teardown
```

Setup returns `{ probes: [{ name, probeName, center, distance }] }` (or per-mesh
`{ name, error }`) — validate against `tools/orient-probes.schema.json`, then hand
each verifier its `probeName` / `center` / `distance`. The helper parks each probe
at an isolated location under one holder with identity `worldTransform.rotation`;
teardown destroys the holder.

## Verifier (`step-mesh-verify`): confirm probe → capture → judge (read-only)

Confirm the probe — only `<probeName>` varies; use `nameContains`, NOT a
`name:{op:EQUALS}` filter (that errors). If `matches` is empty, re-query a few
times, then fall back:

```graphql
{ sceneObjects(filter: { nameContains: "<probeName>" }, limit: 1) {
    matches { summary transform { worldPosition } } totalScanned } }
```

Then capture — **no `uniqueIds`** (scene mode → world-aligned axes; single-object
mode rotates the axes by the object and begs the question). Images return inline;
judge directly:

```
CaptureRuntimeViewTool { center:<center>, distance:<distance>, viewAngle:"front" }
CaptureRuntimeViewTool { center:<center>, distance:<distance>, viewAngle:"back"  }
CaptureRuntimeViewTool { center:<center>, distance:<distance>, viewAngle:"left"  }
CaptureRuntimeViewTool { center:<center>, distance:<distance>, viewAngle:"top"   }
```

(Do not fake world-alignment with `uniqueIds:[id,id]`+`isolate` — the duplicate id
strands the object on layer 31.)

## Axis map (Y-up; each `viewAngle` puts the camera on the +axis looking at `center`)

| viewAngle | camera at | shows face | subject's front here → bake |
|---|---|---|---|
| front | +Z | +Z | front points +Z → `--yaw=180` |
| back  | −Z | −Z | already −Z (LS-forward) → no yaw |
| right | +X | +X | `--yaw=90` |
| left  | −X | −X | `--yaw=-90` |
| top   | +Y | +Y (top) | — |

**Upright:** front/back/left/right have +Y screen-up — a subject on its back/side
is obvious; upright fills `top` with a plan view. **Completeness:** the whole
subject, not a fragment.

**Gotcha:** identity on the probe root neutralizes an import rotation *on the root*;
if a mesh still reads tilted, the −90° X is on an inner node — zero that, not the root.
