// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

import {
  LEFT_HAND,
  RIGHT_HAND,
} from "SpectaclesInteractionKit.lspkg/Core/Interactor/raycastAlgorithms/RaycastBase";

import { CameraModel } from "./CameraModel";
import { SIK } from "SpectaclesInteractionKit.lspkg/SIK";

@component
export class DepthTextureHandler extends BaseScriptComponent {
  @input private readonly depthTextureMaterial!: Material;

  private depthModule: DepthModule = require("LensStudio:DepthModule");
  private session: DepthFrameSession;

  private depthTexture: Texture | undefined;

  private depthCameraModel: CameraModel;

  private isFrozen = false;

  // --- DEBUG: depth-frame delivery instrumentation (remove once verified) ---
  private depthFrameCount = 0;
  private lastFrameLogTimeSec = 0;

  private onAwake() {
    this.createEvent("OnStartEvent").bind(this.onStart);
  }

  private readonly onStart = () => {
    this.session = this.depthModule.createDepthFrameSession();
    this.session.onNewFrame.add(this.handleDepthFrameData);
    this.session.start();
    print("[DepthDebug] session.start() called — waiting for onNewFrame...");

    // If no depth frame has arrived a few seconds in, the platform is not
    // delivering depth (vs. a lens-side bug). Reports once at ~5s.
    const probe = this.createEvent("DelayedCallbackEvent");
    probe.bind(() => {
      if (this.depthFrameCount === 0) {
        print(
          "[DepthDebug] NO depth frames received 5s after start — platform is not delivering DepthFrameData."
        );
      } else {
        print(
          `[DepthDebug] ${this.depthFrameCount} depth frame(s) received in first 5s — pipeline OK.`
        );
      }
    });
    probe.reset(5.0);

    SIK.HandInputData.getHand(RIGHT_HAND).onPinchUp.add(this.toggleFreeze);
    SIK.HandInputData.getHand(LEFT_HAND).onPinchUp.add(this.toggleFreeze);
    this.createEvent("TouchEndEvent").bind(this.toggleFreeze);
  };

  private readonly toggleFreeze = () => {
    this.isFrozen = !this.isFrozen;

    if (this.isFrozen) {
      this.session.stop();
    } else {
      this.session.start();
    }
  };

  private readonly handleDepthFrameData = (depthFrameData: DepthFrameData) => {
    const depthDeviceCamera = depthFrameData.deviceCamera;

    // --- DEBUG: log first frame + ~1 Hz thereafter (remove once verified) ---
    this.depthFrameCount++;
    const nowSec = getTime();
    if (this.depthFrameCount === 1 || nowSec - this.lastFrameLogTimeSec >= 1.0) {
      this.lastFrameLogTimeSec = nowSec;
      const res = depthDeviceCamera.resolution;
      print(
        `[DepthDebug] frame #${this.depthFrameCount} res=${res.x}x${res.y}`
      );
    }

    if (
      this.depthCameraModel === undefined ||
      !this.depthCameraModel.size.equal(depthDeviceCamera.resolution) ||
      !this.depthCameraModel.focalLength.equal(depthDeviceCamera.focalLength) ||
      !this.depthCameraModel.principalPoint.equal(
        depthDeviceCamera.principalPoint
      )
    ) {
      this.depthCameraModel = new CameraModel(
        depthDeviceCamera.resolution,
        depthDeviceCamera.focalLength,
        depthDeviceCamera.principalPoint
      );

      const depthPixelFromCamera = this.depthCameraModel.getIntrinsicMatrix();
      const cameraFromDepthPixel = depthPixelFromCamera.inverse();

      const mainPass = this.depthTextureMaterial.mainPass;
      mainPass.instanceCount =
        this.depthCameraModel.size.x * this.depthCameraModel.size.y;
      mainPass.cameraFromDepthPixel = cameraFromDepthPixel;
      mainPass.deviceRefFromCamera = depthDeviceCamera.pose;

      this.depthTexture = ProceduralTextureProvider.createWithFormat(
        this.depthCameraModel.size.x,
        this.depthCameraModel.size.y,
        TextureFormat.R32Float
      );
      this.depthTextureMaterial.mainPass.baseTex = this.depthTexture;
    }

    const control = this.depthTexture.control as ProceduralTextureProvider;
    control.setPixelsFloat32(
      0,
      0,
      this.depthCameraModel.size.x,
      this.depthCameraModel.size.y,
      depthFrameData.depthFrame
    );

    this.getTransform().setWorldTransform(
      depthFrameData.toWorldTrackingOriginFromDeviceRef
    );
  };
}
