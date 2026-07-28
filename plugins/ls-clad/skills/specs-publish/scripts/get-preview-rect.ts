// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// publish · GET PREVIEW RECT — resolve the Preview panel's global
// screen rectangle (macOS points) for OS-level screen recording.
//
// Zero-config: pass this file's path to ExecuteEditorCode as `path`. Do NOT read it.
// Returns one JSON object with a `status`:
//   RECT_READY  → { rect: {x, y, width, height}, panelId, previewCount }
//   FAILED      → { reason, message }

try {
  const Ui: any = await import("LensStudio:Ui");
  const gui: any = (pluginSystem as any).findInterface(Ui.IGui);
  const workspaces = gui.workspaces.all;
  if (!workspaces || workspaces.length === 0) {
    return { status: "FAILED", reason: "no_workspace", message: "No active workspace available" };
  }

  const workspace = workspaces[workspaces.length - 1];
  const previews = workspace.dockManager.panels.filter((panel: any) =>
    String(panel.id).includes("Snap.Plugin.Gui.PreviewPanel")
  );
  if (previews.length === 0) {
    return { status: "FAILED", reason: "no_preview_panel", message: "No Preview panel found in the active workspace" };
  }

  const widget = previews[0].widget;
  const globalOrigin = widget.mapToGlobal(0, 0);
  return {
    status: "RECT_READY",
    rect: { x: globalOrigin.x, y: globalOrigin.y, width: widget.width, height: widget.height },
    panelId: String(previews[0].id),
    previewCount: previews.length,
  };
} catch (e: any) {
  return { status: "FAILED", reason: "rect_query_failed", message: e?.message ?? String(e) };
}
