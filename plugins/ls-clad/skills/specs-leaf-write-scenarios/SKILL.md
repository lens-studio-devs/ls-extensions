---
name: specs-leaf-write-scenarios
user-invocable: true
description: >-
  Write LEAF integration test scenarios for Lens Studio Lenses — analyze the
  project, author scenarios, register them, and attach to the scene. Use when
  asked to write tests, add tests, create test scenarios, or add LEAF scenarios.
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# LEAF Scenario Authoring

> **Prefer the `live-lens-tester` (Live Lens Tester)** for end-to-end LEAF workflows. The agent runs this skill in the correct order (install → author → run). This skill can also be run standalone for authoring-only tasks.

Use this skill when the user wants to **write LEAF tests** or **create test scenarios** for Lens Studio Lenses.

## Prerequisites

- **Lens Studio MCP server** — scene graph manipulation, package installation, compilation, file operations, and runtime inspection.
- The **Lens project root** is the directory containing the `.esproj` file.

## Phase 1 — Framework setup (always first)

1. Read the [LEAF Reference](references/leaf-reference.md) for API reference, assertion matchers, and common pitfalls.
2. Run the **`ls-clad:specs-leaf-install-packages`** skill to verify the LEAF package is present, install it if missing, and confirm SIK version compatibility.
3. Search the project for existing `LeafIndex` files (`scenariosIndex`) and scenario classes (`extends Scenario`).

## Phase 2 — Scene exploration (Lens Studio tools)

Build a **scene snapshot** before writing assertions. If Lens Studio MCP tools are unavailable, skip with a warning that `expect()` values must be verified manually.

1. **Query the scene** — inspect the scene hierarchy for objects, components, properties, and enabled state. Record the **exact** names of every scene object you plan to reference in tests.
2. **Search Lens scripts** — grep for `Interactable`, `Text`, `Image`, and other component references to understand interactions.
3. **Read Lens scripts** — understand interaction flows, state changes, and UI updates. Pay attention to initial state (starting coins, default visibility, etc.) and how state changes propagate.
4. **Compile and check logs** — look for runtime warnings or errors that reveal expected behavior.

Summarize as a table: `object_name | component | property | expected_value`.

**Every scene object name you use in Phase 3 must appear in this table.** If you cannot confirm an object exists via scene-graphql or by reading the Lens source, do not use it in a test — add a `// TODO: verify object name` comment instead.

## Phase 3 — Test authoring

Read the [LEAF Reference](references/leaf-reference.md) for templates, import paths, interactor selection, and the authoring checklist.

1. Write scenario files directly using the templates from the LEAF Reference. Use **exact** names from Phase 2 for scene objects and interactables; fill `expect()` only with **observed** values — never guess.
2. Choose the correct interactor type per the LEAF Reference's "Choosing an interactor" section (`DefaultLeafInteractor`, `LeafHandInteractor`, or the IK interactor). **Always obtain hands via the shared accessors** `LeafHandInteractor.get("left")` / `LeafHandInteractor.get("right")` — including two-hand flows, where you drive both hands concurrently with `Promise.all`.
3. **Add IK coverage for reach-sensitive UI.** Add at least one scenario using `createIKInteractor()` for any reach-sensitive UI — it doubles as a reachability check; a `trigger` that fails to converge or routes far-field is a real finding, not a test bug (see the IK Interactor section of the LEAF Reference). For two-hand scale coverage, drive both hands concurrently via `LeafHandInteractor.get("left")` / `LeafHandInteractor.get("right")`.
4. Write or update `LeafIndex.ts` to import and register all scenarios with `@scenariosIndex`.

### Scenario rules

Key authoring guidelines:

- One scenario per focused interaction flow.
- Cover: the primary interaction loop, state changes visible in the HUD, and any error/guard paths.
- **Add IK reachability coverage** for any reach-sensitive UI — see Phase 3 step 3 for the full guidance.
- **Use relative/delta assertions** for any numeric or stateful value (coins, scores, counts). Read the value before the interaction, then assert the expected change — not an absolute final value. Scenarios share Lens state.
- **Never invent scene object names.** Every `findSceneObjectByName("X")` and `findInteractablesByName("X")` must use a name confirmed in Phase 2. If you write a name you didn't verify, you are guessing — and the test will fail.

## Phase 4 — Attach LeafIndex to the scene (MCP bootstrap)

Use scene graph and asset query tools:

1. Create a root SceneObject named "LeafIndex"
2. Find the LeafIndex.ts asset UUID
3. Add a ScriptComponent to the new object
4. Set `scriptAsset` to the asset UUID
5. Compile and verify a clean build

## Rules

- See Scenario rules above for the authoritative assertions, object-name, and delta-check constraints.
- Do **not** overwrite or downgrade the LEAF package or SIK unless the user explicitly asks.
- Do **not** modify the user's Lens code to make tests work. If a test can't find an object or interactable, fix the test's lookup strategy — don't rename objects in the Lens.

## References

- [LEAF Reference](references/leaf-reference.md) — import paths, templates, APIs, assertions, patterns, pitfalls
