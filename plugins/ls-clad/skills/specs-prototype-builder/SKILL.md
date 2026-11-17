---
name: specs-prototype-builder
description: >-
  Build a quick, single-script Specs prototype with UIKit controls and direct
  manipulation. Use for an interactive sketch; use the full build for generated
  models, physics, multiplayer, AI/voice, or shipping work.
user-invocable: true
argument-hint: a short description of the prototype
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Specs Prototype Builder

Build the user's primary interaction in one TypeScript component with zero
`@input` wiring. Adapt [demo.ts](references/prototype/demo.ts); keep only the
surfaces the idea needs. The example demonstrates a draggable panel, controls,
a scrolling list, and a grabbable mesh. It is an example, not a library or an
API contract for every package version.

## 1. Initialize and author

Resolve the intended `.esproj` to an absolute, symlink-resolved `projectPath`.
Reuse the router's `init_task` or `init_result` when supplied. Otherwise start
`ls-clad:step-init` with that path in the background; direct invocation owns its
one init. Use the runtime's supported delegation mechanism; if unavailable,
read `../../agents/step-init.md` and run it inline (no initialization overlap).
Cross-runtime details belong to `/lens-studio-field-notes`.

Before reading the example, choose the primary interaction, surfaces, and spatial
layout from the user's request. Briefly share the plan, then proceed without
waiting for approval; use `demo.ts` for implementation patterns.

While delegated init runs, plan and draft the main script as above. Await
**that invocation's result** before any editor writes, package-dependent
compilation, or preview runs; init is the sole editor writer until then. Require
`step: "init"`, `status: "ok"`, matching `project_path`, `project_ready: true`,
both `sik_installed` and `uikit_installed`, and empty `errors[]` / `blockers[]`.
Do not use an existing `.clad/steps/init.json` as a completion signal. On failure
or an uncollectable task, report the blocker; do not launch a duplicate init.

Adapt package APIs from the skill that owns each package (UIKit: `/specs-build-ui`;
Sync Kit: `/specs-sync-kit`; renamed 4.0 packages: `/specs-package-renames`) and
confirm each symbol in the installed declarations under
`Cache/TypeScript/Src/Packages/`. The example's package-specific comments must
match the installed version.

Name the primary interaction before writing `Assets/Scripts/<Name>.ts`:
notes need text entry, for example, not just a prefilled list. Read only the
capability guidance needed for that interaction (`/specs-keyboard`,
`/specs-interaction-recipes`, or `/specs-build-ui` are common starting points).
Use the installed skill catalog for other capabilities. A required capability
excluded above goes through `/lens-studio-router`.

Keep the example's derived layout dimensions and lifecycle ordering where
applicable. Delete unused surfaces, imports, and asset requirements. Do not
invent package imports or rewrite missing imports while init is still installing
packages. A module copied before init completes may temporarily fail compilation.

## 2. Create required assets

Only create a prop material if the script uses a vertex-coloured mesh. Through
`asset-graphql`, create an `UberPBRMaterialPreset` or `UberUnlitMaterialPreset`
under `Materials`, then set its `passInfos.0.Vertex Color` to `Base Color`
(`valueType: STRING`). Read back the result: without the define the mesh renders
white. `SimplePBRMaterialPreset` does not expose this define.

Match the material path in `requireAsset` to the created asset. Use `/materials`
for other material requirements.

## 3. Attach

Let Lens Studio import the file, then use the available editor tools to attach
its exact script asset to a prototype root in the intended project. Preserve
unrelated content and reuse an existing attachment rather than duplicating it.
If import has not settled, wait briefly and check again; use `/editor-api` or
`/scene-construction` for API details and troubleshooting.

## 4. Compile, run, and save

1. `RecompileTypeScriptTool` must succeed. Fix compile errors before running;
   log collection may otherwise execute an old bundle.
2. Call `RunAndCollectLogsTool` with `mode: "refresh"` and inspect startup
   errors and the log tail. Fix startup exceptions; warnings alone are not
   failures. Registered interactables do not prove callback delivery.
   Then refresh the user's visible Preview panel so the handoff matches what
   they see (`preview-inspection` → Preview routing → "Show the user the result").
3. Save with `project.save()` through `ExecuteEditorCode`. Retry after pending
   asset operations settle if saving is temporarily blocked.

Then end the turn with the handoff below. **Do not automatically take screenshots,
inspect layout, test interactions, or launch a verification agent.** Those are
an optional next action, not prerequisites for handing the prototype to the user.
Do not claim it is on glasses unless it has actually been deployed there.

If an edit produces no observable change, confirm the open project and registered
asset before revising the fix. `/lens-debug` handles unresolved runtime failures.

## 5. Hand off and wait

After compilation, startup, and save, briefly describe what was built and where
to try it. Use natural wording, not a fixed status banner. Mention relevant
limitations and distinguish compile/startup checks from untested visuals and
interactions; do not imply the prototype is fully verified. Report any failure
directly.

Offer these lettered choices, one per line, with verification first and promotion
last. **Choose the recommendation from the user's goal and the current result**;
no option is recommended by default. Mark exactly one **(Recommended)** and give
a short reason. Prefer fixing a known issue over adding unrelated functionality.

- **A — Have AI verify the prototype.** Inspect visuals and try the primary
  interaction in Preview.
- **B — Change something.** Invite the user's feedback.
- **C — [A concrete Specs feature for this experience].** Choose from available
  CLAD skill descriptions, not just features demonstrated in `demo.ts`. Name what
  the user would do and why it improves this prototype; replace the placeholder.
  For example, a tabletop game could use `/specs-world-query` to place its board
  on a real table, or `/specs-sync-kit` for two players sharing it. Check the
  selected skill's scope before promising support; do not load the whole catalog.
- **D — Make it editable in the Inspector.** Keep promotion last. Use
  `/specs-prototype-promote` (or its agent) to preserve behavior while exposing
  authored surfaces and settings.

The feature suggestion must be specific to the experience, with the supporting
skill named briefly. It may be the recommended next action when it offers the
most useful improvement. Promotion is an alternative, not an automatic winner.

Say **“Reply with a letter, or say ‘go’ for the recommended next step. You can
also keep this version as-is.”** End the turn and wait; silence is not acceptance.
Accept “go,” “yes,” or “continue” as the recommendation only when no competing
question makes the reply ambiguous. Keep letter meanings stable for this build.
Reassess the recommendation after each chosen action; do not recommend checks
already completed. Implement enhancements only when chosen, using the relevant
skill or full-build route when their requirements exceed this workflow.

## 6. Verify only when chosen

If the user chooses A or otherwise explicitly asks for verification:

1. Capture Preview and inspect missing content, overlap, and clipping. Content
   can extend beyond one view; do not shrink it just to fit a screenshot. Use
   `/preview-inspection` for diagnosis.
2. Exercise the primary interaction via `/specs-preview-interaction` when the
   installed tooling supports it. If acquisition is unavailable or inconclusive,
   name the limitation and give the user the remaining test. Do not rewrite
   working controls solely because synthetic input failed.
3. Report what passed and what remains unverified. If fixes were needed,
   recompile, rerun the affected checks, and save before reporting their result.

If the user stops testing, stop verification, save any changes, and report
unchecked behavior without marking it passed. Numbers are for test steps;
letters are for next actions.
