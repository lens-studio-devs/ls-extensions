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

## Typography (Type Scale)

This is the **single source of truth** for text size + weight in `/specs-build-ui`. Pick a **role** (the right-hand column), never a raw number. The skill applies it in one place — `applyTextRole(text, "Body")` — so size and weight always travel together and the whole scale is one edit away. These are the canonical Snap Specs text styles at the default focal plane, **z = -110 cm (110 cm / "Far")**, the best-default position where UI is normally placed:

| Style | `size` @110cm | Weight | Role string | Typical use |
|-------------|-----------:|--------------|---------------|-------------|
| Title 1 | 105 | Bold (700) | `"Title1"` | Hero / primary screen title |
| Title 2 | 93 | Bold (700) | `"Title2"` | Secondary hero title |
| Headline XL | 62 | Bold (700) | `"HeadlineXL"` | Prominent panel header |
| Headline 1 | 54 | Bold (700) | `"Headline1"` | Panel / section title |
| Headline 2 | 48 | Bold (700) | `"Headline2"` | Sub-section title |
| Subheadline | 41 | Bold (700) | `"Subheadline"` | Group / item label, card name |
| Button | 39 | Medium (500) | `"Button"` | Button labels |
| Callout | 39 | Bold (700) | `"Callout"` | Inline callout / emphasis |
| Body | 39 | Medium (500) | `"Body"` | Body copy, list-item text |
| Caption | 38 | Medium (500) | `"Caption"` | Secondary labels, timestamps, subtitles, unit / overline labels |

### What `text.size` actually is (and why sizing felt hard to control)

`Component.Text.size` (and UIKit `textSize`) is the glyph **em-square height**, *not* cap/glyph height. In world space `em-square cm = size / 43.886` (StudioLib `Text.size`; the default `48` ≈ 1.09 cm). The numbers above are calibrated for the **SnapOS system font (Objektiv, em-square ratio ≈ 0.695)** at 110 cm — they are the values UIKit's own `TextStylePresets` resolves to on LS 5.16+ (it multiplies its design sizes by ≈0.953 internally to match Objektiv's em square; the skill bakes that result straight into the table so you set `text.size` directly).

- **A custom theme font renders a different visual size for the same number.** Each font fills its em square differently, so once you bake `t.font = THEME_FONT` onto every label, "size 39" no longer matches the system-font reference. This is the usual root cause of "I set the size and it's still too big/small." **Fix it once, not per-label:** set `FONT_SIZE_SCALE` (a single module-scope constant `applyTextRole` multiplies into every size) to `≈ 0.695 / <font's em ratio>`. Default `1.0` is correct for the system font. See `/specs-build-ui` gotchas → *Text size drifts after a font swap*.
- **Caption (38) is the floor at 110 cm.** Don't render readable text smaller than this on a panel at the default distance — sub-spec sizes (18–36) are hard to read at 110 cm.
- **Closer panels scale down proportionally.** At Near (z = -55 cm) sizes are roughly half (Title 1 ≈ 53, Body ≈ 20). Pass the distance — `applyTextRole(t, "Body", 55)` scales by `actual_distance_cm / 110`.
- **Weight rides with the role.** `applyTextRole` sets `(text as Text & {weight?: number}).weight` from the scale (Bold 700 / Medium 500). Don't set weight by hand — that's how size and weight drift apart. `TextStylePresets` sets size but not weight reliably (see `/specs-build-ui` gotchas), which is why the skill applies the scale directly instead.

The canonical `TYPE_SCALE` / `FONT_SIZE_SCALE` / `applyTextRole` block lives in `/specs-build-ui` → `references/patterns.md → Typography`; the examples apply it by role.

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
- **Any text the user needs to read** — use `/specs-build-ui` composition helpers (ElementContent, Frame/BackPlate, FlexLayout), NOT raw `Component.Text`
- **Composition patterns** — FlexLayout / GridLayout mirror CSS Flexbox / Grid; see `/specs-build-ui` → *Icon + Text Composition Patterns* for the icon-next-to-text decision tree

### Standard Pattern — Use `/specs-build-ui`

For all text and UI, use the composition helpers from `/specs-build-ui`. **Never use raw `Component.Text`** — it lacks font control, z-ordering, and layout integration.

```typescript
// Use /specs-build-ui helpers: scenePanel(), label(), btn(), content(), flexColumn(), flexRow()
// See /specs-build-ui SKILL.md for the full composition system and examples.

// Quick example — status panel with BackPlate:
const panelContent = this.scenePanel(root, "StatusPanel", 30, 6, "backplate", "dark")
this.label(panelContent, "Status message", 28, 4, {textSize: 48, fontWeight: "medium"})
```

### Design Rules
- **Dark backgrounds, light text** (additive color space — white is boldest, black is transparent)
- Position status panels **above or below** the main content, not overlapping it
- Use **Billboard** so panels always face the user
- Use **ElementContent** via `/specs-build-ui` for all text — never raw `Component.Text`

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

## Containers (SIK Standard)

- Standard affordance for moving/adjusting spatial content.
- Uses **spherical coordinate frame** for manipulation.
- Features: Move, Scale, Rotate, Close, Change Anchor, Snap to others.
- Size containers to **fit around content** with margins meeting target sizing recommendations.
- Available in Spectacles Interaction Kit.

---

## Quick Reference: Default Placement

For a standard Specs Lens with UI:
1. **Z-position:** 110cm (best default, full binocular overlap)
2. **Display area:** 53cm × 77cm at that distance
3. **Button sizes:** 6.0cm recommended (4.0cm minimum)
4. **Y-position:** Slightly below eye level (boresight is tilted down)
5. **Color:** Dark backgrounds, light text, no pure black regions
6. **Materials:** Unlit with baked lighting for performance
