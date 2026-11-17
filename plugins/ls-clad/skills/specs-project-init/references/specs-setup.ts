// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Specs project setup. Fired by /specs-project-init via ExecuteEditorCode (`code` or
// `path`); idempotent (mutates only what's missing, safe to re-run). Sets:
//   1. targetPlatform -> Spectacles
//   2. root Camera -> Perspective + DeviceTracking(World)
//   3. preview -> SPECS 27 stereo + Interactive, only when the panel isn't on a Specs device
//      (preserves an already-Interactive scene)
//   4. InteractionKit prefab at scene root (legacy projects: SpectaclesInteractionKit), if IK is installed
//
// Returns a flat key=value line:
//   projectPath, isAuthorized, targetPlatform, installedPackages, deviceTracking,
//   sikInstalled, uikitInstalled, sikPrefab [, nextAction] [, errors]
// Early returns before any mutation: error=no_project_open, error=wrong_project_open.

const errs: Record<string, string> = {};
const imp = async (n: string): Promise<any> => await import("LensStudio:" + n);

// ---------------------------------------------------------------------------
// Preflight — resolve the loaded project, or bail with an actionable signal.
// ---------------------------------------------------------------------------

const model: any = pluginSystem.findInterface(Editor.Model.IModel);
const project: any = model && model.project;

// No project loaded — return a clean signal instead of throwing a raw TypeError on
// project.scene below. (If LS/MCP is down the call never reaches here — it fails at the
// transport layer, which the caller reads as "run /lens-studio-router".)
if (!project) {
  return "error=no_project_open — open the target .esproj in Lens Studio and re-run";
}

// Wrong-project guard. /specs-project-init substitutes EXPECT_PROJECT with the cwd .esproj
// absolute path (the ONE line it may fill in) so this refuses to mutate a DIFFERENT project
// Lens Studio happens to have open. Left "" (fired verbatim) the guard is OFF and the caller
// relies on /lens-studio-router's project-match instead. Runs BEFORE any mutation.
const EXPECT_PROJECT = "";
const projectPath: string = (() => {
  try {
    return String(project.projectFile);
  } catch (e) {
    return "";
  }
})();
const norm = (p: string): string => p.trim().replace(/\/+$/, "");
if (EXPECT_PROJECT && norm(projectPath) !== norm(EXPECT_PROJECT)) {
  return `error=wrong_project_open — Lens Studio has ${projectPath || "unknown"} open, expected ${EXPECT_PROJECT}; nothing changed. Switch projects (or run /lens-studio-router) and re-run.`;
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

const scene: any = project.scene;
const am: any = project.assetManager;

const TP: any = Editor.TargetPlatform;
// TargetPlatform has no reverse index; invert by hand for the readable name.
const tpName = (v: any): string => Object.keys(TP).find((k) => TP[k] === v) ?? String(v);

// Package install-state is detected by NAME, not a hardcoded package id: a released id is
// version-specific, so an id check reports "not installed" right after installing — and the
// prefab never instantiates. From Lens Studio 5.25 (package line 4.0.0) the frameworks dropped
// the Spectacles prefix (SpectaclesInteractionKit -> InteractionKit, SpectaclesUIKit -> UIKit),
// so a project can carry either name. Match EXACT names from both alias groups: a substring
// match would read a renamed package as missing (and install a second copy) or count
// InteractionKitExamples as InteractionKit. A trailing " <n>" (Lens Studio's name for a second
// copy, e.g. "UIKit 2") still counts as the same package.
const pkgKey = (n: any): string =>
  String(n || "")
    .toLowerCase()
    .replace(/\.lspkg$/, "")
    .replace(/\s+\d+$/, "")
    .replace(/[^a-z0-9]/g, "");
const SIK_NAMES = ["interactionkit", "spectaclesinteractionkit"];
const UIKIT_NAMES = ["uikit", "spectaclesuikit"];
const pkgIs = (p: any, names: string[]): boolean =>
  !!p && [p.name, p.packageName].some((n: any) => names.indexOf(pkgKey(n)) >= 0);
const isSikPackage = (p: any): boolean => pkgIs(p, SIK_NAMES);
const isUikitPackage = (p: any): boolean => pkgIs(p, UIKIT_NAMES);

// ---------------------------------------------------------------------------
// 1. Target platform -> Spectacles (idempotent).
// ---------------------------------------------------------------------------

try {
  if (project.targetPlatform !== TP.Spectacles) {
    project.targetPlatform = TP.Spectacles;
  }
} catch (e) {
  errs.target = String(e);
}

// ---------------------------------------------------------------------------
// 2. Root camera -> Perspective + DeviceTracking(World).
// ---------------------------------------------------------------------------

// Find the Camera by its component, not by name (name varies across templates).
let camObj: any = null;
try {
  camObj = scene.rootSceneObjects.find((o: any) => o.getComponents("Camera").length > 0);
} catch (e) {
  errs.camera = String(e);
}

if (camObj) {
  try {
    const cam: any = camObj.getComponents("Camera")[0];
    if (cam.cameraType !== Editor.Components.CameraType.Perspective) {
      cam.cameraType = Editor.Components.CameraType.Perspective;
    }
  } catch (e) {
    errs.cameraType = String(e);
  }

  try {
    const dts: any = camObj.getComponents("DeviceTracking");
    const dt: any = dts.length ? dts[0] : camObj.addComponent("DeviceTracking");
    dt.deviceTrackingMode = Editor.Components.DeviceTrackingMode.World;
  } catch (e) {
    errs.deviceTracking = String(e);
  }
}

// ---------------------------------------------------------------------------
// 3. Preview simulation -> SPECS 27 stereo + Interactive, only when the panel
//    isn't on a Specs (stereo) device; a Specs panel keeps the user's input.
//    Preserves an already-Interactive scene rather than clobbering it.
// ---------------------------------------------------------------------------

try {
  // Independent hidden-module loads — resolve in parallel (neither depends on the other).
  const [Preview, Engine]: any[] = await Promise.all([imp("Preview"), imp("Engine")]);
  const { Config, Input, StreamType, allScenes } = Preview;

  const dm: any = pluginSystem.findInterface(Editor.Dock.IDockManager);
  const panel: any = dm ? dm.findPanel("Snap.Plugin.Gui.PreviewPanel") : null;
  if (!panel) throw new Error("preview_panel_not_found");

  // Match by name; presets.stereo is data-driven (see engine stereo.json) and extendable.
  const presets: any = Engine.Device.presets;
  const stereo: any[] = presets.stereo || [];
  const curDevice: any = panel.device;
  const onSpecs = !!curDevice && stereo.some((d: any) => d && d.name === curDevice.name);
  const dev: any = stereo.find((d: any) => d && d.name === "SPECS 27") ?? stereo[0];
  if (!dev) throw new Error("no_stereo_preset");
  if (!onSpecs) panel.device = dev;

  const cur: any = panel.config;
  const curPath: any =
    cur && cur.input && cur.input.type === StreamType.Interactive ? cur.input.sourcePath : null;

  if (!onSpecs && !(curPath && curPath.toString().length > 0)) {
    const raw: any = await allScenes();
    const paths: string[] = (Array.isArray(raw) ? raw : [])
      .map((i: any) => i && i.sourcePath)
      .filter((sp: any) => sp != null)
      .map((sp: any) => (typeof sp.toString === "function" ? sp.toString() : String(sp)))
      .filter((sp: string) => sp.length > 0);

    const chosen: string = paths[0];
    if (!chosen) throw new Error("no_scene_source");

    const config: any = cur ?? new Config();
    const input: any = new Input();
    // Preview input can't be StreamType.None — only Interactive/Multimedia.
    input.type = StreamType.Interactive;
    input.sourcePath = new Editor.Path(chosen);
    config.input = input;
    panel.config = config;
  }
} catch (e) {
  errs.preview = String(e);
}

// ---------------------------------------------------------------------------
// 4. IK / UIKit install-state + IK prefab at root.
//    IK prefab is instantiated only if IK is installed; UIKit has no scene
//    prefab — it just needs to be installed.
// ---------------------------------------------------------------------------

let installedPackages = 0;
let sikInstalled = false;
let uikitInstalled = false;
try {
  const pkgs: any[] = am.assets.filter((a: any) => a && a.isOfType && a.isOfType("NativePackageDescriptor"));
  installedPackages = pkgs.length;
  sikInstalled = pkgs.some(isSikPackage);
  uikitInstalled = pkgs.some(isUikitPackage);
} catch (e) {
  errs.pkgRead = String(e);
}

let sikPrefab = false;
try {
  // InteractionKit 4.0 ships Prefabs/InteractionKit.prefab (root "InteractionKit"); legacy
  // SpectaclesInteractionKit ships SpectaclesInteractionKit.prefab. Accept either, prefer 4.0.
  const IK_PREFABS = ["InteractionKit", "SpectaclesInteractionKit"];
  sikPrefab = scene.rootSceneObjects.some((o: any) => IK_PREFABS.indexOf(o.name) >= 0);
  if (!sikPrefab && sikInstalled) {
    const prefabs: any[] = am.assets.filter(
      (a: any) => a && IK_PREFABS.indexOf(a.name) >= 0 && a.isOfType && a.isOfType("ObjectPrefab"),
    );
    prefabs.sort((a: any, b: any) => IK_PREFABS.indexOf(a.name) - IK_PREFABS.indexOf(b.name));
    const prefab: any = prefabs[0];
    if (prefab) {
      await am.instantiate([prefab]);
      sikPrefab = true;
    }
  }
} catch (e) {
  errs.sik = String(e);
}

// ---------------------------------------------------------------------------
// Read-back report — final state.
// ---------------------------------------------------------------------------

let isAuthorized: boolean | null = null;
try {
  const a: any = pluginSystem.findInterface(Editor.IAuthorization);
  isAuthorized = a ? a.isAuthorized : null;
} catch (e) {
  errs.auth = String(e);
}

let targetPlatform = "unknown";
try {
  targetPlatform = tpName(project.targetPlatform);
} catch (e) {
  errs.targetRead = String(e);
}

let deviceTracking = "none";
try {
  if (camObj) {
    const dts: any = camObj.getComponents("DeviceTracking");
    deviceTracking = dts.length
      ? (dts[0].deviceTrackingMode === Editor.Components.DeviceTrackingMode.World ? "World" : "other")
      : "none";
  }
} catch (e) {
  errs.dtRead = String(e);
}

let report =
  `projectPath=${projectPath}, ` +
  `isAuthorized=${isAuthorized}, ` +
  `targetPlatform=${targetPlatform}, ` +
  `installedPackages=${installedPackages}, ` +
  `deviceTracking=${deviceTracking}, ` +
  `sikInstalled=${sikInstalled}, ` +
  `uikitInstalled=${uikitInstalled}, ` +
  `sikPrefab=${sikPrefab}`;
if (!sikInstalled || !uikitInstalled) {
  const missing = [!sikInstalled ? "InteractionKit" : "", !uikitInstalled ? "UIKit" : ""].filter(Boolean).join(" + ");
  report += !uikitInstalled
    ? `, nextAction=${missing} not installed — run /ensure-package-installed with package_name="UIKit" (UIKit 4.0 installs InteractionKit, Motion and Icons as its dependencies; one package per call), then re-run this script; only if sikInstalled is still false, install package_name="InteractionKit". Never install a package that is already present under its legacy name (SpectaclesUIKit / SpectaclesInteractionKit) — see /specs-package-renames`
    : `, nextAction=InteractionKit not installed — run /ensure-package-installed with package_name="InteractionKit", then re-run this script to instantiate the InteractionKit prefab`;
}
if (Object.keys(errs).length) {
  report += `, errors=${JSON.stringify(errs)}`;
}
return report;
