<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Environment edge cases — /lens-studio-router Gate

On-demand detail for the router's Gate phase. Read this when the initial `ListAllPanels` probe fails, when an `open -a` launch/switch needs an MCP wait, or when you need to classify a blocker into the payload taxonomy. The happy path (probe succeeds, project matches, sign-in true) never needs this file.

## Detect compatible Lens Studio installs (5.22 or higher)

Probe candidate app bundles before doing MCP work:

```bash
# Standard public install
test -d "/Applications/Lens Studio.app" && echo "/Applications/Lens Studio.app" || true

# Internal/beta builds published as LS_<version>_<channel>.app
find /Applications -maxdepth 1 -name 'LS_*.app' 2>/dev/null

# Spotlight fallback for custom install paths
mdfind "kMDItemContentType == 'com.apple.application-bundle' && kMDItemDisplayName == 'Lens Studio'" 2>/dev/null
```

Use these probes verbatim — do NOT improvise additional glob patterns (e.g. `/Applications/*ens*tudio*`): an unmatched glob aborts the whole command under zsh with `no matches found`, before any `2>/dev/null` or `|| true` can suppress it. `find -name` takes its pattern as a plain argument, so it is immune.

Merge and dedupe the results as `lens_studio_candidates`.

For each candidate, read its bundle version:

```bash
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "<candidate>/Contents/Info.plist" 2>/dev/null || \
  defaults read "<candidate>/Contents/Info" CFBundleShortVersionString 2>/dev/null || \
  echo "UNKNOWN_VERSION"
```

Partition candidates against the **5.22 minimum**. A candidate is **compatible** when its version is `5.22` or higher (`5.22`, `5.23`, `5.24`, … and later majors), **incompatible** when below `5.22` or `UNKNOWN_VERSION`. Compare version-aware (`sort -V`), NOT by string prefix or lexical sort — a prefix test rejects `5.23` and every later release, and a lexical sort mis-ranks `5.100` below `5.22`:

```bash
# ver_ok "<version>" → exit 0 iff version >= 5.22 (version-ordered, not lexical)
ver_ok() {
  [ "$1" != "UNKNOWN_VERSION" ] && \
  [ "$(printf '5.22\n%s\n' "$1" | sort -V | head -1)" = "5.22" ]
}
```

- `lens_studio_compatible_candidates` — `ver_ok` true (version ≥ 5.22).
- `lens_studio_incompatible_candidates` — version below 5.22, or `UNKNOWN_VERSION`.

Branch on the partition:

- **0 total candidates** → blocked payload `reason: lens_studio_missing`.
- **0 compatible, 1+ incompatible** → blocked payload `reason: lens_studio_wrong_version`; include the detected versions/paths in the explanation.
- **1 compatible** → record `lens_studio_path` and `lens_studio_version`, ignore incompatible candidates, continue.
- **2+ compatible (multi-install picker)** → ask with the runtime's blocking-ask facility: *"Which Lens Studio (5.22 or higher) should I use for this session?"* One option per compatible candidate path — label = basename + version, description = full path plus any obvious channel hint parsed from the name (`Internal`, `Public`, `Public_Release`, or `custom path`). Do not show incompatible candidates as selectable options; mention them only as ignored. Do not recommend or pre-select. Record the answer as `lens_studio_path`. If no human can answer in this run, blocked payload `reason: lens_studio_ambiguous` — do not pick the already-running app automatically.

If the user supplies a custom path, verify it with `test -d "<path>"` and read its bundle version. Path doesn't exist → blocked payload `reason: lens_studio_ambiguous` (`suggested_next_step: Provide a valid Lens Studio 5.22-or-higher .app bundle path.`). Exists but below 5.22 → blocked payload `reason: lens_studio_wrong_version`.

## Launch and wait for MCP

Is Lens Studio running?

```bash
pgrep -fl "Lens Studio" 2>/dev/null || pgrep -fl "LS_" 2>/dev/null || echo "NOT_RUNNING"
```

- **NOT_RUNNING** → launch the chosen app with the project, tell the user you're waiting for MCP, then run the poll loop below:
  ```bash
  open -a "<lens_studio_path>" "<project_path>"
  ```
- **Running, but not the selected compatible (5.22+) app** → blocked payload `reason: lens_studio_wrong_version` (`suggested_next_step: Quit the incompatible Lens Studio instance, launch <lens_studio_path>, open <project_path>, then re-invoke /lens-studio-router.`).
- **Running, probe failed anyway** → the running instance may have no project loaded, may be mid-launch, or may have the MCP plugin off. Open the project explicitly (`open -a "<lens_studio_path>" "<project_path>"`), tell the user, then run the poll loop.

**Poll loop.** MCP is not immediately ready after `open -a`. Poll the `ListAllPanels` MCP tool up to about 30 seconds total, sleeping 2s between attempts. This is the lightweight connection check only — do not configure MCP, edit `.mcp.json`, or attempt to repair the server from this skill.

```bash
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  # invoke the ListAllPanels MCP tool here
  # break on success
  sleep 2
done
```

- **Succeeds** → MCP is reachable; return to the router's Gate (sign-in check).
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
| `lens_studio_missing` | 0 install candidates found. | Install Lens Studio 5.22 or higher, launch it, open `<project_path>`, then re-invoke `/lens-studio-router`. |
| `lens_studio_wrong_version` | Only sub-5.22 / `UNKNOWN_VERSION` candidates; or the running process isn't the selected compatible app; or a user-supplied path is below 5.22. | Install or switch to Lens Studio 5.22 or higher, open `<project_path>`, then re-invoke `/lens-studio-router`. |
| `lens_studio_ambiguous` | 2+ compatible installs and no human can answer; or a user-supplied custom path doesn't exist. | Provide a valid Lens Studio 5.22-or-higher `.app` bundle path (or answer the picker interactively). |
| `mcp_plugin_off` | The Claude Code schema preload fails (MCP server not registered at session start), or Lens Studio is running but MCP is connection-refused. | Launch Lens Studio with the MCP plugin enabled (enable it from the app's Plugins/Extensions UI — plugin names vary by build; do not invent an exact name; if the user can't find it, point to https://developers.snap.com/spectacles), then re-invoke `/lens-studio-router`. |
| `mcp_not_running` | The poll loop timed out and no Lens Studio process is running. | Launch `<lens_studio_path>`, open `<project_path>`, then re-invoke `/lens-studio-router`. |
| `no_project_open` | MCP error indicates no project/document is loaded. | Open `<project_path>` in Lens Studio, then re-invoke `/lens-studio-router`. |
| `mcp_down` | Auth/token mismatch or any other unclassified MCP failure. | Restart Lens Studio so the MCP token refreshes, then re-invoke `/lens-studio-router`. If the token still fails, restart the agent client so it re-reads `.mcp.json`. |
| `wrong_project_open` | A different project is loaded and the user canceled the switch (or no human could answer). Include `current_project` and `target_project` in the explanation. | Close `<current_project>` in Lens Studio (or open `<project_path>` manually), then re-invoke `/lens-studio-router`. |
| `not_signed_in` | The sign-in check didn't return `true` after the ask-and-recheck-once flow, or the user canceled. | Sign in to Lens Studio (top-right profile/toolbar; confirm the OAuth window completed), then re-invoke `/lens-studio-router`. |
| `platform_choice_required` | Platform unstated by user and project, and no human can answer in this run. | Re-run interactively, or state the platform (Specs or Snapchat) in the request. |
