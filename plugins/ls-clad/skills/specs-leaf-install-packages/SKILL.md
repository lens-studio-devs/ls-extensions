---
name: specs-leaf-install-packages
user-invocable: true
description: Verifies the LEAF testing framework is installed in a Lens Studio project and installs it if missing. LEAF ships as a single Leaf package in the Asset Library; matches the SIK version on install. Use before writing or running LEAF tests.
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

> **Prefer the `live-lens-tester` (Live Lens Tester)** for end-to-end LEAF workflows. The agent runs this skill as its first step before authoring scenarios. This skill can also be run standalone to install packages without writing tests.

## Prerequisites

This skill requires the **Lens Studio MCP server** for listing, searching, and installing packages. If MCP tools are not available, **stop and report the error** to the user — do not attempt to detect or install packages via shell commands.

## Step 1: Detect installed packages

**Use the Lens Studio MCP tool that lists installed packages** as the primary detection method. Do NOT use shell commands to scan directories — always start with MCP.

LEAF ships as a single package:
- `Leaf` (installs as `Leaf.lspkg`)

### Fallback: check for manually unpacked packages

The package listing tool only finds packages with a registered `NativePackageDescriptor`. Packages that were manually copied into the project won't appear. If no LEAF package is returned, run a secondary check with `Glob`:

```
**/Leaf.lspkg
```

### Decision

If `Leaf` is found, report "LEAF is already installed" and proceed to Step 4 (verify SIK).

If it is missing, continue to Step 2.

## Step 2: Detect SIK version

LEAF depends on `SpectaclesInteractionKit` (required for all interactors; `Bitmoji 3D` is pulled in automatically for IK scenarios).

Check the package listing results for `SpectaclesInteractionKit`.

If SIK is **not installed**:
- Use the `ensure-package-installed` skill to install `SpectaclesInteractionKit` first

If SIK **is installed**, note the version for compatibility.

If the project has an older SIK version and compilation fails due to SIK/LEAF mismatches, **ask the user** whether they want to update SIK. To update, use the MCP package install tool with the SIK package URI and `assetName: "SpectaclesInteractionKit"`. Note that updating SIK might cause new compilation errors in the project that need to be resolved. When resolving errors, do not modify the code in the LEAF or SIK packages — adapt the project code to match the new APIs.

## Step 3: Find and install the LEAF package

Locate the package in the Lens Studio Asset Library by name, then install the most recent version:

1. **Search the Asset Library** with the package-search MCP tool, using `keywordFilter: ["Leaf"]` and `onlyMostRecent: true`. The matching asset is named exactly `Leaf`.
2. **Pick the `Leaf` result** — ignore unrelated matches (decorative leaf assets, segmentation models, etc.). Take the most-recent resource and read its `uri`.
3. **Install** with the package-install MCP tool, passing that `packageUri` and `assetName: "Leaf"` so the directory is created with the correct name and import paths (`Leaf.lspkg/...`) resolve.

If the search returns no `Leaf` asset, **stop and report the error** — suggest the user install LEAF manually from the Lens Studio Asset Library.

## Step 4: Verify installation

List installed packages again via MCP and confirm `Leaf` now appears. Optionally confirm `Leaf.lspkg` exists on disk via `Glob`.

Also search for an existing `LeafIndex` file (`scenariosIndex` keyword). If none exists, inform the user that they'll need one when writing tests (the `specs-leaf-write-scenarios` skill handles this).

## Completion

Report LEAF version installed (or already present), SIK version, whether a LeafIndex exists, and installation status. On failure, suggest manual installation from the Lens Studio Asset Library.
