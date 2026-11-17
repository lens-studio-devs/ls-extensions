function invalidArgs(error: string) {
  return { ok: false, reason: "invalid_args", error };
}

const errorMessage = (error: unknown): string => {
  const caught = error as { message?: unknown };
  return typeof caught?.message === "string" ? caught.message : String(error);
};
const errorStack = (error: unknown): string => {
  const caught = error as { stack?: unknown };
  return typeof caught?.stack === "string" ? caught.stack : "";
};
type TraceSession = { finish(): void };
type PreviewProfiling = {
  activeTraceSession: TraceSession | null;
  startTrace(path: Editor.Path): TraceSession | null;
};
type ProfilingPreviewPanel = IPanelPlugin & { profiling?: PreviewProfiling };

const sessions: TraceSession[] = [];
const input = args as any;
if (typeof input.outputDir !== "string" || input.outputDir.trim().length === 0) {
  return invalidArgs("outputDir must be a non-empty string");
}
if (!Number.isFinite(input.durationMs) || input.durationMs <= 0) {
  return invalidArgs("durationMs must be a positive finite number");
}
if (typeof input.stateKey !== "string" || input.stateKey.trim().length === 0) {
  return invalidArgs("stateKey must be a non-empty string");
}
if (
  input.previewCount !== undefined &&
  input.previewCount !== null &&
  (!Number.isInteger(input.previewCount) || input.previewCount <= 0)
) {
  return invalidArgs("previewCount must be null or a positive integer when provided");
}
if (
  input.filenamePrefix !== undefined &&
  (typeof input.filenamePrefix !== "string" || input.filenamePrefix.trim().length === 0)
) {
  return invalidArgs("filenamePrefix must be a non-empty string when provided");
}

try {
  const outputDir = input.outputDir.trim();
  const durationMs = input.durationMs;
  const stateKey = input.stateKey.trim();
  const previewCount = input.previewCount === undefined ? 2 : input.previewCount;
  const filenamePrefix = input.filenamePrefix?.trim() ?? "preview_trace";
  const Ui = await import("LensStudio:Ui");
  const gui = pluginSystem.findInterface(Ui.IGui);
  const workspaces = gui.workspaces.all;
  if (!workspaces || workspaces.length === 0) {
    throw Error("No active workspace available");
  }

  const workspace = workspaces[workspaces.length - 1];
  const previews = workspace.dockManager.panels.filter((panel) =>
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
    for (const session of previous.sessions) {
      try { session.finish(); } catch (_) {}
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const normalizedOutputDir = outputDir.replace(/[/\\]+$/, "");
  const outputPaths = selectedPreviews.map((_, index) =>
    `${normalizedOutputDir}/${filenamePrefix}_${stamp}_preview${index}.pftrace`
  );
  const started: Array<{
    index: number;
    path: string;
    activeAfterStart: boolean;
    startOffsetMs: number;
  }> = [];
  const startedAt = Date.now();

  for (let index = 0; index < selectedPreviews.length; index++) {
    const preview = selectedPreviews[index] as ProfilingPreviewPanel;
    const profiling = preview.profiling;
    if (!profiling || typeof profiling.startTrace !== "function") {
      throw Error(`Preview ${index} does not expose profiling.startTrace`);
    }
    if (profiling.activeTraceSession != null) {
      try { profiling.activeTraceSession.finish(); } catch (_) {}
    }

    const session = profiling.startTrace(new Editor.Path(outputPaths[index]));
    if (session == null) {
      throw Error(`Preview ${index} startTrace returned null`);
    }
    sessions.push(session);
    started.push({
      index,
      path: outputPaths[index],
      activeAfterStart: profiling.activeTraceSession != null,
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
    const finished: Array<{
      index: number;
      ok: boolean;
      finishOffsetMs?: number;
      error?: string;
    }> = [];
    for (let index = 0; index < sessions.length; index++) {
      try {
        sessions[index].finish();
        finished.push({ index, ok: true, finishOffsetMs: Date.now() - finishedAt });
      } catch (error) {
        finished.push({ index, ok: false, error: errorMessage(error) });
      }
    }
    state.finishedAt = finishedAt;
    state.finished = finished;
    state.recordedMs = finishedAt - startedAt;
    state.timer = null;
    state.sessions = [];
  }, durationMs);
  (globalThis as any)[stateKey] = state;

  return { ok: true, scheduled: true, durationMs, previewCount: selectedPreviews.length, startedAt, started, outputPaths };
} catch (error) {
  for (const session of sessions) { try { session.finish(); } catch (_) {} }
  return { ok: false, error: errorMessage(error), stack: errorStack(error) };
}
