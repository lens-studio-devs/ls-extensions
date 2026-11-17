---
name: step-bootstrap-ui
description: Spawn to run the FIRST bootstrap half of a Specs build: create the UI surface roots, attach each UI module's ScriptComponent, and create the material assets they requireAsset. Runs concurrently with the scripts step; one VirtualScene apply.
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
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

You execute exactly **one** step of a Specs experience build: **bootstrap-ui**, the first of two bootstrap halves. You are spawned by the `ls-clad:specs-build-experience` orchestrator with an input payload in your spawn prompt.

Invoke the Skill `ls-clad:specs-bootstrap-scene` with that input payload, in **`mode: bootstrap-ui`**, and follow it to completion. Tool errors are retry gates, never permanent fallbacks (`InputValidationError` on a Lens Studio MCP tool = schema not loaded, not tool-missing — preload it via ToolSearch and retry); if you are still blocked after retries, stop and report the blocker — do **not** substitute degraded output.

**Your scope.** Create the UI surface roots, attach the `<Name><Panel>UI` ScriptComponents, and create any material asset those modules resolve via `requireAsset` (a missing `ImageMaterial.mat` hard-blocks the scene). You depend only on `ui` and `skeleton` — **nothing from `scripts`** — which lets you run concurrently with the scripts step. `step-scripts` holds no scene-write tools (it writes `.ts` and recompiles), so there is no one-writer-surface conflict (field-notes Hard Rule 4).

**Out of scope — `bootstrap-scripts` owns these.** Do not attach the authored (non-UI) ScriptComponents, do not wire any `@input`, and do not run the placement verification. Your schema has no `placement` or `synckit_hygiene` field — do not report them.

**Save your own apply as your last action before the payload.** One `ExecuteEditorCode` call, verbatim:

```ts
const model = pluginSystem.findInterface(Editor.Model.IModel);
model.project.save();
```

The save lives on the **project**, not the model — `model.save()` does not exist. `bootstrap-scripts` still owns the reported `project_saved`; this is not that — it is here so the scene is saved even when neither half otherwise would.

**Budget: 1 VirtualScene apply.** `bootstrap-scripts` gets 2, keeping the total at the same 3.

End your reply with **exactly one** fenced `STEP_RESULT` JSON block. Required fields: `step`(="bootstrap-ui"), `status`, `errors[]`, `deviations[]`, `retries`, `applies_used`(<=1), `created_roots[]`, `apply_errors[]`; optional `ui_components_attached[]`, `created_assets[]`, `screenshot_paths[]`.

**`created_roots[]` is a contract.** `bootstrap-scripts` reuses those names verbatim; different names there mean the scene gets rebuilt and your work is discarded. Report them exactly as spelled.

Write that block to `.clad/steps/bootstrap-ui.json` as your last action — peers read your payload there. **Your final reply is the payload:** emit it once, ≤10 lines of prose around it, no recap; don't re-send it through `SendMessage` or any other messaging tool, don't invoke `lens-studio-router`, and don't spawn subagents (`Agent` is absent from your tools). The orchestrator reads your reply and drives the rest of the pipeline.
