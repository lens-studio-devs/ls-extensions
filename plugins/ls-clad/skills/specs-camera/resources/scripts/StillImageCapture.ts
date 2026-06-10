// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * StillImageCapture
 *
 * High-resolution one-shot capture using CameraModule.requestImage().
 *
 * Programmatic-first: no @input fields. The component resolves the
 * CameraModule via `require`, builds its own display panel at runtime,
 * and calls captureStill() on OnStartEvent. Trigger a fresh capture later
 * by calling captureStill() from any other script.
 *
 * Still image requests are device-only — in the editor the call throws
 * "Image request not supported". Use Texture.copyFrame() on a live
 * camera/crop texture for editor-friendly freezing.
 */
@component
export class StillImageCapture extends BaseScriptComponent {
  /** Override before Start if you want to bind to an authored Image. */
  public displayImage: Image | null = null;
  /** Smaller-axis pixels of the returned still. Larger = slower. */
  public imageSmallerDimension: number = 512;

  private cameraModule: CameraModule = require("LensStudio:CameraModule");

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.captureStill());
  }

  public async captureStill(): Promise<Texture | null> {
    try {
      if (!this.displayImage) this.displayImage = this.buildDisplay();

      const req = CameraModule.createImageRequest();
      req.imageSmallerDimension = this.imageSmallerDimension;

      const frame: ImageFrame = await this.cameraModule.requestImage(req);
      this.displayImage.mainPass.baseTex = frame.texture;
      print(`[StillImageCapture] captured t=${frame.timestampMillis}ms`);
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
