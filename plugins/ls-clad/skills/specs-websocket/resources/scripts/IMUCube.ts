// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * 3D rotation handler for IMU sensor data visualization.
 * Applies rotation angles to a 3D object and optionally follows the camera.
 * Converts Euler angles (degrees) to quaternion rotation with error handling.
 */

import {bindStartEvent, bindUpdateEvent, bindDestroyEvent} from "SnapDecorators.lspkg/decorators"
import {assert} from "SnapDecorators.lspkg/assert"
import {Logger} from "Utilities.lspkg/Scripts/Utils/Logger"

const CAM_DISTANCE = 50;
const FOLLOW_SPEED = 6;

@component
export class IMUCube extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Target Configuration (Optional)</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Optionally enable smooth camera-following behavior</span>')

  @input
  @allowUndefined
  @hint("(Optional) Camera object for smooth following - leave empty to disable")
  camObj: SceneObject;

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Logging Configuration</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Control logging output for this script instance</span>')

  @input
  @hint("Enable general logging (rotation updates, position changes, etc.)")
  enableLogging: boolean = false;

  @input
  @hint("Enable lifecycle logging (onAwake, onStart, onUpdate, onDestroy, etc.)")
  enableLoggingLifecycle: boolean = false;

  private logger: Logger;
  private trans: Transform;
  private camTrans: Transform;
  private desiredRotation = quat.quatIdentity();

  /**
   * Called when component wakes up - initialize logger and validate inputs
   */
  onAwake(): void {
    const shouldLog = this.enableLogging || this.enableLoggingLifecycle;
    this.logger = new Logger("IMUCube", shouldLog, true);

    if (this.enableLoggingLifecycle) {
      this.logger.header("IMUCube Initialization");
      this.logger.debug("LIFECYCLE: onAwake() - Component waking up");
    }

    // Initialize transforms
    this.trans = this.getSceneObject().getTransform();

    // Camera following is optional
    if (this.camObj) {
      this.camTrans = this.camObj.getTransform();
      if (this.enableLogging) {
        this.logger.info("Camera following enabled");
      }
    } else {
      if (this.enableLogging) {
        this.logger.info("Camera following disabled (no camera assigned)");
      }
    }

    if (this.enableLoggingLifecycle) {
      this.logger.success("IMUCube initialized successfully");
    }
  }

  /**
   * Called every frame
   * Automatically bound to UpdateEvent via SnapDecorators
   */
  @bindUpdateEvent
  onUpdate(): void {
    if (this.enableLoggingLifecycle) {
      this.logger.debug("LIFECYCLE: onUpdate() - Update event");
    }

    this.softFollow();
  }

  /**
   * Called when the component is destroyed
   * Automatically bound to OnDestroyEvent via SnapDecorators
   */
  @bindDestroyEvent
  cleanup(): void {
    if (this.enableLoggingLifecycle) {
      this.logger.debug("LIFECYCLE: cleanup() - Component destroyed");
      this.logger.success("Cleanup complete");
    }
  }

  /**
   * Sets the rotation of the cube based on Euler angles
   * Converts degrees to radians and applies quaternion rotation
   * @param angle - Array of three angles [x, y, z] in degrees
   */
  setRotationAngle(angle: number[]): void {
    try {
      if (!angle || angle.length !== 3) {
        this.logger.error("Invalid angle array - must contain exactly 3 values");
        return;
      }

      const angleVec = new vec3(angle[0], angle[1], angle[2]);
      this.desiredRotation = quat.fromEulerVec(
        angleVec.uniformScale(MathUtils.DegToRad)
      );
      this.trans.setWorldRotation(this.desiredRotation);

      if (this.enableLogging) {
        this.logger.debug(`Rotation applied: [${angle[0].toFixed(2)}, ${angle[1].toFixed(2)}, ${angle[2].toFixed(2)}]`);
      }
    } catch (e) {
      this.logger.error("Error applying rotation: " + e);
    }
  }

  /**
   * Smoothly positions the cube in front of the camera
   * Uses linear interpolation for smooth movement
   * Only runs if camera is assigned
   */
  private softFollow(): void {
    if (!this.camTrans) {
      return; // Camera following disabled
    }

    try {
      const desiredPosition = this.camTrans
        .getWorldPosition()
        .add(this.camTrans.forward.uniformScale(-CAM_DISTANCE));

      this.trans.setWorldPosition(
        vec3.lerp(
          this.trans.getWorldPosition(),
          desiredPosition,
          getDeltaTime() * FOLLOW_SPEED
        )
      );
    } catch (e) {
      this.logger.error("Error in camera follow: " + e);
    }
  }

  /**
   * Public API: Get current rotation in Euler angles
   * @returns Current rotation as [x, y, z] in degrees
   */
  public getCurrentRotation(): number[] {
    const euler = this.desiredRotation.toEulerAngles();
    return [
      euler.x * MathUtils.RadToDeg,
      euler.y * MathUtils.RadToDeg,
      euler.z * MathUtils.RadToDeg
    ];
  }

  /**
   * Public API: Reset rotation to identity
   */
  public resetRotation(): void {
    this.desiredRotation = quat.quatIdentity();
    this.trans.setWorldRotation(this.desiredRotation);

    if (this.enableLogging) {
      this.logger.info("Rotation reset to identity");
    }
  }
}
