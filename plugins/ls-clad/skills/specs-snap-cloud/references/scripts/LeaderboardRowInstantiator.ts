// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * Instantiates a pool of row prefabs under its scene object, positions them (startPosition + step × index),
 * and binds leaderboard data via each row's bind(entry). Call render(entries) to update visible rows.
 */
import { assert } from "SnapDecorators.lspkg/assert";
import { Logger } from "Utilities.lspkg/Scripts/Utils/Logger";
import { LeaderboardEntryUI } from "./LeaderboardRowItem";
import { GlobalLeaderboard } from "./GlobalLeaderboard";

@component
export class LeaderboardRowInstantiator extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA; font-weight: bold;">Row pool</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Prefab and row count. Place this object under ScrollWindow content.</span>')
  @input
  @hint("The prefab object that will be instantiated for each row.")
  itemPrefab!: ObjectPrefab;

  @input
  @hint("Assign GlobalLeaderboard to use its itemsCount; otherwise uses itemsCount input.")
  @allowUndefined
  globalLeaderboard?: GlobalLeaderboard;

  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Number of rows when globalLeaderboard is not set</span>')
  @input
  @hint("Number of rows when globalLeaderboard is not set; otherwise use globalLeaderboard's itemsCount.")
  itemsCount: number = 10;

  @ui.separator
  @ui.label('<span style="color: #60A5FA; font-weight: bold;">Position</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Local space (same units as ScrollWindow). First row position and step per row.</span>')
  @input
  @hint("First row local position")
  startPosition: vec3 = new vec3(-10, 0, 0);

  @input
  @hint("Position step per row")
  step: vec3 = new vec3(-4, 0, 0);

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Logging Configuration</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Control logging output for this script instance</span>')

  @input
  @hint("Enable general logging (row creation, bind calls, etc.)")
  enableLogging: boolean = false;

  @input
  @hint("Enable lifecycle logging (onAwake, onStart, onUpdate, onDestroy, etc.)")
  enableLoggingLifecycle: boolean = false;

  private logger: Logger;
  /** Row scene objects (one per pool slot). */
  private leaderboardItems: SceneObject[] = [];

  /** Script component with bind(entry) per row (e.g. LeaderboardRowItem). */
  private binders: Array<{ bind: (entry: LeaderboardEntryUI) => void } | null> = [];

  /** Initializes logger, validates itemPrefab, and creates row pool. Called when component is created. */
  onAwake(): void {
    this.logger = new Logger("LeaderboardRowInstantiator", this.enableLogging || this.enableLoggingLifecycle, true);
    if (this.enableLoggingLifecycle) {
      this.logger.debug("LIFECYCLE: onAwake() - LeaderboardRowInstantiator initializing");
    }
    assert(this.itemPrefab != null, "itemPrefab must be assigned");
    if (this.enableLogging) {
      this.logger.info("Initializing leaderboard rows");
    }
    this.createRows();
  }

  /** Single source: from GlobalLeaderboard when assigned, otherwise local itemsCount. */
  private getEffectiveItemsCount(): number {
    return (this.globalLeaderboard != null && this.globalLeaderboard.itemsCount != null)
      ? this.globalLeaderboard.itemsCount
      : this.itemsCount;
  }

  /**
   * Create a fixed pool of row objects once.
   */
  private createRows(): void {
    const count = this.getEffectiveItemsCount();
    if (this.enableLogging) {
      this.logger.info("Creating leaderboard rows (count=" + count + ")");
    }

    // Clear any existing rows
    this.leaderboardItems.forEach(item => {
      if (item) {
        item.destroy();
      }
    });
    this.leaderboardItems = [];
    this.binders = [];

    if (!this.itemPrefab) {
      this.logger.error("itemPrefab not assigned");
      return;
    }

    for (let i = 0; i < count; i++) {
      if (this.enableLogging) {
        this.logger.debug("Creating row " + (i + 1) + " of " + count);
      }

      const rowObj = this.itemPrefab.instantiate(this.getSceneObject());
      const rowTransform = rowObj.getTransform();
      const pos = new vec3(
        this.startPosition.x + this.step.x * i,
        this.startPosition.y + this.step.y * i,
        this.startPosition.z + this.step.z * i
      );
      rowTransform.setLocalPosition(pos);

      const binder = this.findBinder(rowObj);
      this.binders.push(binder);

      // Disable by default until render() provides data
      rowObj.enabled = false;

      this.leaderboardItems.push(rowObj);
    }

    if (this.enableLogging) {
      this.logger.info("Row pool created: " + this.leaderboardItems.length);
    }
  }

  /**
   * Public API: Update existing pooled rows with entries, hide unused slots.
   */
  render(entries: LeaderboardEntryUI[]): void {
    if (!entries) return;

    if (this.leaderboardItems.length === 0) {
      this.createRows();
    }

    const countToShow = Math.min(entries.length, this.leaderboardItems.length);

    // Show + bind rows that have data
    for (let i = 0; i < countToShow; i++) {
      const rowObj = this.leaderboardItems[i];
      const binder = this.binders[i];

      if (binder && typeof binder.bind === "function") {
        binder.bind(entries[i]);
      } else {
        this.logger.warn("row prefab missing bind(entry) on its row script");
      }

      rowObj.enabled = true;

      if (this.enableLogging) {
        const entry = entries[i];
        this.logger.debug("bound row " + i +
          " rank=" + entry.rank +
          " displayname=" + (entry.displayname ?? "n/a") +
          " score=" + entry.score);
      }
    }

    // Hide remaining pooled rows
    for (let i = countToShow; i < this.leaderboardItems.length; i++) {
      this.leaderboardItems[i].enabled = false;
    }

    if (this.enableLogging) {
      this.logger.debug("rendered " + countToShow + " rows (pool size " + this.leaderboardItems.length + ")");
    }
  }

  /** Returns the first script on the row that has a bind(entry) method. */
  private findBinder(obj: SceneObject): { bind: (entry: LeaderboardEntryUI) => void } | null {
    const comps = obj.getComponents("Component.ScriptComponent");
    for (let i = 0; i < comps.length; i++) {
      const scriptComponent = comps[i] as { bind?: (entry: LeaderboardEntryUI) => void };
      if (typeof scriptComponent.bind === "function") return scriptComponent as { bind: (entry: LeaderboardEntryUI) => void };
    }
    return null;
  }
}
