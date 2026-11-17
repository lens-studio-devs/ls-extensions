// Records the Preview's current state with recordVideo and saves it as an MP4.
// Run through ExecuteEditorCode as {path, args}: args = { outPath: "<abs .mp4>", ms: <duration>, previewTitle?: "<exact panel title>" }.
//
// Deliberately NO preview.refresh(): refresh resets a placement-gated lens to its entry state, and the
// capture runner calls this after driving the lens to its payoff. Without refresh the clip can come
// back static; the runner treats that as a failure and falls back to frame bursts until recordVideo can
// record motion without a reset. The runner never calls this on Linux, where it takes the MCP server down.
const input = args as any;
if (typeof input.outPath !== "string" || !input.outPath.endsWith(".mp4")) {
  return { ok: false, reason: "invalid_args", error: "outPath must be an absolute path ending in .mp4" };
}
if (!Number.isInteger(input.ms) || input.ms < 250 || input.ms > 30000) {
  return { ok: false, reason: "invalid_args", error: "ms must be an integer from 250 through 30000" };
}
if (input.previewTitle !== undefined && (typeof input.previewTitle !== "string" || input.previewTitle.length === 0)) {
  return { ok: false, reason: "invalid_args", error: "previewTitle must be a non-empty string when provided" };
}

try {
  const FileSystem = await import("LensStudio:FileSystem");
  const dock = pluginSystem.findInterface(Editor.Dock.IDockManager);
  const panels = (dock.panels as any[]).filter(
    (p: any) => p.id === "Snap.Plugin.Gui.PreviewPanel" && (input.previewTitle === undefined || p.title === input.previewTitle),
  );
  if (panels.length === 0) return { ok: false, reason: "no_preview_panel" };
  const preview: any = panels[0];
  if (typeof preview.recordVideo !== "function") return { ok: false, reason: "record_video_api_unavailable" };
  const outPath = new Editor.Path(input.outPath);
  const t0 = Date.now();
  const video = await preview.recordVideo(input.ms);
  const t1 = Date.now();
  if (!video || typeof video.save !== "function") return { ok: false, reason: "no_save_handle" };
  video.save(outPath);
  const exists = FileSystem.exists(outPath) && FileSystem.isFile(outPath);
  return { ok: exists, path: outPath.toString(), bytes: exists ? FileSystem.size(outPath) : 0, recordMs: t1 - t0 };
} catch (error) {
  const caught = error as { message?: unknown };
  return { ok: false, reason: "record_video_failed", error: typeof caught?.message === "string" ? caught.message : String(error) };
}
