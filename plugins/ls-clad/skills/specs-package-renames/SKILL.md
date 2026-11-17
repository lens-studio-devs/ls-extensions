---
name: specs-package-renames
description: >
  Specs package names from Lens Studio 5.25 (SpectaclesInteractionKit -> InteractionKit, UIKit,
  SyncKit). Read before installing, importing or updating a Specs package. Use for 'SIK not
  found', duplicate packages, failing imports, old vs new names.
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Specs package renames (Lens Studio 5.25+, packages version 4.0.0)

From **Lens Studio 5.25** every Specs package is published on one aligned **4.0.0** line, and
the packages dropped their `Spectacles` / `Specs` prefix. This is the largest rename the Specs
packages have had and it affects the frameworks every Specs Lens uses (InteractionKit, UIKit,
SyncKit). **Any skill that installs, imports, detects or updates a package must apply the rules
below.** The other skills still mention some legacy names; read them through this table.

## Name table

| 4.0 name (Lens Studio 5.25+) | Published before 4.0 as |
|---|---|
| `InteractionKit` (IK) | `SpectaclesInteractionKit` (SIK) |
| `UIKit` | `SpectaclesUIKit` |
| `SyncKit` (SSK) | `SpectaclesSyncKit` |
| `InteractionKitExamples` | `SpectaclesInteractionKitExamples` |
| `HandHints3D` | `Spectacles3DHandHints`, `Specs3DHandHints` |
| `NavigationKit` | `SpectaclesNavigationKit`, `SpecsNavigationKit` |
| `ShaderLibrary` | `SpectaclesShaderLibrary`, `SpecsShaderLibrary` |
| `RemoteServiceGateway` | `Remote Service Gateway` |
| `SurfacePlacement` | `Surface Placement` |
| `InteractableHelper` | `Interactable Helper` |
| `MarkerTrackingHelper` | `Marker Tracking Helper` |
| `Icons` | (unchanged; some projects carry a local copy named `SpecsIcons`) |

Unchanged names: `Motion`, `Leaf`, and the other packages not listed.

**Renamed inside the packages too (4.0):**

| Legacy | 4.0 |
|---|---|
| InteractionKit prefab `Prefabs/SpectaclesInteractionKit.prefab`, scene object `SpectaclesInteractionKit` | `Prefabs/InteractionKit.prefab`, scene object `InteractionKit` |
| SyncKit prefab `SpectaclesSyncKit.prefab`, scene object `SpectaclesSyncKit` | `SyncKit.prefab`, scene object `SyncKit` (hierarchy paths start `SyncKit / …`) |
| API entry `SIK.ts`, export `SIK` (`SIK.InteractionManager`, `SIK.HandInputData`, …) | `IK.ts`, export `IK` (`IK.InteractionManager`, `IK.HandInputData`, …); `SIK.ts` no longer exists. Import below. |
| `SIKLogLevelProvider` | `IKLogLevelProvider` (`IK.IKLogLevelProvider`) |

The IK entry import, legacy vs 4.0:

```ts
// legacy (SpectaclesInteractionKit 2.x / 3.x)
import {SIK} from "SpectaclesInteractionKit.lspkg/SIK"
// 4.0 (InteractionKit, Lens Studio 5.25+)
import {IK} from "InteractionKit.lspkg/IK"
```

In a legacy project keep the legacy spellings; in a 4.0 project use the 4.0 ones. Code that
imports `SIK` from an `InteractionKit.lspkg` folder does not compile.

**Abbreviations:** InteractionKit 4.0 is `IK` (its README and the `IK` export); `SIK` names the
legacy package. SyncKit keeps `SSK`. Engine modules such as `SpectaclesKitModule` are not renamed.

**Not published for 5.25:**
- `LSTween`: animate with Lens Studio's native animation (`AnimationCurve` → `AnimationPlayer`,
  see `lens-api` → `references/animation-playback.md`).
- `Leaderboard`: use the leaderboard example in `SnapCloudExamples`.

## Rules

1. **One package, two names.** An installed package under *either* name in the table counts as
   installed. Match names **exactly** (case and spaces ignored, and a trailing ` <n>` such as
   `UIKit 2` is Lens Studio's name for a second copy). Never match by substring:
   `InteractionKitExamples` is not `InteractionKit`.
2. **Never install a second copy.** If the legacy package is installed, do not install the 4.0
   package beside it. Two copies of one framework break the compile and the scene. Keep using
   the legacy package (rule 5).
3. **Imports follow the installed package.** The import prefix is the installed package's folder
   name: `SpectaclesInteractionKit.lspkg` / `SpectaclesUIKit.lspkg` in a legacy project,
   `InteractionKit.lspkg` / `UIKit.lspkg` / `SyncKit.lspkg` in a 4.0 project. The IK entry point
   follows too (`SIK` from `SIK` in legacy, `IK` from `IK` in 4.0), and so do prefab and scene
   object names. Before writing an import or a hierarchy path, check which line the project is
   on. Never mix the two in one project.
4. **New 5.25 projects use the 4.0 names.** Install `UIKit` first: UIKit 4.0 brings
   InteractionKit, Motion and Icons as its dependencies. Then check InteractionKit is present
   before installing it separately.
5. **Never update a legacy package in place.** A Pull Update on a legacy package swaps in the
   4.0 package under the legacy file name and crashes Lens Studio
   (`/update-lens-packages` blocks it). By default keep the legacy packages, build on them, and
   tell the user the project is on the legacy line. Move a project to 4.0 only when the user
   asks, in this order:
   1. Remove each legacy package file with `/update-lens-packages` → `actions/remove-package.ts`
      (`packageFile: "SpectaclesUIKit.lspkg"`, then `SpectaclesInteractionKit.lspkg`, and so on).
   2. Install the 4.0 packages per rule 4 (`/ensure-package-installed`, `UIKit` first).
   3. Rewrite the project's scripts with the name table: `.lspkg` import prefixes, `SIK` → `IK`
      (entry `IK.ts`, `SIKLogLevelProvider` → `IKLogLevelProvider`).
   4. Rename prefab instances and scene-object paths (`SpectaclesInteractionKit` →
      `InteractionKit`, `SpectaclesSyncKit / …` → `SyncKit / …`).
   5. Recompile and fix until the compile is clean, then run the Lens and check the logs.
6. **Report the names you saw.** When a build or check involves packages, say which name and
   version is installed (for example "SpectaclesUIKit 2.1.1, legacy name"), so the user knows
   which line the project is on.

## Quick checks

- Installed packages: the project's `Packages/` folder (packed `.lspkg` files) and any unpacked
  `Assets/*.lspkg` folder. Compare against the table, not against one spelling.
- Duplicate copies: two entries that map to the same 4.0 name (for example `SpectaclesUIKit`
  and `UIKit`, or `UIKit` and `UIKit 2`). Stop and report them; do not add a third.
- Lens Studio version: 5.25 or later means the 4.0 line is the one the Asset Library serves.
