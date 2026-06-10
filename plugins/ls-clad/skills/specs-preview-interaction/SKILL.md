---
name: specs-preview-interaction
description: Use when driving the Lens Studio preview with hand actions — Pinch / Hover / Poke / Drag / Gesture / Release / Rotate / Wait — to trigger buttons, manipulate objects, compose multi-step interaction sequences, or verify Lens behavior end-to-end. Specs-only (requires SIK). For scene queries and visual capture, use the preview-inspection skill.
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Preview Interaction

Drive the Lens Studio preview with `PreviewInteractTool` — a synthetic puppet hand that fires SIK trigger events (`onTriggerStart`, `onTriggerEnd`, etc.) against Interactable components. Discover targets and verify state changes via the **`preview-inspection`** skill (`QueryRuntimeSceneTool`, `CaptureRuntimeView`).

**Scope:** `PreviewInteractTool` targets Specs previews and requires the Spectacles Interaction Kit (SIK) — the hand actions are SIK-driven and do not apply to mobile/camera Lens Studio projects.

**Lens-side setup:** The Lens must include the `AiPreviewAgentInteract.lspkg` package (which depends on `AiPreviewAgentInspect.lspkg`) with both `AgentInspectScript` and `AgentInteractScript` components on the same SceneObject. Without `AgentInteractScript`, interaction commands fail with `unknown_command`.

## Tool

| Tool | Purpose |
|------|---------|
| `PreviewInteractTool` | Drive the preview with hand actions (`Pinch`, `Hover`, `Poke`, `Drag`, `Gesture`, `Release`, `Rotate`) and `Batch`. `Wait` is a batch-only sub-action. Accepts optional `previewName` and `timeoutMs` (default 8000). |

Target interactions with `uniqueId` (for interactable objects) or `worldPosition` (for coordinate-based interactions in free space). Use `QueryRuntimeSceneTool` from the `preview-inspection` skill to discover interactables, read state, and explore the scene hierarchy.

## Workflow

After discovery and inspection (see the `preview-inspection` skill), the interact-verify-recover loop is: call `PreviewInteractTool`, then on success verify with `QueryRuntimeSceneTool` or `CaptureRuntimeView`; on error handle by `reason` and retry.

## Quick Reference

| Action | Call | Key Argument |
|--------|------|--------------|
| Trigger button | `PreviewInteractTool(action: "Pinch")` | `uniqueId` |
| Poke (extended-finger push) | `PreviewInteractTool(action: "Poke")` | `uniqueId` |
| Long-press | `PreviewInteractTool(action: "Pinch", durationMs: 2000)` | `uniqueId`, `durationMs` |
| Drag object | `PreviewInteractTool(action: "Drag")` | `uniqueId`, `worldPosition` |
| Pick up object | `PreviewInteractTool(action: "Pinch", hold: true)` | `uniqueId` |
| Rotate held | `PreviewInteractTool(action: "Rotate")` | `handType`, `rotation: {x,y,z}` |
| Release held | `PreviewInteractTool(action: "Release")` | `handType` |
| Throw object | `PreviewInteractTool(action: "Drag", releaseMidDrag: true)` | `uniqueId`, `worldPosition` |
| Batch sequence | `PreviewInteractTool(action: "Batch", actions: [...])` | `actions` |
| Pinch + drag + release | `Batch: [Pinch(hold:true), Drag, Release]` | — |
| Pinch in space | `PreviewInteractTool(action: "Pinch", hold: true)` | `worldPosition` |
| Draw/move in space | `PreviewInteractTool(action: "Drag", hold: true)` | `worldPosition` |

## Interaction Tips

- **Name-based lookup as fallback:** For dynamically spawned objects with unstable UIDs, use `name` + `parentName` parameters instead of `uniqueId`. The tool will resolve the object at call time.
- **`resolvedUniqueId` in responses:** When a `CommandSuccess` response is returned from a name-based lookup, it includes a `resolvedUniqueId` field containing the UID that was actually used. Save this for subsequent calls within the same session to avoid repeated name resolution.
- **Pinch vs. Poke:** Both fire `onTriggerStart` / `onTriggerEnd` on a target, but SIK uses a different trigger pathway for each. Use `Pinch` for pickup/manipulation interactables (typical `targetingMode: Direct/Indirect`) and for `PinchButton` UI. Use `Poke` for buttons/UI whose `targetingMode` includes `Poke` or `All` — extended-finger push, no pinch. If a `Poke` target times out on `onTriggerStart` while `Pinch` works on the same object, the interactable's `targetingMode` doesn't include Poke; that's expected SIK gating, not a tool failure.

## Targeting

Two ways to target interactions:

**Interactable-targeted** (`uniqueId`): For objects with an Interactable component. Validates clipping, obstruction, enabled state. Discover targets via the `preview-inspection` skill (`QueryRuntimeSceneTool` with `hasComponents: ["Interactable"]`).

**Coordinate-targeted** (`worldPosition`): For free-space interactions. No validation — the hand goes directly to world coordinates. Read positions via `QueryRuntimeSceneTool { transform { worldPosition } }` or specify coordinates directly.

When to use which:
- Button press, slider, draggable object → `uniqueId`
- Drawing, free-space gestures, spatial detection → `worldPosition`
- Moving an interactable to a position → both (`uniqueId` for the object, `worldPosition` for the destination)

## Hand State

Each hand (left/right) is either **free** or **holding** an object. Every response includes `handState` showing both hands — you never need to track state yourself.

### Hold and Release

Pass `hold: true` on Pinch or Drag to keep the pinch engaged. The hand stays holding until you call `Release`.

```
1. Pinch(uniqueId: "cube", hold: true)                                  → right holding cube
2. Drag(uniqueId: "cube", worldPosition: ..., hold: true)               → cube moved, still held
3. Rotate(handType: "right", rotation: {x:0, y:90, z:0})               → cube rotated 90° yaw
4. Release(handType: "right")                                            → cube released
```

### Throw

Use `releaseMidDrag: true` on Drag to release the pinch while the hand is still moving. The object inherits the hand's velocity.

```
1. Drag(uniqueId: "ball", worldPosition: {x:20,y:10,z:0}, durationMs: 300, releaseMidDrag: true)
```

### Drawing / Free-Space

Pinch and move in empty space using `worldPosition`. Lenses that track hand position (e.g., drawing Lenses) react automatically.

```
1. Pinch(worldPosition: {x:0, y:10, z:-50}, hold: true)                 → pinch in space
2. Drag(worldPosition: {x:20, y:10, z:-50}, hold: true, durationMs: 1000) → draw line
3. Drag(worldPosition: {x:20, y:20, z:-50}, hold: true, durationMs: 500)  → continue drawing
4. Release(handType: "right")                                             → stop
```

### Two-Handed

Each hand operates independently. Use `handType: "left"` or `"right"` to target a specific hand.

```
1. Drag(uniqueId: "panel", worldPosition: ..., handType: "left", hold: true) → left holds panel
2. Pinch(uniqueId: "button", handType: "right")                              → right taps button
3. Release(handType: "left")                                                  → panel released
```

### Compatibility

| Action | Free hand | Holding same object | Holding different object |
|--------|-----------|---------------------|-------------------------|
| Pinch | Yes | Error | Error |
| Hover | Yes | Error | Error |
| Poke | Yes | Error | Error |
| Drag | Yes | Yes (continues drag) | Error |
| Rotate | Error | Yes | Error |
| Release | Error | Yes | Error |
| Gesture | Yes | Error | Error |

When an action conflicts with the current hand state, the error message tells you exactly what's held and suggests either `Release` or using the other hand.

## Batch

Use Batch when a sequence is known in advance. Fail-fast: execution stops at the first sub-action that errors.

**Shape:** `PreviewInteractTool(action: "Batch", actions: [...])`. Each item is a full atomic-action object. Sub-actions cannot be `"Batch"` (no nesting).

**Example** — drag an interactable to a point with a throw release:

```json
{
  "action": "Batch",
  "actions": [
    {"action": "Pinch", "uniqueId": "<id>", "hold": true},
    {"action": "Drag", "worldPosition": {"x": 10, "y": 0, "z": -5}, "releaseMidDrag": true}
  ]
}
```

**Success response** — `{success: true, action: "Batch", stepCount: N, handState}`.

**Failure response** — execution aborts at `failedAtIndex`; `skippedSteps` is the un-executed tail. Resolve the `reason`, release any held hand (check `handState`), then re-issue from `failedStep` + `skippedSteps`. See `references/batch-recovery.md` for the full field list and recovery checklist.

**Wait — settle step between batch actions.** Use sparingly: only when a UI element you are about to interact with has just been enabled/revealed by a prior step and may need a frame or two to settle (common with SIK-backed buttons and sliders that appear in response to state changes). Insert a Wait *before each* interaction whose target was revealed by the previous step — a single flow often needs more than one. Symptom of a missing Wait: `Timed out waiting for onTriggerStart for "<target>"` on the step that follows the reveal. Typical values: 200–500 ms. Not valid outside a Batch. Capped at 10000 ms — exceeding the cap returns an error rather than silently clamping.

Example — tap a path option to reveal a slider, drag the slider to reveal a launch button, then tap launch (Wait before both revealed targets):

```json
{
  "action": "Batch",
  "actions": [
    {"action": "Pinch", "uniqueId": "<pathOption>"},
    {"action": "Wait", "durationMs": 300},
    {"action": "Pinch", "uniqueId": "<sliderKnob>", "hold": true},
    {"action": "Drag", "uniqueId": "<sliderKnob>", "worldPosition": {"x": 5, "y": 0, "z": 0}, "hold": true},
    {"action": "Release", "handType": "right"},
    {"action": "Wait", "durationMs": 300},
    {"action": "Pinch", "uniqueId": "<launchButton>"}
  ]
}
```

**When to use Batch vs. atomic calls:**

- **Use Batch** when the sequence is known in advance and you don't need to inspect intermediate state (e.g., pinch-hold → drag → release; hover → drag; drag → rotate → release).
- **Use atomic calls** when you need to inspect state between steps (e.g., `QueryRuntimeSceneTool { sceneObject(uniqueId) { ... } }` to decide what to do next).

## Multiplayer / Connected Lenses Sessions

Multiplayer Lenses (Connected Lenses / SyncKit) only sync once **every** preview window has joined the session. The **Multiplayer** join button is an **in-lens SpectaclesUIKit element rendered inside the runtime** — each preview window draws its own copy. So you join the session the same way you trigger any other button: with `PreviewInteractTool` (`Pinch` or `Poke`), **once per preview window**.

**Before interacting with or verifying a multiplayer Lens:**

1. Click the **Multiplayer** button in **every** open preview window — discover it per window and trigger it with `PreviewInteractTool`, passing `previewName` so each call lands in the right window. Clicking it in only one window is the most common mistake: a single un-joined window means that participant never connects and its synced state never appears.
2. Only after all windows have joined will SyncTransform / synced objects exist and converge across previews. Re-discover (UIDs differ per window and may change after joining) before driving the actual Lens interactions.

If synced objects are missing, a participant's actions don't propagate, or `not_found` keeps coming back for objects that should be spawned by another player, the most likely cause is an un-joined preview window — **not** a tool failure. Don't keep retrying the Lens interactions; first confirm you've triggered **Multiplayer** in every preview window (one `Pinch`/`Poke` per window via `previewName`), then re-discover and retry.

## Rules

1. **Always discover first.** UIDs change across preview resets. Never cache or guess UIDs. Use the `preview-inspection` skill to discover interactables before triggering them.
2. **Use `parentName` to disambiguate.** Multiple interactables share the name "Background" — `parentName` tells you which is which (e.g., `"Sleek Nose Cone"` vs `"Modern Nose Cone"`).
3. **Read world position before spatial actions.** Use `QueryRuntimeSceneTool` to read `transform { worldPosition }` — don't guess coordinates.
4. **Verify after state changes.** Use `QueryRuntimeSceneTool` for data assertions or `CaptureRuntimeView` for visual verification.
5. **Parallelize independent actions.** Multiple triggers with no dependencies can run in parallel. Cross-preview parallelism is safe.
6. **Never parallelize actions on the same hand.** Two interactions using the right hand will fight. Run sequentially, or use `handType: "left"` for the second.
7. **Always pass `previewName` when multiple preview panels are open.** Without it, interaction commands may hit different preview panels, causing UID lookup failures.
8. **Check `handState` in responses.** It reflects both hands — use it; don't track manually. (Full detail in the Hand State section.)
9. **Release before switching targets.** If the right hand is holding object A, you can't interact with object B using the same hand. Release first or use the left hand.

## Error Recovery

Interaction errors return a `reason` field. Handle by reason:

| Reason | Meaning | Recovery |
|--------|---------|----------|
| `clipped` | Target is outside a scroll view's visible bounds | Drag the ScrollBar or ScrollView to reveal it, then retry |
| `obstructed` | Another object is physically blocking the target | Report to user — may need scene reorganization |
| `not_found` | No interactable with that uniqueId | Re-run the discovery query — UIDs may have changed after a preview reset |
| `disabled` | Interactable exists but is disabled | Skip, or check if a prior action should have enabled it |
| `interactor_busy` | Hand is currently holding an object or mid-interaction | Check `handState` in the error response. Release the held object first, or use the other hand. |
| `unknown_command` | The lens-side AgentInteractScript is not installed | Add `AiPreviewAgentInteract.lspkg` and `AgentInteractScript` to the Lens scene |
| `INTERNAL_ERROR` | Lens-side exception, often surfaces as "Timed out waiting for onTriggerStart" on SIK Interactables — known issue, side-effects can land before the timeout | Do not blindly retry uniqueId-targeted SIK actions (they may double-apply); fall back to coordinate-targeted (`worldPosition`) actions or report the failure |

## Scroll View Pattern

Items inside a scroll view may be clipped. The pre-flight validator catches this instantly. To interact with a clipped item:

1. Find the ScrollBar or ScrollView interactable in the same container via `QueryRuntimeSceneTool`
2. Read its current `transform { worldPosition }`
3. `Drag` the scroll bar to reveal the target
4. Retry the original interaction

## Common Mistakes

- **Reusing UIDs after preview reset** — re-query via the `preview-inspection` skill.
- **Parallel triggers on scroll view items.** They fight over the hand and timeout. Go sequential.
- **Ignoring `parentName`** — multiple interactables share the same name.
- **Ignoring error reasons.** A `clipped` error is actionable — scroll first. A generic timeout tells you nothing.
- **Joining the multiplayer session in only one preview window.** See the Multiplayer / Connected Lenses Sessions section — one un-joined window stalls the whole session.
- **Expecting different positions on SyncTransform objects.** Multiplayer-synced objects converge across previews — the last write wins. Stagger interactions to observe each preview's effect independently.
- **Trying to interact on a Snapchat (non-Specs) Lens.** `PreviewInteractTool` requires SIK; it has no equivalent on mobile/camera previews.
