---
id: sheet.selection.row-header-drag
title: Drag across row headers selects a contiguous range of rows
category: selection
status: draft
related:
  - sheet.selection.row-header-click
  - sheet.selection.column-header-drag
---

## Trigger

- Mousedown on a row header, then pointer enters adjacent row
  headers while the button is held.

## Effect

- Each time the pointer enters a new row header, update the selection
  to "all cells in every row from the anchor row to the entered row,
  inclusive". Release ends the drag.

## Edge cases

- **Drag into the cells to the right of the headers:** do not switch
  to cell-drag; continue treating the pointer's current row as the
  other end of the range.
- **Release outside the header strip:** handled by a window-level
  mouseup so the drag state is always released.

## Visual feedback

- Progressive expansion of row-selection styling.

## Rationale

Symmetric with column-header drag.
