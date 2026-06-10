---
name: ensure-package-installed
description: Verifies a Lens Studio package is installed and installs it from the Asset Library if missing. Supports any package including SpectaclesUIKit and SpectaclesInteractionKit. When installing SpectaclesUIKit, also ensures SpectaclesInteractionKit is present first (UIKit depends on SIK). Use when a workflow depends on a specific Lens Studio package.
user-invocable: true
arguments:
  - name: package_name
    description: "Name of the package to ensure is installed (e.g., SpectaclesUIKit, SpectaclesInteractionKit)"
    required: true
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

## Step 1: Handle Dependency Order

If `package_name` is `"SpectaclesUIKit"` (or contains `"UIKit"`):
- Run this entire skill first with `package_name = "SpectaclesInteractionKit"` before proceeding (UIKit depends on SIK)

## Step 2: Check Installed Packages

Use `ListInstalledPackagesTool` with `includeDetails: false` to get all installed packages.

Scan the results for a case-insensitive substring match against `package_name`.

If a match is found → report "already installed" and exit successfully.

## Step 3: Search the Asset Library

If not installed, use `SearchLensStudioAssetLibrary` with:
- `query`: the `package_name` value
- `type`: `"Package"` (if the tool supports type filtering)

Identify the correct result from the search by matching the package name. Extract its URI or identifier.

## Step 4: Install the Package

Use `InstallLensStudioPackage` with the URI obtained from the search result.

## Step 5: Verify Installation

Use `ListInstalledPackagesTool` again and confirm the package now appears in the list.

## Completion

Report:
- Package name
- Whether it was already installed or newly installed
- Installation status (success or failure)
- If failure: the search results found, and a suggestion to install manually via Window > Asset Library in Lens Studio
