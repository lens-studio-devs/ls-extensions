try {
  const FileSystem = await import("LensStudio:FileSystem");
  return { ok: true, logPath: FileSystem.getLogFile().toString() };
} catch (error) {
  const caught = error as { message?: unknown; stack?: unknown };
  return {
    ok: false,
    error: typeof caught?.message === "string" ? caught.message : String(error),
    stack: typeof caught?.stack === "string" ? caught.stack : "",
  };
}
