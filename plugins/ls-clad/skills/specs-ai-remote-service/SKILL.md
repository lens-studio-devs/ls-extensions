---
name: specs-ai-remote-service
description: Integrate AI APIs (Gemini Live, OpenAI Realtime, GPT Image / Gemini image generation, Snap3D) using the Remote Service Gateway (RSG) package in Specs. Load when implementing AI chat, voice, vision, image generation, or function calling features.
user-invocable: false
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# AI Integration via Remote Service Gateway (RSG)

Reference implementations: `AI Playground/`, `AI Music Gen/`, `Agentic Playground/`, `Crop/`, `Depth Cache/`

## Gemini Model IDs (via RSG)

Use these Gemini model IDs (the ones the RSG 4.0.0 examples use) — guessed `-exp` / `-preview` IDs return 404 through RSG's Vertex backend:
- Text/multimodal chat: `gemini-2.5-flash` (`ExampleGeminiCalls`)
- Image generation: `gemini-3.1-flash-image` or `gemini-3.1-flash-lite-image`, through `Imagen.generateContent({ model, type: "generateContent", body })` (the RSG "imagen" route) or `Gemini.models(...)` with `generationConfig.responseModalities: ["TEXT", "IMAGE"]`; the image comes back as an `inlineData` part in `candidates[0].content.parts`.
- Gemini Live: `models/gemini-live-2.5-flash` (`ExampleGeminiLive`).

Use only the model IDs listed in this skill. For any other model, grep the installed RemoteServiceGateway package's `HostedExternal/GoogleGenAITypes.ts` and `HostedExternal/Examples/` scripts for the exact string before using it.

Package path: `RemoteServiceGateway.lspkg/`

## Required RSG Version: 4.0.0 (Lens Studio 5.25+)

Use the RSG `4.0.0` package that matches Lens Studio 5.25. The agent must:

1. **Before installing**: when calling `SearchLensStudioAssetLibrary` / `InstallLensStudioPackage`, select the `RemoteServiceGateway` package for your Lens Studio version. Never accept the first hit blindly — verify the version field.
2. **If RSG is already installed**: read its version from `package.native` at the package root (the package has no `package.json`; `package.native` records the package version and the Lens Studio `StudioVersion`). If the installed package is older than 4.0.0, tell the user to upgrade via the Asset Library before proceeding — do NOT try to patch around an old version.
3. **Chat models**: use OpenAI or Gemini. The Snap token is for Snap3D. `RemoteServiceGatewayCredentials.setApiToken` stores the Snap, OpenAI and Google tokens.

### Recompile gotcha

`RecompileTypeScriptTool` sometimes returns `{"errors":["TypeScript compiler is not configured (no TypeScript files in project)"], "status":"failed"}` after writing or editing a `.ts` file in `Assets/`. This is a transient indexing race, not a real failure. **Recovery procedure (do all of these before reporting failure):** (1) call `ExecuteEditorCode` with `const model = pluginSystem.findInterface(Editor.Model.IModel); model.project.save();`, (2) wait ~1s, (3) retry `RecompileTypeScriptTool`. If it still fails, repeat once more. Do NOT tell the user to restart preview or save manually — the agent must drive the recovery. Only escalate after at least two save+retry cycles fail.

---

## Design Philosophy: No Inspector Inputs

**Avoid `@input` fields in AI assistant scripts wherever possible.** Inspector inputs create friction — they require manual wiring after every scene rebuild, break when objects are renamed, and make scripts harder to reuse. The preferred pattern is a **self-contained script** that builds its own UI and wires itself programmatically.

### Rules

| Rule | Rationale |
|------|-----------|
| AI assistant scripts should build their own UI via code (e.g., `buildUI()`) | No scene dependencies to wire manually |
| Do not expose `@input` fields for scene object references that can be created at runtime | Reduces inspector friction |
| `@input` fields are acceptable for **authoring-time configuration** only — system prompt, model name, feature flags | These are genuine per-instance settings |
| `RemoteServiceGatewayCredentials` is wired by the token action only after it returns `TOKENS_ASSIGNED` | Never claim credentials are wired after an unverified fallback |
| Token generation covers **all three providers** (SNAP, OPENAI, GOOGLE) in one `ExecuteEditorCode` call | Avoids partial setup that causes confusing silent failures |

### Canonical single-script pattern (`AIAssistant`)

The `AIAssistant` + `AIAssistantUI` pair in `references/scripts/scene-scripts/` is the canonical example. **When building a new AI assistant, copy these files into the user's project** (e.g. `Assets/Scripts/`) rather than writing them from scratch:

- **`AIAssistant.ts`** — self-contained: initializes ASR, handles hold-to-talk, calls `OpenAI.chatCompletions` via RSG, manages multi-turn history. Only `@input` fields are authoring settings (system prompt, model, feature flags).
- **`AIAssistantUI.ts`** — pure builder module, no `@component`, no `@input`. Exports `buildUI(script, parent) → UIElements`. Called from `AIAssistant.onStart()`. Creates transcript panel + button imperatively.

This approach produces **one script in the Inspector** with no wiring required. Prefer it for new AI assistant features.

### Image display pitfall

When a generated image renders black/washed-out/semi-transparent, see the **SUIK Image Display Gotchas** section below for the full fix (reset `baseColor` to opaque white, bump `renderOrder`, disable transparency).

**CRITICAL: Copying `.ts` files into Assets is NOT enough — the script will never run until a SceneObject exists with the ScriptComponent attached.** Immediately after writing the files, use `ExecuteEditorCode` to create the SceneObject hierarchy and call `sceneObject.createComponent('ScriptComponent')` with the asset reference. A scene with only the three default root objects (Camera, Lighting, InteractionKit) and script files in Assets is broken — no AI functionality will be present. **Always verify the scene hierarchy after setup:** use `ExecuteEditorCode` to walk the scene tree and confirm the ScriptComponent exists before telling the user to test.

---

## Scene Hierarchy Blueprint

**IMPORTANT: RSG 4.0.0 ships a demo prefab at the package root, `RemoteServiceGateway__PLACE_IN_SCENE.prefab`, that is dragged into the scene (it is not added automatically).** If it is in the scene, it already contains a `RemoteServiceGatewayCredentials` object (direct child of the prefab root) and `External Hosted Examples/Websocket requirements` (with `MicrophoneRecorder` and `DynamicAudioOutput`); there is no `Requirements` parent in it. Never duplicate the credentials component: the bootstrap action (see *One-time Requirements bootstrap*) reuses the prefab's `RemoteServiceGatewayCredentials` and `Websocket requirements` when present and builds the hierarchy below only when they are absent. Build your `Examples` SceneObject alongside whichever hierarchy the scene has.

**Which hierarchy you need depends on the AI pattern:**
- **Chat Completions + ASR (`AIAssistant`)**: needs `RemoteServiceGatewayCredentials` **and** a `MicrophoneRecorder` (the `LensStudio:AsrModule` consumes the mic stream to produce transcription via `AsrModule.TranscriptionUpdateEvent`). Does NOT need `Websocket requirements` or `DynamicAudioOutput` (TTS playback uses a standard `AudioComponent` with the OpenAI TTS response). Canonical ASR wiring: `const asrModule = require('LensStudio:AsrModule')`, subscribe to `onTranscriptionUpdate` / `onTranscriptionError`, and start/stop transcription on hold-to-talk button events. **SUIK Button hold events are `onTriggerDown` / `onTriggerUp`** — `onTriggerStart` / `onTriggerEnd` do NOT exist and will silently no-op (no compile error, no transcription). Also note: `createCameraRequest` and ASR session setup must NOT be called from `onAwake` — wire them in `OnStartEvent`. ASR runs on-device only, not in Lens Studio Preview.
- **Gemini Live / OpenAI Realtime**: needs the full hierarchy including `Websocket requirements`, `MicrophoneRecorder`, and `DynamicAudioOutput`.

```
Camera Object
Lighting
InteractionKit          ← InteractionKit prefab (`InteractionKit.lspkg/Prefabs/InteractionKit.prefab`, required)
Requirements                      ← empty SceneObject, groups infrastructure
├── RemoteServiceGatewayCredentials [EDIT ME]   ← RSG credentials component lives here
│   └── Websocket requirements    ← DISABLED by default; assistant enables on session start
│       ├── MicrophoneRecorder    ← RSG MicrophoneRecorder component
│       └── DynamicAudioOutput    ← RSG DynamicAudioOutput component
└── Snap3DInteractableFactory     ← only if using Snap3D generation
Examples                          ← empty SceneObject, groups experience objects  ← CREATE via ExecuteEditorCode
└── Realtime AI                   ← empty SceneObject  ← CREATE via ExecuteEditorCode
    ├── AI Models                 ← empty SceneObject  ← CREATE via ExecuteEditorCode
    │   ├── Gemini Live           ← GeminiAssistant ScriptComponent  ← CREATE SceneObject + addComponent
    │   └── OpenAI Realtime       ← OpenAIAssistant ScriptComponent  ← CREATE SceneObject + addComponent
    └── AI UI Controller          ← AIAssistantUIBridge ScriptComponent  ← CREATE SceneObject + addComponent
Behaviors                         ← empty SceneObject
└── Object 0
    └── InternetAvailabilityPopUp ← internet guard popup
APIKeyWarning                     ← APIKeyHint script (shows warning if token not set)
GUIDE_ReadAndDisable              ← guide text, disable before shipping
```

**All SceneObjects in this hierarchy must be created and components attached via `ExecuteEditorCode`. Simply having `.ts` files in Assets is not sufficient — every script must have a corresponding SceneObject with an attached ScriptComponent in the scene tree.**

### ExecuteEditorCode authoring rules (avoid TS1232/TS1233/TS1184/TS2591)

`ExecuteEditorCode` snippets are compiled as a module wrapper — top-level `import`/`export` statements and bare decorators/modifiers are rejected. Follow these rules:

- **No `import` / `export` statements.** Use `const X = require('LensStudioInternal:...')` or the globals already injected (`Editor`, `Editor.Model`, etc.).
- **No `@component` / `@input` decorators inside `ExecuteEditorCode`** — those belong only in `.ts` files placed in `Assets/`. The editor snippet only *creates SceneObjects and attaches ScriptComponents that point at those asset files*.
- **Wrap logic in an IIFE** (`(() => { ... })()`) so any helper `const`/`function` declarations are not treated as top-level module members.
- **Pass strings, not Buffers**, to editor APIs — read file contents with `fs.readFileSync(path, 'utf8')` (the encoding argument is required) to avoid `TS2345: Buffer not assignable to string`.
- **`require` is available** in the editor sandbox without `@types/node`; do not add Node typings.

---

## Zero-Friction Authentication

**Prefer the programmatic token action; do not ask users to paste tokens when it returns `TOKENS_ASSIGNED`.** The `RemoteServiceGatewayToken` editor plugin (menu **Window → Remote Service Gateway Token**) generates all three provider tokens using the user's existing Snapchat login; the token action below calls the same endpoint directly, so it does not depend on the plugin being installed. The UI exception is explicitly limited to the `ACTION_REQUIRED` fallback below.

### MANDATORY: Agent must self-generate tokens

**RemoteServiceGateway 4.0.0 ships the `RemoteServiceGatewayToken` editor plugin** (Lens Studio extracts it to `Plugins/<id>/RemoteServiceGatewayToken/` on install). Whether or not it is present, the agent MUST first use the pinned `generate-and-assign-tokens.ts` action to generate and assign all three tokens via `ExecuteEditorCode`** — unless the user is signed out (see **Prerequisites** under the agent flow below).

**ALWAYS generate ALL THREE tokens (SNAP, OPENAI, GOOGLE) — never a subset.** Even if the current feature only uses one provider (e.g. only OpenAI Chat Completions), the agent MUST still generate SNAP and GOOGLE tokens in the same call. Reasons:
- Partial token setup causes confusing silent failures later when the user adds a feature that needs another provider.
- Users iterate — today's OpenAI-only assistant becomes tomorrow's Gemini+Snap3D scene; missing tokens then surface as opaque runtime errors.
- The cost of generating all three is identical to generating one (a single `Promise.all` of three authorized requests).
- The `RemoteServiceGatewayCredentials` component has fields for all three; leaving any unset triggers `APIKeyHint` warnings.

Generating only the "currently needed" token is a bug, not an optimization. Always emit the full `Promise.all([generateToken('SNAP'), generateToken('OPENAI'), generateToken('GOOGLE')])` block.

The plugin's permissions (`snap_auth_token`, `network`, `secure_local_storage`) are reachable from `ExecuteEditorCode` via `await import('LensStudio:Network')` and `Network.performAuthorizedHttpRequest()`. Because the user is already signed in to Lens Studio, the request is authorized automatically — no user action, no OAuth prompt, no API keys.

**Detection step (run before token work):** do not look for a plugin folder inside the `RemoteServiceGateway.lspkg` package — it is not there in 4.0.0. Run the token action: `TOKENS_ASSIGNED` → done; `ACTION_REQUIRED` → follow its `reason` (sign-in, or the UI path below).

**If the first `ExecuteEditorCode` token-generation attempt is denied or returns a permissions error**, that is a permission-prompt issue, not a capability issue — retry once after the user approves. Do NOT silently downgrade to "ask the user to click Window → Generate" without exhausting the programmatic path first.

**UI path (fallback ONLY when the token action remains unavailable after retry, and never for `reason: not_signed_in`):** report `ACTION_REQUIRED` and tell the user: **Window → Remote Service Gateway Token → Generate**. Plugin secure storage is sandboxed, so `ExecuteEditorCode` cannot automatically read back or wire UI-generated credentials without a separately verified bridge. Do not claim the credentials are wired: the user must configure the three `RemoteServiceGatewayCredentials` fields manually and save the project.

**Token persistence depends on writing to the actual `@input` fields.** The `RemoteServiceGatewayCredentials` script exposes **three** `@input` token fields — `snapToken`, `openAIToken`, and `googleToken` (see `references/scripts/RemoteServiceGatewayCredentials.ts`). The token action assigns all three directly, never a subset; after `TOKENS_ASSIGNED`, **save to the `.scene` file with `Cmd+S`**. After saving, the tokens survive Lens Studio restarts — but they still expire (~1 hour TTL per Snap policy) and must be regenerated when expired. If the `.scene` file has stale/expired tokens, re-run the token action and save again.

### How it works

The plugin holds `snap_auth_token`, `network`, and `secure_local_storage` permissions. When triggered, it calls:

```
POST https://gcp.api.snapchat.com/smart-gate/v2/token/{tokenType}
```

using `Network.performAuthorizedHttpRequest()` — which injects the user's Snap OAuth credential automatically because the user is already signed in to Lens Studio. The backend validates the OAuth token and returns a short-lived RSG token. Token types: `OPENAI`, `GOOGLE`, `SNAP`.

### ExecuteEditorCode constraints (avoid common compile errors)

See the **ExecuteEditorCode authoring rules** in the Scene Hierarchy section above for the full constraints (no top-level `import`/`export`, IIFE-wrap helpers, pass strings not Buffers). Compile-error signals that map to those rules: `TS1232` (top-level `import` used), `TS2591` (bare `require`/Node API in a context where it is unavailable), `TS2345` (`Buffer` passed where a `string` is expected — use `Uint8Array` or string APIs).

### Agent flow: generate tokens via ExecuteEditorCode

Run the pinned, path-backed action with no args:

```text
ExecuteEditorCode
  path: <absolute path to this skill>/actions/generate-and-assign-tokens.ts
```

The action obtains SNAP, OPENAI, and GOOGLE tokens inside its own EEC execution, assigns them only after all three requests succeed, and returns only `TOKENS_ASSIGNED` plus a non-sensitive receipt. It never accepts tokens in `args` and never returns a token, prefix, response body, or error detail. On any inability to generate or assign them it returns `ACTION_REQUIRED`. With `reason: not_signed_in`, follow **Prerequisites** below; otherwise follow the UI path above and do not imply automatic read-back/wiring is available.

**Prerequisites:** RSG package installed, user signed in to Lens Studio. `ACTION_REQUIRED` with `reason: not_signed_in` → keep the installed and wired components, skip token assignment, continue the build, and tell the user to sign in and re-run token generation. Skip the action up front when the caller passed `is_authorized: false` or `unknown`; with no `is_authorized`, run it — the action checks sign-in itself before any request or scene write. A successful `TOKENS_ASSIGNED` result needs no token-entry step; the user must still save the project.

**After generating tokens, always prompt the user to save the project (`Cmd+S`)** so the tokens are persisted to the `.scene` file. Tokens expire (~1 hour TTL per Snap policy) regardless of whether the project is saved. When a Lens returns auth errors, re-run token generation and save again.

**Note on secureLocalStorage:** The `TokenService` plugin stores tokens in `secureLocalStorage` under `smart_gate_token_data_openai` etc., but that storage is sandboxed per plugin — `ExecuteEditorCode` runs in a different plugin context and cannot read those keys. Always call `generateToken()` fresh via the Network approach above.

### What the plugin stores

The token-generator plugin may store its dialog values in plugin secure storage, but that storage is separate from `RemoteServiceGatewayCredentials` and sandboxed from `ExecuteEditorCode`. The token action therefore gets fresh tokens through the authorized endpoint and assigns the credential fields inside the same execution. A UI-generated token has no supported automatic read-back or wiring path unless a bridge is independently verified.

---

## Editor Actions

Use only these pinned, path-backed actions; never copy their bodies into an inline `code` call.

### One-time Requirements bootstrap

After installing RSG, run this static action with its path alone — it takes no args and is idempotent:

```text
ExecuteEditorCode
  path: <absolute path to this skill>/actions/bootstrap-requirements.ts
```

It reuses any existing `RemoteServiceGatewayCredentials` component in the scene (a `Requirements` hierarchy or the `RemoteServiceGateway__PLACE_IN_SCENE` prefab) and any existing `Websocket requirements` object, then creates only missing objects/components; a newly created `Websocket requirements` starts disabled. Its safe receipt is `REQUIREMENTS_READY` with `credentialsObjectName` and `websocketRequirementsObjectName` — pass both to the realtime wiring action. `ACTION_REQUIRED` lists only missing package asset names.

---

### Realtime assistant wiring

Pass only names (never native SceneObjects or components); the action resolves all native objects
and components in EEC before assigning inputs:

```text
ExecuteEditorCode
  path: <absolute path to this skill>/actions/wire-realtime-assistants.ts
  args:
    credentialsObjectName: "RemoteServiceGatewayCredentials [EDIT ME]"
    websocketRequirementsObjectName: "Websocket requirements"
    microphoneObjectName: "MicrophoneRecorder"
    dynamicAudioOutputObjectName: "DynamicAudioOutput"
    geminiAssistantObjectName: "Gemini Live"              # optional
    openAIAssistantObjectName: "OpenAI Realtime"          # optional
    uiBridgeObjectName: "AI UI Controller"                # optional
```

At least one Gemini or OpenAI assistant name is required. `uiBridgeObjectName` is optional; when supplied, **both** `geminiAssistantObjectName` and `openAIAssistantObjectName` are required or the action fails before lookup/mutation. The action wires each supplied assistant's `websocketRequirementsObj` to the `Websocket requirements` child (not the credentials parent), plus `microphoneRecorder` and `dynamicAudioOutput`; when supplied with both assistants, it connects `AIAssistantUIBridge` to both resolved components. It validates all names and required objects/components before mutation and returns `RSG_INPUTS_WIRED` only after assignments succeed; `wiredUIBridge` is true only when at least one bridge input was assigned.

---

## GeminiAssistant Script

**Copy `references/scripts/scene-scripts/GeminiAssistant.ts` into `Assets/` — do not rewrite from scratch.** The agentic variant (full function calling + video) is `GeminiAssistant.agentic.ts`. API surface:

- **`@input` fields:** `websocketRequirementsObj: SceneObject`, `dynamicAudioOutput: DynamicAudioOutput`, `microphoneRecorder: MicrophoneRecorder`, `instructions: string`, `haveVideoInput: boolean`, `haveAudioOutput: boolean`, `voice: string` (Puck/Aoede/Charon/Kore), `enableLogging: boolean`.
- **Public events:** `updateTextEvent: Event<{text, completed}>`, `functionCallEvent: Event<{name, args, callId?}>`.
- **Public methods:** `createGeminiLiveSession()` (enables WS requirements, opens `Gemini.liveConnect()`, sends `setup` on open), `streamData(isActive)` (start/stop mic + optional video frame), `interruptAudioOutput()` (barge-in), `sendFunctionCallUpdate(name, response)` (sends `tool_response`), `sendText(text)` (sends `client_content` with `turn_complete: true`), `disconnect()`.
- Use the correct Gemini Live model id `models/gemini-live-2.5-flash` and WAIT for `setupComplete` before attaching mic listeners (see Realtime Gotchas #1, #2). Gemini has no server VAD — send `client_content` with `turn_complete: true` on release (#3).

---

## OpenAI Realtime Script

**Copy `references/scripts/scene-scripts/OpenAIAssistant.ts` into `Assets/` — do not rewrite from scratch.** The agentic variant is `OpenAIAssistant.agentic.ts`. API surface:

- **`@input` fields:** `websocketRequirementsObj: SceneObject`, `dynamicAudioOutput: DynamicAudioOutput`, `microphoneRecorder: MicrophoneRecorder`, `instructions: string`, `haveAudioOutput: boolean`, `voice: string` (coral/alloy/echo/shimmer), `enableLogging: boolean`.
- **Public events:** `updateTextEvent: Event<{text, completed}>`, `functionCallEvent: Event<{name, args, callId?}>`.
- **Public methods:** `createOpenAIRealtimeSession()` (enables WS requirements, opens `OpenAI.createRealtimeSession`, sends `session.update` on open), `streamData(isActive)` (start/stop mic), `interruptAudioOutput()` (barge-in), `sendFunctionCallUpdate(name, callId, output)` (sends `function_call_output` + `response.create`), `disconnect()`.
- Model `gpt-realtime-mini` (GA). `session.update` must use the GA shape (`type: "realtime"`, `output_modalities`, `audio.input` / `audio.output`) — see Realtime Gotchas #6.
- OpenAI Realtime uses `server_vad` — do NOT manually commit the turn on release (see Realtime Gotchas #3).

---

## OpenAI Chat Completions (non-realtime, ASR-based)

Use when you want turn-based voice queries, not streaming. Pair with `ASRQueryController`.

```typescript
import {OpenAI} from "RemoteServiceGateway.lspkg/HostedExternal/OpenAI"
import {OpenAITypes} from "RemoteServiceGateway.lspkg/HostedExternal/OpenAITypes"

private conversationHistory: OpenAITypes.ChatCompletions.Message[] = []

public init(systemPrompt: string): void {
  this.conversationHistory = [{role: "system", content: systemPrompt}]
}

public sendMessage(userText: string): Promise<string> {
  this.conversationHistory.push({role: "user", content: userText})
  return OpenAI.chatCompletions({
    model: "gpt-5.6-luna",   // model used by the RSG 4.0.0 ExampleOAICalls
    messages: this.conversationHistory,
  }).then((response: OpenAITypes.ChatCompletions.Response) => {
    const reply = response.choices[0].message.content as string
    this.conversationHistory.push({role: "assistant", content: reply})
    return reply
  })
}
```

---

## ASR Module Reference

**Prerequisites:** Lens Studio v5.9.0+, Snap OS v5.61+. ASR only runs on physical Specs — Preview always returns "Nothing heard".

### Recommended ASR UX (propose this at the start of any ASR task)

When the user asks for voice input, **always recommend this UI pattern up front** before writing code — it makes ASR debuggable and gives the user the feedback they need to trust the mic:

1. **A dedicated "Hold to Talk" button** (SUIK `Button` or `RoundButton`) — voice input on press-and-hold, never tap-to-toggle. Hold-to-talk is unambiguous, matches Specs conventions, and lets the user cancel by simply releasing.
2. **Live in-UI feedback during the hold:**
   - **Partial transcript streamed into the visible input/text field** as the user speaks (update on every `onTranscriptionUpdateEvent`, don't wait for `isFinal`). This is the single most important signal — if the user sees their words appearing, ASR is working.
   - **A status line** that flips between `"Listening… (release to stop)"` on press, `"Heard: <transcript>"` or `"Processing…"` on release, and `"ASR error: <code>"` on failure.
   - **Optional**: a visual indicator on the button itself (color shift, scale, ring) while held, so the user can confirm the press registered even before they hear themselves transcribed.
3. **Logger breadcrumbs at every step** — press, `startTranscribing` called, each partial, each error code, release, `stopTranscribing` resolved. When the user reports "ASR isn't working" you need this trail to diagnose whether the button event fired at all, whether the module rejected the start, or whether the mic just isn't producing events.
4. **Surface error codes verbatim in the status line.** `Unauthenticated`, `NoInternet`, `InternalError` each map to a different fix; never collapse them into a generic "ASR failed".

State this recommendation to the user before implementing, and default to it unless they explicitly want a different model (e.g. wake-word, continuous transcription, tap-to-toggle).

```typescript
const asrModule = require('LensStudio:AsrModule')

// Create options
const options = AsrModule.AsrTranscriptionOptions.create()
options.silenceUntilTerminationMs = 1500   // ms of silence before marking final
options.mode = AsrModule.AsrMode.HighAccuracy  // HighAccuracy | Balanced | HighSpeed

// Callbacks (add to event, not property assignment)
options.onTranscriptionUpdateEvent.add((e: AsrModule.TranscriptionUpdateEvent) => {
  print(`text="${e.text}", isFinal=${e.isFinal}`)
  if (e.isFinal) {
    asrModule.stopTranscribing()  // stopTranscribing() returns a Promise
  }
})
options.onTranscriptionErrorEvent.add((code: AsrModule.AsrStatusCode) => {
  // Error codes: InternalError, Unauthenticated, NoInternet
  print(`ASR error: ${code}`)
})

asrModule.startTranscribing(options)

// Stop and await cleanup
asrModule.stopTranscribing().then(() => {
  print('Transcribing stopped')
})
```

**Key behaviors:**
- `stopTranscribing()` returns a `Promise` — use `.then()` when you need to sequence actions after stop
- `silenceUntilTerminationMs` only marks the current fragment as final — transcription continues until `stopTranscribing()` is called
- Transcription update events fire continuously with partial results; only `e.isFinal === true` is the committed sentence

### ASR Gotchas (learned from real sessions)

These mistakes silently break ASR with no helpful error. The agent must avoid them:

1. **Create options via the global `AsrModule` namespace, NOT the module instance.**
   - ✅ `AsrModule.AsrTranscriptionOptions.create()` and `AsrModule.AsrMode.HighAccuracy`
   - ❌ `(this.asrModule as any).AsrTranscriptionOptions.create()` — these statics do not exist on the instance returned by `require("LensStudio:AsrModule")`. Calling them throws or returns undefined silently and the mic appears to do nothing.
   - The instance is what you call `startTranscribing(opts)` / `stopTranscribing()` on; the namespace is what creates option objects and enum values.

2. **Type the require properly — do NOT cast to `any`.**
   - ✅ `private asrModule: AsrModule = require("LensStudio:AsrModule")`
   - ❌ `private asrModule = require("LensStudio:AsrModule") as any` — losing the type lets the wrong-namespace bug above compile cleanly.

3. **Do NOT short-circuit ASR in the editor.** Calls like `if (global.deviceInfoSystem.isEditor()) return;` block ASR even when **Interactive Preview is paired to a Specs device** — in that mode the mic stream comes from the real device and ASR works. Always attempt `startTranscribing()`; let the platform decide. If it can't transcribe, `onTranscriptionErrorEvent` will fire with `Unauthenticated` / `NoInternet` / `InternalError` — surface the code to the user.

4. **Hold-to-talk button events on SUIK Button are `onTriggerDown` / `onTriggerUp`, NOT `onTriggerStart` / `onTriggerEnd`.** The latter compile but never fire (they exist on `RoundButton` only). Wrong event names cause "I press hold and nothing happens" with zero log output.
   - SUIK `Button` (rectangular): `onTriggerDown` / `onTriggerUp`
   - SUIK `RoundButton` (orb): `onTriggerStart` / `onTriggerEnd`

5. **Always log on press, release, partial update, and error** when wiring a new ASR flow. If the user says "ASR isn't working" you need the breadcrumb trail to tell whether the button event fired, whether `startTranscribing` threw, or whether the mic stream produced events. Silent code = silent failure.

6. **Live-write partials to the visible input field.** Don't wait for `e.isFinal` — users need to see they're being heard. Update `inputField.text` on every `onTranscriptionUpdateEvent` and treat `isFinal` as the commit signal.

### Canonical hold-to-talk pattern with SUIK Button

```typescript
import {Button} from "UIKit.lspkg/Scripts/Components/Button/Button"

@input private micButton: Button
@input private inputField: TextInputField

private asrModule: AsrModule = require("LensStudio:AsrModule")
private isListening = false
private latestTranscript = ""

private wireMicButton(): void {
  this.micButton.initialize()
  this.micButton.onTriggerDown.add(() => this.startListening())
  this.micButton.onTriggerUp.add(() => this.stopListening())
}

private startListening(): void {
  if (this.isListening) return
  this.isListening = true
  this.latestTranscript = ""

  const opts = AsrModule.AsrTranscriptionOptions.create()
  opts.silenceUntilTerminationMs = 1500
  opts.mode = AsrModule.AsrMode.HighAccuracy

  opts.onTranscriptionUpdateEvent.add((e) => {
    this.latestTranscript = e.text || this.latestTranscript
    this.inputField.text = this.latestTranscript                   // live partial
    print(`[ASR] partial="${e.text}" final=${e.isFinal}`)
  })
  opts.onTranscriptionErrorEvent.add((code) => {
    print(`[ASR] error code=${code}`)
    this.isListening = false
  })

  try {
    this.asrModule.startTranscribing(opts)
    print("[ASR] startTranscribing called")
  } catch (e) {
    print(`[ASR] start exception: ${e}`)
    this.isListening = false
  }
}

private stopListening(): void {
  if (!this.isListening) return
  this.isListening = false
  this.asrModule.stopTranscribing().then(() => {
    if (this.latestTranscript) this.inputField.text = this.latestTranscript
    print("[ASR] stopped")
  })
}
```

---

## Google Image Generation: Gemini image models via `Imagen.generateContent`

Generate images with a Gemini image model (`gemini-3.1-flash-image` or `gemini-3.1-flash-lite-image`) through the gateway's "imagen" route, `Imagen.generateContent`:

```typescript
import {Imagen} from "RemoteServiceGateway.lspkg/HostedExternal/Imagen"
import {GoogleGenAITypes} from "RemoteServiceGateway.lspkg/HostedExternal/GoogleGenAITypes"

const request: GoogleGenAITypes.Imagen.GenerateContentRequest = {
  model: "gemini-3.1-flash-image",   // or "gemini-3.1-flash-lite-image"
  type: "generateContent",
  body: {
    contents: [{role: "user", parts: [{text: prompt}]}],
    generationConfig: {responseModalities: ["TEXT", "IMAGE"]},
  },
}
Imagen.generateContent(request).then((response) => {
  const parts = response.candidates?.[0]?.content?.parts ?? []
  const imagePart = parts.find((part) => part?.inlineData?.data)
  if (imagePart) Base64.decodeTextureAsync(imagePart.inlineData.data, (tex) => { /* assign baseTex */ }, () => {})
})
```

`Gemini.models(...)` with the same model and `responseModalities: ["TEXT", "IMAGE"]` also returns the image as an `inlineData` part (this is what `ExampleGeminiCalls` does). For OpenAI image generation use `gpt-image-2`; it always answers `b64_json`.

---

## Realtime (Gemini Live / OpenAI Realtime) Gotchas

These come from real sessions where realtime voice silently failed in different ways. The agent must internalize all of them — most are "compiles clean, runs, but no audio in/out" bugs.

### 1. Use the right Gemini Live model name

**An unserved model id (e.g. `models/gemini-2.0-flash-live-001`) returns "Invalid resource field value in the request"** and the WebSocket closes immediately. The model id used by the RSG 4.0.0 `ExampleGeminiLive` (and the scripts in `references/scripts/scene-scripts/`) is:

```typescript
const modelUri = "models/gemini-live-2.5-flash"
```

If the user sees `Gemini closed: Invalid resource field value …` in the logs, the model id is wrong — that error is the gateway rejecting an unknown publisher model, not a code bug.

### 2. Order of operations matters — match the Agentic Playground exactly

Realtime sessions fail silently when steps run in the wrong order. The canonical sequence (do not deviate):

1. **Enable** `websocketRequirementsObj` (the SceneObject wrapping `MicrophoneRecorder` + `DynamicAudioOutput`).
2. **Initialize audio output** — `dynamicAudioOutput.initialize(24000)` BEFORE any `addAudioFrame()`.
3. **Set mic sample rate** on the `MicrophoneRecorder` (16000 Hz for Gemini Live, 24000 Hz for OpenAI Realtime — as in `ExampleGeminiLive` / `ExampleOAIRealtime`).
4. **Open the connection** — `Gemini.liveConnect()` or `OpenAI.createRealtimeSession({...})`.
5. **OpenAI**: on `onOpen` → send `session.update` → attach chunk-ready listener → attach mic-frame listener → `startRecording()`.
6. **Gemini**: on `onOpen` → send `setup` → **WAIT for `setupComplete`** → attach listeners → `startRecording()`. Attaching mic listeners before `setupComplete` is the most common Gemini failure mode — frames are sent into the void and the connection closes.

> If the agent skips the `setupComplete` wait for Gemini, mic frames stream but never produce a reply. There is no error message — the user just hears silence and assumes the mic is broken.

### 3. Turn boundaries differ by provider — do not double-commit

- **OpenAI Realtime** uses `server_vad` by default. The server detects end-of-speech automatically. **Do NOT send a manual commit on release** — sending `input_audio_buffer.commit` + `response.create` after server_vad already committed the turn causes overlapping turns and dropped audio.
- **Gemini Live** does NOT have server VAD. On release, send `client_content` with `turn_complete: true` so the model knows to respond.

The naive "treat both providers the same on release" pattern breaks one of them — always branch by provider.

### 4. Attach session listeners ONCE, not per press

Holding the talk button repeatedly should not re-add `onMessage` / `onAudio` handlers. If listeners pile up, every AI audio frame plays N times, every text delta is logged N times, and the session "feels glitchy." Track listener registration by session, not by press:

```typescript
private listenersAttached = false
private onSessionOpen(): void {
  if (this.listenersAttached) return
  // attach onMessage, onAudio, onError, onClose here exactly once
  this.listenersAttached = true
}
```

Reset `listenersAttached` to `false` on `onClose` so a fresh session can re-attach.

### 5. Audio I/O scene wiring CANNOT be done purely at runtime

`MicrophoneRecorder`, `DynamicAudioOutput`, and `AudioComponent` need an `AudioTrackAsset` linked via `@input`. These cannot be created from a pure runtime script — `AudioTrackAsset` is an asset type, not a runtime allocation. Two viable paths:

- **(a) Inspector wiring** — add `@input` fields for `audioInTrack` / `audioOutTrack` and tell the user to drag `AudioTrackAsset` resources in. Brittle and breaks the no-Inspector philosophy.
- **(b) Auto-wire via `ExecuteEditorCode`** at scene-bootstrap time — create an `AudioTrackAsset` via `assetManager.createAsset(...)` and attach it to the runtime `AudioComponent`. This is the **preferred** pattern; it preserves zero-friction setup and matches the rest of the agent's bootstrapping flow.

If the agent stubs out the audio path with a "TODO: wire AudioTrackAsset" comment, the session connects, text streams in, but **mic input is a no-op and the user hears nothing back**. Always implement path (b) — never ship the stub.

### 6. Modalities config

- **Gemini Live (audio out)**: `generationConfig.responseModalities: ["AUDIO"]` plus a `speechConfig.voiceConfig` block (the RSG `GeminiTypes` field names). Setting `["TEXT"]` here sends text-only and the user hears nothing — this is a config bug, not a model bug.
- **OpenAI Realtime (full duplex, GA `gpt-realtime-mini`)**: `session.update` with `session: { type: "realtime", output_modalities: ["audio"], audio: { input: { format: { type: "audio/pcm", rate: 24000 }, turn_detection: { type: "server_vad", ... } }, output: { format: { type: "audio/pcm", rate: 24000 }, voice: "coral" } } }`. GA sessions answer in one modality (`["audio"]` also streams a transcript); the flat beta fields (`modalities`, `input_audio_format`, `voice`) are rejected by GA models. Listen for `response.output_text.delta` / `response.output_audio_transcript.delta` / `response.output_audio.delta`. Without `server_vad`, the server never commits the turn and the AI never replies.

### 7. Implement barge-in

When the user starts speaking while the AI is still talking, both providers emit an interruption signal (`message.serverContent?.interrupted` for Gemini; `response.cancelled` / `input_audio_buffer.speech_started` for OpenAI). Call `dynamicAudioOutput.interruptAudioOutput()` to silence the in-flight reply immediately. Without barge-in, the AI keeps talking over the user — extremely jarring on Specs.

### 8. Realtime is device-only — editor preview will lie

In Lens Studio Preview, `MicrophoneRecorder` typically does not stream real frames even when the mic indicator looks active. The session connects, the model sits idle, and the user sees `0 micFrame events` in the logs. This is **not** a code bug — realtime requires a paired Specs device. Always state this to the user before they test, and give them a log-driven diagnosis path:

| Log signal | Meaning |
|---|---|
| No `micFrame #1` ever printed | Mic isn't streaming — test on device, not Preview. |
| `micFrame` events but no `chunkReady` | `AudioProcessor` is dropping empty/silent frames. Check the `MicrophoneRecorder` sample rate: 16000 Hz for Gemini Live, 24000 Hz for OpenAI Realtime. |
| `chunkReady` events but no AI reply | RSG token expired (regenerate), wrong model id (see #1), or `setup`/`session.update` was not awaited (see #2). |
| `Gemini closed: Invalid resource field value` | Wrong model id (see #1). |
| `Pipe was already closed` immediately after open | Token issue or model id issue — almost never a network problem. |

### 9. Granular logs are mandatory for realtime

Realtime failures are silent by default. The agent MUST emit logs at every transition when wiring a new realtime flow — without these, "voice doesn't work" is undiagnosable:

```
[Realtime] talk pressed
[Realtime] Gemini connected           // or [Realtime] OpenAI connected
[Realtime] setupComplete received     // Gemini only
[Realtime] mic listeners attached
[Realtime] startRecording() called
[Realtime] micFrame #1 size=N         // print first frame and every 50th
[Realtime] chunkReady #1 size=N
[Realtime] sending audio chunk
[Realtime] talk released
[Realtime] stopRecording — frames=N chunks=M
[Realtime] AI text delta: "..."
[Realtime] AI audio delta size=N
[Realtime] interrupted — clearing buffer
[Realtime] closed: <reason>
```

This single log template lets the user (or the agent on the next turn) localize *any* realtime failure to one of the rows in the table above in seconds.

### 10. Closing previous session before switching providers

If the UI lets the user switch between OpenAI ↔ Gemini mid-experience, **close the active socket before opening the new one** (`OAIRealtime?.close()` / `GeminiLive?.close()`). Otherwise both sockets stream mic frames in parallel, two AIs talk over each other, and the audio output becomes garbled.

### 11. Read the working sample first

Before writing a new realtime script, read `AI Playground/Assets/Scripts/GeminiAssistant.ts` AND `OpenAIAssistant.ts` (or the `.agentic.ts` variants) under `references/scripts/scene-scripts/`. They encode all the rules above. Most realtime failures in past sessions traced back to deviating from these samples — match their structure, then customize.

---

## Snap3D Generation: NEVER pass `null` as the material

**Calling `gltfAsset.tryInstantiate(parent, null)` crashes Lens Studio** (native gltf loader segfault). This has hard-crashed the editor in real sessions when streaming Snap3D base/refined meshes. The working `AI Playground` sample always passes a real `Material` — match that.

**Required pattern:**

```typescript
// Build a reusable material once, in your scene init.
// Cloning a known-good UIKit material asset is the safest default — never construct one from null.
private meshMaterial!: Material

private buildScene(): void {
  // ...other setup...
  this.meshMaterial = IMAGE_MATERIAL_ASSET.clone()   // or any guaranteed-valid Material asset
}

// Snap3D artifact handler
const inst = (data.gltfAsset as any).tryInstantiate(this.mesh3DRoot, this.meshMaterial)
//                                                                  ^^^^^^^^^^^^^^^^^^
//                                                                  MUST be a real Material — never null
```

**Rules:**
- Never call `tryInstantiate(parent, null)`. Even `undefined` is unsafe — pass a concrete `Material` reference every time.
- Build the material once and reuse it across base-mesh and refined-mesh callbacks. Re-cloning per-instantiation is fine but unnecessary.
- If you don't have a PBR material at hand, clone a known-good UIKit material (e.g. `IMAGE_MATERIAL_ASSET.clone()`) as a safe fallback. The mesh will render unlit/flat-shaded, which is ugly but won't crash — that's an acceptable interim while wiring a proper PBR material.
- The `Snap3DInteractableFactory` reference script in `references/scripts/scene-scripts/` shows the canonical instantiation flow — read it before writing a Snap3D handler from scratch.
- Tell the user up front that Snap3D refinement takes 30–90s and stream status updates ("3D base mesh ready, refining…", "3D refined") so they don't think the editor froze.

**Placement defaults — put the mesh where the user can actually see it.** Snap3D meshes are authored in centimeters and instantiate at native scale at the parent's origin. If the parent is at `(0,0,0)` the mesh spawns inside the user's head and they see nothing. Default the mesh root to a comfortable in-front-of-the-user pose:

```typescript
const meshRoot = global.scene.createSceneObject("Snap3DMeshRoot")
const t = meshRoot.getTransform()
t.setLocalPosition(new vec3(0, 20, -100))   // ~1m in front, slightly above eye level
t.setLocalScale(new vec3(10, 10, 10))       // minimum 10× — Snap3D meshes are tiny by default
```

- **Position**: `(0, 20, -100)` (cm) is a good default — roughly 1 meter in front of the user, slightly above eye line so the mesh isn't blocked by the floor or a UI Frame placed at chest height.
- **Scale**: at least `10` on every axis. Lower than that and the mesh reads as a thumbnail. If the user wants it bigger, scale up — never down from this floor.
- Apply both **before** the first `tryInstantiate` call so the base mesh appears in-place; otherwise the user sees the mesh pop in invisible-small at the origin and conclude the API failed.

This is a stability rule, not a stylistic preference — passing `null` will take down the user's editor mid-generation and they will lose unsaved work.

---

## SUIK Image Display Gotchas (when showing generated images)

When putting an `Image` component inside a SUIK `Frame`/`BackPlate`, the image often appears black, washed out, or behind the backplate. Three fixes that consistently solve this:

1. **Bump `renderOrder`** on the image's RenderMeshVisual / Image component to a high value (e.g. `5000`) so it draws in front of the Frame's backplate.
2. **Reset `baseColor` to opaque white when the texture lands.** SUIK Image presets often ship with a dark placeholder tint (e.g. `vec4(0.08, 0.10, 0.14, 1)`) that multiplies against the texture and makes it nearly black:
   ```typescript
   (this.imageVisual.mainPass as any).baseTex = texture
   (this.imageVisual.mainPass as any).baseColor = new vec4(1, 1, 1, 1)
   ```
3. **Disable transparency on the material** if the image renders semi-transparent — the SUIK material defaults can pre-multiply alpha against the backplate. Set `transparencyEnabled = false` on the material/pass once the texture is assigned.

---

## WebSocket API Reference

**Prerequisites:** Lens Studio v5.4.0+, Snap OS v5.059+. WebSocket only works on Specs (not iOS/Android).

**LS 5.9+ migration:** `createWebSocket` moved from `RemoteServiceModule` to `InternetModule`. For any new Lens use `InternetModule`. Old published Lenses using `RemoteServiceModule` continue to work until re-published.

**`wss://` vs `ws://`:** Use `wss://` (secure) for any publishable Lens. `ws://` requires Experimental APIs enabled and **cannot be published**.

**Preview window:** WebSocket only works in Preview if **Device Type Override** is set to SPECS 27.

```typescript
@component
export class WebSocketExample extends BaseScriptComponent {
  @input internetModule: InternetModule

  private socket!: WebSocket

  onAwake() {
    this.socket = this.internetModule.createWebSocket('wss://your-server.example.com/ws')
    this.socket.binaryType = 'blob'

    this.socket.onopen = (_event: WebSocketEvent) => {
      print('WebSocket connected')
      // Send text
      this.socket.send('hello')
      // Send binary
      const bytes = new Uint8Array([1, 2, 3])
      this.socket.send(bytes)
    }

    this.socket.onmessage = async (event: WebSocketMessageEvent) => {
      if (event.data instanceof Blob) {
        // Binary frame — read as bytes or text
        const text = await event.data.text()
        print('Binary message: ' + text)
      } else {
        // Text frame
        print('Text message: ' + (event.data as string))
      }
    }

    this.socket.onclose = (event: WebSocketCloseEvent) => {
      if (event.wasClean) print('Closed cleanly')
      else print('Closed with error, code: ' + event.code)
    }

    this.socket.onerror = (_event: WebSocketEvent) => {
      print('WebSocket error')
    }
  }
}
```

**Known limitations:**
- `Blob` does not support `ArrayBuffer` or `Stream`
- `binaryType = 'arrayBuffer'` is not supported (use `'blob'` only)
- `extensions`, `protocol`, and `bufferedAmount` properties are not supported

**Note on RSG vs direct WebSocket:** The RSG package's Gemini Live and OpenAI Realtime use an internal WebSocket via `Websocket requirements` scene node — these are managed by RSG and you don't call `createWebSocket` yourself. Use direct `InternetModule.createWebSocket` only when building custom WebSocket integrations not covered by RSG.

---

## ASRQueryController (voice input helper)

Wraps ASR into a clean Promise that resolves on final transcript. Reference: `AI Playground/Assets/Scripts/ASRQueryController.ts`

```typescript
import {bindStartEvent} from "SnapDecorators.lspkg/decorators"
import {BaseButton} from "UIKit.lspkg/Scripts/Components/Button/BaseButton"
import Event from "InteractionKit.lspkg/Utils/Event"

@component
export class ASRQueryController extends BaseScriptComponent {
  @input private button: BaseButton
  @input private activityRenderMesh: RenderMeshVisual

  public onQueryEvent: Event<string> = new Event<string>()

  private asrModule: AsrModule = require("LensStudio:AsrModule")
  private isRecording: boolean = false

  @bindStartEvent
  private init(): void {
    this.button.initialize()
    this.button.onTriggerUp.add(() => {
      this.getVoiceQuery().then((query) => this.onQueryEvent.invoke(query))
    })
  }

  public getVoiceQuery(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.isRecording) {
        this.asrModule.stopTranscribing()
        this.isRecording = false
        reject("Cancelled")
        return
      }
      this.isRecording = true
      const opts = AsrModule.AsrTranscriptionOptions.create()
      opts.mode = AsrModule.AsrMode.HighAccuracy
      opts.silenceUntilTerminationMs = 1500
      opts.onTranscriptionUpdateEvent.add((e: AsrModule.TranscriptionUpdateEvent) => {
        if (e.isFinal) {
          this.isRecording = false
          // stopTranscribing() returns a Promise; await if you need to sequence after stop
          this.asrModule.stopTranscribing().then(() => resolve(e.text))
        }
      })
      opts.onTranscriptionErrorEvent.add(() => {
        this.isRecording = false
        reject("ASR error")
      })
      this.asrModule.startTranscribing(opts)
    })
  }
}
```

---

## UIKit Integration (Essential)

**`UIKit.lspkg` is a required dependency** in every RSG AI example — it provides the button and interaction layer that drives all user-initiated voice and AI interactions. Every scene-level script that handles user input imports from UIKit.

### Why UIKit is mandatory

All RSG AI examples follow the same interaction model: the user pinches (on device) or clicks (in editor) a **UIKit button** to trigger the AI flow. Without UIKit buttons, there is no user interaction entry point.

### Core UIKit imports

```typescript
import {BaseButton} from "UIKit.lspkg/Scripts/Components/Button/BaseButton"
import {RoundButton} from "UIKit.lspkg/Scripts/Components/Button/RoundButton"
```

| Class | Use |
|-------|-----|
| `BaseButton` | Standard trigger button — used in `ASRQueryController`, `AIAssistantUIBridge`, all FastUIControllers |
| `RoundButton` | Circular interaction button — used in `SphereController` for the floating orb |

### Button wiring pattern

Buttons must be initialized before use, then subscribed via `onTriggerUp`:

```typescript
@input private myButton: BaseButton

@bindStartEvent
private onStart(): void {
  this.myButton.initialize()           // required before any onTriggerUp subscription
  this.myButton.onTriggerUp.add(() => {
    // trigger AI action here
  })
}
```

**Always call `button.initialize()` in `onStart` (or `@bindStartEvent`), never in `onAwake`** — UIKit components may not be ready at `onAwake` time.

### Show/hide buttons with animation

When the user selects an assistant, hide the selection buttons with a scale animation before starting the session:

```typescript
import animate from "InteractionKit.lspkg/Utils/animate"
import {MathUtils} from "Utilities.lspkg/Scripts/Utils/MathUtils"

private hideButton(button: BaseButton): void {
  button.enabled = false
  const tr = button.sceneObject.getTransform()
  const start = tr.getLocalScale()
  animate({
    duration: 0.5,
    easing: "ease-out-quad",
    update: (t) => {
      tr.setLocalScale(new vec3(
        MathUtils.lerp(start.x, 0, t),
        MathUtils.lerp(start.y, 0, t),
        MathUtils.lerp(start.z, 0, t)
      ))
    },
    ended: () => { button.sceneObject.enabled = false }
  })
}
```

### AIAssistantUIBridge wiring map

`AIAssistantUIBridge` wires two UIKit buttons to the Gemini/OpenAI assistants. Both `@input` fields are `BaseButton`:

| `@input` field | Points to |
|----------------|-----------|
| `geminiButton` | A `BaseButton` component on the "Select Gemini" button SceneObject |
| `openAIButton` | A `BaseButton` component on the "Select OpenAI" button SceneObject |
| `sphereController` | `SphereController` component (manages the `RoundButton` orb) |

### SphereController / RoundButton orb

`SphereController` (from `references/scripts/scene-scripts/`) manages the floating orb that activates mic streaming. The orb is a `RoundButton`:

```typescript
import {RoundButton} from "UIKit.lspkg/Scripts/Components/Button/RoundButton"

@input private roundButton: RoundButton

@bindStartEvent
private init(): void {
  this.roundButton.initialize()
  this.roundButton.onTriggerStart.add(() => this.setActivated(true))
  this.roundButton.onTriggerEnd.add(() => this.setActivated(false))
}
```

The orb is invisible until `sphereController.initializeUI()` is called (after assistant selection). Wire `AIAssistantUIBridge.sphereController` → the `SphereController` component.

### UIKit objects must come from presets

Create button SceneObjects from UIKit presets — do not manually assemble components. UIKit presets configure required siblings (Canvas, render layers, interaction components) automatically. Use `scene-graphql` with preset names like `"RoundButtonPreset"` or `"ButtonPreset"`, or use the UIKit prefabs from the asset library.

---

## Internet Availability Guard

```typescript
@component
export class InternetAvailabilityPopUp extends BaseScriptComponent {
  @input popup: SceneObject   // SceneObject to show/hide

  onAwake(): void {
    global.deviceInfoSystem.onInternetStatusChanged.add((args) => {
      this.popup.enabled = !args.isInternetAvailable
    })
    this.popup.enabled = !global.deviceInfoSystem.isInternetAvailable()
  }
}
```

Place this on a SceneObject under `Behaviors > Object 0`. Wire `popup` to the internet-warning panel SceneObject.

---

## API Key Validation

```typescript
import {AvaliableApiTypes, RemoteServiceGatewayCredentials} from "RemoteServiceGateway.lspkg/RemoteServiceGatewayCredentials"

@component
export class APIKeyHint extends BaseScriptComponent {
  @input text: Text

  onAwake(): void {
    const placeholders = {
      [AvaliableApiTypes.Snap]: "[INSERT SNAP TOKEN HERE]",
      [AvaliableApiTypes.OpenAI]: "[INSERT OPENAI TOKEN HERE]",
      [AvaliableApiTypes.Google]: "[INSERT GOOGLE TOKEN HERE]"
    }
    const missing = [AvaliableApiTypes.Snap, AvaliableApiTypes.OpenAI, AvaliableApiTypes.Google]
      .some(t => {
        const key = RemoteServiceGatewayCredentials.getApiToken(t)
        return key === placeholders[t] || key === ""
      })

    if (missing) {
      this.text.text = "Set your API Token in the RemoteServiceGatewayCredentials component"
    } else {
      this.text.enabled = false
    }
  }
}
```

---

## Reference Scripts (copy-ready)

Full working implementations are in `references/scripts/scene-scripts/`. Use these as-is or adapt — do not rewrite from scratch.

### Single-script AI assistants (preferred — no inspector wiring)

| File | Purpose |
|------|---------|
| `AIAssistant.ts` | **Canonical hold-to-talk assistant** — ASR + OpenAI Chat Completions via RSG, multi-turn history, self-contained. One script in the Inspector, zero wiring. |
| `AIAssistantUI.ts` | Builder module used by `AIAssistant.ts` — creates transcript panel + button programmatically. Not a `@component`; import and call `buildUI()`. |

### Multi-script realtime assistants (Gemini Live / OpenAI Realtime)

These are the reference patterns for streaming voice assistants. They require inspector wiring (see Wiring Map above).

| File | Purpose |
|------|---------|
| `GeminiAssistant.ts` | Gemini Live scene component — canonical wiring pattern |
| `OpenAIAssistant.ts` | OpenAI Realtime scene component — canonical wiring pattern |
| `ASRQueryController.ts` | Promise-based voice query (pinch-to-speak) |
| `InternetAvailabilityPopUp.ts` | Internet guard popup |
| `APIKeyHint.ts` | Shows warning when RSG token is unset |
| `AIAssistantUIBridge.ts` | Wires Gemini+OpenAI assistants to UI buttons and sphere orb |
| `ImageGenerator.ts` | Gemini/OpenAI image generation helper class |
| `Snap3DInteractableFactory.ts` | Creates Snap3D objects from text prompts |
| `InteractableSnap3DGenerator.ts` | Interactable Snap3D generation with UI |
| `InteractableImageGenerator.ts` | Interactable image generation with UI |
| `GeminiAssistant.agentic.ts` | Gemini Live with full function calling + video — use for agentic flows |
| `OpenAIAssistant.agentic.ts` | OpenAI Realtime with advanced function calling |
| `ChatASRController.ts` | Chat-mode ASR (tap-to-toggle, no hold) |

When building a scene, **always read the relevant script first** before writing any code — it contains the exact `@input` field names needed for wiring.

---

## Required Packages

Install these before building any RSG scene (check with `ListInstalledPackagesTool` first):

| Package | Asset Library name |
|---------|-------------------|
| RSG | `RemoteServiceGateway` |
| InteractionKit | `InteractionKit` |
| UIKit | `UIKit` |
| Utilities | `Utilities` |
| SnapDecorators | `SnapDecorators` |
| Motion, Icons | `Motion`, `Icons` (declared in RSG 4.0.0 `package_dependencies.json`; not imported by RSG scripts) |

---

## Key Notes

- **ASR is device-only** — see ASR Module Reference > Prerequisites. Never diagnose ASR issues in the Preview panel; always test on device.
- **`Websocket requirements` must be disabled by default** — the assistant enables it on `createGeminiLiveSession()` / `createOpenAIRealtimeSession()`. Never enable it at scene load.
- **RSG handles authentication** — no API keys in the Lens script. Token goes in `RemoteServiceGatewayCredentials [EDIT ME]`.
- **Audio rates**: Gemini output 24000 Hz / mic input 16000 Hz. OpenAI Realtime output 24000 Hz / mic input 24000 Hz.
- **`DynamicAudioOutput.initialize(24000)`** must be called before any `addAudioFrame()` — initialize in `onStart`, not `onAwake`.
- **Function calls must get a response** before Gemini/OpenAI continues generating. Call `sendFunctionCallUpdate()` synchronously or the session stalls.
- **`@bindStartEvent`** (from SnapDecorators) is preferred over `createEvent("OnStartEvent").bind()` — cleaner and handles dependency ordering.
- **Internet check** — always add `InternetAvailabilityPopUp` for production Lenses. RSG calls fail silently without internet.
- See `AI Playground/Assets/Scripts/GeminiAssistant.ts` and `OpenAIAssistant.ts` for full reference implementations.
