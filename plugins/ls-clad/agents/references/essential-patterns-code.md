<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Essential Patterns — code blocks (specs-experience-builder)

On-demand code for Essential Patterns §8/§9/§10. The agent body keeps each pattern's rule; the full snippets are here. Read at Phase 2f (main-script write) time.

## §8 — SFX playback
```typescript
const clickSfx = requireAsset('../GeneratedSFX/ButtonClick.wav') as AudioTrackAsset;
const audio = obj.createComponent('Component.AudioComponent') as AudioComponent;
audio.audioTrack = clickSfx;
// Interactive SFX (button press, hit confirm, anything tied to user input) →
// LowLatency. Specs defaults every AudioComponent to LowPower, which adds
// playback latency you'll hear as a lag after the tap. Trade-off: higher
// device power, so set this only for input-reactive cues. See /specs-audio.
audio.playbackMode = Audio.PlaybackMode.LowLatency;
audio.play(1);
```

## §9 — Background-music playback (looping bed)
```typescript
const bgmTrack = requireAsset('../GeneratedSFX/BackgroundMusic.wav') as AudioTrackAsset;
const bgmObj = global.scene.createSceneObject('BackgroundMusic');
const bgm = bgmObj.createComponent('Component.AudioComponent') as AudioComponent;
bgm.audioTrack = bgmTrack;
bgm.volume = 0.4;     // background bed — well under SFX (which default to 1.0)
// Ambient/music beds tolerate latency — keep the Specs default LowPower to save
// device power. Stated explicitly to contrast with #8's LowLatency. See /specs-audio.
bgm.playbackMode = Audio.PlaybackMode.LowPower;
bgm.play(-1);         // -1 = loop indefinitely
```

## §10 — Face a direction (moving meshes)
```typescript
// Point a mesh's baked -Z front along a horizontal world direction.
function faceDirection(leafVisual: SceneObject, dir: vec3): void {
    // LS convention: a -Z front yawed by θ about +Y points to (sinθ, 0, −cosθ);
    // setting that equal to (dir.x, *, dir.z) gives θ = atan2(dir.x, −dir.z).
    // Do NOT "simplify" to atan2(−dir.x, −dir.z) — that negates the yaw, which
    // is correct only for ±Z travel and flips the mesh 180° (tail-first) for any
    // ±X travel.
    const yaw = Math.atan2(dir.x, -dir.z);
    leafVisual.getTransform().setLocalRotation(quat.fromEulerAngles(0, yaw, 0));
}

// Per-frame for a mover (velocity = thisFramePos − lastFramePos):
faceDirection(shipVisual, velocity);
// Or aim at a point:
faceDirection(shipVisual, target.sub(shipPos));
```
