<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Lens Studio TypeScript — Component Cross-Access Patterns

Sourced from `Essentials/Assets/AccessComponents/` and Lens Studio's [Accessing TypeScript from TypeScript](https://developers.snap.com/lens-studio/features/scripting/accessing-components#accessing-typescript-from-typescript) docs.

## TS-to-TS via `@input` (preferred)

Declare the `@input` typed as the target class — Lens Studio resolves the wired ScriptComponent to the underlying instance at runtime. No `.getScript()`, no cast.

```typescript
// ComponentA.ts
@component
export class ComponentA extends BaseScriptComponent {
  getValue(): number { return 42 }
}

// ComponentB.ts
import { ComponentA } from './ComponentA'

@component
export class ComponentB extends BaseScriptComponent {
  @input refScript!: ComponentA   // wire the target's ScriptComponent in the inspector

  onAwake() {
    print('Got value: ' + this.refScript.getValue())   // direct call, no cast
  }
}
```

## TS-to-TS via `getComponent` (when there is no `@input` wired)

When you must look the component up at runtime, a single `as ComponentA` is enough — drop the `unknown` step.

```typescript
import { ComponentA } from './ComponentA'

@component
export class ComponentB extends BaseScriptComponent {
  @input otherObject!: SceneObject

  onAwake() {
    this.createEvent('OnStartEvent').bind(() => {
      const a = this.otherObject.getComponent(
        ComponentA.getTypeName()
      ) as ComponentA
      console.log('Got value: ' + a.getValue())
    })
  }
}
```

## TS-to-JS (accessing a JS component from TS)

### Option A — Declaration file
Create `MyJSComponent.d.ts`:
```typescript
declare class MyJSComponent {
  myMethod(): void
  myValue: number
}
```
Then in TS:
```typescript
const jsComp = this.sceneObject.getComponent('ScriptComponent') as unknown as MyJSComponent
jsComp.myMethod()
```

### Option B — No declaration (unsafe cast)
```typescript
const jsComp: any = childObject.getComponent('ScriptComponent')
jsComp.myMethod()
```

## Accessing a component on a child SceneObject

```typescript
// Essentials/Assets/AccessComponents/AccessComponentOnChildSceneObject
@component
export class AccessChildComponent extends BaseScriptComponent {
  @input targetChild: SceneObject

  onAwake() {
    this.createEvent('OnStartEvent').bind(() => {
      // By component type string
      const audio = this.targetChild.getComponent('Component.AudioComponent')

      // Or iterate children to find by name
      const count = this.sceneObject.getChildrenCount()
      for (let i = 0; i < count; i++) {
        const child = this.sceneObject.getChild(i)
        if (child.name === 'AudioChild') {
          const a = child.getComponent('Component.AudioComponent')
          a?.play(1)
        }
      }
    })
  }
}
```

## `require` pattern for built-in Lens Studio modules

```typescript
// Always use require for LensStudio: prefixed modules
const WorldQueryModule = require('LensStudio:WorldQueryModule')
const asrModule = require('LensStudio:AsrModule')
const ttsModule = require('LensStudio:TtsModule')
const bleModule = require('LensStudio:BleModule')
const locationModule = require('LensStudio:LocationModule')
```

## Dynamic loading with `requireType`

Load a TypeScript component class by path at runtime — useful when the class isn't statically importable:

```typescript
@component
export class DynamicAccess extends BaseScriptComponent {
  @input targetObject: SceneObject

  onAwake() {
    this.createEvent('OnStartEvent').bind(() => {
      const typeName = requireType('./CustomComponentTS')
      const component = this.targetObject.getComponent(typeName)
      ;(component as any)?.doSomething()
    })
  }
}
```

## `getAllComponents` — multiple instances on one object

```typescript
const allScripts = obj.getAllComponents('Component.ScriptComponent')
for (const s of allScripts) { /* ... */ }
```

## Register a custom TS component type for Inspector use (`@typename`)

To make a custom TypeScript component selectable in the Inspector by its *own* type name (e.g., `@input('CustomComponentTS')` instead of `@input('Component.ScriptComponent')`), register it with `@typename`:

```typescript
@component
export class AccessByTypename extends BaseScriptComponent {
  // Declare the type — registers `CustomComponentTS` as an Inspector-selectable type
  @typename
  CustomComponentTS: keyof ComponentNameMap

  // Now Inspector accepts only CustomComponentTS instances
  @input('CustomComponentTS')
  customComponent: any
}
```

The `@typename` declaration extends `ComponentNameMap` at compile time. After that, `@input('CustomComponentTS')` filters the Inspector slot to only accept components of that class. The field type is `any` because Inspector binding is dynamic; cast at use sites if you want static typing (`(this.customComponent as CustomComponentTS).method()`).

## `@input` typed against a `declare class` (TS-to-JS, IntelliSense)

```typescript
// Declare the JS shape once
declare class JSComponentA extends ScriptComponent {
  add(a: number, b: number): number
}

@component
export class MyScript extends BaseScriptComponent {
  @input('Component.ScriptComponent')
  refScript: JSComponentA

  onAwake() {
    this.createEvent('OnStartEvent').bind(() => {
      const result = this.refScript.add(5, 3)
    })
  }
}
```

The `@input('Component.ScriptComponent')` argument tells Lens Studio which component type to expose in the Inspector slot, while the TypeScript-side type provides IntelliSense.

## Generic component with type parameters (TS feature)

From `AccessTSfromTS_TSComponentA.ts`:
```typescript
// Generic method — TS supports it even in Lens Studio
processData<T>(data: T): { processed: T; timestamp: number } {
  return { processed: data, timestamp: Date.now() }
}

// Caller
const result = componentA.processData<string>('hello')
console.log(result.processed) // 'hello'
```

## Runnable end-to-end examples

For complete attachable `@component` classes demonstrating each pattern above, see this skill's sibling `resources/scripts/` folder — `Access*TS.ts` and `CustomComponentTS.ts`.
