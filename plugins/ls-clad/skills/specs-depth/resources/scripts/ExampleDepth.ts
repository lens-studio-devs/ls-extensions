// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

@component
export class DepthModuleExample extends BaseScriptComponent {
  private depthModule: DepthModule = require('LensStudio:DepthModule');
  private session: DepthFrameSession;
  private registration: EventRegistration;
  private frameCount = 0;

  onAwake() {
    print('[Depth] onAwake — component is alive');     // proves the component is enabled/attached
    this.createEvent('OnStartEvent').bind(() => {
      print('[Depth] OnStart — creating session...');
      this.session = this.depthModule.createDepthFrameSession();

      this.registration = this.session.onNewFrame.add(
        (depthFrameData: DepthFrameData) => {
          const cam = depthFrameData.deviceCamera;

          // Center pixel — always in range regardless of depth resolution
          const px = Math.floor(cam.resolution.x / 2);
          const py = Math.floor(cam.resolution.y / 2);
          const idx = Math.floor(px + py * cam.resolution.x);
          const depthValue = depthFrameData.depthFrame[idx];

          // Throttle: ~1 log/sec instead of ~5/sec
          if (this.frameCount++ % 5 === 0) {
            print(
              `[Depth] frame ${this.frameCount} | res ${cam.resolution.x}x${cam.resolution.y} | centerDepth(cm)=${depthValue}`
            );
          }
        }
      );

      this.session.start();
      print('[Depth] session.start() called — waiting for onNewFrame...');
    });

    this.createEvent('OnDestroyEvent').bind(() => {
      if (this.session && this.registration) {
        this.session.onNewFrame.remove(this.registration);
        this.session.stop();
      }
    });
  }
}
