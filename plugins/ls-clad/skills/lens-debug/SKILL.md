---
name: lens-debug
description: Orchestrator for Lens Studio runtime bugs. Routes symptoms (invisible, glitchy, pink material, handler not firing, asset not ready, physics flying off, glued-to-head, layout off) to the specialist that owns the fix.
argument-hint: [symptom or error description]
user-invocable: true
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Lens Studio Debug — Triage

Symptom: **$ARGUMENTS**

Router, not a fix-list. Apply the rules below, then use the Decision tree to find the right specialist. Symptom-keyed triage cards live in `references/known-issues.md` — load that file only when a Decision-tree row points there.

## Step 0 — confirm the Lens runs

Every check below assumes the Lens compiles and runs. If it doesn't, screenshots, scene queries, and logs return nothing — you'll debug the wrong layer.

- **No TS compile errors** — Lens Studio Logger panel. Red compile = no script runs.
- **No errors in startup log** — read with `ls-clad:lens-log-analysis`. Missing package / `@component` not registered / `onAwake` exception all cascade.
- **Scene wiring complete** — use the `scene-graphql` MCP tool (syntax covered by `scene-construction` → `references/scene-graphql.md`) to confirm objects, components, and `@input` references resolve.

If a later tool returns empty, re-check this layer before going deeper.

## Pacing — guess fast, slow down when stuck

- Coarse guesses first: change the one thing you think is wrong, verify visually. Don't trigger recompile / fresh logs / scene snapshot for every micro-step.
- After 2–3 misses, switch to incremental: clean log, scene-graphql query, or one `console.debug` — then read the data, not your prior theory.
- **Tell:** if you can't predict the next tool call's result before running it, you're guessing. Either commit and verify cheaply, or fall back to incremental.

## Stop-and-ask rule

Some misses are expected per Pacing — a couple of failed guesses plus an incremental round is normal. But if even the incremental fallback (clean log, scene query, instrumented re-run) hasn't landed, **stop**. Further attempts without new information introduce more bugs than they fix. Ask the user for:

- Screen recording / screenshot + expected behavior.
- Scene state at failure — `scene-graphql` query output.
- Minimal repro (deterministic or intermittent?).
- Last change that worked.
- Target hardware (phone preview vs Specs + firmware).

Concrete asks beat open-ended ones. "Share the screen recording around the failure" > "any extra info?"

## Reading the preview — yours vs the backdrop

The preview's background (coffee table, face, hands, room) is **not in your scene hierarchy** — it's a recorded/synthesized AR backdrop.

- **Don't try to "fix" the backdrop** — nothing in your scene tree corresponds to it.
- **The backdrop does not occlude or collide with your scene** unless you add an occluder (`WorldMesh` with occluder material, or Head Occluder for face Lenses).

"Object floating in front of the table" = expected without an occluder. "Object behind the table when it shouldn't be" = occluder config, not transforms.

## Decision tree

### Visual
| Symptom | Section |
|---|---|
| Invisible / wrong place / glitchy | Invisible, wrong place, or glitchy |
| Pink material / missing texture / color leak | Colors / textures look wrong |
| Layout wrong / objects overlap | Layout wrong at runtime |

### Runtime behavior
| Symptom | Section |
|---|---|
| Stays glued to head / not world-anchored | Content stays glued to the camera |
| Handler never fires / one-shot event missed | Handler never fires |
| Async asset null / dynamic component not set up | Asset or dynamic object not ready |
| Physics object drifts off / vanishes | Physics object isn't where you put it |

### Specialist routing
| Symptom | Load |
|---|---|
| TS / scripting bug (compile, runtime, `@input`, fetch null, event timing/leak) | `lens-api` → `references/debugging.md` |
| Specs subsystem (SIK / RSG / SyncKit / SnapML), VIO/SLAM tracking | `ls-clad:specs-debug` — *in addition to* this orchestrator |
| Read or filter the Lens log | `ls-clad:lens-log-analysis` |
| Inspect current scene state | `scene-construction` → `references/scene-graphql.md`, then query with `scene-graphql` |

If you can't place the symptom, default to the TS / scripting bug row.
