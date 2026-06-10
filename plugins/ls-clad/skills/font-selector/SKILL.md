---
name: font-selector
description: Search the Google Fonts catalog by style/mood and import/apply font assets to Text/Text3D components in a Lens Studio project. Use when adding typography to a UI panel, theming text to match a mood, or applying a specific font family by name.
user-invocable: true
argument-hint: a description of the font feel (e.g., "modern clean sans-serif for game HUD", "playful handwriting for kids Lens") or an exact family name (e.g., "Roboto", "Playfair Display")
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Font Selector

Search the Google Fonts database for a font matching the user's description, then import the family into the active Lens Studio project as a `Font` asset and (optionally) apply it to Text / Text3D components on a target SceneObject.

Backed by the `FontSelector` MCP tool — it handles network fetch, asset import, `.meta` generation, and live application to text components inside Lens Studio. Tool naming, deferred schemas, and ask/spawn semantics: see `lens-studio-field-notes` Hard Rule 2 / Cross-runtime orchestration.

## When to invoke

Not auto-invoked by any orchestrator. Typography is a discretionary asset — if you want a themed font in an experience built by `specs-experience-builder`, run `/font-selector` yourself (before or after the build), then re-invoke `/specs-build-ui` with the imported path as `theme_font_path` so the generated UI module bakes the `requireAsset(...) as Font` reference.

## Two-step workflow: search → import (apply optional)

> **When the next step is regenerating a UI module via `/specs-build-ui`,** use Step 2 in import-only mode (omit `sceneObjectId`) and pass the imported path to `/specs-build-ui` as `theme_font_path`. The script's `requireAsset(...) as Font` becomes the source of truth and the runtime `t.font = THEME_FONT` assignment wins. Inspector apply (`sceneObjectId` passed in) is for ad-hoc swaps in an already-generated UI; if you Inspector-apply a font that doesn't match what `<Name>UI.ts` `requireAsset`s, the font reverts on the next reload.

### Step 1: Search

When the user gives a description (not an exact family name), search the catalog. Search returns up to 10 fonts per page with a **visual preview image** showing each font rendering a pangram — use this to compare candidates by eye, not just by name.

```
FontSelector({ query: "modern clean sans-serif", category: "sans-serif" })
```

| Parameter | Notes |
|---|---|
| `query` | Free-text search across name, style descriptors, and mood (e.g., "elegant serif", "playful handwriting", "tech monospace"). Required for search mode. |
| `category` | Optional. One of: `sans-serif`, `serif`, `display`, `handwriting`, `monospace`. Use when the user signaled a category — e.g., "monospace for the score" → `category: "monospace"`. Omit when the description is general ("modern, clean"). |
| `page` | Optional, 1-indexed. Use when the first 10 results don't include a fit and the response indicates more pages. |

**Pick by visual fit, not vibes alone.** The pangram preview is the source of truth — letter shapes, weight, x-height, geometric vs humanist character. If the user said "futuristic" and the top result is a humanist sans, scroll the preview list before applying.

If the user gave an exact family name (e.g., "Roboto", "Playfair Display", "JetBrains Mono"), **skip search** — jump straight to Step 2.

### Step 2: Apply / import

Call with `family` to download the font, import it as a Lens Studio `Font` asset, and apply it to text components.

```
FontSelector({ family: "Inter" })
```

| Parameter | Notes |
|---|---|
| `family` | Exact family name as returned by search (or as named in Google Fonts). Case-sensitive — `"Open Sans"`, not `"open sans"`. |
| `sceneObjectId` | Optional UUID. The font is applied to **every** `Text` / `Text3D` component found inside that SceneObject's subtree. If omitted, applies to the currently selected text components. |
| `category` | Optional, used to disambiguate when multiple families share a name. Rarely needed. |

**Three apply modes:**

1. **Targeted apply** — pass `sceneObjectId` of a UI root or HUD container. Best when the orchestrator already knows the UUID (Phase 3 bootstrap returns it). Recursive: every nested `Component.Text` / `Component.Text3D` under that root gets the new font.
2. **Selection apply** — omit `sceneObjectId`; the user pre-selects the target text components in the Scene Hierarchy panel. Best for ad-hoc tweaks during interactive sessions.
3. **Import only** — omit `sceneObjectId` and ensure no text components are selected. The font asset is downloaded and imported but nothing is rewired. Useful when a script will reference the font via `requireAsset(...)` and you just need the file on disk.

## Verifying the import

After Step 2, confirm the asset landed and reflect the actual filename in any downstream `requireAsset` calls. The MCP tool typically writes to `Assets/Fonts/<Family>.ttf` (spaces become underscores or are preserved — check the tool response). The tool response includes the imported asset path; verify the filename matches before using it in `requireAsset` calls.

If verification fails:
- **File missing** → re-read the tool result for an `errors` field. Most commonly the family name was misspelled (case mismatch, missing space, e.g., `"OpenSans"` instead of `"Open Sans"`). Re-search to confirm the exact name.
- **Tiny file (< 5 KB plaintext)** → likely a git-lfs pointer in the consumer repo (see LFS gotcha below). Not a tool failure.
- **Schema/validation error on the call itself** → tool-resolution issue, not a tool failure — see the tool-naming pointer at the top of this skill, resolve, and retry.

**LFS gotcha (consumer repo):** if the target Lens Studio project's `.gitattributes` sends `Assets/**` through git-lfs, a fresh clone without `git lfs pull` resolves font assets to pointer text and Lens Studio fails to load them. Add `Assets/Fonts/*.ttf !filter !diff !merge` (and `*.otf` if used) to the consumer repo's `.gitattributes` so font files are stored inline.

## Loading fonts in code

Once imported, reference the font in TypeScript via `requireAsset` and assign it to `Component.Text` / `Component.Text3D`:

```typescript
const HUD_FONT = requireAsset("../Fonts/Inter.ttf") as Font;

const label = obj.createComponent("Component.Text") as Text;
label.font = HUD_FONT;
```

Rules:
- Use the path returned by the tool — do NOT hardcode `"Inter.ttf"` if the actual file is `"Inter-Regular.ttf"` or `"Inter Variable.ttf"`. Read the tool response.
- The `as Font` cast is required — `requireAsset` returns the base asset type.
- If multiple Text components in the scene should share one font, declare `HUD_FONT` once at module scope and assign by reference. No need to re-`requireAsset` per component.

## Theme-driven font picking

When the caller provides a theme (style, mood, palette) — for example the Specs orchestrator's `theme` block — derive the search `query` from `mood + style + intended surface` (e.g., `mood: tense, gritty sci-fi` → `"industrial wide condensed, mechanical futuristic"`, `category: display`). For quick surface-to-family picks, see `references/font-catalog.md` → **Specs-specific picks by surface**.

**Score/timer HUDs in particular** want a monospace family — non-monospace digits change width as the value updates (`9` → `10` → `99`), causing the label to jitter or reflow. Even if `theme.style` is humanist, override to monospace for purely-numeric HUDs.

## Anti-patterns

- **Downloading the font via `curl` / `wget`** and dropping a `.ttf` into `Assets/Fonts/` manually. The Lens Studio asset pipeline needs the `.meta` file the MCP tool generates — a hand-placed file is invisible to the project and `requireAsset` fails with `InternalError: Cannot find asset`. Always go through the MCP tool.
- **Calling `family:` with a hallucinated name.** Google Fonts has ~1500 families; "Modern Sans" and "Tech Mono" sound plausible but don't exist. Search first when in doubt — the visual preview both confirms the family exists and shows what it looks like.
- **Applying the same font to every text component in the scene without thinking about hierarchy.** A score HUD wants monospace; a title card wants display; body text wants legible sans. If the experience has multiple typographic roles, do one apply per role (or pass a tighter `sceneObjectId` per region) — don't blast one family across the whole UI subtree.
