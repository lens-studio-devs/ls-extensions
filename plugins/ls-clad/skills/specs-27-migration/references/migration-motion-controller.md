<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Migration: Motion Controller

**When this applies:** any match for `MotionController` in the project scan.

The `MotionControllerModule` API signatures do not change, but mobile phone will no longer be
available as a motion controller on SPECS 27. BLE controllers replace it. Lenses must detect
and notify users when no motion controller is connected.

## Detection Patterns

- `MotionController`

**Always filter out matches inside `.lspkg/` directories** — those are package-internal
uses (most commonly SIK's `Assets/SpectaclesInteractionKit.lspkg/Providers/MobileInputData/`)
and do not represent a lens-level dependency on a motion controller. The package owns its
own migration via `syncVersions()` in Step 2.

```bash
grep -rn "MotionController" Assets --include="*.ts" --include="*.js" \
  | grep -v "\.lspkg/"
```

If no matches remain after filtering, this migration does not apply — the Lens uses
interaction APIs (e.g., SIK `Interactable` / hand-tracking) that abstract over the
controller. Report this to the user and move on.

## Migration Steps

### Check for existing handling

Search for `isControllerAvailable` in the matched files. If the Lens already handles the
`false` case with user-facing feedback, no changes are needed. Report this to the user and move on.

### Recommend adding unavailable-controller UX

If the Lens does NOT handle the unavailable case, show the user this recommendation:

```js
let controller = motionControllerModule.getController(options);
controller.onControllerStateChange.add(function() {
    if (!controller.isControllerAvailable()) {
        // Show user notification: "Please connect a controller"
        // The specific UX depends on the lens - use a Screen Text or UI overlay
    }
});
```

**Do NOT auto-insert this code.** Ask the user:
1. Where in their Lens the notification should appear
2. What UI element they want to use (Screen Text, UI overlay, etc.)
3. Whether they want a persistent indicator or a one-time prompt

This is UX logic that varies per Lens and requires the user's design input.
