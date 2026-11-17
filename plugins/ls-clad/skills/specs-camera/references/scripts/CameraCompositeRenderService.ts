// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * CameraCompositeRenderService
 *
 * Composite-passthrough variant of the camera service.
 *
 * Instead of publishing the raw camera texture, this service routes the
 * **scene Render Target** (the texture the main Camera renders to — the
 * composite of the real-world camera feed plus everything the scene Camera
 * draws, including UI panels and virtual content) through the crop
 * provider.
 *
 * Effect: any consumer reading the crop texture sees the *composite*, so
 *   - Captures bake virtual overlays into the saved frame.
 *   - Re-displaying the composite on an Image in front of the camera
 *     produces an intentional infinite-mirror feedback loop, useful as a
 *     quick sanity check that the pipeline is wired correctly.
 *
 * Pair this script with a display script (e.g. CameraSetup.ts simplified
 * to no longer call requestCamera, just consume cropTexture) — only ONE
 * script in the scene may own the requestCamera() call.
 *
 * Required scene assets:
 *   - CameraModule asset
 *   - ScreenCropTexture (Texture with RectCropTextureProvider)
 *   - The scene Render Target the main Camera writes to
 *     (Project default; visible in Assets as a Render Target whose
 *     background is the Device Camera Texture).
 */
@component
export class CameraCompositeRenderService extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color:#60A5FA;">Composite Camera Service — publishes scene composite as a Texture</span>')

  @input
  @hint("CameraModule asset — keeps the live camera awake")
  camModule: CameraModule;

  @input
  @hint("ScreenCropTexture whose inputTexture will be wired to the scene Render Target (the composite)")
  screenCropTexture: Texture;

  @input
  @hint("Render Target the main Camera renders to (composite = real-world feed + virtual scene)")
  sceneRenderTarget: Texture;

  public cameraTexture: Texture | null = null;
  public cameraTextureProvider: CameraTextureProvider | null = null;

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.start());
  }

  private start(): void {
    const isEditor = global.deviceInfoSystem.isEditor();
    const req = CameraModule.createCameraRequest();
    req.cameraId = isEditor
      ? CameraModule.CameraId.Default_Color
      : CameraModule.CameraId.Right_Color;

    this.cameraTexture = this.camModule.requestCamera(req);
    this.cameraTextureProvider = this.cameraTexture.control as CameraTextureProvider;
    // Keep the camera pipeline ticking even if no other script listens.
    this.cameraTextureProvider.onNewFrame.add(() => {});

    // The composite texture we publish to consumers is the scene Render Target's
    // output (camera feed + everything the scene Camera drew, including UI),
    // routed through the crop provider so ratio cycling still works.
    const cp = this.screenCropTexture.control as RectCropTextureProvider;
    cp.inputTexture = this.sceneRenderTarget;
  }
}
