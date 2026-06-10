// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import { InteractorEvent } from "SpectaclesInteractionKit.lspkg/Core/Interactor/InteractorEvent";
import { SpringAnimate } from "SpectaclesInteractionKit.lspkg/Utils/springAnimate";
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider";

/**
 * PinchPullReleaseInteraction
 *
 * Agent Reference Template:
 * This script uses SpectaclesInteractionKit (SIK) `Interactable` for pinch-and-pull interactions.
 * It restricts interactions to Direct mode (touching the object) and uses spring physics for release.
 *
 * Usage for Agents:
 * - Modify the `CONFIG` object below to customize the interaction (axes, distance, spring physics).
 * - Direct vs Indirect: This script sets `targetingMode = 1` (Direct). To allow raycast (Indirect) pinching, change it to `2` or `3` (Both).
 * - Editor mocking is supported via 2D screen drags mapped to the 3D XZ plane.
 *
 * Pattern: §2 "Mixed" row of SKILL.md.
 *  - The pinch boundary IS unified via Interactable.onTriggerStart — MouseInteractor
 *    fires it on click in Editor, HandInteractor fires it on Spectacles pinch.
 *  - During the pinch we ALSO need a continuous position to drive the pull.
 *    MouseInteractor.startPoint sits at the camera-relative depth of the cursor —
 *    vertical mouse drag would only give Y motion, never Z (depth), unless
 *    `moveInDepth` is toggled on the MouseInteractor Inspector. To let a developer
 *    exercise Z-axis pull (slingshot, mini-golf launcher) from the preview without
 *    enabling moveInDepth, we layer a TouchMoveEvent mock on top: 2D screen drag
 *    → XZ plane, Shift+vertical → Y axis. Editor-only, gated by
 *    `global.deviceInfoSystem.isEditor()` in onUpdate.
 *
 * For free-space pinch-to-draw with no Interactable target, see SKILL.md §2
 * "Free-space gesture" subsection.
 */

const EDITOR_DRAG_SENSITIVITY = 100.0;

@component
export class PinchPullReleaseInteraction extends BaseScriptComponent {

    // Configuration for the interaction. Agents can modify these values directly.
    private CONFIG = {
        allowX: true,               // Allow pulling along the X axis
        allowY: false,              // Allow pulling along the Y axis
        allowZ: true,               // Allow pulling along the Z axis
        maxDistance: 30.0,          // Maximum distance the object can be pulled in cm
        springDuration: 0.5,        // Duration of the spring animation in seconds
        springBounce: 0.3,          // Bounce factor [0-1] (0 is smooth, 1 is bouncy)
        colliderSize: new vec3(10, 10, 10), // Size of the auto-generated collider in cm
        debugCollider: true         // Show the collider debug wireframe
    };

    private interactable: Interactable;
    private originalPosition: vec3;
    private isDragging: boolean = false;

    private startHandPosition: vec3;
    private startObjectPosition: vec3;

    // We store the active interactor to track its position during the drag
    private activeInteractor: any = null;
    private updateEvent: SceneEvent;

    // Physics state
    private spring: SpringAnimate;

    // Editor Mocking State
    private cameraProvider = WorldCameraFinderProvider.getInstance();
    private touchStartPosition: vec2 = vec2.zero();
    private currentTouchPosition: vec2 = vec2.zero();
    private isShiftDown: boolean = false;

    onAwake() {
        // Ensure the object has a ColliderComponent
        let collider = this.getSceneObject().getComponent("Physics.ColliderComponent");
        if (!collider) {
            collider = this.getSceneObject().createComponent("Physics.ColliderComponent");
            const shape = Shape.createBoxShape();
            shape.size = this.CONFIG.colliderSize;
            collider.shape = shape;
        }

        // Turn on debug draw for the collider
        collider.debugDrawEnabled = this.CONFIG.debugCollider;

        // Ensure the object has an Interactable component
        this.interactable = this.getSceneObject().getComponent(Interactable.getTypeName());
        if (!this.interactable) {
            this.interactable = this.getSceneObject().createComponent(Interactable.getTypeName());
        }

        // Restrict interactions to Direct mode only (1 = Direct)
        this.interactable.targetingMode = 1;

        // Track touch position for 2D screen mocking in the Editor
        this.createEvent("TouchStartEvent").bind((e: TouchStartEvent) => {
            this.currentTouchPosition = e.getTouchPosition();
        });
        this.createEvent("TouchMoveEvent").bind((e: TouchMoveEvent) => {
            this.currentTouchPosition = e.getTouchPosition();
        });

        // Track Shift key to distinguish between Up/Down and Forward/Back drags
        this.createEvent("KeyPressEvent").bind((event: KeyPressEvent) => {
            if (event.key === Keys.Shift) {
                this.isShiftDown = true;
            }
        });

        this.createEvent("KeyReleaseEvent").bind((event: KeyReleaseEvent) => {
            if (event.key === Keys.Shift) {
                this.isShiftDown = false;
            }
        });

        this.originalPosition = this.getTransform().getWorldPosition();

        // Subscribe to Interactable events inside OnStartEvent — SIK's
        // Interactable finishes registering its trigger events during its own
        // onAwake; binding here in onAwake can race that. OnStartEvent fires
        // after every onAwake completes.
        this.createEvent("OnStartEvent").bind(() => {
            this.interactable.onTriggerStart.add(this.onDragStart.bind(this));
            this.interactable.onTriggerEnd.add(this.onDragEnd.bind(this));
            this.interactable.onTriggerEndOutside.add(this.onDragEnd.bind(this));
            this.interactable.onTriggerCanceled.add(this.onDragEnd.bind(this));
        });

        this.spring = SpringAnimate.spring(this.CONFIG.springDuration, this.CONFIG.springBounce);

        this.updateEvent = this.createEvent("UpdateEvent");
        this.updateEvent.bind(this.onUpdate.bind(this));
    }

    private onDragStart(event: InteractorEvent) {
        if (this.isDragging) return;

        this.isDragging = true;
        this.activeInteractor = event.interactor;

        // Record starting positions
        this.startObjectPosition = this.getTransform().getWorldPosition();

        // Get the interactor's current drag point/interaction point
        // In the Editor (Indirect mode), we use planecastPoint. On Spectacles (Direct mode), we use startPoint.
        this.startHandPosition = global.deviceInfoSystem.isEditor() ? this.activeInteractor.planecastPoint : this.activeInteractor.startPoint;

        // Record the 2D touch position for Editor mocking
        this.touchStartPosition = this.currentTouchPosition;

        // Reset spring when grabbed
        this.spring.reset();
    }

    private onDragEnd(event: InteractorEvent) {
        if (!this.isDragging || event.interactor !== this.activeInteractor) return;

        this.isDragging = false;
        this.activeInteractor = null;

        // The spring physics in onUpdate will take over now
    }

    private onUpdate() {
        if (this.isDragging && this.activeInteractor) {
            let targetPosition: vec3;

            if (global.deviceInfoSystem.isEditor()) {
                // --- Editor Mocking: Map 2D screen drag to 3D XZ plane ---
                const screenDelta = this.currentTouchPosition.sub(this.touchStartPosition);

                // Get the camera's orientation to make the movement relative to our view
                const camTransform = this.cameraProvider.getComponent().getTransform();

                // Flatten the camera's right and forward vectors to the XZ plane
                const flatRight = new vec3(camTransform.right.x, 0, camTransform.right.z).normalize();
                const flatForward = new vec3(camTransform.forward.x, 0, camTransform.forward.z).normalize();
                const worldUp = new vec3(0, 1, 0);

                // Sensitivity multiplier (screen space is 0-1, we want cm)
                // Dragging across half the screen (0.5) = 50cm movement

                let xMovement = vec3.zero();
                let yMovement = vec3.zero();
                let zMovement = vec3.zero();

                if (this.CONFIG.allowX) {
                    // screenDelta.x is positive when dragging RIGHT.
                    // Dragging RIGHT should move the object RIGHT (+flatRight)
                    xMovement = flatRight.uniformScale(screenDelta.x * EDITOR_DRAG_SENSITIVITY);
                }

                // screenDelta.y is positive when dragging DOWN.
                if (this.isShiftDown) {
                    if (this.CONFIG.allowY) {
                        // Shift + Dragging DOWN should lower the object (-worldUp)
                        // Shift + Dragging UP should raise the object (+worldUp)
                        yMovement = worldUp.uniformScale(-screenDelta.y * EDITOR_DRAG_SENSITIVITY);
                    }
                } else {
                    if (this.CONFIG.allowZ) {
                        // Dragging DOWN should pull the object BACK (-flatForward)
                        // Dragging UP should push the object FORWARD (+flatForward)
                        zMovement = flatForward.uniformScale(-screenDelta.y * EDITOR_DRAG_SENSITIVITY);
                    } else if (this.CONFIG.allowY) {
                        // Fallback: If Z isn't allowed but Y is, map normal vertical drag to Y
                        yMovement = worldUp.uniformScale(-screenDelta.y * EDITOR_DRAG_SENSITIVITY);
                    }
                }

                const totalMovement = xMovement.add(yMovement).add(zMovement);
                targetPosition = this.startObjectPosition.add(totalMovement);

            } else {
                // --- Spectacles Direct Interaction ---
                // For Direct interaction (pinching the object directly), the hand's actual position is the startPoint
                // planecastPoint is projected onto the 2D interaction plane, which restricts movement to 2 axes.
                const currentHandPosition = this.activeInteractor.startPoint;
                if (!currentHandPosition || !this.startHandPosition) return;

                const handDelta = currentHandPosition.sub(this.startHandPosition);

                // Restrict movement to allowed axes
                const allowedDelta = new vec3(
                    this.CONFIG.allowX ? handDelta.x : 0,
                    this.CONFIG.allowY ? handDelta.y : 0,
                    this.CONFIG.allowZ ? handDelta.z : 0
                );

                // Calculate the new target position
                targetPosition = this.startObjectPosition.add(allowedDelta);
            }

            // Clamp the distance from the original position
            const offsetFromOriginal = targetPosition.sub(this.originalPosition);

            // We only care about allowed axes for clamping
            const allowedOffset = new vec3(
                this.CONFIG.allowX ? offsetFromOriginal.x : 0,
                this.CONFIG.allowY ? offsetFromOriginal.y : 0,
                this.CONFIG.allowZ ? offsetFromOriginal.z : 0
            );

            if (allowedOffset.length > this.CONFIG.maxDistance) {
                const clampedOffset = allowedOffset.normalize().uniformScale(this.CONFIG.maxDistance);
                targetPosition = new vec3(
                    this.CONFIG.allowX ? this.originalPosition.x + clampedOffset.x : this.startObjectPosition.x,
                    this.CONFIG.allowY ? this.originalPosition.y + clampedOffset.y : this.startObjectPosition.y,
                    this.CONFIG.allowZ ? this.originalPosition.z + clampedOffset.z : this.startObjectPosition.z
                );
            } else {
                targetPosition = new vec3(
                    this.CONFIG.allowX ? targetPosition.x : this.startObjectPosition.x,
                    this.CONFIG.allowY ? targetPosition.y : this.startObjectPosition.y,
                    this.CONFIG.allowZ ? targetPosition.z : this.startObjectPosition.z
                );
            }

            // Optional: calculate velocity for throwing momentum
            const dt = getDeltaTime();
            if (dt > 0) {
                const currentPos = this.getTransform().getWorldPosition();
                this.spring.velocity = targetPosition.sub(currentPos).uniformScale(1.0 / dt);
            }

            this.getTransform().setWorldPosition(targetPosition);
        } else {
            // Apply spring physics to return to original position
            const currentPos = this.getTransform().getWorldPosition();

            // If we are very close to the original position and moving very slowly, snap and sleep
            if (this.spring.isSettled(currentPos, this.originalPosition, 0.1, 0.1)) {
                this.getTransform().setWorldPosition(this.originalPosition);
                this.spring.reset();
                return;
            }

            const newPos = this.spring.evaluate(currentPos, this.originalPosition);
            this.getTransform().setWorldPosition(newPos);
        }
    }
}
