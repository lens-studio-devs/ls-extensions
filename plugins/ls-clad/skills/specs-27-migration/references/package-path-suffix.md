<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Package Path Suffix Migration

Lens Studio packages historically lived in a bare folder (e.g.
`Assets/SpectaclesInteractionKit/`). Newer package releases install into a
`.lspkg`-suffixed folder (`Assets/SpectaclesInteractionKit.lspkg/`). When a
project is updated, the on-disk folder is renamed but user code that imports via
the old path breaks with:

```
error TS2307: Cannot find module '../../SpectaclesInteractionKit/Components/...' or its corresponding type declarations.
```

This is **not** a Spectacles (2024) → SPECS 27 API change — it surfaces any time
a project's installed packages migrate to the `.lspkg` layout. The fix is a
mechanical find-and-replace, but you need to scope it carefully so you don't
double-suffix files that already use the new form, or accidentally edit the
package's own internal imports.

## Detection

### 1. Enumerate `.lspkg` directories actually present in the project

```bash
find Assets -maxdepth 4 -name "*.lspkg" -type d
```

Each result tells you a real package directory name. Common ones:

- `Assets/SpectaclesInteractionKit.lspkg`
- `Assets/SpectaclesUIKit.lspkg`
- `Assets/SpectaclesSyncKit.lspkg`
- `Assets/Spectacles 3D Hand Hints.lspkg` (note the spaces)
- `Assets/Prefabs/Remote Service Gateway.lspkg`

For each `<Name>.lspkg`, the bare name to scan for is `<Name>`.

### 2. For each name, find bare-name imports in user code only

The grep should:

- Match import / require / dynamic-import strings referencing `<Name>/` (with
  the trailing slash so it's clearly a path segment, not a bare class
  identifier).
- Exclude paths that already say `<Name>.lspkg/` (those are already correct).
- Exclude files inside the package itself (`Assets/<Name>.lspkg/...`) — those
  are package internals; do not modify them.

```bash
grep -rnE "(from|import|require)[[:space:]]*\(?[[:space:]]*[\"'][^\"']*<Name>/" Assets \
  --include="*.ts" --include="*.js" \
  | grep -v "<Name>.lspkg/" \
  | grep -v "Assets/<Name>.lspkg/"
```

Note: when `<Name>` contains spaces (e.g., `"Spectacles 3D Hand Hints"`), quote
the bare name in the regex and remember that import strings will use the same
spacing.

### 3. Collapse to a unique file list

```bash
... | awk -F: '{print $1}' | sort -u
```

This gives you the set of user files that need editing.

## Fix

For each `<Name>` with hits, run a string replacement of `<Name>/` →
`<Name>.lspkg/` across the affected files.

Before doing the replace, **verify no file already contains a mix of both
forms** — otherwise the second pass over an already-fixed line could produce
`<Name>.lspkg.lspkg/`:

```bash
find Assets/Scripts -type f \( -name "*.ts" -o -name "*.js" \) \
  -exec grep -q "<Name>/" {} \; \
  -exec grep -lE "<Name>\.lspkg/" {} \;
```

If this returns nothing, the project is in a clean state and the global replace
is idempotent.

Apply with `find … -exec sed -i`:

```bash
find Assets/Scripts -type f \( -name "*.ts" -o -name "*.js" \) \
  -exec grep -q "<Name>/" {} \; \
  -exec sed -i '' "s|<Name>/|<Name>.lspkg/|g" {} \;
```

`sed` flags vary by platform — the example above is BSD/macOS (`-i ''`).
On GNU sed, drop the empty-string argument: `sed -i "s|...|...|g"`.

## Verify

After the replace:

1. **Bare-name greps should return 0 hits** in user code (still expect hits
   inside the package itself, which is fine):

   ```bash
   grep -rnE "<Name>/" Assets/Scripts --include="*.ts" --include="*.js" \
     | grep -v "<Name>.lspkg/"
   ```

2. **Recompile TypeScript** via the `RecompileTypeScriptTool` MCP tool and
   confirm `TS2307` errors for those module specifiers are gone.

If the recompile produces *new* error categories that weren't visible before
(e.g., `TS2339: Property 'X' does not exist on type 'Y'`), that's expected: the
broken import paths were short-circuiting type-checking, and once the paths
resolve, real API drift becomes visible. See `sik-api-drift.md` and
`custom-fields-on-packages.md` for those follow-ups.

## When to skip

If the project has no `.lspkg` folders, this reference does not apply. Some
older projects may use Lens Studio's "External Imports" mechanism instead — in
that case the package lives outside `Assets/` and this reference's scoping
rules still hold, but the `<Name>.lspkg` folder will be wherever the project
references it from.
