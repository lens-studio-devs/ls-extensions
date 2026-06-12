<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Pull Update All Packages

Used by Step 2 of `SKILL.md` when the migration needs an inline fallback instead of
invoking the `update-lens-packages` skill. Prefer the skill for normal package-update
requests; this snippet mirrors its pull-update flow for every installed package that
advertises an available update.

Run this in one `ExecuteEditorCode` call. It snapshots `before`, calls
`registry.pullUpdate(desc)` for each descriptor where `registry.canPullUpdate(desc)` is
true, then snapshots `after` for reporting. `pullUpdate` is synchronous/blocking but may
take time while package assets are downloaded and updated, so set `timeoutMs` on the
`ExecuteEditorCode` call to `300000` before running this loop. No task-manager wait or
polling loop is needed before reading `after`; the call returns after each update has
completed.

```typescript
const registry = pluginSystem.findInterface(
  Editor.IPackageRegistry.interfaceId
) as Editor.IPackageRegistry;
const model = pluginSystem.findInterface(Editor.Model.IModel.interfaceId) as Editor.Model.IModel;

function listPackages() {
  const out: {name: string, version: string, canPullUpdate: boolean}[] = [];
  for (const asset of model.project.assetManager.assets) {
    if (asset.getTypeName() === "NativePackageDescriptor") {
      const desc = asset as any;
      out.push({
        name: desc.packageName,
        version: desc.version
          ? `${desc.version.major}.${desc.version.minor}.${desc.version.patch}`
          : "(none)",
        canPullUpdate: registry.canPullUpdate(desc),
      });
    }
  }
  return out;
}

function versionString(desc: Editor.Assets.NativePackageDescriptor) {
  return desc.version
    ? `${desc.version.major}.${desc.version.minor}.${desc.version.patch}`
    : "(none)";
}

const before = listPackages();

const descriptors: Editor.Assets.NativePackageDescriptor[] = [];
for (const asset of model.project.assetManager.assets) {
  if (asset.getTypeName() === "NativePackageDescriptor") {
    descriptors.push(asset as Editor.Assets.NativePackageDescriptor);
  }
}

const attempted: {name: string, fromVersion: string}[] = [];
for (const desc of descriptors) {
  if (registry.canPullUpdate(desc)) {
    attempted.push({ name: desc.packageName, fromVersion: versionString(desc) });
    registry.pullUpdate(desc);
  }
}

const after = listPackages();
return { before, attempted, after };
```

Report `before` vs `after` as a table. If `attempted` is empty, no installed package
advertised a pull update. If a package still has `canPullUpdate: true` in `after`, report
it explicitly before continuing the migration.
