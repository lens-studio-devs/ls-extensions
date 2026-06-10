# Batch Failure Fields and Recovery Checklist

When a `Batch` call fails, the response includes:

- `failedAtIndex` — index of the failing step (0-based)
- `failedAction` — the action type that failed (e.g., `"Drag"`)
- `failedStep` — the full input of the failing step, echoed back
- `completedStepCount` — how many steps succeeded before the failure
- `skippedSteps` — the un-executed tail (steps after the failure)
- `handState` — what each hand is holding now
- `error` + `reason` — the lens-side error (or `reason: "timeout"` / `"transport_error"` for MCP-layer failures)

## Recovery Steps

1. **Do not re-issue steps `0..failedAtIndex-1`.** They already executed.
2. Check `handState`. If a hand is **holding** something, a prior step (Pinch-hold or Drag-hold) succeeded and the hand is still engaged. Issue a single `Release` before retrying so the retry doesn't fail with `interactor_busy`.
3. Fix the underlying cause of `failedStep`'s failure (look at `reason` — `not_found`, `clipped`, `disabled`, `obstructed`, etc.; use the Error Recovery table in SKILL.md for specific actions).
4. Issue a new `Batch` call containing `failedStep` followed by `skippedSteps` (or call them atomically if you now want to inspect state between them).
