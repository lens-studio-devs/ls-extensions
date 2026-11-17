<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Capture procedure (all environments)

The capture is a four-step loop. Steps 1 and 4 are yours (judgement); steps 2 and 3 are a
deterministic script (`scripts/capture_driver.py`) so they cost seconds instead of minutes and
behave identically on macOS and on Linux/Xvfb CI. **Do not hand-drive the capture frame by frame** —
an agent-driven capture measured ~90% LLM latency and produced a frozen, mis-framed result.

## Step 1 — Plan the capture (agent, HARD CAP 2 MINUTES) — write the timeline ONCE

The plan is a **timed command list** (`timeline`) that the driver executes end to end with **no agent
thinking between operations**. You write it once — from the source code plus at most a couple of
probes — then run Step 2. Never operate the preview op-by-op yourself; if the first run shows the plan
was wrong, fix the timeline and re-run the whole thing.

Work out how the experience actually starts and answer only these, then stop:

- **How does the experience start?** Does it auto-play, or must you press a start/play control,
  place the content on a surface, or pinch? Which SceneObject? (Read the entry script + query
  `{ sceneRoots { uniqueId name enabled } }`.)
- **Which object is the subject** whose bounding box should frame the shot (the main payoff)?
- **Default viewpoint — in front of the user.** Frame the subject as the user first sees it, from at or near the default user position, with the subject centred and fully in frame. Only deviate when the lens experience has genuine other spatial requirements (content deliberately placed around, above, or behind the user); if so, say why in `notes`. If the content is so close to the user that even a natural front viewpoint cannot fit it (it overflows the frustum / is cropped), capture the best framing you can and record the crop as an issue to fix in `notes` — do not fabricate room by pulling the camera unnaturally far back.
- **How long** must the capture run to show the experience (recording duration / frame count)?
- **Would a preview reset undo the started state?** (Placement-gated lenses: yes.)

Verify your start sequence once, then write `capture_config.json` at the lens root:

```json
{
  "schema_version": 1, "level": "high", "validation_state": "validated",
  "lens": "<short name>",
  "subject": "<scene root name to frame>",
  "skip_reset": true,
  "frames": 10, "fps": 3, "max_dim": 640, "record_ms": 5000,
  "method_order": ["M3", "M2", "M1"],
  "timeline": [
    { "t":    0, "op": "editor_code", "code": "<enable/start the payoff>", "why": "TapEvent does not fire in stereo preview" },
    { "t": 1500, "op": "move_camera", "commands": [ {"action":"setPosition","x":0,"y":0,"z":-40}, {"action":"lookAt","x":0,"y":0,"z":-100} ] },
    { "t": 2000, "op": "shot",  "label": "front_start" },
    { "t": 2500, "op": "pinch", "args": { "...PreviewInteractTool..." : "" }, "why": "press Start" },
    { "t": 4000, "op": "burst", "label": "motion", "frames": 10, "fps": 3 },
    { "t": 9000, "op": "record", "label": "footage", "ms": 5000 },
    { "t": 15000, "op": "shot", "label": "front_end" }
  ],
  "notes": "how the payoff is reached; what a capture will and will not show",
  "limitations": []
}
```

`t` is milliseconds from timeline start; ops run in `t` order and the driver sleeps until each one is
due (a late op runs immediately and its lateness is recorded). Capture ops take real time — a 10-frame
burst at 3 fps needs ~4 s — so space the next `t` accordingly. When `timeline` is present it **replaces**
`start_actions` and the legacy single burst: the whole capture is the timeline.

| capture op | payload | what it does |
|---|---|---|
| `shot` | `{"label"}` | one frame (M2 runtime view; M1 panel on mechanical failure) |
| `burst` | `{"label","frames","fps"}` | ordered frames; M2 → M1 on mechanical failure **or frozen output** |
| `record` | `{"label","ms"}` | `ms` of real footage sampled at `fps` via M3 — macOS only; on Linux, or when the clip fails or comes back frozen, it degrades to an equivalent burst |

Plan ops usable in the timeline (same payloads as `start_actions` below): `editor_code`, `pinch`
(alias `preview_interact`), `gesture` (alias `inject_gesture`), `move_camera`, `verify_enabled`,
`wait`. Every capture op's frames are renamed `tlNN_<label>_KK.png|jpg` and kept in timeline order;
the driver then builds **one** `timeline.gif` and a **`contact_sheet.png`** (all frames tiled — read it
first when describing) and records per-op timing in `capture_result.json` → `timeline_run`
(`t_planned_s`, `t_actual_s`, `late_s`, `ok`, `frames`, `error`).

Plan ops (usable in `timeline` and, for legacy configs, `start_actions`; each must be one you verified):

| op | payload |
|---|---|
| `wait` | `{"ms": 1500}` |
| `inject_gesture` | `{"args": {…InjectPreviewGesture…}}` — raw touchpad taps |
| `preview_interact` | `{"args": {…PreviewInteractTool…}}` — IK hand actions |
| `editor_code` | `{"code": "<editor TS>"}` or `{"path": "<abs .ts>", "args": {}}` |
| `move_camera` | `{"commands": [{"action":"setPosition","x":0,"y":0,"z":0}, {"action":"lookAt","x":0,"y":0,"z":0}]}` |
| `verify_enabled` | `{"name": "<SceneObject>"}` |

**API facts — do not re-derive:** `MovePreviewCamera` `setPosition`/`lookAt` take `x,y,z` at the
command top level (NOT under `target`). `CapturePanelScreenshotTool` supports `outputPath` +
`maxDimension`. `CaptureRuntimeViewTool` returns images **inline only** (the driver decodes them —
no disk-save path exists). M3 runs `recordVideo` through the checked-in action
`scripts/editor/record-video.ts` and must NOT call `preview.refresh()` on a placement-gated lens
(refresh resets placement); without it the clip may come back static, which falls back to a burst
until recordVideo can record motion without a reset. `QueryRuntimeSceneTool`: `sceneRoots` works, and
bounds come from `sceneObject(uniqueId:"…") { bounds { min max } }` (`bounds` needs a selection;
`min`/`max` are JSON scalars). Raw `TapEvent` may not fire at all in a stereo SPECS preview — if
taps do nothing, an `editor_code` bypass that enables the payoff object directly is legitimate, but
say so in `notes` **and** note what it costs (e.g. a disabled controller means animation won't run).

## Step 2 — Run the capture (deterministic script)

```
python3 <skill>/scripts/capture_driver.py "<lens folder>" --config "<lens folder>/capture_config.json" \
    --frames-dir "<run dir>/eval_frames/<run_id>"
```

It resets (unless `skip_reset`), runs your `start_actions`, locates the subject + bounds, computes
the framing in closed form, then tries the methods in order, abandoning one on a **MECHANICAL
failure OR empty/degenerate output** — a transport drop, tool error, no file, zero frames, a crash
inside the method (any exception — frames it already wrote are kept on record), *or* a burst that
came back frozen (fewer than 2 frames, or every frame byte-identical / no motion). A frozen M3/M2
capture automatically falls through to M1, whose camera orbit turns it into distinct viewpoints:

1. **M3 `recordVideo`** — records real footage, samples it. Best fidelity; achieves the target fps.
   macOS only (see the platform gate below).
2. **M2 runtime-view burst** — inline images collected in memory, written after the burst.
3. **M1 panel burst + subtle orbit** — the panel only repaints on camera invalidation, so a tiny
   precomputed orbit is required or every frame is identical.

The first mechanically-successful method wins. Re-enter lower in the chain with
`--start-method M3|M2|M1`.

**Server-death hazard (measured).** In some environments `recordVideo` does not merely
fail — it takes the Lens Studio MCP server down with it. Observed on Linux/Xvfb CI: `M3` returned
`RemoteDisconnected`, then `M2` got `Connection refused` (nothing listening) and `M1` wrote no frames,
so the whole chain produced nothing. The runner probes liveness before each method and re-handshakes
once; if the server is gone it aborts the chain with `mcp_server_down` instead of pretending to try the
rest.

Because of this, **the runner applies a mechanical platform gate**: on **Linux** hosts (incl. Xvfb CI)
it disables M3 entirely and uses only **M2 then M1**, regardless of `method_order`; a `record` op there
is served as an equivalent burst. On **macOS** the full `["M3","M2","M1"]` chain applies. You may still
set `"method_order"` to influence ordering within what the gate allows. The gate and the no-refresh
recording are workarounds: remove them once recordVideo works on Linux and can record motion without a reset.

**Draft manifest.** With `--frames-dir`, the runner copies the timeline frames there and writes
`capture_manifest.json` beside them with the machine fields filled (path, media type, width, height,
sha256, bytes, `at_seconds`, `phase`, `source`, `capture_origin`, `sample_interval_seconds`,
status). `viewpoint` and `state` are left empty so `validate-contract.py` fails until the evaluator
fills them; the evaluator also sets `role`, `primary_artifact_ids` and `limitations`.

## Step 3 — Normalise dimensions

The driver already caps every frame and GIF at **≤640 px on the longest edge, aspect preserved**
(never stretched), via `maxDimension` where the tool supports it and ffmpeg otherwise.

If `ffmpeg` is absent on the host (measured on Linux CI), the driver **does not fail**: the frames
stay valid at native size, no GIF is built (`gif: null`), and `capture_result.json` lists it under
`missing_binaries`. Read `missing_binaries: ["ffmpeg"]` as "frames good, dimensions un-normalised"
and judge the frames directly — never as a failed capture.

## Step 4 — Judge the capture (agent), then loop if needed

Read `capture_driver/capture_result.json` (method chosen, `frame_count`, `unique_frames`, `dims`,
per-method `mechanical_error`) and look at the frames/GIF. Classify:

- **Good** → continue with the evaluation.
- **Bad viewpoint/placement** — the payoff isn't visible, is occluded, off-frame, too small/large, or
  the experience never actually started → **go back to Step 1**, fix the plan, re-run.
- **Missing capture** — frozen frames (`unique_frames` == 1, or ≪ `frame_count`), too few frames, or
  no input at all → **go back to Step 2** using the next method (`--start-method`).

**At most 3 attempts of Step 4.** If it still fails, record the capture as failed — say which
methods were tried and why each failed — and continue with the rest of the evaluation using whatever
evidence exists. A failed capture is itself a top-severity finding about the lens, not a reason to
stop the evaluation.
