// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Save the open project, waiting out the transient "asset operation in progress"
// throw. Can't wait with setTimeout (EEC GCs unretained timer handles), so wait on
// the real event-driven barrier — Task.ITaskManager.whenAllCompleted — then save
// once. If still asset-locked, return busy:true and the caller re-invokes (a fresh
// EEC call gives the editor more time). Run BY PATH via ExecuteEditorCode.
// Returns { saved:true } | { saved:false, busy:true, reason } | { saved:false, error:true, reason }.

const model = pluginSystem.findInterface(Editor.Model.IModel);
const project = model.project;
if (Editor.isNull(project)) return { saved: false, error: true, reason: 'no project is open' };

try {
    const taskManager = pluginSystem.findInterface(Task.ITaskManager);
    if (!Editor.isNull(taskManager)) await taskManager.whenAllCompleted();
} catch (e) { /* non-fatal; the save below is the source of truth */ }

try {
    project.save();
    return { saved: true };
} catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    const busy = /asset operation/i.test(reason) && /in progress/i.test(reason);
    return busy ? { saved: false, busy: true, reason } : { saved: false, error: true, reason };
}
