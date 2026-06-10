// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * CameraFrameStream
 *
 * Minimal continuous camera frame pipeline — built **programmatically**,
 * with no @input fields. Drop this component on a SceneObject and it
 * will:
 *
 *   1. resolve the CameraModule via `require('LensStudio:CameraModule')`,
 *   2. select the camera based on isEditor() (Default_Color / Right_Color),
 *   3. create a child world-space Canvas + Image at runtime,
 *   4. assign the live camera Texture to the Image's material.
 *
 * If you need an external display surface (e.g. an Image already authored
 * in the scene), set `attachToExisting` on the component before Start and
 * pass the target via the public `displayImage` property — but the
 * default path needs zero editor wiring.
 *
 * createCameraRequest() is bound to OnStartEvent (must not run in onAwake).
 */
@component
export class CameraFrameStream extends BaseScriptComponent {
  /** Optional: set programmatically if you want to bind to an existing Image. */
  public displayImage: Image | null = null;

  private cameraModule: CameraModule = require("LensStudio:CameraModule");
  private cameraTexture: Texture;
  private provider: CameraTextureProvider;
  private frameReg: EventRegistration | null = null;
  private ownedImage: Image | null = null;

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.start());
    this.createEvent("OnDestroyEvent").bind(() => this.cleanup());
  }

  private start(): void {
    if (!this.displayImage) {
      this.displayImage = this.buildDisplay();
      this.ownedImage = this.displayImage;
    }

    const request = CameraModule.createCameraRequest();
    request.cameraId = this.pickCameraId();
    this.cameraTexture = this.cameraModule.requestCamera(request);
    this.provider = this.cameraTexture.control as CameraTextureProvider;

    // Live handle — assign once, the texture updates in place.
    this.displayImage.mainPass.baseTex = this.cameraTexture;

    // Keep the pipeline warm and surface a hook for downstream consumers.
    this.frameReg = this.provider.onNewFrame.add(() => {});
  }

  /** Programmatic display surface: world-space Canvas → ScreenTransform → Image. */
  private buildDisplay(): Image {
    const root = this.getSceneObject();

    const canvasObj = global.scene.createSceneObject("CameraFrameStreamCanvas");
    canvasObj.setParent(root);
    const canvas = canvasObj.createComponent("Component.Canvas") as Canvas;
    canvas.unitType = Canvas.UnitType.World;
    canvas.offsetUnit = Canvas.OffsetUnit.World;
    canvas.setSize(new vec2(32, 18)); // cm

    const imgObj = global.scene.createSceneObject("CameraFrameStreamImage");
    imgObj.setParent(canvasObj);

    const st = imgObj.createComponent("Component.ScreenTransform") as ScreenTransform;
    st.anchors.left = 0; st.anchors.right = 0;
    st.anchors.top = 0;  st.anchors.bottom = 0;
    const halfW = 16, halfH = 9;
    st.offsets.left = -halfW; st.offsets.right = halfW;
    st.offsets.bottom = -halfH; st.offsets.top = halfH;

    const img = imgObj.createComponent("Component.Image") as Image;
    img.setRenderOrder(10);
    // Push forward in Z *after* components attach (ScreenTransform would clobber it).
    imgObj.getTransform().setLocalPosition(new vec3(0, 0, 0.1));

    return img;
  }

  private pickCameraId(): CameraModule.CameraId {
    return global.deviceInfoSystem.isEditor()
      ? CameraModule.CameraId.Default_Color
      : CameraModule.CameraId.Right_Color;
  }

  private cleanup(): void {
    if (this.provider && this.frameReg) {
      this.provider.onNewFrame.remove(this.frameReg);
    }
  }
}
