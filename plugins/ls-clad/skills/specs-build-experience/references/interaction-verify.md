<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Interaction-verify gate

The core interactive behaviour — a tap / press / spawn producing **visible, correctly-sized** content — IS the product. It must be verified from **measured data**, not attested from a node's existence or a scoreboard's text. Both audit halves are blind to it (`audit-static` greps files; `audit-runtime` reads a scene **at rest**, and on-tap content does not exist at rest), so this gate is where "the experience actually responds" is proven and recorded.

**Scope: test the interactions the build actually has.** Enumerate the interactions present in the finished lens — the wired `Interactable`s in the scene and the spawn behaviours the scripts define (the interaction chain the plan describes is a hint, but the built scene is the source of truth). Verify **each** one. Add an interaction → it is in the set → it gets tested. A lens with no interactions (a static effect/utility filter) has an empty set and passes this gate vacuously — there is nothing to skip and nothing to fake, because the set comes from what was built, not from a declaration that could omit it.

**Two layers, run in order. Data decides; the picture confirms.**

## Layer 1 — DATA (measured, recorded; the verdict is arithmetic, not a judgement)

For each interaction:

1. **Perform the input** on the real target — `PreviewInteractTool` / `InjectPreviewGesture` against an `Interactable`'s `uniqueId` (or its `worldPosition`), not a guess.
2. **Query the resulting instance in ONE snapshot** (`QueryRuntimeSceneTool`) — transform *and* aabb together, so bounds and pose come from one consistent scene state:
   `{ transform { worldPosition worldScale worldRotation } bounds { min max } }`
   **A node existing is NOT evidence.** Do not conclude "spawned" from a `descendantsTree` node, from an empty `RenderMeshVisual` query read past, or from a HUD `Text` flip ("Player O's Turn", "X Wins!") — those prove the *state machine*, not that anything is on screen at the right size.
3. **Record one row** to `.clad/steps/interaction-verify.json` (schema below) with the raw measurements and the expected values (the spawning asset's `aabb_cm` from `.clad/steps/mesh.json`; the anchor it was placed into). **You record numbers; you do not decide pass/fail.**
4. **Run the verdict script** — `tools/check-interaction-verify.py` (see below) — which computes pass/fail by arithmetic over the artifact. A speck at 1 % of target fails on `measured/expected`; there is no sentence to write and nothing to rationalise. Route any `fail` through `references/fix-mode-routing.md` this cycle.

### Artifact schema — `.clad/steps/interaction-verify.json`

```jsonc
{
  "interactions": [
    {
      "interaction": "tap Cell_0 places MarkX",   // human label
      "target": "Cell_0 (<uniqueId>)",             // what was driven
      "asset": "MarkX",                            // spawning asset (aabb source)
      "measured_cm":      [x, y, z],               // bounds.max - bounds.min (rendered size)
      "expected_aabb_cm": [x, y, z],               // from mesh.json
      "worldPosition":    [x, y, z],
      "expected_anchor":  [x, y, z],               // the cell/anchor it should land at
      "worldScale":       [x, y, z],               // recorded for diagnosis; NOT a gate rule
      "worldRotation":    [x, y, z],               // recorded for diagnosis; NOT a gate rule
      "visible": null                              // Layer-2 result; set true/false after data passes
      // "verdict" / "reason" are WRITTEN BY THE SCRIPT — do not hand-set them
    }
  ]
}
```

A non-interactive lens writes `{ "interactions": [] }` and the script passes it vacuously.

### What the script checks (and what it does NOT)

- **Size (per axis):** `measured_cm[i] / expected_aabb_cm[i]` within `[0.5, 2.0]` on every axis. Per-axis is deliberate — it catches both a collapsed speck (all axes ~1 %) and a gross orientation flip (axes swapped, e.g. a flat `[8,1,8]` mark landing on-edge `[8,8,1]`). This is a **coarse visibility/size band**, not precise sizing — exact collider/mesh sizing is `bootstrap-refit`'s job; this only asks "is it roughly the right size, i.e. actually there and not a speck or a giant."
- **Placement:** `worldPosition` within a coarse tolerance of `expected_anchor` — "did it land at its anchor," not sub-cm precision.
- **Completeness:** every interaction in the set has a row with the required fields. A missing row or field is a `fail`, never a silent skip — this is what stops "I didn't bother checking."
- **It does NOT judge cause.** `worldScale`/`worldRotation` are recorded but are not pass/fail inputs — reading `worldScale ≈ 100` as "oversize" is the exact false-flag this pipeline exists to avoid (100 is the normal m→cm import). A failure reports the *symptom* (wrong measured size / misplaced); the fix-router attributes cause generally (asset `aabb_cm` wrong → `mesh`; instance mis-sized by the spawn script → `scripts`).

## Layer 2 — VISUAL sign-off (only after the script's data verdict is all-pass)

Once the data gate is green, take **one** capture per spawned instance (`isolate` if occluded), set each row's `visible` field, and require it `true` — the final confirmation it actually renders, catching what data cannot: black/missing material, wrong mesh *shape*, transparency, z-fighting. The visual runs **after** data and may **never override or excuse a failing number** — the trap it guards against is an empty/"faint" capture rationalising a broken size. Data proves correctness; the picture is the last "for sure."

## Precondition — the ruler must be fixed

Layer 1 measures via `QueryRuntimeScene.bounds`, which is only trustworthy with the fixed `AiPreviewAgentInspect` package provisioned (the world-AABB and small-object-clamp fixes). Without it the gate measures with a broken ruler — a phantom cube or a floored small object — and inherits the exact bug it is checking for. Confirm the fixed package is present before trusting a `pass`; if it is not, the gate's readings are `unverified`, not `pass`.

## Done criterion

The build is not "done" until `.clad/steps/interaction-verify.json` exists and `tools/check-interaction-verify.py` exits `0` (every interaction `pass`, `visible: true`) — or the artifact records an explicit, surfaced limitation for an interaction that genuinely could not be driven (no frame / preview unavailable). A missing artifact, a non-zero script exit, or "spawned" attested from node presence or a Text change is an **incomplete** build, not a verified one.

## Anti-patterns

- "The `MarkX` node exists → spawn works" (presence ≠ visible, correctly-sized).
- Judging the game from HUD `Text` — proves state, not rendering.
- Explaining away an empty/faint capture ("low-relief tile", "seen edge-on") instead of trusting the measured number.
- Declaring "verified end-to-end" while a required check has not returned a payload.
