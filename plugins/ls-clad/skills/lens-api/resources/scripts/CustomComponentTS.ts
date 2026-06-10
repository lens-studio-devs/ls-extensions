// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**

 * Specs Inc. 2026
 * A sample custom component that demonstrates how to create reusable components that can be
 * accessed by other scripts. Provides public methods and properties for cross-script communication.
 */

@component
export class CustomComponentTS extends BaseScriptComponent {
    // Public property that can be accessed
    public textureSize: number = 512;

    onAwake(): void {
        // Component setup if needed
      this.createEvent("OnStartEvent").bind(() => this.onStart());
    }
    onStart(): void {
        console.log("CustomComponentTS has been initialized");
    }

    // Public method that can be called
    public hasTexture(): boolean {
        console.log("CustomComponentTS.hasTexture() called successfully");
        return true;
    }
}
