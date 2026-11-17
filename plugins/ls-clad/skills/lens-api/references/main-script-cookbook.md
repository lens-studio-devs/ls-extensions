# Main-script cookbook — compose, don't invent

Read this BEFORE writing the main `@component` + helpers. Every recipe below is
verified Lens-runtime code. Build your game by composing these recipes with your
plan's names and numbers. If a mechanic isn't here, build it from these pieces —
do not invent new APIs.

## Order of work (do not deviate)

1. **Write the main `@component` file FIRST** — the full game orchestrator,
   shaped like the worked example below. Helpers come after; the main file is
   the deliverable that matters most.
2. Write each helper, then recompile after the main file and after every helper.
3. Before any `requireAsset(path)`, confirm the file exists in Assets (list the
   folder) — reference the real filename (`.glb`, `.wav`, `.png`; there are no
   `.prefab` files).

## TypeScript discipline (the five defects that sink most scripts)

1. **Declare every field you use.** If a method reads `this._riseStart`, the
   class must declare `private _riseStart: number = 0`. Same spelling, with the
   underscore or without — never both.
2. **Export exactly what you import — named exports only.** If main does
   `import { easeOut, lerp } from "./Easing"`, then Easing.ts must contain
   `export function easeOut(...)` and `export function lerp(...)`. Never
   `import X from "./X"` (no default exports anywhere).
3. **Statics via the class name.** `GameRules.MAX_HEIGHT`, never
   `this.MAX_HEIGHT`.
4. **Wire every handler end-to-end.** Declaring `onRelease` and subscribing
   `x.onRelease.add(...)` only works if something calls `onRelease.invoke(...)`.
   Trace each event: emitter → invoke → subscriber.
5. **Compile early: recompile right after the main file, again after each
   helper.** Fix errors minimally; never `rm` a file that fails to compile —
   edit it in place.

## API card — these exist; compose from them

| Need | Verified API |
|---|---|
| per-frame time | `const dt = getDeltaTime()` (inside an `UpdateEvent` handler) |
| positions | `obj.getTransform().getWorldPosition()` / `.setWorldPosition(v)` / `.getLocalPosition()` / `.setLocalPosition(new vec3(x,y,z))` |
| scale / rotation | `.setLocalScale(new vec3(...))` / `.setLocalRotation(quat.angleAxis(rad, vec3.up()))` |
| vectors | `vec3.zero()`, `vec3.up()`, `a.add(b)`, `a.sub(b)`, `a.uniformScale(s)`, `a.length` |
| lifecycle | `this.createEvent("OnStartEvent").bind(...)`, `this.createEvent("UpdateEvent").bind(...)` |
| timer | `this.createEvent("DelayedCallbackEvent")` then `.bind(cb)` + `.reset(seconds)` |
| assets | `requireAsset("../GeneratedMeshes/X.glb") as ObjectPrefab`, `... as AudioTrackAsset`, `... as Texture` |
| spawn | `const o = PREFAB.instantiate(parentSceneObject)` |
| audio | `audio.play(1)` (SFX), `bgMusic.volume = 0.4; bgMusic.play(-1)` (loop) |
| attach a WAV to audio | `const ac = obj.createComponent("Component.AudioComponent") as AudioComponent; ac.audioTrack = requireAsset("../GeneratedSFX/X.wav") as AudioTrackAsset` — the property is `audioTrack` (NOT `audioTrackAsset`, NOT `trackAsset`) |
| collider | `obj.createComponent("Physics.ColliderComponent")` + `Shape.createBoxShape()` (set `shape.size = new vec3(cm,cm,cm)`, assign `collider.shape = shape` — the property is `shape`, NOT `box`) |
| pinch/tap on an object | IK `Interactable` (recipe R3 — always `createComponent(Interactable.getTypeName())`, never `createComponent("Interactable")`) |

**These do NOT exist — never call them:** `getElapsedTime()`, `setGameLoop`,
`Physics.BodyType`, `Material.create()`, `createDefaultMaterial()`,
`scene.createAsset(...)`, `animate({...})`, `collider.box`,
`audio.audioTrackAsset` / `audio.trackAsset` (it's `audioTrack`),
`sceneObject.createSceneObject(...)` (use
`global.scene.createSceneObject("name")` then `setParent`).

## Recipes

**R1 — per-frame motion (velocity + gravity)**
```typescript
private velocity: vec3 = vec3.zero()
private onUpdate(): void {
  const dt = getDeltaTime()
  this.velocity = this.velocity.add(new vec3(0, this.gravity * dt, 0))
  const t = this.target.getTransform()
  t.setWorldPosition(t.getWorldPosition().add(this.velocity.uniformScale(dt)))
}
```

**R2 — spawn a prefab**
```typescript
const ITEM_PREFAB = requireAsset("../GeneratedMeshes/Item.glb") as ObjectPrefab
// in a method:
const item = ITEM_PREFAB.instantiate(this.sceneObject)
item.getTransform().setLocalPosition(new vec3(0, 0, -110))
```

**R3 — pinch/tap on an object (IK Interactable, works with mouse in preview)**
```typescript
import { Interactable } from "InteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
// object needs a collider so it is targetable:
let collider = obj.getComponent("Physics.ColliderComponent")
if (!collider) {
  collider = obj.createComponent("Physics.ColliderComponent")
  const shape = Shape.createBoxShape(); shape.size = new vec3(10, 10, 10)  // cm
  collider.shape = shape
}
let inter = obj.getComponent(Interactable.getTypeName()) as Interactable
if (!inter) inter = obj.createComponent(Interactable.getTypeName()) as Interactable
// subscribe inside OnStartEvent (specs-interaction-recipes §1 init-order rule)
inter.onTriggerStart.add(() => this.onPicked(obj))
```

**R4 — proximity / passed-through scoring**
```typescript
const d = a.getTransform().getWorldPosition()
        .sub(b.getTransform().getWorldPosition()).length
if (d < this.scoreRadius) this.onScore()
```

**R5 — delayed action (respawn, timed hide)**
```typescript
private respawnEvent!: DelayedCallbackEvent
// onAwake:
this.respawnEvent = this.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent
this.respawnEvent.bind(() => this.respawn())
// when needed:
this.respawnEvent.reset(0.7)   // seconds
```

**R6 — audio wiring**
```typescript
@input @allowUndefined sfxAudio!: AudioComponent
@input @allowUndefined bgMusicAudio!: AudioComponent
// start handler:
if (this.bgMusicAudio) { this.bgMusicAudio.volume = 0.4; this.bgMusicAudio.play(-1) }
// on events:
if (this.sfxAudio) this.sfxAudio.play(1)
```

**R7 — helper module shape**
```typescript
// Pure logic helper (no scene access): plain class / functions, named exports.
export class GameRules { static MAX = 10; scoreFor(d: number): number { return d < 5 ? 2 : 1 } }
// Scene-touching helper: BaseScriptComponent with @component, like the main.
```

## Complete worked example (generic — adapt names/numbers to YOUR plan)

```typescript
import { GameUI } from "./GameUI"
import { Interactable } from "InteractionKit.lspkg/Components/Interaction/Interactable/Interactable"

const ITEM_PREFAB = requireAsset("../GeneratedMeshes/Item.glb") as ObjectPrefab

@component
export class CollectGame extends BaseScriptComponent {
  @input uiHud!: GameUI
  @input @allowUndefined sfxAudio!: AudioComponent
  @input @allowUndefined bgMusicAudio!: AudioComponent
  @input spawnEverySec: number = 2.0
  @input debugColliders: boolean = false

  private score: number = 0
  private sinceSpawn: number = 0
  private items: SceneObject[] = []

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.onStart())
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
    if (this.debugColliders) this.setColliderDebugAll(this.sceneObject)
  }

  private setColliderDebugAll(root: SceneObject): void {
    const c = root.getComponent("Physics.ColliderComponent")
    if (c) c.debugDrawEnabled = true
    for (let i = 0; i < root.getChildrenCount(); i++) this.setColliderDebugAll(root.getChild(i))
  }

  private onStart(): void {
    if (this.bgMusicAudio) { this.bgMusicAudio.volume = 0.4; this.bgMusicAudio.play(-1) }
    this.uiHud.setScore(0)
  }

  private onUpdate(): void {
    this.sinceSpawn += getDeltaTime()
    if (this.sinceSpawn >= this.spawnEverySec) { this.sinceSpawn = 0; this.spawnItem() }
  }

  private spawnItem(): void {
    const item = ITEM_PREFAB.instantiate(this.sceneObject)
    item.getTransform().setLocalPosition(new vec3((Math.random() - 0.5) * 40, -10, -110))
    let collider = item.getComponent("Physics.ColliderComponent")
    if (!collider) {
      collider = item.createComponent("Physics.ColliderComponent")
      // size from the mesh's real aabb_cm in the plan/build notes, not a guess:
      const shape = Shape.createBoxShape(); shape.size = new vec3(12, 16, 12)
      collider.shape = shape
    }
    const inter = item.createComponent(Interactable.getTypeName()) as Interactable
    inter.onTriggerStart.add(() => this.collect(item))
    this.items.push(item)
  }

  private collect(item: SceneObject): void {
    const i = this.items.indexOf(item)
    if (i >= 0) {
      this.items.splice(i, 1)
      item.destroy()
      this.score += 1
      this.uiHud.setScore(this.score)
      if (this.sfxAudio) this.sfxAudio.play(1)
    }
  }
}
```
