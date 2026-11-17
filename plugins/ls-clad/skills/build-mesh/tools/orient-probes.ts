// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0
//
// orient-probes · Editor API helper for the LS-capture verify path.
//   SETUP: instantiate one identity-rotation clone of each mesh's ObjectPrefab at an
//     isolated location under one holder; return per-probe { center, distance }.
//   TEARDOWN: destroy the holder.
// Compiled (not inline TS in a doc) so CI type-checks it against editor.d.ts.
// Run via make-eec-script.py (fills CONFIG) → ExecuteEditorCode path:
//   setup:    --set MODE=setup --json MESHES=<[{ "name","aabbMaxCm" }, ...]>
//   teardown: --set MODE=teardown

// ===================== CONFIG — replace per call =====================
const MODE: string = "setup";                                   // "setup" | "teardown"
const MESHES: Array<{ name: string; aabbMaxCm: number }> = [];  // setup only
// =====================================================================

const HOLDER_NAME = "__orient_probe_holder";

const model = pluginSystem.findInterface(Editor.Model.IModel) as Editor.Model.IModel;
if (!model) {
  return { error: "no IModel" };
}
const project = model.project;
const scene = project.scene;

function findHolder(): Editor.Model.SceneObject | null {
  for (const r of scene.rootSceneObjects) {
    if (r.name === HOLDER_NAME) {
      return r;
    }
  }
  return null;
}

if (MODE === "teardown") {
  const existing = findHolder();
  if (existing) {
    existing.destroy();
    project.save();
  }
  return { torn_down: existing != null };
}

// ---- setup ----
const assets = project.assetManager.assets;
// Scene-mode framing cube edge. ~1.8x the largest AABB dim frames the mesh at
// roughly half the view with margin (validated live: an 8cm mark reads tiny at 60
// but fills the frame near 16). Small floor only to avoid a degenerate zero.
const distFor = (aabbMaxCm: number): number => Math.max(aabbMaxCm * 1.8, 12);
// Spacing is derived from the LARGEST framing distance so no probe's ortho frame can
// reach its neighbour (orthoSize tops out near 0.75 * distance in OrthoCapture, so 4x
// the max distance is comfortably clear). A fixed constant bleeds for large meshes.
const spacingCm = 4 * Math.max(60, ...MESHES.map((m) => distFor(m.aabbMaxCm)));

// Fresh holder: destroy a stale one first so re-runs never stack probes.
const stale = findHolder();
if (stale) {
  stale.destroy();
}
const holder = scene.createSceneObject(HOLDER_NAME);

type ProbeOk = { name: string; probeName: string; center: { x: number; y: number; z: number }; distance: number };
type ProbeErr = { name: string; error: string };
const probes: Array<ProbeOk | ProbeErr> = [];

MESHES.forEach((m, i) => {
  let prefab: Editor.Assets.ObjectPrefab | null = null;
  for (const a of assets) {
    let ok = false;
    try {
      ok = a.isOfType("ObjectPrefab");
    } catch (_e) {
      ok = false;
    }
    if (ok && a.name === m.name) {
      prefab = a as Editor.Assets.ObjectPrefab;
      break;
    }
  }
  if (!prefab) {
    probes.push({ name: m.name, error: "ObjectPrefab not found" });
    return;
  }

  // instantiatePrefab requires a non-null parent (editor.d.ts) — hence the holder.
  const obj = scene.instantiatePrefab(prefab, holder);
  obj.name = "__orient_probe_" + m.name;

  const center = { x: i * spacingCm, y: -spacingCm, z: 0 };
  // Editor transform is the `worldTransform` accessor (NOT runtime getTransform()):
  // `position` is a vec3; `rotation` is a vec3 of Euler DEGREES.
  const wt = obj.worldTransform;
  wt.position = new vec3(center.x, center.y, center.z);
  wt.rotation = new vec3(0, 0, 0); // identity — neutralize the import root rotation
  probes.push({ name: m.name, probeName: obj.name, center, distance: distFor(m.aabbMaxCm) });
});

project.save();
return { probes };
