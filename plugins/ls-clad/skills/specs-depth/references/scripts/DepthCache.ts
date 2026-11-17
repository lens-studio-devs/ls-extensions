// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * DepthCache — reusable depth + color frame snapshot helper for Spectacles.
 *
 * Pairs every depth frame (~5Hz) with the closest left-color camera frame (~30Hz),
 * then lets you "snapshot" the latest pair, query a world-space 3D point from a
 * color-frame pixel coordinate, and dispose when done.
 *
 * Typical use: send the cached color image to an AI vision model, get back 2D
 * pixel coordinates, then call getWorldPositionWithID() to place AR content in 3D.
 *
 * Adapted from specs-samples/Depth Cache/Assets/Scripts/DepthCache.ts.
 */

class ColorCameraFrame {
  public imageFrame: Texture
  public colorTimestampSeconds: number
  constructor(imageFrame: Texture, colorTimestamp: number) {
    this.imageFrame = imageFrame
    this.colorTimestampSeconds = colorTimestamp
  }
}

class DepthColorPair {
  public colorCameraFrame: ColorCameraFrame
  public depthFrameData: Float32Array
  public depthDeviceCamera: DeviceCamera
  public depthTimestampSeconds: number
  public depthCameraPose: mat4
  constructor(
    colorCameraFrame: ColorCameraFrame,
    depthFrameData: Float32Array,
    depthDeviceCamera: DeviceCamera,
    depthTimestampSeconds: number,
    depthCameraPose: mat4
  ) {
    this.colorCameraFrame = colorCameraFrame
    this.depthFrameData = depthFrameData
    this.depthDeviceCamera = depthDeviceCamera
    this.depthTimestampSeconds = depthTimestampSeconds
    this.depthCameraPose = depthCameraPose
  }
}

@component
export class DepthCache extends BaseScriptComponent {
  @input
  @hint("Camera module used to request the left color camera feed")
  camModule: CameraModule

  private colorDeviceCamera: DeviceCamera
  private depthModule = require("LensStudio:DepthModule") as DepthModule
  private depthFrameSession: DepthFrameSession = null
  private camTexture: Texture
  private camFrameHistory: ColorCameraFrame[] = []

  private latestCameraDepthPair: DepthColorPair = null
  private cachedDepthFrames: Map<number, DepthColorPair> = new Map()

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => {
      this.startCameraUpdates()
      this.startDepthUpdate()
    })
  }

  /** Snapshot the most recent depth+color pair. Returns an ID used to query / dispose. */
  saveDepthFrame(): number {
    const depthFrameID = Date.now()
    this.cachedDepthFrames.set(depthFrameID, this.latestCameraDepthPair)
    return depthFrameID
  }

  /** Get the cached color image for an ID — feed this to an AI vision model. */
  getCamImageWithID(depthFrameID: number): Texture {
    return this.cachedDepthFrames.get(depthFrameID).colorCameraFrame.imageFrame
  }

  /**
   * Convert a pixel coordinate on the cached color frame into a world-space vec3.
   * Remaps color→depth UV (depth frame is a cropped/downscaled view of left color),
   * samples a 3×3 median depth, then unprojects + transforms to world space.
   */
  getWorldPositionWithID(pixelPos: vec2, depthFrameID: number): vec3 | null {
    const pair = this.cachedDepthFrames.get(depthFrameID)
    if (pair == null) return null

    const normalizedColor = pixelPos.div(this.colorDeviceCamera.resolution)
    const pointInCamSpace = this.colorDeviceCamera.unproject(normalizedColor, 100.0)
    const normalizedDepth = pair.depthDeviceCamera.project(pointInCamSpace)
    if (!this.isNormalizedPointInImage(normalizedDepth)) return null

    const depthPixel = normalizedDepth.mult(pair.depthDeviceCamera.resolution)
    const depthVal = this.getMedianDepth(
      pair.depthFrameData,
      pair.depthDeviceCamera.resolution.x,
      pair.depthDeviceCamera.resolution.y,
      Math.floor(depthPixel.x),
      Math.floor(depthPixel.y),
      1
    )
    if (depthVal == null) return null

    const pointInDeviceRef = pair.depthDeviceCamera.unproject(normalizedDepth, depthVal)
    return pair.depthCameraPose.multiplyPoint(pointInDeviceRef)
  }

  disposeDepthFrame(depthFrameID: number) {
    this.cachedDepthFrames.delete(depthFrameID)
  }

  /** Median depth in a (2*radius+1)² window — robust to depth noise / holes. */
  private getMedianDepth(
    depthData: Float32Array,
    width: number,
    height: number,
    x: number,
    y: number,
    radius: number
  ): number | null {
    const samples: number[] = []
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
        const val = depthData[nx + ny * width]
        if (val > 0) samples.push(val)
      }
    }
    if (samples.length === 0) return null
    samples.sort((a, b) => a - b)
    const mid = Math.floor(samples.length / 2)
    return samples.length % 2 === 0 ? (samples[mid - 1] + samples[mid]) / 2 : samples[mid]
  }

  private startCameraUpdates() {
    const camRequest = CameraModule.createCameraRequest()
    camRequest.cameraId = CameraModule.CameraId.Left_Color
    this.camTexture = this.camModule.requestCamera(camRequest)
    const camTexControl = this.camTexture.control as CameraTextureProvider
    camTexControl.onNewFrame.add((frame: CameraFrame) => {
      this.camFrameHistory.push(new ColorCameraFrame(this.camTexture.copyFrame(), frame.timestampSeconds))
      // Color updates ~30Hz, depth ~5Hz — keep a short rolling window so we can
      // match the closest color frame to each incoming depth frame.
      if (this.camFrameHistory.length > 5) this.camFrameHistory.shift()
    })
    this.colorDeviceCamera = global.deviceInfoSystem.getTrackingCameraForId(CameraModule.CameraId.Left_Color)
  }

  private startDepthUpdate() {
    this.depthFrameSession = this.depthModule.createDepthFrameSession()
    this.depthFrameSession.onNewFrame.add((depthFrameData: DepthFrameData) => {
      const closestFrame = this.findClosestCameraFrame(depthFrameData)
      if (closestFrame == null) return
      // Deep-copy: depthFrame buffer and pose matrix get reused by the runtime.
      this.latestCameraDepthPair = new DepthColorPair(
        closestFrame,
        depthFrameData.depthFrame.slice(),
        depthFrameData.deviceCamera,
        depthFrameData.timestampSeconds,
        mat4.fromColumns(
          depthFrameData.toWorldTrackingOriginFromDeviceRef.column0,
          depthFrameData.toWorldTrackingOriginFromDeviceRef.column1,
          depthFrameData.toWorldTrackingOriginFromDeviceRef.column2,
          depthFrameData.toWorldTrackingOriginFromDeviceRef.column3
        )
      )
    })
    this.depthFrameSession.start()
  }

  private findClosestCameraFrame(depthFrame: DepthFrameData, maxOffset = 0.001): ColorCameraFrame | null {
    if (!this.camFrameHistory || this.camFrameHistory.length === 0) return null
    const closest = this.camFrameHistory.reduce((c, cur) =>
      Math.abs(cur.colorTimestampSeconds - depthFrame.timestampSeconds) <
      Math.abs(c.colorTimestampSeconds - depthFrame.timestampSeconds) ? cur : c
    )
    return Math.abs(closest.colorTimestampSeconds - depthFrame.timestampSeconds) <= maxOffset
      ? closest
      : this.camFrameHistory[this.camFrameHistory.length - 1]
  }

  private isNormalizedPointInImage(p: vec2): boolean {
    return p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1
  }
}
