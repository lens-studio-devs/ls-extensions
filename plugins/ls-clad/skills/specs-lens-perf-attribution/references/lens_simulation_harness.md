<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Lens simulation/exerciser harness patterns

Use these patterns only when the project cannot naturally exercise all components in Preview.

## Principles

- Make the smallest reversible change that triggers the real project code path.
- Keep the Lens runnable in normal mode.
- Store harness code in `Assets/`, never `Cache/`.
- Prefer Lens API scripts for runtime behavior; follow the `/lens-studio-field-notes` Hard Rules for scene edits and Editor API delegation.
- Save original enabled states and script input values before changing them.
- Confirm harness behavior with logs/visual output before taking traces.

## Common trigger strategies

1. **Existing debug path:** use a public method, custom trigger, behavior script, timeout, or exposed input already present.
2. **Simulation script:** add a script that waits a short time, logs a marker, then calls the same method/trigger the real input would call.
3. **State toggles:** temporarily enable one subsystem root at a time over a stable baseline.
4. **Input proxies:** for voice/gesture/body/world interactions, simulate the final semantic event (e.g. “keyword heard”, “pinch began”, “body found”) rather than mocking the whole sensor stack, unless the sensor stack itself is being measured.
5. **Fallback timers:** if the trigger is hard to simulate, add a short debug timeout that fires the effect once; restore the original timeout after profiling.

## TypeScript harness skeleton

Adapt names and calls to the project. This is intentionally generic.

```ts
@component
export class PerfAttributionHarness extends BaseScriptComponent {
  @input enabledForProfiling: boolean = false;
  @input delaySeconds: number = 1.0;
  @input repeatSeconds: number = 0.0;
  @input targetScript: ScriptComponent;
  @input triggerFunctionName: string = "trigger";

  private delayedEvent: DelayedCallbackEvent | null = null;
  // Runtime-mutable delay; initialized from the @input but never overwrites it,
  // so the inspector value stays intact across repeats.
  private currentDelay: number = this.delaySeconds;

  onAwake(): void {
    if (!this.enabledForProfiling) {
      return;
    }
    this.currentDelay = this.delaySeconds;
    print(`[PerfHarness] armed; delay=${this.delaySeconds}s trigger=${this.triggerFunctionName}`);
    this.schedule();
  }

  private schedule(): void {
    if (!this.delayedEvent) {
      this.delayedEvent = this.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
      this.delayedEvent.bind(() => this.fire());
    }
    this.delayedEvent.reset(this.currentDelay);
  }

  private fire(): void {
    print(`[PerfHarness] firing ${this.triggerFunctionName}`);
    const anyTarget = this.targetScript as any;
    const name = this.triggerFunctionName;
    // Try the function on the instance first, then fall back to the public
    // `.api` object (many JS/legacy scripts expose their API only via `.api`).
    // Bind `this` to whichever object the function was actually found on —
    // calling an `.api` method with the instance as `this` is wrong.
    const owner =
      anyTarget && typeof anyTarget[name] === "function"
        ? anyTarget
        : anyTarget && anyTarget.api && typeof anyTarget.api[name] === "function"
          ? anyTarget.api
          : null;
    if (owner) {
      const fn = owner[name];
      fn.call(owner);
    } else {
      print(`[PerfHarness] missing function: ${name}`);
    }

    if (this.repeatSeconds > 0) {
      this.currentDelay = this.repeatSeconds;
      this.schedule();
    }
  }
}
```

If TypeScript dynamic method calls are not accepted by the project's compiler settings, replace the dynamic call with an explicit typed reference to the target component and a concrete method call.

## Validation checklist

- The harness compiles.
- Preview logs show the harness marker.
- The expected visual/audio/interaction effect occurs.
- The effect still works with the intended Preview mode/input source.
- The harness can be disabled or removed cleanly after capture.
