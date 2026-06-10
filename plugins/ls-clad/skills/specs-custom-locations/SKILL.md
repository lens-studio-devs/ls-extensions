---
name: specs-custom-locations
description: Anchor AR content to a real-world place on Specs using Custom Locations + LocatedAtComponent (onFound). Load for location-locked or site-specific AR, scanning-based placement, hiding the scan mesh, location groups, or Connected-Lens placement.
user-invocable: false
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Custom Locations — Real-World Location AR

**Requirements:** Lens Studio v5.15.4+, Spectacles OS v5.64+, Spectacles App v0.64+. The
**Custom Locations** Lens (in *All Lenses* on the device) is used to scan and publish.

## What this skill can and cannot automate

**Only one step genuinely needs Specs hardware:** minting a Location ID for a place nobody
has scanned yet. Everything else an agent can do — including creating the location asset.

| Step | Who | How |
|------|-----|-----|
| Mint a **new** Location ID for a **new** space | **User, on device** | Custom Locations Lens — the only device-bound step |
| Get a `LocationAsset` into the project + set its Location ID | **Agent** *(or user in UI)* | `asset-graphql` / Editor-API `createNativeAsset` + set `locationId` |
| Add `LocatedAtComponent`, set its `Location`, parent + position content | **Agent** | scene-graphql / VirtualScene |
| Write/attach scripts, hide the mesh on device, activation logic, groups | **Agent** | the reference scripts below |

You do **not** need to scan to develop — published locations are public and reusable by ID (see
*Develop without your own scan*). Don't call a Custom Location Lens "done" until a **real**
Location ID is wired (a fresh scan, or a reused published one) and its mesh has loaded in-editor.

---

## Workflow Overview

1. **User** scans on device → publishes → gets a Location ID (Step 1).
2. **Agent** creates a `LocationAsset` + wires `LocatedAtComponent` (Step 2), parents content under
   that node (Step 3), adds activation + mesh-hiding scripts.
3. **Agent + user** test in the editor (camera-approach mock) → publish the Lens.

---

## Step 1 — Scan a location (user, on device)

1. Open the **Custom Locations** Lens on Specs → **Scan New** → **Begin Scanning**.
2. Move **laterally** through the space in a sweeping figure-8 — do not pivot in place.
3. Cover every angle users will later look from; scan longer for more localization viewpoints.
4. Avoid fast motion and extreme up/down angles.
5. **Finish Scan** → accept the disclaimer → **Publish** → note the **Location ID**.

---

## Step 2 — Get a location asset into Lens Studio

A Custom Location is backed by a **`LocationAsset`** — a native asset whose `locationId` is the
published Location ID and whose `locationType` is `Custom` (the `LocationType` enum is
`{ Snap(0), Custom(1), World(2) }`).

Build the node directly: **`asset-graphql`** for the assets, then one **VirtualScene `apply`** for
the scene. `LocationAsset` and `LocationMesh` are both `createNativeAsset` types; the scan material
comes from the `LocationMeshMaterialPreset` preset. This makes **exactly one reusable asset set**
and a clean two-object hierarchy — nothing else.

```graphql
# asset-graphql — create the assets, then set the ID + type and link the mesh to the asset
createNativeAsset(assetType: "LocationAsset", name: "Custom Location", destinationPath: "Locations")
createNativeAsset(assetType: "LocationMesh",  name: "Location Mesh",   destinationPath: "Locations")
createAssetFromPreset(presetName: "LocationMeshMaterialPreset", name: "Location Material", destinationPath: "Locations")

setProperty(id: "<locationAssetId>", propertyPath: "locationId",   value: "<PUBLISHED_LOCATION_ID>", valueType: STRING)
setProperty(id: "<locationAssetId>", propertyPath: "locationType", value: "Custom", valueType: ENUM, enumType: "Editor.Assets.LocationType")
setProperty(id: "<locationMeshId>",  propertyPath: "location",     value: "<locationAssetId>",       valueType: REFERENCE)
```

```jsonc
// VirtualScene apply — the Custom Location node carries BOTH components; content is its child.
// Reference assets by @id:<uuid> in property values (a bare @asset:Name resolves only with the
// full "Folder/Name.ext" path, so @id is the reliable form).
{ "create": [
    { "id": "$temp:cl", "name": "Custom Location", "transform": { "position": [0,0,0] },
      "components": [
        { "type": "LocatedAtComponent", "properties": { "location": "@id:<locationAssetId>" } },
        { "type": "RenderMeshVisual",   "properties": { "mesh": "@id:<locationMeshId>",
                                                         "mainMaterial": "@id:<materialId>" } } ] },
    { "id": "$temp:content", "name": "Content", "parentId": "$temp:cl" } ] }
```

Editor-API equivalent: `assetManager.createNativeAsset("LocationAsset", …)`, then set `locationId`
and `locationType`.

> ⚠️ Setting `locationId` wires the **anchor** only. The scan **mesh** is the separate `LocationMesh`
> rendered through the Location Material on the `RenderMeshVisual` above — and it imports as an empty
> placeholder until Lens Studio fetches the geometry from the published ID (needs internet, in-editor).
> The anchor still localizes and content parented under the node still renders even when the mesh
> hasn't downloaded; confirm the mesh loaded before positioning content against it.

The scan mesh is a **developer placement aid only** — not meant to render in the published
Lens (see *Hide the scan mesh on device*).

### Develop without your own scan

You don't need Specs to build and editor-test a Custom Location Lens — just wire in any valid
Location ID:

- **Wire a public published Location ID** (the fast path). In-editor localization keys off the
  `locationId` on the `LocationAsset`, so *any* published Custom Location ID makes the node localize
  in the editor — no device, no scan. Lens Studio ships a stock public example, **`ZDB3WPGEL6BA`**
  (`locationType: Custom`); drop it into the Step 2 recipe to get a localizing node out of the box,
  then swap in your own published ID when shipping. *(Stock IDs can change across versions — if it
  stops localizing, use any other published ID.)*
- **Open an official sample.** The Custom Locations and Navigation Kit sample templates ship with
  ready-made location assets (mesh included), so they localize in-editor out of the box.

Reserve on-device scanning for shipping a Lens tied to a **new** physical space that hasn't been
scanned yet.

---

## Step 3 — Scene hierarchy & placement rules

The Custom Location node carries a **`LocatedAtComponent`**. Placement rules:

- **Parent all anchored content under the `LocatedAtComponent` node.** Its transform is what
  gets aligned to the real world at runtime. Content placed elsewhere will not move with the
  location.
- **Keep the Custom Location node at transform (0, 0, 0).** It carries both the anchor and the
  scan mesh; the scan's origin is where the space was originally mapped, not the device's start
  position, so moving the node desynchronizes editor placement from on-device placement.
- Position your content relative to the mesh in the editor — what you see against the mesh is
  where it will appear in the real space.

```
World
└── Custom Location                  ← LocatedAtComponent + RenderMeshVisual on this node
                                        (anchor + scan mesh = Location Mesh + Location Material; hide mesh on device)
      └── Content                    ← your AR objects, positioned against the mesh
```

---

## Runtime — the `LocatedAtComponent` lifecycle

Content does not appear the instant the Lens starts. The device must first **localize** —
recognize where it is inside the scanned space. Drive everything off these events
(get the component with `sceneObject.getComponent("LocatedAtComponent")`):

| Member | Type | Meaning |
|--------|------|---------|
| `onReady` | event | Location asset loaded, component initialized |
| `onCanTrack` | event | User is within range; tracking can begin |
| `onCannotTrack` | event | User moved out of range |
| `onFound` | event | **Localized** — content is now anchored to the real world |
| `onLost` | event | Tracking lost after being found |
| `onError` | event | Asset failed to load / track (bad or expired ID, no internet) |
| `proximityStatus` | `LocationProximityStatus` | `Unknown(0)` / `WithinRange(1)` / `OutOfRange(2)` |
| `distanceToLocation` | number (readonly) | Distance to the location once known |
| `location` | `LocationAsset` | The anchor asset |

Healthy on-device sequence: **`onReady` → `onCanTrack` → `onFound`**. Gate "show content"
on `onFound`, never on `OnStartEvent`.

### The editor-vs-device rule (most common mistake)

**The device never localizes inside Lens Studio, so `onFound` never fires in the editor.** If
you gate content purely on `onFound`, the editor shows nothing and it looks broken. Always
branch on `global.deviceInfoSystem.isEditor()` and treat the editor as already localized:

```typescript
const localized = this.didLocalize || global.deviceInfoSystem.isEditor()
```

This lets you test the whole experience in the editor by dragging the Preview camera toward the
content, while on device it waits for the real `onFound`.

---

## Content activation framework

Separates *deciding when the user is present* from *what each piece of content does about it*
(shipped by the official Custom Locations template):

- **`LocatedObject`** — an interface with `localize()` / `activate()` / `deactivate()`.
- **`LocationActivator`** — attach to the `LocatedAtComponent` node. It listens for `onFound`,
  then each frame measures the horizontal camera-to-center distance and checks
  `camera.isSphereVisible(center, radius)`; it calls `activate()` / `deactivate()` on a list of
  listeners (with hysteresis so content doesn't flicker at the boundary). Includes the
  `isEditor()` branch.
- **Listeners** implement `LocatedObject`: `ScaleInLocatedObject` (scale content in/out),
  `AudioLocatedObject` (play/stop a sound), or your own.

Drop-in, dependency-free reference implementations (standard `createEvent`/`getComponent`
idioms — no extra packages):

- `resources/scripts/LocatedObject.ts`
- `resources/scripts/LocationActivator.ts`
- `resources/scripts/ScaleInLocatedObject.ts`
- `resources/scripts/AudioLocatedObject.ts`
- `resources/scripts/LocationStatusLogger.ts` — logs the full lifecycle; attach to diagnose
  localization failures on device.

**Wiring:** on the `LocatedAtComponent` node, add `LocationActivator`; set `camera`, an optional
`centerReference`, and add the `ScaleInLocatedObject` / `AudioLocatedObject` instances to its
`listeners` array. Each listener points at the content it controls.

For a **single anchored object with no proximity logic**, you don't need the framework — just
parent it under the Custom Location node and (optionally) enable it on `onFound`.

---

## Show the scanned mesh (Location Mesh + Location Material)

The Step 2 recipe already wires this onto the Custom Location node. If starting from a bare
`LocationAsset` (skipped Step 2), or for the Connected-Lens / Colocated-World case below, follow the
same recipe: `createNativeAsset` the `LocationMesh`, `createAssetFromPreset` the material from
`LocationMeshMaterialPreset`, set `LocationMesh.location` → the `LocationAsset`, then wire a
`RenderMeshVisual` (`mesh` + `mainMaterial`) by `@id:<uuid>` on the Custom Location node itself (the
one carrying the `LocatedAtComponent`), kept at transform **(0, 0, 0)**. Then hide it on device
(next section) — this mesh is a **developer placement aid only**.

---

## Hide the scan mesh on device

The colored mesh must not ship as a visual. Disable it on device while keeping it in the editor
for placement. Use `resources/scripts/HideLocationMeshOnDevice.ts` — attach to the parent of the
Custom Location node(s); on device it sets each child `LocatedAtComponent`'s `RenderMeshVisual`
`enabled = false`, and no-ops in the editor.

---

## Location Groups (multiple nearby locations)

Link up to **5** locations (each within ~20 m) into a group so the Lens localizes seamlessly as
the user moves between them. The group is one component, `CustomLocationGroupComponent`.

1. In the Custom Locations Lens: **New Group** → select the scans → stabilize each member →
   **Finalize** → publish → note the **Group ID**.
2. In Lens Studio: add a **Custom Location Group** component, paste the **Group ID**, click
   **Reload Group**. Lens Studio generates a child Custom Location node per member.

```
LocationRoot
└── Custom Location Group (component, Group ID: "…")
      ├── Custom Location A   (LocatedAtComponent)
      ├── Custom Location B   (LocatedAtComponent)
      └── Custom Location C   (LocatedAtComponent)
```

- `onFound` on the group is `event1<string>` — it reports the **location ID** of the member that
  localized, so you can react per-location.
- `hintUserPosition(groupLocalPosition: vec3)` lets you bias which member is tried first when you
  already know roughly where the user is (overrides the editor's initial-trackable choice for the
  session).
- Attach one `LocationActivator` per child `LocatedAtComponent` node, and put
  `HideLocationMeshOnDevice` on the group node so all member meshes hide on device.

---

## Incremental scans (add viewpoints)

When users can't localize from certain angles, add viewpoints without rebuilding the mesh:

1. Custom Locations Lens → `…` on the existing scan → `+` → confirm.
2. Localize against the existing scan → **Finish Scan**.
3. Move to capture the new viewpoints → **Publish** → get a **new ID**.
4. In Lens Studio, replace the old Location ID with the new one and re-publish the Lens.

> New scan = new ID but the **same coordinate frame** → you do not need to reposition content.

---

## Multiplayer (Connected Lenses)

Custom Locations combine with **SpectaclesSyncKit** for shared, colocated experiences pinned to a
real place. That integration is owned by the **`specs-sync-kit`** skill — load it for the full setup.
Key differences to know up front:

- Place the **`Location` asset** on the **`Colocated World`** SceneObject's `LocatedAtComponent`
  (not a standalone Custom Location node); synced content lives under `Colocated World`.
- The Connected-Lens origin is the scan's mapped origin, not the device — add the **Location Mesh
  + Location Material** render setup (see *Show the scanned mesh*) kept at transform (0, 0, 0) to
  position content accurately.
- **Custom Location *Group* is not supported** in Connected Lenses — single location only.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| Nothing shows in the editor | Content gated on `onFound`, which never fires in-editor. Add the `global.deviceInfoSystem.isEditor()` branch. |
| Content never appears on device | Device isn't localizing. Attach `LocationStatusLogger`; if you only see `onReady` (no `onCanTrack`/`onFound`), the user is out of range or the scan lacks viewpoints from that angle — add an incremental scan. |
| `onError` fires | Bad/expired Location ID, or no internet (the asset downloads at runtime). Re-check the ID and connectivity. |
| Content is misaligned in the real world | The location-mesh SceneObject was moved off (0, 0, 0), or content was parented outside the `LocatedAtComponent` node. |
| Scan mesh visible to users | `HideLocationMeshOnDevice` not attached, or attached to the wrong node (must be the parent of the `LocatedAtComponent` child(ren)). |
| Content flickers at the boundary | Increase `deactivateMultiplier` on `LocationActivator` to widen the hysteresis gap. |

---

## Limitations

- Saved Location IDs live **locally on the scanning device** — a factory reset forgets them.
- Published locations are **public** — never scan private or sensitive spaces.
- **5 locations** max per group; members should be within ~20 m of each other.
- Works indoors and outdoors; indoors usually scans more reliably. Keep scans focused —
  very large spaces degrade tracking.
- The location asset **downloads at runtime**, so the Lens needs internet to localize.
