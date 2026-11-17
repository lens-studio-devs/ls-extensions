---
name: ensure-package-installed
description: Verifies a Lens Studio package is installed, installs it from the Asset Library if missing, and returns the installed descriptor and version. Use when a workflow depends on a specific Lens Studio package.
user-invocable: true
arguments:
  - name: package_name
    description: "Name of the package to ensure is installed (e.g., UIKit, InteractionKit)"
    required: true
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

## Step 1: Check Installed Packages

Use `ListInstalledPackagesTool` with `includeDetails: false` to get all installed packages.

Compare `package_name` against each package's canonical descriptor name and
display name using an **exact case-insensitive match**. Never use a substring
match: similarly named examples, forks, and companion packages may all be
installed at once.

Also match the package's **other name** from `/specs-package-renames` (Lens Studio 5.25
renamed the Specs packages, e.g. `SpectaclesUIKit` -> `UIKit`). A package installed under its
legacy name counts as installed: record it and skip to Step 4. Never install the 4.0 package
beside its legacy copy. Treat a trailing ` <n>` (`UIKit 2`) as a second copy of the same
package and report it.

- Exactly one match: record its descriptor identity as "already installed" and
  skip to Step 4.
- More than one exact match: stop and report the ambiguous descriptors; do not
  choose one by list order.
- No exact match: continue to Step 2.

## Step 2: Search the Asset Library

If not installed, use `SearchLensStudioAssetLibrary` with:
- `query`: the `package_name` value
- `type`: `"Package"` (if the tool supports type filtering)

Apply the same exact case-insensitive name match to the search results. Continue
only when exactly one result matches; otherwise report the missing or ambiguous
results. Record its URI/identifier and descriptor identity for verification.

## Step 3: Install the Package

Use `InstallLensStudioPackage` with the selected result's URI as `packageUri`
and its canonical display name as `assetName`, following the loaded tool schema.
Do not put the display name in `packageUri`.

## Step 4: Verify Installation

Use `ListInstalledPackagesTool` with `includeDetails: false` and select the exact
descriptor identity recorded above. Fail if it is absent or ambiguous; do not
fall back to a fuzzy name match.

Return the matched package descriptor and installed version to the calling
workflow. The calling skill owns how the package is used; it confirms symbols
in the installed declarations under `Cache/TypeScript/Src/Packages/` (read-only).

When the installed version is older than the line the calling skill targets
(for example a pre-4.0 Specs package in a Lens Studio 5.25 project), report it
and follow `/specs-package-renames`. Update only on the user's confirmation,
through [`update-lens-packages`](../update-lens-packages/SKILL.md); never update
silently or replace a version the user is deliberately on.

## Completion

Report:
- Package name
- Installed version
- Whether it was already installed or newly installed
- Installation status (success or failure)
- If failure: the search results found, and a suggestion to install manually via Window > Asset Library in Lens Studio
