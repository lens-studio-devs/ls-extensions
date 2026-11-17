---
name: specs-plan-experience
description: >
  Plan a Specs AR experience before assets or scripts are generated — classify
  the tier, then produce the asset manifest, spatial layout plan, and script
  plan. Pure reasoning: no MCP, no scene writes, no code. First step of a Specs
  experience build.
user-invocable: true
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Plan a Specs Experience

This skill turns a Specs build request into a structured plan the rest of the pipeline consumes. It is **pure reasoning** — no asset generation, no scene writes, no MCP calls. It produces three artifacts (asset manifest, spatial layout plan, script plan) plus a classified experience tier.

Classify the experience tier first — it scopes how much doctrine the rest of the build applies. Then break the request into three artifacts.

## Two modes: `plan-assets` first, then `plan`

In the pipeline this skill runs as **two steps**, because the asset wave needs only the manifest and the manifest is decidable minutes before the layout:

- **`plan-assets` mode** — tier + theme + the complete asset manifest, and *nothing else*. This is the front of the build's critical path: the proxy/icon/mesh/sfx/music steps (and the full `plan`) all dispatch the moment it returns, so the mesh backend starts generating earlier than when one step carries everything. Apply the tier section and the Asset Manifest section below (including per-mesh `target_size_cm`, `animate`, and the music derivation); skip spatial layout, script plan, and `ui_api` entirely. Output contract: the `plan-assets` STEP_RESULT payload.
- **`plan` mode (full)** — given the validated `plan_assets` payload as input, carry its `tier`/`theme`/`assets` forward **frozen** — names, types, and `target_size_cm` may never change (proxies are already written to final paths and generations are already running against them; a change breaks path identity and every skeleton pose). A genuinely wrong entry is reported in `deviations[]`, never silently rewritten. Then produce the rest: spatial layout, script plan, `ui_api`, `music_included`. Invoked without a `plan_assets` input (standalone, re-plan, or a legacy handoff), do the whole thing — manifest included — in this one step.

Size the meshes in `plan-assets` from each asset's real-world identity and the tier's scale doctrine, not from the layout you haven't done — the layout then places *given* sizes, which is the natural order anyway (the spatial section below already treats sizes as inputs to containment).

## Experience tier (classify first — scopes the doctrine)

Pick the tier that matches the request; it governs how much `@input` exposure, inspector scaffolding, and file-splitting the build applies. The scaffolding is leverage on experiences that have mechanics to tune — and pure overhead on experiences that don't. Do not apply mechanics-tier machinery to an effect lens.

- **Effect / utility** — one visual effect, filter, generative surface, or single-surface tool with no scored/simulated/balanced state: a drawing pen, a hand-fire effect, a weather readout, a timer, a single AI-chat or media panel. **Lean path:** keep it in as few files as the concern count honestly needs (often one script + at most one UI module), expose only the handful of highest-value presentation knobs, and use minimal inspector ceremony (a header + one Settings group is enough — don't manufacture References/Settings/Debug scaffolding a one-knob effect doesn't warrant). There is **no mechanics/balance family** to expose here — do not invent one.
- **Interactive** — the user drives discrete interactions over modest state: a quiz, a placement/shopping tool, a media browser, a stepper. **Standard path:** split by concern where it earns its keep, expose the presentation opinions plus the few behavior knobs the experience actually has (question count, snap distance, page size), grouped per the inspector convention.
- **Mechanics-driven** — scored, simulated, or balanced gameplay / multi-parameter behavior: a tower defense, a platformer, a dodge arena, a physics sim, a difficulty-curved game. **Full doctrine:** the mechanics/behavior/balance family below applies in full — expose the balance table, difficulty curve, speeds, cooldowns, and thresholds as grouped `@input`s, and split into focused modules.

State the chosen tier in the plan summary (one word: `effect/utility`, `interactive`, or `mechanics-driven`). When genuinely between two tiers, pick the lower one and add a knob only when a concrete tuning need appears — it is cheaper to add a knob than to strip a scene of scaffolding it never needed. The exposure, inspector-presentation, and file-split rules throughout this skill are written for the mechanics-driven tier; the lower tiers apply the same *principles* at lower volume.

## Asset Manifest (drives the asset-generation steps)

Object with `theme` and `assets[]` — the same shape that `/build-mesh`, `/build-sfx`, `/build-music`, `/specs-build-ui`, and `/icon-selector` consume. The `theme` block gets prepended to every mesh description by the `mesh` step for stylistic coherence (the `/build-mesh` skill consumes the prepended string verbatim).

```json
{
  "theme": {
    "style": "stylized cartoon, friendly",
    "palette": "warm earth tones — wood-brown, slate-grey, leafy green, soft light-blue accents",
    "mood": "cheerful, approachable, low-stakes fun"
  },
  "assets": [
    { "type": "mesh", "name": "Platform", "description": "50×2×50cm ground platform seen from above; grass top with stone-brick border; stubby flowers at corners; a low flat slab, not a raised block", "animate": "no", "rest": "flat_on_surface" },
    { "type": "mesh", "name": "Robot", "description": "20cm cartoon robot standing on its feet, friendly and chunky; boxy light_blue torso, white cube head ~1/3 of total height with two black eye blocks and a yellow antenna; brown_boots; idle breathing", "animate": "auto", "rest": "upright" },
    { "type": "sfx", "name": "ButtonClick", "description": "short crisp UI click" },
    { "type": "sfx", "name": "AmbientLoop", "description": "gentle ambient atmosphere, seamless 8-second loop" },
    { "type": "music", "name": "BackgroundMusic", "description": "warm cozy bed for low-stakes cartoon gameplay — soft electric piano comping on I-V-vi-IV in C major, light brushed kick + shaker, no melody lead, ~85 BPM, 24 seconds, peak well under SFX so clicks and impacts stay readable" },
    { "type": "icon", "name": "play_arrow", "description": "start/play button icon" },
    { "type": "icon", "name": "trophy", "description": "score icon" },
    { "type": "ui", "name": "RobotGameUI", "description": "Score HUD, timer, start button, game-over dialog", "elements": [
      { "element": "hud-panel", "name": "scorePanel", "description": "Score display with trophy icon and large number",
        "labels": ["Score", "9,999"], "container": "frame" },
      { "element": "button", "name": "startButton", "description": "Primary capsule 'Start Game' with play icon",
        "labels": ["Start Game"], "container": "frame" },
      { "element": "dialog", "name": "gameOverDialog", "description": "Game over panel with final score and Play Again button, starts hidden",
        "labels": ["Game Over", "Final Score: 9,999", "Play Again"], "container": "frame" }
    ]}
  ]
}
```

**Authoring rules:**

- **Pull theme `style`/`palette`/`mood` from the user's original request** — don't flatten to generic boilerplate. Do NOT inject "voxel" / "blocky" / "pixel" into `theme.style` unless `original_request` explicitly contains those words. The example theme above is illustrative — copying its wording into a request that didn't ask for it biases every mesh toward a look the user didn't request.
- **Default to neutral, realistic styling — and treat personification as opt-in.** When `original_request` names no visual style, set `theme.style`/`theme.mood` to plain, naturalistic values (e.g. `style: "realistic, clean"`, `mood: "neutral"`) — do NOT infer `cartoon` / `cute` / `whimsical` / `cheerful` / `friendly` styling from the gameplay *genre* (a farm, a shop, a puzzle is not a license to make every asset a smiling cartoon). In particular, **never put faces, eyes, smiles, or mascot/anthropomorphic language into a `mesh.description` unless `original_request` asks for it.** `/build-mesh`'s Default 3 suppresses unsolicited faces on inanimate subjects (crops, food, props, furniture, vehicles), so even a `cheerful`/`cartoon` theme will (correctly) still yield faceless objects — describe a face only for subjects that naturally have one (characters, animals, robots) or when the user explicitly requested personification.
- **`theme.style` and `theme.palette` must be pure style/colour, NOT scene/locale nouns.** The `mesh` step prepends `"<theme.style>; palette: <theme.palette>; mood: <theme.mood>. <description>"` to every mesh description verbatim — if `theme.style` is `"lush garden scene"` or palette is `"greens & grass tones"`, the locale noun (`garden`, `grass`) lands *before* `/build-mesh`'s isolation defaults in the FAST3D positive prompt and the model wraps the subject in an enclosing shell / backdrop card. Allowed: style adjectives (`stylized, cartoon, low-poly, painterly, cel-shaded, PBR, voxel`), color words and named colors (`warm earth tones, deep blues, pastel`). Forbidden: locale nouns (`garden, forest, jungle, desert, dungeon, cave, room, kitchen, lab, underwater, reef, scene, environment, landscape`) and bare foliage nouns in palette (`grass, leaves, foliage` — substitute the color, e.g. `grass green` → `leafy green` or just `green`).
- **Mesh descriptions must be detailed (15-40 words).** See `/build-mesh`'s SKILL.md for the content guide (silhouette, proportions, palette references, distinctive features, mood). Thin descriptions produce thin meshes.
- **Describe the object itself — never the surface or context it attaches to.** The generator renders whatever the description mentions *as geometry*, so naming the mounting context makes it build that context into the asset: "flat base so it sits flush in a cell" → an unwanted base plate under the mark; "bracket to mount on the wall" → an unwanted bracket; "on a small stand/pedestal" → an unwanted stand; "patch of grass it stands on" → unwanted ground. The scene provides the context (the board, the wall, the floor); each asset is a **self-contained object** and its description must stop at the object's own boundary. This is the positive-framing way to keep unwanted attached geometry out — do **not** instead try to negate it ("no base", "without a stand"); `/build-mesh` documents why negations leak and make the artifact worse. Convey how it will sit via the `rest` field (above), not by describing the thing it sits on.
- **Every `mesh` entry MUST include `animate`:** `"auto"` (default — adds idle anims aggressively), `"yes"`, or `"no"` (only for static platforms/walls/terrain).
- **Every `mesh` entry MUST include `rest` — decide how the asset SITS in the experience, then descend that into the description.** This is a design decision that belongs to the plan, not something the mesh step should reverse-engineer from dimensions. Values: `"upright"` (default — a freestanding object standing on the ground, viewed from around it: characters, props, pieces, furniture, vehicles), `"flat_on_surface"` (lies flat in a plane, seen mostly from above: board marks/tiles, rugs, decals, floor grids, a game board), `"wall_mounted"` (hangs on a vertical surface: posters, screens, paintings, signage), `"held"` (grabbed/carried: tools, weapons, wands). Pick from the experience's actual staging — a tic-tac-toe X/O *lies flat in a board cell* → `flat_on_surface`; a chess knight *stands* → `upright`; the same silhouette can be either, so the layout decides, not the shape. **Then author the `description` to match the chosen `rest`**, because the description is what the generator sees:
  - `flat_on_surface` → describe a **flat, thin, low-relief tile lying face-up** and name the silhouette (`a flat X-shaped tile lying face-up`, `a flat ring/donut tile with an open hole`). Do **not** write "N cm thick", "flat base", "sits on a base", or "freestanding" — those read as a chunky 3D object on a pedestal (measured: "bold X … 2cm thick, flat base" generated exactly that base plate and forced a re-roll).
  - `upright` / `held` → describe the freestanding form normally; `/build-mesh` adds the all-angle isolation framing.
  - `wall_mounted` → describe a flat front face meant to be seen head-on.
  `/build-mesh` consumes `rest` to shape the prompt and drive post-gen orientation; if a plan omits it, the mesh step falls back to inferring from a thin `target_size_cm` axis, but an explicit `rest` is required so the intent is never guessed.
- **Every experience with user-facing text needs a `ui` entry.** Skipping it forces inline `Component.Text` (Hard Rule 3).
- **Every visible UI surface is a `ui.elements[]` entry.** Walk the experience interaction-by-interaction: every panel, dialog, HUD, button row, popup, modal, info card, detail panel, settings sheet — every distinct composed surface — is its own element. *Especially* the surfaces opened by interaction: "tap a tile to reveal its info card," "long-press to open a context menu," "click an item to show buy/sell controls." Those surfaces are UIKit modules just like the always-visible ones; planning them now is the only way the `ui` step's `/specs-build-ui` will generate UIKit primitives for them instead of hand-rolling them inline later. Conditionally-visible panels list `exposes` for `show<Name>(data)` / `hide<Name>()` and `emits` for `onClose<Name>` so the main script can drive them through Channel A.
- **Every `ui.elements[]` entry MUST include `labels` (array of strings)** — every visible string the user will read on that element. For dynamic values use the longest expected form ("9,999" not "0") so cells size for max content. Without `labels`, the `ui` step's `/specs-build-ui` invents placeholders like "C", "T", "P" or sizes cells for the wrong text length, causing truncation.
- **Every button / HUD panel SHOULD have a matching `icon` entry** (preferred, not required). Alignment check: walk `ui.elements[]` for `button`/`hud-panel`/`dialog` actions and verify each has a semantically matching icon (play → `play_arrow`, score → `trophy`, timer → `timer`, close → `close`). Soft failures — add icons to enrich, but don't block. `/specs-build-ui` renders text-only buttons for elements without an icon.
- **Include 2-3 SFX entries by default** (clicks, state changes, ambient) unless the user says "no audio". Music defaulting (game-like/ambient builds only, struck via the plan summary) is Hard Rule 1.
- **Signed out.** When the input's `is_authorized` is `false` or `unknown`, plan no generated images, plan AI/voice features without Remote Service Gateway tokens, and add a `deviations[]` entry saying AI-generated models, images, and RSG tokens are unavailable until sign-in. `/build-mesh` picks the offline mesh backend. An absent `is_authorized` (standalone call) is not signed out.
- **Mesh backend.** Backend choice per asset: see `/build-mesh`'s backend menu — the single home for backend selection. Pass `backend=` only when the user named one; always go *through* `/build-mesh` (never call `GenerateFast3DAssets` directly). Do NOT invoke `SearchLensStudioAssetLibrary` to swap in pre-built assets unless the user explicitly asks.

### Background music description derivation

**Background music is a default for game-like/ambient experiences, not a universal mandate.** Include one `{ type: "music", name: "BackgroundMusic", description: <derived from theme.mood + theme.style> }` entry by default when the experience is game-like or ambient, and state it in the plan summary so the user can strike it (e.g. "Music: warm lo-fi bed — say 'no music' to drop it"). Omit it when the request is a utility/tool UI or the user opted out ("no audio," "no music," "silent").

When music IS planned, don't pass a generic "background music" string to `/build-music` — the skill needs concrete musical parameters or it will pick something that fights the experience's mood. Synthesize the description now from `theme` + intended gameplay pace, using the derivation table (Genre / Tempo / Key+progression / Voices / Length / Mix) and worked examples in `references/music-description-heuristic.md`.

## Spatial Layout Plan (REQUIRED — prevents overlap)

Plan placement BEFORE writing the script. The Specs display at z = -110cm is 53cm wide × 77cm tall. Every piece of content gets a non-overlapping region.

1. **Size objects *relative to each other*, not in isolation.** Sizing each mesh on its own is what produces a helicopter bigger than its landing pad. Pick the most important object as the **size anchor**, give it a sensible viewport size, then size everything else as a **ratio** of it using real-world proportions (person ≈170, door ≈200, car ≈450, helicopter ≈1200, tree ≈600, chair ≈90, mug ≈10 cm — use these for the *ratios*, then shrink the whole set to fit the viewport). **Containment/support rule:** for any "A rests on / lands on / fits inside B" pair, A's footprint MUST be strictly smaller than B's — walk every such pair and fix the offender's `target_size_cm` before locking sizes. UI panel sizes come from the elements list. These values flow to the `mesh` step.
2. **The visible band is NOT centered on y = 0 — it runs roughly y −47 … +26 at z = −110.** The Specs camera is pitched ~5.5° **down** with a ~36.6° vertical FOV, so the 73–77 cm of visible height sits mostly *below* the eye line. Treating it as ±38.5 puts anything above **y ≈ +26 entirely off-screen**. Budget the top of the frame at **+25**, not +38, and use the deep room below y = −25 for overflow. Derive the exact band from the actual camera pitch and vertical FOV when you have them (e.g. **−47.05 … +25.68**); until then plan against +25 / −47 and let bootstrap's placement check confirm. Assign regions inside that band:
   - HUD / status: top, Y = **+14 to +24** (a 5 cm panel above y = +20 does not fit)
   - 3D content zone: center, Y = 0 to −20cm
   - Action buttons / secondary HUD: bottom, Y = −25 to −40cm — the roomiest region, not a leftover
   - Dialogs: center overlay, starts hidden
   Do not stack two panels in the top band: if a shop or list panel already reaches y ≈ +24, there is under 2 cm of headroom left and the second panel belongs *below* the content, not above it.
3. **Buffer:** ≥ 2cm between any two objects/panels — this prevents *overlap*, nothing more.
3a. **No overlapping panels — every co-visible surface gets its own z depth slot.** The buffer above works *within* a plane and says nothing about two panels at the same z. Assign each co-visible surface class its own depth slot (content plane, panel plane, overlay/dialog plane) and write the z into the table. **When two co-visible surfaces' x/y rectangles intersect, their z must differ by ≥ 2 cm** — coplanar overlapping panels z-fight and flicker across their shared region. Compute each rectangle from the **full frame extent** — `innerSize + 2 × margin + padding`, and UIKit `Frame`'s margin defaults to 4 cm per side — not from `innerSize` alone, or the pair reads clear on paper and overlaps on screen. The 0.05 cm depth floor is the absolute tie-break minimum, never a target, and the intra-panel content lifts (0.6 / 0.15 / 0.08 / 0.02 cm) are **not** panel separations. **Carve-out:** mutually exclusive panes — tab bodies, a pane switcher, anything where only one is enabled at a time — may share a pose, because they are never co-visible.
3b. **Grounded meshes span `y … y + height`, so a support's top face is `origin_y + thickness` — not `origin_y`.** Meshes come out of `/build-mesh` re-seated to **min-Y = 0** (`grounded: true`), i.e. the origin is at the *base*, not the center. A 2 cm plot placed at y = −25 therefore spans −25 … −23 and anything resting on it goes at **y = −23**. Planning "on top of" positions off the support's origin floats every object by the support's full thickness. Write the support's top face into the layout table next to it so downstream steps read it instead of re-deriving it.
3c. **Positions in the table are WORLD positions. A child's local position must subtract its parent root's offset.** If the experience has a container root at z = −110 and you tell a step to place a panel at "z = −110", a step that writes that as a *local* position lands the panel at world z = −220. State each entry's frame explicitly, and prefer parenting UI panels at the **scene root** (local == world) rather than under a shifted container — that is what lets a UI module express depth as a plain `z = −110` constant.
4. **Functional spacing — separate what should read as separate.** The 2cm buffer does NOT make two gameplay-distinct stations (a pickup vs a drop-off, a start vs a goal, two team bases) read as *apart* — placed 3cm apart they're technically non-overlapping but visually one clump. For each such pair, push them to opposite ends of the usable space (left vs right third of the 53cm width, or near vs far in depth) so the separation is obvious. Tag each meaningful pair's intended relationship in the table — `on`, `near`, or `far` — so the `bootstrap-scripts` step's placement verification can check it.
5. **Record as a position table:**

```
Spatial Layout (z = -110cm, viewport 53×77cm):
  Platform:     (0, -15, -110)  est. 50×2×50cm
  Robot:        (0, -5,  -110)  est. 10×20×8cm  — on Platform (footprint < Platform ✓)
  ScoreHUD:     (0,  25, -110)  est. 12×4cm     — top center
  StartButton:  (0, -30, -110)  est. 12×3cm     — bottom center
  GameOverDlg:  (0,  0,  -108)  est. 20×14cm    — overlay depth slot, 2cm in front of the panel plane (hidden)
```

Annotate each meaningful pair's relationship — `on` (supported; footprint must be smaller), `near`, or `far` (deliberately separated — e.g. a pickup pad and a drop-off pad go to opposite ends of the width, not side by side). The `scripts` step updates sizes/positions from real `aabb_cm` after the `mesh` step records them (mark plan-time values `// TODO: verify with aabb_cm`); the `bootstrap-scripts` step's placement verification then enforces both non-overlap AND that `far` pairs are actually apart.

## Script Plan

**Decompose by responsibility.** A single 500-line "GameManager" that does scene-building, state, audio, and interaction wiring is harder to read, debug, and iterate on than four focused ~100-line modules. Aim for one concern per file.

**Naming — experience-prefixed and flat.** Every generated script is prefixed with the experience name and lives flat in `Assets/Scripts/` (no per-experience subfolder): `<ExperienceName>Main.ts`, `<ExperienceName>State.ts`, `<ExperienceName><PanelName>UI.ts`, `<ExperienceName><Concern>Controller.ts`, and so on. The prefix namespaces the scripts so they don't collide with each other or with anything already in the project, and keeps them grouped in the folder. Because the scripts sit directly under `Assets/Scripts/`, asset references use a single `../` (e.g. `../GeneratedMeshes/…`).

**Required:**

- **`Assets/Scripts/<ExperienceName>Main.ts`** — the main `@component` script, attached to the main root by the bootstrap. Owns lifecycle (`onAwake`, `onStart`, event subscriptions), validates required refs, coordinates controllers, pushes data into UI modules via setters, subscribes to UI `Event<T>` emitters, and imports the focused modules. Keep it small; it should read like an orchestration table, not the whole app.
- **One or more UI `@component` modules** generated by `/specs-build-ui`, attached to authored sibling SceneObjects by the bootstrap. **Every UI entry in the spatial layout names the authored root that carries it** — one root per surface is the bootstrap default, so a module owning two surfaces declares two roots and the layout table lists both by name. Split UI modules by semantic authoring unit: an independently movable HUD, toolbar, detail panel, modal, settings panel, or large/complex surface gets its own `<ExperienceName><PanelName>UI.ts` when that improves human editability. A tiny always-contained sub-view can remain private inside its parent UI module.
- **`<ExperienceName>AssetManifest.ts` or `<ExperienceName>SceneContracts.ts`** when the build has generated assets or placeholder upgrade slots. It centralizes stable names, expected asset paths, placeholder/final mappings, and authored SceneObject contract names so future agents do not rediscover them from a monolith.

**Add when logic warrants** (most non-trivial experiences pick up at least 2-3):

- **`<ExperienceName>State.ts`** — game state, scoring, timers, win/lose detection, progression. Pure logic, no scene access. Easy to reason about in isolation.
- **`<ExperienceName>SceneRefs.ts`** — typed reference validation for authored objects and components. Fails loudly with clear logs when a required `@input` was not wired.
- **`<ExperienceName>AudioController.ts`** — SFX/music playback helpers (`playClick()`, `playWin()`, ambient start/stop). Centralizes audio refs/volumes so cues are findable in one place.
- **`<ExperienceName>Interactions.ts` / `<ExperienceName><Concern>Controller.ts`** — handlers that fire on button trigger, grab, swipe, zone enter, spawn, collect, etc. Each controller owns one concern and communicates via callbacks/events, not global state. Flat and prefixed (e.g. `<ExperienceName>SpawnController.ts`), not a `Gameplay/` subfolder.
- **`<ExperienceName>SceneBuild.ts`** only for runtime-only or placeholder construction: cheap primitive placeholders, pooled/transient objects, high-cardinality generated children. It must not recreate semantic authored roots that Phase A already created.
- **Interaction recipes** (e.g. `<ExperienceName>SwipeInteraction.ts`) — when the experience needs swipe/throw/grab-pull. See `/specs-interaction-recipes`. Sibling files; never a replacement for the main script or any pipeline phase.

**One-way data flow, single source of truth per slice.** Every piece of domain state has exactly one owner — not necessarily one file. Global/shared state (score, phase, timer, win/lose) lives in one owner module (`<ExperienceName>State.ts` / `<ExperienceName>GameState.ts`); concern-local state (a player's HP, a spawner's cooldown, inventory) lives in the controller that owns that concern; no state is mirrored or co-owned across modules, and controllers don't read each other's state directly. UI modules are **passive views**: they render what they're told through their public setter API, report user intent through `Event<T>` emitters, and hold only ephemeral view state (which tab is open, is-a-panel-expanded) — never domain state or game decisions. `Main`/controllers own state, mutate it, and push it to the view. This is Channel A (Hard Rule 3) stated as architecture: view ← state via setters, view → intent via events, never view ↔ logic. MVVM/MVP in spirit — one-way flow, not literal data-binding. Trivial experiences can keep it all in one file; don't force the split.

**Module shape rule:** split plain TypeScript logic modules freely. Add extra `@component` scripts when the component is an authored, reusable, independently inspectable scene unit (UI panel, controller, reusable prop behavior, bridge, placeholder-upgrade slot). Avoid hidden mega-components: files above ~250 lines need a reason in a short header comment; files above ~400 lines should normally be split before continuing unless generated API surface makes that impossible.

**Header contract:** every non-trivial script starts with a short comment stating what it owns, what `@input`s it expects, and what it must not do. Future agents should be able to choose the right file without reading the whole project.

**Expose every opinionated choice; hardcode only correctness invariants.** An *opinion* is any value you chose that the user didn't dictate and that would still work if changed — regardless of category. "Every" means every opinion the experience *actually contains* — how many that is scales with the tier (an effect lens contains few; a mechanics game contains many). The rule governs exposing the opinions that exist, never manufacturing knobs to look configurable. Opinions come in two families and **both** must be exposed, not just the first:
- **Presentation / content** — colors, the glyph/mesh used for a mark (`X` vs `O`), fonts, sizes, labels and prompt strings, sounds.
- **Mechanics / behavior / balance** — speeds, damage, fire-rate, cooldowns, spawn rates, difficulty scaling, scoring thresholds, physics constants (gravity, jump height), timers, default counts.
- **Service / AI / sensor parameters** — for AI, camera, or remote-service experiences: the system prompt, model choice, temperature, max-tokens, voice, and CV/detection thresholds. These read like "config" so they get buried, but a user would absolutely want to change them — a system prompt is one of the most opinion-dense strings in the whole build. Expose them like any other opinion.

Do not treat mechanics as "just data" that belongs in code — a tuning number is as much an opinion as a color. Surface every opinion as an `@input` with your pick as the default, so the experience works out of the box **and** can be changed without editing code. Keep a value in code only when it is a correctness invariant — something that breaks the rules or layout if changed (a tic-tac-toe board is 3×3; `Canvas` sort type; render-order flags; the two-phase wiring). Test per value: "would a reasonable user want this different, and would it still work if they changed it?" → yes = `@input`. The failure mode to avoid: shipping a scene whose only knob is `Music Volume` while the mark colors, the `X`/`O` glyphs, the board tint, and the turn-prompt text are all buried as literals. Aesthetic and content choices belong on the owning module (the mark colors/glyphs on the board UI, speeds on the controller), grouped in Settings.

**The mechanics/behavior/balance family scales with the experience tier.** Family (b) — and the config/balance-table treatment below — applies in full only to the **mechanics-driven** tier. An **effect/utility** experience has no balance table, difficulty curve, or spawn rate to expose; do not manufacture one, and do not synthesize knobs (a "difficulty," "wave count," or "enemy speed" input on a lens that has no enemies) to look configurable. On the lower tiers, expose the presentation family plus the few behavior knobs the experience genuinely has, and stop there. Which values are opinions doesn't change with tier; how many opinions the experience *contains* does.

**Expose only what you actually built.** The exposure test is bidirectional: expose the opinions the code uses, **and** expose *only* opinions the code uses. Never add an `@input` — or its widget/hint/group scaffolding — for a capability the build does not implement and verify: a `sfxVolume` slider when no audio asset was generated, a `showOrbits` toggle wired to nothing, a `difficulty` field no code reads. Each is a config surface for a non-feature — it costs generation output and reads as inspector clutter (raising the user's cognitive load) while adding zero capability, and it is the same lie as a false "exposed" comment. Before emitting an `@input`, confirm a real code path consumes it and (for asset-backed inputs) the backing asset exists. If the feature isn't built, don't expose the knob; build the feature or drop both.

**Cap the inspector knob count outside the mechanics tier.** Default to at most ~6 tunable `@input`s per component on the effect/utility and interactive tiers; exceed it only when the experience genuinely contains more distinct tuning opinions — a data-driven interactive tool or the mechanics-driven tier's balance table — never to look configurable. When you have more candidate knobs than the cap, keep the ones a user is most likely to change and leave the rest as sensible in-code defaults — a leaner inspector a human can actually scan beats an exhaustive one they won't. (References — object/component/asset handles the scene requires — don't count against the cap; this bounds *tunables*, not wiring.)

**Config/balance tables are family (b), not invariants.** A stat/balance table or difficulty curve buried in a `*Config.ts` (or an in-file `const`) is still a pile of family-(b) opinions — bundling many of them into one data file does not make them correctness invariants. Their tunable fields must stay Inspector-reachable: expose them as grouped `@input`s on the owning gameplay controller (the config file holds the *defaults* the inputs initialize from), or wire the table as a data asset.

**Never write a comment claiming a value is exposed when it isn't.** A comment like "<ExperienceName>Main.ts also exposes these as `@input` so a designer can retune" is a lie if nothing actually wires them — either make the claim true (add the `@input`s) or delete the comment. The `audit-static` step greps for claimed-but-unwired exposure (a comment asserting Inspector/`@input` exposure of a value that has no matching `@input` declaration) and treats it as a violation.

**Inspector presentation — make authored `@input`s legible.** A wired scene is only human-editable if the Inspector reads well, so generated scripts follow the Inspector-layout convention in `lens-api/references/conventions.md`. **Scale the ceremony to the tier** (see "Experience tier"): the full grouped scaffold below is the mechanics-driven default; an effect/utility component with a handful of knobs needs only the header + a single `Settings` group (skip the References/Debug groups it has nothing to fill). Match the structure to the field count — don't emit empty groups.
- A `@ui.label('<span style="color: #60A5FA;">ComponentName – purpose</span>')` header + `@ui.separator` at the top of each `@component`.
- `@input`s grouped by concern with `@ui.group_start("References")` / `@ui.group_start("Settings")` and `@ui.separator`s between sections — object/component/asset refs in **References**, human-tunable scalars/labels/colors/flags in **Settings**. Emit a group only when it has fields.
- `@hint("…")` on **every** `@input` — never ship a hint-less field (it's a DO-NOT in conventions.md).
- The **right widget per type** (`conventions.md` → Input widgets), never a bare `@input` that falls back to a raw editor: `@widget(new ColorWidget())` on every `vec3`/`vec4` color (a bare color input renders as four number boxes, not a picker — the common bug); `@widget(new SliderWidget(min, max, step))` on bounded numerics (volume, speed, gap, padding, counts); `@widget(new ComboBoxWidget([...]))` on discrete/enum-like picks (mark style, theme preset). Colors use the `@input('vec3'|'vec4', '<default>')` type+default form.
- A stable, sensible default on every tunable so the scene works before anyone touches the Inspector.

Read `lens-api/references/conventions.md` before writing the `@input` block; it carries the canonical grouped scaffold to copy.

**The UI interface contract (`ui_api`) — required whenever the plan has a `ui` asset.** The `ui` and `scripts` steps run *concurrently*, both building against this block, so it is the one part of the script plan that must be signature-precise: for each UI module, its `path` (`Assets/Scripts/<ExperienceName><PanelName>UI.ts`), `class_name`, `public_methods` (full TS signatures — `setCoins(value: number): void`), and `events` (`onBuy: PublicApi<{cropId: string}>`). Design it from the mechanics, one-way flow (setters in, `Event<T>` intent out — see above): every piece of state the game must display gets a setter; every user intent the UI can express gets an event. Keep it *minimal but sufficient* — `ui` may add methods it discovers it needs, but a method `scripts` needs that you didn't declare forces a mid-build reconciliation. Method-level precision here is what buys the pipeline its largest overlap; a vague `ui_api` forces a costly re-serialization of the build.

**When NOT to split:** trivial experiences (one button + one mesh, no scoring) can live in a single file. Don't force abstractions. Use the Module shape rule's thresholds (~250 lines wants a reason, ~400 should normally be split) or "mixes more than two concerns" as the trigger to pull one out.

**These are defaults, not ceremony.** The rules above encode the reasoning (why authored roots, why one owner per state slice, why the view stays passive) so you can extrapolate to cases they don't name. Apply engineering judgment: when a rule genuinely doesn't fit the experience in front of you, state why in a short header comment and choose the better structure — but the bar is a concrete reason, not "it was faster to inline." The failure mode this guards against is silently collapsing back to one monolithic script because that path had less friction.

## Standalone invocation (one step, no pipeline)

You do not need a full build to run this. This skill is the `plan-assets` and `plan` steps.

This step needs no Lens Studio and no MCP — it is pure reasoning, so it runs anywhere.

When a required input is missing and no `.clad/` record supplies it, **ask for it and stop** — do not invent a value and do not fall back to a lesser output (field-notes Hard Rule 1).

## The payload is the deliverable — keep the prose out of it

This step is the **first link in the build's critical path**: nothing else can start until it returns, and it is one long uninterrupted generation — essentially all of it token generation. Every sentence written here delays every downstream step by the time it took to write.

So spend the output on the *decisions*, not on explaining them:

- **The `STEP_RESULT` JSON is the artifact.** Do not precede it with a prose walkthrough of the plan, and do not follow it with a recap. The orchestrator reads the JSON and reports to the user itself.
- **`ownership` and `exposure_plan` entries are one line each.** They tell a downstream author what a file owns and which knobs exist — they are not design essays. A rationale belongs in the plan only when a later step would otherwise make the wrong choice.
- **Do not restate the request, the tier definitions, or the doctrine you just applied.** The tier is one word in the payload; the reasoning that picked it does not ship.
- **Do not pre-write code.** No TypeScript bodies, no method implementations. Signatures and ownership only — `ui_api` declares the module interfaces; `scripts` and `ui` author all code.
- **Say nothing twice.** The theme belongs in `theme`; do not also inline it into every asset description (the `mesh` step prepends it verbatim, so repeating it there duplicates it in the prompt the backend receives).

Being terse here is not the same as planning less: every field the schema requires must still be complete and every containment/spacing rule still enforced. Cut the narration, not the analysis.

## Output contract

End the run with exactly one fenced `STEP_RESULT` JSON block, and also write it to `.clad/steps/<mode>.json` (create the dir if needed) — `plan-assets.json` in `plan-assets` mode, `plan.json` in `plan` mode — where the orchestrator and downstream steps read it.

**`plan-assets` mode** emits the smaller front-of-pipeline payload: `step` (`"plan-assets"`), `status`, `errors`, `deviations`, `retries`, `tier`, `theme`, and `assets` (each mesh carrying `target_size_cm` / `animate`, plus the derived `music` entry). No `spatial_layout`, `script_plan`, or `ui_api`.

**`plan` mode** required fields:
- `step` — `"plan"`
- `status` — `ok` | `partial` | `blocked`
- `errors` — array of strings (empty when none)
- `deviations` — array of strings (empty when none)
- `retries` — integer ≥ 0
- `tier` — `effect/utility` | `interactive` | `mechanics-driven`
- `theme` — the theme string/summary
- `assets` — array; each entry has `type` (`icon`|`mesh`|`sfx`|`music`|`ui`) and `name`
- `spatial_layout` — array; each entry has `name`, `position_cm` `{x,y,z}`, `size_cm` `{x,y,z}`
- `script_plan` — object with `files` (array of strings)
- `music_included` — boolean

Plus, whenever `assets` contains a `ui` entry: `ui_api` — array of per-module interface contracts (`path`, `class_name`, `public_methods[]`, `events[]`); the concurrent `ui` and `scripts` steps both build against it.
