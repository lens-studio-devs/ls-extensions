<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Curated Font Catalog — Specs & Lens Studio

A short-list of Google Fonts families that work well for Specs UI and Lens text. Use these as defaults when the user's description is vague — they all render cleanly at world-space sizes, have wide weight ranges, and are free + open-licensed for embedding in Lens projects.

Every name below is the exact case-sensitive `family` parameter accepted by the `FontSelector` MCP tool. Copy directly.

## Sans-serif — general UI, body, labels

| Family | Character | Use for |
|---|---|---|
| **Inter** | Neutral grotesque, tall x-height, screen-optimized | Default UI body, labels, captions. Top pick when you have no other signal. |
| **Manrope** | Geometric, modern, slightly rounded terminals | Friendly product UIs, onboarding, tutorial copy |
| **Sora** | Geometric humanist, tech-forward | Sci-fi, product-launch theming |
| **Plus Jakarta Sans** | Modern, slightly condensed | Dense HUDs where Inter feels wide |
| **DM Sans** | Geometric, friendly | Cards, panels, tooltips |
| **Nunito** | Rounded sans, warm | Kids' Lenses, casual cartoon themes |
| **Quicksand** | Light rounded geometric | Playful, soft, low-stakes mood |
| **Work Sans** | Industrial grotesque | Utility UIs, settings panels |

## Serif — editorial, elegant, narrative

| Family | Character | Use for |
|---|---|---|
| **Playfair Display** | High-contrast didone, dramatic | Title cards, hero text, fashion/luxury themes |
| **Lora** | Calligraphic serif, balanced | Body text in narrative Lenses, journals |
| **Merriweather** | Sturdy slab-leaning serif | High-legibility body at small sizes |
| **EB Garamond** | Classical book serif | Period themes, historical/literary content |
| **Cormorant Garamond** | Refined, thin contrast | Cinematic / editorial title overlays |
| **Source Serif 4** | Modern transitional | Documentation, dense info panels |

## Display — titles, hero text, signage

| Family | Character | Use for |
|---|---|---|
| **Bebas Neue** | Tall, condensed, all-caps feel | Title cards, score callouts, action verbs |
| **Anton** | Heavy condensed sans | Sports/competitive themes, bold posters |
| **Oswald** | Condensed, semi-classical | News/headline aesthetic |
| **Archivo Black** | Heavy geometric | Single-word emphasis, large hero stats |
| **Black Ops One** | Stencil military display | Tactical / FPS / military themes |
| **Bungee** | Blocky urban signage | Street art, graffiti, urban themes |
| **Righteous** | Geometric retro display | Retro futurism, 70s/80s feel |

## Handwriting — playful, casual, personal

| Family | Character | Use for |
|---|---|---|
| **Caveat** | Casual marker hand | Sticker-style annotations, doodles |
| **Kalam** | Notebook hand | Journal Lenses, personal storytelling |
| **Permanent Marker** | Bold sharpie | Bold callouts, "NEW!" stickers |
| **Patrick Hand** | Friendly print hand | Kids, education, casual notes |
| **Indie Flower** | Loopy script | Whimsical, romantic moods |
| **Dancing Script** | Connected calligraphic | Wedding, celebration, ornate signage |
| **Shadows Into Light** | Loose marker | Casual annotation overlays |

## Monospace — HUDs, numerics, tech

| Family | Character | Use for |
|---|---|---|
| **JetBrains Mono** | Crisp, large x-height, ligatures available | Score / timer / numeric HUDs. **Default monospace choice.** |
| **Roboto Mono** | Geometric, neutral | Code blocks, telemetry overlays |
| **Space Mono** | Quirky geometric, retro-futurist | Sci-fi terminals, retro tech themes |
| **IBM Plex Mono** | Industrial, slightly humanist | Enterprise / dashboard feel |
| **Fira Code** | Programmer's mono, ligature-rich | Code display, syntax callouts |
| **Major Mono Display** | Mono-styled display, all-caps | Stat callouts, tech labels (NOT body) |
| **Press Start 2P** | True pixel 8-bit | Retro arcade, NES-era game themes |
| **VT323** | Old CRT terminal | Retro computer / hacker aesthetic |

## Specs-specific picks by surface

| Surface | Default family | Why |
|---|---|---|
| **Score / Timer HUD** | `JetBrains Mono` (weight 500–600) | Tabular figures — `9` and `10` share width, no jitter on increment |
| **Hero / Title card** | `Bebas Neue` or `Archivo Black` | Reads at distance (z = -110 cm); condensed display dominates the viewport |
| **Body labels (settings, dialog copy)** | `Inter` (weight 400–500) | Highest x-height + neutral character; legible at 18–24 LS units |
| **Button labels** | `Inter` (weight 600) | Slightly heavier than body for tap affordance |
| **Tooltip / caption** | `Inter` (weight 400) at smaller size | Same family as body to keep one typographic voice |
| **Cartoon / kids Lens** | `Nunito` or `Quicksand` | Rounded terminals soften the UI mood |
| **Sci-fi / futuristic** | `Sora` or `Space Mono` | Geometric, technical feel |
| **Retro arcade** | `Press Start 2P` | Pixel character matches 8-bit theme |
| **Editorial / cinematic** | `Playfair Display` for titles, `Lora` for body | Two-font pairing — high contrast title + readable serif body |

## Pairing rule of thumb

A typical Specs UI needs **at most 2 families**:
- One **display/title** family (heavy, distinctive)
- One **body/UI** family (neutral, high legibility)

Never mix three. If a numeric HUD also needs monospace, that's still 2 families overall (the numeric mono is a tightly-scoped third role — keep it isolated to the HUD container, not body labels).

Common safe pairings:
- `Bebas Neue` (display) + `Inter` (body)
- `Playfair Display` (titles) + `Lora` (body)
- `Archivo Black` (hero) + `Manrope` (UI)
- `Bungee` (signage) + `DM Sans` (UI)
- `Sora` (titles) + `Inter` (body)

## When NOT to use a font from this list

- The user explicitly named a different family (e.g., "use Comic Sans") — defer to their pick. Search for it first to confirm it exists in Google Fonts; if not, surface that and ask for a closest-match.
- The theme is genuinely unusual (e.g., calligraphic Arabic, Devanagari, CJK-primary content). Google Fonts has strong non-Latin support — search with `query` rather than picking from this English-Latin-focused short list.
- A pre-existing Lens Studio project already has a font convention. Read the existing `Assets/Fonts/` directory first; don't introduce a new family if one is already in use.
