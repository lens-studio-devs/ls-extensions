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

## Loading Icons in Code

```typescript
const MY_ICON: Texture = requireAsset("../Icons/icon_name.png") as Texture
```

## Using Icons with UI Components

With ElementContent for labeled buttons or list items:

```typescript
this.content(obj, {leadingIcon: MY_ICON, ...})
```

For icon-only buttons, use the Round shape:

```typescript
this.btn(obj, "Primary", "Round", 6, 6)
this.content(obj, {leadingIcon: MY_ICON, iconLayout: "left", leadingIconSize: 2.8})
```
