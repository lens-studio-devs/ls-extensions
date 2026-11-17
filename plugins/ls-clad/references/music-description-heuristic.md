<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Background-music description derivation

Reference for `specs-experience-builder` Phase 2c. Consulted once per build, when authoring the `BackgroundMusic` manifest entry at Phase 0.

When Hard Rule 1's music default applies (game-like / ambient experiences, not struck via the plan summary), the manifest has exactly one `BackgroundMusic` entry. Don't pass a generic "background music" string to `/build-music` — the skill needs concrete musical parameters or it will pick something that fights the experience's mood. Synthesize the description at Phase 0 from `theme` + intended gameplay pace:

| Concept | Source | Examples |
|---|---|---|
| **Genre** | Map `theme.mood` + `theme.style` to a genre family | `cheerful, cozy, voxel-cartoon` → "lofi / soft electric-piano bed"; `tense, cinematic, sci-fi` → "ambient cinematic with synth pad + sub"; `retro arcade, 8-bit` → "8-bit chiptune with square lead + triangle bass"; `epic adventure, fantasy` → "orchestral pad + brass swells" |
| **Tempo** | Match gameplay pace | Slow puzzle / cozy idle: 70–90 BPM. Standard interactive: 95–115 BPM. Fast action / arcade: 120–150 BPM. |
| **Key + progression** | Pick from theme mood | Cheerful/cozy → major (I-V-vi-IV, I-IV-V-I). Tense/somber → minor (i-VI-III-VII, i-iv-V). Jazz/lofi → ii-V-I. |
| **Voices** | Lean on what fits the mood | Cozy/lofi → `electricPiano`, `pad`, light hat/shaker. Cinematic → `pad`, `analogStrings`, `subBass`. 8-bit → hand-rolled square/triangle voices via the SKILL.md's chiptune example. Avoid `synthLead` for ambient beds — it cuts through and fights SFX. |
| **Length** | Long enough to loop without obvious return | 16-30 s for short experiences; up to 60 s for longer gameplay. Always say "loops cleanly — first and last seconds match." |
| **Mix** | Subordinate to SFX | Always end the description with: "peak well under SFX, sits at low background-bed volume so clicks and impacts stay readable." `/build-music`'s default normalization is `peak` which preserves dynamics; the runtime AudioComponent volume gain handles the level (see Phase 2f). |

Examples by theme mood:

- `cheerful, approachable, low-stakes fun` + `voxel cozy cartoon` → *"warm cozy bed for low-stakes voxel-cartoon gameplay — soft electric piano comping on I-V-vi-IV in C major, light brushed kick + shaker, no melody lead, ~85 BPM, 24 seconds, loops cleanly, peak well under SFX so clicks stay readable"*
- `tense, focused, cinematic` + `sci-fi` → *"tense ambient cinematic bed — slow detuned pad on i-VI-III-VII in A minor with subBass pedal point, no percussion, ~70 BPM, 30 seconds, loops cleanly, peak well under SFX"*
- `playful, fast, retro` + `8-bit` → *"upbeat 8-bit chiptune — square-wave lead arpeggio on I-V-vi-IV in C major, triangle bass walking root-fifth, ~130 BPM, 16 seconds, bitcrush 4, loops cleanly, peak well under SFX so the gameplay blips stay on top"*

If the user gave a specific musical reference in `original_request` (e.g. "synthwave," "lofi hip-hop," "rainforest ambient"), use it verbatim as the genre anchor and derive the rest from theme.
