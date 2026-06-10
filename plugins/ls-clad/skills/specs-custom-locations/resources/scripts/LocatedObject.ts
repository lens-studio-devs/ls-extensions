// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Contract for content that reacts to a Custom Location's lifecycle.
 *
 * Implement this on any ScriptComponent that should respond when the user arrives at
 * or leaves a scanned location. Listeners are driven by `LocationActivator`, which calls
 * these methods based on the user's proximity to the location.
 */
export interface LocatedObject {
  /** Called once, when the device first localizes to the location (LocatedAtComponent.onFound). */
  localize(): void

  /** Called when the user enters the presence of the location (in range AND looking at it). */
  activate(): void

  /** Called when the user leaves the presence of the location. */
  deactivate(): void
}
