<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

> **Lens Runtime API** — All code here targets the Lens scripting runtime (StudioLib). Do not use these patterns in Editor API code.

# Animation Playback (imported clips and script-built tweens)

Playing an imported character/skeletal animation at runtime. This covers **imported `AnimationAsset` → `AnimationPlayer`** playback; for building or skinning geometry in code see `mesh-builder-scripting/references/skinned-meshes.md`.

## Playing clips: `AnimationPlayer` in code, or an Asset Library state machine

For a Unity-style animator / state-machine authoring workflow, install a state-machine component from the **Asset Library**: **Animation State Graph Player** (the current node-graph state machine, authored with its **Animation State Graph Editor** plugin) or the older **Animation State Manager**. These drive your clips through states and transitions without hand-written blend code.

For code-driven playback, the scripting runtime has no built-in `Component.Animator` class — you drive the clips directly: `AnimationAsset` (imported, read-only clip data) played through `AnimationClip` instances hosted on a `Component.AnimationPlayer`, with `Component.AnimationMixer` / `AnimationMixerLayer` for layered blending (the analog of Unity's AnimationLayer). Look those classes and their members up in `Support/StudioLib.d.ts`.

Skeletal animation is **not embedded in the scene/model FBX** — each per-clip FBX imports as its own `AnimationAsset` (async import; poll the `.fbx.meta`). Clips **retarget by bone name** automatically, so a clip authored on one rig plays on another rig with matching bone names.

## Wiring a clip

```typescript
// asset: an imported AnimationAsset (e.g. via requireAsset or an @input)
const clip = AnimationClip.createFromAnimation("run", animAsset);
clip.playbackMode  = PlaybackMode.Loop;   // see PlaybackMode in StudioLib.d.ts for the members
clip.playbackSpeed = 1.0;
clip.weight        = 1.0;                  // 1 overrides earlier clips, <1 blends

const player = sceneObject.getComponent("Component.AnimationPlayer") as AnimationPlayer;
player.addClip(clip);
player.playClip("run");
```

Drop the zero-length default clip that the import may add. If you're driving playback purely in code (rather than using a state-machine component above), **rebuild transitions in TypeScript and blend by hand** by ramping `clip.weight` per frame. Use **one `AnimationClip` instance per clip name** — never crossfade a clip against itself.

## Script-built tweens (native animation, no package)

To move, scale, rotate or fade an object, build the animation in code with Lens Studio's own
animation system and play it on an `AnimationPlayer`. No tween library is needed. The
`AnimationExamples` package in the Asset Library has eight worked examples of this pattern (scale
squish, push out, opacity, finish events, timestamp events, authored assets).

```typescript
// Ease scale 1 → 1.4 with a spring-out curve. Easing = CSS cubic-bezier control points (x1, y1, x2, y2):
// ease-in-out (0.42, 0, 0.58, 1), ease-out (0, 0, 0.58, 1), spring-out (0.34, 1.56, 0.64, 1).
const curve = (from: number, to: number) => AnimationCurve.createEasingCurve(from, to, 0.34, 1.56, 0.64, 1)
const track = AnimationPropertyTrack.createVec3FromCurves(curve(1, 1.4), curve(1, 1.4), curve(1, 1.4))

const layer = AnimationPropertyLayer.create()
layer.setProperty(AnimationPropertyLayer.TransformScale, track)

const asset = AnimationAsset.create()
asset.addLayer(target.name, layer)   // the layer drives the object with this name
asset.createEvent("finished", 1.0)   // AnimationPlayer has no onFinish; an event at the end is the hook

const clip = AnimationClip.createFromAnimation("squish", asset)
clip.playbackMode = PlaybackMode.Single

const player = target.createComponent("Component.AnimationPlayer") as AnimationPlayer
player.addClip(clip)
player.onEvent.add((args) => { if (args.eventName === "finished") { /* next step */ } })
player.playClip("squish")
```

- **Tracks are absolute.** A position or scale track overwrites the transform it drives. To animate
  an object that something else also moves, put the track on a parent.
- **Replay** with `player.stopClip(name)` then `player.playClip(name)`.
- **Speed and range** come from the clip (`playbackSpeed`, `begin`, `end`); an authored
  `.animationAsset` can replace the script-built one in the same clip.

## The `frames: 0` killer (frozen T-pose)

The make-or-break check is **`AnimationAsset.duration > 0`** (equivalently `fps > 0`). A rig / T-pose FBX imports with **0 sampled frames** → `AnimationClip.duration == 0` → time queries return **`NaN`** → the skin stays in its **T-pose even though `playClip` ran** and playback logs look fine. This is a silent bug with no obvious cause. Guard before playing:

```typescript
if (!animAsset || animAsset.duration <= 0) {
  print("Animation has no frames (duration 0) — skipping; it would freeze the T-pose");
  return;
}
```

## Gotchas

- **A successful `playClip` is not proof of motion.** The call returning and logging cleanly only tells you playback *started*, not that the skin is deforming — it won't if the clip has no frames (see above) or the rig has no skinned mesh.
- **Confirm real movement with Preview screenshots ≥1 s apart.** An orthographic `CaptureRuntimeViewTool` freezes simulation time (two captures come out pixel-identical while animation runs), so use Preview-panel screenshots to check the skin is deforming.
- **Don't phase-lock to a clock.** Sub-frame `setCurrentTime` seeking jitters; drive with `playbackSpeed` / `playClipAt` rather than manual per-frame time-setting.
