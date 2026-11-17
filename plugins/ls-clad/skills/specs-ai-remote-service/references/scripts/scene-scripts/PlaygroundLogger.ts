// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * SPECS Inc. 2027
 * PlaygroundLogger – holistic user-action logger for the AI Playground lens.
 *
 * Drop this component on any SceneObject. It scans the scene for every SIK
 * Interactable (buttons, orbs, grabbables — anything the user can pinch or
 * poke) and logs each interaction to the console, and optionally to a Text
 * component as a rolling on-screen feed. It rescans periodically so
 * interactables spawned at runtime (e.g. generated 3D objects) get picked up
 * too. No other script needs to be modified.
 *
 * Other scripts can also push custom lines via PlaygroundLogger.instance.log("...").
 */
import {Interactable} from "InteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {Logger} from "Utilities.lspkg/Scripts/Utils/Logger"

@component
export class PlaygroundLogger extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">PlaygroundLogger – holistic user-action logger</span><br/><span style="color: #94A3B8; font-size: 11px;">Auto-discovers every Interactable in the scene and logs user actions to the console and an optional Text.</span>')
  @ui.separator

  @input
  @allowUndefined
  @hint("Optional Text element showing the action feed on screen. Leave empty to log to the console only.")
  private logText: Text

  @input
  @hint("Maximum number of lines kept in the on-screen feed")
  private maxLines: number = 15

  @input
  @hint("Seconds between scene rescans to pick up interactables created at runtime. Set 0 to scan only once at start.")
  private rescanInterval: number = 3

  @input
  @hint("Also log hover enter/exit (noisy — every time the cursor passes over a target)")
  private logHover: boolean = false

  public static instance: PlaygroundLogger = null

  /**
   * Static entry point for other scripts: PlaygroundLogger.log("sent request").
   * Safe to call from anywhere — a silent no-op when no PlaygroundLogger
   * component is present in the scene.
   */
  public static log(message: string): void {
    if (PlaygroundLogger.instance) {
      PlaygroundLogger.instance.log(message)
    }
  }

  private logger: Logger
  private lines: string[] = []
  private subscribed = new Set<Interactable>()
  private rescanEvent: DelayedCallbackEvent = null

  onAwake(): void {
    PlaygroundLogger.instance = this
    this.logger = new Logger("PlaygroundLogger", true, true)
    this.createEvent("OnStartEvent").bind(() => {
      const found = this.scanScene()
      this.log(`Logger ready — watching ${found} interactable${found === 1 ? "" : "s"}`)
      if (this.rescanInterval > 0) {
        this.rescanEvent = this.createEvent("DelayedCallbackEvent")
        this.rescanEvent.bind(() => {
          this.scanScene()
          this.rescanEvent.reset(this.rescanInterval)
        })
        this.rescanEvent.reset(this.rescanInterval)
      }
    })
  }

  /**
   * Appends a timestamped line to the on-screen feed and the console.
   * Public so any other script can call PlaygroundLogger.instance.log("...").
   */
  public log(message: string): void {
    const line = `[${getTime().toFixed(1)}s] ${message}`
    this.logger.info(line)
    if (!this.logText) return
    this.lines.push(line)
    while (this.lines.length > Math.max(1, this.maxLines)) {
      this.lines.shift()
    }
    this.logText.text = this.lines.join("\n")
  }

  /** Walks the whole scene and hooks every Interactable not yet subscribed. */
  private scanScene(): number {
    const count = global.scene.getRootObjectsCount()
    for (let i = 0; i < count; i++) {
      this.scanObject(global.scene.getRootObject(i))
    }
    return this.subscribed.size
  }

  private scanObject(obj: SceneObject): void {
    const interactables = obj.getComponents(Interactable.getTypeName()) as Interactable[]
    for (const interactable of interactables) {
      this.subscribe(interactable, obj)
    }
    for (let i = 0; i < obj.getChildrenCount(); i++) {
      this.scanObject(obj.getChild(i))
    }
  }

  private subscribe(interactable: Interactable, obj: SceneObject): void {
    if (this.subscribed.has(interactable)) return
    this.subscribed.add(interactable)

    const label = this.pathOf(obj)
    interactable.onTriggerStart.add(() => this.log(`Pressed: ${label}`))
    interactable.onTriggerEnd.add(() => this.log(`Released (pinch): ${label}`))
    interactable.onTriggerCanceled.add(() => this.log(`Canceled: ${label}`))
    if (this.logHover) {
      interactable.onHoverEnter.add(() => this.log(`Hover enter: ${label}`))
      interactable.onHoverExit.add(() => this.log(`Hover exit: ${label}`))
    }
  }

  /** Short hierarchy path ("Parent > Object") so identical names stay distinguishable. */
  private pathOf(obj: SceneObject): string {
    return obj.hasParent() ? `${obj.getParent().name} > ${obj.name}` : obj.name
  }
}
