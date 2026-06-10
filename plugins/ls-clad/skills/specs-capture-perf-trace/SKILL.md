---
name: specs-capture-perf-trace
description: Static ExecuteEditorCode snippets for simultaneous Lens Studio Preview performance traces. Use when recording .pftrace files via preview.profiling.startTrace without helper scripts.
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Capture Performance Trace

Use these static `ExecuteEditorCode` snippets to capture performance trace (`.pftrace`) files from one or more Lens Studio Preview panels at the same time.

Core API:

```ts
const session = preview.profiling.startTrace(new Editor.Path(tracePath));
session.finish();
const active = preview.profiling.activeTraceSession;
```

If the core `perfetto-trace-analysis` skill is installed, use it afterward to analyze the saved `.pftrace` files.

## Requirements

- Lens Studio MCP is connected.
- One or more Preview panels/windows are open.
- The editor code execution tool (`ExecuteEditorCode`) is available.
- The output directory exists before starting the capture.

## Workflow

1. Call the Lens Studio MCP `ListAllPanels` tool to verify connectivity and count Preview panels; do not run this from shell.
2. Create an output directory from shell and copy its absolute path:
   ```bash
   mkdir -p performance_traces
   pwd
   ```
3. Copy the **Start scheduled capture** snippet into `ExecuteEditorCode` and edit only the constants at the top.
4. Wait slightly longer than `durationMs`, then verify files from shell:
   ```bash
   sleep 12
   ls -lh performance_traces/*.pftrace
   wc -c performance_traces/*.pftrace
   ```
5. Optionally run the **Status** snippet to read stored timing and per-panel finish results.

Use the scheduled timer pattern: start all sessions back-to-back, call `setTimeout(() => finish(), durationMs)`, store state on `globalThis`, and return immediately. Do not await a timer, busy-wait, generate helper scripts, or load a generated module inside `ExecuteEditorCode`; those patterns can block trace capture or trigger extra filesystem permission prompts.

The start snippet finishes any prior session under `stateKey` before beginning the new capture. If that is not acceptable for the task, run **Status** first and decide whether to run **Cleanup / abort** or change `stateKey`. If you change `stateKey`, use the same value in Start, Status, and Cleanup.

## Start scheduled capture

Edit only the constants unless the task requires custom panel selection.

```ts
const sessions: any[] = [];
try {
  // ---- edit these constants ----
  const outputDir = "/absolute/path/to/project/performance_traces";
  const filenamePrefix = "preview_trace";
  const durationMs = 10000;
  const previewCount: number | null = 2; // set null to capture all Preview panels
  const stateKey = "__previewTraceCapture";
  // ------------------------------

  const Ui: any = await import("LensStudio:Ui");
  const gui: any = (pluginSystem as any).findInterface(Ui.IGui);
  const workspaces = gui.workspaces.all;
  if (!workspaces || workspaces.length === 0) {
    throw Error("No active workspace available");
  }

  const workspace = workspaces[workspaces.length - 1];
  const previews = workspace.dockManager.panels.filter((panel: any) =>
    String(panel.id).includes("Snap.Plugin.Gui.PreviewPanel")
  );
  const selectedPreviews = previewCount == null ? previews : previews.slice(0, previewCount);
  if (selectedPreviews.length === 0) {
    throw Error("No Preview panels found");
  }
  if (previewCount != null && selectedPreviews.length < previewCount) {
    throw Error(`Expected ${previewCount} Preview panels, found ${selectedPreviews.length}`);
  }

  const previous = (globalThis as any)[stateKey];
  if (previous?.timer) {
    try { clearTimeout(previous.timer); } catch (_) {}
  }
  if (previous?.sessions) {
    for (const s of previous.sessions) {
      try { s.finish(); } catch (_) {}
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const normalizedOutputDir = outputDir.replace(/[/\\]+$/, "");
  const outputPaths = selectedPreviews.map((_: any, i: number) =>
    `${normalizedOutputDir}/${filenamePrefix}_${stamp}_preview${i}.pftrace`
  );

  const started: any[] = [];
  const startedAt = Date.now();

  for (let i = 0; i < selectedPreviews.length; i++) {
    const preview = selectedPreviews[i];
    if (!preview.profiling || typeof preview.profiling.startTrace !== "function") {
      throw Error(`Preview ${i} does not expose profiling.startTrace`);
    }
    if (preview.profiling.activeTraceSession != null) {
      try { preview.profiling.activeTraceSession.finish(); } catch (_) {}
    }

    const session = preview.profiling.startTrace(new Editor.Path(outputPaths[i]));
    if (session == null) {
      throw Error(`Preview ${i} startTrace returned null`);
    }

    sessions.push(session);
    started.push({
      index: i,
      path: outputPaths[i],
      activeAfterStart: preview.profiling.activeTraceSession != null,
      startOffsetMs: Date.now() - startedAt,
    });
  }

  const state: any = {
    sessions,
    outputPaths,
    startedAt,
    started,
    durationMs,
    finishedAt: null,
    recordedMs: null,
    finished: null,
  };

  state.timer = setTimeout(() => {
    const finishedAt = Date.now();
    const finished: any[] = [];
    for (let i = 0; i < sessions.length; i++) {
      try {
        sessions[i].finish();
        finished.push({ index: i, ok: true, finishOffsetMs: Date.now() - finishedAt });
      } catch (e: any) {
        finished.push({ index: i, ok: false, error: e?.message ?? String(e) });
      }
    }
    state.finishedAt = finishedAt;
    state.finished = finished;
    state.recordedMs = finishedAt - startedAt;
    state.timer = null;
    state.sessions = [];
  }, durationMs);

  (globalThis as any)[stateKey] = state;

  return {
    ok: true,
    scheduled: true,
    durationMs,
    previewCount: selectedPreviews.length,
    startedAt,
    started,
    outputPaths,
  };
} catch (e: any) {
  for (const s of sessions) { try { s.finish(); } catch (_) {} }
  return { ok: false, error: e?.message ?? String(e), stack: e?.stack ?? "" };
}
```

## Status

Run after waiting for the timer and preview worker save.

```ts
try {
  const stateKey = "__previewTraceCapture";
  const state = (globalThis as any)[stateKey];
  if (!state) {
    return { ok: false, error: "No Preview trace capture state found" };
  }
  return {
    ok: true,
    durationMs: state.durationMs,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    recordedMs: state.recordedMs,
    started: state.started,
    finished: state.finished,
    outputPaths: state.outputPaths,
  };
} catch (e: any) {
  return { ok: false, error: e?.message ?? String(e), stack: e?.stack ?? "" };
}
```

## Cleanup / abort

Run to cancel a scheduled finish and finish any stored sessions immediately.

```ts
try {
  const stateKey = "__previewTraceCapture";
  const state = (globalThis as any)[stateKey];
  const finished: any[] = [];
  if (state?.timer) {
    try { clearTimeout(state.timer); } catch (_) {}
  }
  if (state?.sessions) {
    for (let i = 0; i < state.sessions.length; i++) {
      try {
        state.sessions[i].finish();
        finished.push({ index: i, ok: true });
      } catch (e: any) {
        finished.push({ index: i, ok: false, error: e?.message ?? String(e) });
      }
    }
  }
  (globalThis as any)[stateKey] = null;
  return { ok: true, cleaned: true, finished };
} catch (e: any) {
  return { ok: false, error: e?.message ?? String(e), stack: e?.stack ?? "" };
}
```

## Common edits

- Capture N Preview panels: set `previewCount = N`; set `null` to capture all.
- Change duration: edit `durationMs`.
- Use a different output folder or prefix: edit `outputDir` and `filenamePrefix`.

Treat 0-byte `.pftrace` files as failed captures. Non-zero files are the capture artifacts.
