<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Step-spawn payload template

Reference for `specs-build-experience` §2. How to frame the input payload when spawning a `step-<name>` specialized agent (or invoking the step skill inline on runtimes without spawning). The agent file carries the spawn discipline and tool sandbox; this snippet carries the per-step *input*.

Spawn by plugin-qualified name — `ls-clad:step-plan`, `ls-clad:step-mesh`, etc. (Claude Code: `Agent({ subagent_type: "ls-clad:step-<name>" })`; other runtimes: their subagent facility; no-spawn runtimes: invoke `ls-clad:<skill>` inline with the same payload).

**Never give a step spawn a display name** (Claude Code: omit `Agent`'s `name` parameter; equivalently, never spawn a step as a *teammate*). Pass only `subagent_type`, `description`, and `prompt`. A named spawn joins the session's agent team, and that silently swaps the return protocol out from under this whole design:

- A teammate's **final reply is not delivered to you** — you get an `idle_notification` with no payload. Every `step-*` agent file promises "your final reply IS the return value"; naming the spawn makes that promise false, and you re-run the step for a payload it already emitted.
- To get the payload at all you must ping, and the step must answer over `SendMessage` — reproducing the exact triple-emission (final reply + message + idle summary) the step agents were rewritten to stop.
- **Teammates cannot spawn teammates** — the roster is flat, so a named `step-mesh` cannot fan out its per-mesh verifiers until it retries unnamed.
- Names persist across `/clear` and outlive the agents holding them, so a second build in the same session gets `step-mesh-2`, `step-icons-2`, … and any name you *derive* rather than read addresses the previous build's dead agent.

Unnamed spawns come back as an async completion carrying the agent's full final reply — read the `STEP_RESULT` from there and validate it. If a step runs long and you want a progress read, poll its output by task id; do not re-spawn it to make it talk.

**Co-locate a wave's spawns.** Every step in the same dispatch wave (the orchestrator's §5 sequencing) goes out as separate `Agent` calls **in the same assistant message** — that message-level co-location is the only thing that makes them run concurrently. Build all of a wave's payload slices first, then emit the calls together; do not emit one and wait for its result before framing the next.

Frame each prompt as:

```
You are the <step> step of a Specs build. Input payload:

<the step's slice of the plan + upstream payloads — see per-step inputs below>

Follow your skill to completion. Return exactly one fenced STEP_RESULT JSON block, and
write the same JSON to .clad/steps/<step>.json (see references/step-result-protocol.md).
```

**The persist line matters most in fix-mode and targeted re-runs.** A full-pipeline step learns the `.clad/steps/<step>.json` output convention from its skill preamble; a fix-mode prompt skips that preamble, so state the convention explicitly (see `references/step-result-protocol.md`) — otherwise the step returns a fenced block but never writes the file the orchestrator and downstream steps read.

**The table below is the input each step needs — it is the contract.** Keep a payload to the slice the step actually needs (see the per-step rows below); anything you want to pass that has no natural field goes in `notes`, and must not be load-bearing, since a step has to run correctly without it.

Per-step input slices (drawn from prior validated STEP_RESULTs):

| Step | Input payload to pass |
|------|-----------------------|
| plan-assets | `request` (verbatim user text) + the handoff's `is_authorized` |
| plan | `request` (verbatim) + `plan_assets` — the validated plan-assets payload, verbatim and **frozen** (names/types/`target_size_cm` carry forward unchanged), plus the handoff's `is_authorized` |
| init | `project_path` |
| proxy | plan-assets' `assets[]` of type `mesh` — **names and `target_size_cm` only**, plus the final path convention. The names and sizes must match what `meshes` gets, or the swap breaks. |
| icons | plan-assets' `assets[]` entries of type `icon` |
| meshes | plan-assets' `assets[]` of type `mesh` with each `target_size_cm` + `theme`, plus the handoff's `is_authorized` |
| sfx | plan-assets' `assets[]` of type `sfx` |
| music | the single `music` entry (with its derived description) |
| skeleton | the `proxy` payload (name → path → size) + `plan.spatial_layout` + the scene-root contract names + `init`'s project facts |
| ui | `plan.assets[]` of type `ui` (elements + labels) + **`plan.ui_api` verbatim** — the interface it must implement (extend allowed, rename forbidden) — plus the handoff's router-verified `lens_studio_version`, which the worker needs to version-gate the checked-in helper (absent or `unknown` → it fails that gate closed, deriving from installed docs rather than copying the snapshot blind). **No asset payloads** — it reads the icon payload from `.clad/steps/icon.json` when it reaches module authoring; a spawn held for icons (or worse, meshes) is the dependency bug this design removed. |
| scripts | `plan.script_plan` + **`plan.ui_api` verbatim** (as `ui_modules`) + the deterministic asset paths from the plan (mesh `Assets/GeneratedMeshes/<Name>.glb` + `target_size_cm`, sfx/music `Assets/Generated*/`, icon `Assets/Icons/`). It reconciles against `.clad/steps/ui.json` and `.clad/steps/mesh.json` before its final recompile — do not hold its spawn for those payloads. |
| bootstrap | the authored script set **with each script's `@input` names and types**, each UI module's `class_name` / `public_methods` / `requireAsset` paths, `mesh` payload (aabb/pose/offset), `skeleton`'s `created_roots` **verbatim** (reuse, don't re-create), `plan.spatial_layout`, and whether SyncKit was installed. For the `bootstrap-scripts` half, also paste `bootstrap-ui`'s payload — its created roots **and the assets it created** (e.g. `ImageMaterial.mat`), so it need not re-derive by grep what its sibling created. |
| audit | the finished build on disk (read-only); the assembled `asset_manifest` for the manifest↔disk↔scripts check. Name any mesh still standing on a proxy — the audit judges real assets. |

**Never assert a tool's availability or brokenness in a spawn prompt unless you observed it this session.** Each step's sandbox differs from yours, so your tool list proves nothing about theirs. State what the step must *achieve* (e.g. "the project must be saved; report `project_saved: false` if you cannot") and let it probe its own tools. Conversely, a step reporting a tool "absent" may mean absent only *from its sandbox* — never propagate a step's tool-absence claim into another step's prompt as a fact about the session.

Keep payloads to the slice the step needs — do not forward the whole running transcript. But **paste the fields, don't describe them**: a step that has to grep the project for `@input` names or re-read `.virtual-scene.json` for facts an upstream payload already validated is paying for your summary. Each step's context is fresh and disposable; the orchestrator holds the validated STEP_RESULTs and threads only the relevant fields forward.
