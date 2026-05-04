---
id: sheet.navigation.shift-arrow-jump-extend
title: Shift+Cmd/Ctrl+Arrow extends selection to content boundary
category: navigation
status: draft
related:
  - sheet.navigation.arrow-jump
  - sheet.navigation.shift-arrow-extend
---

## Trigger

- Shift + Cmd (macOS) / Ctrl (other platforms) + Arrow.
- Precondition: cell focus, not in edit mode.

## Effect

1. Apply the content-aware jump (same target as
   `sheet.navigation.arrow-jump`), starting from the current **far
   edge** (the corner opposite the anchor), not from the active
   cell. Result: the jump target.
2. Update the selection to the rectangular bounding box from the
   anchor to the jump target. The far edge moves to the jump
   target.
3. Leave the active cell and keyboard focus alone — see
   `sheet.navigation.shift-arrow-extend` for the anchor-preserving
   rule this shares.

## Edge cases

- Same as `sheet.navigation.arrow-jump` for the target rules.
- **Repeated Cmd+Shift+Down** past the end of a data block: each
  keystroke jumps from the previous far edge, so the second press
  walks past the block the first press landed on — matches the
  way plain Cmd+Down chains.
- If the jump target equals the anchor, selection collapses to a
  single cell (anchor == far edge == active).

## Visual feedback

- Rectangle snaps to the new bounding box in one step.

## Rationale

The power-user shortcut for "select everything from here to the end
of this table". Excel / Google Sheets baseline.
