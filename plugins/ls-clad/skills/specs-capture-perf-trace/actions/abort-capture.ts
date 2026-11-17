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
  const stateKey = input.stateKey.trim();
  const state = (globalThis as any)[stateKey];
  const finished: Array<{ index: number; ok: boolean; error?: string }> = [];
  if (state?.timer) {
    try { clearTimeout(state.timer); } catch (_) {}
  }
  if (state?.sessions) {
    for (let index = 0; index < state.sessions.length; index++) {
      try {
        state.sessions[index].finish();
        finished.push({ index, ok: true });
      } catch (error) {
        finished.push({ index, ok: false, error: errorMessage(error) });
      }
    }
  }
  (globalThis as any)[stateKey] = null;
  return { ok: true, cleaned: true, finished };
} catch (error) {
  return { ok: false, error: errorMessage(error), stack: errorStack(error) };
}
