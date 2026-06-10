// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

import { HandInputData } from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandInputData";
import { SpringAnimate } from "SpectaclesInteractionKit.lspkg/Utils/springAnimate";
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider";

/**
 * GrabPullReleaseInteraction
 *
 * Agent Reference Template:
 * This script demonstrates direct hand manipulation using `GestureModule` and `HandInputData`.
 * It allows grabbing an object, pulling it along specific axes, and releasing it to spring back.
 *
 * Usage for Agents:
 * - Modify the `CONFIG` object below to customize the interaction (e.g., change allowed axes, spring physics, or grab area).
 * - This script automatically creates a `Physics.ColliderComponent` for the grab area if one doesn't exist.
 * - It includes Editor mocking support (click and drag) for testing without Spectacles.
 *
 * Why TouchStartEvent mock is MANDATORY here (cannot use Interactor.onTriggerStart):
 *  - This recipe is fist-grab, not pinch. The trigger is GestureModule.getGrabBeginEvent
 *    (Lens Studio's raw gesture API), NOT Interactable / pinch. No Interactor
 *    (MouseInteractor / HandInteractor / MobileInteractor) surfaces fist-grab —
 *    they all only fire onTriggerStart for pinch/click/poke, never for a closed fist.
 *  - GestureModule events don't fire in Lens Studio Editor at all (no hand tracking),
 *    so the touch mock is the only way to exercise this recipe from the preview.
 *
 * For pinch-based recipes (free-space pinch-to-draw, object pinch-and-pull),
 * see SKILL.md §2 — those have lighter-weight alternatives.
 */

const EDITOR_DRAG_SENSITIVITY = 100.0;

@component
export class GrabPullReleaseInteraction extends BaseScriptComponent {

    // Configuration for the interaction. Agents can modify these values directly.
    private CONFIG = {
        allowX: true,               // Allow pulling along the X axis
        allowY: false,              // Allow pulling along the Y axis
        allowZ: true,               // Allow pulling along the Z axis
        maxDistance: 30.0,          // Maximum distance the object can be pulled in cm
        springDuration: 0.5,        // Duration of the spring animation in seconds
        springBounce: 0.3,          // Bounce factor [0-1] (0 is smooth, 1 is bouncy)
        grabSize: new vec3(10, 10, 10), // Size of the grab area in cm
        grabPadding: 3.0,           // Extra padding around the grab area to make it easier to grab (buffer)
        debugGrabArea: true         // Show the grab area debug wireframe
    };

    private originalPosition: vec3;
    private isDragging: boolean = false;

    private startHandPosition: vec3;
    private startObjectPosition: vec3;

    // We store the active hand type to track its position during the drag
    private activeHandType: "left" | "right" | "editor" | null = null;
    private updateEvent: SceneEvent;

    // Physics state
    private spring: SpringAnimate;

    // Editor Mocking State
    private cameraProvider = WorldCameraFinderProvider.getInstance();
    private touchStartPosition: vec2 = vec2.zero();
    private currentTouchPosition: vec2 = vec2.zero();
    private isShiftDown: boolean = false;

    private gestureModule: GestureModule = require("LensStudio:GestureModule");
    private handProvider = HandInputData.getInstance();

    onAwake() {
        this.originalPosition = this.getTransform().getWorldPosition();
        this.spring = SpringAnimate.spring(this.CONFIG.springDuration, this.CONFIG.springBounce);

        this.setupCollider();
        this.setupGestureModule();
        this.setupEditorInteraction();

        this.updateEvent = this.createEvent("UpdateEvent");
        this.updateEvent.bind(this.onUpdate.bind(this));
    }

    private setupCollider() {
        let collider = this.getSceneObject().getComponent("Physics.ColliderComponent");
        if (!collider) {
            collider = this.getSceneObject().createComponent("Physics.ColliderComponent");
            const shape = Shape.createBoxShape();
            shape.size = this.CONFIG.grabSize;
            collider.shape = shape;
        }

        collider.debugDrawEnabled = this.CONFIG.debugGrabArea;
    }

    private setupGestureModule() {
        // Subscribe to GestureModule grab events inside OnStartEvent — the
        // GestureModule wires its grab/palm-tap/pinch-strength events during
        // module init that runs alongside component onAwakes; binding here in
        // onAwake can race that. OnStartEvent fires after every onAwake completes.
        this.createEvent("OnStartEvent").bind(() => {
            // Right Hand
            this.gestureModule.getGrabBeginEvent(GestureModule.HandType.Right).add(() => {
                this.tryStartGrab("right");
            });
            this.gestureModule.getGrabEndEvent(GestureModule.HandType.Right).add(() => {
                this.tryEndGrab("right");
            });

            // Left Hand
            this.gestureModule.getGrabBeginEvent(GestureModule.HandType.Left).add(() => {
                this.tryStartGrab("left");
            });
            this.gestureModule.getGrabEndEvent(GestureModule.HandType.Left).add(() => {
                this.tryEndGrab("left");
            });
        });
    }

    private setupEditorInteraction() {
        // Track touch position for 2D screen mocking in the Editor
        this.createEvent("TouchStartEvent").bind((e: TouchStartEvent) => {
            this.currentTouchPosition = e.getTouchPosition();
            this.tryStartGrab("editor");
        });
        this.createEvent("TouchMoveEvent").bind((e: TouchMoveEvent) => {
            this.currentTouchPosition = e.getTouchPosition();
        });
        this.createEvent("TouchEndEvent").bind((e: TouchEndEvent) => {
            this.tryEndGrab("editor");
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
    }

    private tryStartGrab(handType: "left" | "right" | "editor") {
        if (this.isDragging) return; // Already grabbed by a hand

        if (handType === "editor") {
            // In editor, we just assume the click is valid for mocking
            this.isDragging = true;
            this.activeHandType = "editor";
            this.startObjectPosition = this.getTransform().getWorldPosition();
            this.touchStartPosition = this.currentTouchPosition;
            this.spring.reset();
            return;
        }

        // On Spectacles, check if the hand is close enough to the object
        const hand = this.handProvider.getHand(handType);
        if (!hand || !hand.isTracked()) return;

        // Use the midpoint between index tip and thumb tip for the grab center (more natural than wrist)
        const indexPos = hand.indexTip.position;
        const thumbPos = hand.thumbTip.position;
        const grabCenterPosition = indexPos.add(thumbPos).uniformScale(0.5);
        const objectPosition = this.getTransform().getWorldPosition();

        // Check if hand is within the box dimensions (ignoring object scale) + padding
        const invRot = this.getTransform().getWorldRotation().invert();
        const localOffset = invRot.multiplyVec3(grabCenterPosition.sub(objectPosition));
        const halfSize = this.CONFIG.grabSize.uniformScale(0.5);

        const isInsideBox =
            Math.abs(localOffset.x) <= halfSize.x + this.CONFIG.grabPadding &&
            Math.abs(localOffset.y) <= halfSize.y + this.CONFIG.grabPadding &&
            Math.abs(localOffset.z) <= halfSize.z + this.CONFIG.grabPadding;

        if (isInsideBox) {
            this.isDragging = true;
            this.activeHandType = handType;
            this.startObjectPosition = objectPosition;
            // Use the wrist position for movement tracking to avoid jumps when fingers open/close
            this.startHandPosition = hand.wrist.position;
            this.spring.reset();
        }
    }

    private tryEndGrab(handType: "left" | "right" | "editor") {
        if (!this.isDragging || this.activeHandType !== handType) return;

        this.isDragging = false;
        this.activeHandType = null;

        // The spring physics in onUpdate will take over now
    }

    private onUpdate() {
        if (this.isDragging && this.activeHandType) {
            let targetPosition: vec3;

            if (this.activeHandType === "editor") {
                // --- Editor Mocking: Map 2D screen drag to 3D XZ plane ---
                const screenDelta = this.currentTouchPosition.sub(this.touchStartPosition);

                // Get the camera's orientation to make the movement relative to our view
                const camTransform = this.cameraProvider.getComponent().getTransform();

                // Flatten the camera's right and forward vectors to the XZ plane
                const flatRight = new vec3(camTransform.right.x, 0, camTransform.right.z).normalize();
                const flatForward = new vec3(camTransform.forward.x, 0, camTransform.forward.z).normalize();
                const worldUp = new vec3(0, 1, 0);

                let xMovement = vec3.zero();
                let yMovement = vec3.zero();
                let zMovement = vec3.zero();

                if (this.CONFIG.allowX) {
                    xMovement = flatRight.uniformScale(screenDelta.x * EDITOR_DRAG_SENSITIVITY);
                }

                if (this.isShiftDown) {
                    if (this.CONFIG.allowY) {
                        yMovement = worldUp.uniformScale(-screenDelta.y * EDITOR_DRAG_SENSITIVITY);
                    }
                } else {
                    if (this.CONFIG.allowZ) {
                        zMovement = flatForward.uniformScale(-screenDelta.y * EDITOR_DRAG_SENSITIVITY);
                    } else if (this.CONFIG.allowY) {
                        yMovement = worldUp.uniformScale(-screenDelta.y * EDITOR_DRAG_SENSITIVITY);
                    }
                }

                const totalMovement = xMovement.add(yMovement).add(zMovement);
                targetPosition = this.startObjectPosition.add(totalMovement);

            } else {
                // --- Spectacles Direct Grab Interaction ---
                const hand = this.handProvider.getHand(this.activeHandType);
                if (!hand || !hand.isTracked()) {
                    // Hand lost tracking, cancel grab
                    this.tryEndGrab(this.activeHandType);
                    return;
                }

                // Use the wrist position for movement tracking to avoid jumps when fingers open/close
                const currentHandPosition = hand.wrist.position;
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

            // Calculate velocity for throwing momentum
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
