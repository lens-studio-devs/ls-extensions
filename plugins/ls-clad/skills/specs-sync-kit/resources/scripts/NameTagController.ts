// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// NameTagController.ts — per-tag controller, attached to the prefab leaf.
//
// Pattern: every device reads displayName + team color from the prefab's
// NetworkRootInfo (customDataStore + ownerInfo). No StorageProperty sync
// is used for name/color — both pieces of data are baked in once at spawn
// time and replicated as part of the prefab instantiation. This avoids
// the auto-property thrashing bug that fires when forTextText / autoVec4
// poll on a shared SyncEntity that has no owner (SyncTransform constructs
// its SyncEntity with claimOwnership:false, so every device's auto-poll
// broadcasts and last-write-wins clobbers the spawner's intended value).
// See SKILL.md §10 for the correct `forTextText` pattern when you DO need
// mutable synced text.
//
// Position is still synced via SyncTransform on the prefab — that's the
// SyncEntity this script shares for `notifyOnReady` (so we wait until the
// network root is wired up before reading its dataStore / ownerInfo).
//
// Prefab requirements:
//   - Text component (wired to userNameText @input below)
//   - SyncTransform (Sync Settings: Position = Location, Rotation = Location)
//     — provides the SyncEntity that this script shares.
//   - This script
//
// Spawner contract (see NameTagSpawner.ts): the spawning device puts
// "displayName" and "connectionId" into the customDataStore on the
// `instantiator.instantiate(...)` options. Both values are required by
// the logic below.
//
// Construction and lookup happen in OnStartEvent (not onAwake) because
// sibling-component awake order is undefined — the SyncTransform's
// SyncEntity may not exist yet during this script's onAwake.

import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {SessionController} from "SpectaclesSyncKit.lspkg/Core/SessionController"
import {SyncEntity} from "SpectaclesSyncKit.lspkg/Core/SyncEntity"
import {Scoreboard} from "./Scoreboard"

const RED = new vec4(1.0, 0.35, 0.35, 1)
const BLUE = new vec4(0.3, 0.55, 1.0, 1)
const EVENT_PRESENCE = "presence"

@component
export class NameTagController extends BaseScriptComponent {
  @input userNameText: Text

  private cameraTransform: Transform =
    WorldCameraFinderProvider.getInstance().getTransform()

  private syncEntity: SyncEntity
  // Presence handshake — connections we've heard from. Handles late joiners:
  // sendEvent doesn't replay history, so each pane re-broadcasts when it hears
  // a NEW peer (guarded against the synchronous self-echo — SKILL.md §6.7) and
  // every tag converges on the same set. getUsers() sorted by connectionId
  // works too (it reports the live user count); this makes convergence explicit.
  private readonly presenceConns = new Set<string>()
  private presenceBroadcasted = false

  onAwake(): void {
    // Defer to OnStartEvent so SyncTransform's SyncEntity is guaranteed
    // to exist before we look it up.
    this.createEvent("OnStartEvent").bind(() => this.init())
  }

  private init(): void {
    // Share SyncTransform's SyncEntity instead of creating a new one.
    this.syncEntity = SyncEntity.getSyncEntityOnSceneObject(this.sceneObject)
    if (!this.syncEntity) {
      print("[NameTagController] no SyncEntity found on SceneObject — ensure SyncTransform is attached.")
      return
    }

    this.syncEntity.notifyOnReady(() => this.onReady())
  }

  private onReady(): void {
    const root = this.syncEntity.networkRoot
    if (!root) {
      print("[NameTagController] no networkRoot on syncEntity — skipping.")
      return
    }

    // Name: baked once into customDataStore at spawn time by NameTagSpawner,
    // replicated to every peer as part of NetworkRootInfo. No race, no
    // thrash — every device just reads the same value.
    const displayName = root.dataStore?.getString("displayName") || "Unknown User"
    this.userNameText.text = displayName

    // Local-only: head-follow each frame. Remote peers receive transform
    // via SyncTransform on the prefab leaf.
    if (root.locallyCreated) {
      this.createEvent("UpdateEvent").bind(() => {
        this.sceneObject
          .getTransform()
          .setWorldPosition(this.cameraTransform.getWorldPosition())
        this.sceneObject
          .getTransform()
          .setWorldRotation(this.cameraTransform.getWorldRotation())
      })
    }

    // Team = owner's index in the sorted set of connections, via a presence
    // handshake that converges for late joiners (sendEvent doesn't replay —
    // SKILL.md §6.7). Each pane broadcasts its own
    // getLocalConnectionId() on this prefab's shared SyncEntity and collects
    // received ids; every pane runs every tag's controller, so each tag's set
    // converges to the full connection set. The team recomputes as ids
    // arrive (lone first joiner is index 0 → "red", then re-resolves once the
    // peer's presence lands). We never remove on leave, preserving the
    // sticky-team invariant (SKILL.md §10 churn caveat).
    this.syncEntity.onEventReceived.add(EVENT_PRESENCE, (msg) =>
      this.onPresenceReceived(msg as {data?: {connId?: string}}),
    )
    const myConn = SessionController.getInstance().getLocalConnectionId()
    if (myConn) this.presenceConns.add(myConn)
    this.broadcastPresence()
    this.applyTeamFromPresence()
  }

  private broadcastPresence(): void {
    const myConn = SessionController.getInstance().getLocalConnectionId()
    if (!myConn) return
    this.syncEntity.sendEvent(EVENT_PRESENCE, {connId: myConn})
    this.presenceBroadcasted = true
  }

  private onPresenceReceived(msg: {data?: {connId?: string}}): void {
    const connId = msg.data?.connId
    if (!connId || this.presenceConns.has(connId)) return
    this.presenceConns.add(connId)
    this.applyTeamFromPresence()
    // Re-announce so a peer that just appeared also learns OUR id —
    // sendEvent doesn't replay history.
    if (this.presenceBroadcasted) this.broadcastPresence()
  }

  // Recompute team color from the presence set and (for the local tag)
  // update Scoreboard.setLocalTeam so pickups credit the right side. Owner
  // is identified by `networkRoot.ownerInfo.connectionId` with a fallback to
  // the connectionId baked into customDataStore by the spawner. Returns early
  // if the owner's presence hasn't arrived yet; the next presence event retries.
  private applyTeamFromPresence(): void {
    const root = this.syncEntity?.networkRoot
    if (!root) return

    const ownerConnectionId =
      root.ownerInfo?.connectionId ||
      root.dataStore?.getString("connectionId") ||
      ""
    if (!ownerConnectionId) return

    const sorted = Array.from(this.presenceConns)
      .filter((c) => !!c)
      .sort((a, b) => a.localeCompare(b))
    const ownerIndex = sorted.indexOf(ownerConnectionId)
    if (ownerIndex === -1) return // owner's presence not received yet

    const team = ownerIndex % 2 === 0 ? "red" : "blue"
    this.userNameText.textFill.color = team === "red" ? RED : BLUE

    if (root.locallyCreated) {
      Scoreboard.instance?.setLocalTeam(team)
    }
  }
}
