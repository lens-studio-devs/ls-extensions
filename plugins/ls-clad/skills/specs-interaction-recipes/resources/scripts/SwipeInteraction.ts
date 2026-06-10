// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

import { HandInputData } from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandInputData";
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider";

/**
 * SwipeInteraction
 *
 * Agent Reference Template:
 * This script detects fast, directional hand swipes using pinch gestures.
 * It calculates 3D velocity and uses a "cone of acceptance" to determine swipe direction.
 *
 * Usage for Agents:
 * - Inject custom logic into the `onSwipeLeft`, `onSwipeRight`, etc. methods at the bottom of this script.
 * - The `SWIPE_THRESHOLD_3D` defines how far the hand must move (in cm) to register a swipe.
 * - The `duration` check ensures only fast movements (< 0.75s) are counted as swipes, not slow drags.
 * - Editor mocking maps 2D screen swipes to 3D directions (default Vertical = Forward/Back; Shift+Vertical = Up/Down).
 *
 * Why raw HandInputData + TouchStartEvent mock here (not Interactor.onTriggerStart):
 *  - Direction classification needs WRIST-stable position. Interactor.startPoint
 *    on a HandInteractor is the pinch point, which jitters as fingers close/open.
 *    Cone-of-acceptance classification (strictness 1.3) is brittle to that jitter
 *    at pinch-up — swipes get classified as the wrong axis or rejected as diagonal.
 *    hand.wrist.position is the canonical stable signal (see SKILL.md §9
 *    "Grab-center heuristic").
 *  - Editor needs Shift+Y axis switch to test all 6 directions. MouseInteractor's
 *    startPoint sits on a single camera-relative depth plane without `moveInDepth`
 *    enabled — vertical mouse drag would only give Up/Down, never Forward/Back.
 *    The 2D TouchStart/End mock with Shift toggles between Y and Z axes so a
 *    developer can exercise every onSwipe* hook from the preview window.
 *
 * For free-space gestures that don't need wrist stability or 6-direction editor
 * testing, see SKILL.md §2 "Free-space gesture" subsection.
 */

const SWIPE_THRESHOLD_3D = 5.0; // cm
const SWIPE_THRESHOLD_2D = 0.05; // 0-1 screen percentage

@component
export class SwipeInteraction extends BaseScriptComponent {

    // Optional: Agents can assign a Text component here programmatically to display feedback
    public feedbackText: Text | null = null;

    private handProvider = HandInputData.getInstance();
    private cameraProvider = WorldCameraFinderProvider.getInstance();

    // State for each hand to allow simultaneous swipes
    private handStates = {
        left: { isPinching: false, startPos: vec3.zero(), maxDelta: vec3.zero(), startTime: 0 },
        right: { isPinching: false, startPos: vec3.zero(), maxDelta: vec3.zero(), startTime: 0 }
    };

    private touchStartPosition: vec2 = vec2.zero();
    private isShiftDown: boolean = false;

    onAwake() {
        this.setupSpectaclesInteraction();
        this.setupEditorInteraction();
    }

    private setupSpectaclesInteraction() {
        const rightHand = this.handProvider.getHand("right");
        const leftHand = this.handProvider.getHand("left");

        // Helper to start pinch
        const onPinchDown = (handType: "left" | "right") => {
            const state = this.handStates[handType];
            if (state.isPinching) return;

            const hand = handType === "right" ? rightHand : leftHand;
            if (hand && hand.isTracked()) {
                state.isPinching = true;

                // Get hand position in camera's local space
                const camTransform = this.cameraProvider.getComponent().getTransform();
                const invCamMat = camTransform.getInvertedWorldTransform();
                state.startPos = invCamMat.multiplyPoint(hand.wrist.position);

                state.maxDelta = vec3.zero();
                state.startTime = getTime();
            }
        };

        // Helper to end pinch
        const onPinchUp = (handType: "left" | "right") => {
            const state = this.handStates[handType];
            if (!state.isPinching) return;

            state.isPinching = false;
            const duration = getTime() - state.startTime;
            this.detect3DSwipe(state.maxDelta, duration);
        };

        // Subscribe to raw hand pinch events inside OnStartEvent — SIK's
        // HandInputData providers wire their pinch Event<T>s during their own
        // onAwake; binding here in onAwake can race that. OnStartEvent fires
        // after every onAwake completes.
        this.createEvent("OnStartEvent").bind(() => {
            if (rightHand) {
                rightHand.onPinchDown.add(() => onPinchDown("right"));
                rightHand.onPinchUp.add(() => onPinchUp("right"));
                rightHand.onPinchCancel.add(() => onPinchUp("right"));
            }

            if (leftHand) {
                leftHand.onPinchDown.add(() => onPinchDown("left"));
                leftHand.onPinchUp.add(() => onPinchUp("left"));
                leftHand.onPinchCancel.add(() => onPinchUp("left"));
            }
        });

        // Track the maximum displacement during the pinch to avoid "hook" effects at the end of fast swipes.
        // UpdateEvent is a BaseScriptComponent lifecycle hook, not a SIK event — keep its createEvent in onAwake.
        this.createEvent("UpdateEvent").bind(() => {
            const camTransform = this.cameraProvider.getComponent().getTransform();
            const invCamMat = camTransform.getInvertedWorldTransform();

            const updateHand = (handType: "left" | "right", hand: any) => {
                const state = this.handStates[handType];
                if (!state.isPinching) return;

                if (hand && hand.isTracked()) {
                    const currentLocalPos = invCamMat.multiplyPoint(hand.wrist.position);
                    const currentDelta = currentLocalPos.sub(state.startPos);
                    if (currentDelta.lengthSquared > state.maxDelta.lengthSquared) {
                        state.maxDelta = currentDelta;
                    }
                }
            };

            updateHand("right", rightHand);
            updateHand("left", leftHand);
        });
    }

    private setupEditorInteraction() {
        // Touch events for 2D screen swipes
        this.createEvent("TouchStartEvent").bind((event: TouchStartEvent) => {
            this.touchStartPosition = event.getTouchPosition();
        });

        this.createEvent("TouchEndEvent").bind((event: TouchEndEvent) => {
            const touchEndPosition = event.getTouchPosition();
            this.detect2DSwipe(this.touchStartPosition, touchEndPosition);
        });

        // Track Shift key to distinguish between Up/Down and Forward/Back swipes
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

    private detect3DSwipe(localDelta: vec3, duration: number) {
        if (localDelta.length < SWIPE_THRESHOLD_3D) return;

        // 1. Time constraint: Swipes are fast. If they hold the pinch for > 0.75s, it's a drag, not a swipe.
        if (duration > 0.75) return;

        // localDelta is already in the camera's local space.
        // +X is Right, +Y is Up, -Z is Forward.
        const x = localDelta.x;
        const y = localDelta.y;
        const z = -localDelta.z; // Invert Z so +Z is Forward, matching our logic below

        const absX = Math.abs(x);
        const absY = Math.abs(y);
        const absZ = Math.abs(z);

        const max = Math.max(absX, absY, absZ);

        // 2. Cone of Acceptance (VisionOS / Android XR style)
        // We require the intended direction to be significantly larger than the cross-axes
        // to prevent false positives on diagonal or messy movements.
        const strictness = 1.3; // Must be 30% larger than other axes

        if (max === absX) {
            if (absX > absY * strictness && absX > absZ * strictness) {
                if (x > 0) this.onSwipeRight();
                else this.onSwipeLeft();
            }
        } else if (max === absY) {
            if (absY > absX * strictness && absY > absZ * strictness) {
                if (y > 0) this.onSwipeUp();
                else this.onSwipeDown();
            }
        } else {
            // Ergonomic exception for Z (Forward/Back):
            // Pushing/pulling naturally causes the arm to arc up/down (Y axis).
            // So we are strict about X (left/right drift) but lenient on Y.
            if (absZ > absX * strictness && absZ > absY * 0.8) {
                // z > 0 is moving Forward (since we inverted localDelta.z).
                if (z > 0) this.onSwipeForward();
                else this.onSwipeBack();
            }
        }
    }

    private detect2DSwipe(start: vec2, end: vec2) {
        const delta = end.sub(start);

        if (delta.length < SWIPE_THRESHOLD_2D) return;

        // Screen coordinates: (0,0) is top-left, (1,1) is bottom-right
        if (Math.abs(delta.x) > Math.abs(delta.y)) {
            if (delta.x > 0) this.onSwipeRight();
            else this.onSwipeLeft();
        } else {
            // No modifier + Vertical Swipe = Forward/Back
            // Shift + Vertical Swipe = Up/Down
            if (this.isShiftDown) {
                if (delta.y > 0) this.onSwipeDown(); // Y increases downwards
                else this.onSwipeUp();
            } else {
                if (delta.y > 0) this.onSwipeBack(); // Pulling down = moving back
                else this.onSwipeForward(); // Pushing up = moving forward
            }
        }
    }

    // --- Action Handlers ---
    // Agents should inject custom logic into these methods (e.g., scene transitions, UI updates)

    private updateFeedback(message: string) {
        print(message);
        if (this.feedbackText) {
            this.feedbackText.text = message;
        }
    }

    public onSwipeLeft() {
        this.updateFeedback("Swiped Left");
    }

    public onSwipeRight() {
        this.updateFeedback("Swiped Right");
    }

    public onSwipeUp() {
        this.updateFeedback("Swiped Up");
    }

    public onSwipeDown() {
        this.updateFeedback("Swiped Down");
    }

    public onSwipeForward() {
        this.updateFeedback("Swiped Forward");
    }

    public onSwipeBack() {
        this.updateFeedback("Swiped Back");
    }
}
