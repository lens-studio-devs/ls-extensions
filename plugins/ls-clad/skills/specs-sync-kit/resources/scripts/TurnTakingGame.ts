// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// TurnTakingGame.ts — turn-taking game controller (3x3 grid example).
//
// Single SyncEntity (claimOwnership: true → first joiner becomes the
// authoritative owner) holds:
//   - gameGrid: manualString — serialized 9-char board, " " = empty,
//     "X" or "O" = piece.
//   - xScore, oScore: manualInt — per-symbol running scores.
//
// Player assignment uses a PRESENCE HANDSHAKE: each pane broadcasts its
// getLocalConnectionId() via sendEvent("presence") when its SyncEntity is
// ready and collects received ids into a Set. Roles are the sorted set's
// first two ids (idx 0 → "X", idx 1 → "O"; idx >= 2 → spectator). The
// handshake handles LATE JOINERS: sendEvent does not replay history, so a
// pane that joins later wouldn't otherwise learn the earlier panes' ids —
// each pane re-broadcasts when it hears a NEW peer (guarded against the
// synchronous self-echo, see SKILL.md §6.7) so every pane converges on the
// same set. getUsers() sorted by connectionId works too (it reports the live
// user count); the handshake just makes late-joiner convergence explicit.
// Turn is computed from the grid itself — count of X's vs O's tells
// you whose move is next. Win detection runs in onAnyChange.
//
// Write routing (critical):
//   - Owner applies setPendingValue directly.
//   - Non-owner routes moves through sendEvent("placeMove", {cellIndex,
//     player}) to the owner, who validates + applies.
// This single-writer pattern is the same as Scoreboard.ts — without it,
// only the owner could place pieces (non-owner setPendingValue is
// silently dropped per resources/docs/storage-properties.mdx).
//
// Networked events:
//   - "start" / "restart" — game-flow control (any player can send).
//   - "placeMove" — non-owner relays a move to the owner.
//
// Caveat: the presence handshake converges for late joiners but NOT for
// two-pane sticky-session churn — refreshing ONE pane while the other stays connected
// can leave a stale connId in the set (see SKILL.md §10 sticky-session
// pitfall). Reset BOTH panes together when iterating. For full robustness
// under real mid-session leaves/rejoins, route assignment through a
// host-owned slot registry instead.
//
// Place at: Assets/Scripts/TurnTakingGame.ts, attach to a SceneObject
// under "Colocated World [CONFIGURE_ME] / EnableOnReady". The Text
// inputs render turn / winner / scores ONLY — this is a CONTROLLER and
// does NOT draw the X/O marks on the board cells. To display the board,
// add an `@input cellTexts: Text[]` (one per cell) and set
// `cellTexts[i].text` from `grid[i]` inside onGridChanged(); without it
// the grid syncs across panes but the cells stay blank.

import {SessionController} from "SpectaclesSyncKit.lspkg/Core/SessionController"
import {StorageProperty} from "SpectaclesSyncKit.lspkg/Core/StorageProperty"
import {StoragePropertySet} from "SpectaclesSyncKit.lspkg/Core/StoragePropertySet"
import {SyncEntity} from "SpectaclesSyncKit.lspkg/Core/SyncEntity"

const GRID_SIZE = 9
const EMPTY = " "
const EVENT_RESTART = "restart"
const EVENT_PLACE_MOVE = "placeMove"
const EVENT_PRESENCE = "presence"

type Player = "X" | "O" | ""

interface PlaceMovePayload {
  cellIndex: number
  player: Player
}

const WIN_LINES: number[][] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
  [0, 4, 8], [2, 4, 6],             // diagonals
]

@component
export class TurnTakingGame extends BaseScriptComponent {
  @input turnText: Text
  @input winnerText: Text
  @input xScoreText: Text
  @input oScoreText: Text

  private readonly gridProp = StorageProperty.manualString("gameGrid", EMPTY.repeat(GRID_SIZE))
  private readonly xScoreProp = StorageProperty.manualInt("xScore", 0)
  private readonly oScoreProp = StorageProperty.manualInt("oScore", 0)
  private readonly syncEntity = new SyncEntity(
    this,
    new StoragePropertySet([this.gridProp, this.xScoreProp, this.oScoreProp]),
    true,
    "Session",
  )

  private localPlayer: Player = ""
  private isGameOver = false
  // Presence handshake — connections we've heard from (handles late joiners).
  private readonly presenceConns = new Set<string>()
  private presenceBroadcasted = false

  onAwake(): void {
    this.syncEntity.onEventReceived.add(EVENT_RESTART, () => this.onRestartReceived())
    this.syncEntity.onEventReceived.add(EVENT_PLACE_MOVE, (msg) =>
      this.onPlaceMoveReceived(msg as {data?: PlaceMovePayload}),
    )
    this.syncEntity.onEventReceived.add(EVENT_PRESENCE, (msg) =>
      this.onPresenceReceived(msg as {data?: {connId?: string}}),
    )

    this.gridProp.onAnyChange.add((g: string) => this.onGridChanged(g))
    this.xScoreProp.onAnyChange.add(() => this.renderScores())
    this.oScoreProp.onAnyChange.add(() => this.renderScores())

    this.syncEntity.notifyOnReady(() => this.onReady())
  }

  private onReady(): void {
    // Register self, announce, then resolve role from the presence set.
    const myConn = SessionController.getInstance().getLocalConnectionId()
    if (myConn) this.presenceConns.add(myConn)
    this.broadcastPresence()

    this.renderScores()
    this.recomputeLocalPlayer() // sets localPlayer and renders turn/board
    // No explicit kick-off event — the game implicitly starts when X
    // makes the first move. A "Player O kicks off on join" send-event
    // would race the late-joiner's first state replication: if O's
    // notifyOnReady fires before X's existing move has replicated,
    // currentOrPendingValue is null, the empty-grid fallback fires
    // the kick-off, and a board-clearing handler on the owner would
    // wipe X's move. The restart() button covers the only legitimate
    // case for re-seeding an empty board.
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
    this.recomputeLocalPlayer()
    // Re-announce so the peer that just appeared also learns OUR id —
    // sendEvent doesn't replay history, so a late joiner missed our
    // original broadcast.
    if (this.presenceBroadcasted) this.broadcastPresence()
  }

  // Resolve X/O from the sorted presence set (idx 0 → X, idx 1 → O,
  // idx >= 2 → spectator). Re-runs as presence ids arrive, so the lone
  // first joiner is "X" against its own id, then re-resolves once the
  // peer's id lands.
  private recomputeLocalPlayer(): void {
    const myConn = SessionController.getInstance().getLocalConnectionId()
    if (!myConn) {
      this.localPlayer = ""
    } else {
      const sorted = Array.from(this.presenceConns)
        .filter((c) => !!c)
        .sort((a, b) => a.localeCompare(b))
      const idx = sorted.indexOf(myConn)
      this.localPlayer = idx === 0 ? "X" : idx === 1 ? "O" : ""
    }
    this.onGridChanged(this.gridProp.currentOrPendingValue ?? EMPTY.repeat(GRID_SIZE))
  }

  // Public — call from a cell's Interactable.onTriggerStart, passing
  // the cell index 0-8. Any player can call; owner applies directly,
  // non-owner relays via sendEvent.
  public placePiece(cellIndex: number): void {
    if (this.isGameOver) return
    if (this.presenceConns.size < 2) return // wait for the opponent — role not final yet
    if (this.localPlayer === "") return // spectator
    const grid = this.gridProp.currentOrPendingValue ?? EMPTY.repeat(GRID_SIZE)
    if (this.checkWinner(grid)) return
    if (this.whoseTurn(grid) !== this.localPlayer) return
    if (grid[cellIndex] !== EMPTY) return

    if (this.syncEntity.doIOwnStore()) {
      this.applyMove(cellIndex, this.localPlayer)
    } else {
      this.syncEntity.sendEvent(EVENT_PLACE_MOVE, {
        cellIndex,
        player: this.localPlayer,
      } as PlaceMovePayload)
    }
  }

  // Public — call from a "Restart" button. Either player can send.
  public restart(): void {
    if (this.syncEntity.doIOwnStore()) {
      this.onRestartReceived()
    } else {
      this.syncEntity.sendEvent(EVENT_RESTART)
    }
  }

  private onRestartReceived(): void {
    this.isGameOver = false
    if (this.syncEntity.doIOwnStore()) {
      this.gridProp.setPendingValue(EMPTY.repeat(GRID_SIZE))
    }
  }

  private onPlaceMoveReceived(msg: {data?: PlaceMovePayload}): void {
    if (!this.syncEntity.doIOwnStore()) return // only owner applies
    const data = msg.data
    if (!data || typeof data.cellIndex !== "number" || !data.player) return
    const grid = this.gridProp.currentOrPendingValue ?? EMPTY.repeat(GRID_SIZE)
    // Drop the event if the game is already won. Without this guard, a
    // move arriving after a winning move (in-flight before the winning
    // grid replicated, or from a misbehaving client) would apply on top
    // of the winning grid; since the new move doesn't break the
    // existing winning line, applyMove's checkWinner would return the
    // same winner and credit the score a second time. We check via
    // checkWinner(currentOrPendingValue) rather than this.isGameOver
    // because isGameOver is set inside onGridChanged, which fires on
    // the local device only after the server confirms — there's a
    // window where pendingValue holds the winning grid but isGameOver
    // is still false. Reading the grid directly closes that window.
    if (this.checkWinner(grid)) return
    // Validate: cell empty, turn matches.
    if (grid[data.cellIndex] !== EMPTY) return
    if (this.whoseTurn(grid) !== data.player) return
    this.applyMove(data.cellIndex, data.player)
  }

  private applyMove(cellIndex: number, player: Player): void {
    const grid = this.gridProp.currentOrPendingValue ?? EMPTY.repeat(GRID_SIZE)
    const newGrid = grid.slice(0, cellIndex) + player + grid.slice(cellIndex + 1)
    this.gridProp.setPendingValue(newGrid)

    // Credit score AT the state transition, not in onGridChanged.
    // onGridChanged fires for late joiners on initial state replication
    // (and on any subsequent value transition), so crediting there would
    // replay a stale "winner" credit. applyMove only runs on the
    // authoritative owner (placePiece routes non-owner moves through
    // sendEvent("placeMove") to the owner), so this fires exactly once
    // per winning move on a single device.
    const winner = this.checkWinner(newGrid)
    if (winner === "X") {
      this.xScoreProp.setPendingValue((this.xScoreProp.currentOrPendingValue ?? 0) + 1)
    } else if (winner === "O") {
      this.oScoreProp.setPendingValue((this.oScoreProp.currentOrPendingValue ?? 0) + 1)
    }
  }

  private onGridChanged(grid: string): void {
    // Pure renderer — no score side effects (see applyMove for that).
    const winner = this.checkWinner(grid)
    if (winner) {
      this.isGameOver = true
      this.renderWinner(winner)
      return
    }
    if (this.isFull(grid)) {
      this.isGameOver = true
      this.renderTie()
      return
    }
    this.isGameOver = false
    this.renderTurnFromGrid(grid)
  }

  private whoseTurn(grid: string): Player {
    let x = 0, o = 0
    for (const c of grid) {
      if (c === "X") x++
      else if (c === "O") o++
    }
    return x === o ? "X" : "O"
  }

  private checkWinner(grid: string): Player {
    for (const line of WIN_LINES) {
      const [a, b, c] = line
      if (grid[a] !== EMPTY && grid[a] === grid[b] && grid[b] === grid[c]) {
        return grid[a] as Player
      }
    }
    return ""
  }

  private isFull(grid: string): boolean {
    for (const c of grid) if (c === EMPTY) return false
    return true
  }

  private renderTurnFromGrid(grid: string): void {
    if (this.winnerText) this.winnerText.text = ""
    if (!this.turnText) return
    if (this.localPlayer === "") {
      this.turnText.text = "Spectating"
      return
    }
    const turn = this.whoseTurn(grid)
    this.turnText.text = turn === this.localPlayer ? "Your turn" : `${turn}'s turn`
  }

  private renderWinner(winner: Player): void {
    if (this.winnerText) this.winnerText.text = winner + " wins!"
    if (this.turnText) this.turnText.text = ""
  }

  private renderTie(): void {
    if (this.winnerText) this.winnerText.text = "Tie game"
    if (this.turnText) this.turnText.text = ""
  }

  private renderScores(): void {
    if (this.xScoreText) {
      this.xScoreText.text = "X: " + (this.xScoreProp.currentOrPendingValue ?? 0)
    }
    if (this.oScoreText) {
      this.oScoreText.text = "O: " + (this.oScoreProp.currentOrPendingValue ?? 0)
    }
  }
}
