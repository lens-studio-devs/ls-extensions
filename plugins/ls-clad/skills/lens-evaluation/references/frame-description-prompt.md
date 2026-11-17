<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Describing the capture in ONE pass — master prompt

Describe the captured frames **together, once** — never one frame per question. Sending frames one at a
time multiplies wall-clock and loses exactly what matters (motion, progression, consistency). The
evaluator is the LLM here: it loads every relevant frame into context in a single turn and then answers
the whole prompt below in a single written pass.

## Step 1 — Load all frames in a single turn

1. Read `capture_driver/capture_result.json` and the run's `capture_manifest.json` to get the ordered
   frame list (file, timestamp, viewpoint, method).
2. If `capture_driver/contact_sheet.png` exists (the driver tiles every frame with its index and
   timestamp when ffmpeg is available), `Read` it **first** — one image, all frames, guaranteed together.
3. Then `Read` the individual frames you need for detail **in the same assistant turn** — one message
   containing N `Read` calls (all motion frames + the primary viewpoint stills), not N turns.
4. Only after every image is in context, write the description. Do not interleave reads and prose.

If frames are byte-identical (`unique_frames` ≤ 1) say so up front — the sequence then carries no motion
evidence and every "animation" answer must be `Unverified`.

## Step 2 — Design the lens-specific prompt from this template

Fill the placeholders from Phase A (expectations) and the capture plan, then add lens-specific questions
(e.g. "Is the glass transparent — are the fish visible *through* it?"). Keep every section: each maps to a
report requirement, and an omitted section becomes an evidence gap the judges will penalise.

```text
You are describing evidence for a Lens evaluation. Original request: "{PROMPT}".
Expected elements (from the request): {EXPECTED_ELEMENTS_LIST}.
Frames, in order: {frame_file | t=+X.Xs | viewpoint | method} × N. Capture notes: {CAPTURE_NOTES}
(how the experience was started, any bypass used, what the capture cannot show — audio, haptics, real
world tracking). Answer every section below from the frames alone; say "Unverified" when the frames
cannot show it. Name the frame(s) and the object for every claim.

1. SCENE, AS A VIEWER SEES IT — plain, truthful, non-opinionated, non-technical. Every visible object;
   its material, colour and texture; its size relative to the other objects, the room and the user;
   where it sits (on a wall / floor / table / floating) and at what distance; lighting, colour mood and
   background; any UI text or panels and whether they are legible. What is NOT visible that the request
   implies.

2. ORIENTATION & ALIGNMENT TO THE USER — from the default viewpoint in front of the user: are objects
   upright or tilted; facing the user or back-facing / turned over / upside-down; is the payoff in front
   of the user or would they have to move or turn to see it; is anything occluded by another object; is
   content so close that it overflows the frame (cropped) or so far that it is too small to read? Any
   non-trivial initial setup, orientation or alignment problem is a point to be FIXED — state it as such.

3. MOTION & ANIMATION ACROSS THE SEQUENCE — compare consecutive frames using the timestamps. What
   changes (position, rotation, scale, visibility, UI state) and what stays still. Is motion natural and
   smooth at a believable speed, or jittery / teleporting / frozen? Are collisions resolved — do objects
   pass through or overlap each other, sink into or float above their support? Which objects that should
   animate (per the request) do not?

4. ASSET QUALITY & FINISHED SHAPES — is each object recognisably what the request asked for; are
   proportions and silhouettes right; are materials complete (stretched or missing textures, untextured
   or magenta surfaces); holes in geometry; flipped or inverted triangles (see-through faces); z-fighting;
   lighting and shadow consistency; stylistic coherence across assets.

5. SIZES, CLIPPING & INTER-OBJECT RELATIONS — real-world plausible scale; objects clipping through the
   floor, wall or each other; protruding or overlapping parts; correct layering / render order (e.g. an
   interior hidden by an opaque front surface that should be transparent); spacing and grounding.

6. EXPERIENCE & PROGRESSION — the start state (instruction / placement UI), whether the experience
   actually started, the controls visible, the state changes in order across the sequence (e.g. placement
   → content appears → animation → end state), the furthest state reached, and the frame that evidences
   each step. Describe the logic at a high level — no frame-by-frame narration.

7. EXPECTATIONS vs. REALIZATIONS — for each expected element: Met / Partial / Missing / Broken /
   Unverified, with the evidencing frame(s) and one factual note. Return this as a table.

8. DEFECTS TO FIX — a ranked list; each item names the object, the frame(s), the visible symptom, and
   (separately) the suspected cause if the capture notes or code suggest one.

9. WHAT THE CAPTURE COULD NOT SHOW — audio, haptics, real-world tracking, anything gated behind an
   interaction the plan could not perform, and any frozen / duplicated frames.
```

## Step 3 — Where the answers go

Section 1 → report **A.1 Visual and audio observations** (add audio from code/logs, marked as such).
Sections 2–5 → the scene-reasonableness findings in A.1 and the defect entries in **C**.
Section 6 → **A.2 Experience and progression**. Section 7 → **B Expectations vs. realizations**
(table only). Sections 8–9 → **C Major Issues** and the evidence-gap notes. Keep frame references as
`file (t=+X.Xs, viewpoint)` — never bare frame indices.
