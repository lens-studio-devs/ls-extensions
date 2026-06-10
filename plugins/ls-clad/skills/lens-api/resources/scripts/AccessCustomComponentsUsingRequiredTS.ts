// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * Demonstrates how to access custom components using the requireType() method. This script shows
 * how to dynamically load and access custom TypeScript components at runtime.
 */
@component
export class AccessCustomComponentsUsingRequiredTS extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Target Configuration</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Specify the scene object that has the custom component you want to access</span>')

  @input
  public targetObject: SceneObject;

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Debug Settings</span>')

  @input
  public debug: boolean = false;

  /**
   * Called when component is initialized
   */
  private typeName = requireType(
    './CustomComponentTS'
  ) as keyof ComponentNameMap;

  onAwake(): void {
    console.debug("LIFECYCLE: onAwake() - Component initializing");
    this.createEvent("OnStartEvent").bind(() => this.onStart());
  }
  onStart(): void {

    try {
      console.log("AccessCustomComponentsUsingRequiredTS initialized");

      // Get all components on this object
      const components = this.targetObject.getAllComponents();
      console.log(`Found ${components.length} components on this object`);
      const customComponentExample = this.targetObject.getComponent(
        this.typeName
      ) as any;

      customComponentExample.hasTexture();

      console.log(`Found Texture Size ${customComponentExample.textureSize} on this object`);

    } catch (error) {
      console.log(`Error: ${error}`);
    }
  }
}
