<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Specs Spatial Design Guide

Practical design reference for building Specs Lenses. Sourced from Snap's official design documentation.

---

## Display System Fundamentals

| Parameter | Value |
|-----------|-------|
| Aspect ratio | ~3:4 (portrait) |
| Focus plane | 1 meter from user |
| Full binocular overlap | 1.1 meters from user |
| Display at overlap distance | 1000px × 1397px / 53cm × 77cm |
| Color space | Additive (black = transparent, white = boldest) |
| Boresight | Tilted downward below horizon |

- Each eye has its own display projector. The binocular overlap area is **smaller when content is closer, larger when farther**.
- Pure black cannot be rendered — it appears transparent.
- Alpha is proportional to luminosity (50% alpha = half brightness = midtone).

---

## Positioning: Z-Depth Zones

### Near-Field (35cm – 60cm)
- Direct hand interactions (within arm reach)
- Smaller usable display area
- Best for brief navigation, glanceable controls
- Limit text and visual detail

### Far-Field (60cm – 160cm)
- Indirect interactions (ray-based targeting)
- Larger usable display area
- Best for detailed content, longer viewing sessions

### Display Sizes at Z-Distances

| Z Position | Width (X) | Height (Y) | Use Case |
|------------|-----------|-------------|----------|
| **35cm** | 13cm | 24cm | Hand-anchored, quick controls |
| **55cm** | 23cm | 38cm | Arm's reach, quick controls |
| **110cm** | 53cm | 77cm | **Best default position** |
| **160cm** | 75cm | 112cm | Ultra-large content |

---

## Button & Target Sizing

Snap OS uses **angular sizes** (distance-independent):
- **Minimum targetable size:** 2 degrees
- **Minimum spacing between targets:** 1 degree

### Sizes in Centimeters at Z-Distances

| | Z=35cm | Z=55cm | Z=110cm | Z=160cm |
|---|--------|--------|---------|---------|
| **Minimum** | 1.5cm | 2.0cm | 4.0cm | 5.5cm |
| **Best** | 2.0cm | 3.0cm | 6.0cm | 8.5cm |
| **Large** | 2.5cm | 4.0cm | 8.0cm | 11.5cm |

- Size refers to the **interactive collider**, not just the visual mesh.
- Visual elements can be smaller as long as colliders meet minimum standards.

---

## Typography

Use semantic roles such as title, headline, body, button, and caption rather
than unrelated per-label sizes. In UIKit 4.0 assign a role with `ElementContent.ranking` and the `Ranking` enum (`Title1`, `Title2`, `HeadlineXL`, `Headline1`, `Headline2`, `Subheadline`, `Button`, `Callout`, `Body`, `Caption`); see `references/uikit-4.0.md`.

- Maintain a clear size and weight hierarchy.
- Treat caption text as the readability floor, not a way to fit excess copy.
- Scale typography for actual viewing distance.
- Re-check the complete hierarchy when changing fonts; fonts with different
  metrics can render at visibly different sizes.
- Test long strings, wrapping, localization, and live numeric values in Preview.

---

## Y-Axis & Boresight

- The display boresight is **tilted downward** — content should be positioned **lower** in global Y than you'd expect from mobile/desktop.
- Content positioned lower in FOV is **easier to target** with hand interactions.
- Position elements lower in Y to **reduce arm effort**.

---

## Centering & FOV

- **Always center content in FOV** for neutral head posture.
- Minimizes head movement and avoids **color distortion** near display edges.
- Content that fits within FOV feels deliberate; content outside FOV may disorient users.
- If content is outside FOV, **guide users** (hints, audio cues, arrows).
- Users new to AR may not realize they can move their head to look around.

---

## Anchor Dynamics

### Fixed in World (Default)
- Content stays at a fixed world position. Users move around it.
- Most flexible — **start here** if no specific movement needs.
- Tradeoff: content can be "left behind" if user walks away.

### Following User's Head
- For on-the-go/continuous motion use cases.
- Content is never lost, always accessible.
- Critical for privacy controls (mic, camera indicators).
- **Keep UI smaller and glanceable** when following head — avoid blocking full FOV.

### Following User's Hand
- Anchored relative to user's hand for significant movement scenarios.
- Position hand menus near **non-dominant hand** (dominant hand for targeting).
- Keep hand menus **small** with fewer elements.
- **Provide a hint** to look at hand — users may miss hand-anchored interfaces.

---

## User Postures

Design for all postures — arm reach, head angle, and obstacles vary:
- **Standing** — full reach range
- **Seated** — desk/table obstacles, limited lower reach
- **Lounging** — reclined angle, limited reach
- **On-the-Go** — walking; differentiate between:
  - **Portability:** User stops to interact
  - **Mobility:** User interacts while moving

---

## UI Form & Shape

### 3D Forms
- Encourage hand interactions — round geometry is more inviting than flat planes.
- Provide inherent depth/mass in 6DOF space.
- More compelling interaction feedback.
- **Use for:** buttons, interactive elements, hero objects.

### 2D Shapes
- Better legibility — use for **text and icons** (avoids distracting edges from angles).
- 2D planes serve as backgrounds/tiles to gather 3D elements.

---

## UIKit for State & Feedback

Every interactive experience should evaluate whether UIKit elements are needed to communicate state to the user. `print()` logs are invisible in production — only use them for debug.

### When to Use UIKit
- **Game state**: turns, scores, win/loss, round info
- **Instructions**: "Pinch to place", "Pinch to restart"
- **Status feedback**: loading, connecting, error states
- **Any text the user needs to read**

### Standard Pattern — Use `/specs-build-ui`

Use `/specs-build-ui` to install UIKit and follow its `references/uikit-4.0.md`
for composition and implementation.

### Design Rules
- **Dark backgrounds, light text** (additive color space — white is boldest, black is transparent)
- Position status panels **above or below** the main content, not overlapping it
- Keep important status UI facing the user and within a comfortable focal area

---

## Color & Material

### Additive Color Rules
- **White = boldest/brightest**, Black = transparent.
- Design in "inverted color space" — think dark mode patterns.
- **Avoid pure white backgrounds with dark text** — uncomfortable to read.
- Use **dark backgrounds with light text** instead.
- Uniform color regions highlight display variations — use **patterns or subtle textures**.
- **Test on device** — colors render differently than on desktop/mobile.

### Materials
- Use **unlit materials with baked lighting** for performance.
- Avoid gradients with opacity (texture load + artifacts).
- Use black/white masks for occlusion instead of occlusion shaders.

### Performance-Sensitive
- Blendshapes and particle systems are **power-intensive** — consider alternatives.
- Combine meshes where possible.
- Use JPG masks instead of PNGs when alpha isn't needed.

---

## Motion Design

- Use motion to **guide attention** in 3D space (wayfinding, transitions).
- Motion cues **origin points** (e.g., opening from hand to world position).
- Interaction hints as **feedforward/feedback**:
  - Jiggle/flex for poke actions
  - Progressive "squish" for pinch actions
  - Z-depth movement for targeting indication

---

## Spatial Audio

- Position sound sources in world space with distance/directional behavior.
- Enhances realism — digital objects feel part of the real world.
- **Directional cues** to signal content outside FOV.

---

## Comfort Guidelines

### Visual Comfort
- Avoid placing content in **monocular side regions** (only one eye sees it).
- Detailed content most comfortable at **~1 meter** depth.
- Don't require focus on virtual and real objects at very different depths simultaneously.
- Keep depth cues consistent — avoid high render order on far objects (causes vergence-accommodation conflict).
- Provide **backgrounds behind text** for legibility against varying environments.

### Physical Comfort
- Position elements **lower in Y** to reduce arm fatigue.
- Minimize travel distance between sequential interactions.
- Design custom gestures for **neutral hand/wrist positions**.
- Allow a **range of acceptable poses** rather than one precise gesture.
- Avoid steep sustained neck angles (dramatically up or down).

### Cognitive Comfort
- Mirror real-world conventions to reduce cognitive load.
- Favor **recognition over recall** — make options visible.
- Provide **first-run experience** (tutorials, tooltips).
- Don't fill the entire FOV — maintain **margins on all sides**.
- **Max ~3 simultaneous windows** before overwhelming.
- **Max ~7 list elements** before overwhelming.

---

## Containers (Specs Standard)

- Standard affordance for moving/adjusting spatial content.
- Uses **spherical coordinate frame** for manipulation.
- Features: Move, Scale, Rotate, Close, Change Anchor, Snap to others.
- Size containers to **fit around content** with margins meeting target sizing recommendations.
- Available in UIKit as `Frame`.

---

## Quick Reference: Default Placement

For a standard Specs Lens with UI:
1. **Z-position:** 110cm (best default, full binocular overlap)
2. **Display area:** 53cm × 77cm at that distance
3. **Button sizes:** 6.0cm recommended (4.0cm minimum)
4. **Y-position:** Slightly below eye level (boresight is tilted down)
5. **Color:** Dark backgrounds, light text, no pure black regions
6. **Materials:** Unlit with baked lighting for performance
