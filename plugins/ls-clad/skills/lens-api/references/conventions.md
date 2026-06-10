<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Lens Studio TypeScript — General Conventions

Naming, file organization, Inspector layout decorators, import order, and the small set of `DO NOT`s that apply to every Lens Studio TypeScript file. This covers what works on **any** Lens target.

## Naming & file organization

- **Classes:** PascalCase (e.g. `BlossomController`, `HandFireSystem`).
- **Files:** PascalCase matching the class name — `BlossomController.ts` defines `class BlossomController`.
- **No spaces** in folder or file names — use CamelCase.
- **Location:** project scripts live under `Assets/<ProjectName>/Scripts/`.

## Inspector layout decorators

The `@ui.*` decorators shape how the script's `@input` fields appear in the Lens Studio Inspector. They are TS-preprocessor decorators (not in the runtime d.ts) and work on every Lens Studio target.

| Decorator | Effect |
|---|---|
| `@ui.label('<HTML>')` | Inserts a static label row. HTML allowed for color/size styling. |
| `@ui.separator` | Inserts a horizontal divider |
| `@ui.group_start("Group Name")` | Begins a collapsible group |
| `@ui.group_end` | Ends the current group |

Typical layout pattern — three sections (References, Settings, Logging) demarcated by separators and group blocks:

```typescript
@component
export class MyComponent extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">MyComponent – One-line purpose</span>')
  @ui.separator

  @ui.label('<span style="color: #60A5FA;">References</span>')
  @ui.group_start("References")
  @input
  @hint("What this reference is used for")
  targetObject: SceneObject
  @ui.group_end

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Settings</span>')
  @ui.group_start("Settings")
  @input
  @hint("What this setting does")
  speed: number = 1.0
  @ui.group_end
}
```

## Import order

Three tiers, in this order:

```typescript
// 1. Package imports — anything from .lspkg/ goes first
import { SomePackageThing } from "SomePackage.lspkg/Path/To/Thing"

// 2. Local imports — relative paths from your own scripts
import { MyHelper } from "./MyHelper"

// 3. Lens Studio globals are implicit (no import needed)
// vec3, quat, SceneObject, Material, RenderMeshVisual, etc. are always available
```

## Component scaffold (general)

A starting template that uses only base Lens Studio runtime APIs. SIK / RSG / SyncKit / UIKit imports are documented in their owning skills (`specs-interaction-recipes`, `specs-ai-remote-service`, `specs-sync-kit`, `specs-build-ui`).

```typescript
/**
 * <ComponentName> — <one-line description>
 *
 * Connections:
 * - <list @input wiring>
 *
 * Lifecycle:
 * - onAwake:  bind events, no cross-object access yet
 * - onStart:  validate inputs, initialize
 */
@component
export class ComponentName extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">ComponentName – <short></span>')
  @ui.separator

  // ── Inputs ──────────────────────────────────────
  @ui.label('<span style="color: #60A5FA;">References</span>')
  @ui.group_start("References")
  @input
  @hint("<what this is>")
  targetObject: SceneObject
  @ui.group_end

  // ── Settings ────────────────────────────────────
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Settings</span>')
  @ui.group_start("Settings")
  @input
  @hint("<what this does>")
  speed: number = 1.0
  @ui.group_end

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.onStart())
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  private onStart(): void {
    if (!this.targetObject) {
      console.log('[ComponentName] ERROR: targetObject not assigned')
      return
    }
    this.initialize()
  }

  private onUpdate(): void { /* per-frame */ }

  private initialize(): void { /* main setup */ }
}
```

## DO NOT

- **`var`** — use `const` or `let`.
- **Legacy `print()`** — use `console.log()`/`info()`/`warn()`/`error()`/`debug()` for new code. `print()` still works but carries no severity level and is being phased out across the project. For reading the output, see `ls-clad:lens-log-analysis`.
- **`@input` without `@hint`** — every Inspector field needs a tooltip describing what it controls.
- **Spaces in folder/file names** — breaks `requireAsset` paths and is hard to script around.
- **Imports from framework internals not at a `.lspkg/` boundary** — internal paths can move between versions; only import from package roots that are documented public surface.

## See also

- `lens-api` SKILL.md — component lifecycle, events, Decorator Reference table (`@input` / `@hint` / `@allowUndefined` / `@label`)
- `component-access-patterns.md` — TS-to-TS and TS-to-JS component access
- `ls-clad:ensure-package-installed` — install `.lspkg/` packages (SIK / UIKit / SyncKit / RSG) before importing from them
