<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Snapchat (mobile in-camera Lens) — bootstrap shape & entry boilerplate

On-demand detail for `snapchat-experience-builder`. Consulted at **Phase 2f** (entry boilerplate) and **Phase 3a** (bootstrap). Mobile drives the *same* Lens Studio via the *same* `VirtualScene` MCP surface and TypeScript scripting as Specs, so the **two-phase invariant is unchanged**: Phase A `create` (bare ScriptComponents) → `RecompileTypeScriptTool` → Phase B `modify` (wire `@input`s). Only the scene *shape* differs. For exact VirtualScene / scene-graphql syntax read `ls-clad:scene-construction` → `references/virtual-scene.md` and `references/scene-graphql.md` before writing.

## Scene shape: two layers (see `snapchat-ui-and-spatial.md`)

A mobile build authors two layers instead of one fixed world panel:

1. **World / logic layer** — main root + ScriptComponent, world-content group roots, controllers, and the UI-module ScriptComponents. Authored through **VirtualScene** exactly like Specs.
2. **Screen-space UI layer** — an orthographic camera on the `Ortho` render layer → a **Full-Frame/Safe `ScreenRegion`** → the `ScreenImage`/`ScreenText` elements the UI modules drive. Build it with the screen presets (below); the ortho camera carries a **camera-attached `Canvas`** by default (screen-space) — keep it (`camera-and-rendering` treats a camera Canvas as required for screen-space rendering). Do NOT add a *child* Canvas (that's 2D-in-3D under a perspective camera).

**Key divergence — screen-space objects need preset creation.** `OrthographicCameraObjectPreset` and the `ScreenImage`/`ScreenText` presets are created via `createSceneObjectFromPreset` (a **scene-graphql** operation — one of the few SceneObject presets VirtualScene doesn't cover; see `lens-studio-field-notes` → Scene & Asset Tools, and `camera-and-rendering` → "Creating Screen-Space Objects"). A manually assembled `Component.Image` will not composite in screen space. So the bootstrap is **not** pure VirtualScene: create the screen objects via the `ScreenImage`/`ScreenText` presets (`createSceneObjectFromPreset`), which establish + reuse a single ortho camera + a per-element Full-Frame `ScreenRegion` — do NOT separately create an `OrthographicCameraObjectPreset` (see `snapchat-ui-and-spatial.md`), then wire the UI module's `@input`s to them in the VirtualScene Phase B `modify` (or, for a reference VirtualScene genuinely can't express, one targeted `scene-graphql setProperty` after Phase B — the same single-property carve-out the Specs bootstrap allows). This is still single-writer-per-surface: presets create the screen objects; VirtualScene owns the script/`@input` graph; no mixed-surface *patching* of a bad apply.

## Bootstrap sequence

```
Write Assets/Scripts/<ExperienceName>Main.ts            ← orchestration only
Write Assets/Scripts/<ExperienceName>State.ts           ← pure logic (if warranted)
Write Assets/Scripts/<ExperienceName><Panel>UI.ts       ← passive view (authored Phase 2d)
Write controllers as needed
RecompileTypeScriptTool                                 ← first compile before bootstrap

# Screen-space objects (presets — scene-graphql):
createSceneObjectFromPreset ScreenImage/ScreenText …         ← builds the screen layer: 1st creates the ortho camera (+ camera-Canvas) + a Full-Frame ScreenRegion; each reuses that one camera
scene-graphql addComponent (componentType: "InteractionComponent")  ← on each TAPPABLE ScreenImage; BARE name (NOT "Component.InteractionComponent"); preset omits it

VirtualScene apply (Phase A)   ← create main root + world/logic group roots + controller &
                                 UI-module SceneObjects with BARE ScriptComponents (no wiring)
RecompileTypeScriptTool        ← registers @input slots against live ScriptComponents
VirtualScene apply (Phase B)   ← modify: wire @sceneObject refs (UI modules, controllers,
                                 anchors, screen-object refs) + scalar tunables, one batched apply
```

Budget: **Phase A + Phase B + one optional retry = max 3 VirtualScene applies, counting EVERY apply** — a probe-cleanup `delete` or a separate discover-then-tune tweak counts too (see the agent's Hard Rule 5); a 4th apply is a hard stop → surface `bootstrap_failed`. No SyncKit / `EnableOnReady` parenting (Specs-only; dropped). No `id` key on nested components inside `create` (same strict allowlist as Specs — `id` is valid on the SceneObject entry and on assets, never on a nested component). Recovery for a bad apply = re-issue a corrected apply, never patch across surfaces.

## What the screen-object presets materialize (so you never probe live)

Create these via `createSceneObjectFromPreset` (scene-graphql). They are **stable** — do NOT create throwaway "probe" objects to discover their shape (a probe forces a cleanup `delete` that burns a VirtualScene apply — Hard Rule 5). **The first `ScreenImage`/`ScreenText` preset also auto-creates the ortho camera (+ a camera-attached Canvas) and a Full-Frame `ScreenRegion`; each subsequent one reuses that one camera and adds its own region** — so don't separately create an `OrthographicCameraObjectPreset`.

| Preset | Produces | Key facts |
|---|---|---|
| `ScreenImageObjectPreset` | SceneObject + `ScreenTransform` + `Image`, with its **own** Material (per-instance — tint each independently). **No `InteractionComponent`** — see next row. | `mainPass.baseTex` / `mainPass.baseColor`. A **solid-color fill needs a real (e.g. 1×1 white) `baseTex`** — a null texture renders the missing-texture checkerboard, not a solid. Icons (real texture) → `StretchMode.Fit`; solid fills → `StretchMode.Stretch`. |
| **Tappable button** = `ScreenImage` + an `InteractionComponent` | the preset does **not** include it | **Attach it with the BARE type name:** `scene-graphql addComponent(componentType: "InteractionComponent")` on the ScreenImage object. ⚠️ **NOT** `"Component.InteractionComponent"` — that's the *runtime* name; the editor's `addComponent` rejects it with `Unknown entity type`. (Verified LS 5.24: after adding it by the bare name, the runtime `getComponent("Component.InteractionComponent")` finds it and `onTap` fires on tap.) Without the component, `getComponent(...)` is `null` and `onTap.add(...)` throws. |
| `ScreenTextObjectPreset` | SceneObject + `ScreenTransform` + `Text` | `text`, `size`, `horizontalAlignment`, `verticalAlignment`, `textFill.color`. |
| `ScreenTransformObjectPreset` | SceneObject + bare `ScreenTransform` | a layout / group root. |

- **`ScreenTransform` writes:** `anchors = Rect.create(left, right, bottom, top)` — all in `[-1, 1]`; `offsets = Rect.create(...)` for inset. (`Rect` fields are `left/right/bottom/top`, not `x/y/w/h`.)
- **Textures and audio are NOT serialized** into `.virtual-scene.json` — `requireAsset` them at runtime; don't expect them in a `read`.
- **Batch creation:** if you need many screen presets, create them in **one `ExecuteEditorCode` loop**, not N separate `createSceneObjectFromPreset` MCP round-trips.
- **Phase B UUID harvest:** to wire component refs by `@id:`, pull UUIDs from the scene read, e.g. `jq -r '.sceneObjects[] | select(.name=="HUD") | .components[] | select(.type=="ScriptComponent") | .id' .virtual-scene.json`.

> The **orthographic camera setup** and how the camera `size` relates to the visible area live in `snapchat-ui-and-spatial.md`. The ortho camera carries a camera-attached `Canvas` by default — keep it (required for screen-space rendering per `camera-and-rendering`); a *child* Canvas is for 2D-in-3D under a perspective camera. Set the camera `size` to fit the content (visible area is `size`-relative); this doc prescribes no canonical value.

## Entry boilerplate — `<ExperienceName>Main.ts`

Doctrine: semantic roots (UI objects, anchors) are **authored by the bootstrap and wired to these `@input`s**; the main script validates refs, owns state, pushes to the passive-view UI, and does world-layer touch picking via a screen-ray. No IK, no collider-wrapper `buildScene()` — mobile picking is a camera raycast (`physics` → `references/draggable-pattern.md`).

```typescript
import { ScorePanelUI } from "./<ExperienceName>ScorePanelUI";  // passive view (Phase 2d)

@component
export class Main extends BaseScriptComponent {
    // Wired by the bootstrap to the UI module's ScriptComponent. Typed as the UI
    // class directly — the wired ScriptComponent resolves to the class instance at
    // runtime, so no `.getScript()` and no cast.
    @input scorePanel!: ScorePanelUI;

    // Perspective camera used for screen→world raycasts against 3D content.
    @input camera!: Camera;

    private probe = Physics.createGlobalProbe();
    private score = 0;

    onAwake() {
        // Fail loudly if the bootstrap did not wire a required authored ref.
        if (!this.scorePanel || !this.camera) {
            print("Main: required @input not wired (scorePanel / camera). Check Phase B.");
            return;
        }
        global.touchSystem.touchBlocking = true;   // claim taps from Snapchat's gestures

        this.scorePanel.setScore(this.score);
        this.scorePanel.onStart = () => this.startGame();   // Channel B: callback, NOT IK Event

        // World-layer tap picking (only if 3D content is tappable). Screen UI taps are
        // handled inside the UI module via InteractionComponent — not here.
        this.createEvent("TapEvent").bind((e) => this.onTap(e.getTapPosition()));
    }

    private onTap(screenPos: vec2): void {
        const camTr = this.camera.getTransform();
        const start = camTr.getWorldPosition();
        const worldPos = this.camera.screenSpaceToWorldSpace(screenPos, 1);
        const end = start.add(worldPos.sub(start).normalize().uniformScale(1000));
        this.probe.rayCast(start, end, (hit) => {
            if (!hit) return;
            // act on hit.collider.getSceneObject() — collect, launch, select, …
        });
    }

    private startGame(): void {
        this.score = 0;
        this.scorePanel.setScore(this.score);   // push state into the passive view
    }
}
```

## Passive-view module — `<ExperienceName>ScorePanelUI.ts`

Reads its preset-created screen objects' components and drives them; exposes setters (data in) + callbacks (intent out); holds no domain state. No `Component.Text`/`Component.Image` creation here for the panel backing — those objects are preset-authored by the bootstrap and referenced via `@input`; this module *drives* them.

```typescript
@component
export class ScorePanelUI extends BaseScriptComponent {
    // Preset-created screen objects wired by the bootstrap.
    @input scoreText!: Text;              // Component.Text on a ScreenText object
    @input startButton!: SceneObject;     // ScreenImage + InteractionComponent

    // Channel B — intent out. Typed callback, not a IK Event. (For multiple
    // subscribers, add a ~10-line local Event<T> here — still no IK import.)
    onStart: (() => void) | null = null;

    onAwake() {
        // The bootstrap must have attached a Component.InteractionComponent to startButton
        // (the ScreenImage preset does NOT include one). Guard so a wiring miss fails loudly.
        const interaction = this.startButton.getComponent("Component.InteractionComponent");
        if (interaction) interaction.onTap.add(() => { if (this.onStart) this.onStart(); });
        else print("ScorePanelUI: startButton has no InteractionComponent — bootstrap must addComponent it.");
    }

    // Channel A — data in.
    setScore(n: number): void {
        this.scoreText.text = String(n);   // sanitize first if the source is untrusted (2d-ui.md)
    }
}
```

## Notes
- **Audio:** the LowLatency/LowPower playback split in `ls-clad/references/essential-patterns-code.md` §8/§9 is Specs *device-power* behavior — a phone Lens does not need that handling. Play SFX/music with a plain `AudioComponent` (`play(1)` one-shot, `play(-1)` loop for a background bed). The music-description derivation (`music-description-heuristic.md`) is fully portable and used unchanged.
- **`faceDirection` yaw math** (`atan2(dir.x, -dir.z)`) in `essential-patterns-code.md` §10 is portable (Lens Studio right-handed, +Z forward) — reuse for orienting world content toward the camera/target.
