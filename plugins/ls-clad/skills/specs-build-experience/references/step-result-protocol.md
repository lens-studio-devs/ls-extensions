<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Step-result protocol

The output counterpart to `step-spawn-template.md`. Every pipeline step returns its result
the same way, so the orchestrator and every downstream step can read it without per-step
special-casing. This convention *is* the
contract, kept in one place so step agents cannot drift describing it.

## The shared envelope

Every `STEP_RESULT` is a JSON object with at least these fields:

| field | type | meaning |
|-------|------|---------|
| `step` | string | the step name — matches the step's name in the §3 step table (`mesh`, `ui`, `audit-runtime`, …). Note the canonical names: the `step-icons` agent reports `icon`, `step-mesh` → `mesh`. |
| `status` | `"ok"` \| `"partial"` \| `"blocked"` | see *status semantics* below |
| `errors[]` | string[] | empty on success; the reason(s) on `blocked` |
| `deviations[]` | string[] | anything you did that departs from the plan, each with its reason |
| `retries` | integer ≥ 0 | how many times you retried the step's own work |

**Step-specific fields** (e.g. `mesh`'s `meshes[]`, `ui`'s `modules[]`, `audit-*`'s
`issues[]`) are defined in that step's **SKILL "Output contract"** section — the single home
for each step's own fields. This doc owns only the envelope every step shares.

## Return it two ways

1. **Fenced in your final reply**, as exactly one block:

   ```
   ```STEP_RESULT
   { "step": "mesh", "status": "ok", "errors": [], "deviations": [], "retries": 0, ... }
   ```
   ```

   A language tag before `STEP_RESULT` is tolerated but unnecessary. Emit exactly one; if you
   re-emit, the last block wins.

2. **Written to disk as your last action**, so the payload survives the session and
   downstream steps read it without being re-prompted:
   - a normal step → `.clad/steps/<step>.json`
   - a leaf agent (`mesh-verify`, `ui-module`, `script-file`) → `.clad/steps/<step>/<agent_id>.json`
     — one file per agent, so concurrent siblings cannot overwrite each other.

   Create the directory if needed (it is self-ignoring — a `.gitignore` of `*` — so it never
   lands in git). This write is the **only** thing that puts your payload where peer steps
   read it — there is no capture hook behind you, so a step that returns a fenced block but
   skips the write leaves its peers (and a later fix-mode run) with nothing.

## How it is read

- The **orchestrator** collects your fenced block and threads only the fields the next step
  needs into that step's spawn prompt (`step-spawn-template.md`).
- **Downstream steps read peers' files directly**: `scripts` reads `.clad/steps/ui.json` to
  reconcile signatures and `.clad/steps/mesh.json` for real bounds; `bootstrap` reads the
  upstream payloads instead of re-deriving them. Interface-first scheduling depends on these
  files existing — which is why writing yours is not optional.

## status semantics

- **`ok`** — the step met its contract; downstream may proceed.
- **`partial`** — some soft-optional work did not complete; name what, and why, in
  `deviations[]`. The orchestrator decides whether to proceed per the step's `gate` in the
  §3 step table.
- **`blocked`** — a hard requirement could not be met; put the reason in `errors[]`. The
  orchestrator surfaces the block and stops rather than continuing on a broken payload. It
  never silently degrades to a lesser build.
