<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Lens Studio TypeScript — Scripting Debug

General script-side debugging that applies to **any** Lens target. For Specs-subsystem bugs (SIK, RSG, SyncKit, SnapML), see `ls-clad:specs-debug`. For reading log output, see `ls-clad:lens-log-analysis`. For performance work, see `references/performance.md`.

## Compile-time TypeScript errors

| Error | Likely cause | Fix |
|---|---|---|
| `Cannot find module '<X>.lspkg/...'` | Package not in `Packages/` folder | Add the `.lspkg` package to the project's `Packages/` directory |
| `Property X does not exist on type Y` | Wrong component type or missing cast | Re-check the `getComponent('Component.<Name>')` string; cast through `unknown` when bridging to a custom TS class |
| `Object is possibly undefined` | Missing null check on `@input` or `getComponent` result | Guard with `if (!this.x) return` at the top of the consuming method |
| `@component is not recognized` / decorator unknown | Lens Studio globals not in `tsconfig.json` lib | Verify `tsconfig.json` includes the Lens Studio globals reference |

## Runtime errors (Lens Studio console)

| Error | Likely cause | Fix |
|---|---|---|
| `Cannot read property 'X' of undefined` | `@input` not connected in Inspector | Validate all `@input` fields at the top of `onStart()` — see "@input validation" below |
| `X is not a function` | Wrong component type fetched | Verify the type string in `getComponent('Component.<Name>')` |
| `Script component not found` | Script not attached to the scene object | Attach the script in the Scene Hierarchy |

## @input validation

Always validate at the top of `onStart()`. Use `console.error` so the failure is filterable in the log viewer (lands under severity `E`):

```typescript
private onStart(): void {
  if (!this.targetObject) {
    console.error('MyComponent: targetObject is not assigned in the Inspector')
    return
  }
  if (!this.audioComponent) {
    console.error('MyComponent: audioComponent reference missing')
    return
  }
}
```

Validate in `onStart`, not `onAwake` — see § "Event subscription timing" below for why cross-object access is unsafe during `onAwake`.

## Verify component fetch

```typescript
// Lens API form — type string with 'Component.' prefix
const audio = this.sceneObject.getComponent('Component.AudioComponent')
if (!audio) {
  console.error('MyComponent: no AudioComponent on ' + this.sceneObject.name)
  return
}

// TS-to-TS form — use the class's getTypeName()
const helper = obj.getComponent(MyHelper.getTypeName()) as unknown as MyHelper
if (!helper) {
  console.error('MyComponent: no MyHelper component found on ' + obj.name)
  return
}
```

See `references/component-access-patterns.md` for the full set of access patterns.

## Event subscription timing

Phase order, per-event firing rules, and ordering guarantees are documented on the event classes themselves — see `OnAwakeEvent`, `OnStartEvent`, `UpdateEvent`, `LateUpdateEvent`, `DelayedCallbackEvent` in the Lens Studio API reference. Notably: `OnAwake` runs in hierarchy order; `OnStart` order across siblings is **not** guaranteed. Below: debugging patterns that aren't in those class docs.

### Bind in `onAwake`, defer the work to a later phase

Events don't replay. Bind in `onAwake` so the binding exists before any of `OnStartEvent` / `UpdateEvent` / etc. fires; do the actual work inside the handler. Binding from `onStart`, a `DelayedCallbackEvent`, or runtime-attached code can miss one-shot events that already fired.

```typescript
onAwake(): void {
  this.createEvent('OnStartEvent').bind(() => this.onStart())
  this.createEvent('UpdateEvent').bind(() => this.onUpdate())
}
```

For a component added or enabled *mid-session*, any one-shot event from before its construction is unreachable. If a late-attached component needs to react, drive it with a custom signal from a long-lived owner, not a built-in one-shot.

**Prefab instantiation caveat:** the new components get their own full lifecycle (top-level code runs ≈`onAwake`, then `OnStartEvent` fires for them). The "missed event" rule applies to binding a *new handler* to a component whose `OnStartEvent` has already fired — not to a fresh instance.

```javascript
// Script inside a prefab. Both lines print when the prefab is instantiated.
print('onAwake fired')
script.createEvent('OnStartEvent').bind(() => print('onStart fired'))
```

### Use `onStart` when work depends on other components

`@input` and cross-`SceneObject` `getComponent` calls are unsafe in `onAwake` (the other side may not have initialized yet). Defer to `onStart` — every component has finished `onAwake` by then.

```typescript
onAwake(): void {
  this.createEvent('OnStartEvent').bind(() => this.onStart())
}

private onStart(): void {
  const helper = this.otherObject.getComponent(MyHelper.getTypeName()) as unknown as MyHelper
  helper.doSomething()
}
```

For dynamic dependencies (async data, runtime-built scenes), have the consumer subscribe to a custom event the producer raises when ready, instead of guessing phase order.

### `DelayedCallbackEvent` is a last resort for sequencing

It papers over a missing dependency with a guess at how long to wait. Reach for it only when hierarchy + phase ordering can't represent what you need; time-based delays are unreliable.

### `LateUpdateEvent` for "after all updates, before render"

Use it when a per-frame body needs to read state other components produced in their `UpdateEvent` — typical for any reader/follower of per-frame writes.

```typescript
onAwake(): void {
  this.createEvent('LateUpdateEvent').bind(() => this.onLateUpdate())
}
```

## Event handler leaks

Anything you subscribe on a *different* object outlives this component's `onDestroy`. Unsubscribe explicitly:

```typescript
onAwake(): void {
  const handler = (data: unknown) => this.handleData(data)
  this.other.onSomething.add(handler)

  this.createEvent('OnDestroyEvent').bind(() => {
    this.other.onSomething.remove(handler)
  })
}
```

Arrow callbacks bound inline cannot be removed — keep a named reference if you'll need to unsubscribe.

## See also

- `lens-api` SKILL.md — `console.*` Logging section, lifecycle reference, scene queries
- `ls-clad:lens-log-analysis` — reading and analyzing `console.*` output (severity prefixes, partitioning)
- `references/performance.md` — frame-rate drops, allocations, profiling
- `references/component-access-patterns.md` — TS-to-TS, TS-to-JS, `@typename` patterns
- `ls-clad:specs-debug` — SIK / RSG / SyncKit / SnapML subsystem debugging
