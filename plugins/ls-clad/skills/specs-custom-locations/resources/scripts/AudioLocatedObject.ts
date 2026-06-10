// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

import { LocatedObject } from "./LocatedObject"

/**
 * LocatedObject that plays an AudioComponent while the user is at the location and stops
 * it when they leave. Add to the "listeners" list of a LocationActivator.
 */
@component
export class AudioLocatedObject extends BaseScriptComponent implements LocatedObject {
  @input
  @hint("AudioComponent played on activate, stopped on deactivate")
  audio: AudioComponent

  localize(): void {}

  activate(): void {
    this.audio.play(1) // play once; pass -1 to loop
  }

  deactivate(): void {
    this.audio.stop(true) // true = fade out
  }
}
