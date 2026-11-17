// @eec
const errorMessage = (error: unknown): string => {
  const caught = error as { message?: unknown };
  return typeof caught?.message === "string" ? caught.message : String(error);
};
const errorStack = (error: unknown): string => {
  const caught = error as { stack?: unknown };
  return typeof caught?.stack === "string" ? caught.stack : "";
};
const input = args as any;
if (typeof input.stateKey !== "string" || input.stateKey.trim().length === 0) {
  return { ok: false, reason: "invalid_args", error: "stateKey must be a non-empty string" };
}

try {
  const state = (globalThis as any)[input.stateKey.trim()];
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
} catch (error) {
  return { ok: false, error: errorMessage(error), stack: errorStack(error) };
}
