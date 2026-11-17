---
name: specs-build-ui
description: Select and use the installed Spectacles UI package for world-space Specs panels, HUDs, settings, media browsers, docks, storefronts, and related UI. Use for package selection, installation, spatial design requirements, and UI build verification.
user-invocable: true
argument-hint: a short description of the UI to build
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Build UI for Specs

Use this skill to build Specs UI with UIKit 4.0 (Lens Studio 5.25+). The working
UIKit contract — rules, modules, deprecated and removed API, examples — is
`references/uikit-4.0.md`; read it before writing UI code.

Load `/lens-api` for generic Lens TypeScript lifecycle, decorators, runtime
SceneObjects, transforms, and events. Load `/scene-construction` when the task
also authors scene hierarchy or component wiring.

If the user wants a complete experience rather than an isolated UI change,
route through `/lens-studio-router`. The experience builder owns asset
generation, scripts, scene composition, and final verification.

## Load-bearing rules

Re-confirm these right before you build; details and code are in
`references/uikit-4.0.md`.

1. **Use Flex/Grid layout, never absolute X/Y.** Follow the panel example in
   `references/uikit-4.0.md`. Never place sibling elements by computing positions
   from panel half-width/height; reserve local position changes for a small depth
   offset.
2. **Separate stacked surfaces in Z, always, by construction.** Any panel that
   stacks >1 visual (plate + rows + button faces) MUST get a Canvas on the screen
   root plus one absolute `+Z` on the node that begins each stacked coplanar layer
   (Flex/Grid keep Z, so never stagger per nesting level), or coplanar transparent surfaces
   screen-door z-fight into a checkerboard. Invisible to every gate and to a
   no-preview session — do it unconditionally, don't wait to "see" it.
3. **Follow UIKit's initialization order** (`references/uikit-4.0.md` rules 3–4).
   Do not set initialization-dependent properties or subscribe to events before
   the component is ready; never defer event wiring into an unbounded per-frame
   retry.
4. **Treat text size as typography, not world-space centimeters** (reference
   rule 5) and verify the rendered result at the authored distance; a nonzero
   configured value is not proof that the text is legible.
5. **Verify every layout child has nonzero cross-axis extent.** Call
   `refreshChildren()` after adding rows, and confirm scrolling content is aligned
   inside its clipping region.
6. **Author the UI in the scene; discover peers with the typed
   `getComponent(X.getTypeName())` in `OnStartEvent`,** never duck-typed
   `getComponents("Component.ScriptComponent")`. (`/lens-api`, `/scene-construction`.)
7. **Icons only from `/icon-selector` or a text glyph** — never a hand-typed
   `requireAsset` path, and never `requireAsset` at module top level.
8. **One theme: System 3.0.** UIKit 4.0 ships only System 3.0 (`"System3"`).
   Never pass `"System2"`, `"System 2.0"` or `"SnapOS2"`, or a 2.0-only style
   (`PrimaryNeutral`, `Special`): they load as 3.0 with a warning, so the look
   is not what the code says. 3.0 button styles are `Prism`, `PrismGhost`,
   `Primary`, `Secondary`, `Ghost`.

## Select the UI capability

Use UIKit when the request needs composed,
interactive world-space UI such as:

- panels, cards, dialogs, and status HUDs;
- buttons, toggles, sliders, text input, or toolbars;
- responsive rows, columns, grids, or scrollable content;
- movable, followable, or resizable windows.

Use raw Lens components only when UIKit 4.0 does not support the required
behavior, or when profiling shows a high-cardinality repeated element needs a
lower-level implementation. Keep the
surrounding panel and ordinary controls package-backed.

## Install and check the packages

1. Invoke `/ensure-package-installed` for `UIKit`; UIKit 4.0 brings InteractionKit,
   Motion and Icons as dependencies. Then confirm `InteractionKit` is installed.
2. Record the installed UIKit and InteractionKit versions. On 4.0.x use
   `references/uikit-4.0.md`. On a legacy `SpectaclesUIKit` project follow
   `specs-package-renames` and keep the project on its legacy line.
3. Before using a symbol that is not in the reference, confirm it in the installed
   package's declarations under `Cache/TypeScript/Src/Packages/` (read-only; never
   edit `Cache/`). A symbol remembered from another revision is not evidence.

Re-read the relevant section of the reference right before the build step that
uses it; a read done early in a long run may have been compacted away.

## Version-gate the checked-in helper

`references/UIKitHelpers.ts` is a compatibility snapshot for the exact UIKit,
InteractionKit, and Lens Studio versions stamped in its header. It is not a package API
source and is not safe to copy into every project:

1. Compare the installed UIKit and InteractionKit versions and the active Lens Studio
   version with all three versions stamped in the helper header.
2. Copy it only when all three versions match exactly, and still verify that
   its imports resolve during the real type-check.
3. On any mismatch, **do not copy the checked-in helper**. Author project-local
   composition code from `references/uikit-4.0.md` and the installed declarations.

Keep the helper and `references/uikit-4.0.md` in step with the shipped UIKit.

## Plan the UI

Before authoring:

1. Identify each panel, its purpose, and whether it is persistent, modal, or
   transient.
2. Identify static text, live state, controls, icons, media, and empty/error
   states.
3. Define the data pushed from the experience into the UI and the user events
   emitted back.
4. Choose a layout structure that adapts to content instead of relying on
   hand-positioned siblings. Follow the panel-layout example in
   `references/uikit-4.0.md`. Never place siblings with panel half-width/height math;
   doing so overlaps or clips content and cannot be edited reliably in the
   Hierarchy.
5. Choose a backing/window capability (`Frame` or `RoundedRectangle`) based on
   whether the surface must move, follow, resize, or remain fixed.

Keep UI modules separate from gameplay logic. UI modules expose small public
state-update methods and interaction events; the main behavior consumes that
interface instead of reaching into visual children.

## Author UI in the scene; construct at runtime only when necessary

Dynamic spawning of a UI tree is an antipattern. A panel authored in the scene
is visible, inspectable, and adjustable in the Hierarchy and Inspector before
the lens ever runs; a runtime-only tree can be assessed only by launching it,
which is exactly what hides layout and wiring errors until Preview. Prefer scene
authoring:

- Author each panel's **host SceneObjects** and its **static chrome** (title
  bars, dividers, backing images, fixed labels) in the scene via VirtualScene /
  the `/scene-construction` skill — do not `createSceneObject` /
  `createComponent` them in `onAwake`.
- Author the **layout** (Flex/Grid containers with their gap, padding, and
  alignment) on those scene hosts. Panel scripts resolve those hosts through typed
  `@input` references (preferred) or a recursive name-search helper — `SceneObject`
  has no `findChild`/`findByName`, only `getChild(index)` / `getChildrenCount()` — and
  **fail closed** (log + early return) when one is missing — no find-or-create fallbacks.
- **Reserve runtime construction for what genuinely cannot be authored:**
  data-driven or high-cardinality rows whose count is unknown at author time
  (clone a scene-authored template), and transient or pooled content.

The deliberate exception is a UIKit component that must be created at runtime
(`Frame` and generated controls). Attach it from the panel
script onto a **scene-authored host SceneObject**, never onto a parallel
runtime-spawned hierarchy. Author the structure; wire only the live behavior.

**The tell-tale failure is a project whose `Assets/Scene.scene` is essentially
the empty template while the panel script `createSceneObject`s the entire tree in
`onAwake`.** That lens may render, but a developer opening it sees nothing in the
Hierarchy to select, adjust, or restyle — the whole point of scene authoring is
lost. The deliverable is a scene a human can edit: the panel roots, layout
containers, static chrome, and named host objects for each control must exist in
`Scene.scene` (author them with VirtualScene / `/scene-construction`), with the
script resolving them via typed `@input`s (or a recursive name-search helper) and
attaching only the live UIKit components + data-driven rows at runtime. If your script creates its host
hierarchy from scratch in code, you have not authored the UI — restructure so the
hosts are in the scene.

## Apply version-independent Specs guidance

Read `references/spectacles-spatial-design.md` for focal distance, usable
display area, touch target sizing, additive-display color constraints, and
typography guidance.

Always:

- group nearby content into coherent panels and layout containers;
- make controls comfortably targetable at their authored distance;
- maintain clear typography hierarchy and readable contrast;
- expose user-relevant visual and content choices as script inputs;
- budget for localization, wrapped text, and live values;
- keep world-space content depth-tested and visibly separated from its backing;
- make hierarchy, focus, and interaction order intentional.

These are design requirements; the UIKit API rules are in the reference.

## Build

When the experience builder provides a script path, write the UI module at that
path and let the orchestrator attach it. When invoked standalone, write a
focused module under `Assets/Scripts/` and attach it to an intentionally placed
scene object.

**Writing the `.ts` is not the deliverable — a script that is not attached to a
SceneObject in the saved scene never runs and the lens is empty.** A TypeScript
module authored under `Assets/Scripts/` but never added as a `ScriptComponent` to
a SceneObject exists only as an unused asset: nothing calls `onAwake`, nothing
renders, and the scene has no trace of it — yet the type-check passes, so nothing
flags it. For every module you author (the `Main` controller **and** each UI panel
module), create/choose a SceneObject, add the module as a ScriptComponent, wire
its `@input`s, and **save the project** so the component persists in `Scene.scene`.
Then confirm each script's runtime lifecycle prints actually fire in the logs — if
you never see the controller's `onAwake`/`OnStartEvent` output, it is not attached.

When you set an `@input` that drives sizing/geometry, either assign its value in
the scene or guard it in code — a serialized-unset numeric input arrives as `0`
and collapses the panel regardless of the field's TS initializer (the
`@input`-serialized-default rule is owned by `lens-api/SKILL.md`).

Place that host **in front of the camera**. Lens Studio cameras look down **−Z**,
so a world-space panel must sit at a *negative* Z: 110 cm out by default
(`(0, 0, −110)`), 60 cm for panels the user pokes or pinches directly (distances are
owned by `references/spectacles-spatial-design.md`); a host left at the origin or at **positive** Z is built
*behind* the viewer and renders nothing — with no error and a clean type-check, so
nothing flags it. If the panel's whole subtree builds without error but you see
nothing, suspect placement (behind camera / off to the side) before rebuilding the
UI, and confirm the panel is actually visible in the preview, not merely present in
the scene tree.

Use `references/uikit-4.0.md` for every UIKit implementation decision. Use `/icon-selector` and `/font-selector` when the design calls for
assets that are not already present. For an icon glyph, the only valid sources
are the exact path `/icon-selector` produced (reference it verbatim — confirm the
asset exists) or a text label. **Never `requireAsset` a path you typed yourself.**
No package publishes a stable, guessable icon-path contract, so *any* hand-written
`<Package>.lspkg/…` path — `Icons.lspkg/Iconography/<Category>/<name>.png`, an
invented UIKit `Icons/<name>.png` path (UIKit 4.0 has no `Icons/` folder; its
controls resolve iconography internally from the companion `Icons` package, whose
catalog paths are not a consumer contract), or anything you did not receive from
`/icon-selector` — fails at runtime with `Cannot find asset …` /
`Failed to resolve dependency …`, and the compiler cannot catch it (`requireAsset`
returns `any`). Substituting a *different* invented path after one is rejected is
the same mistake; the rule is categorical, not a blocklist of known-bad strings.
Never call `requireAsset` at **module top level** either — a miss throws during
import and takes the whole component down, surfacing as an unrelated
"`<panel> not found. Check scene wiring.`"; load the asset inside a lifecycle
method. If `/icon-selector` yields no asset, use a text glyph — do not guess a
path.

Prefer a thin compiling vertical slice before filling in every screen state:
one package import, one initialized surface, and one wired interaction. When a compile error points at UIKit usage, check the reference and the installed
declaration for that symbol. After three compile→inspect→fix cycles on the
same package issue, stop repeating the loop and report the exact symbol, error,
and installed version.

## Verify

1. Recompile TypeScript and fix every error, including any unresolved package
   import: confirm each `<package>.lspkg/...` path resolves to a module the
   installed package actually contains rather than an invented root. Import roots differ between
   packages (UIKit's is in the reference); do not carry one package's prefix onto
   another. This must be a real type-check (see
   `lens-studio-field-notes` See-and-fix step 1): a types-stripped transpile will
   not catch wrong imports, enum values, or nonexistent members. If a real
   type-check could not run, report the UI type-unverified.
2. Run the experience and inspect runtime logs; compile success alone is not
   sufficient. The first seconds of playback must be free of lens-script errors —
   in particular `Input <name> was not provided` (a required `@input` you
   declared but never wired). Wire every such reference in the scene (or hold the
   code reference) before sign-off; a type-clean build still fails at runtime if
   an input is unconnected (the unwired-`@input` rule is owned by
   `lens-studio-field-notes/SKILL.md:72`). For a code-first orchestrator (`Main`)
   whose panel is a child SceneObject, prefer graceful fallback over a hard-wired
   required input: declare the panel input optional (`@input` + `@allowUndefined`)
   and, in `OnStartEvent`, discover it with the **typed**
   `child.getComponent(<PanelClass>.getTypeName()) as <PanelClass> | null`,
   guarding with a `print` + early return when none is found — so a missing wire
   degrades to a logged no-op instead of the frame-1 throw. Do **not** discover by
   scanning `getComponents("Component.ScriptComponent")` and duck-typing the
   module's public API: the generic wrapper does not reliably expose a custom
   script's members, so the check reads `undefined` and discovery silently fails
   (the cross-script discovery rule is owned by `lens-api`).
3. Capture the Preview panel.
4. Confirm every panel is *actually rendering*, not merely present in the scene
   tree. Check that each component reached its ready state, content has
   nonzero bounds, the visible host is enabled, and layout children have nonzero
   extent. Resolve causes with the reference's rules (initialization, Frame
   `onInitialized`, cross-axis stretch, layer inheritance); resolve cross-script discovery from `/lens-api`.
   Then confirm content is visible at the intended distance, text is legible,
   content does not overlap, and controls have adequate target size.
5. **Apply depth separation by CONSTRUCTION, and additionally look at the
   captured frame for a dithered CHECKERBOARD / speckle over panels, rows, or
   button faces.** That checkerboard is coplanar-transparency z-fighting
   (screen-door dither on stacked semi-transparent surfaces), not a texture bug.
   It is invisible to typecheck, the render gate (counts objects, not dither), and
   source-lint — AND invisible in any headless / no-preview session, which is
   exactly when you cannot screenshot to catch it. So looking at a frame is a
   backstop, NOT the primary defense: any panel that stacks more than one visual
   surface MUST get the Canvas + single `+Z` offset (reference rule 2) as it is built,
   whether or not you can preview it. If a preview
   was unavailable, state that depth separation was applied by construction
   rather than claiming the frame was visually clean.
6. Exercise every interaction and state update, and confirm each control's
   handler actually fires. Resolve an inert control with the reference's initialization rules
   rather than guessing a retry.
7. Resize, move, follow, scroll, or reopen UI where those capabilities apply.
8. Check empty, long-text, error, and maximum-value states.

If behavior differs from `references/uikit-4.0.md`, report the installed package
version and the observed mismatch.

Append this evidence to the build handoff or final report. Never infer a value;
use `unknown` or `false` when the tool result did not establish it.

```yaml
ui_packages:
  UIKit: {installed_version: <version | unknown>, contract: references/uikit-4.0.md, imports_verified: <true | false>}
  InteractionKit: {installed_version: <version | unknown>}
```
