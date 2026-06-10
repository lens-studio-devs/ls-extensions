// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

import { BaseButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton";

@component
export class UIController extends BaseScriptComponent {
  @input
  sceneObjects: SceneObject[];

  @input
  textObject: Text | undefined;

  @input
  counterText: Text | undefined;

  @input
  nextButton: BaseButton | undefined;

  @input
  previousButton: BaseButton | undefined;

  private currentIndex: number = 0;

  onAwake() {
    // No Canvas created here — this script only toggles `enabled` on @input
    // SceneObjects whose own roots already host a Component.Canvas. The panel
    // root that hosts UIController should itself have a Canvas in
    // SortingType.Hierarchy mode (UIKit default) so DFS owns paint order.
    this.createEvent("OnStartEvent").bind(() => {
      this.onStart();
    });
  }

  onStart() {
    if (!this.sceneObjects || this.sceneObjects.length === 0) {
      print("No scene objects to navigate.");
      return;
    }

    // Activate the initial object
    this.activateCurrentObject();

    // Setup next button
    if (this.nextButton) {
      this.nextButton.onTriggerUp.add(() => {
        this.currentIndex = (this.currentIndex + 1) % this.sceneObjects.length;
        let delayEvent = this.createEvent("DelayedCallbackEvent");
        delayEvent.bind(() => {
          this.activateCurrentObject();
        });
        delayEvent.reset(0.2);
      });
    }

    // Setup previous button
    if (this.previousButton) {
      this.previousButton.onTriggerUp.add(() => {
        this.currentIndex = (this.currentIndex - 1 + this.sceneObjects.length) % this.sceneObjects.length;
        let delayEvent = this.createEvent("DelayedCallbackEvent");
        delayEvent.bind(() => {
          this.activateCurrentObject();
        });
        delayEvent.reset(0.2);
      });
    }
  }

  activateCurrentObject() {
    // Deactivate all objects
    this.sceneObjects.forEach((obj) => {
      obj.enabled = false;
    });

    // Activate the current object
    let currentObject = this.sceneObjects[this.currentIndex];
    currentObject.enabled = true;

    // Update the text object with the current object's name
    if (this.textObject) {
      this.textObject.text = currentObject.name;
    }

    // Update the counter text with current index / total count
    if (this.counterText) {
      this.counterText.text = `${this.currentIndex + 1}/${this.sceneObjects.length}`;
    }
  }
}
