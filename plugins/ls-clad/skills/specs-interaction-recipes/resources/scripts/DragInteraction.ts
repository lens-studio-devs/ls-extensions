// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import { InteractableManipulation } from "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation";
import Event from "SpectaclesInteractionKit.lspkg/Utils/Event";

/**
 * DragInteraction
 *
 * Drop-in @component for object grab-and-move. Wraps SIK's `Interactable` +
 * `InteractableManipulation` and exposes named hooks plus a per-frame position
 * update while dragging.
 *
 * Platforms (no manual editor mock needed):
 *  - Spectacles device          → HandInteractor drives InteractableManipulation
 *  - Lens Studio Editor Preview → MouseInteractor drives InteractableManipulation
 *    (click + drag on the preview area moves the object on the camera-facing plane;
 *    v0.12.0+ adds `moveInDepth` + `moveInDepthAmount` Inspector inputs on
 *    MouseInteractor for testing Z-axis interaction)
 *  - Spectacles + Snap mobile app (phone-as-controller) → MobileInteractor drives it
 *
 * DO NOT also bind TouchStartEvent / TouchMoveEvent / TouchEndEvent in this
 * script. SIK's Interactor system already routes all three platforms into
 * InteractableManipulation. Manually binding touch events on top would either
 * double-move the object in Editor or fight InteractableManipulation's own
 * position writes. See specs-interaction-recipes/SKILL.md §2 for the decision rule.
 *
 * For free-space sketching / pinch-to-draw with no object being grabbed, use
 * the Interactor-level pattern instead — see SKILL.md §2 "Free-space gesture"
 * subsection.
 *
 * Usage:
 *   // 1. Attach this script to the scene object you want to drag (a ColliderComponent
 *   //    will be auto-created if the object doesn't have one).
 *   // 2. Subscribe from your main script:
 *   //      const drag = sceneObj.getComponent("ScriptComponent") as DragInteraction;
 *   //      drag.onDragStart.add(() => print("grabbed"));
 *   //      drag.onDragUpdate.add((pos) => print("now at " + pos.toString()));
 *   //      drag.onDragEnd.add(() => print("released"));
 *
 * For spring-return / throw-momentum / axis-locked behavior, see §7
 * PinchPullReleaseInteraction.ts and §8 GrabPullReleaseInteraction.ts instead.
 */

@component
export class DragInteraction extends BaseScriptComponent {

    // Configuration — modify before onAwake or via inspector defaults
    private CONFIG = {
        autoCreateCollider: true,           // Create a box collider if the object doesn't have one
        colliderSize: new vec3(10, 10, 10), // cm — only used when autoCreateCollider
        debugCollider: false,               // Show wireframe while prototyping
        targetingMode: 3,                   // 1 = Direct, 2 = Indirect (raycast), 3 = Both
    };

    // Public signals — subscribe from any other component
    public onDragStart: Event<void> = new Event<void>();
    public onDragEnd: Event<void> = new Event<void>();
    public onDragUpdate: Event<vec3> = new Event<vec3>();

    private interactable: Interactable;
    private manipulation: InteractableManipulation;
    private isDragging: boolean = false;

    onAwake() {
        this.ensureCollider();
        this.ensureInteractable();
        this.ensureManipulation();

        // Subscribe inside OnStartEvent — SIK's InteractableManipulation wires
        // its own onManipulation* events during its onAwake; binding here in
        // onAwake can race that. OnStartEvent fires after every onAwake completes.
        this.createEvent("OnStartEvent").bind(() => {
            this.manipulation.onManipulationStart.add(() => {
                this.isDragging = true;
                this.onDragStart.invoke();
            });

            this.manipulation.onManipulationEnd.add(() => {
                this.isDragging = false;
                this.onDragEnd.invoke();
            });
        });

        // Per-frame world position while dragging. InteractableManipulation has
        // already written the new position by the time UpdateEvent fires, so we
        // can read it and surface it to subscribers. UpdateEvent is a
        // BaseScriptComponent lifecycle hook, not a SIK event — keep its
        // createEvent in onAwake.
        this.createEvent("UpdateEvent").bind(() => {
            if (this.isDragging) {
                this.onDragUpdate.invoke(this.getSceneObject().getTransform().getWorldPosition());
            }
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

    private ensureManipulation() {
        this.manipulation = this.getSceneObject().getComponent(InteractableManipulation.getTypeName());
        if (!this.manipulation) {
            this.manipulation = this.getSceneObject().createComponent(InteractableManipulation.getTypeName());
        }
        this.manipulation.enabled = true;
    }
}
