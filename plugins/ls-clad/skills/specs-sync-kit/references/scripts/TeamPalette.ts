// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// TeamPalette.ts — slot-indexed palette for >2-team variants.
//
// Use when "red/blue" parity isn't enough — e.g., 4 teams indexed by
// sorted-userId slot, or host-assigned team registry, or capture-the-flag
// with 3 teams. The CALLER decides what the slot index means (sorted
// position, hash, host-assigned slot); this module just maps slot → color.
//
// For the simple "hash connectionId to a color" case, prefer
// PlayerColorAssigner.ts — it picks the slot for you.
//
// Place at: Assets/Scripts/TeamPalette.ts (module — no @component).

export const TEAM_COLORS: vec4[] = [
  new vec4(0.3, 0.55, 1.0, 1),  // slot 0 — blue
  new vec4(1.0, 0.35, 0.35, 1), // slot 1 — red
  new vec4(0.4, 0.85, 0.4, 1),  // slot 2 — green
  new vec4(1.0, 0.78, 0.2, 1),  // slot 3 — yellow
  new vec4(0.78, 0.45, 1.0, 1), // slot 4 — purple
  new vec4(1.0, 0.55, 0.2, 1),  // slot 5 — orange
]

export function colorForSlot(slot: number): vec4 {
  if (slot < 0) return new vec4(1, 1, 1, 1) // white fallback
  return TEAM_COLORS[slot % TEAM_COLORS.length]
}

export function teamCount(): number {
  return TEAM_COLORS.length
}
