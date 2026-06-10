// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// Opens a Lens project and saves it back to the same path. Used after
// `--exec project-update --force` to flush any asset/sub-file migrations that
// the format upgrade performs in-memory but does not persist to disk on its own.
//
// Usage:
//   "<LENS_STUDIO>" --exec run-script -f save-project.js -a "<PROJECT>.esproj"
//
// `pluginSystem` and `args` are globals injected by the Lens Studio run-script
// runtime.

const model = pluginSystem.findInterface(Editor.Model.IModel.interfaceId);
const projectPath = new Editor.Path(args[0]);

model.openProject(projectPath);
model.project.saveTo(projectPath);

console.log("PROJECT_SAVED: " + projectPath.toString());
