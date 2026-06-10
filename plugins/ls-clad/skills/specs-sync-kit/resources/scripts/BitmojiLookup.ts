// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// BitmojiLookup.ts — fetch SnapchatUser info for local + remote users.
//
// Calls session.getSnapchatUser(userInfo, cb) for any UserInfo to get
// the SnapchatUser object (displayName, userName, hasBitmoji). The
// SnapchatUser can then be passed to the Bitmoji module for rendering
// 3D bitmoji avatars in the lens.
//
// Returns null in singleplayer/mocked mode — always null-check before
// reading fields.
//
// Place at: Assets/Scripts/BitmojiLookup.ts, attach to ONE SceneObject
// under "Colocated World [CONFIGURE_ME] / EnableOnReady". Other scripts
// access it via BitmojiLookup.instance.

import {SessionController} from "SpectaclesSyncKit.lspkg/Core/SessionController"

interface SnapchatUserLike {
  displayName?: string
  userName?: string
  hasBitmoji?: boolean
}

type LookupCallback = (user: SnapchatUserLike | null) => void

@component
export class BitmojiLookup extends BaseScriptComponent {
  public static instance: BitmojiLookup | null = null

  onAwake(): void {
    BitmojiLookup.instance = this
  }

  // Look up the local Snapchat user. Calls cb with null if unavailable.
  public lookupLocal(cb: LookupCallback): void {
    SessionController.getInstance().notifyOnReady(() => {
      const session = SessionController.getInstance().getSession()
      const local = SessionController.getInstance().getLocalUserInfo()
      if (!session || !local) {
        cb(null)
        return
      }
      session.getSnapchatUser(local, (user: SnapchatUserLike | null) => {
        cb(user || null)
      })
    })
  }

  // Look up any connected user's Snapchat info by their UserInfo.
  public lookupUser(
    userInfo: ConnectedLensModule.UserInfo,
    cb: LookupCallback,
  ): void {
    SessionController.getInstance().notifyOnReady(() => {
      const session = SessionController.getInstance().getSession()
      if (!session || !userInfo) {
        cb(null)
        return
      }
      session.getSnapchatUser(userInfo, (user: SnapchatUserLike | null) => {
        cb(user || null)
      })
    })
  }
}
