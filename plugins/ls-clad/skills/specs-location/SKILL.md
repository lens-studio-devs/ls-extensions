---
name: specs-location
description: Access GPS coordinates, heading/orientation, and Snap Places API for location-based AR experiences in Specs. Load when implementing outdoor navigation, location pins, GPS-based content placement, or map features.
user-invocable: false
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Location API — GPS, Heading, and Snap Places

**Requirements:** Lens Studio v5.7+, Spectacles OS v5.60+. Internet required.

> User must be logged in + paired to Snapchat, with location permission enabled.

Reference: `Navigation Kit/`

---

## GPS Coordinates + Heading

```typescript
require('LensStudio:RawLocationModule')  // permission declaration, top of script

@component
export class LocationTracker extends BaseScriptComponent {
  private locationService: LocationService
  private updateEvent: DelayedCallbackEvent

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.setupLocation())
  }

  private setupLocation(): void {
    this.locationService = GeoLocation.createLocationService()
    this.locationService.accuracy = GeoLocationAccuracy.Navigation

    // Heading (north-aligned orientation, updates continuously)
    this.locationService.onNorthAlignedOrientationUpdate.add((orientation) => {
      const headingDeg = GeoLocation.getNorthAlignedHeading(orientation)
      const radians = (headingDeg * Math.PI) / 180  // 2D rotation for map rendering
    })

    // Poll GPS
    this.updateEvent = this.createEvent('DelayedCallbackEvent')
    this.updateEvent.bind(() => this.pollLocation())
    this.updateEvent.reset(0)  // start immediately
  }

  private pollLocation(): void {
    this.locationService.getCurrentPosition(
      (pos) => {
        // pos.latitude / longitude / altitude / locationSource → position AR content
        this.updateEvent.reset(1.0)  // next update in 1s
      },
      (err) => this.updateEvent.reset(1.0)
    )
  }
}
```

Full logging example: `resources/docs/location.mdx`.

---

## GeoLocationAccuracy Modes

| Mode | Use case |
|------|----------|
| `GeoLocationAccuracy.Navigation` | AR alignment, highest precision, enables FUSED_LOCATION |
| `GeoLocationAccuracy.Best` | High accuracy, balanced battery |
| `GeoLocationAccuracy.Default` | Lower power, less precise |

> Use **Navigation** for AR content placement — activates 6DoF pose from GPS.

---

## 6DoF AR Placement from GPS

For a full 6DoF world pose from lat/lon/altitude + NorthAlignedOrientation, see `Navigation Kit/Assets/Scripts`. Use **Navigation** accuracy (above) so the GPS-driven 6DoF pose is available for outdoor AR content placement.

---

## Snap Places API (Points of Interest)

```typescript
// Show nearby places on a map component
// Requires Extended Permissions when combined with Location

this.mapComponent.showNearbyPlaces(null)                    // all categories
this.mapComponent.showNearbyPlaces(['Restaurant'])          // specific type
this.mapComponent.showNearbyPlaces(['Coffee Shop', 'Café']) // multiple types
this.mapComponent.showNearbyPlaces(['Bar', 'Pub', 'Restaurant', 'Fast Food Restaurant'])
```

Common categories: `Restaurant`, `Coffee Shop`, `Café`, `Bar`, `Pub`, `Hotel`, `Museum`, `Park`, `Gym`, `Pharmacy`, `Supermarket`, `Gas Station`

---

## GeoPosition Properties

```typescript
pos.latitude         // number — degrees
pos.longitude        // number — degrees
pos.altitude         // number — meters (0 if unavailable)
pos.horizontalAccuracy // number — meters
pos.verticalAccuracy   // number — meters
pos.timestamp        // Date
pos.locationSource   // string — "FUSED_LOCATION" at Navigation accuracy
```

---

## Known Limitations

- Navigation accuracy may degrade **at night**
- After SnapOS update: heading needs ~20s calibration (rotate head in all directions)
- First location fix may take a moment if no internet
- Snap Places API requires **Extended Permissions** when combined with LocationService
- Location disables camera frame access (use Extended Permissions for both)
