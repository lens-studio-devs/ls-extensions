// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * TypeScript component that demonstrates providing methods and properties to other TypeScript components.
 * Shows how to create reusable components with full type safety and IntelliSense support.
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
  stringVal: string = "Hello from TSComponentA";
  boolVal: boolean = true;
  arrayVal: number[] = [10, 20, 30, 40, 50];
  objectVal: Record<string, any> = {
    name: "TSComponentA",
    version: 2.0,
    features: ["strongTyping", "inheritance", "interfaces"]
  };

  // Private state
  private counter: number = 0;
  private lastCalledMethod: string = "";

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
    this.lastCalledMethod = "printHelloWorld";
    console.log('Hello, world!');
  }

  // New methods
  getComponentInfo(): { name: string; version: number; lastCalled: string } {
    this.lastCalledMethod = "getComponentInfo";
    const info = {
      name: this.objectVal.name,
      version: this.objectVal.version,
      lastCalled: this.lastCalledMethod
    };
    console.log(`[TSComponentA] Component info requested: ${JSON.stringify(info)}`);
    return info;
  }

  // Data processing methods
  processData<T>(data: T): { processed: T; timestamp: number } {
    this.lastCalledMethod = "processData";
    const result = {
      processed: data,
      timestamp: Date.now()
    };
    console.log(`[TSComponentA] Data processed: ${JSON.stringify(result)}`);
    return result;
  }

  calculateAverage(numbers: number[]): number {
    this.lastCalledMethod = "calculateAverage";
    if (numbers.length === 0) return 0;
    const sum = numbers.reduce((a, b) => a + b, 0);
    const avg = sum / numbers.length;
    console.log(`[TSComponentA] Calculated average of [${numbers.join(', ')}] = ${avg}`);
    return avg;
  }

  // Counter methods
  incrementCounter(amount: number = 1): number {
    this.lastCalledMethod = "incrementCounter";
    this.counter += amount;
    console.log(`[TSComponentA] Counter incremented by ${amount} to ${this.counter}`);
    return this.counter;
  }

  resetCounter(): number {
    this.lastCalledMethod = "resetCounter";
    this.counter = 0;
    console.log(`[TSComponentA] ${"Counter reset to 0"}`);
    return this.counter;
  }

  getCounter(): number {
    this.lastCalledMethod = "getCounter";
    return this.counter;
  }

  // Get last called method
  getLastCalledMethod(): string {
    return this.lastCalledMethod;
  }

  // Toggle debug mode
  toggleDebug(): void {
    this.debug = !this.debug;
    this.lastCalledMethod = "toggleDebug";
    console.log(`[TSComponentA] Debug mode ${this.debug ? 'enabled' : 'disabled'}`);
  }
}
