---
name: specs-prototype-promote
description: >-
  Promote a working single-file Specs prototype into an authored Lens Studio
  project with selectable surface roots and Inspector inputs. Use when the user
  wants to keep building on a prototype.
user-invocable: true
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Promote a Specs Prototype

Preserve a working prototype's behavior while exposing its surfaces in the
Hierarchy and its useful settings in the Inspector. Widgets, list rows, and
procedural geometry remain runtime-created inside the component that owns them.

Be the project's only writer. Confirm the expected project is open, compile the
prototype, and run it before starting. If it fails, stop and fix the prototype
first. The `ls-clad:specs-prototype-promoter` agent runs this same workflow.

## 1. Record a baseline

Write `.clad/steps/promote-before.json` outside `Assets/`, containing:

- Original script path and component/object IDs, enabled state, and owned roots.
- Intended surface poses/sizes and the tunables that determine them.
- A Preview capture and an inventory of interactions with their verification
  status. Exercise the primary interaction if installed preview tooling supports
  it; otherwise identify the checks the user must repeat after promotion.

Use `QueryRuntimeSceneTool` for live transforms and bounds; `/preview-inspection`
owns measurement guidance. Compare stable state, accounting for billboarding or
manipulation. Use tolerances appropriate to each measurement. Missing or unreliable
geometry is a recorded limitation, not an automatic refusal; do not fabricate
measurements or call a capture proof of preserved behavior.

Record files and roots created by this conversion as you go. This inventory
limits cleanup and supports recovery if a later step fails.

## 2. Separate surfaces and settings

Follow the prototype's object factories and `onAwake` calls, not just direct
`createSceneObject` calls, to identify meaningful surfaces.

| Construct | Promoted form |
| --- | --- |
| Surface a person would move or inspect | Authored root and owning component |
| Useful design setting: size, speed, label, colour | `@input` with current value and `@hint` |
| Value derived from a setting | Computed from the effective input at runtime |
| Widget, mesh geometry, or dynamic row | Runtime child of its owning surface |

Static placement belongs in the authored transform. Remove constants/helpers
used only for that placement; preserve intentional tracking or runtime placement
behavior. Do not silently correct unrelated layout defects during conversion.

Expose a small set of meaningful settings; retain calibration constants. Group
inputs per `../lens-api/references/conventions.md`.

Two separate rules prevent input desynchronization:

- Recompute dependent dimensions from the input after inputs are available;
  module constants derived from the old literal will not follow Inspector edits.
- Existing serialized input values override source initializers. Set initial
  values during authoring; later changes must update the stored values.

Use one component per surface. Add `Main` only when state crosses surfaces, and
a shared helper module only for genuinely shared helpers. Each component adopts
`this.getSceneObject()` as its surface instead of creating a duplicate root.
For cross-surface behavior, Main owns references and routes events; leaves expose
small methods/events and do not discover siblings by name. Preserve helpers'
behavior during this move.

## 3. Author and wire

Read `/specs-bootstrap-scene` and its `references/bootstrap-shape.md` for the
canonical Phase A → recompile → Phase B sequence, theme ordering, reference
wiring, and save procedure. Take UIKit API and theme values from `/specs-build-ui`
(`references/uikit-4.0.md`); do not duplicate bootstrap mechanics here.

Write new component files and retain the original prototype script unchanged.
Create replacement roots **disabled**, using the recorded poses and appropriate
parent transforms, so they cannot run alongside the prototype while wiring.
Reuse existing shared setup such as ThemeManager; remove the prototype's direct
theme-setting call only from the new implementation.

After compilation, wire inputs and read them back. Script-component references
and array inputs need the reference-wiring path documented by bootstrap; an
`applied` count alone is not proof. Verify each binding targets the intended
component, not merely a non-null object.

## 4. Switch, verify, and recover

Once compile and reference checks pass, disable the original **root** and enable
the replacement roots. Disabling only its ScriptComponent does not necessarily
hide children it already created. Refresh the preview so the old runtime tree
is discarded. Confirm only the replacement implementation is active.

Tell the user: “Promotion is running in Lens Studio; checking preservation now.
Try the controls and send feedback.” Then:

1. Recompile cleanly and run with no new startup errors.

### Required ready-to-try checkpoint

As soon as compilation and startup pass, **send this as a standalone user-facing progress
message before the next tool call**. Send it before captures, visual comparisons, interaction retests, or
save/reopen checks; users should know immediately when they can try the build.

> **🟢 Promoted version is running — you can try it now in Lens Studio.**
> **🟡 I’m checking visuals and behavior preservation. Say “stop testing” if you’re satisfied.**

- **A** — Keep this version and stop testing.
- **B** — Request a change.
- **C** — Continue checking.

Continue without waiting. If the user stops testing, stop verification work,
save, retain the disabled original for recovery, and report unchecked behavior.
Do not remove recovery material or mark preservation verified on that basis.

### Continue preservation checks

1. Compare intended poses/sizes, hierarchy ownership, and input bindings against
   the saved baseline. Inspect a Preview capture; investigate unexplained changes.
2. Repeat previously verified interactions where tooling supports them. Mark
   remaining behavior unverified and give the user the retest checklist.
3. Save, then verify the authored state survives reopening the saved project
   through the supported editor workflow before claiming persistence is checked.

Keep the disabled original and its source as recovery material while behavior
remains unverified. After preservation checks pass, remove only the obsolete
prototype component and now-unused source; remove its root only if it has no
unrelated content. Save the final state.

On failure, disable/delete only roots created by this conversion and remove its
new scripts from `Assets/` so a compile error in them cannot keep breaking the
restored prototype. Restore any shared settings changed during promotion, restore
the original root's enabled state, recompile, refresh, and save. Report any failed
recovery step explicitly. Never delete pre-existing shared roots or user files.

## 5. Report

Lead with interactions still needing a retest. Then list authored roots, useful
Inspector settings, preservation results, and any recovery material retained or
obsolete code removed. State whether the project was saved and reopened. Geometry
alone never establishes that callbacks survived the split. Offer 2–3 relevant
lettered next actions; reserve numbered lists for the retest checklist. Accept a
letter or plain language and keep letters consistent with the choices above.
