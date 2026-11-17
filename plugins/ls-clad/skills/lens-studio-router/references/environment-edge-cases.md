<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Environment edge cases — /lens-studio-router Gate

On-demand detail for the router's Gate phase. Read this only when the initial Gate probe (`ExecuteEditorCode` running `references/gate-diagnose.ts`) fails or a user-approved switch needs an MCP wait. The successful-probe branch gets path/version from `LensStudio:App`.

## Find the Lens Studio executable

This section owns how every skill finds the Lens Studio executable for a project. Lens
Studio 5.25 and later writes `ls-live-instance.json` beside the project's `.mcp.json` each time it
opens the project. Read its `executablePath` and record it as `lens_studio_path`; that is the only
source. Do not search the disk, read app bundles or the registry, or ask the user to pick an install.
A skill that has to run before the project has a record, such as `specs-27-migration` on a project
never opened in 5.25 or higher, asks the user for the executable path instead.

- **No `ls-live-instance.json`, or it has no `executablePath`** → blocked payload `reason: lens_studio_missing`.
- **`executablePath` does not exist on disk** → blocked payload `reason: lens_studio_missing`; name the missing path in the explanation.

Native Linux Lens Studio is unsupported; return `lens_studio_missing` with a supported-host explanation.

## Launch and wait for MCP

Is Lens Studio running?

```bash
pgrep -fl "Lens Studio" 2>/dev/null || pgrep -fl "LS_" 2>/dev/null || echo "NOT_RUNNING"
```

On Windows use `Get-CimInstance Win32_Process`; do not launch a second copy when a Lens Studio main
process is already running but MCP is unreachable.

- **NOT_RUNNING** → launch `lens_studio_path` directly with the project, tell the user you're waiting for MCP, then run the poll loop below. Do not use `open -a`: it can redirect into another running instance.
  ```bash
  nohup "<lens_studio_path>" "<project_path>" >/dev/null 2>&1 </dev/null &
  ```
  On Windows use
  `Start-Process -FilePath $lensStudioPath -ArgumentList ('"{0}"' -f $projectPath)`.
- **Running from a different executable than `lens_studio_path`** → blocked payload `reason: lens_studio_wrong_version` (`suggested_next_step: Quit the other Lens Studio instance, launch <lens_studio_path>, open <project_path>, then re-invoke /lens-studio-router.`).
- **Running, probe failed anyway** → do not launch anything; classify the error as `mcp_plugin_off` or `mcp_down`.

**Poll loop.** MCP is not immediately ready after launch. Poll with the Gate probe itself — `ExecuteEditorCode` running `references/gate-diagnose.ts` by path — up to about 30 seconds total, sleeping 2s between attempts. This is the connection check only — do not configure MCP, edit `.mcp.json`, or attempt to repair the server from this skill.

```bash
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  # invoke ExecuteEditorCode with path: references/gate-diagnose.ts here
  # break when it returns JSON
  sleep 2
done
```

- **Returns JSON** → return to the router's successful-probe branch with that result; it populates the ready payload.
- **Times out / fails** → classify:
  - Re-run the `pgrep` probe. No process running → `reason: mcp_not_running`.
  - Error indicates no project / no document loaded → `reason: no_project_open`.
  - Error indicates auth/token mismatch → `reason: mcp_down`.
  - Lens Studio running but MCP connection-refused/unreachable → `reason: mcp_plugin_off`.
  - Otherwise → `reason: mcp_down`, with the last MCP error summarized.

## Blocked-payload taxonomy

Every blocked payload uses the router's Failure-modes template. `reason` values and their `suggested_next_step`:

| `reason` | When it fires | `suggested_next_step` |
|---|---|---|
| `no_project_present` | No `.esproj` and no `Assets/` + `Packages/` at cwd. The router never scaffolds. | Open Lens Studio with the project you intend to build with, then fully restart your coding-assistant session so it re-registers the Lens Studio MCP server at startup. Re-invoke `/lens-studio-router` (or, in preflight mode, the skill that triggered the preflight) from that project's directory. |
| `lens_studio_missing` | No `ls-live-instance.json` with an `executablePath` beside `.mcp.json`, or that path no longer exists. | Open `<project_path>` in Lens Studio 5.25 or higher, then re-invoke `/lens-studio-router`. |
| `lens_studio_wrong_version` | The running Lens Studio is below 5.25 or has an unreadable version; or a Lens Studio other than `lens_studio_path` is running. | Quit that Lens Studio, open `<project_path>` in Lens Studio 5.25 or higher, then re-invoke `/lens-studio-router`. |
| `mcp_plugin_off` | The Claude Code schema preload fails (MCP server not registered at session start), or Lens Studio is running but MCP is connection-refused. | Launch Lens Studio with the MCP plugin enabled (enable it from the app's Plugins/Extensions UI — plugin names vary by build; do not invent an exact name; if the user can't find it, point to https://developers.snap.com/spectacles), then re-invoke `/lens-studio-router`. |
| `mcp_not_running` | The poll loop timed out and no Lens Studio process is running. | Launch `<lens_studio_path>`, open `<project_path>`, then re-invoke `/lens-studio-router`. |
| `no_project_open` | MCP error indicates no project/document is loaded. | Open `<project_path>` in Lens Studio, then re-invoke `/lens-studio-router`. |
| `mcp_down` | Auth/token mismatch or any other unclassified MCP failure. | Restart Lens Studio so the MCP token refreshes, then re-invoke `/lens-studio-router`. If the token still fails, restart the agent client so it re-reads `.mcp.json`. |
| `wrong_project_open` | A different project is loaded and the user canceled the switch (or no human could answer). Include `current_project` and `target_project` in the explanation. | Close `<current_project>` in Lens Studio (or open `<project_path>` manually), then re-invoke `/lens-studio-router`. |
| ~~`not_signed_in`~~ | **Retired as a router blocker.** Sign-in is advisory (see SKILL → Route → Sign-in): the router hands off with `is_authorized: false`/`unknown` and proceeds. The plan step plans around the features that need sign-in, and gated skills that still hit `not_signed_in` skip that feature and continue (`build-mesh` → Signed out). The router no longer emits this reason. | — |
| `platform_choice_required` | Platform unstated by user and project, and no human can answer in this run. | Re-run interactively, or state the platform (Specs or Snapchat) in the request. |
