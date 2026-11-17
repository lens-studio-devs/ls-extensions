---
name: update-lens-packages
description: Update outdated packages/libraries (IK/SIK, UIKit, SyncKit/SSK) in a Lens Studio project via the Editor API. Use for 'update my packages', 'upgrade IK', 'upgrade SIK', 'update dependencies', 'pull latest SIK', or any package update ask. Requires Lens Studio MCP.
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Update Lens Studio Packages

Updates installed packages in a Lens Studio project to the latest available versions by default, via per-package `pullUpdate(desc)`, with version-pinning via `selectVersionFromAssetLibrary` when a specific version is needed — all executed through canonical, path-backed `ExecuteEditorCode` actions.

## Background

Lens Studio projects use `.lspkg` packages for libraries like InteractionKit (IK), UIKit (UIKit), and SyncKit (SSK). These packages are managed through the `Editor.IPackageRegistry` interface, which provides methods to check for and apply updates.

> **Scope:** this skill is the task-level entry point for *updating* installed libraries. For the broader package toolkit — installing, unpacking, inspecting internals, and authoring `.lsc`/`.lspkg` packages — see [`lens-package-toolkit`](../lens-package-toolkit/SKILL.md).

There are two update mechanisms:

1. **Pull Update** (default) — Updates a package to the newest version Lens Studio has already cached (the local library and Asset Library entries it has fetched).

2. **Version Selection from Asset Library** — Fetches the Asset Library afresh and selects a specific version (what the Package Manager's "Select Version" does). Use this when the user requests a specific version, or when `canPullUpdate` is `false` and a newer version may exist.

> **Renamed packages (Lens Studio 5.25, 4.0.0).** A package under a legacy name (`SpectaclesInteractionKit`, `SpectaclesUIKit`, `SpectaclesSyncKit`, …) is on the pre-4.0 line. The update action never pulls updates for these (it reports them in `blockedLegacy`): an in-place update crashes Lens Studio. Tell the user the project is on the legacy line; move it to 4.0 only when they ask, with the migration in `/specs-package-renames` rule 5. After any update, check that each package is installed once.

## Workflow

### ExecuteEditorCode actions

Each action is an EEC async-function body, not a TypeScript module. Invoke it by absolute `path`
with the listed JSON `args`; never read it into an inline `code` call. The actions receive only
ordinary JSON and re-find package descriptors, Asset Library assets, and resources inside Lens
Studio.

### Step 1: List installed packages and check for updates

Run the canonical action by absolute path:

```text
ExecuteEditorCode
  path: <absolute path to this skill>/actions/list-installed-packages.ts
  args: {}
```

To list selected names only, pass `args: { packageNames: ["InteractionKit", ...] }`.
The action returns `{ name, id, version, canPullUpdate }` records. Track packages across an update by `id`: a package's name can change when it is updated.

Present the results to the user. Highlight any packages where `canPullUpdate` is `true` — these have updates available.

### Step 2: Update packages via Pull Update

For each package the user wants to update (or all updatable ones if they said "update everything"), run `pullUpdate`:

Set `timeoutMs` on the `ExecuteEditorCode` call to `300000` when running the update
loop; the default 30s timeout can be too short for several packages or slow connections.

```text
ExecuteEditorCode
  path: <absolute path to this skill>/actions/pull-package-updates.ts
  timeoutMs: 300000
  args: { packageNames: ["InteractionKit", ...] }
```

To update every installed package that has a Pull Update candidate, pass
`args: { updateAll: true }`. The two modes are exclusive. The action snapshots live descriptors
before updating, then returns `{ updated: string[], unavailable: string[], blockedLegacy: string[] }`;
`unavailable` names had no Pull Update candidate, `blockedLegacy` names are legacy Specs packages it
did not touch. It re-finds descriptors on each action invocation, so never pass a
descriptor through `args`.

### Step 3: Verify the update

`pullUpdate` returns before Lens Studio applies an Asset Library update; the swap lands a few seconds later. Re-run the Step 1 listing, matching packages by `id`. If a package still shows its old version, re-run the listing again as a separate `ExecuteEditorCode` call, up to three times. Never wait inside `ExecuteEditorCode` (`setTimeout` there hangs the call).

### Step 4: Report results

Tell the user which packages were updated and their old/new versions. For a package with `canPullUpdate` `false`, run the version search below: Pull Update sees only cached versions, so the Asset Library may still have a newer one. Report `blockedLegacy` packages as on the legacy line (see the renamed-packages note).

## Version Selection from Asset Library (advanced)

If the user asks to update to a specific version, or if `canPullUpdate` is false but they believe a newer version exists, use the Asset Library search approach.

### Search for available versions

```text
ExecuteEditorCode
  path: <absolute path to this skill>/actions/search-asset-library-versions.ts
  args: { packageName: "InteractionKit" }
```

The action fetches the Public Production Asset Library afresh and returns each matching asset's
`assetId`, `assetName`, and `resources`. Each resource represents a version (the `name` field is
the Lens Studio version it targets, and the URI filename contains the package version, e.g.,
`InteractionKit.v4.0.0.lspkg`).

### Apply a specific version

Once the user picks a version, run this canonical action. Keep `timeoutMs: 300000` because version
selection can download package data from the CDN:

```text
ExecuteEditorCode
  path: <absolute path to this skill>/actions/select-asset-library-version.ts
  timeoutMs: 300000
  args:
    packageName: "InteractionKit"
    versionSelector: "v4.0.0"
    assetName: "InteractionKit" # optional; defaults to packageName
```

`versionSelector` must uniquely match one resource URI. The action re-finds the installed
descriptor and fetches the matching Asset Library asset/resources immediately before calling
`selectVersionFromAssetLibrary`; never pass prior search objects through `args`.

## Important Notes

- This skill requires the Lens Studio MCP connection (the `ExecuteEditorCode` MCP tool — tool naming, deferred schemas, and ask/spawn semantics: see `lens-studio-field-notes` Hard Rule 2 / Cross-runtime orchestration). If the tool isn't available, the user needs to have Lens Studio open with the project loaded.
- Asset Library searches require the user to be logged into their Snapchat account in Lens Studio. If searches fail with gRPC errors, suggest they log in via Menu Bar > My Lenses > Login.
- Use a longer `ExecuteEditorCode` timeout (typically `timeoutMs: 300000`) for update loops and version selection; `selectVersionFromAssetLibrary` downloads from the CDN.
- Always verify updates by re-listing packages (Step 3).
