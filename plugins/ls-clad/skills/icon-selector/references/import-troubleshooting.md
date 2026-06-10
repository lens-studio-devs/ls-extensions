<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Icon Import Troubleshooting

**After importing, verify the output exists and is a valid PNG:**

```bash
# Must exist and be a PNG (not an LFS pointer or empty file)
file Assets/Icons/<name>.png        # Expect: "PNG image data, NNN x NNN"
wc -c < Assets/Icons/<name>.png     # Expect: > 1000 (sanity check for LFS pointer / truncated write)
```

If verification fails:
- **File missing** → the tool failed silently. Re-read the tool result for an `errors` field. Most likely the icon name was misspelled — pick an alternative from the curated catalog.
- **File is tiny (<500 B) text** → likely a git-lfs pointer (see LFS gotcha below). Not a tool failure.
- **File is `XML`/`SVG`** → should not happen with the current tool; if you see it, the consumer repo has stale committed `.svg` files from an older import pipeline. Delete them.

**LFS gotcha (consumer repo):** If the target Lens Studio project's `.gitattributes` sends `Assets/**/*` through git-lfs, the small icon PNGs get stored as LFS pointers. On a fresh clone without `git lfs pull`, `requireAsset` loads the pointer text and the icon appears corrupted. Add `Assets/Icons/*.png !filter !diff !merge` to the consumer repo's `.gitattributes` so icon PNGs are stored inline.
