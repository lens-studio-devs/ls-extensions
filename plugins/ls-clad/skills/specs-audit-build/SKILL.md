---
name: specs-audit-build
description: >
  Read-only self-audit of a Specs build. Flags hand-rolled UI that should use
  UIKit (Hard Rule 3), theme-private writes, missing requireAsset paths, and
  exposure violations, then the manifest-disk-scripts definition-of-done.
  Returns issues[]; no edits.
user-invocable: true
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Audit a Specs Build

This skill is the **read-only** pre-emit audit for a Specs experience build. It runs the consolidated static check and the manifest ↔ disk ↔ scripts sign-off, and returns every problem it finds as a structured `issues[]` list. It never edits files: where a check would otherwise say "STOP and re-invoke `/specs-build-ui`" or "fix and recompile," this skill instead **records the issue** with its `responsible_step` and `severity`, and the orchestrator routes the fix to the responsible step. The orchestrator enforces a hard cap of **3 audit→fix cycles** per build; if cycle 3 still fails, the remaining gaps are surfaced as build limitations rather than fixed.

The checks exist because their failures **compile clean and render** — they are silent. Anything `RecompileTypeScriptTool` already reports as a TS error is not re-checked here.

## 1. Consolidated static check (run once)

One pass over `Assets/Scripts/`. Orphan-direction coverage (asset on disk but never referenced) is part of the definition-of-done sign-off below — see `lens-studio-field-notes` → "Definition of done (Specs builds)".

**1. `requireAsset` path-exists lint.** A `requireAsset(...)` to a path missing on disk is silent at compile time — the script returns `null` at runtime and the Lens fails to load with an opaque error:

```bash
python3 -c "
import re, os, sys
fails = []
for root, _, files in os.walk('Assets/Scripts'):
    for f in files:
        if not f.endswith('.ts'): continue
        ts = os.path.join(root, f)
        for m in re.finditer(r'requireAsset\(\s*[\"\\']([^\"\\']+)[\"\\']', open(ts, encoding=\"utf-8\").read()):
            path = m.group(1)
            resolved = os.path.normpath(os.path.join(os.path.dirname(ts), path))
            if not os.path.exists(resolved):
                fails.append(f'{ts}: requireAsset(\"{path}\") → {resolved} MISSING')
if fails:
    print('\\n'.join(fails)); sys.exit(1)
print('All requireAsset paths resolve.')
"
```

Per failure: record an issue whose `responsible_step` is the step that generates the missing asset (`mesh` for `.glb`, `sfx`/`music` for `.wav`, `scripts` for a `.mat` the scripts must write, `ui` for a missing UI module). `severity: hard` — an unresolved `requireAsset` path fails the Lens to load. Do not claim success while any path is unresolved.

**2. Hand-rolled-UI detection (Hard Rule 3, both channels).** Renders fine, compiles clean — only the grep catches it:
   - **Non-UI scripts** (`<ExperienceName>Main.ts` + controllers, NOT the `*UI.ts` modules): `Component.Text`, `createComponent\(['"]Text`, or `from ['"](Spectacles)?UIKit\.lspkg` → text and UIKit belong in a UI module. Record an issue with `responsible_step: ui` (the fix is a setter/event on the UI `@component`, re-invoked through `/specs-build-ui`), `severity: hard`.
   - **Every `Assets/Scripts/*UI.ts`**: hand-rolled BackPlate — `createComponent\(["']Component\.RenderMeshVisual["']\)` co-located with `SimplePBR|baseColor|baseTex|mainPass\.` assembled into a panel; hand-rolled Button — `Physics\.ColliderComponent` + `Interactable` + `Component\.Text` within ~30 lines building one tap affordance; hand-positioned label stack — sibling `Component.Text` placed by magic-number `setLocalPosition` Y offsets instead of a `FlexLayout`/`GridLayout`. Record with `responsible_step: ui`, `severity: hard`.
   - **Carve-out:** matches inside a function annotated `// per-tile factory — Hard Rule 3 grid-cell carve-out (N = <count>)` called from a `for`/`while` loop with ≥ 30 iterations are exempt — record the audit decision in `deviations[]` (`found N matches: M carve-out, P violations`). No annotation → no exemption.
   - Any hit is an issue for the `ui` step — never a "patch inline" recommendation. Falling back to inline primitives after a tool error is a Hard Rule 4 violation.

**2b. Banned theme-private writes.** Poking a UIKit component's private theme fields compiles clean (they're reached through `as any`) and renders *something* — usually the older theme's look, and it breaks outright on the next kit revision (UIKit 4.0 renamed them from `_styleSnapOS3` to `_styleSystem3`). Use the public setters instead: `setVariant({theme, shape, style})` before `initialize()`, and `setThemeOverride(<theme>)` with the installed UIKit's theme name (`"System3"` on 4.0, `"SnapOS3"` on legacy):

```bash
grep -rnE "_themeOverride\s*=|_(style|shape)(SnapOS|System)[23]\s*=" Assets/Scripts/ --include="*.ts"
```

Any hit → issue with `responsible_step: ui`, `severity: hard`, detail naming the file, line, and the equivalent `setVariant` call. The fix is a re-invocation of `/specs-build-ui` for that module, not an inline patch here. (Matches inside `Cache/` or `Packages/` are vendored kit code and out of scope — this grep is scoped to `Assets/Scripts/` for that reason.)

**2c. Deprecated surface emitted in new UI (`BackPlate`).** `BackPlate` still ships in the kit, so it compiles and renders — but new UI never emits it: a panel is a `Frame`, an inner card/pill/list plate is a `RoundedRectangle`.

```bash
grep -rnE "Scripts/BackPlate|BackPlate\.getTypeName" Assets/Scripts/ --include="*.ts"
```

Any hit → issue with `responsible_step: ui`, `severity: soft`, detail naming the file, line, and which replacement the site wants (Frame if it is the panel surface, `makeCardRect` if it is an inner card). Soft rather than hard because the panel does render; the fix is still a `/specs-build-ui` re-invocation for that module, not an inline patch. A `BackPlate` in a scene the build did not author (a pre-existing module outside this build's `modules[]`) is out of scope — record it in `deviations[]` instead.

**2d. Hand-made dismiss affordance (review check, not a clean grep).** A panel's close affordance is the Frame's own button — `showCloseButton = true` inside `onInitialized`, then `closeButton.onTriggerUp`. A hand-composed "X" `Button` in the header, or a bottom-of-panel "Close" button row, is a defect even though it works.

A grep alone is too fuzzy here (a "Close" string can legitimately be a log line or a non-panel control), so this is a **read**, not a match count. Narrow the read with:

```bash
grep -rnE "\"(Close|Dismiss|X)\"|leadingIcon.*[Cc]lose|closeBtn|CloseRow" Assets/Scripts/ --include="*UI.ts"
```

Then, for each `*UI.ts` that also creates a `Frame`, confirm from the file that its dismiss path is `frame.closeButton` and not a Button the module built. Two signatures are conclusive: a `Button` whose `ElementContent` text or icon is close/X/dismiss, and a footer row whose only child is that button. Either → issue with `responsible_step: ui`, `severity: soft`, detail naming the file, the line that creates the button, and the `showCloseButton` replacement. A module that creates a Frame **and** sets `showCloseButton = true` **and** builds its own close button has two affordances for one panel — that one is `severity: hard`.

**3. Music playback (only when a music entry was planned).** The track's `requireAsset('../GeneratedSFX/<MusicName>.wav')` must pair with a `.play(-1)` in the same script — a lone `.play(1)` is a one-shot bug (loads, plays once, silences). Missing → record an issue with `responsible_step: scripts`, `severity: hard` (the fix adds the `specs-runtime-patterns.md` §9 block in `onAwake()` and recompiles).

**3b. File-size / module-shape lint (the 1000-line-file problem).** Reviewers cannot review monoliths, and the plan's Module shape rule already sets the thresholds (~250 lines wants a stated reason, ~400 should normally be split). Enforce them here: `wc -l Assets/Scripts/*.ts` —
   - **> 400 lines with no header-comment reason** → issue, `responsible_step: scripts` (or `ui` for a `*UI.ts`), `severity: soft`, detail naming the concerns that should split out.
   - **> 700 lines** → `severity: hard` regardless of any stated reason — at that size the reason is a rationalization; the fix is a split along the ownership lines the plan's `script_plan.ownership` already declares. Generated/vendored files (`Cache/`, `Packages/`) are exempt; authored scripts are not.

**4. Exposure discipline (Hard Rule 5 "Expose every opinionated choice").** Four greps — all route to `responsible_step: scripts` (or `ui` when the knob lives on a UI module):
   - **Buried config/balance (mechanics tier):** a `*Config.ts` (or in-file `const`) holding a stat/balance table (per-tower cost/damage/range/fire-rate) or a difficulty curve (per-wave HP/speed growth, spawn-count formula) whose tunable fields have **no** matching `@input` on the owning controller → these are opinions, not invariants; the fix exposes them as grouped `@input`s (config = default source) or a data asset. `severity: soft`.
   - **Claimed-but-unwired exposure:** a comment asserting a value is exposed / retunable / an `@input` / Inspector-editable, with **no** matching `@input` declaration for it anywhere → the fix makes the claim true (add the `@input`) or deletes the comment. A false "a designer can retune this" comment is itself the violation. `severity: soft`.
   - **Knob for a non-feature (expose only what you built):** an `@input` that no code path reads (grep the field name across `Assets/Scripts/`; a declaration with zero other references is dead), or an asset-backed `@input` / `requireAsset` feature (audio, texture, mesh slot) whose backing asset isn't on disk → the knob is a config surface for a capability that doesn't exist. The fix drops the `@input` (and its widget/hint), or implements and verifies the feature. `severity: soft`.
   - **Knob-cap overflow (lower tiers):** on an `effect/utility` or `interactive` build, a component exposing more than ~6 tunable `@input`s (references excluded) → the fix trims to the highest-value knobs, demoting the rest to in-code defaults. The mechanics-driven tier is exempt when a balance table justifies the surface. `severity: soft`.

## 2. Definition-of-done sign-off

Run the sign-off checklist in `lens-studio-field-notes` → **"Definition of done (Specs builds)"** — the canonical manifest ↔ disk ↔ scripts audit (every promised asset on disk AND wired into the scripts that need it; a gap is a retry for the responsible skill, not a fresh plan). Record each gap as an issue tagged with the step that owns the missing/unwired artifact. Additions specific to a full build:

- **The build is on disk, not just in the session.** `Assets/Scene.scene` must have an mtime after the bootstrap step and must actually contain the authored root names (`grep -c` them). An unsaved build is `responsible_step: bootstrap`, `severity: hard` — everything reverts the moment Lens Studio closes, and nothing in the working tree reproduces it.
- **No two co-visible panels are coplanar.** `bootstrap-scripts`'s placement report already measures this (an x/y-overlapping panel pair with under 2 cm of z separation is an `overlaps` hit); confirm the pair list is empty rather than re-deriving the geometry. A non-empty pair → `responsible_step: bootstrap-scripts`, `severity: hard` — coplanar overlapping surfaces flicker at runtime and a still capture will not show it. Mutually exclusive panes are exempt. `mode: runtime`.
- **A placed mesh must render at its known size — measure in cm, and when it's off, walk the tree to find why.** The question is "does it render at the size we normalized it to." Measure the object's rendered size in cm from `QueryRuntimeSceneTool` `bounds` (`max − min`) and compare to the real `aabb_cm` in `.clad/steps/mesh.json`. Within ~2× → correct, sign off. Far off (e.g. ~3000 cm vs a known 30 cm) → **do not flag "oversize" and guess the owner; investigate the cause first**, which both confirms the defect is real and pins the responsible step. `worldScale` is just the product of every ancestor's `localScale`, so decompose it — but fetch it as **one consistent snapshot, not a node-by-node loop.** In a single `QueryRuntimeSceneTool` call, request the instance's `bounds`, its `transform`, and its whole ancestor chain by nesting `parent { transform { localScale } }` up to the scene root (verify upward-nesting depth once via `capabilities`; it is supported). Reading the chain across separate calls is a real bug on runtime-instantiated content: a concurrent re-instantiation between reads (a runtime instance's `uniqueId` can go null mid-audit) splits the walk across two scene states and yields a stale verdict — the by-name discovery→read seam has the same hazard, so re-resolve and retry if the `uniqueId` churns. For a correctly-placed mesh the product is one import's worth — the sole prefab root at ~100 (glTF meters → LS cm), every wrapper at 1. The surprising node tells you the cause:
  - **Two nodes each ~100** — a wrapper *and* its child prefab both carrying the ×100 → the **double-prefab wrapper leak** (see `specs-bootstrap-scene` SKILL "plain wrapper" rule). `responsible_step: mesh` (the re-bind self-heals a stray wrapper scale; structural origin is `skeleton`'s placement wrapper), `severity: hard`.
  - **A script-set scale on the instance** (grep the spawning script for a `localScale`/`.scale` assignment) → `responsible_step: scripts`, `severity: hard`.
  - **Single prefab root ~100, all wrappers 1, but the geometry is still the wrong size** → the GLB itself is authored off → `responsible_step: mesh`, `severity: hard`.
  - **Chain is clean** (one root ~100, wrappers 1, geometry right) yet the bounds read huge → the `bounds` read silently degraded to a meaningless round fallback cube (±100/±1500/±5000, which `bounds`/`GetBoundingBox` can return for a prefab root). The size is actually fine — **unverifiable reading, not a defect.** The tree-walk *is* the disambiguator here: a sane scale chain means the huge bounds is simply wrong, so you need no second probe.
  Then capture the region (`CaptureRuntimeViewTool`) to corroborate and open the issue tagged to the step the walk identified — do not sign off `ok` on a confirmed one. A confirmed contradiction overrides `bootstrap-scripts`' placement lists, which measure authored anchors rather than the real instantiated geometry (a runtime-spawned or mis-scaled instance is exactly what those lists cannot see). Two traps this procedure removes, both of which can produce a false "100× oversize" hard-fail on a correctly-sized runtime instance: reading the raw `worldScale = 100` as "100× oversize" (it is a scale *factor*, not a size, and 100 is the normal import), and trusting a fallback-cube bounds read.
  Three scope limits to state honestly rather than assume away:
  - **This step only measures content that exists at rest.** Objects created on interaction (marks spawned on tap) do not exist when `audit-runtime` runs, and this step has no gesture/`Agent` tools to spawn them — so it *cannot* size them. On-interaction geometry is measured by the orchestrator's pre-route play-through (`specs-build-experience` → "Measure runtime-spawned content the moment it appears", `references/fix-mode-routing.md`); if that drive did not run or could not tap, an oversize *mark* is unmeasured — report it as an unverified gap, do not imply the size check covered it.
  - **For runtime instances, `QueryRuntimeSceneTool` bounds is the only instrument — there is no fallback-immune measurer.** The editor-side `measure-world-aabb.ts` reads the *editor* scene and cannot see a runtime-instantiated object, and this step has no `ExecuteEditorCode`. So the "clean chain but huge bounds = misread" branch is the sole defense against a fallback-cube read on runtime content; lean on the scale chain, and where it can't settle it, say "unverifiable," never "oversize."
  - **Gate to a settled state before judging animated spawn-ins.** Grow/pop-in content uses a wrapper tweening `localScale` 0→1 with the prefab child at ~100; measured mid-tween it reads *under* size and the wrapper matches none of the branches above. That is animation in progress, not a defect — wait for the tween to settle (or skip the size verdict and note it) rather than flagging it. `mode: runtime`.
- **No diagnostic objects left in the scene.** Query for the probe/marker/ruler objects a build step spawns to measure and must delete — named `ZZProbe_*`, at or near the scene root — and for enabled objects absent from the plan's layout. Any hit → `responsible_step` = the step that created it (usually `bootstrap` or `skeleton`), `severity: soft` — they render in front of the experience.
- **The scene has exactly one `ThemeManager`, first in root order, with `_theme` set to the installed UIKit's current theme: `"System3"` on UIKit 4.0, `"SnapOS3"` on legacy SpectaclesUIKit (see `/specs-bootstrap-scene`).** On legacy SpectaclesUIKit this is the whole theme wiring, and its absence is silent: `ThemeService` falls back to SnapOS2 and every panel renders in the wrong theme with no error, no log line, and a clean compile. Verify with `scene-graphql`: query the root SceneObjects in order, find the one carrying a `ScriptComponent` whose script is the kit's `ThemeManager`, and read its `_theme` input. Three distinct failures, all `responsible_step: bootstrap-ui`, `severity: hard` — **absent** (no such object; on UIKit 4.0 `ThemeService` falls back to System3, so there an absent ThemeManager is `severity: soft`), **wrong value** (`_theme` unset, or not the installed UIKit's current theme — `"System3"` on 4.0, `"SnapOS3"` on legacy), and **not first** (a UI module root precedes it, so the theme lands after those visuals were built). More than one ThemeManager is `severity: soft` — a race over which `setTheme` wins, and the fix is to delete the extras. This check needs a live scene, so it belongs to `mode: runtime`; the private-field grep above is its static-side counterpart.
- **`synckit_hygiene` triple** verified when SyncKit was installed (Hard Rule 8): `examples_disabled`, `start_mode == "START_MENU"`, `device_tracking_world`. Any not satisfied → issue with `responsible_step: bootstrap`, `severity: hard`.
- **Machine-readable summary keys** all present (empty arrays, never omitted keys). A missing key → `responsible_step: bootstrap` (or the orchestrator assembling the summary), `severity: soft`.
- **Hard cap: 3 audit→fix cycles per build** (enforced by the orchestrator). If cycle 3 still fails, the remaining gaps are reported as "Self-caused limitations," not fixed.

## Standalone invocation (one step, no pipeline)

You do not need a full build to run this. This skill serves two steps — `audit-static` and `audit-runtime`, selected by `mode`.

**Preconditions:** Lens Studio running with the target project open, MCP registered, signed in. `.clad/steps/plan.json` holds the validated plan (the `plan` step wrote it there), which is where most of this step's input is sliced from.

When a required input is missing and no `.clad/` record supplies it, **ask for it and stop** — do not invent a value and do not fall back to a lesser output (field-notes Hard Rule 1).


## Two modes — the audit runs as two halves

The audit is split by *what it needs* — run as one unit at the end it is pure added wall clock, and most of it needs no editor at all.

- **`mode: static`** (step `audit-static`; depends on `scripts` + `ui`) — everything checkable on disk: the Hard Rule 3 greps, `requireAsset` resolution, exposure discipline, and the manifest↔disk↔scripts three-way check. Needs no Lens Studio, so it runs **concurrently with `bootstrap-scripts`** instead of after it.
- **`mode: runtime`** (step `audit-runtime`; depends on `bootstrap-scripts`) — the facts only a running editor settles: scene structure and placement, the ThemeManager wiring, that the project is saved to disk, and that no diagnostic debris survives. Its payload carries `audit-static`'s `issues[]`; do not repeat them, and if you contradict one, say so explicitly.

Run only the half you were asked for. A `static` run that guesses at scene state, or a `runtime` run that re-greps the filesystem, defeats the split and double-reports.

## Output contract

End the audit with **exactly one** fenced ```` ```STEP_RESULT ```` JSON block for your mode. Before returning, also write your STEP_RESULT JSON to `.clad/steps/<mode>.json` in the project (create the dir if needed) — the orchestrator and downstream steps read your payload from there.

Required fields, both modes:
- `step` — `"audit-static"` or `"audit-runtime"`
- `status` — `ok` | `partial` | `blocked`
- `errors[]`, `deviations[]` — strings (record the carve-out audit decision in `deviations[]`)
- `retries` — integer ≥ 0
- `issues[]` — each `{ category (string), severity ("hard" | "soft"), file (optional string), detail (string), responsible_step ("plan"|"init"|"icon"|"mesh"|"sfx"|"music"|"ui"|"scripts"|"bootstrap-ui"|"bootstrap-scripts") }`

`audit-runtime` additionally reports `scene_saved` (boolean), `debris_found[]`, and **`runtime_log_status`** (`clean`|`errors`|`unknown`, never omitted). A lens that would not render (crash loop, `Rendering failed`, `exception while processing lens`) cannot return `status: ok` — bounds measured on a crash-looping lens are unreliable; report `errors` and downgrade to `blocked` unless the render recovers.

A clean build returns `status: ok` with `issues: []`. Never write or edit project files from this skill — reporting the issue is the whole job.
