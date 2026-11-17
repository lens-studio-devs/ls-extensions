// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * StillImageCapture
 *
 * High-resolution one-shot capture using a CameraModule capture session.
 *
 * Programmatic-first: no @input fields. The component resolves the
 * CameraModule via `require`, builds its own display panel at runtime,
 * and calls captureStill() on OnStartEvent. Trigger a fresh capture later
 * by calling captureStill() from any other script.
 *
 * Still capture is device-only: in the editor no camera stream supports
 * Capture, so captureStill() reports it and returns null. Use
 * Texture.copyFrame() on a live camera/crop texture for editor-friendly freezing.
 */
@component
export class StillImageCapture extends BaseScriptComponent {
  /** Override before Start if you want to bind to an authored Image. */
  public displayImage: Image | null = null;

  private cameraModule: CameraModule = require("LensStudio:CameraModule");
  private session: CameraModule.CaptureSession | null = null;

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.captureStill());
    this.createEvent("OnDestroyEvent").bind(() => this.session?.stop());
  }

  /** Starts the capture pipeline on the first camera stream that supports stills. */
  private startSession(): boolean {
    const stream = this.cameraModule
      .getCameras()
      .map((camera) => camera.getStreams().find((s) => s.operation === CameraModule.Operation.Capture))
      .find((s) => s !== undefined);
    if (!stream) return false;
    const config = new CameraModule.StreamConfig();
    config.stream = stream;
    this.session = this.cameraModule.createCaptureSession();
    return this.session.start(config) === CameraModule.Result.Success;
  }

  /** Captures one still. Await it before calling again (one capture in flight per session). */
  public async captureStill(): Promise<Texture | null> {
    try {
      if (!this.displayImage) this.displayImage = this.buildDisplay();
      if (!this.session && !this.startSession()) {
        print("[StillImageCapture] no camera stream supports still capture (device only)");
        return null;
      }
      const frame = await this.session!.capture();
      if (!frame.texture) return null;
      this.displayImage.mainPass.baseTex = frame.texture;
      print(`[StillImageCapture] captured ${frame.width}x${frame.height}`);
      return frame.texture;
    } catch (error) {
      print("[StillImageCapture] failed: " + error);
      return null;
    }
  }

  private buildDisplay(): Image {
    const root = this.getSceneObject();
    const canvasObj = global.scene.createSceneObject("StillCaptureCanvas");
    canvasObj.setParent(root);
    const canvas = canvasObj.createComponent("Component.Canvas") as Canvas;
    canvas.unitType = Canvas.UnitType.World;
    canvas.offsetUnit = Canvas.OffsetUnit.World;
    canvas.setSize(new vec2(32, 24));

    const imgObj = global.scene.createSceneObject("StillCaptureImage");
    imgObj.setParent(canvasObj);
    const st = imgObj.createComponent("Component.ScreenTransform") as ScreenTransform;
    st.anchors.left = 0; st.anchors.right = 0;
    st.anchors.top = 0;  st.anchors.bottom = 0;
    const halfW = 16, halfH = 12;
    st.offsets.left = -halfW; st.offsets.right = halfW;
    st.offsets.bottom = -halfH; st.offsets.top = halfH;

    const img = imgObj.createComponent("Component.Image") as Image;
    img.setRenderOrder(10);
    imgObj.getTransform().setLocalPosition(new vec3(0, 0, 0.1));
    return img;
  }
}
