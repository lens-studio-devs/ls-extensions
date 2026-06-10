// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// Scoreboard.ts — host-arbitrated two-team scoreboard.
//
// One SyncEntity with two manualInt props. `claimOwnership: true` so the
// first joiner becomes the owner. Any device can call addScore(team, n):
//   - Owner applies the increment directly via setPendingValue.
//   - Non-owner routes through sendEvent("addPoint", { team, delta }) and
//     the owner applies it on receipt. This gives a single-writer guarantee
//     so concurrent additions don't lose updates.
// onAnyChange (not onRemoteChange) repaints the Text on every device,
// including the writer — so the owner's own UI updates.
//
// Place at: Assets/Scripts/Scoreboard.ts, attach to ONE SceneObject under
// "Colocated World [CONFIGURE_ME] / EnableOnReady". Wire redText / blueText
// to the two Text components in the Inspector.

import {StorageProperty} from "SpectaclesSyncKit.lspkg/Core/StorageProperty"
import {StoragePropertySet} from "SpectaclesSyncKit.lspkg/Core/StoragePropertySet"
import {SyncEntity} from "SpectaclesSyncKit.lspkg/Core/SyncEntity"

interface AddPointPayload {
  team: string
  delta: number
}

const ADD_POINT_EVENT = "addPoint"

// Team text colors — match NameTagController's RED / BLUE so the
// scoreboard's "Red: N" / "Blue: N" labels visually match each tag's
// team color in the scene.
const RED = new vec4(1.0, 0.35, 0.35, 1)
const BLUE = new vec4(0.3, 0.55, 1.0, 1)

@component
export class Scoreboard extends BaseScriptComponent {
  // Singleton handle so other scripts (e.g. Collectible) can reach addScore.
  public static instance: Scoreboard | null = null

  @input redText: Text
  @input blueText: Text

  private readonly redScoreProp = StorageProperty.manualInt("redScore", 0)
  private readonly blueScoreProp = StorageProperty.manualInt("blueScore", 0)
  private readonly syncEntity = new SyncEntity(
    this,
    new StoragePropertySet([this.redScoreProp, this.blueScoreProp]),
    true,
    "Session",
  )

  // Per-device local team assignment. Set once by NameTagController.
  private localTeam: string = ""

  onAwake(): void {
    Scoreboard.instance = this

    // Tint the two team labels. Without this the Text components render
    // in default white — same visual whether you scored or not. Null
    // guards mirror the renderRed / renderBlue pattern below.
    if (this.redText) this.redText.textFill.color = RED
    if (this.blueText) this.blueText.textFill.color = BLUE

    this.syncEntity.onEventReceived.add(ADD_POINT_EVENT, (msg) =>
      this.onAddPointReceived(msg),
    )

    this.redScoreProp.onAnyChange.add((v: number) => this.renderRed(v))
    this.blueScoreProp.onAnyChange.add((v: number) => this.renderBlue(v))

    this.syncEntity.notifyOnReady(() => {
      this.renderRed(this.redScoreProp.currentOrPendingValue ?? 0)
      this.renderBlue(this.blueScoreProp.currentOrPendingValue ?? 0)
    })
  }

  public setLocalTeam(team: string): void {
    this.localTeam = team
  }

  public getLocalTeam(): string {
    return this.localTeam
  }

  public addScore(team: string, delta: number): void {
    if (this.syncEntity.doIOwnStore()) {
      this.applyAddScore(team, delta)
    } else {
      this.syncEntity.sendEvent(ADD_POINT_EVENT, {team, delta})
    }
  }

  private onAddPointReceived(msg: {data?: unknown}): void {
    if (!this.syncEntity.doIOwnStore()) return
    const data = msg.data as AddPointPayload | undefined
    if (!data || typeof data.team !== "string") return
    this.applyAddScore(data.team, data.delta ?? 1)
  }

  private applyAddScore(team: string, delta: number): void {
    if (team === "red") {
      this.redScoreProp.setPendingValue(
        (this.redScoreProp.currentOrPendingValue ?? 0) + delta,
      )
    } else if (team === "blue") {
      this.blueScoreProp.setPendingValue(
        (this.blueScoreProp.currentOrPendingValue ?? 0) + delta,
      )
    }
  }

  private renderRed(value: number): void {
    if (this.redText) this.redText.text = "Red: " + value
  }

  private renderBlue(value: number): void {
    if (this.blueText) this.blueText.text = "Blue: " + value
  }
}
