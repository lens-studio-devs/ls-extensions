// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * CameraIntrinsics
 *
 * Reads the per-camera intrinsics from DeviceInfoSystem and demonstrates
 * project() / unproject() — the canonical way to map between 3D world
 * points and 2D pixel coordinates on the chosen camera.
 *
 * Programmatic-first: no @input fields. Defaults to Left_Color (the
 * depth-aligned camera). Override `cameraId` from another script before
 * Start if you need a different camera.
 */
@component
export class CameraIntrinsics extends BaseScriptComponent {
  /** Override programmatically (e.g. from a controller) before OnStartEvent. */
  public cameraId: CameraModule.CameraId = CameraModule.CameraId.Left_Color;

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.dumpIntrinsics());
  }

  private dumpIntrinsics(): void {
    const camera = global.deviceInfoSystem.getTrackingCameraForId(this.cameraId);

    const focalLength = camera.focalLength;       // vec2 (fx, fy)
    const principalPoint = camera.principalPoint; // vec2 (cx, cy)
    const resolution = camera.resolution;         // vec2 (w, h)
    const pose = camera.pose;                     // mat4 — offset from device ref

    print(`[Intrinsics] focal=${focalLength}, principal=${principalPoint}, res=${resolution}`);
    print(`[Intrinsics] pose=${pose}`);

    const point3d = new vec3(0, 0, -100);
    const pixel2d = camera.project(point3d);
    print(`[Intrinsics] project(${point3d}) = ${pixel2d}`);

    const normalizedUV = new vec2(pixel2d.x / resolution.x, pixel2d.y / resolution.y);
    const depthMeters = 1.0;
    const point3dBack = camera.unproject(normalizedUV, depthMeters);
    print(`[Intrinsics] unproject(${normalizedUV}, ${depthMeters}) = ${point3dBack}`);
  }
}
