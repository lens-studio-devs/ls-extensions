// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

const model = pluginSystem.findInterface(Editor.Model.IModel);
const App = await import("LensStudio:App");

let isAuthorized: boolean | null = null;
try {
  isAuthorized = pluginSystem.findInterface(Editor.IAuthorization)?.isAuthorized ?? null;
} catch (_) {}

return {
  project: model.project.projectFile.toString(),
  lensStudioPath: App.executablePath,
  lensStudioVersion: App.version,
  auth: { isAuthorized },
};
