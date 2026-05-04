---
id: sheet.navigation.shift-arrow-extend
title: Shift+Arrow extends the selection rectangle by one cell
category: navigation
status: draft
related:
  - sheet.navigation.arrow
  - sheet.navigation.shift-arrow-jump-extend
  - sheet.selection.shift-click
---

## Trigger

- Shift + ArrowUp/Down/Left/Right, no other modifier.
- Precondition: a cell has focus, not in edit mode.

## Effect

The selection has three conceptually distinct points:

- **Anchor** — where the selection started. Unchanged by Shift+Arrow.
- **Active cell** — the "main" cell with the thick border; also
  where typed input lands. Unchanged by Shift+Arrow.
- **Far edge** — the corner opposite the anchor; Shift+Arrow moves
  this.

On Shift+Arrow:

1. Move the **far edge** one step in the arrow's direction, clamped
   at the grid edge.
2. Update the selection to the rectangular bounding box from the
   anchor to the new far edge.
3. Leave the active cell and keyboard focus alone.

Growing and shrinking both work: if the far edge moves back toward
the anchor, the rectangle shrinks.

## Edge cases

- **At the grid edge** in the direction of the arrow: far edge
  doesn't move; rectangle doesn't change.
- **No anchor / no far edge yet** (fresh page): treat the current
  active cell as both anchor and far edge.
- **Non-rectangular selection** (from prior Cmd+click): Shift+Arrow
  rewrites the selection to the rectangle from anchor to new far
  edge — the disjoint cells are discarded.

## Visual feedback

- The rectangle of highlighted cells expands or contracts; the
  active cell retains the thick selected inner border at the
  anchor.

## Rationale

Keyboard equivalent of drag-select; Excel / Google Sheets baseline.
Anchor-preserving active cell is the convention there too: click
B2, Shift+Down, and what you just typed would still replace B2 —
not B3.
