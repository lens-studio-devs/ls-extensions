---
name: specs-spatial-image
description: Convert 2D images into 3D spatialized meshes using the Spatial Image package. Includes depth animation, angle validation, gallery navigation, and frame management. Load when implementing spatial photo viewing, 3D image galleries, or depth-based image display.
user-invocable: false
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Spatial Image — 2D to 3D Spatialization

**Requirements:** Lens Studio v5.3+, Spectacles OS v5.58+. Install **Spatial Image** package from Asset Library. Requires Remote Service Gateway credential.

Reference: `Spatial Image/`, `Spatial Image Advanced/`

> Only one image can be spatialized at a time. Multiple simultaneous requests cause delays.

---

## Scene Setup (Required)

Template scene has 4 objects: `SpectaclesInteractionKit`, `SikSpatialImageFrame`, `SpatialGallery`, `RemoteServiceGatewayCredentials` (RSG auth — follow RSG setup docs to get credential).

---

## Core Script: SpatialImageFrame

```typescript
// Set an image (Texture) on the frame
// swapWhenSpatialized=true: automatically switches to 3D when ready
frame.setImage(myTexture, true)

// Toggle between flat and spatialized display
frame.setSpatialized(true)   // show 3D
frame.setSpatialized(false)  // show flat
```

---

## Gallery Pattern (multiple images)

```typescript
// From SpatialGallery.ts pattern:
@component
export class ImageGallery extends BaseScriptComponent {
  @input frame: SpatialImageFrame   // the SIK frame component
  @input gallery: Texture[]         // array of image textures

  private index: number = 0

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.setIndex(0))
  }

  private setIndex(newIndex: number): void {
    this.index = Math.max(0, Math.min(newIndex, this.gallery.length - 1))
    this.frame.setImage(this.gallery[this.index], true)  // true = swap to 3D when ready
  }

  public nextImage(): void { this.setIndex(this.index + 1) }
  public prevImage(): void { this.setIndex(this.index - 1) }
}
```

---

## Angle Validation

Controls whether the spatial effect is shown based on viewing angle (hides 3D artifacts at extreme angles):

```typescript
// SpatialImageAngleValidator API:
validator.setValidZoneAngle(25)   // degrees — valid viewing cone (default 25°)
validator.setValidZoneFocal(2)    // focal distance behind image (default 2)

// Subscribe to validity changes
validator.addOnValidityCallback((entered: boolean) => {
  if (entered) {
    // User is looking straight at image — show full 3D
  } else {
    // Extreme angle — flatten back to 2D
  }
})
```

---

## Depth Animation

`SpatialImageDepthAnimator`: `setBaseDepthScale(0–1)` sets max 3D depth; `animateSpeed` controls transition rate; uses `ease-in-out-sine` internally (see reference for easing loop details).

---

## Focal Point Adjustment (when image moves)

When user grabs and moves the image, adjust the focal offset to prevent depth warping:

```typescript
private setFocalPoint(): void {
  const camPos = this.camera.getTransform().getWorldPosition()
  const imgPos = this.spatializer.getTransform().getWorldPosition()
  const distance = camPos.distance(imgPos)
  this.spatializer.setFrameOffset(-distance)
}
```

---

> See `resources/docs/spatial-image.mdx` Troubleshooting section for common issues (clipping plane, preview device, delays).
