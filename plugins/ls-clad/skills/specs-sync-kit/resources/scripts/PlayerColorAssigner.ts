// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// PlayerColorAssigner.ts — deterministic per-player color from connectionId.
//
// Each device gets a stable color derived from a hash of the player's
// connectionId, modulo a fixed palette. The same connectionId produces
// the same color on every device, with no coordination needed — useful
// for per-player highlight rings, avatar tinting, score-row backgrounds.
//
// Distinct from TeamPalette.ts:
//   - TeamPalette: index-into-palette by a slot number you provide
//     (sorted-userId slot, host-assigned team, etc.).
//   - PlayerColorAssigner: hash a connectionId directly. Stable but not
//     ordered — players A, B, C may get colors 3, 1, 5 (whatever hashes).
//
// Place at: Assets/Scripts/PlayerColorAssigner.ts (module — no @component).
// Import + call from any script that needs to color a player.

const PALETTE: vec4[] = [
  new vec4(1.0, 0.35, 0.35, 1), // red
  new vec4(0.3, 0.55, 1.0, 1),  // blue
  new vec4(0.4, 0.85, 0.4, 1),  // green
  new vec4(1.0, 0.78, 0.2, 1),  // yellow
  new vec4(0.78, 0.45, 1.0, 1), // purple
  new vec4(1.0, 0.55, 0.2, 1),  // orange
  new vec4(0.45, 0.85, 0.85, 1),// cyan
  new vec4(1.0, 0.5, 0.75, 1),  // pink
]

// FNV-1a 32-bit hash — small, fast, deterministic across JS engines.
function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    // Math.imul performs C-style 32-bit signed integer multiplication.
    // Without it, the bare product `h * 0x01000193` can reach ~7.2e16
    // (max ~4.29e9 × 16,777,619), which exceeds Number.MAX_SAFE_INTEGER
    // (~9.007e15) and loses low-order bits to IEEE 754 float rounding —
    // corrupting the FNV-1a avalanche and increasing color collisions.
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

export function colorForConnectionId(connectionId: string): vec4 {
  if (!connectionId) return new vec4(1, 1, 1, 1)
  const slot = hashString(connectionId) % PALETTE.length
  return PALETTE[slot]
}

export function paletteSize(): number {
  return PALETTE.length
}
