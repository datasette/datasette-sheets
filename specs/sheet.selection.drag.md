---
id: sheet.selection.drag
title: Drag across cells paints a rectangular selection
category: selection
status: draft
related:
  - sheet.selection.click
  - sheet.selection.shift-click
---

## Trigger

- Mousedown on a cell (A), then move the pointer with the button
  held, entering other cells.

## Effect

1. Mousedown sets the anchor to cell A, makes A the active cell,
   and enters a "drag" state.
2. Each time the pointer enters a new cell B while the button is
   held, update the selection to the rectangular bounding box from
   A to B (same rule as Shift+click). **The active cell stays at
   A** — the thick selection border does not chase the pointer.
3. Releasing the mouse button (anywhere — including outside the
   grid) ends the drag.

## Edge cases

- **Pointer leaves the grid during drag:** stop growing but keep the
  current selection; on a subsequent re-entry resume updating.
- **Release outside the window:** handled by a window-level mouseup
  listener so the grid doesn't get stuck in drag state.
- **Single-pixel move:** if the pointer never crosses a cell
  boundary, the drag devolves into a plain click — anchor stays on
  A, selection is A.
- **Drag onto the currently-editing cell:** ignored (editing cell
  stays focused; drag does not steal focus).

## Visual feedback

- Progressive expansion: each cell added to the rectangle gets the
  "highlighted" fill as the pointer enters it.
- Pointer cursor remains the default cell cursor (no special drag
  cursor).

## Rationale

Expected baseline. Most users drag to select rather than click-then-
Shift-click. Keeping the active cell pinned to the drag-start cell
matches Google Sheets — the user can type immediately after a
drag-select and the value lands in the expected anchor, not
wherever the mouse happened to stop.
