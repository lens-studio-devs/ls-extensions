---
name: specs-capture-perf-trace
description: Path-backed ExecuteEditorCode actions for simultaneous Lens Studio Preview performance traces. Use when recording .pftrace files via preview.profiling.startTrace.
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Capture Performance Trace

Capture one `.pftrace` per selected Lens Studio Preview panel. The actions retain the scheduled-capture lifecycle: start every session back-to-back, schedule `finish()` with `setTimeout`, retain state on `globalThis`, and return immediately. Never await a timer, busy-wait, generate a helper script, or load a generated module in `ExecuteEditorCode`.

## Requirements

- Lens Studio MCP is connected and at least one Preview panel is open.
- Only visible Preview panels are traced, never a hidden "Headless Preview"; pass a traced panel's exact title as `previewName` to any refresh or screenshot in the same flow.
- The destination directory already exists.

## Workflow

1. Call `ListAllPanels` through Lens Studio MCP to verify connectivity and count Preview panels.
2. Create the output directory from shell, for example `mkdir -p performance_traces`, and use its absolute path.
3. Call `ExecuteEditorCode` with the absolute `path` to `actions/start-scheduled-capture.ts` and JSON `args` such as:

   ```json
   {
     "outputDir": "/absolute/path/to/project/performance_traces",
     "durationMs": 10000,
     "stateKey": "__previewTraceCapture",
     "previewCount": 2,
     "filenamePrefix": "preview_trace"
   }
   ```

   `previewCount` is optional and defaults to `2`; use `null` to select every Preview panel. `filenamePrefix` is optional and defaults to `preview_trace`. The body validates all values before it starts a capture and finishes any prior state under the same `stateKey`, exactly as the prior inline action did.
4. Wait slightly longer than `durationMs`, then verify the artifacts from shell:

   ```bash
   sleep 12
   ls -lh performance_traces/*.pftrace
   wc -c performance_traces/*.pftrace
   ```

5. To inspect stored timing and per-panel finish results, invoke `actions/capture-status.ts` with `args: { "stateKey": "__previewTraceCapture" }`.
6. To cancel a pending timer and finish all stored sessions immediately, invoke `actions/abort-capture.ts` with the same `stateKey`.

Pass each action by `path`; do not read or paste its source as inline `code`. Keep the same `stateKey` across start, status, and abort. If reusing that key is not acceptable, run status first and decide whether to abort or choose a different key.

Treat 0-byte `.pftrace` files as failed captures. Non-zero files are capture artifacts. If `perfetto-trace-analysis` is installed, use it after capture; this skill does not redesign trace analysis.
