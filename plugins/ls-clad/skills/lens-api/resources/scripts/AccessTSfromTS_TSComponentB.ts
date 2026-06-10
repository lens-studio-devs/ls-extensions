// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * Demonstrates accessing another TypeScript component with full type safety and IntelliSense.
 * Shows the benefits of TypeScript-to-TypeScript communication with compile-time type checking.
 */
import { TSComponentA } from './AccessTSfromTS_TSComponentA';
@component
export class TSComponentB extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">TypeScript Component Reference</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Reference to TSComponentA with full type safety and IntelliSense support</span>')

  // Reference to TSComponentA with proper typing
  @input
  refScript: TSComponentA;

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Debug Settings</span>')

  // Debug flag
  @input
  debug: boolean = true;

  // Track if component is initialized
  private initialized: boolean = false;

  // Helper method for debug logging
  onAwake(): void {
    console.debug("LIFECYCLE: onAwake() - Component initializing");
    this.createEvent("OnStartEvent").bind(() => this.onStart());
  }
  onStart(): void {
    if (!this.refScript) {
      console.log(`[TSComponentB] ${"Error: TSComponentA reference is missing!"}`);
      return;
    }

    this.initialized = true;

    this.refScript.debug = this.debug;
    console.log(`[TSComponentB] ${"Debug settings synchronized with TSComponentA"}`);

    console.log(`[TSComponentB] ${"Number value: " + this.refScript.numberVal}`);
    console.log(`[TSComponentB] ${"String value: " + this.refScript.stringVal}`);
    console.log(`[TSComponentB] ${"Boolean value: " + this.refScript.boolVal}`);
    console.log(`[TSComponentB] ${"Array value: " + JSON.stringify(this.refScript.arrayVal)}`);
    console.log(`[TSComponentB] ${"Object value: " + JSON.stringify(this.refScript.objectVal)}`);

    this.refScript.printHelloWorld();
    console.log(`[TSComponentB] ${"Last called method: " + this.refScript.getLastCalledMethod()}`);

    const info = this.refScript.getComponentInfo();
    console.log(`[TSComponentB] Component info: name=${info.name}, version=${info.version}, lastCalled=${info.lastCalled}`);

    const processedData = this.refScript.processData({ id: 123, name: "Test Data" });
    console.log(`[TSComponentB] Processed data timestamp: ${processedData.timestamp}`);

    const average = this.refScript.calculateAverage(this.refScript.arrayVal);
    console.log(`[TSComponentB] Average of array values: ${average}`);

    console.log(`[TSComponentB] ${"Initial counter: " + this.refScript.getCounter()}`);
    console.log(`[TSComponentB] ${"After increment: " + this.refScript.incrementCounter()}`);
    console.log(`[TSComponentB] ${"After increment by 5: " + this.refScript.incrementCounter(5)}`);
    console.log(`[TSComponentB] ${"After reset: " + this.refScript.resetCounter()}`);
  }

  // Public methods that could be called from elsewhere
  public getComponentInfo(): { name: string; version: number; lastCalled: string } | null {
    if (!this.initialized || !this.refScript) return null;
    return this.refScript.getComponentInfo();
  }

  public incrementCounter(amount: number = 1): number {
    if (!this.initialized || !this.refScript) return 0;
    const newValue = this.refScript.incrementCounter(amount);
    console.log(`[TSComponentB] Counter incremented from TSComponentB: ${newValue}`);
    return newValue;
  }

  public resetCounter(): number {
    if (!this.initialized || !this.refScript) return 0;
    const newValue = this.refScript.resetCounter();
    console.log(`[TSComponentB] Counter reset from TSComponentB: ${newValue}`);
    return newValue;
  }

  // Toggle debug mode for both components
  public toggleDebug(): void {
    this.debug = !this.debug;
    if (this.initialized && this.refScript) {
      this.refScript.debug = this.debug;
      this.refScript.toggleDebug();
    }
    console.log(`[TSComponentB] Debug mode ${this.debug ? 'enabled' : 'disabled'}`);
  }
}
