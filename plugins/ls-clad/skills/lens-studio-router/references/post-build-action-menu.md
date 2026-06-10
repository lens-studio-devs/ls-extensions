<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Post-build dispatch (Specs) — /lens-studio-router

After a successful Specs build the router surfaces the builder's report, runs the first-pass verify per `lens-studio-field-notes` → See-and-fix loop, prints the plain-text suggestion line, and ends the turn. The user's reply is **plain conversation** — dispatch it by intent using this reference. Ask/spawn/skill-invoke semantics: router SKILL.md **Cross-runtime behavior** / `lens-studio-field-notes` Cross-runtime orchestration.

**Degradation split (applies to every action):** a runtime that *can't spawn* markdown subagents is NOT a missing install — load the agent's file (`ls-clad/agents/<name>.md`) and run it inline. Only when the skill/agent source file is genuinely absent is the install partial: tell the user (`/plugin install ls-clad@lens-studio`) and degrade **that action only** — the others still work.

| Intent | Invokes | When missing |
|---|---|---|
| Verify ("check it", "does it look right") | `ls-clad:verify-preview` skill | Run the See-and-fix loop directly with the MCP tools |
| Test ("write tests", "test it on device") | `ls-clad:live-lens-tester` agent | Test degrades; everything else still runs |
| Optimize ("make it faster", "reduce draw calls") | `ls-clad:specs-optimize-lens-mesh` or the perf pipeline | Optimize degrades |
| Publish ("ship it", "submit") | `ls-clad:specs-publish` skill | Publish degrades |
| Followup change ("remake the UI", "add X") | `ls-clad:specs-experience-builder` agent (fresh spawn) | Inline-degrade per the split above |

## Verify

Invoke the `ls-clad:verify-preview` skill — a read-only QA pass on the *currently running* scene (writes nothing): capture, drive one interaction, check logs, judge against `original_request`. If the skill is missing, verification still happens — run `lens-studio-field-notes` → See-and-fix loop directly (`RecompileTypeScriptTool`, `RunAndCollectLogsTool`, `CaptureRuntimeViewTool`, Read the capture and judge it).

If verification finds blockers and the user wants them fixed, spawn the builder in fix mode (below).

## Test (LEAF)

Spawn `ls-clad:live-lens-tester` (plugin-qualified). Unlike Verify's read-only look, this **writes LEAF scenario files into the project and installs the LEAF package** (LEAF is Lens Studio's integration-test framework), then runs scripted scenarios — taps / pinches / drags with assertions — in the preview. Tell the user that before spawning. Prompt shape:

```
HANDOFF_PAYLOAD
- task: live_testing
- platform: Specs
- project_path: <absolute path to .esproj>
- mcp_status: ready
- original_request: <verbatim — what the Lens is meant to do, so the agent knows what behavior to test>
- asset_manifest: <from the most recent builder machine-readable summary, or "unavailable">

Confirm MCP → install the LEAF package → author scenarios covering the Lens's primary interaction flows → run them in the preview. Tests must be additive — do not modify the user's Lens code without explicit permission. End with the specs-leaf-run-in-preview completion table.
```

Surface the agent's completion report verbatim. **Failing scenarios get no auto-fix** — they're real test/Lens bugs for the user to weigh in on; do not spawn the builder to silently patch them. On a repeat run, the agent detects an existing `LeafIndex` and re-runs the suite rather than re-authoring it.

**Scene-state gotcha:** every LEAF scenario resets the scene and leaves the preview in the *last* scenario's end-state. A verify right after a Test run observes a post-LEAF scene, not the pristine build — run `ls-clad:reset-preview-environment` first, or caveat the verify summary with "(preview reflects the last LEAF scenario's end-state)".

## Optimize

Two **non-interchangeable** paths — confirm which the user wants before running anything:

**Mesh / draw-call path** — invoke `ls-clad:specs-optimize-lens-mesh` with `args: <PrefabName>`. It operates on **one `ObjectPrefab`**: merges that prefab's same-material RenderMeshVisuals and decimates geometry, mutating the prefab in place and saving. Resolve the target first — enumerate prefab assets carrying RMVs via `ExecuteEditorCode` (walk `model.project.assetManager.assets`, keep each `ObjectPrefab` whose internal `sceneObjects` contain a component with a `.mesh`). 0 candidates → nothing for this pass to merge (geometry not wrapped in a prefab); suggest the CPU path instead. 2+ → ask which. Surface the skill's before/after table verbatim.

**CPU / runtime path** — a two-stage measured pipeline:

1. `ls-clad:specs-lens-perf-attribution` profiles the Lens and writes an optimization plan into a caller-chosen directory.
2. `ls-clad:specs-lens-perf-optimize` (invoked with `args: attribution-dir=<dir>`) applies the ranked fixes, validating each and committing it on a new branch.

Stage 2 has two hard preconditions: **a plan** — there is no fixed output-dir convention, so glob for the signature pair (a dir is a valid attribution-dir only if it contains **both** files):

```bash
find . -type f -name optimization_candidates.md 2>/dev/null | while IFS= read -r f; do
  d="$(dirname "$f")"
  [ -f "$d/metrics_compact.json" ] && echo "$d"
done | sort -u
```

— and **a clean git tree** (`git status --porcelain`; the skill commits/reverts each fix and refuses a dirty tree). **Never commit or stash on the user's behalf** — show `git status -s` and let them clean up. Cold start (no plan yet — the normal post-build case, and the tree is dirty from the fresh build): run stage 1 only, surface the plan summary and dir, and hand off — the user kicks off stage 2 deliberately once the tree is clean.

## Publish

Invoke the `ls-clad:specs-publish` skill with `args: <absolute path to .esproj>`. It exports/preflights a fresh SPECS package in shell, then submits through Lens Studio authorized Editor API requests — Lens Studio must be running with the target project open and the user signed in. It never obtains, prints, caches, or passes Snapchat bearer tokens. Surface its success / failure output **verbatim** — no paraphrase, no auto-fix. Known error shapes:

- `PKG_ID_UNAVAILABLE` — another developer owns that `pkg_id`; the user must pick one they own
- `Failed to verify package file` — production signing key not registered for the project
- `Build validation failed` — backend rejected the package
- `401 Unauthorized` / `not_signed_in` / `no_auth_interface` — the authorized request failed; have the user sign in inside Lens Studio with the project open, then retry

Each invocation exports a fresh package, so retrying after the user fixes a prerequisite (signing key, new `pkg_id`) uses current project state.

## Followup change

Spawn `ls-clad:specs-experience-builder` fresh with the user's new ask:

```
HANDOFF_PAYLOAD
- platform: Specs
- project_path: <absolute path to .esproj>
- project_state: existing-with-prior-build
- mcp_status: ready
- original_request: <verbatim followup text — what they want changed/added>
- prior_request: <the request that produced the current build, for context only>

The project already has a built scene from the prior pass. Treat `original_request` as the new authoritative ask. Re-use existing assets/scripts where they still apply; re-generate only what the new ask changes. Re-run your self-audit before reporting.
```

After the builder returns, verify the changed build per the See-and-fix loop and re-offer the suggestion line.

## Fix mode (after a failed verify)

When verification flagged blockers and the user wants them fixed, spawn `ls-clad:specs-experience-builder` with:

```
HANDOFF_PAYLOAD
- mode: fix
- platform: Specs
- project_path: <absolute path to .esproj>
- mcp_status: ready
- original_request: <verbatim>
- issues: <the verify pass's issues, verbatim>

Apply the fixes per your fix-mode procedure. Return the fix-report + machine-readable summary.
```

Then re-verify once per the See-and-fix loop and report the outcome — don't loop fix passes without the user asking.
