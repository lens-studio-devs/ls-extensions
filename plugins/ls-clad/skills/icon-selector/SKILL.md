---
name: icon-selector
description: Search curated Google Material Icons catalog to find the right icon for Specs UI, then import via IconSelector MCP tool. Use when building UI that needs icons.
user-invocable: true
argument-hint: description of the icon needed — for example close button, settings gear, or play button
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

Search the curated catalog (`references/material-icons-curated.md`); return the exact name. If multiple icons fit, suggest 2-3 with brief reasoning.

## Importing Icons

**ALWAYS use the `IconSelector` Lens Studio MCP tool to import icons.** The tool rasterizes the Material Symbol to a PNG inside Lens Studio, imports it through the asset pipeline, generates the `.meta` file, and makes it available to `requireAsset()`.

**FIRST — resolve the tool (once per session).** Tool naming, deferred schemas, and ask/spawn semantics: see `lens-studio-field-notes` Hard Rule 2 / Cross-runtime orchestration. Do not fall back to `curl` — files placed on disk without `.meta` files are invisible to Lens Studio and `requireAsset()` will fail.

Once loaded, call it with just the name — all appearance and size params have sane defaults:

```
IconSelector({ name: "close" })
```

**Defaults the tool applies** (Specs-recommended): `style: "Rounded"`, `weight: 600`, `fill: false`, `grade: 0`, `opticalSize: 24`, `color: "#ffffff"`, `size: 512`. **Don't pass appearance overrides unless you have a specific reason** — the asset filename gets a suffix when any value differs from default (e.g. `home_outlined_wght400.png` instead of `home.png`), which breaks `requireAsset("../Icons/<name>.png")` lookups in `/specs-build-ui`. If you do override, communicate the resulting filename to the caller.

**`size` is optional.** Valid values: `256, 384, 512, 768, 1024`. The default (`512`) is the right choice for Specs UI. Use `256` only if you specifically need a smaller texture; use `768`/`1024` only for hero icons where pixel density matters. `size` does NOT affect the filename — the most recent call wins for a given `name + appearance`.

**One call per icon.** Call once per icon — do not batch.

Icons are imported to `Assets/Icons/<name>.png` automatically by the MCP tool.

If an icon appears missing or corrupted after import, see `references/import-troubleshooting.md`.

**If `IconSelector` itself fails or returns no usable asset** (after the one-retry gate in `lens-studio-field-notes` Hard Rule 5), do not re-issue the call repeatedly. Fall back to a text or emoji glyph on the element (or omit the icon), continue the build, and note the substitution in your report. Decide this from the tool result alone — never from an assumption about the runtime or environment. **Only `requireAsset` a path `IconSelector` actually produced** (it imports to `Assets/Icons/<name>.png`, loaded as `requireAsset("../Icons/<name>.png")`). **Never hand-type a package-catalog path such as `Icons.lspkg/Iconography/<Category>/<name>.png`** — those are guesses at the package's internal layout, fail at load with `Failed to resolve dependency …`, and the compiler cannot catch it because `requireAsset` returns `any`. A missing icon degrades to a text glyph, never to a guessed package path.

## Loading Icons in Code

```typescript
const MY_ICON: Texture = requireAsset("../Icons/icon_name.png") as Texture
```

## Using Icons with UI Components

UIKit 4.0 API (`addContentToElement` from UIKit's `Scripts/Components/Content/ElementContentFactory`); button construction, themes and initialization order are owned by `/specs-build-ui` (`references/uikit-4.0.md`). Icon **size** is a live property on the returned `ElementContent` (one cm number), never a factory option — passing `leadingIconSize` to `addContentToElement` is a compile error.

With ElementContent for labeled buttons or list items:

```typescript
const content = addContentToElement(obj, {text: "Settings", leadingIcon: MY_ICON})
content.leadingIconSize = 2.8
```

For icon-only buttons, use the Round shape:

```typescript
button.setVariant({theme: "System3", shape: "Round", style: "Primary"})  // before init
button.size = new vec3(6, 6, 1)
button.initialize()
const content = addContentToElement(obj, {leadingIcon: MY_ICON, iconLayout: "left"})
content.leadingIconSize = 2.8
```

## SPECS Icons package (installed with UIKit 4.0)

UIKit 4.0 requires the companion `Icons` package (SPECS Iconography 3.0 PNGs under `Iconography/<Category>/`). UIKit's built-in controls resolve it internally; its catalog paths are not a consumer contract. For any icon in your own content, import it with `IconSelector` (or fall back to a text glyph); never `requireAsset` a typed `Icons.lspkg/...` path or rely on Inspector drag-and-drop.
