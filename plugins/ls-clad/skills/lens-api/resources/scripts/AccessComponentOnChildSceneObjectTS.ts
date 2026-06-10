// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * Demonstrates how to access components on child scene objects. This script shows how to navigate
 * the scene hierarchy to find and access components on child objects of a parent scene object.
 */
@component
export class AccessComponentOnChildSceneObjectTS extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Scene Object Reference</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Reference to the parent scene object whose child components you want to access</span>')

  @input
  @allowUndefined
  @hint("The parent component")
  parentSceneobject: SceneObject;

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Debug Settings</span>')

  @input
  @allowUndefined
  @hint("Show logs in the console")
  debug: boolean;

  /**
   * Called when component is initialized
   */
  onAwake(): void {
    console.debug("LIFECYCLE: onAwake() - Component initializing");
    this.createEvent("OnStartEvent").bind(() => this.onStart());
  }
  onStart(): void {
    console.log("Start event triggered");

    if (
      this.parentSceneobject !== null &&
      this.parentSceneobject.getChild(0) !== null
    ) {
      console.log("Parent scene object is not null");
      console.log("Parent scene object name: " + this.parentSceneobject.name);
      console.log(
        "Parent child object name: " + this.parentSceneobject.getChild(0).name
      );
    }

    if (
      this.parentSceneobject
        .getChild(0)
        .getComponent("Component.RenderMeshVisual")
        .getTypeName()
    ) {
      console.log("Parent child object has a RenderMeshVisual component");
    } else {
      console.log("Parent child object does not have a RenderMeshVisual component");
    }
  }
}
