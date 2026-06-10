<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Audio Generator — Script Setup & Preflight

Shared by `build-music` and `build-sfx`. Replace `<SCRIPT_NAME>` with `gen_music_<name>` or `gen_sfx_<name>` as appropriate.

## Writing the generator script

The generator script lives at `<PROJECT_ROOT>/tempAssetGen/<SCRIPT_NAME>.js`. It's a one-shot regenerator — previous contents are never useful to preserve. **Always clear it before writing**, otherwise the second invocation in a fresh agent session trips the Write tool's read-first guard (Write refuses to overwrite an existing file unless it was Read in the current session).

```bash
mkdir -p <PROJECT_ROOT>/tempAssetGen
rm -f <PROJECT_ROOT>/tempAssetGen/<SCRIPT_NAME>.js
```

Then Write the new script content. Skipping the `rm -f` is the #1 cause of a re-run failing with *"File has not been read yet. Read it first before writing to it."*

## Preflight & Verification (MANDATORY)

This skill shells out to `node` and writes a `.wav` to disk. When `node` is missing or the script silently writes to the wrong directory, the asset is never picked up by the Lens.

**Before running Node:**

1. Probe the binary — `node --version`. If it fails, return `status: "NODE_MISSING"`.
2. Lint the generation script for the relative-path footgun:
   ```bash
   grep -nE "PROJECT_ASSETS_SFX *= *['\"]\\./" <PROJECT_ROOT>/tempAssetGen/<SCRIPT_NAME>.js && echo "RELATIVE_PATH_BUG" || true
   ```
   If it prints `RELATIVE_PATH_BUG`, rewrite with an absolute `PROJECT_ASSETS_SFX` before running.

**After running Node:**

3. Non-zero exit → return `status: "NODE_FAILED"` with last 30 lines of stderr.
4. Verify the WAV exists at the expected absolute path and is non-empty:
   ```bash
   test -s <PROJECT_ROOT>/Assets/GeneratedSFX/<name>.wav && stat -f%z <PROJECT_ROOT>/Assets/GeneratedSFX/<name>.wav
   ```
   If missing or 0 bytes, return `status: "WAV_MISSING"`.

## CRITICAL: Output Path Rules

Every generated WAV MUST land at `<PROJECT_ROOT>/Assets/GeneratedSFX/<name>.wav` (the same folder for both `build-music` and `build-sfx` — the Lens treats them as one asset directory). Always construct the output path as an absolute path; never pass a relative string.

```js
const PROJECT_ASSETS_SFX = '<ABSOLUTE_PATH_TO_PROJECT>/Assets/GeneratedSFX';
fs.mkdirSync(PROJECT_ASSETS_SFX, { recursive: true });
WavBuilder.write(render(), path.join(PROJECT_ASSETS_SFX, '<name>.wav'));
```
