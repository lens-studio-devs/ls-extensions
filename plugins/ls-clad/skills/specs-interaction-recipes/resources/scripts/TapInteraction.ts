// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import { InteractorEvent } from "SpectaclesInteractionKit.lspkg/Core/Interactor/InteractorEvent";
import Event from "SpectaclesInteractionKit.lspkg/Utils/Event";

/**
 * TapInteraction
 *
 * Drop-in @component for object pinch-tap. Wraps SIK's `Interactable` and exposes
 * named hooks so callers don't have to wire the Interactable themselves.
 *
 * Platforms (no manual editor mock needed):
 *  - Spectacles device          → HandInteractor fires Interactable.onTriggerStart
 *  - Lens Studio Editor Preview → MouseInteractor fires Interactable.onTriggerStart
 *  - Spectacles + Snap mobile app (phone-as-controller) → MobileInteractor fires it
 *
 * DO NOT also bind TapEvent / TouchStartEvent in this script. SIK's Interactor
 * system already routes all three platforms into Interactable.onTriggerStart.
 * Manually binding TapEvent on top would DOUBLE-FIRE onTap in the Editor.
 * See specs-interaction-recipes/SKILL.md §2 for the decision rule.
 *
 * For a tap with no Interactable target (tap-anywhere-to-spawn, mid-air
 * pinch detection), use the Interactor-level pattern instead — see SKILL.md §2
 * "Free-space gesture" subsection.
 *
 * Usage:
 *   // 1. Attach this script to the scene object you want to tap (a ColliderComponent
 *   //    will be auto-created if the object doesn't have one).
 *   // 2. Subscribe from your main script:
 *   //      const tap = sceneObj.getComponent("ScriptComponent") as TapInteraction;
 *   //      tap.onTap.add(() => print("tapped!"));
 */

@component
export class TapInteraction extends BaseScriptComponent {

    // Configuration — modify before onAwake or via inspector defaults
    private CONFIG = {
        autoCreateCollider: true,          // Create a box collider if the object doesn't have one
        colliderSize: new vec3(10, 10, 10), // cm — only used when autoCreateCollider
        debugCollider: false,              // Show wireframe while prototyping
        targetingMode: 3,                  // 1 = Direct touch only, 2 = Indirect (raycast) only, 3 = Both
    };

    // Public signals — subscribe from any other component
    public onTap: Event<InteractorEvent> = new Event<InteractorEvent>();
    public onHoverStart: Event<InteractorEvent> = new Event<InteractorEvent>();
    public onHoverEnd: Event<InteractorEvent> = new Event<InteractorEvent>();

    private interactable: Interactable;

    onAwake() {
        this.ensureCollider();
        this.ensureInteractable();

        // Subscribe inside OnStartEvent — SIK's Interactable finishes registering
        // with the InteractionManager during its own onAwake, so binding here in
        // onAwake can race that. OnStartEvent fires after every onAwake completes.
        this.createEvent("OnStartEvent").bind(() => {
            this.interactable.onTriggerStart.add((e: InteractorEvent) => this.onTap.invoke(e));
            this.interactable.onHoverEnter.add((e: InteractorEvent) => this.onHoverStart.invoke(e));
            this.interactable.onHoverExit.add((e: InteractorEvent) => this.onHoverEnd.invoke(e));
        });
    }

    private ensureCollider() {
        let collider = this.getSceneObject().getComponent("Physics.ColliderComponent");
        if (!collider && this.CONFIG.autoCreateCollider) {
            collider = this.getSceneObject().createComponent("Physics.ColliderComponent");
            const shape = Shape.createBoxShape();
            shape.size = this.CONFIG.colliderSize;
            collider.shape = shape;
        }
        if (collider) {
            collider.debugDrawEnabled = this.CONFIG.debugCollider;
        }
    }

    private ensureInteractable() {
        this.interactable = this.getSceneObject().getComponent(Interactable.getTypeName());
        if (!this.interactable) {
            this.interactable = this.getSceneObject().createComponent(Interactable.getTypeName());
        }
        this.interactable.targetingMode = this.CONFIG.targetingMode;
    }
}
