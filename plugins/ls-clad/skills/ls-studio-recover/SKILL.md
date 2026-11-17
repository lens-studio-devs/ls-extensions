---
name: ls-studio-recover
description: "Relaunch Lens Studio after it died under a running session, on the MCP port this session already uses, and verify it came back. Use when the Lens Studio liveness gate denied an MCP call, left the turn alive, and named this skill."
user-invocable: true
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Recover Lens Studio

Lens Studio died while this session was using it. The session read its MCP url once at startup and
cannot re-read it, so a returning Lens Studio is only useful on the *same* port. This script
relaunches the recorded Lens Studio with the recorded project, pins that port and the session's MCP
bearer token (so the session's token stays valid across the relaunch), and checks that MCP
really answers there.

Use it when a Lens Studio MCP call was denied by the liveness gate, the turn was allowed to continue,
and the denial named this skill. If the turn was halted instead, a relaunch cannot help.

## Run it

On macOS or Linux:

```bash
bash "<skill-dir>/scripts/recover-lens-studio.sh"
```

On Windows, use Windows PowerShell 5.1 or PowerShell 7:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "<skill-dir>\scripts\recover-lens-studio.ps1"
```

From WSL, dispatch to the Windows host:

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(wslpath -w "<skill-dir>/scripts/recover-lens-studio.ps1")"
```

No arguments. Give it a tool timeout of at least 150 seconds, and tell the user it will take a while
before you start — Lens Studio reappears in a few seconds, but the script then waits for its MCP
tools to finish registering, which has been measured at 35 to 50 seconds.

## Read the first line

- **`RECOVERY: SUCCESS`** — retry the MCP call that was denied, then carry on. Report the project and
  port. If the client has already dropped the server for this session, say so; only a session restart
  fixes that.
- **`RECOVERY: REFUSED`** or **`RECOVERY: FAILED`** — stop. Relay the reason and the manual command
  verbatim, and treat Lens Studio MCP tools as unavailable for the rest of the turn. Do not run the
  script again, do not go looking for another Lens Studio to launch, and do not edit `.mcp.json`.

## Two things not to do

- **Do not re-implement the steps inline.** Their order is the safety property: the expected port is
  read before the relaunch destroys it, and nothing counts as success until that port answers.
- **Do not substitute a different Lens Studio or project.** Both come from `ls-live-instance.json`.
  A missing one is a refusal, not a reason to search.
- **Do not run the `.sh` on Windows or WSL.** It refuses there, because its `/dev/tcp` probe cannot
  reach the port. Use the `.ps1`, which performs the same checks over .NET sockets.
