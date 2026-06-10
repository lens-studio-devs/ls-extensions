<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

> **Lens Runtime API** — All code here targets the Lens scripting runtime (StudioLib). Do not use these patterns in Editor API code.



# Lens Studio User Context — Reference Guide

This guide covers Snapchat social APIs available in Lens Studio: user identity, Bitmoji avatars, friends, social sharing (Dynamic Response), and leaderboards.


## UserContextSystem

`UserContextSystem` provides information about the current Snapchat user.

```typescript
const userContextSystem = global.userContextSystem

// Get the current user's SnapchatUser object
userContextSystem.getCurrentUser((currentUser: SnapchatUser) => {
  print('Display name: ' + currentUser.displayName)

  // Check if the user has a Bitmoji
  if (currentUser.hasBitmoji) {
    loadBitmoji2D(currentUser)
  }
})
```


## Bitmoji 2D (Sticker)

Load a user's Bitmoji as a flat 2D texture:

```typescript
const bitmojiModule = require('LensStudio:BitmojiModule')
const remoteMediaModule = require('LensStudio:RemoteMediaModule')

function loadBitmoji2D(user: SnapchatUser): void {
  // Step 1: Build options and request the Bitmoji 2D resource
  const options = Bitmoji2DOptions.create()
  options.user = user

  bitmojiModule.requestBitmoji2DResource(options, (resource: Bitmoji2DResource) => {
    // Step 2: Fetch the resource and apply it as a texture
    remoteMediaModule.loadResourceAsImageTexture(
      resource,
      (texture: Texture) => {
        // Apply the texture to a screen image or material
        screenImage.mainPass.baseTex = texture
        print('Bitmoji 2D loaded for: ' + user.displayName)
      },
      (error: string) => {
        print('Failed to load Bitmoji 2D: ' + error)
      }
    )
  })
}
```


## Bitmoji 3D

Load a user's full 3D Bitmoji avatar into the scene:

```typescript
function loadBitmoji3D(user: SnapchatUser, parent: SceneObject): void {
  // Step 1: Request the 3D resource for the current user
  bitmojiModule.requestBitmoji3DResource((resource: Bitmoji3DResource) => {
    // Step 2: Download and instantiate as a scene object
    remoteMediaModule.loadResourceAsGltfAsset(
      resource,
      (gltfAsset: GltfAsset) => {
        const bitmojiObject = gltfAsset.tryInstantiate(parent, null)
        bitmojiObject.getTransform().setLocalPosition(vec3.zero())
        print('Bitmoji 3D loaded for: ' + user.displayName)

        // Animate: find the AnimationPlayer on the loaded Bitmoji
        const animator = bitmojiObject.getComponent('Component.AnimationPlayer')
        if (animator) {
          animator.playAll()
        }
      },
      (error: string) => {
        print('Failed to load Bitmoji 3D: ' + error)
      }
    )
  })
}
```

### Playing a specific animation on a Bitmoji 3D
```typescript
const animator = bitmojiObject.getComponent('Component.AnimationPlayer')

// Play a named clip
animator.playClip('wave')

// Stop a named clip (resets to t = 0)
animator.stopClip('wave')

// Check if a clip is currently playing
const isPlaying: boolean = animator.getClipIsPlaying('wave')
```

> `AnimationMixer` is deprecated — use `AnimationPlayer` instead.


## Dynamic Response (Poster / Responder mechanic)

Dynamic Response lets a Lens share data and Snap media between a **Poster** (the person who sends a Snap) and **Responders** (friends who receive it and tap to open).

### Flow
1. Poster opens the Lens, customises it, and sends/posts a Snap.
2. Responder taps the Snap; the Lens opens in Responder mode with data from the Poster.

### Setup
1. Download the **Dynamic Response** component from the Asset Library.
2. Add the `DynamicResponseComponent` to a scene object.
3. Define **tappable areas** in the inspector (regions the Responder can tap on the received Snap).

### Reading Poster data in Responder mode
```typescript
const dynamicResponse = this.sceneObject.getComponent('Component.DynamicResponseComponent')

dynamicResponse.onResponderActivated.add(() => {
  // We are in Responder mode — read data the Poster embedded
  // Always sanitise: Poster data is a plain string with no schema enforcement
  const raw: string = dynamicResponse.getPosterData('myKey') ?? ''
  const posterData = raw.slice(0, 256)  // cap length; validate further if driving logic
  print('Poster sent: ' + posterData)

  // Show the Responder-specific UI
  responderUI.enabled = true
  posterUI.enabled    = false
})
```

### Writing data as the Poster
```typescript
// Called when the Poster is about to send the Snap
dynamicResponse.setPosterData('myKey', 'Hello Responder!')
dynamicResponse.setPosterData('score', '42')
```

### Checking which mode we're in
```typescript
if (dynamicResponse.isPoster()) {
  print('We are the Poster — show customisation UI')
} else if (dynamicResponse.isResponder()) {
  print('We are the Responder — read Poster data')
}
```


## Common Gotchas

- **`UserContextSystem` requires user consent** — if the user hasn't granted the Bitmoji permission, `hasBitmoji` is `false`. Always check before requesting.
- **Bitmoji loading is async** — always update the UI in the `remoteMediaModule` callback, not immediately after calling `requestBitmoji3DResource`.
- **`getAllFriends()` / `getBestFriends()` / `getPinnedBestFriends()` list size** is platform-limited — don't assume you can get all friends; design for partial lists.
- **Dynamic Response Poster data is an unvalidated string.** Always sanitise it (cap length, check format) before using it to drive UI or game logic — a crafted Snap could inject arbitrary content.
- **Dynamic Response tappable areas**: if you add tappable areas in the inspector, the platform's Call-to-Action (CTA) button is replaced by the tappable shimmer on the received Snap.
- **Dynamic Response is not available in the Lens Studio simulator** — test Poster/Responder flow via Snapchat on two devices.
- **Leaderboard scores are submitted from the client.** There is no server-side score validation — for competitive Lenses, use a Snap Cloud Edge Function to verify scores before writing to the leaderboard.
- **Leaderboard names are global** to the Lens — two Lenses with the same name string share the same leaderboard. Use unique names.
