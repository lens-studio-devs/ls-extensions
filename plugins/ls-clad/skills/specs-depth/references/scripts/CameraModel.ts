// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * CameraModel — pinhole camera calibration helper for the Depth Module.
 *
 * Holds a depth camera's intrinsics (resolution, focal length, principal point)
 * and builds the 3x3 intrinsic matrix used to unproject depth pixels into camera
 * space. Pair with DepthTextureHandler.ts to render depth as a world-space cloud.
 */

const HALF_PIXEL_OFFSET = 0.5
const HALF_PIXEL_OFFSET_VEC = new vec2(HALF_PIXEL_OFFSET, HALF_PIXEL_OFFSET)

export class CameraModel {
  private _size: vec2
  private _focalLength: vec2
  private _principalPoint: vec2

  constructor(size: vec2, focalLength: vec2, principalPoint: vec2) {
    this._size = size
    this._focalLength = focalLength
    this._principalPoint = principalPoint
  }

  get size() {
    return this._size
  }

  get focalLength() {
    return this._focalLength
  }

  get principalPoint() {
    return this._principalPoint
  }

  /** Crop the resolution; intrinsics are adapted accordingly. */
  cropSize(offset: vec2, newSize: vec2) {
    this._size = newSize
    this._principalPoint = this.principalPoint.sub(offset)
  }

  /** Rescale the resolution; focal length + principal point are adapted. */
  changeSize(newSize: vec2) {
    const ratio = newSize.div(this.size)
    const newPrincipalPoint = this.principalPoint
      .add(HALF_PIXEL_OFFSET_VEC)
      .mult(ratio)
      .sub(HALF_PIXEL_OFFSET_VEC)

    this._size = newSize
    this._focalLength = this.focalLength.mult(ratio)
    this._principalPoint = newPrincipalPoint
  }

  /** 3x3 intrinsic matrix (depth-pixel ← camera). Invert it for camera ← depth-pixel. */
  getIntrinsicMatrix() {
    const principalPointOffset = this.principalPoint.add(HALF_PIXEL_OFFSET_VEC)

    const matrix = new mat3()
    matrix.column0 = new vec3(this.focalLength.x, 0, 0)
    matrix.column1 = new vec3(0, this.focalLength.y, 0)
    matrix.column2 = new vec3(principalPointOffset.x, principalPointOffset.y, 1)

    return matrix
  }
}
