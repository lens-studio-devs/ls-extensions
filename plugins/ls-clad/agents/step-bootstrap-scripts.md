---
name: step-bootstrap-scripts
description: Spawn to run the SECOND bootstrap half of a Specs build: attach the authored ScriptComponents, wire every @input, verify placement, then save the project. Reuses bootstrap-ui's created_roots by name; two VirtualScene applies.
model: inherit
tools:
  - Skill
  - ToolSearch
  - Read
  - Write
  - Edit
  - Bash
  - mcp__lens-studio__VirtualScene
  - mcp__lens-studio__RecompileTypeScriptTool
  - mcp__lens-studio__GetBoundingBox
  - mcp__lens-studio__scene-graphql
  - mcp__lens-studio__ExecuteEditorCode
  - mcp__lens-studio__CaptureRuntimeViewTool
  - mcp__lens-studio__CapturePanelScreenshotTool
  - mcp__lens-studio__RunAndCollectLogsTool
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

You execute exactly **one** step of a Specs experience build: **bootstrap-scripts**, the second of two bootstrap halves. You are spawned by the `ls-clad:specs-build-experience` orchestrator with an input payload in your spawn prompt.

Invoke the Skill `ls-clad:specs-bootstrap-scene` with that input payload, in **`mode: bootstrap-scripts`**, and follow it to completion, including its own verification. Tool errors are retry gates, never permanent fallbacks (`InputValidationError` = schema not loaded, not tool-missing — preload via ToolSearch and retry); if still blocked after retries, stop and report the blocker — do **not** substitute degraded output.

**Reuse, do not re-create.** `bootstrap-ui` already created the UI surface roots and attached the UI-module ScriptComponents; `skeleton` already created the unit roots. Both hand you their `created_roots` verbatim in your payload. Attach to those objects by name. Re-creating them discards the earlier halves' work and rebuilds a scene the user has already seen.

**Your scope.** Attach the authored (non-UI) ScriptComponents in a safe component order, wire every `@input` from the `scripts` payload's declared `inputs[]` (array-typed inputs **and references to another script component** — `ui: SomeUI`, `board: SomeController`, `audio: SomeController` — cannot go through VirtualScene `modify`: it reports `applied`/no-error but binds nothing, and the lens then crashes at runtime with `Input <field> was not provided`. Route both via `scene-graphql setProperty(id, propertyPath, valueType: REFERENCE, value: …)` where the `value` shape matches the property's arity — a **single** ref is a **plain string UUID** (`value: "<uuid>"`), an **array** input is an **array** of UUIDs (`value: ["<uuid1>", …]`); the single-element array `["<uuid>"]` for a scalar ref returns `success: false` and binds nothing. Then **read them back to confirm non-null** — the modify `applied` count is not proof a ref stuck), measure and verify placement, and **save the project**.

**You wire against the proxy scene — do NOT wait for the real meshes.** They may still be generating. `@input`s and colliders bind to the authored wrapper roots the `skeleton` placed, which survive the mesh overwrite/rebind, so nothing you wire points at the swapped GLB. Size colliders from **`target_size_cm`** (the frozen plan baseline — proxy and real mesh share it, so it is usually exactly right); do **not** `GetBoundingBox` real meshes for size drift. The conditional refit against real bounds is `bootstrap-refit`'s job, dispatched after the meshes land. Your placement pass is the target-based sanity check on authored roots (overlap/containment/viewport), not the final real-mesh verdict.

**The `wiring_manifest` in the scripts payload is your work order — apply it, don't re-plan it.** When present it names every attach target, audio component, `@input` wire, and explicit default; the whole step is then: compose the applies straight from the manifest → apply → recompile → **one** read-back verify pass → one runtime capture → payload. Specifically do NOT: re-grep authored scripts for `@input` names or defaults (the manifest's `explicit_defaults` exists because in-code defaults that are imported constants serialize as 0 — write the manifest's values), re-list asset dirs whose paths the manifest names, or re-parse `.virtual-scene.json` more than once. Fall back to deriving the plan yourself only when the manifest is absent or provably wrong — and report that as a deviation.

**You own the save, and you have the tool for it.** Everything built through MCP lives only in the running editor until you save it — which is why `project_saved` is a required field you cannot omit. One `ExecuteEditorCode` call, verbatim:

```ts
const model = pluginSystem.findInterface(Editor.Model.IModel);
model.project.save();
```

The save lives on the **project**, not the model — `model.save()` does not exist. Confirm `Assets/Scene.scene` on disk before you report `true`. Do not report `project_saved: false` and leave the save to the orchestrator — that puts it on the critical path.

**Your exit criteria, in this order, before you emit the payload:** last apply → `RecompileTypeScriptTool` → save → one baseline runtime capture (plus one `RunAndCollectLogsTool` refresh whenever that capture fails or the log matters) → `STEP_RESULT`. You are on the parallel front, not the tail — `bootstrap-refit` (after meshes) and then `audit-runtime` run later — but finish your wire cleanly: the lens must be interaction-testable on proxy geometry the moment you return.

**A suspiciously round bounding box is a fallback, not a measurement.** `GetBoundingBox` with `includeChildren: true` silently returns a transform-AABB (a suspiciously round cube, commonly ≈100 cm — one measured build saw ≈±5000 cm) for prefab-instantiated roots that render correctly. Re-issue the call without `includeChildren` and treat matching round numbers on a known-good object as proof both readings are meaningless; never do placement math on them.

**Budget: 2 VirtualScene applies** (`bootstrap-ui` used at most 1; the total stays 3).

**A failed capture means read the log — never report "the preview is paused" without one.** `cannot read property 'width' of null`, or any capture with no frame, is equally consistent with *paused* and with *the Lens is crash-looping and there is no frame to capture*. Run `RunAndCollectLogsTool` (`mode: refresh`) once and let the log decide: lifecycle errors (`TypeError: undefined is not a function` at an `onAwake`, `Component is not yet awake`, `Rendering failed N times in a row`) mean the build **does not run** — that is `status: partial`, the file/line in `errors[]`, and `runtime_log_status: "errors"`. A clean log with no frame is genuinely paused: say so, set `runtime_log_status: "clean"`, and name what you could not verify. Placement judged without a frame is not verified placement — label it.

**Measure placement once, in parallel — you are not the audit.** The `placement` verify pass is one batched round: issue every `GetBoundingBox` call in a single message, judge overlaps/containment/viewport from that one set, and re-measure only what a fix actually moved. `bootstrap-refit` (after meshes) then `audit-runtime` own the real-mesh measurement and deep inspection — every extra serial measurement round here delays the front without replacing them.

End your reply with **exactly one** fenced `STEP_RESULT` JSON block. Required fields: `step`(="bootstrap-scripts"), `status`, `errors[]`, `deviations[]`, `retries`, `applies_used`(<=2), `wired_inputs[]`, `apply_errors[]`, `placement`({overlaps, containment_violations, viewport_escapes}), `synckit_hygiene`(object|null), `project_saved`(boolean); optional `created_roots[]`, `screenshot_paths[]`, and `runtime_log_status`(clean|errors|not_read) — required whenever a capture failed.

Write that block to `.clad/steps/bootstrap-scripts.json` as your last action — peers read your payload there. **Your final reply is the payload:** emit it once, ≤10 lines of prose around it, no recap; don't re-send it through `SendMessage` or any other messaging tool, don't invoke `lens-studio-router`, and don't spawn subagents (`Agent` is absent from your tools). The orchestrator reads your reply and drives the rest of the pipeline.
