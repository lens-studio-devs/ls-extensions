<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

> **Lens Runtime API** — All code here targets the Lens scripting runtime (StudioLib). Do not use these patterns in Editor API code.



# Lens Studio Face Tracking — Reference Guide

Face tracking is the foundation of most Snapchat phone Lenses. Lens Studio tracks faces in real time using the front camera, providing mesh, landmarks, attachment points, and expression weights.


## Head Component

### Setting up face tracking

Add a **Head** asset from the Add menu (Scene Hierarchy panel → + → Face → Head). This creates a face tracking hierarchy automatically.

To access the face tracking component in script:

```typescript
// Get the Head component from the head scene object
const head = headSceneObject.getComponent('Component.Head')
```

### Multi-face tracking

Lens Studio can track up to 3 faces simultaneously. Use `faceIndex` to distinguish them:

```typescript
@input faceIndex: number = 0  // 0 = first face, 1 = second, 2 = third

const faceTracking = headSceneObject.getComponent('Component.Head')
faceTracking.faceIndex = this.faceIndex
```

Each tracked face has its own head scene object. Duplicate the head hierarchy for each additional face.


## 2D & 3D Face Attachments

Objects parented to specific named landmarks follow the face in 3D.

### Common attachment anchor names

| Anchor | Position |
|---|---|
| `hat` | Top of head |
| `forehead` | Centre forehead |
| `left_eye` | Left eye centre |
| `right_eye` | Right eye centre |
| `nose_tip` | Tip of nose |
| `mouth` | Centre of mouth |
| `chin` | Bottom of chin |
| `left_ear` | Left ear |
| `right_ear` | Right ear |

### Adding a 3D attachment

1. Add your 3D object to the scene.
2. Parent it to the corresponding anchor object in the face tracking hierarchy (e.g., drag it under `hat` in the Scene Hierarchy panel).
3. Use **Adjust** mode on the face mesh to position the object correctly.

### Scripting 2D attachment position
```typescript
// Get the screen-space position of a face landmark
const faceTracking = headObject.getComponent('Component.Head')

const updateEvent = this.createEvent('UpdateEvent')
updateEvent.bind(() => {
  // Screen-space position of the nose tip (normalised UV)
  // getLandmark(index) is deprecated — prefer head.onLandmarksUpdate (see Face Landmarks section)
  const nosePos: vec2 = faceTracking.getLandmark(1)  // plain number index; 1 = nose tip
  print(`Nose at: ${nosePos.x}, ${nosePos.y}`)
})
```


## Face Mesh

The Face Mesh conforms a textured mesh to the detected face geometry.

### Applying a texture to the face mesh

1. Add a **Face Mesh** to the scene (+ → Face → Face Mesh).
2. Create or import a texture that maps to the UV layout of the face mesh.
3. Assign the texture to the Face Mesh's material.

### Scripting face mesh properties
```typescript
const meshVisual = faceMeshObject.getComponent('Component.FaceMaskVisual')
const mat = meshVisual.mainMaterial.clone()
meshVisual.clearMaterials()
meshVisual.addMaterial(mat)

// Tint the face mask
mat.mainPass.baseColor = new vec4(0.2, 0.8, 0.4, 0.6)  // RGBA
mat.mainPass.blendMode = BlendMode.Normal
```


## Face Landmarks (68 Keypoints)

Lens Studio provides 68 facial landmark points that track with the face.

### Modern API: `onLandmarksUpdate` (preferred)
```typescript
const head = headObject.getComponent('Component.Head')

// onLandmarksUpdate fires each frame with a vec2[] of all landmark screen positions
head.onLandmarksUpdate.add((landmarks: vec2[]) => {
  // Common landmark indices (0-indexed)
  // 0–16: Jaw line
  // 17–21: Left eyebrow
  // 22–26: Right eyebrow
  // 27–35: Nose bridge and base
  // 36–41: Left eye
  // 42–47: Right eye
  // 48–67: Mouth

  const leftEyeCenter: vec2  = landmarks[37]   // mid-left-eye
  const rightEyeCenter: vec2 = landmarks[43]   // mid-right-eye
  const mouthCenter: vec2    = landmarks[51]   // upper lip centre
  print(`Mouth center: ${mouthCenter.x}, ${mouthCenter.y}`)
})
```

### Deprecated API: `getLandmark(index)` (avoid in new code)
```typescript
// getLandmark takes a plain number index — no LandmarkIndex enum exists
// @deprecated: use head.onLandmarksUpdate instead
const nosePos: vec2 = head.getLandmark(27)  // plain number; 27 = nose bridge top
```


## Face Expressions (Expression Weights)

Expression weights give you normalised [0,1] values for various facial actions.

```typescript
const head = headObject.getComponent('Component.Head')

const updateEvent = this.createEvent('UpdateEvent')
updateEvent.bind(() => {
  // Use getExpressionWeightByName(name) — no getFaceExpressionWeights() method exists
  // The enum is Expressions (global scope) — no FaceTracking.Expressions namespace
  const mouthOpen: number     = head.getExpressionWeightByName('JawOpen')
  const leftBlink: number     = head.getExpressionWeightByName('EyeBlinkLeft')
  const rightBlink: number    = head.getExpressionWeightByName('EyeBlinkRight')
  const smileLeft: number     = head.getExpressionWeightByName('MouthSmileLeft')
  const smileRight: number    = head.getExpressionWeightByName('MouthSmileRight')
  const browRaiseLeft: number = head.getExpressionWeightByName('BrowsUpLeft')

  // You can also use the Expressions enum for the name string:
  // head.getExpressionWeightByName(Expressions[Expressions.JawOpen])

  if (mouthOpen > 0.5) {
    print('Mouth open!')
    triggerEffect()
  }

  if (leftBlink > 0.8 && rightBlink < 0.2) {
    print('Left wink detected')
  }
})
```


## Eye Tracking

`EyeTrackingComponent` (`Component.EyeTrackingComponent`) does not exist in the public Lens Runtime API — the internal `Eye` class is `@snapInternal` and is not available to Lens scripts.

Gaze tracking with per-eye direction and openness values requires **Specs** hardware and is not available in the standard phone-lens API. For blink detection on phone Lenses, use expression weights instead:

```typescript
const head = headObject.getComponent('Component.Head')

const updateEvent = this.createEvent('UpdateEvent')
updateEvent.bind(() => {
  // Blink detection via expression weights (phone lenses)
  const leftBlink: number  = head.getExpressionWeightByName('EyeBlinkLeft')
  const rightBlink: number = head.getExpressionWeightByName('EyeBlinkRight')

  if (leftBlink > 0.8) print('Left eye blink')
  if (rightBlink > 0.8) print('Right eye blink')
})
```


## Face Effects

These are inspector-based effects added via the Add Component menu. Most require no scripting.

| Effect | What it does | Scripting access |
|---|---|---|
| **Face Retouch** | Skin smoothing, teeth whitening | Inspector sliders |
| **Eye Color** | Recolours the iris | `eyeColorComponent.color` |
| **Face Liquify** | Warp face geometry (e.g., bigger eyes, slimmer face) | Inspector sliders |
| **Face Stretch** | Distort facial proportions for comedy effects | Inspector sliders |
| **Face Inset** | Embeds a live camera view in the face area | Position/scale in inspector |
| **Face Mask** | Overlays a 2D texture mapped to face UV | Material on Face Mesh |
| **Face Texture** | Replaces the face with a static or animated image | Texture asset |

### Changing eye color at runtime
```typescript
const eyeColorComponent = this.sceneObject.getComponent('Component.EyeColorVisual')
eyeColorComponent.color = new vec4(0.0, 0.4, 1.0, 1.0)  // blue eyes
```


## Upper Body Tracking (Specs + Front Camera)

### Upper Body Tracking 3D

Provides a subset of humanoid attachment points: hips, spine bones, neck, head, shoulders, and upper arms.

1. Add **Object Tracking → Upper Body Tracking** from the Scene Hierarchy + menu.
2. The component tracks the skeleton and exposes attachment points via the `ObjectTracking3D` component.

```typescript
const bodyTracking = upperBodyObject.getComponent('Component.ObjectTracking3D')

// onTrackingStarted / onTrackingLost are plain callback properties — use = assignment, not .add()
bodyTracking.onTrackingStarted = () => print('Upper body detected')
bodyTracking.onTrackingLost    = () => print('Upper body lost')
```

### Upper Body Mesh

Creates a full, seamless 3D mesh of the upper body — ideal for selfie Lenses. Can be used as:
- An **occluder** for body accessories (virtual clothes, jewellery)
- A **physics collider** surface
- A **texture target** for seamless face-to-neck blending

Add via Scene Hierarchy → + → Upper Body Mesh. Automatically includes:
- `Head Component` (with Face Mesh and skull)
- `Object Tracking 3D` (configured for Upper Body)
- `Upper Body Mesh` (the body surface mesh)

> **Note:** Upper Body Mesh does not support external custom meshes — use the built-in mesh and apply custom materials.


## Common Gotchas

- **Expression weights**: use `head.getExpressionWeightByName('JawOpen')` etc. — there is no `getFaceExpressionWeights()` method. Use the `Expressions` enum at global scope (not `FaceTracking.Expressions`) for expression name strings.
- **Multi-face**: each faceIndex needs its own separate Head scene object hierarchy — one FaceTracking component per face.
- **Eye gaze tracking** (`EyeTrackingComponent`) is not available in the public phone-lens API — use expression weights (`EyeBlinkLeft`/`EyeBlinkRight`) for blink detection instead.
- **Upper Body Mesh** is not available on all OS versions — check the Specs compatibility list.
- **Face Retouch** and morphing effects run on a GPU pass — avoid enabling more effects than needed for production performance.
- **Face Attach objects**: always test object placement by recording with a real face; the Lens Studio simulator's face is symmetrical and doesn't reflect real-world drift.
