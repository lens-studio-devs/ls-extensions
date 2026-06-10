// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Hides the colored scan mesh on device while keeping it visible in the Lens Studio editor.
 *
 * The location mesh is a placement aid for the developer — it must NOT ship as a visual in
 * the running Lens. Attach this to the parent SceneObject whose direct children carry the
 * LocatedAtComponent(s): the Custom Location Group node for a group, or the parent of a
 * single Custom Location. On device it disables each child's RenderMeshVisual; in the editor
 * it leaves them on so you can still position content against the mesh.
 */
@component
export class HideLocationMeshOnDevice extends BaseScriptComponent {
  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.onStart())
  }

  private onStart(): void {
    if (global.deviceInfoSystem.isEditor()) {
      return
    }
    this.getSceneObject().children.forEach((child) => {
      const locatedAt = child.getComponent("LocatedAtComponent")
      if (!locatedAt) {
        return
      }
      const mesh = locatedAt.sceneObject.getComponent("RenderMeshVisual")
      if (mesh) {
        mesh.enabled = false
      }
    })
  }
}
