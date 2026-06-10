---
name: specs-leaf-run-in-preview
user-invocable: true
description: >-
  Run LEAF scenarios directly in the Lens Studio Preview panel — opens the
  LeafPlugin panel, lists scenarios, and runs them via the Lens Studio MCP.
  The fastest iteration loop during development.
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Run LEAF in Preview

> **Prefer the `live-lens-tester`** for end-to-end LEAF workflows. The agent runs this skill after `specs-leaf-install-packages` and `specs-leaf-write-scenarios`. This skill can also be run standalone to re-run existing scenarios in preview.

## Prerequisites

- **The Lens Studio MCP** — required for every step (opening the panel, listing scenarios, executing scenarios). It exposes capabilities for executing code in the editor context and for driving the LEAF panel (open, list scenarios, run scenarios). If those capabilities are unavailable, stop and report — do not fall back to shell commands.
- **LeafPlugin installed** — install the LeafPlugin from Lens Studio's Asset Library → Plugin Manager if missing. If any LEAF-specific capabilities are missing from the Lens Studio MCP, the LeafPlugin is likely too old — ask the user to update it from the Lens Studio Asset Library and restart Lens Studio before continuing.
- **At least one registered LEAF scenario** — author with the `specs-leaf-write-scenarios` skill if none exist.

## Step 1: Verify the LeafPlugin is installed

Use the editor-code execution capability to check that the LeafPlugin (id `com.snap.leaf.LeafPlugin`) is registered in the running Lens Studio instance. The result should be a boolean indicating whether the plugin is present.

If the plugin is not installed, tell the user to install the LeafPlugin from the Lens Studio Asset Library and enable it under **Settings → Plugin Manager**, then restart Lens Studio. Do not proceed until it is installed.

## Step 2: Open the LEAF panel

The LEAF scenario-list and scenario-run capabilities require an open LEAF panel.

Invoke the LEAF panel-open capability with no arguments. A successful call returns `{opened: true, created: true|false}` and leaves the panel ready to accept scenario list / run requests.

If the call errors or the capability is unavailable, see the Prerequisites section above.

## Step 3: List registered scenarios

Invoke the LEAF scenario-list capability with no arguments. It returns an array of `{id, config}`. Each scenario has at least `__leaf__log_level` and `__leaf__timeout_secs` in its config; scenarios authored with custom parameters expose those too (e.g. `flight_path`, `rocket_speed`).

If this call returns `"LEAF panel is not open"`, Step 2 didn't fully wire up the panel — re-check that the panel-open call succeeded.

If the call succeeds but the list is empty, the lens-side scenario registration hasn't completed yet. Wait a moment and retry once. If it stays empty, invoke the panel-open capability again — it is idempotent and re-creates the panel.

## Step 4: Run scenarios

Invoke the LEAF scenario-run capability with the scenario id:

```
{scenarioId: "<id>"}
```

For configurable scenarios, pass overrides via a `parameters` object — keys must already exist in the scenario's default config (unknown keys are rejected):

```
{
  scenarioId: "configurable_rocket_scenario",
  parameters: {flight_path: "B", rocket_speed: "1.2"}
}
```

The capability returns `{scenarioId, status}` where `status` is `"succeeded"` or `"failed"`. Default timeout is the scenario's `__leaf__timeout_secs` (typically 600s). Override it per call with `parameters: {__leaf__timeout_secs: "120"}`.

To run multiple scenarios, issue scenario-run calls **serially** — wait for each call to return before starting the next. Do NOT batch them in a single message. Each scenario-run call resets the Lens scene before the run begins; if a second call is dispatched while a prior scenario is still executing, the prior scenario is aborted mid-run, the Lens never emits a pass / fail line for it, and the original scenario-run call eventually times out with a generic "operation timed out" error.

## Step 5: Investigate a failure or an unexplained MCP-call timeout

Run this step whenever a scenario-run call did NOT return a clean "succeeded" status. That covers an explicit failure (returned "failed" status) and an MCP-call timeout (no status returned; do NOT assume silent success).

The scenario-run capability does not include an error message on a failure, and an MCP-call timeout returns no status at all. Bumping the log level to DEBUG adds detail to the Lens Studio log but does not change the return value. To see what actually happened, you must read the Lens Studio log directly. Only the lens-side scenario manager's pass / fail lines are authoritative — UI-side success logs from the LeafPlugin can lag, mis-match, or fire for scenarios that were actually aborted, so never cite them as evidence of a pass when the scenario-run call itself timed out. Procedure:

1. **Set a log baseline.** Invoke the log-baseline / preview-reset capability with no arguments. It returns `{logFile, byteOffset}`. Hold onto both values — `logFile` is the absolute path to the active Lens Studio log file, and `byteOffset` marks the end of the log at this moment, so anything read from this offset onward will be output produced by the next scenario run.
2. **Re-run the failing scenario with `__leaf__log_level: "DEBUG"`** to maximize the detail emitted into the log.
3. **Read the log slice starting at the baseline offset** and search it (case-insensitive) for entries mentioning the scenario id, the words FAILED / PASSED / RUNS, and reset-related keywords. The lens-side scenario manager is the source of truth; its pass / fail entries describe the actual outcome, while the LeafPlugin UI logger emits informational success / failure lines that can lag or fire incorrectly when a scenario is aborted. Look for one of three patterns:
   - **Explicit failure:** a scenario-manager FAILED entry for the id, followed by a matching "completed with failure" entry from the message handler. The error reason on the FAILED line is the verbatim cause.
   - **Aborted by scene reset:** a scenario-manager RUNS entry for the id, followed by context-reset / lens-reset entries and a fresh batch of scenario re-registrations — and no matching PASSED or FAILED entry for that id. That's the parallel-dispatch pitfall from Step 4; the scenario didn't fail on its own merits, it was killed mid-run.
   - **Genuine hang:** a scenario-manager RUNS entry for the id with no subsequent PASSED or FAILED entry and no scene reset in between. The scenario is stuck on an await — usually an interactor or a sleep that never resolves.
4. **Locate the scenario source** by searching `Assets/` for TypeScript/JavaScript files containing either `<scenario_id>` or the scenario's PascalCase class name, so you can map the failure to the offending line. The class is usually `@component` and extends `Scenario`; its `run()` body executes the steps in order, so the first action whose assertion or interactor matches the error is almost always the cause.
5. **Report the verbatim error message** and the suspected line in the scenario. Do NOT auto-retry — flaky-looking failures often reproduce, and silent retries waste iteration time.

If the log slice contains no scenario-manager RUNS entry for the id at all, the failure happened before the scenario started (registration, panel binding, or a runtime exception during construction). In that case widen the search to include the names of the scenario-manager and plugin classes along with common runtime-error keywords.

## Completion

Report results using this template:

```
## LEAF preview run

**LeafPlugin:** already installed | installed during this run
**Scenarios discovered:** <n>

| Scenario | Outcome | Detail |
| --- | --- | --- |
| <id> | ✅ succeeded | — |
| <id> | ❌ failed | <verbatim scenario-manager FAILED line> |
| <id> | ⚠️ did not complete | aborted by scene reset \| hung (see Step 5) — <verbatim scenario-manager line, if any> |
```

Notes when filling it in:
- Quote the verbatim scenario-manager line for any failure or non-completion so the user can match it to their scenario source (cite scenario-manager lines only; do not retry automatically).

If a scenario fails or does not complete, do not retry automatically. Run Step 5 to extract the underlying state from the Lens Studio log, surface the verbatim scenario-manager line and the suspected scenario line, then ask the user how they want to proceed — most LEAF failures point to a bug in either the scenario or the Lens code, and silent retries waste iteration time.
