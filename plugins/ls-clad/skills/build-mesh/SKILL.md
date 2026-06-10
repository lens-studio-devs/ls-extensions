---
name: build-mesh
description: >
  Generate a 3D mesh, model, or asset for a Lens — build, create, or make
  props, characters, scenery. Four peer backends chosen per asset: SPECS
  text-to-3D (static default — best texture fidelity, async minutes-long jobs), FAST3D
  (faster static AI props), code-authored MeshBuilder via the
  mesh-builder-scripting skill (articulated, animated, parametric TypeScript
  content), and Blender voxel (blocky aesthetic; the only source of rigged
  GLBs). GLB backends return the file plus AABB metadata so the caller can
  size colliders and place the mesh in the world.
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Build a 3D Mesh

`/build-mesh` produces a 3D asset. GLB backends write `Assets/GeneratedMeshes/<Name>.glb` and report AABB metadata; the code-authored backend hands off to the `mesh-builder-scripting` skill and yields a TypeScript artifact instead.

## Backend menu

Four peer backends. Choose **per asset**, by what the asset needs — not by a fixed priority order. **This menu is the single source of backend selection: the build orchestrator and project-init defer here.**

- **SPECS text-to-3D** — static textured props of any style: organic, realistic, stylized, cartoon, low-poly looks alike. Best texture fidelity of any backend; static only; jobs take minutes (async create → poll → download). Also does image→3D from a reference image.
- **FAST3D** — the `GenerateFast3DAssets` MCP tool. Static AI-generated props, faster and lower fidelity than SPECS. Synchronous call, no local dependencies.
- **Code-authored MeshBuilder** — the `mesh-builder-scripting` skill. Articulated, animated, or parametric content: geometry, materials, animation, and behavior in one TypeScript artifact at zero pipeline latency. (A static prop being "stylized" does not route here — that's SPECS's domain; this backend earns its place through motion and parametrics, not as a latency dodge.) Honest ceiling: Lens Studio has no canvas textures — vertex colors / `ProceduralTextureProvider` only — so the realism ceiling is low. Articulated transform-animation of sub-meshes is where this wins; recommended path for anything that must move or articulate (creatures, mechanisms).
- **Blender voxel** — `voxel_toolkit.py` (+ `anim_toolkit.py`). Blocky voxel aesthetic, and the ONLY path when a rigged GLB (skinned skeleton in the asset) is specifically required. Needs local Blender (`test -x /Applications/Blender.app/Contents/MacOS/Blender || which blender`); see the voxel section below.

**Default for static assets: SPECS text-to-3D** — it is the quality bar; accept the minutes-long jobs. FAST3D instead is a **user-granted exception only**: the user asked, in so many words, for the *meshes themselves* to be fast or draft-quality. Never self-grant it. Not grants: "I want speed", mesh count, genre ("it's a game, not a photoreal showcase"), "simple props, good enough", a revision request ("make the barn redder" licenses a redder barn, not a backend switch), the skill's own regen retries, or project framing ("prototype" / "MVP" / "quick demo" describe the project, not the mesh pipeline). If the user didn't say it about the meshes, use SPECS — its quality knobs already serve draft-speed iteration without switching backend. When the exception applies, record the user's words that licensed it in the report fragment's `backend_reason` — sub-agent prose is never shown to the user, so a deviation declared only there is a silent swap. Anything that must move or articulate routes to code-authored MeshBuilder; blocky aesthetic or a rigged-GLB requirement routes to voxel.

Both AI backends authenticate through the signed-in Lens Studio session (no API key), so both need the user signed in. Tool naming, deferred-schema loading, and ask/spawn semantics: see `lens-studio-field-notes` Hard Rule 2 / Cross-runtime orchestration.

**On failure.** A failed generation job must surface and be retried next turn — tool-missing is a retry gate, never a permanent fallback. Retrying on the SAME backend is the preferred recovery; switching backend after repeated failures is a decision to announce AND record (`backend_reason: specs_failure: <error>` or `specs_failure: SPECS_TIMEOUT`), never a silent swap. Auth/access failures (`NOT_SIGNED_IN`, `NO_API_ACCESS`) always stop so the user can fix sign-in — never switch backends around them. Silent degradation to primitives stays banned: deliberate code-authored geometry is first-class only when planned and declared up front, never an unannounced stand-in for a failed generation.

## Per-mesh output contract

Every successful GLB invocation produces:

- `Assets/GeneratedMeshes/<Name>.glb` — non-empty, valid GLB.
- The same two AABB lines on stdout regardless of backend, so the caller's collider math and wrapper-pattern positioning work identically:

```
--- AABB (Lens Studio cm @ 100x import): W x H x D ---
--- AABB center offset (cm): cx, cy, cz ---
```

- A report fragment: `{ name, path, status, backend, backend_reason, aabb_cm, aabb_center_offset_cm, aabb_min_cm, forward_axis, upright, completeness, grounded, animation_available, normalized, size_warning }`
  - `status` — `ok`, or a blocker: `GLB_MISSING`, `NOT_SIGNED_IN`, `NO_API_ACCESS`, `SPECS_TIMEOUT`.
  - `backend` — `specs` | `fast3d` | `voxel`. (MeshBuilder output follows `mesh-builder-scripting`'s own contract.)
  - `backend_reason` — REQUIRED whenever `backend` ≠ `specs`: what licensed the choice — the user's words for the FAST3D speed exception, `specs_failure: <error>` for an announced failure-driven switch, `image_embed_over_cap` / `image_413` for the image→3D reroute, the need (`animated/articulated`, `rigged GLB required`) or the user's ask (`blocky aesthetic requested`) for the other backends. Omit when `backend: specs`.
  - `normalized: true` iff `target_size_cm` was passed and the GLB was rewritten by `normalize_glb.js`.
  - `size_warning: true` iff `target_size_cm` was NOT passed and `max(aabb_cm) > 60` (the AI backends generate at arbitrary scale).
  - `aabb_min_cm` — the min-corner offset from the origin (cm). Place the mesh at `(x, ground_y - aabb_min_cm.y, z)` for foot-on-floor without re-baking; or pass `ground_contact: yes` and place directly at `ground_y` (then `aabb_min_cm.y == 0`).
  - `forward_axis` — `-Z` | `+Z` | `+X` | `-X` | `unknown` | `n/a`. `upright` — `true` | `unknown`. `completeness` — `verified` | `suspect` | `unverified`. `grounded: true` iff re-seated to min-Y = 0. See the pose contract below.
  - `animation_available` — voxel backend only: `true` when a rigged clip was exported. The caller must not wire `playAnimation` / clip-trigger calls when `false`.

Verify before reporting success:

```bash
test -s Assets/GeneratedMeshes/<Name>.glb && stat -f%z Assets/GeneratedMeshes/<Name>.glb
```

If missing or 0 bytes, return `status: GLB_MISSING`. Never report a mesh as created without this gate.

## Pose contract (all GLB backends)

- **Upright** — +Y is up; the mesh stands the way the description implies (a robot on its feet, not its back).
- **Forward axis** — Lens Studio forward is `-Z`. **Raw GLBs import facing `+Z` (toward the viewer) across all backends**, so `/build-mesh` bakes each mesh to face `-Z` and stamps it canonical — facing is a property of the asset, fixed once, not re-derived at every call site.
- **Ground contact** — a placed mesh should rest on the surface, not intersect it or float above it. When `ground_contact` resolves to yes, the GLB is re-seated (`normalize_glb.js --ground`) so its min-Y is exactly 0. Resolve `auto` as yes for objects that rest on a surface (props, characters, vehicles, platforms); no for things described as floating / flying / hovering / orbiting and for UI.
- **Completeness** — the mesh is the whole subject, not a fragment. `verified` = visually checked or deterministic backend; `suspect` = a shape heuristic tripped; `unverified` = no visual check possible this run (caller confirms post-instantiation).

**Bake facing exactly once.** The voxel template's `rot_180z` lands the raw mesh at net `+Z` (same as the AI backends) and the canonicalize `--yaw=180` carries it the rest of the way to `-Z` — don't add a second flip downstream or you'll send it back to facing the viewer. External meshes (user-imported GLB, asset-library pick) go through the same canonicalize loop on ingest: check the stamp with `analyze_glb.js --orient-meta` and treat an unstamped mesh as un-oriented.

## SPECS text-to-3D pipeline

The SPECS text-to-3D inference API, driven through `ExecuteEditorCode` + authorized HTTP — the credential comes from the signed-in Lens Studio session, so there is **no API key** to handle. Async: **create → poll → download → analyze**. Full request/response schema, status values, errors, and quality tiers: `references/text-to-3d-api.md`. Tools: `tools/text-to-3d-request.ts`, `tools/download-glb.js`.

**Create.** `Read` `tools/text-to-3d-request.ts`, set **only** its CONFIG block (METHOD / REQUEST_PATH / BODY) in the copy you pass to `ExecuteEditorCode`, and send the rest **verbatim** (never edit the file on disk). Do **not** hand-roll a shortened request: the Editor API types the HTTP `response` as `unknown`, so a bare `response.statusCode` / `response.body` fails strict-TS compile (`TS2339`) — the script's `any`-typed helpers exist precisely to avoid that. CONFIG for create:

```ts
const METHOD = "POST";
const REQUEST_PATH = "/v1/generations";
const BODY = { prompt: "<mesh_description>" /* + output_quality / preview_quality / reconstruction_quality / seed / style / negative_prompt when set */ };
```

- Quality knobs map straight to BODY fields; omit them to let the server default to `balanced`. **Do NOT request `high` `preview_quality`/`reconstruction_quality`:** the `high` tier currently fails server-side with `FAILED … "PEFT backend is required for this method"`. On that error, **re-create at `balanced`** (same prompt) — it is not a SPECS outage.
- **Image→3D** (`reference_image` provided): SPECS is the default route, same as text. Base64-encode the image into a `data:` URL and pass it as `BODY.input_image_data_url` (with or without `prompt`). Keep it under the ~15 MB cap (downscale a large image first). Only two objective triggers reroute to FAST3D's image→3D (which takes the file path directly): the image still exceeds the cap after downscaling, or the API returns 413 — an announced switch recorded as `backend_reason: image_embed_over_cap` / `image_413`, never a silent reroute.
- **Result:** `OK` → keep `data.job_id`. `ACTION_REQUIRED` → branch on the result's `reason`: `not_signed_in` / `no_auth_interface` / 401 → `status: NOT_SIGNED_IN`; `forbidden` / 403 → the account is signed in but lacks inference-API access → `status: NO_API_ACCESS` (do not tell the user to sign in again). Either way **stop** — auth/access failures never switch backends. `FAILED` → retry once if `retryable`, else handle per **On failure**.
- **Don't hand-roll a sign-in probe.** `findInterface` by string name throws `InternalError: Object with 'interfaceId' expected`, and `require(...)` fails strict-TS in `ExecuteEditorCode` (`TS2591` — use `await import(...)`). The create result IS the authoritative auth signal; `text-to-3d-request.ts` already checks auth correctly.

**Poll** (no streaming endpoint exists). Re-run the script with `METHOD = "GET"`, `REQUEST_PATH = "/v1/generations/<job_id>"`, `BODY = {}`; read `data.status` and `data.progress.overall_percent`. Poll on a short cadence (`sleep 8`-style waits, ≤ ~10 s) and interleave other independent work between polls.

- `succeeded` → `data.asset_url` is set → download.
- `failed` / `canceled` → classify `data.error_message` per the reference's Errors tables (most first-attempt failures are transient infra, not terminal): bad prompt → re-create with a tightened `prompt` / `negative_prompt`; transient server (PEFT/`high` tier → re-create at `balanced`; dev-queue flush; 5xx) → re-create once on SPECS; these commonly succeed on the retry. Still failing → handle per **On failure**.
- **Poll-stall — the #1 SPECS failure; do NOT poll forever.** SPECS reconstruction can stall: a job sitting at `queued`/0% or pinned at a fixed `overall_percent` for minutes is server backlog, not progress, and never trips `failed`, so an unbounded poll loop hangs the whole build. Bound the wait: not `succeeded` after ~10 polls / ~90 s once it stops advancing (hard ceiling ~3 min/job) → `status: SPECS_TIMEOUT`; announce it, then retry next turn or switch backend for that mesh — announced, never silent. A job whose `overall_percent` is actively climbing keeps waiting.

**Download.** Fetch the asset **only** with the node script — it writes the bytes straight to the path with no UI and no prompts:

```bash
node <skill-tools-dir>/download-glb.js --url "<data.asset_url>" --out Assets/GeneratedMeshes/<Name>.glb
```

**Never** `open` the `asset_url`, open it in a browser, or import it through an interactive Lens Studio file picker — those pop a macOS *Save* dialog. If `download-glb.js` reports HTTP 401/403 or the signed `asset_url` has expired (it lasts ~1 h), re-poll `GET /v1/generations/<job_id>` for a fresh `asset_url`, then re-download.

**Analyze.** Run the shared post-processing below with `backend: specs`. Two SPECS carve-outs: (1) the FAST3D prompt Defaults are FAST3D-specific and do NOT apply — SPECS takes `prompt` plus the optional `style` / `negative_prompt` as given; (2) on a `suspect` shape or a fragment, regenerate the SPECS way — re-issue the create with a refined `prompt` / `negative_prompt` (name the missing parts, or discourage the flat/disc result via `negative_prompt`), max 2 regen retries.

## FAST3D pipeline

**Step 1.** Resolve `mesh_name` if not provided — PascalCase from `mesh_description` (e.g. "red apple" → "RedApple").

**Step 2 — Construct the final prompts (MANDATORY pre-processing).** The user's `mesh_description` is the *subject*, not the final positive prompt. FAST3D's raw behavior reliably produces (a) a black backdrop card / framing plane intersecting the subject, (b) a hollow enclosing shell / dome / sphere wrapped around the subject (same failure mode, 3D-ified — from the front the camera sees a black husk, from a 3/4 angle the camera clips through and reveals the actual model inside), and (c) flat alpha-cutout planes for any foliage / hair / fur / feathers, and (d) an unsolicited cartoon / kawaii face (eyes, smiling mouth, blush) stamped onto inanimate subjects — food, produce, plants, props, furniture, vehicles. All four look wrong in Lens Studio when the user didn't ask for them. The agent MUST apply these defaults before every MCP call — never pass `prompt: mesh_description` through unchanged.

**Default 1 — Anti-backdrop / anti-shell framing (always apply, every call).**

Both the flat-card and enclosing-shell artifacts come from the model "composing a scene" around the subject. The defense is **positive-only isolation language**: describe the desired result (single, freestanding, all-angle), not the unwanted one (`no backdrop`, `no shell`). Diffusion tokenizers don't reliably honor "no X" anywhere in the prompt — the X concept still leaks. The negative prompt is even worse: scene nouns there get re-conditioned into the positive stream and make the artifact *louder*.

- Append to the positive prompt: `, single freestanding 3D asset, complete from every angle, viewable from all 360 degrees, asset only`
- The phrasing is intentional. `single freestanding 3D asset` plus `complete from every angle` forces the model to imagine the back/side silhouettes, which is incompatible with wrapping a shell around the subject. `asset only` reads as "no other geometry" without using the word "no". Avoid adding `transparent background` here — it conflicts with Default 2's `no transparency` for foliage and confuses the model.
- Do NOT pass scene nouns (`background`, `backdrop`, `floor`, `ground plane`, `shadow plane`, `black box`, `shell`, `dome`, `container`, `husk`, `environment`) in `negativePrompt`. The FAST3D tokenizer leaks these into positive conditioning and makes the artifact *worse* — the model latches onto the noun and renders it. Negate backdrops/shells via the positive prompt's isolation language only.
- **Strip scene/locale nouns from the leading clause of caller-supplied descriptions.** When the orchestrator (or any caller) prepends a theme like `"lush garden scene; palette: greens & grass tones. <subject>"` or `"underwater coral reef; ..."`, the locale noun lands *before* the isolation defaults and biases FAST3D toward composing that scene around the subject — defeating Default 1. Before the MCP call, scan the leading clause (everything before the first `.` or the `palette:` / `mood:` markers) for **place/locale nouns**: `garden, forest, jungle, desert, dungeon, city, room, kitchen, bedroom, lab, underwater, reef, cave, mountain, ocean, sky, indoor scene, outdoor scene, landscape, environment, scene`. Also scan `palette:` for the same plus foliage nouns (`grass, leaves, foliage`). Strip the offending word(s) and emit a WARN line so the caller can fix their theme. Style adjectives (`stylized, cartoon, low-poly, painterly, voxel, PBR, cel-shaded`) and color words stay.

**Default 2 — Anti-flat-foliage (apply when `mesh_description` contains any of these keywords, case-insensitive):**

`tree, plant, leaf, leaves, foliage, grass, hair, fur, feathers, flower, petals, bush, shrub, vine, moss, herb, tomato, fruit, vegetable, garden, jungle, forest, palm, fern, cactus, weed, ivy, branch, branches`

- Append to positive: `, fully opaque surfaces, solid sculpted <foliage-noun> as rounded chunky clumps, volumetric 3D geometry, watertight mesh, no transparency` (substitute the matching foliage noun from the keyword list, or `foliage` if multiple match).
- Set `negativePrompt` (or append to caller-supplied negative) to this empirically validated block:
  ```
  flat planes, billboards, billboard leaves, alpha cutout, alpha cards,
  transparent textures, transparency, opacity maps, cutout foliage,
  crossed quads, intersecting planes, paper-thin geometry, 2D leaves,
  flat cards, sprite leaves, decals, thin sheets
  ```

**Default 3 — Anti-anthropomorphism / neutral subject (apply by default; skip only on explicit opt-in or a subject that naturally has a face).**

FAST3D strongly biases toward *personifying* inanimate subjects — it stamps a cartoon / kawaii face (eyes, smiling mouth, blush) onto food, produce, plants, props, vehicles, and furniture even when nothing in the description asks for one (a plain `tomato plant` reliably comes back smiling). This is almost never wanted for crops, props, structures, or scenery, and it can't be removed downstream — the face is baked into the mesh. So suppress it by default. **Render style and personification are independent:** `cartoon` / `low-poly` / `stylized` is an art style, NOT a request for a face — keep the requested style, drop the face.

- **Skip** this default (let a face through) when EITHER:
  - the subject **naturally has a face** — a person, animal, creature, robot, doll, plush, or named character (e.g. `fox`, `astronaut`, `dragon`, `robot`, `teddy bear`); OR
  - the description **explicitly asks for** personification, via any of (case-insensitive): `face, eyes, eyeball, mouth, smile, smiling, smiley, teeth, grin, wink, winking, expression, kawaii, chibi, googly, anthropomorphic, personified, mascot, emoji, blush, with a face`.
- **Not opt-in on their own:** tone / mood / render-style words like `cheerful, friendly, happy, cute, cartoon, stylized, playful` set tone or look, not a face — they must NOT disable this default. (This is the common orchestrator case: a prepended `mood: cheerful` theme should still yield a faceless crop.)
- **Otherwise apply** (the common case — crops, food, props, furniture, vehicles, buildings, scenery):
  - **Positive (primary lever):** append `, naturalistic and physically accurate, plain unadorned surface, realistic proportions`. For plants / produce, use `botanically accurate, true-to-life` in place of `physically accurate`. Positive realism is the reliable lever here, just as positive isolation is in Default 1.
  - **Negative (backstop):** append to `negativePrompt` (after the Default 2 block if present, else create it): `face, eyes, eyeballs, mouth, smile, smiling, teeth, grin, facial features, cartoon face, kawaii, chibi, anthropomorphic, personified, googly eyes, cute face, blushing cheeks, emoji, mascot`. These are surface-feature terms (like Default 2's `alpha cutout` / `decals`), NOT the scene nouns Default 1 forbids in `negativePrompt`, so they're safe to negate here.

**Default 4 — If a caller passes negativePrompt explicitly:** append the Default 2 foliage block (when foliage keywords match) and the Default 3 anti-anthropomorphism block (when Default 3 applies) to it — don't replace. If the caller-supplied negative contains scene nouns from Default 1's forbidden list, STRIP them and emit a WARN line.

**Tool signature** (from MCP schema; tool naming per `lens-studio-field-notes` Hard Rule 2):
```
GenerateFast3DAssets({
  assetDirectory: "GeneratedMeshes",          // path is RELATIVE TO Assets/ — do NOT prefix with "Assets/"
  assets: [{
    simpleName: <mesh_name>,                  // required
    prompt: <final_positive_prompt>,          // mesh_description + Defaults 1 & 3 (+ Default 2 if foliage)
    shadowless: true,                         // default true — keep true to avoid baked shadow planes
    negativePrompt: <final_negative_prompt>,  // Default 2 (foliage) + Default 3 (faces) + caller's; omit only if all three empty
  }],
})
```

**`assetDirectory` is relative to the project's `Assets/` folder, NOT the project root.** Passing `"Assets/GeneratedMeshes"` produces `Assets/Assets/GeneratedMeshes/` — a duplicated folder bug. The MCP tool's own default is `"GeneratedModels"` (no prefix); follow that convention. The on-disk file ends up at `<project>/Assets/GeneratedMeshes/<Name>.glb`, which is what every other path in this skill references.

**If `reference_image` is provided** and the file exists, pass it; otherwise omit it (text-to-3D).

**Edge case — wrong-subject drift.** When the model keeps producing a generic neighbor (e.g. asked for a tomato plant, getting a generic berry bush), the caller MAY pass an explicit `negativePrompt` naming the near-miss (`"berries, grapes, cherries, bush of berries"`) and add species-specific anatomy to `mesh_description` (`"tomato plant with central stem, branching stalks, ripe red tomato fruits as solid spheres, serrated tomato leaves"`). The Default 2 block still gets appended on top.

The MCP tool writes the GLB into the project's `Assets/GeneratedMeshes/`. Error classes have different recovery rules:

- **Auth errors are NOT transient.** If the call returns `401`, `unauthorized`, `not authorized`, mentions sign-in / auth / `IsAuthorized`, or otherwise looks like an authentication failure, do NOT retry. Surface `status: NOT_SIGNED_IN` and stop — auth state can change mid-build (user signs out, token expires), so defend in depth here even though sign-in was checked earlier.
- **Transient errors** (network blip, server 5xx, single-turn tool error not matching the auth patterns) → retry once with the same args. On second failure, handle per **On failure** — surface it; any backend switch is announced, never silent.

Then run the shared post-processing below with `backend: fast3d`.

## Post-processing (SPECS + FAST3D output)

**1 — AABB.** Extract from the freshly written GLB:

```bash
node <skill-tools-dir>/analyze_glb.js Assets/GeneratedMeshes/<Name>.glb --aabb
```

This emits the two unified AABB lines, calculated from the GLB's accessor min/max walked through the scene-graph transforms.

**2 — Normalize size at the asset boundary (CRITICAL).** AI output is often human-scale (~100 cm) — usually too big for the Specs 53×77 cm viewport. **Do not let the caller fix this with `setLocalScale`.** Scale on a SceneObject leaks into every component on the node: `ColliderComponent.shape.size` is read in local units, so a 12 cm collider on a node scaled 1/12 becomes 144 cm in world space (Hard Rule 6.2 in specs-experience-builder). The wrapper pattern is one mitigation, but the root cause is using node scale as units conversion — fix it here, at import.

- If `target_size_cm` was passed → ALWAYS normalize, regardless of current size:
  ```bash
  node <skill-tools-dir>/normalize_glb.js \
      Assets/GeneratedMeshes/<Name>.glb Assets/GeneratedMeshes/<Name>.glb \
      --max-dim=<N>            # for single-number target_size_cm
      # OR
      --target=<W>,<H>,<D>     # for "W,H,D" target_size_cm
      # AND, when ground_contact resolves to yes:
      --ground                 # re-seat min-Y → 0 (foot-on-floor)
  ```
  `normalize_glb.js` rewrites POSITION accessor data (and translation components of node transforms) so the resulting AABB matches the target. Rotations are preserved. The output overwrites the input — same path, normalized. After normalization, re-parse the new AABB via `analyze_glb.js --aabb`.
- If `target_size_cm` was NOT passed AND `max(aabb_cm) > 60` → set `size_warning: true` and WARN: the caller should pass `target_size_cm` so the GLB is normalized at the asset boundary, or accept the size and use the wrapper pattern (scaled visual child, unit-scale collider parent) — downstream `setLocalScale` is NOT a fix.
- Otherwise → no normalization, no warning.

If `target_size_cm` was omitted but `ground_contact` resolves to yes, run `normalize_glb.js <in> <out> --ground` on its own. (`--max-dim`/`--target`, `--ground`, `--yaw`/`--rotate`, and `--mark-canonical` all live in `normalize_glb.js`, so size, foot-on-floor, and facing are one code path for every backend — baked into the asset and stamped once, then trusted downstream.)

**3 — Completeness & orientation: detect → bake → verify → stamp.** Generative output can return wrong proportions (a sphere as a flat disc), an arbitrary facing, or a *fragment* of the subject (asked for a spaceship, got only a cockpit). The AABB is blind to all three.

1. **Shape heuristic (always, no dependencies).** `node <skill-tools-dir>/analyze_glb.js <glb> --shape`. If it reports `flat=true` or `sliver=true` and the subject is NOT meant to be flat/thin (a coin, plate, blade, platform legitimately are), set `completeness: suspect` and regenerate once (FAST3D: with the Default 2 anti-flat block; SPECS: with a refined prompt).
2. **Render + look (when Blender is reachable).** Geometry alone doesn't reveal which way a mesh faces, and heuristics ("longest ground axis is forward") misfire across object types — a car is longest front-to-back, a sofa side-to-side:
   ```bash
   /Applications/Blender.app/Contents/MacOS/Blender --background --python <skill-tools-dir>/preview_glb.py -- Assets/GeneratedMeshes/<Name>.glb
   ```
   `Read` the front/side/¾ PNGs in `Assets/GeneratedMeshes/preview/` and confirm: (a) the **whole** subject is present — if a "spaceship" is just a cockpit, regenerate with explicit whole-object language (`"complete spaceship with fuselage, wings, and engines, full body"`); (b) which view is the **front**; (c) proportions match the description. Max 2 regen retries.
3. **Bake + stamp.** Compute the yaw (or a full `--rotate=<rx,ry,rz>` if it imported on its side) that turns the front to `-Z`, then:
   ```bash
   node <skill-tools-dir>/normalize_glb.js Assets/GeneratedMeshes/<Name>.glb Assets/GeneratedMeshes/<Name>.glb --yaw=<deg> --mark-canonical
   ```
   `--mark-canonical` writes `asset.extras.lsCanonical = { forward_axis: "-Z", upright, grounded, version }`; downstream reads it via `analyze_glb.js --orient-meta` and trusts an oriented mesh instead of re-detecting. Re-render and confirm the front **actually** faces `-Z`; set `forward_axis: -Z` only if the re-render clearly shows it.
4. **Uncertainty stamps `unknown`, never a hopeful `-Z` — and movers are not exempt.** "It rotates at runtime via `faceDirection`, so static facing matters less" is *false*: runtime yaw composes with the baked baseline, so an unverified baseline makes the mover face wrong every frame — the tail-first-helicopter failure. When Blender is NOT reachable, skip the bake: set `completeness: unverified`, `forward_axis: unknown`, leave the mesh unstamped — the consumer falls back to a post-instantiation `CaptureRuntimeViewTool` check. Never bake a blind guess: an unstamped mesh is honest, a wrongly-baked one is a silent defect.

## Voxel (Blender) backend

Read `references/voxel-pipeline.md` when this backend is selected — Blender invocation, the static and animation templates, axis reference, toolkit APIs, animation pitfalls and patterns. Raw-Blender escape hatch (bmesh, modifiers, booleans, PBR materials): `references/voxel-raw-blender-api.md`. Pose comes mostly free: `build(center=True)` already puts Y at the floor, and the template's known rotation is baked + stamped without a detection render (raw net is `+Z`, same as the AI backends).

## Scale convention

Voxel scripts are authored in **meters** in Blender; Lens Studio imports at 100×, so 0.2 m = 20 cm `aabb_cm`. The unified `AABB (Lens Studio cm @ 100x import)` line IS the final displayed size — the caller does NOT call `setLocalScale` for default sizing, and `AABB center offset (cm)` tells the wrapper-pattern collider where the visual centroid sits relative to the origin. Every backend follows the same sizing rule: pass `target_size_cm` to normalize at the asset boundary; never fix an oversize asset with downstream `setLocalScale` (post-processing step 2).

### Runtime scale animation on instantiated prefabs (the 100× trap)

Prefabs instantiated from any `/build-mesh` GLB carry `localScale = vec3(100, 100, 100)`. Wrap the prefab and tween the wrapper's scale 0..1; never tween the prefab transform directly (a naive `0.2` reads as 0.2 cm of authored scale → a sub-millimeter speck). See `references/prefab-scale-trap.md` for the wrapper pattern, the inline `× 100` fallback, and the FarmGame.ts bug post-mortem.

## Concurrency (caller responsibility)

FAST3D has a server-side concurrency cap: run at most **4 simultaneous generations**, then wait for all GLBs before starting more — exceeding the cap risks timeouts/5xx. Apply the same ≤ 4 jobs per turn ceiling to SPECS (fan out the creates, then poll and download together). `/build-mesh` is single-mesh — the caller batches; local voxel runs have no server-side cap.

## Request

$ARGUMENTS

Resolve `mesh_name` if not provided — PascalCase from the description. Parse the flags after `|`: `backend=` (`specs` | `fast3d` | `meshbuilder` | `voxel` — a direct per-asset choice; omit to choose from the menu yourself), `target_size_cm=` (single number = uniform max-dimension cap, preserves proportions; `W,H,D` = per-axis — you almost always want to pass the caller's size estimate), `ground_contact=` (`yes` | `no` | `auto`), `reference_image=` (absolute path, routes to image→3D — SPECS by default), and the SPECS knobs (`output_quality`, `preview_quality`, `reconstruction_quality`, `seed`, `style`, `negative_prompt`). For `meshbuilder`, invoke the `mesh-builder-scripting` skill instead of producing a GLB. Otherwise run the matching pipeline and return the per-mesh output contract.
