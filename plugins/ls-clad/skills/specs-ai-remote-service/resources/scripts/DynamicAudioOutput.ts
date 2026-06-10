// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

import { Logger } from "Utilities.lspkg/Scripts/Utils/Logger";
import { bindStartEvent, bindUpdateEvent, bindLateUpdateEvent, bindDestroyEvent } from "SnapDecorators.lspkg/decorators";

/**
 * Specs Inc. 2026
 * Dynamic audio output manager for AI-generated audio. Converts PCM16 audio data to
 * playable audio frames, manages audio track playback, and supports multi-channel audio
 * for real-time audio streaming from generative AI models.
 */
@component
export class DynamicAudioOutput extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Audio Output Configuration</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Audio track asset for dynamic PCM16 audio output from AI models</span>')

  @input
  private audioOutputTrack: AudioTrackAsset;

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Logging Configuration</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Control logging output for this script instance</span>')

  @input
  @hint("Enable general logging (animation cycles, events, etc.)")
  enableLogging: boolean = false;

  @input
  @hint("Enable lifecycle logging (onAwake, onStart, onUpdate, onDestroy, etc.)")
  enableLoggingLifecycle: boolean = false;

  // Logger instance
  private logger: Logger;  private audComponent: AudioComponent;
  private audioOutputProvider: AudioOutputProvider;  /**
   * Called when component is initialized
   */
  onAwake(): void {
    // Initialize logger
    this.logger = new Logger("DynamicAudioOutput", this.enableLogging || this.enableLoggingLifecycle, true);

    if (this.enableLoggingLifecycle) {
      this.logger.debug("LIFECYCLE: onAwake() - Component initializing");
    }


    this.audioOutputProvider = this.audioOutputTrack
      .control as AudioOutputProvider;
    this.audComponent = this.sceneObject.getComponent("AudioComponent");
  }
  /**
   * Initializes the audio output with the specified sample rate.
   * @param sampleRate - Sample rate for the audio output.
   */
  initialize(sampleRate: number) {
    this.audioOutputProvider.sampleRate = sampleRate;
    this.audComponent.audioTrack = this.audioOutputTrack;
    this.audComponent.play(-1);
  }

  /**
   * Adds an audio frame to the output.
   * @param uint8Array - Audio data in PCM 16-bit format as a Uint8Array.
   * @param channels - Optional channel count. Default is 1.
   *
   * Expects interleaved PCM16 for multi-channel input.
   */
  addAudioFrame(uint8Array: Uint8Array, channels: number = 1) {
    if (!this.audComponent.isPlaying()) {
      this.audComponent.play(-1);
    }
    const { data, shape } = this.convertPCM16ToAudFrameAndShape(
      uint8Array,
      channels
    );
    this.audioOutputProvider.enqueueAudioFrame(data, shape);
  }

  /**
   * Stops the audio output if it is currently playing.
   */
  interruptAudioOutput() {
    if (this.audComponent.isPlaying()) {
      this.audComponent.stop(false);
    }
  }

  private convertPCM16ToAudFrameAndShape(
    uint8Array: Uint8Array,
    channels: number = 1
  ): {
    data: Float32Array;
    shape: vec3;
  } {
    const clampedChannels = Math.max(1, channels | 0);
    const bytesPerFrame = 2 * clampedChannels;
    const safeLength = uint8Array.length - (uint8Array.length % bytesPerFrame);
    const totalSamples = safeLength / 2;
    const frames = totalSamples / clampedChannels;

    const monoData = new Float32Array(frames);
    if (clampedChannels === 1) {
      for (let i = 0, j = 0; i < safeLength; i += 2, j++) {
        const sample = ((uint8Array[i] | (uint8Array[i + 1] << 8)) << 16) >> 16;
        monoData[j] = sample / 32768.0;
      }
    } else {
      for (let f = 0; f < frames; f++) {
        const byteIndex = f * bytesPerFrame;
        const sample =
          ((uint8Array[byteIndex] | (uint8Array[byteIndex + 1] << 8)) << 16) >>
          16;
        monoData[f] = sample / 32768.0;
      }
    }

    const shape = new vec3(monoData.length, 1, 1);
    return { data: monoData, shape: shape };
  }
}
