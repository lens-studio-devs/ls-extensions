<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Sync All Packages to Compatible Versions (bounded-polling snippet)

Used by Step 2 of `SKILL.md`. `syncVersions()` is fire-and-forget / asynchronous: it
dispatches all upgrades and returns `undefined` immediately, with downloads and descriptor
updates happening in the background over tens of seconds. A naïve `before = listPackages();
syncVersions(); after = listPackages();` in a single synchronous block shows **no changes**
because the work hasn't completed yet.

Run this in one `ExecuteEditorCode` call. It snapshots `before`, fires `syncVersions()`,
then polls until the asset state has been stable for a few consecutive ticks (or hits a
hard timeout). The inline comments below encode hard-won async-settling logic that prevents
both false-no-op exits and premature exits — preserve them.

```typescript
const registry = pluginSystem.findInterface(Editor.IPackageRegistry.interfaceId) as any;
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

const before = listPackages();
registry.syncVersions();

// syncVersions() is async — poll until the snapshot stops changing.
const POLL_MS = 1000;
const SETTLE_TICKS = 10;           // consecutive identical snapshots AFTER a change = settled
const NO_CHANGE_GRACE_MS = 45_000; // if NOTHING ever changes, only treat as a no-op after this
const MAX_WAIT_MS = 180_000;       // hard ceiling
const start = Date.now();
// Seed `last` from the PRE-sync snapshot, not a fresh post-dispatch read: syncVersions()
// is async and a fast state transition could otherwise be baked into `last`, hiding the
// change and stalling the full no-change grace instead of settling quickly.
let last = JSON.stringify(before);
let stable = 0;
let sawChange = false;
while (Date.now() - start < MAX_WAIT_MS) {
  await new Promise(r => setTimeout(r, POLL_MS));
  const cur = JSON.stringify(listPackages());
  if (cur === last) {
    stable++;
    // Only trust "settled" once we've actually observed the registry change. A slow
    // initial download (tens of seconds with no change yet) must NOT be mistaken for
    // stability. A genuine no-op (already up to date) still exits — but only after the
    // no-change grace period, not after SETTLE_TICKS.
    if (sawChange && stable >= SETTLE_TICKS) break;
    if (!sawChange && Date.now() - start >= NO_CHANGE_GRACE_MS) break;
  } else {
    sawChange = true;
    stable = 0;
    last = cur;
  }
}

const after = listPackages();
return { before, after, waitedMs: Date.now() - start };
```

Set `timeoutMs` on the `ExecuteEditorCode` call to at least `200_000` so the poll loop
(up to `MAX_WAIT_MS`) has headroom.
