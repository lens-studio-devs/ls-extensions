<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Lighting (LightSource + ambient)

Concise reference for scene lighting. A Lens light is a **`LightSource` component on a SceneObject** — there is no global "RenderSettings" the way Unity has one.

> Placement note: lighting is conceptually a rendering concern (see `camera-and-rendering` for cameras / render config). It lives here because it is a scene-construction domain with no other owned home; consider promoting to a standalone reference if it grows.

## `LightSource` essentials

`LightSource`'s properties are defined in `Support/StudioLib.d.ts`; look them up there rather
than restating them. What the `.d.ts` will not tell you:

- `color` is a runtime `vec3` with each channel 0-1 and no color-space conversion.
- Shadow support on SPECS is limited and is often left off.
- The `Envmap` light provides image-based lighting (the template's stand-in for a Unity skybox).
- There is **no** area/disc light, light-cookie, per-light culling mask, or baked/mixed lightmap path: treat those Unity concepts as unsupported.

## Ambient is an object, not a setting

There is **no global ambient render setting**. Ambient light is just a `LightSource` with `lightType = Ambient`, placed as its own SceneObject (in a template scene, under a `Lighting/` group, typically named `Ambient Light` / `Envmap`). To change ambient, find and edit that SceneObject's `LightSource` — do not look for a scene-level property. If a template has no ambient, add one.

## Exposure is aggregate — stacking lights clips to white

Exposure is computed **across all lights, not per-light**. Stacking multiple directionals (or a full-strength ambient plus one or more "suns") clips surfaces facing the lights to unreadable **white**. When adding lights, demote extras to fill fractions and lower ambient rather than leaving each at full strength — e.g. starting values ambient ~0.35 / key ~1.0 / fill ~0.5 (tune per scene; these are not fixed constants). This "everything is blown out" symptom is otherwise chased in materials.

Point/Spot `range` maps to an attenuation curve (not a hard cutoff); a spot's cone maps its outer angle.
