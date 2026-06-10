---
name: specs-internet
description: Make HTTP/HTTPS requests, download remote media (images, video, audio, glTF), and check internet availability in Specs using the InternetModule and Fetch API. Load when implementing network requests, REST API calls, or remote asset loading.
user-invocable: false
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Internet Access — Fetch, HTTP, Remote Media

**Requirements:** Lens Studio v5.3+. Add `InternetModule` to project assets.

> **Privacy:** Internet access disables camera frame / location / audio. Use Extended Permissions for combined access.
> Preview only works with **Device Type Override = Specs**.

> **Keep everything programmatic. Do not rely on the Inspector.** AI-driven workflows must produce scripts that run end-to-end without a human dragging assets, wiring references, or tweaking UI fields in the editor. That means:
> - **Modules:** acquire singletons with `require('LensStudio:InternetModule')` / `require('LensStudio:RemoteMediaModule')` instead of `@input` fields. The script stays self-contained and reproducible.
> - **Only exception:** expose `@input` when the value genuinely *must* be swapped per-instance from the Inspector by a human designer (e.g. an artist-tuned color or a per-prefab asset reference). If a script could plausibly run unattended, it should.

Reference: `Fetch/`, `Snap Cloud World Kindness Day/`

**Full TypeScript examples** (copied verbatim from Specs samples) live in [`resources/examples/`](resources/examples/README.md):
- `examples/Fetch/` — `FetchCatFacts.ts`, `CatFactAnimator.ts`, `Events.ts` (HTTP GET + JSON + typed event bus)
- `examples/InternetAvailability/` — `InternetAvailabilityPopUp.ts`, `NoInternetDisplay.ts` (offline UX patterns)
- `examples/DirectAI/` — call OpenAI / Gemini / Anthropic / DeepSeek **directly** via `InternetModule.fetch`, bypassing the Remote Service Gateway. BYO API key, prototype-only — see folder README. For published Lenses, use the `specs-ai-remote-service` skill (RSG). Snap3D and Lyria are RSG-only (no public direct endpoint).

---

## Fetch API (recommended)

> **⚠️ `new Request(...)` may fail with `TS2674: Constructor of class 'Request' is protected`** in some Lens Studio TypeScript configurations. If you hit this, pass the URL and init object directly to `fetch()` instead: `this.internetModule.fetch(url, {method: 'GET', headers: {...}})`. The `Request` constructor is not part of the public API surface.

### GET request

```typescript
@component
export class FetchExample extends BaseScriptComponent {
  private internetModule: InternetModule = require('LensStudio:InternetModule')

  onAwake(): void {
    this.fetchData() // keep onAwake sync; call async helper
  }

  private async fetchData(): Promise<void> {
    try {
      const response = await this.internetModule.fetch('https://api.example.com/data', {
        method: 'GET',
      })

      if (response.status !== 200) {
        print('[Fetch] Error: ' + response.status)
        return
      }
      const text = await response.text()
      print('[Fetch] Response: ' + text)
    } catch (err) {
      print('[Fetch] Failed: ' + err)
    }
  }
}
```

### POST with JSON

```typescript
private async postJson(url: string, body: object): Promise<any> {
  const response = await this.internetModule.fetch(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {'Content-Type': 'application/json'},
  })
  if (response.status !== 200) throw new Error('HTTP ' + response.status)

  const contentType = response.headers.get('Content-Type')
  if (!contentType?.includes('application/json')) throw new Error('Not JSON')

  const json = await response.json()
  return json
}
```

### Supported body readers

| Method | Returns |
|--------|---------|
| `response.text()` | string |
| `response.json()` | parsed object |
| `response.bytes()` | Uint8Array |

> `blob()`, `arrayBuffer()`, `body` are **not supported**.

---

## PerformHttpRequest (simpler, legacy)

```typescript
private performGet(url: string): void {
  const req = RemoteServiceHttpRequest.create()
  req.url = url
  req.method = RemoteServiceHttpRequest.HttpRequestMethod.Get

  this.internetModule.performHttpRequest(req, (response) => {
    if (response.statusCode === 200) {
      print('[HTTP] Body: ' + response.body)
    }
  })
}

private performPost(url: string, body: string, token: string): void {
  const req = RemoteServiceHttpRequest.create()
  req.url = url
  req.method = RemoteServiceHttpRequest.HttpRequestMethod.Post
  req.setHeader('Content-Type', 'application/json')
  req.setHeader('Authorization', 'Bearer ' + token)
  req.body = body

  this.internetModule.performHttpRequest(req, (response) => {
    print('[HTTP] Status: ' + response.statusCode)
    print('[HTTP] Content-Type: ' + response.contentType)
    print('[HTTP] Body: ' + response.body)
  })
}
```

---

## Download Remote Media

```typescript
private internetModule: InternetModule = require('LensStudio:InternetModule')
private remoteMediaModule: RemoteMediaModule = require('LensStudio:RemoteMediaModule')

// --- Image ---
private async loadRemoteImage(url: string): Promise<Texture> {
  const resource = this.internetModule.makeResourceFromUrl(url)
  return new Promise((resolve, reject) => {
    this.remoteMediaModule.loadResourceAsImageTexture(
      resource,
      (texture) => resolve(texture),
      (err) => reject(err)
    )
  })
}

// --- Audio ---
private loadRemoteAudio(url: string): void {
  const resource = this.internetModule.makeResourceFromUrl(url)
  this.remoteMediaModule.loadResourceAsAudioTrackAsset(
    resource,
    (audioTrack) => {
      // Use audioTrack with AudioComponent
    },
    (err) => print('[Media] Audio error: ' + err)
  )
}

// --- glTF model ---
private loadRemoteGltf(url: string): void {
  const resource = this.internetModule.makeResourceFromUrl(url)
  this.remoteMediaModule.loadResourceAsGltfAsset(
    resource,
    (gltfAsset) => {
      const settings = GltfSettings.create()
      settings.convertMetersToCentimeters = true
      gltfAsset.tryInstantiateAsync(
        this.sceneObject, this.material,
        (sceneObj) => print('[GLTF] Loaded: ' + sceneObj.name),
        (err) => print('[GLTF] Error: ' + err),
        (progress) => print('[GLTF] Progress: ' + progress),
        settings
      )
    },
    (err) => print('[GLTF] Load error: ' + err)
  )
}
```

| Media type | Method | Returns |
|------------|--------|---------|
| Image | `loadResourceAsImageTexture` | `Asset.Texture` |
| Video | `loadResourceAsVideoTexture` | `Asset.Texture` |
| glTF | `loadResourceAsGltfAsset` | `Asset.GltfAsset` |
| Audio | `loadResourceAsAudioTrackAsset` | `Asset.AudioTrackAsset` |

---

## Internet Availability Check

```typescript
onAwake(): void {
  // Check current status
  const isOnline = global.deviceInfoSystem.isInternetAvailable()
  print('[Net] Online: ' + isOnline)

  // React to changes
  global.deviceInfoSystem.onInternetStatusChanged.add((args) => {
    if (args.isInternetAvailable) {
      print('[Net] Internet restored')
    } else {
      print('[Net] Internet lost')
    }
  })
}
```

---

## InternetModule Setup

**Recommended — `require()` (no Inspector wiring):**

```typescript
private internetModule: InternetModule = require('LensStudio:InternetModule')
private remoteMediaModule: RemoteMediaModule = require('LensStudio:RemoteMediaModule')
```

This keeps the component self-contained — no manual drag-and-drop in the Inspector, so AI-driven scaffolding works end-to-end without a human step.

**Discouraged — `@input` Inspector field:**

```typescript
@input internetModule: InternetModule  // only when per-instance override is actually needed
```

Use `require()` (self-contained, no Inspector) over `@input` except when per-instance override is genuinely needed.
