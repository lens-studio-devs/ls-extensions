// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * TypeScript component that can be accessed from JavaScript code. Demonstrates how to create
 * TypeScript components with methods and properties that are callable from JavaScript scripts.
 */
@component
export class TSComponentA extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Debug Settings</span>')

  // Debug flag
  @input
  debug: boolean = true;

  // Basic properties
  numberVal: number = 1;
  stringVal: string = "Hello from TypeScript";
  boolVal: boolean = true;
  arrayVal: number[] = [1, 2, 3, 4, 5];
  objectVal: Record<string, any> = {
    name: "TSComponentA",
    version: 1.5,
    features: ["typeSafety", "intellisense"]
  };

  // Private state
  private counter: number = 0;

  onAwake(): void {
    console.debug("LIFECYCLE: onAwake() - Component initializing");
    this.createEvent("OnStartEvent").bind(() => this.onStart());
  }
  onStart(): void {
    console.log(`[TSComponentA] ${"TSComponentA initialized"}`);
  }

  // Helper method for debug logging
  // Original method enhanced with debug
  printHelloWorld(): void {
    console.log('Hello, world!');
  }

  // New methods
  getDescription(): string {
    const desc = `TypeScript Component (version ${this.objectVal.version})`;
    console.log(`[TSComponentA] Description requested: ${desc}`);
    return desc;
  }

  // Math operations
  add(a: number, b: number): number {
    const result = a + b;
    console.log(`[TSComponentA] Addition: ${a} + ${b} = ${result}`);
    return result;
  }

  multiply(a: number, b: number): number {
    const result = a * b;
    console.log(`[TSComponentA] Multiplication: ${a} * ${b} = ${result}`);
    return result;
  }

  // Counter methods
  incrementCounter(amount: number = 1): number {
    this.counter += amount;
    console.log(`[TSComponentA] Counter incremented by ${amount} to ${this.counter}`);
    return this.counter;
  }

  resetCounter(): number {
    this.counter = 0;
    console.log(`[TSComponentA] ${"Counter reset to 0"}`);
    return this.counter;
  }

  getCounter(): number {
    return this.counter;
  }

  // Toggle debug mode
  toggleDebug(): void {
    this.debug = !this.debug;
    console.log(`[TSComponentA] Debug mode ${this.debug ? 'enabled' : 'disabled'}`);
  }
}
