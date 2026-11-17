// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Router Gate diagnose. Fired by /lens-studio-router via ExecuteEditorCode `path`, and
// doubles as the MCP reachability probe (a JSON return = MCP up). Reports the loaded
// project, its target/intended platforms, sign-in, and the running LS executable +
// version. Returns JSON:
//   { ok, projectPath, targetPlatform, intendedPlatforms, isAuthorized,
//     lensStudioPath, lensStudioVersion, <field>Error? }

// Return shape.
interface GateOut {
  ok: boolean;
  projectPath?: string | null;
  projectPathError?: string;
  targetPlatform?: string | null;
  targetPlatformError?: string;
  intendedPlatforms?: string[] | null;
  isAuthorized?: boolean | null;
  authError?: string;
  lensStudioPath?: string | null;
  lensStudioVersion?: string | null;
  lensStudioError?: string;
  modelError?: string;
}

const out: GateOut = { ok: true };

const TP: any = Editor.TargetPlatform;
const tpName = (v: any): string =>
  Object.keys(TP).find((k) => TP[k] === v) ?? String(v);

let model: any = null;
try {
  model = pluginSystem.findInterface(Editor.Model.IModel);
} catch (e) {
  out.modelError = String(e);
}

// Project identity — which project is actually loaded.
try {
  out.projectPath = model ? model.project.projectFile.toString() : null;
} catch (e) {
  out.projectPath = null;
  out.projectPathError = String(e);
}

// Target + intended platforms — feed Route's project-stated precedence.
try {
  if (model) {
    out.targetPlatform = tpName(model.project.targetPlatform);
    const intended = model.project.intendedPlatforms;
    out.intendedPlatforms = Array.isArray(intended) ? intended.map(tpName) : null;
  } else {
    out.targetPlatform = null;
  }
} catch (e) {
  out.targetPlatform = null;
  out.targetPlatformError = String(e);
}

// Running Lens Studio — executable + version behind this MCP session, so the Gate
// can compare (major, minor) >= (5, 25) without scanning disk.
try {
  const App: any = await import("LensStudio:App");
  out.lensStudioPath = App.executablePath;
  out.lensStudioVersion = App.version;
} catch (e) {
  out.lensStudioPath = null;
  out.lensStudioVersion = null;
  out.lensStudioError = String(e);
}

// Sign-in — the account login gating AI generation, Remote Service Gateway tokens, and publish.
// NOTE on semantics: since Lens Studio's two-account layer (Snapchat + SPECS behind
// IAccountManager), `isAuthorized` reflects the account of the *project's target
// platform*, not "signed in to Snapchat". On a Spectacles-target project it is the
// SPECS account; on a Snapchat-target project it is the Snapchat account.
// IAccountManager is not script-bound, so the non-active platform's
// state is unreadable from here — the router only interprets this AFTER resolving the
// platform, and only when the resolved platform equals the project's target platform.
try {
  const auth = pluginSystem.findInterface(Editor.IAuthorization);
  out.isAuthorized = auth ? auth.isAuthorized : null;
  if (!auth) out.authError = "no_auth_interface";
} catch (e) {
  out.isAuthorized = null;
  out.authError = String(e);
}

return JSON.stringify(out);
