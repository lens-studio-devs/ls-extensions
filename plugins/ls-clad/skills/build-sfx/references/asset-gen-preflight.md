<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Asset Generator Script Setup & Preflight

Shared steps for `build-sfx` and `build-music` generator scripts.

## Writing the generator script

The generator script lives at `<PROJECT_ROOT>/tempAssetGen/gen_sfx_<name>.js`. It's a one-shot regenerator — previous contents are never useful to preserve. **Always clear it before writing:**

```bash
mkdir -p <PROJECT_ROOT>/tempAssetGen
rm -f <PROJECT_ROOT>/tempAssetGen/gen_sfx_<name>.js
```

Then Write the new script content. Skipping the `rm -f` is the #1 cause of a re-run failing with *"File has not been read yet. Read it first before writing to it."*

## Preflight & Verification (MANDATORY)

This skill shells out to `node` and writes a `.wav` to disk. When `node` is missing or the script silently writes to the wrong directory, the asset is never picked up by the Lens.

**Before running Node:**

1. Probe the binary — `node --version`. If it fails, return `status: "NODE_MISSING"`.
2. Lint the generation script for the relative-path footgun:
   ```bash
   grep -nE "PROJECT_ASSETS_SFX *= *['\"]\\./" <PROJECT_ROOT>/tempAssetGen/gen_sfx_<name>.js && echo "RELATIVE_PATH_BUG" || true
   ```
   If it prints `RELATIVE_PATH_BUG`, rewrite with an absolute `PROJECT_ASSETS_SFX` before running.

**After running Node:**

3. Non-zero exit → return `status: "NODE_FAILED"` with last 30 lines of stderr.
4. Verify the WAV exists at the expected absolute path and is non-empty:
   ```bash
   test -s <PROJECT_ROOT>/Assets/GeneratedSFX/<name>.wav && stat -f%z <PROJECT_ROOT>/Assets/GeneratedSFX/<name>.wav
   ```
   If missing or 0 bytes, return `status: "WAV_MISSING"`.

## Output Path Rules (shared)

Always construct the output path as an absolute path using a `PROJECT_ASSETS_SFX` variable. Never pass a relative string like `'Assets/GeneratedSFX/foo.wav'` — it resolves against `process.cwd()`.

```js
const PROJECT_ASSETS_SFX = '<ABSOLUTE_PATH_TO_PROJECT>/Assets/GeneratedSFX';
fs.mkdirSync(PROJECT_ASSETS_SFX, { recursive: true });
WavBuilder.write(render(), path.join(PROJECT_ASSETS_SFX, '<name>.wav'));
```
