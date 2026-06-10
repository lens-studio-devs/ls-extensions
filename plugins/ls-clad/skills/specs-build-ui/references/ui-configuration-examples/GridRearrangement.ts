// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * Grid rearrangement utility class that adds drag-and-rearrange functionality to grid layouts.
 * Helper class for enabling interactive grid item reordering with smooth animations.
 */
import { InteractableManipulation } from "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation";
import { GridLayout } from "SpectaclesUIKit.lspkg/Scripts/Components/Layout/GridLayout";

/** How many cm to push the dragged item toward the camera so it passes depth test over siblings. */
const DRAG_Z_BOOST = 2.0;

// Paint order on the dragged button is owned by Canvas Hierarchy DFS, not by a
// manual `renderOrder`: we re-parent the dragged child as the LAST sibling in
// `startDrag` so it paints on top of every other tile. Combined with the Z-boost
// above (depth-buffer occlusion), no sibling shines through the dragged tile.

/**
 * Represents the state of a dragged item
 */
class DragState {
    draggedObject: SceneObject | null = null;
    originalIndex: number = -1;
    originalPositions: vec3[] = [];
    isDragging: boolean = false;
}

/**
 * Helper class that manages drag-and-rearrange behavior for a GridLayout
 */
export class GridRearrangement {
    private gridLayout: GridLayout;
    private children: SceneObject[] = [];
    private dragState: DragState = new DragState();
    private lerpSpeed: number = 0.8;
    private zOffset: number = 0; // Z-offset to maintain during rearrangement
    /** Horizontal snap distance (cm); approx. old totalCellSize.x * 0.6 for drag targeting */
    private dragProximityThreshold: number = 3;
    private updateEvent: SceneEvent = null;
    private scriptComponent: BaseScriptComponent = null;
    private enableLogging: boolean = false;

    constructor(
        gridLayout: GridLayout,
        scriptComponent: BaseScriptComponent,
        lerpSpeed: number = 0.8,
        zOffset: number = 0,
        enableLogging: boolean = false,
        dragProximityThreshold: number = 3
    ) {
        this.gridLayout = gridLayout;
        this.scriptComponent = scriptComponent;
        this.lerpSpeed = lerpSpeed;
        this.zOffset = zOffset;
        this.enableLogging = enableLogging;
        this.dragProximityThreshold = dragProximityThreshold;

        // Create update event to check for rearrangement
        this.updateEvent = scriptComponent.createEvent("UpdateEvent");
        this.updateEvent.bind(this.update);
    }

    /**
     * Initialize drag interactions for all children
     */
    public setupDragInteractions(children: SceneObject[]): void {
        this.children = children;

        if (this.enableLogging) {
            print(`GridRearrangement: Setting up drag interactions for ${children.length} children`);
        }

        children.forEach((child, index) => {
            // Get InteractableManipulation component from child
            const manipComponent = child.getComponent(
                InteractableManipulation.getTypeName()
            ) as InteractableManipulation;

            if (manipComponent && manipComponent.onManipulationStart) {
                // Add manipulation event listeners
                manipComponent.onManipulationStart.add(() => {
                    this.startDrag(child, index);
                });

                manipComponent.onManipulationEnd.add(() => {
                    this.endDrag();
                });

                if (this.enableLogging) {
                    print(`  ✓ Connected drag events for child ${index}`);
                }
            } else if (this.enableLogging) {
                print(`  ⚠️  No InteractableManipulation component found on child ${index}`);
            }
        });
    }

    /**
     * Starts dragging the specified child object
     */
    private startDrag(child: SceneObject, originalIndex: number): void {
        if (this.enableLogging) {
            print(`GridRearrangement: Starting drag for child at index ${originalIndex}`);
        }

        // Store all current local positions
        this.dragState.originalPositions = [];
        for (let i = 0; i < this.children.length; i++) {
            this.dragState.originalPositions.push(
                this.children[i].getTransform().getLocalPosition()
            );
        }

        this.dragState.draggedObject = child;
        this.dragState.originalIndex = originalIndex;
        this.dragState.isDragging = true;

        // Re-insert as last child so DFS draws it on top of all sibling tiles.
        // No manual renderOrder — the hierarchy IS the render order.
        const parent = child.getParent();
        if (parent) {
            child.setParent(null);
            child.setParent(parent);
        }
    }

    /**
     * Ends the dragging operation
     */
    private endDrag(): void {
        if (!this.dragState.isDragging || !this.dragState.draggedObject) return;

        if (this.enableLogging) {
            print("GridRearrangement: Ending drag");
        }

        // Find closest grid position
        const draggedPos = this.dragState.draggedObject.getTransform().getLocalPosition();
        let closestIndex = 0;
        let closestDistance = Number.MAX_VALUE;

        for (let i = 0; i < this.children.length; i++) {
            if (this.children[i] === this.dragState.draggedObject) continue;
            const distance = draggedPos.distance(this.dragState.originalPositions[i]);
            if (distance < closestDistance) {
                closestDistance = distance;
                closestIndex = i;
            }
        }

        // Rearrange the children array
        const draggedChild = this.children.splice(this.dragState.originalIndex, 1)[0];
        this.children.splice(closestIndex, 0, draggedChild);

        // Update parent's children order by reparenting
        this.updateChildrenOrder();

        // Re-layout the grid with new order.
        // UIKit 0.1.7 forceReflow() only positions children with LayoutItem components,
        // so for programmatic button children we compute positions manually.
        this.relayoutManually();

        // Restore Z offset from original positions (GridLayout resets Z to 0)
        for (let i = 0; i < this.children.length; i++) {
            const currentPos = this.children[i].getTransform().getLocalPosition();
            const originalZ = this.dragState.originalPositions[i].z;
            this.children[i].getTransform().setLocalPosition(new vec3(
                currentPos.x,
                currentPos.y,
                originalZ
            ));
        }

        // Reset drag state
        this.dragState.isDragging = false;
        this.dragState.draggedObject = null;
        this.dragState.originalIndex = -1;
        this.dragState.originalPositions = [];

        if (this.enableLogging) {
            print("GridRearrangement: Drag ended successfully");
        }
    }

    /**
     * Row-major manual layout matching ExampleGrid.layoutButtonsManually() — needed
     * because UIKit 0.1.7 GridLayout no longer auto-positions bare SceneObjects.
     */
    private relayoutManually(): void {
        const cols = this.gridLayout.maxColumns;
        const rows = this.gridLayout.maxRows;
        const cellW = this.gridLayout.cellWidth + this.gridLayout.spacingX;
        const cellH = this.gridLayout.cellHeight + this.gridLayout.spacingY;
        const xOffset = -(cols - 1) * cellW * 0.5;
        const yOffset = (rows - 1) * cellH * 0.5;
        for (let i = 0; i < this.children.length; i++) {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const prev = this.children[i].getTransform().getLocalPosition();
            this.children[i].getTransform().setLocalPosition(
                new vec3(xOffset + col * cellW, yOffset - row * cellH, prev.z)
            );
        }
    }

    /**
     * Update the actual scene object children order to match internal array
     */
    private updateChildrenOrder(): void {
        const parent = this.gridLayout.sceneObject;

        // Detach all children
        const tempChildren = [...this.children];
        tempChildren.forEach(child => {
            child.setParent(null);
        });

        // Reattach in new order
        this.children.forEach(child => {
            child.setParent(parent);
        });
    }

    /**
     * Check if other elements should be rearranged based on dragged object position
     */
    private checkForRearrangement(): void {
        if (!this.dragState.draggedObject) return;

        const draggedPos = this.dragState.draggedObject.getTransform().getLocalPosition();

        // Find which original position this dragged object is closest to
        let closestIndex = 0;
        let closestDistance = Number.MAX_VALUE;

        for (let i = 0; i < this.dragState.originalPositions.length; i++) {
            if (i === this.dragState.originalIndex) continue;

            const distance = draggedPos.distance(this.dragState.originalPositions[i]);
            if (distance < closestDistance) {
                closestDistance = distance;
                closestIndex = i;
            }
        }

        // Use threshold based on cell size
        const threshold = this.dragProximityThreshold;
        if (closestDistance < threshold) {
            this.rearrangeOthersForDrag(closestIndex);
        }
    }

    /**
     * Rearrange other elements to make space for the dragged item.
     * Positions are set directly (no lerp) so tiles always reflect the correct
     * one-gap preview state. Lerp caused a two-gap artifact: when targetIndex
     * changed, two tiles would be mid-transit simultaneously, making both their
     * source and destination slots appear empty at the same time.
     */
    private rearrangeOthersForDrag(targetIndex: number): void {
        for (let i = 0; i < this.children.length; i++) {
            if (this.children[i] === this.dragState.draggedObject) continue;

            let newIndex = i;

            // Determine where this item should move
            if (this.dragState.originalIndex < targetIndex) {
                // Dragging forward - shift items back
                if (i > this.dragState.originalIndex && i <= targetIndex) {
                    newIndex = i - 1;
                }
            } else {
                // Dragging backward - shift items forward
                if (i >= targetIndex && i < this.dragState.originalIndex) {
                    newIndex = i + 1;
                }
            }

            // Clamp to valid range
            newIndex = Math.max(0, Math.min(this.dragState.originalPositions.length - 1, newIndex));

            const targetPos = this.dragState.originalPositions[newIndex];
            this.children[i].getTransform().setLocalPosition(new vec3(
                targetPos.x,
                targetPos.y,
                this.zOffset
            ));
        }
    }

    /**
     * Apply Z offset to all children to prevent clipping with frame
     */
    private applyZOffset(): void {
        for (let i = 0; i < this.children.length; i++) {
            const currentPos = this.children[i].getTransform().getLocalPosition();
            this.children[i].getTransform().setLocalPosition(new vec3(
                currentPos.x,
                currentPos.y,
                this.zOffset
            ));
        }
    }

    /**
     * Update loop - checks for rearrangement during drag
     */
    private update = (): void => {
        if (this.dragState.isDragging) {
            // Hold the dragged item 2 cm closer to the camera so it passes depth test
            // against all siblings (which stay at this.zOffset).
            if (this.dragState.draggedObject) {
                const draggedPos = this.dragState.draggedObject.getTransform().getLocalPosition();
                this.dragState.draggedObject.getTransform().setLocalPosition(
                    new vec3(draggedPos.x, draggedPos.y, this.zOffset + DRAG_Z_BOOST)
                );
            }

            this.checkForRearrangement();
        }
    };

    /**
     * Cleanup method to remove event listeners
     */
    public destroy(): void {
        if (this.updateEvent) {
            this.updateEvent.enabled = false;
        }
    }
}
