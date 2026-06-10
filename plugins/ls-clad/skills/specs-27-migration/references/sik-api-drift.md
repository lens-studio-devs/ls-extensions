<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# SpectaclesInteractionKit API Drift

Between roughly SIK 0.13 and SIK 0.18, several public APIs on `Interactable`
were renamed or removed. When a project upgrades SIK and recompiles, these
surface as:

```
error TS2339: Property 'X' does not exist on type 'Interactable'.
```

This is **not** a Spectacles (2024) → SPECS 27 API change — it's normal package
churn that happens whenever SIK ships breaking renames. Applying the mappings
below before any deeper migration work keeps the compile green so subsequent
errors are meaningful.

## Detection

After updating packages and fixing any bare-name import paths (see
`package-path-suffix.md`), recompile via the
`RecompileTypeScriptTool` MCP tool. Any `TS2339` on a property of
`Interactable` (or another SIK type) is a candidate.

Filter for SIK-specific errors:

```
TS2339: Property '<prop>' does not exist on type 'Interactable'
TS2339: Property '<prop>' does not exist on type 'Interactor'
TS2339: Property '<prop>' does not exist on type 'InteractableManipulation'
```

Then match each `<prop>` against the table below.

## Known mappings

### Interactable — events

The old SIK exposed several event aliases (`onClick`, `onHoverIn`,
`onHoverOut`) and a function-call shorthand (`xxx.onClick(cb)`). The aliases
and the shorthand are gone. Use the canonical event names with `.add(...)`.

| Old API                              | New API                                  | Notes |
|---                                   |---                                       |---|
| `interactable.onClick.add(fn)`       | `interactable.onTriggerEnd.add(fn)`      | `onClick` was an alias for trigger-end. |
| `interactable.onClick(fn)`           | `interactable.onTriggerEnd.add(fn)`      | The "function-call" shorthand was removed; use `.add()`. |
| `if (interactable.onClick)`          | `if (interactable.onTriggerEnd)`         | Truthy checks on the event itself (rare). |
| `interactable.onHoverIn.add(fn)`     | `interactable.onHoverEnter.add(fn)`      | |
| `interactable.onHoverOut.add(fn)`    | `interactable.onHoverExit.add(fn)`       | |

### Interactable — state queries

Boolean "am I being interacted with right now?" flags were replaced by
`InteractorInputType` bitmask getters. The new value is `0` (`None`) when
nothing is interacting, non-zero otherwise — so a truthy check works without
importing the enum.

| Old API                              | New API                                  | Notes |
|---                                   |---                                       |---|
| `interactable.isClicking`            | `interactable.triggeringInteractor`      | Truthy check works because `InteractorInputType.None = 0`. |
| `interactable.isHovering`            | `interactable.hoveringInteractor`        | Same pattern. |
| `interactable.isSecondaryClicking`   | `interactable.secondaryTriggeringInteractor` | Same pattern. |

If you want strict comparison, import `InteractorInputType` from
`<sik>/Core/Interactor/Interactor` and write
`interactable.triggeringInteractor !== InteractorInputType.None`.

### Adding new mappings

If a `TS2339` error mentions a property not in the table above, search SIK
itself for the new name:

```bash
grep -nE "^[[:space:]]*(get[[:space:]]+[a-zA-Z0-9_]+|on[A-Z][a-zA-Z0-9_]+|public[[:space:]]+[a-zA-Z0-9_]+)" \
  Assets/SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable.ts
```

Common renames follow these patterns:

- `isFoo` boolean → `fooingInteractor: InteractorInputType` (or
  `fooState`-style getter)
- `onFooStart` / `onFooEnd` aliases → `onTriggerStart` / `onTriggerEnd` /
  `onDragStart` / `onDragEnd` etc.
- A property that has no obvious match in the new API was probably a
  user-attached custom field, not an SIK API — see
  `custom-fields-on-packages.md`.

If after exhausting the table and grepping SIK source you can't find a
replacement, stop and tell the user. Some old APIs were removed without a
direct replacement (e.g., features rolled into different components).

## Apply

Once a mapping is known, do a scoped find-and-replace across user code only
(do **not** edit files inside `Assets/SpectaclesInteractionKit.lspkg/`).

Pattern A — event-style call (most common):

```bash
find Assets/Scripts -type f \( -name "*.ts" -o -name "*.js" \) \
  -exec sed -i '' "s|\.onClick\.add|.onTriggerEnd.add|g" {} \;
```

Pattern B — function-call shorthand. The trailing `(` is what disambiguates
this from event-style; the closing paren and arguments are unchanged:

```bash
... -exec sed -i '' "s|\.onClick(|.onTriggerEnd.add(|g" {} \;
```

Pattern C — bare-word reference (e.g., `if (interactable.onClick)` truthiness
check). Use a regex that won't match an event-style call (no `.add` and no
following `(`):

```bash
... -exec sed -E -i '' "s#\.onClick([^a-zA-Z0-9_(]|\$)#.onTriggerEnd\1#g" {} \;
```

(Apply A → B → C in that order to avoid double-rewriting.)

## Verify

1. Re-run the grep for the old name in user code — should be zero (excluding
   comments is optional but harmless):

   ```bash
   grep -rnE "\.<oldName>([^a-zA-Z0-9_]|$)" Assets/Scripts --include="*.ts" --include="*.js"
   ```

2. Recompile TypeScript. The specific `TS2339` errors for that property should
   be gone.

3. Confirm no *new* errors were introduced. If they appear, they were likely
   already latent on the new SIK API and are unrelated to this rename — check
   `custom-fields-on-packages.md` next.
