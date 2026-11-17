<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Fix-mode routing

Reference for `specs-build-experience` §5 (audit→fix loop) and §6 (fix mode). Routes each issue — whether raised by the `audit-static` / `audit-runtime` steps' `issues[]` or handed in by the router's post-build verify as the fix-mode `HANDOFF_PAYLOAD.issues[]` — to the pipeline step responsible for the fix. The orchestrator re-spawns (or re-invokes inline) only the responsible step(s) and re-validates their `STEP_RESULT`s; it never patches files itself.

## Issue → responsible step

Both audit halves already tag each issue with a `responsible_step`. Concatenate their `issues[]` and de-duplicate by `(category, file)` before routing — `audit-runtime` is handed the static half's findings so it does not repeat them, but both can legitimately observe one defect from different sides. For issues that arrive from the router's verify with a `category` instead, map as below:

| Symptom / `category` | Responsible step | Fix action (in that step) |
|---|---|---|
| Inline `Component.Text` / UIKit import in a non-UI script; hand-rolled BackPlate/Button in a `*UI.ts`; a deprecated `BackPlate` emitted as a new surface; a hand-made panel close button ("X" Button or footer "Close" row) instead of `frame.showCloseButton`; missing UI surface | `ui` (`specs-build-ui`) | Re-invoke with the surface named in prose args; it regenerates the `*UI.ts` module. Never patch inline. |
| Missing `.glb` / wrong mesh dimensions / oversize (`size_warning`) | `mesh` (`build-mesh`) | Re-invoke for that one entry with corrected `target_size_cm`; never compensate with `setLocalScale` (Hard Rule 6.8). |
| Missing `.wav` (sound effect) | `sfx` (`build-sfx`) | Re-render that entry to `Assets/GeneratedSFX/`. |
| Missing / silent (`play(1)` not `play(-1)`) music | `music` + `scripts` | Re-render the bed (`music`); add the `play(-1)` bed block in `onAwake()` (`scripts`). |
| `requireAsset(...)` path missing on disk | the step that owns the asset (`mesh`/`sfx`/`music`/`ui`), else `scripts` for a `.mat` the scripts must write | Generate the missing asset, or remove the call and construct in code. |
| Buried config/balance, claimed-but-unwired `@input`, knob for a non-feature, knob-cap overflow, missing `@input` wiring, compile/runtime error in a script | `scripts` (`specs-author-scripts`) | Expose/trim knobs, fix the wiring or the TypeScript, recompile. |
| Authored-root overlap / containment / viewport-escape / occlusion; unwired authored `@input`; `synckit_hygiene` not satisfied; project not saved | `bootstrap-scripts` (`specs-bootstrap-scene`, `mode: bootstrap-scripts`) | Re-run the targeted VirtualScene apply / placement fix within its 2-apply budget. |
| Collider `box.size` drift vs real `aabb_cm`; facing; foot-on-floor (each needs the real mesh, not the proxy) | `bootstrap-refit` (`specs-bootstrap-scene`, `mode: refit`) | Re-measure the drifted mesh and correct `box.size` / placement Y; a wrong subject or fragment is a `/build-mesh` re-invoke, not a refit. |
| Authored root renders at a clean multiple of its true `aabb_cm` — a wrapper-scale leak (world AABB an exact ×N of the mesh size because both a wrapper and its geometry carry `localScale`, e.g. a redundant ×100 import×wrapper double-scale) | `mesh` (`build-mesh` re-bind) | Re-run the re-bind: it neutralizes a stray ~×100 wrapper scale (resets a wrapper whose own scale is ~100 back to 1) so only the child `<Name>Mesh` prefab carries the single import ×100. The structural prevention lives in `skeleton` — the placement node must be a plain wrapper with `_prefab` only on the child. Never `setLocalScale` the geometry (Hard Rule 6.2/6.8) and never regenerate the GLB — it is correct. |
| Missing UI surface root or UI-module ScriptComponent; a `requireAsset` material the UI modules need (e.g. `ImageMaterial.mat`) absent | `bootstrap-ui` (`specs-bootstrap-scene`, `mode: bootstrap-ui`) | Re-run the UI half within its 1-apply budget. Do not send these to `bootstrap-scripts` — it does not own the UI surfaces. |
| Bad manifest / tier / spatial plan (rare — a planning error) | `plan` (`specs-plan-experience`) | Re-plan the affected slice, then re-run downstream steps that consumed it. |

## Fix-spawn payload requirements

A fix re-run skips the skill preamble a full-pipeline step gets, so the spawn prompt must carry what the preamble would have supplied. Every fix spawn includes, in the prompt text:

1. **The output-persist convention** (see `step-spawn-template.md` and `step-result-protocol.md`): the fix agent returns a fenced STEP_RESULT and writes it to `.clad/steps/<step>.json`. A fix-mode prompt skips the skill preamble that would otherwise supply this, so state it — otherwise the re-run's payload never lands where you read it back.
2. **The prior run's validated payload fields the schema will demand back.** A `bootstrap-scripts` fix must be handed the previous `wired_inputs[]` verbatim with the instruction to copy it forward, amending only the wires it touched — otherwise the fix agent re-enumerates every wire from the scene. Same principle for `scripts` fixes (`scripts[]` inventory) and `ui` fixes (`modules[]`).
3. **The full diagnosis, not the symptom.** Fixes are fast when the prompt carries root cause, line numbers, and invariants; a bare symptom makes the agent re-diagnose.
4. **A freshness marker for log evidence** — the runtime-log window that predates the fix is stale; tell the agent the timestamp its evidence must postdate, or it will re-report an already-fixed error cluster as live.
5. **The verification split: the agent proves what its own instruments can prove; you own interaction.** `step-ui`, `step-scripts` and both bootstrap halves hold the **read-only** runtime instruments — `CapturePanelScreenshotTool`, `QueryRuntimeSceneTool`, `RunAndCollectLogsTool` — so a fix that changed a size, a color, a collider or a wire must come back with *measured evidence*, not "needs orchestrator confirmation" (that phrase forces a second verification round-trip the agent could have settled itself). So tell every fix spawn: *apply the fix, then prove it with the instrument that matches the claim (geometry/size → `QueryRuntimeSceneTool` bounds; text/layout → `CapturePanelScreenshotTool`; a crash or console error → `RunAndCollectLogsTool`), report the measurement in your payload, and return.* Still forbidden: spawning helpers to verify for you, and waiting on anything. **What stays yours:** driving the experience (`PreviewInteractTool` / `InjectPreviewGesture`) — the preview is a single shared surface and concurrent fix agents must not fight over it.

## Drive the experience BEFORE you route any fix

**The play-through is a finder, not a sign-off.** Both audit halves are blind to interaction: `audit-static` greps files, `audit-runtime` inspects a scene at rest. A defect that only appears when something is pressed, bought, spawned, grown or dragged is invisible to both — and every minute you spend fixing before you have looked for those defects buys a second serial fix cycle.

So, the moment `bootstrap-scripts` (wire) returns and the preview is playing — on proxy geometry, minutes before the real meshes land — **exercise the core loop yourself** (`PreviewInteractTool` / `InjectPreviewGesture` + `CapturePanelScreenshotTool`), one pass through the primary interaction chain the plan describes — the equivalent of "acquire → place → progress → collect". This early play is the payoff of wiring ahead of meshes; logic is testable on placeholders. `audit-runtime` itself dispatches later, after `bootstrap-refit` puts real colliders in — but drive the interaction as soon as wire returns; the audit holds only read-only instruments, so it never contends for a write surface; just don't refresh the preview or trigger a recompile while it runs. Merge whatever you find with both audits' `issues[]`, *then* route one fix cycle. Routing fixes before the play-through buys a second serial fix cycle for the interaction-only defect it would have surfaced; one cycle with two issues costs the same wall clock as one cycle with one.

**Measure runtime-spawned content the moment it appears — from its transform + aabb, never from its node.** When the drive creates content that no author-time step placed (a spawned, pooled, dealt, or dropped object), query it in **one snapshot** while it is on screen — `{ transform { worldPosition worldScale worldRotation } bounds { min max } }` — and record it to `.clad/steps/interaction-verify.json` with the expected `aabb_cm` (from `.clad/steps/mesh.json`) and the anchor it was placed into. A node existing (`descendantsTree`) or a HUD `Text` change is **not** evidence the object is visible or correctly sized. The pass/fail is then computed by `tools/check-interaction-verify.py` (per-axis rendered cm vs `aabb_cm` size band + placement) — not eyeballed — and a `fail` routes `issues[]`, `severity: hard`, this cycle. Judge size from the **cm bounds only**: `transform.worldScale` is a *factor*, not a size — a clean meter GLB sits at `worldScale ≈ 100` (the m→cm import), which is correct, not oversize — so `worldScale`/`worldRotation` are *recorded for diagnosis*, never a pass/fail rule. This is the only point such content is measurable: it does not exist until the interaction fires, so the at-rest audit and every author-time placement check are blind to it. **The play-through that finds a defect and the gate that records the pass are the same drive, written to the same artifact** (`references/interaction-verify.md`) — read mid-build to route a fix, read at done as the gate. Route a failure by which number is wrong: instance mis-sized vs a correct asset `aabb_cm` → the scale/instantiate in the spawning script (`responsible_step: scripts`); the asset itself wrong → `responsible_step: mesh`.

Corollary: if the play-through cannot run (no frame, preview unavailable), say so before routing fixes and treat interaction-class defects as unverified in the report — do not pretend the audits covered them.

## Fix dispatch discipline

Four rules:

- **Confirm the defect is real before dispatching (visual issues).** For any "X is not rendering / not visible / looks wrong" issue, reproduce it yourself first with the *correct* instrument — text via `CapturePanelScreenshotTool`, geometry via `CaptureRuntimeViewTool` — and check it against scene data (`QueryRuntimeSceneTool`). If the two disagree, suspect the instrument, not the scene. A wrong-instrument verdict dispatches a long fix for a defect a single screenshot disproves.
- **Time-box every fix dispatch at ~8 minutes of wall-clock.** The audit issues carry full diagnoses, so a routed fix is minutes of work. When a fix agent passes the budget, read its output stream (Claude Code: `TaskOutput` by task id): if it is progressing on the fix, let it run; if it is waiting, sleeping, or verifying rather than fixing, collect whatever it has applied from disk, proceed to your own verification, and count its issue as addressed or not on the evidence — do not wait it out.
- **Keep fixes parallel where ownership allows.** Fixes routed to different steps own disjoint surfaces (same one-writer rule as the pipeline), so dispatch them in one message. A fix phase where one agent is the sole live work for half an hour is the failure mode this section exists to prevent.
- **Never drive the preview while a fix agent is live.** A fix agent's recompile or refresh resets runtime state and destroys every runtime-instantiated object (spawned rows, buttons, panels) mid-drive, wiping any drive in progress. The cycle shape is strict: dispatch the cycle's fixes in one message → collect every payload (each fix self-verifies with its read-only instruments, rule 5 above) → **one** re-drive as the cycle's gate.

## Budget

- **Audit→fix loop (full build):** max **3** audit→fix cycles. After cycle 3, surface remaining hard issues as "Self-caused limitations" rather than looping.
- **Fix mode (router-invoked):** address every blocker; address warnings opportunistically (one-line fixes yes, costly re-runs deferred). Prefer re-running a single step over a broad rebuild. Each bootstrap half keeps its own apply/recompile budget (max 1 VirtualScene apply, max 3 recompiles per fix pass).

## Fix-report shape

After a fix-mode run, return the human report plus the machine-readable summary — the same keys as a full build's summary (`tier`, `asset_manifest`, `backend_deviations`, `ui_packages`, `spatial_layout`, `synckit_hygiene`), with an added `fix_report` block:

```yaml
fix_report:
  issues_addressed: [<short summary>, …]
  issues_skipped:   [<short summary + reason>, …]
  assets_added:     [<paths>]
  assets_modified:  [<paths>]
  scripts_modified: [<paths>]
```

The router parses `asset_manifest` + `spatial_layout` for its re-verify call and `fix_report` for the summary it surfaces to the user. Verification does not run inside fix mode — the router re-verifies after the orchestrator returns.
