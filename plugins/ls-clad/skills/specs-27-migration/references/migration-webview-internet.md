<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Migration: WebView / fetch / WebSocket / HTTP

**When this applies:** any match for `RemoteServiceModule` or `remoteServiceModule` in the project scan.

Migrate all `RemoteServiceModule` usage to `InternetModule`. This is a direct module swap —
method signatures are identical.

## Detection Patterns

- `RemoteServiceModule`
- `remoteServiceModule`

## Migration Steps

### Input declarations

```ts
// OLD
@input
remoteServiceModule: RemoteServiceModule

// NEW
@input
internetModule: InternetModule
```

### Static method calls

```
// OLD
RemoteServiceModule.createWebViewOptions(resolution)

// NEW
InternetModule.createWebViewOptions(resolution)
```

### Instance method calls

The variable name changes along with the module:

```
// OLD                                                 NEW
script.remoteServiceModule.createWebView(...)       -> script.internetModule.createWebView(...)
script.remoteServiceModule.fetch(...)               -> script.internetModule.fetch(...)
script.remoteServiceModule.createWebSocket(...)     -> script.internetModule.createWebSocket(...)
script.remoteServiceModule.performHttpRequest(...)  -> script.internetModule.performHttpRequest(...)
script.remoteServiceModule.makeResourceFromUrl(...) -> script.internetModule.makeResourceFromUrl(...)
this.remoteServiceModule.createWebView(...)         -> this.internetModule.createWebView(...)
this.remoteServiceModule.fetch(...)                 -> this.internetModule.fetch(...)
```

### Detailed procedure

1. Replace `//@input Asset.RemoteServiceModule remoteServiceModule` (JS) or `@input remoteServiceModule: RemoteServiceModule` (TS) with the corresponding InternetModule declaration.
2. Replace all `RemoteServiceModule.createWebViewOptions` with `InternetModule.createWebViewOptions`.
3. Replace all instance references: `remoteServiceModule.` with `internetModule.` (covers `script.remoteServiceModule`, `this.remoteServiceModule`, and bare `remoteServiceModule`).
4. If the code uses TypeScript type annotations referencing `RemoteServiceModule`, update those to `InternetModule`.
5. If there are variable declarations like `let rsm = script.remoteServiceModule`, update both the assignment and all subsequent uses of that variable.

### Exception: `createAPIWebSocket`

`createAPIWebSocket(endpoint, params)` stays on `RemoteServiceModule`. It is for Snap authorized
remote services with API spec IDs and has NOT moved to InternetModule.

If found, leave it on `RemoteServiceModule` and keep that input declaration **alongside** the
new `InternetModule` one.

### Check each touched file for orphaned `@input` declarations

A common failure mode of this migration: the user file had **both** an
`@input remoteServiceModule: RemoteServiceModule` and a separately-declared
`private internetModule = require("LensStudio:InternetModule")` (or the same shape under
different names). The `@input` was redundant before — its slot was never actually used
because the `require()` provides the value — but TypeScript still compiled because the
field was a valid typed property. After this migration the `@input` is still there,
still unused, and still **required at runtime**. The Lens will crash on start with:

```
Error: Input remoteServiceModule was not provided for the object <SceneObjectName>
```

This is NOT detectable at compile time. Compile passes; the runtime fails.

**For every file you touched in this migration**, before declaring it done, run this
check on the file:

```bash
grep -nE "@input.*remoteServiceModule" "<file>"
grep -nE "(this|script)\.remoteServiceModule([^a-zA-Z0-9_]|$)" "<file>"
```

- If the first grep returns a hit and the second returns **only** the `@input` line
  itself (or nothing) → the `@input` is orphaned. **Delete the `@input` line.** Use the
  `Edit` tool with enough surrounding context to disambiguate (one line above + one line
  below in `old_string` is usually sufficient).
- Repeat for any other `@input` whose variable name was the original module reference
  (e.g., `@input rsm: RemoteServiceModule`, `@input internet: RemoteServiceModule`).

For the deeper rationale and edge cases (e.g., when the field IS referenced elsewhere
in the file, when it's serialized into scene data), see `orphan-script-inputs.md`
(sibling reference). The runtime check in the skill's later "Runtime Validation" step
also catches these — but doing the check here, on each file as you touch it, avoids the
later loop having to figure out which file the runtime error came from.
