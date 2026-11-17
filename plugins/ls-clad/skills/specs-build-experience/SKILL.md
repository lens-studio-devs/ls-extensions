---
name: specs-build-experience
description: >
  Orchestrate a full Specs AR experience build — a spawn/collect/validate loop
  over pipeline steps (plan, init, icons, meshes, SFX, music, UI, scripts,
  bootstrap, audit). Invoked by /lens-studio-router with a HANDOFF_PAYLOAD.
  Full and fix-mode builds.
user-invocable: true
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Build a Specs Experience (orchestrator)

You are the **orchestrator** for a Specs experience build. You do **not** author assets, scripts, or scene content yourself — you dispatch each pipeline step to a fresh, disposable context, collect its `STEP_RESULT`, check the fields the next step needs, and drive the sequence. Orchestration lives in a skill rather than a sub-agent so the loop runs where the report and the router's post-build verify also run; sub-agents may spawn sub-agents (Claude Code allows three subagent layers below the main conversation by default), so this loop still fans out if you are yourself a spawned agent.

**Parallel dispatch is the point of this design.** The independent asset steps take most of the wall-clock, and the only way to overlap them in Claude Code is to emit their spawns as **multiple `Agent` calls in one assistant message**. One spawn per message is serial execution with a parallel label. §2 is not advisory.

Reaching this skill means the platform is **Specs** and the environment is gated — trust the `HANDOFF_PAYLOAD`; do not re-debate platform or re-run generic environment checks.

The heavy per-step doctrine lives in the step skills (`/specs-plan-experience`, `/specs-project-init`, `/icon-selector`, `/build-mesh`, `/build-sfx`, `/build-music`, `/specs-build-ui`, `/specs-author-scripts`, `/specs-bootstrap-scene`, `/specs-audit-build`) and the governing rules live in `/lens-studio-field-notes` → **Hard Rules**. This skill carries only the loop.

## 1. Parse the handoff + self-gate

Read the `HANDOFF_PAYLOAD` (its shape is defined by the router — see `lens-studio-router`):
- `mode` — `full` (default; absent counts as full) or `fix`.
- `request` / `original_request` — verbatim user text.
- `project_path`, `platform`, and the environment fields the router set — including `lens_studio_version`, which the **ui** step needs to version-gate the checked-in helper (thread it through; see §2).
- `issues[]` — present only for `mode: fix`.
- `init_task` or `init_result` — optional current invocation supplied by the
  router. Reuse it; never dispatch a second init. Neither supplied means this
  build starts its own init alongside `plan-assets` (§5).

**Self-gate.** If you were not handed `mcp_status: ready`, run the MCP liveness probe (field-notes Hard Rule 6): on Claude Code preload its schema first — `ToolSearch({ query: "select:mcp__lens-studio__ExecuteEditorCode", max_results: 1 })` (Codex/Cursor surface it directly) — then call `ExecuteEditorCode` with `return "ok";`. Reachable → proceed. Unreachable → the project isn't open in a session that registered MCP; surface the actionable blocker (*open the project in Lens Studio, then restart your coding-assistant session*) and stop. Never fall back to curl/HTTP (field-notes Hard Rule 4).

The `HANDOFF_PAYLOAD` in your spawn prompt is the sole source of environment truth. If a field reached you incomplete, ask rather than re-derive; `mcp_status` and `is_authorized` are never trusted from anywhere but a live probe, which is exactly why the liveness check above is still yours to run. A `false`/`unknown` `is_authorized` is **expected, not a stop** — pass it to `plan-assets`, `plan`, and `meshes` (see the spawn template), which plan and build around the features that need sign-in; do not add a top-level auth block here.

**Mode dispatch.** `mode: fix` → skip the full pipeline and go to **§6 Fix mode**. Otherwise run the full pipeline (§2–§5).

## 2. Execution mode — spawn is the default, inline is a capability floor

Framed by intent (field-notes Hard Rule 2 — resolve tool names per runtime):

**Default: spawn.** Spawn each step's specialized agent (`ls-clad:step-<name>`) with the step's input payload framed per `references/step-spawn-template.md`. Each agent runs in a fresh context, executes exactly its one step's skill, and returns a `STEP_RESULT`.

**Spawn steps as plain subagents, never as named teammates** (Claude Code: omit `Agent`'s `name` parameter). A named spawn joins the agent team, and a teammate's final reply is never delivered to you — so the `STEP_RESULT` contract every step agent is written against silently stops working, and you end up pinging steps for payloads they already emitted. See `references/step-spawn-template.md` for the full failure chain.

**Dispatch rule (hard).** A step is dispatchable the moment **its own `Depends on` in the §3 step table is satisfied** — not when some group finishes. Every step that becomes dispatchable at the same moment goes out as **multiple `Agent` calls in a single assistant message**. Never open a batch with one spawn and add the rest in later messages, and never hold a step for a step it does not depend on.

**You are authorized to spawn — but say so, never silently.** A user asking for a build is the request for delegation: the `step-*` agents are this skill's execution mechanism, not an optional optimization, so a general "avoid subagents / minimize delegation" preference does not cover these spawns (and being a sub-agent yourself is not a reason to serialize). This authorization is not a hidden override: **your first build message states in one line that the build runs as parallel `step-*` subagents** — the spawns are visible and interruptible, so a user who truly wants it serial can stop you and ask. Transparent delegation, not a silent one.

**Inline only when spawning is impossible**, i.e. exactly one of:
1. The `Agent` tool (or your runtime's equivalent) is **absent from your tool list**. If only named Markdown agents are unsupported, read the agent file and pass its instructions to a general-purpose subagent; that still supports parallel execution.
2. A spawn **errored**, and re-spawning once in the next turn errored the same way (tool-missing is a retry gate, never a permanent fallback — field-notes Hard Rule 2).

If you go inline, invoke the step's **skill** (`ls-clad:<skill>`) with the same payload and validate the same contract — nothing forks, the agent files carry only spawn discipline and tool sandboxing while the step *content* is single-homed in the skill. And: **announce it in your first message with the concrete reason** ("`Agent` is not available in this runtime — running steps inline, which serializes the asset wave"), and set `execution.mode: inline` in §7's summary. A silent degrade to inline is a contract violation; it is the single largest wall-clock regression available to you.

Either way the per-step contract is identical — a fenced `STEP_RESULT` JSON block, mirrored to `.clad/steps/<step>.json` (see `references/step-result-protocol.md`).

## 3. Step table

An inherited `init_task` is already running; collect it through the runtime's
completion mechanism. An inherited `init_result` must be validated the same way:
require `step: "init"`, `status: "ok"`, matching `project_path`,
`project_ready: true`, both package flags true, and empty `errors[]` / `blockers[]`.
Never satisfy init from a previous `.clad/steps/init.json`. A failed or
uncollectable invocation blocks dependent work; do not spawn a replacement while
the old task may still be running.

Init owns editor writes until it passes. Planning and local audio generation can
continue; editor-using steps below explicitly depend on init. This also keeps
package installation ahead of UI authoring and script compilation.

The `Depends on` column in the table below is authoritative. Dispatch the moment those steps have returned.

| Step | Depends on | Skill / step-agent | Input | Output | Gate |
|------|-----------|--------------------|-------|---------------|------|
| plan-assets | — | `specs-plan-experience` (`mode: assets`) / `step-plan-assets` | `request` | `plan-assets` | hard |
| plan | plan-assets | `specs-plan-experience` / `step-plan` | `request` + frozen plan-assets payload + `is_authorized` | `plan` | hard |
| init | — | `specs-project-init` / `step-init` | project_path | `init` | hard (blockers → §5 coach) |
| proxy | plan-assets, init | `build-mesh` (`mode: proxy`) / `step-proxy` | assets[mesh] + target sizes | `proxy` | soft (skip → no early scene) |
| icons | plan-assets, init | `icon-selector` / `step-icons` | assets[icon] | `icon` | soft (text-only fallback) |
| meshes | plan-assets, init | `build-mesh` / `step-mesh` | assets[mesh] + sizes + theme + `is_authorized` | `mesh` | hard |
| sfx | plan-assets | `build-sfx` / `step-sfx` | assets[sfx] | `sfx` | soft |
| music | plan-assets | `build-music` / `step-music` | assets[music] | `music` | soft |
| skeleton | proxy, init, plan | `specs-bootstrap-scene` (`mode: skeleton`) / `step-skeleton` | proxy payload + spatial_layout + root names | `skeleton` | soft |
| **ui** | **plan, init** | `specs-build-ui` / `step-ui` | plan.assets[ui] + `plan.ui_api` (its interface contract) + the handoff's `lens_studio_version` | `ui` | hard |
| **scripts** | **plan, init** | `specs-author-scripts` / `step-scripts` | script_plan + `plan.ui_api` + deterministic asset paths | `scripts` | hard |
| **bootstrap-ui** | **ui, skeleton** | `specs-bootstrap-scene` (`mode: bootstrap-ui`) / `step-bootstrap-ui` | ui payload + skeleton's `created_roots` | `bootstrap-ui` | hard |
| bootstrap-scripts | scripts, bootstrap-ui | `specs-bootstrap-scene` (`mode: bootstrap-scripts`) / `step-bootstrap-scripts` | authored scripts **with `inputs[]`** + asset payloads + both halves' `created_roots` | `bootstrap-scripts` | hard |
| **audit-static** | **scripts, ui** | `specs-audit-build` (`mode: static`) / `step-audit-static` | asset_manifest + scripts/ui payloads (read-only, no editor) | `audit-static` | hard (see §4 loop) |
| **bootstrap-refit** | **meshes, bootstrap-scripts** | `specs-bootstrap-scene` (`mode: refit`) / `step-bootstrap-refit` | mesh payloads (real `aabb_cm`) + `bootstrap-scripts`' `created_roots` | `bootstrap-refit` | hard |
| audit-runtime | bootstrap-refit | `specs-audit-build` (`mode: runtime`) / `step-audit-runtime` | finished scene + `audit-static`'s `issues[]` | `audit-runtime` | hard (see §4 loop) |

**`bootstrap-scripts` no longer waits for meshes.** It wires the scene against the proxy geometry the `skeleton` placed — `@input`s and colliders bind to the authored wrapper roots, which the mesh overwrite/rebind preserves (see the rebind note below), so nothing it wires points at the swapped GLB. It sizes colliders from **`target_size_cm`** (the frozen plan baseline, usually right); the correction for real-bound drift is deferred to `bootstrap-refit`. This puts the whole wire step on the post-plan front, off the mesh critical path — the lens runs and is gameplay-testable before any real GLB lands.

**`bootstrap-refit` is the only wiring-side step gated on meshes.** After the real GLBs land and the `mesh` step has re-bound its instances, it reads each mesh's real `aabb_cm`, `GetBoundingBox`-checks the placed geometry, and **only when a mesh drifted** from `target_size_cm` adjusts that collider's `box.size` (§refit of `specs-bootstrap-scene`). Cheap and conditional — a couple of calls per drifted mesh, none for meshes that matched. Colliders are approximate (target-based) between `bootstrap-scripts` and `bootstrap-refit`: fine for logic testing, but `bootstrap-refit` must complete before the build is "done."

**Assets-first: the plan is split so the mesh backend never waits for a layout.** `plan-assets` returns tier + theme + the complete asset manifest quickly; the full `plan` and local audio steps dispatch immediately. Proxy, mesh, and icon steps dispatch once init also passes, without waiting for the full plan. The full plan carries the manifest forward **frozen** — names, types, `target_size_cm` never change downstream (proxy path identity and skeleton poses depend on them); if `plan` reports a manifest defect in `deviations[]`, treat it like any other issue routing, not as license to have let the wave wait.

**Interface-first: `ui` and `scripts` dispatch once plan and init pass.** The plan emits `ui_api` — each UI module's `path` / `class_name` / `public_methods` / `events`, decided before either implementer exists. `ui` implements that contract (it may *add* methods, reported in its payload; it may never rename or change a declared signature). `scripts` authors its calls against the same contract, then **before its final recompile** reads `.clad/steps/ui.json` (step-ui writes it as its last action) to verify every signature it calls against what ui actually shipped, and `.clad/steps/mesh.json` to patch real `aabb_cm` / `animation_available` values. Missing icons never block `ui` — it reads the icon payload from `.clad/steps/icon.json` when it reaches module authoring (icons dispatches a wave earlier and normally lands first), and degrades to the text-only fallback per its own doctrine if an icon is absent. The serial icons→ui→scripts chain was a dependency on the *interface*, not the implementation.

**Two more dependencies are narrower than they look:**

- **`bootstrap-ui` depends on `ui` + `skeleton`, never on `scripts`** — so it runs **concurrently with `scripts`**. This is safe because `step-scripts` has no scene-write tools at all (no `VirtualScene`, no `scene-graphql`) — it writes `.ts` and recompiles — so the two never touch the same surface (field-notes Hard Rule 4). **Do not add scene-write tools to `step-scripts` without revisiting this.**
- **`audit-static` depends on `scripts` + `ui`, never on the bootstrap** — its checks are all filesystem greps, so it runs **concurrently with `bootstrap-scripts`** rather than adding to the tail.
- **`bootstrap-scripts` depends on `scripts` + `bootstrap-ui`, never on `meshes`** — it wires against the proxy scene (wiring binds to persistent wrapper roots, not the swapped geometry), so it overlaps the whole mesh generation. Only `bootstrap-refit` waits on meshes, and only to correct collider drift.

A build where `ui` or `scripts` waits for an asset step, where `bootstrap-ui` starts only after `scripts` returns, where `audit-static` starts only after `bootstrap-scripts` returns, or where **`bootstrap-scripts` waits for `meshes`**, is a scheduling bug even if every step succeeded.

Each step's SKILL "Output contract" section is the authoritative field list; you carry only the one-line-per-step summary above and sanity-check a returned payload by parsing it (§4). There are no separate schema files to read.

## 4. Payload collection loop (never continue on a broken payload)

**Payloads arrive two ways — the step's returned reply, and the file it wrote.** Each step writes its `STEP_RESULT` to `<project>/.clad/steps/<step>.json` as its last action (see `references/step-result-protocol.md`); that file is the **raw `STEP_RESULT`** (no wrapper), and it is how a *peer* step reads another's output. You also receive the same block directly as the step's completion, so if a step's file is missing you write it yourself from the reply you already hold. One Bash line reads the state of every step you are waiting on, in the same turn as the next dispatch:

```
node -e 'const path = require("path"); for (const s of process.argv.slice(1)) { try { const r = require(path.resolve("<project>", ".clad/steps", s + ".json"));
  console.log(s, r.status, Array.isArray(r.errors) ? r.errors.length : "?"); }
  catch { console.log(s, "absent"); } }' <step> <step> …
```

Field requirements live in each step's SKILL "Output contract"; the shared envelope (`step`, `status`, `errors[]`, `deviations[]`, `retries`) lives in `references/step-result-protocol.md`. Validate a payload by parsing it and confirming `status` plus the fields the next step consumes are present — not a Bash turn per step.

**An absent file means the step has not written its payload yet — it is never a stand-in for one.** A downstream reader trusts `.clad/steps/<step>.json` as the step's answer, so never invent or half-write one: a `null`/partial file is poison — a downstream reader takes it as the step's answer and chases a file that says nothing. If the step has already returned to you, write the file from the reply you hold; if it has not, **ask that step for its payload — never re-type it into a downstream prompt.**

**Re-typing a payload you already hold costs its full length at token-generation speed, and you will corrupt it** (dropped fields fail a downstream cycle on data the step actually reported). You never need to re-emit JSON a step already produced — you hold its reply, so move it with file operations (write the reply to `.clad/steps/<step>.json`), never by hand.

**One turn per wave: read the payloads, narrate, dispatch — in that single message.** A standalone payload-reading turn, or a message that only updates the scoreboard, is dead critical path. The newly-dispatchable steps depend on the step having *returned*, not on your having read its payload, so the `Agent` calls belong in the same message as the read and the narration lines. If a payload is then malformed or missing a field the next step needs, the retry gate below is still yours to run — you have lost nothing, because a re-spawn was going to be a fresh message either way.

**Batch your `ToolSearch` selects into one call.** Deferred MCP schemas load in a single `select:A,B,C` query; two sequential selects for tools you knew you needed together is a turn of pure latency.

- **Valid** → record the payload; continue. The plan already lives at `.clad/steps/plan.json` — the `plan` step wrote it there as its last action — so downstream steps slice their inputs from it and a later fix-mode run reads it instead of re-planning.

- **Malformed / missing a required field, or the step errored** → retry gate: re-spawn (or re-invoke inline) the step **once** with the specific problem (the missing field, the wrong `status`) appended to the input. Second failure → set that step `status: blocked`, surface the block to the user, and stop. **Never continue on a broken payload; never silently degrade** to a lesser build (field-notes Hard Rules 1 & 4). A persistent failure stops the build; it does not produce a lesser build.

**"Quiet" is not a failure — do not re-run a step for not talking.** The retry gate fires on a *malformed or missing-field payload* or a *spawn/tool error*, never on silence, an idle notification, or a step taking longer than you expected. A step that has gone quiet has almost always finished: ask it once for its payload and **wait for the answer** before doing anything else. Re-spawning a working step costs its full wall-clock twice and, for any step that writes files or edits the scene, risks doubling its side effects. Before you re-run *any* step, check whether its artifacts are already on disk — if they are, collect rather than regenerate.

**Never do a step's work yourself while that step is live.** No inline duplicate of a step you are waiting on, and no edits to files or scene objects a running step owns — duplicated work is discarded and concurrent edits collide. If you have a correction for a live step, **route it to that step** and let it own the file.

## 5. Full-pipeline sequencing

Run a **readiness loop**, not a march through groups: after every returned payload, look at which steps now have all of `depends_on` satisfied, and spawn all of them in one message.

- **Start (one message, FIRST):** spawn plan-assets immediately and reuse the inherited init task/result. Only when neither was supplied, spawn plan-assets ∥ init in that same message, before project inspection of your own. Any `.clad/steps/` captures left from a prior session carry a different `session_id` — ignore them rather than read them as this build's payloads; fix-mode runs legitimately read the prior build's captures. Continue planning while init runs; validate its returned result using §3 before releasing editor work.
- **On plan-assets (one message):** **plan** ∥ sfx ∥ music; also proxy ∥ meshes ∥ icons if init has passed. Otherwise dispatch that editor-using asset wave as soon as init passes. Omit an asset step only when the manifest has no assets of that type.
- **On plan + init (one message):** **ui** ∥ **scripts** — both build against `plan.ui_api` (§3). Disjoint output dirs (`ui` owns the `*UI.ts` files + `UIKitHelpers.ts`, `scripts` owns everything else in `Assets/Scripts/`); they reconcile against the icon/ui/mesh payloads from `.clad/steps/` themselves (§3).
- **On proxy + init + plan:** spawn **skeleton** (it places against `plan.spatial_layout`) — the user sees the layout here, minutes in.
- **On ui + skeleton:** **bootstrap-ui — do not wait for scripts.** It holds the scene surface while scripts holds only `.ts` files.
- **On scripts + ui (one message with the above if both are ready):** **audit-static** — filesystem-only, so it overlaps the rest of the bootstrap.
- **On scripts + bootstrap-ui:** bootstrap-scripts (wire) — **do not wait for meshes.** It wires against the proxy scene.
- **On meshes + bootstrap-scripts:** bootstrap-refit — the conditional collider-drift correction (the only wiring-side step that waits on meshes). **On bootstrap-refit:** audit-runtime.

Typical shape: the post-plan-assets wave runs six-wide (plan + five asset steps), `ui` and `scripts` join on the full plan and overlap the whole mesh generation *and each other*, `skeleton` overlaps everything, `bootstrap-ui` overlaps the tail of `scripts`, `bootstrap-scripts` (wire) overlaps mesh generation, and `audit-static` overlaps it too. Meshes then feed a short `bootstrap-refit → audit-runtime` tail. The strictly serial floor is plan-assets → plan → max(ui, scripts) → bootstrap-scripts → (meshes join here) bootstrap-refit → audit-runtime — the old `mesh → bootstrap` serialization is gone because wiring no longer waits on the meshes it doesn't reference.

**Draft the report while `audit-runtime` runs.** Everything in §7 except the runtime audit's own findings is known the moment `bootstrap-scripts` returns — the per-step table, the asset manifest, backends, deviations, the YAML summary skeleton. Write it then, leaving holes for the runtime issues, and the final message after the last payload is a paste-and-fill, not a from-scratch composition with zero agents live.

**Draft the next spawn prompts while you wait, not after the notification.** Your own token generation between a step's return and the next spawn sits directly on the critical path. While a dependency is still running you are idle: use that window to draft the dependent step's spawn prompt from the payloads you already hold, leaving a hole for the one field the running step will add (e.g. draft `ui`'s prompt from the plan while `icons` runs, then paste `imported[]` and spawn within seconds of the icons notification). When a notification arrives, the target sequence is: validate from disk (one Bash line), fill the hole, spawn — not compose-from-scratch.

**The final scene-writing step saves — you audit, you don't save.** `bootstrap-scripts` (the last bootstrap half) and any scene-touching fix agent hold `ExecuteEditorCode` and end with `const model = pluginSystem.findInterface(Editor.Model.IModel); model.project.save();` as their last action (the save lives on the **project** — `model.save()` does not exist). `skeleton` and `bootstrap-ui` do structure-only work and do **not** save — the build persists once, when `bootstrap-scripts` runs, and only `bootstrap-scripts` (and fix agents) report `project_saved`. Treat a returned `project_saved: false` as a **defect to route back to that step**, not a to-do to absorb — and still verify it landed, because an unsaved build exists only in the running editor session.

**The post-bootstrap recompile and baseline capture belong to `bootstrap-scripts`, not to you.** It holds `RecompileTypeScriptTool`, both capture tools and `RunAndCollectLogsTool`, and its exit criteria are apply → recompile → save → baseline capture (+ a log read when the capture fails). Your gap between its return and the `audit-runtime` dispatch should be exactly *read verdict + dispatch* — the step already has the tools to save, recompile, and capture.

**Gate `bootstrap-scripts` and `audit-runtime` on a playing preview.** A paused preview blinds every capture tool, letting a placement pass run with zero screenshots — the window where a serious bug can be introduced unseen. Before spawning either step, make sure the preview the tools use is playing and resume it with `PreviewPanelTool` `resume` (same `previewName`); if it cannot be resumed, tell the user what a paused preview costs and continue only after saying so. Once the final fix leaves the Lens running cleanly, also refresh the user's visible Preview panel (`preview-inspection` → Preview routing → "Show the user the result") so they see it working there, not only on the preview the tools use.

**"The preview is paused" from a step means read the log yourself, immediately.** A capture that yields no frame is equally consistent with a paused panel and with a crash-looping Lens, and the two are indistinguishable without `RunAndCollectLogsTool` — resume-and-recapture attempts tell you nothing while one log read names the failing file, line and column. So: any step that reports a failed capture or `runtime_log_status` other than `clean` gets a `RunAndCollectLogsTool` refresh from you before you accept its placement verdict or spawn anything downstream of it — and lifecycle errors route straight to a single-file fix agent on the named file (`scripts` owns it), not to a re-run of the bootstrap.

**Merging the two audit halves.** `audit-static` and `audit-runtime` each return their own `issues[]`. Concatenate them for the §4 audit→fix loop and de-duplicate by `(category, file)` — `audit-runtime` is given the static half's issues precisely so it does not re-report them, but a duplicate is possible when both legitimately observe the same defect from different sides. Route each surviving issue to its `responsible_step`, and note that the responsible step may now be `bootstrap-ui` or `bootstrap-scripts`; send a UI-surface or material-asset problem to the former, a wiring or placement problem to the latter.

### Progressive visibility (proxy → skeleton → real assets)

Without this the user watches an unchanged scene for most of the build and only sees the experience after bootstrap. The `proxy` and `skeleton` steps fix that, and the mechanism is **path identity**:

1. `proxy` writes a primitive at each mesh's `target_size_cm` to the mesh's **final** path, `Assets/GeneratedMeshes/<Name>.glb`, in seconds.
2. `skeleton` builds the unit roots and places that geometry at its planned poses — layout on screen, minutes in.
3. `meshes` **overwrites the same paths** as each real generation lands. Every pose stays valid because `target_size_cm` did not change — but the swap is **not** free of scene work (see below).
4. `bootstrap` reuses `skeleton`'s `created_roots` by name and only adds ScriptComponents, `@input` wiring, and UI surfaces.

**The overwrite orphans the scene's mesh references — the `mesh` step must re-bind, and it owns that.** Overwriting a GLB that Lens Studio has already imported *deletes the old mesh asset* rather than reloading its binary in place. Instances the `skeleton` placed are left holding `mesh: null` / `materials: {0: null}`, or a subtree whose material count no longer matches the new file, and they render nothing at correct poses. A preview refresh does not fix it; the only reliable repair is to delete the stale instance subtree and re-instantiate from the freshly-imported prefab under the same parent, then re-apply the pose.

So: after each overwrite the `mesh` step re-binds that mesh's placed instances and reports the re-bind in its payload; `skeleton` hands forward the **parent object and local pose of every instance it created** so the re-bind is mechanical rather than a rediscovery. **But because `bootstrap-scripts` (wire) now runs before the re-bind and may re-parent the skeleton's proxies under the authored hierarchy, the re-bind must resolve its scope from a fresh scene query at re-bind time — the skeleton's placed-instance list is a hint for the pose, not the authoritative current location.** Treat a zero-extent runtime bound on a placed instance as this failure, not as a bad generation — and note that `mesh: null` read via `scene-graphql` is **not** a reliable signal on its own (healthy instances report it too); the runtime bound is.

Three more rules keep this from becoming a silent degrade (field-notes Hard Rule 1):
- **Every proxy must have its real generation already running.** No proxy for an asset the `mesh` step is not producing.
- **Never report a proxy as a finished mesh.** The `asset_manifest` and the audit describe the real GLBs; if a real generation failed, that mesh is `blocked` — a surviving proxy is not a delivered asset and must be named in the report. The one exception is `backend: primitive` with `backend_reason: signed_out` or `no_api_access` (`build-mesh` → Signed out): that proxy is the declared asset, and the report names it as a placeholder to regenerate once sign-in or API access is available.
- **Tell the user what they are looking at.** When the skeleton lands, say the geometry is placeholder and the real assets are still generating. Grey boxes presented without that sentence read as a finished bad build.

If `proxy` fails, drop `skeleton` too and continue with the normal pipeline — you lose early visibility, not the build. Say so; don't retry it into the critical path.

**Report fan-out honestly.** Concurrency is self-reported: in §7's `execution` block state whether each wave actually went out as one message. A step's self-reported `fanout.spawn_messages` is taken at face value, so a step that split its leaf spawns (`script-file`, `ui-module`, `mesh-verify`) across several messages must say so, and a wave you split across messages is a `serial` verdict you record in "Self-caused limitations" — do not label it `parallel`.

**The slot pool is shared with your steps' own fan-outs — budget it.** Concurrent agents are capped (Claude Code: ~`min(16, cores − 2)`, commonly ~10). A wave of step spawns plus their leaf fan-outs (mesh-verify, module authors, file authors) can exceed the cap; the excess queues, so spawns you co-located correctly still land seconds apart and the longest steps stretch. Two consequences, neither of them "fan out less at the top":
- **Wave dispatch stays wide** — the step spawns themselves are ~6 agents and always go together. It is the *leaf* fan-outs that must stay lean: one agent per unit of real work, no agent for a check that is a `Bash` line (the step doctrines now say this; a step reporting more leaf agents than it had files/meshes is the regression).
- **When a wave's steps report their own fan-out counts** (`fanout.spawn_messages`, mesh's verify count), read them in the same glance as the payload — a step that spawned per-file agents across several messages, or spawned agents for numeric checks, is the reason its wave looked serial.

**Conservative fallback (only on observed contention):** if the asset fan-out shows MCP contention — concurrent `ExecuteEditorCode`/generation calls erroring or interleaving badly — retry as sfx ∥ music ∥ icons in one message, then meshes. Two messages, still no fully serial path. This is a response to an observed error, not a precaution to take up front.

**Narrate the build — the user cannot see inside your subagents.** Spawning agents the user can't observe reads as a black box; the fix costs two short lines per step:

- **On every spawn:** one line per step — what it does and what unblocked it. *"→ mesh: generating 5 farm meshes (unblocked by plan)"*. A wave gets one line per member, same message as the spawns.
- **On every collected payload:** one line — status, the headline numbers, and deviations count. *"✓ mesh: 5/5 generated on SPECS, 1 deviation (stray geometry on one prop's rim — accepted)."* Deviations the user should care about get one clause, not a paragraph.
- **Keep a scoreboard** in the same message: *"7 of 14 steps banked; running: scripts, bootstrap-ui."*
- **After each scene-writing step (skeleton, bootstrap-ui, bootstrap-scripts), point at the editor:** name what just appeared or changed in the Scene Hierarchy / Assets browser — *"the layout roots are now in the Hierarchy under `<Name>Root`; real meshes will replace the grey placeholders in Assets/GeneratedMeshes as they land."* Progressive visibility (§5) puts the work on screen; this line tells the user where to look.
- **At the end**, the report's per-step table doubles as the "what did each agent do" record — and `.clad/steps/<step>.json` holds each step's full input and payload for anyone who wants the detail after the fact.

This replaces silence, not the payloads: never let narration grow into re-transmitting a STEP_RESULT in prose.

**Give the user a read on long steps instead of silence.** `bootstrap` is the longest step in the pipeline. When a step has been running more than ~5 minutes and it is the only thing in flight, **read its output stream** (Claude Code: `TaskOutput` on its task id) and report one line of where it actually is — "bootstrap is on its second apply, wiring `@input`s" beats another "still waiting." Polling its output is free; re-spawning it to make it talk is not (§4). Do this at most every few minutes, and never in place of collecting the payload.

**Thread structured facts, not prose.** You hold every upstream `STEP_RESULT`; a step should never have to re-derive what an earlier one already validated. When you frame a spawn, paste the relevant upstream **fields** (each script's `@input` names and types, each UI module's `class_name` / `public_methods` / `events`, `requireAsset` paths, asset paths with AABBs, skeleton's `created_roots`) rather than describing them — a step made to grep or re-read `.virtual-scene.json` for facts a payload already carried is paying for your summary. Keep the slice tight — the fix is precision, not volume.

**init blockers.** If the `init` STEP_RESULT returns non-empty `blockers[]`, surface them to the user and re-spawn init after they act — do not poll and do not proceed with an unready project. Use an ask-and-recheck loop (field-notes → Cross-runtime orchestration); if no human can answer in this run, surface the blocker and stop.

**Asset completion gate (before `bootstrap-refit`).** Confirm every promised asset landed: hard-block on a missing mesh / SFX / UI module; soft-block (log, continue) on missing icons (text-only ships) and on a mesh that came back `animation_available: false`. This gate moved off `bootstrap-scripts` (wire) — which references assets by path and does not need the real GLB to wire — onto `bootstrap-refit`, the step that actually reads real `aabb_cm`. A hard block here also means checking whether `scripts`' reconcile pass saw the failure (its payload reports which upstream payloads it reconciled against). UI-module completeness is already gated at `bootstrap-ui`; a missing SFX/music WAV is a `requireAsset`-by-path that surfaces at audit, not a wire-time blocker.

**Refit resolution gate (before you dispatch `audit-runtime`).** `bootstrap-refit` can detect a hard render defect it is deliberately not allowed to fix — most importantly a **wrapper-scale leak**: a placed mesh whose *world* AABB is a clean multiple of its true `aabb_cm` (e.g. an extra ×100 because both a wrapper and its geometry carry `localScale 100`). Refit reports this as `status: blocked` with a machine-routable `issues[]` entry (`responsible_step: mesh` — the re-bind self-heals a stray wrapper scale; structural origin is `skeleton`'s placement wrapper), not as prose in `errors[]`. Treat a `blocked` refit — or one reporting `project_saved: false` or `runtime_log_status` other than `clean` — as a **mandatory route**: feed its `issues[]` through the same fix router as the audits' (`references/fix-mode-routing.md`), re-run the responsible step, and re-validate refit to `ok` **before** dispatching `audit-runtime`. A downstream audit `ok` never overrides an unresolved upstream `blocked`: bounds measured on a lens that renders at 100× or is crash-looping are unreliable, so signing off on them stamps a broken build green — exactly the failure this gate exists to stop.

**Interaction-verify gate (before the build is "done").** The core interactive behaviour — a tap/press/spawn producing **visible, correctly-sized** content — is the product, and neither audit half can see it (`audit-static` greps files; `audit-runtime` reads a scene at rest, and on-tap content is absent then). So verify **every interaction the build actually has** (the wired `Interactable`s + the scripts' spawn behaviours — the built scene is the source of truth, not a declaration that could omit one; a lens with none passes vacuously). For each: drive the input, query the spawned instance's **full transform + aabb in one snapshot** (`{ transform { worldPosition worldScale worldRotation } bounds { min max } }`), and record the raw numbers + expected `aabb_cm`/anchor to `.clad/steps/interaction-verify.json` — **node presence or a HUD `Text` flip is never evidence**. Then run `tools/check-interaction-verify.py`: the pass/fail is **arithmetic** (per-axis measured-vs-expected size band + placement), computed by the script, not graded by you — a 1 % speck fails on the number, nothing to explain away. After the data verdict is all-pass, one capture per instance sets each row's `visible` (Layer 2, catches black/wrong-shape/transparent) — it may never excuse a failing number. **The build is not "done" until the script exits `0` for every interaction** (or the artifact records an explicit un-drivable limitation). Precondition: an `AiPreviewAgentInspect` with the world-AABB and small-object-clamp fixes must be provisioned or the bounds ruler is unreliable. Full protocol + schema: `references/interaction-verify.md`. Without this gate a mark hard-set to a 1 % speck passes a node-presence check and ships "verified" — the failure it exists to stop.

**Required ready-to-try checkpoint.** When `bootstrap-scripts` has returned and
compilation and startup logs confirm the build is running, send a
standalone user-facing progress message **before the next screenshot, visual inspection,
interaction-test, or audit tool call**:

> **🟢 First build is running — you can try it now in Lens Studio.**
> **🟡 I’m checking visuals and interactions; these are not yet verified.**
> Try it now. Say “stop testing” if you're happy with this version.

If placeholder geometry remains, say so in this message. Do not wait for all
assets or audits to finish to announce the running first pass. A tool result,
internal note, or final report does not count. Continue without waiting for a
reply. On a stop request, stop active workers before saving; report unfinished
assets/checks explicitly and do not claim a verified or complete build. Compilation or
startup failures require a blocker update instead of the green status. Report
visual concerns in the yellow status; do not withhold the running-build message
while refining layout or inspecting screenshots.

**Play the loop before you route a single fix — and start playing when `bootstrap-scripts` (wire) returns, not when the audit does.** That is the payoff of wiring early: the lens is interaction-testable on proxy geometry while meshes are still generating, so drive the core interaction chain the moment wire returns. The final `audit-runtime`, though, dispatches after `bootstrap-refit` (real colliders), since placement/size verdicts need the corrected bounds. Neither audit half can see interaction: `audit-static` greps files, `audit-runtime` reads a scene at rest. Dispatch `audit-runtime` and drive the core interaction chain yourself (`PreviewInteractTool` / `InjectPreviewGesture` + `CapturePanelScreenshotTool`) **in the same message** — the audit is read-only, so the only rule is no preview refresh or recompile while it runs. Merge what you find with both audits' `issues[]`, and *then* dispatch one fix cycle. Full rationale and the "cannot play" fallback: `references/fix-mode-routing.md` → *Drive the experience BEFORE you route any fix*.

**Audit → fix loop.** Feed the `audit` step's `issues[]` back to the responsible step per `references/fix-mode-routing.md` (each issue names its `responsible_step`), re-run that step, and re-audit. **Hard cap: 3 audit→fix cycles.** If cycle 3 still has hard issues, stop fixing and surface them in the report's "Self-caused limitations." Before, during, and after each dispatch, apply the reference's **Fix dispatch discipline**: confirm a visual defect yourself with the correct instrument before spawning (text → `CapturePanelScreenshotTool`), time-box each fix at ~8 minutes with a `TaskOutput` probe, dispatch independently-owned fixes in one message, **never drive the preview while a fix agent is live** (a sibling's recompile wipes runtime state mid-drive), and **own the post-fix verification yourself** — fix agents apply and return; they never spawn helpers or wait on anything. One re-drive per cycle, after every fix payload is in.

## 6. Fix mode

`mode: fix` — no background init should be supplied; if one is still running, stop and collect it before fix dispatch. The scene + scripts + assets already exist; do targeted surgery against the handoff's `issues[]`, **not** a fresh plan→bootstrap build. Skip plan/init/asset generation and the full bootstrap. Route each issue to its responsible step per `references/fix-mode-routing.md` — including its **Fix dispatch discipline** (confirm visual defects with the correct instrument first, ~8-minute time-box per fix, parallel dispatch across disjoint owners, fix agents apply-and-return) — re-run only those steps, and re-validate their `STEP_RESULT`s. Verification does not run here — the router re-verifies after you return.

## 7. Report + machine-readable summary

**Do not write "verified" — or the report's runtime findings — until every hard step has returned a valid payload.** `audit-runtime` and the interaction-verify gate each produce a result; a required check that did not return (interrupted session, killed subagent, no `STEP_RESULT`) is `blocked` (§4 retry gate: re-spawn once, then stop), **never** absorbed into "done" by your own parallel play-through. Concluding the build works from your play-through *while `audit-runtime` is still running* — or after it never returned — is the core failure mode: the recorded check rendered no verdict, and its independent findings were lost with it. If a check genuinely could not finish, the honest terminal status is **"unverified — check incomplete," surfaced as such — never a silent pass and never a caveated one.** A parallel play-through is a finder that feeds the fix loop; it is not a substitute for a returned audit payload.

Surface a human-readable report (what was created; **how the build ran** — subagent-parallel vs inline-serial, with the reason if it wasn't parallel; **any mesh still standing on a placeholder** because its real generation failed — never let a proxy pass as a delivered asset; **mesh backend per mesh** with `backend_reason` for every static mesh not on SPECS; script locations; SFX triggers; orphan-icon / text-only fallbacks; external vs self-caused limitations — self-caused must be empty at sign-off). Then append the machine-readable YAML summary the router consumes — **every key always present** (empty categories as empty arrays, never omitted):

```yaml
tier: <effect/utility | interactive | mechanics-driven>
execution: {mode: <subagent|inline|mixed>, wave1_dispatch: <parallel|serial|single-step>, note: <one line on how dispatch actually went, or null>}
asset_manifest:
  meshes:     [<Name>.glb, …]
  sfx:        [<Name>.wav, …]
  icons:      [<name>.png, …]
  ui_modules: [<ExperienceName><PanelName>UI.ts, …]
  scripts:    [<ExperienceName>Main.ts, …]
backend_deviations: [{mesh: <Name>.glb, backend: fast3d, reason: <user's words>}, …]
ui_packages:   # forwarded from the ui step (specs-build-ui Verify evidence)
  UIKit: {installed_version: <version | unknown>, contract: references/uikit-4.0.md, imports_verified: <true | false>}
  InteractionKit: {installed_version: <version | unknown>}
spatial_layout: |
  <plan spatial layout, verbatim>
synckit_hygiene: {examples_disabled: <bool>, start_mode: START_MENU, device_tracking_world: <bool>}  # null if SyncKit not installed
```

When SyncKit was installed, the bootstrap step returns the `synckit_hygiene` triple (field-notes Hard Rule 8) — carry it into the summary, and **recommend the main agent spawn `ls-clad:specs-sync-kit-validator`** before declaring the build done (a fuller read-only structural check you can't easily self-verify mid-build).

The `ui_packages` block is produced by the UI step (`specs-build-ui` → Verify) — forward it verbatim into the summary so the installed versions and import verification survive regardless of which orchestrator ran; use `{}` when the build has no UI step.

The router runs the post-build See-and-fix verify after you return — your job ends at the report + summary.

## References (read on demand)

- `references/step-spawn-template.md` — the payload-framing snippet for spawning `step-<name>` agents.
- `references/step-result-protocol.md` — the shared STEP_RESULT envelope + the `.clad/steps/<step>.json` persist convention.
- `references/fix-mode-routing.md` — the issue-category → responsible-step routing table, budgets, and fix-report shape.
