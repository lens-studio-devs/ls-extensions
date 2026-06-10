// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Logs the full LocatedAtComponent lifecycle to the Logger panel — attach to the Custom
 * Location node to diagnose why a location won't localize on device.
 *
 * Healthy on-device sequence: onReady -> onCanTrack -> onFound.
 *   - onReady       location asset loaded and component initialized
 *   - onCanTrack    user is within range; tracking can begin
 *   - onFound       LOCALIZED — content is now anchored to the real world
 *   - onCannotTrack user moved out of range
 *   - onLost        tracking was lost after being found
 *   - onError       location asset failed to load or track (bad/expired ID, no internet)
 *
 * If you only ever see onReady (never onCanTrack/onFound), the user is not close enough to
 * the scanned space, or the scan lacks viewpoints from the current angle — add an
 * incremental scan. If you see onError, re-check the Location ID and internet connection.
 */
@component
export class LocationStatusLogger extends BaseScriptComponent {
  private locatedAt: LocatedAtComponent
  private lastStatus: number = -1

  onAwake(): void {
    this.locatedAt = this.getSceneObject().getComponent("LocatedAtComponent")
    if (!this.locatedAt) {
      print("[LocationStatus] No LocatedAtComponent on this SceneObject.")
      return
    }

    const c = this.locatedAt
    c.onReady.add(() => print("[LocationStatus] onReady — location asset loaded"))
    c.onCanTrack.add(() => print("[LocationStatus] onCanTrack — within range, tracking can begin"))
    c.onCannotTrack.add(() => print("[LocationStatus] onCannotTrack — out of range"))
    c.onFound.add(() => print("[LocationStatus] onFound — LOCALIZED"))
    c.onLost.add(() => print("[LocationStatus] onLost — tracking lost"))
    c.onError.add(() => print("[LocationStatus] onError — failed to load / track"))

    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  private onUpdate(): void {
    // proximityStatus is a LocationProximityStatus enum: 0=Unknown, 1=WithinRange, 2=OutOfRange
    const status = this.locatedAt.proximityStatus as number
    if (status !== this.lastStatus) {
      this.lastStatus = status
      print("[LocationStatus] proximityStatus -> " + status + "  distanceToLocation=" + this.locatedAt.distanceToLocation.toFixed(1))
    }
  }
}
