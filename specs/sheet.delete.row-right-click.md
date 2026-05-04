---
id: sheet.delete.row-right-click
title: Right-click row header opens delete menu
category: delete
status: draft
related:
  - sheet.delete.row-confirm
  - sheet.delete.column-right-click
  - sheet.delete.context-menu-dismiss
---

## Trigger

- Right-click (context-menu gesture) on a row header.

## Effect

1. If the right-clicked row is **not** in the current row selection,
   reset the selection to just that row first. (Right-clicking a
   header you already selected as part of a range keeps the range.)
2. Open a context menu positioned at the pointer coordinates.
3. The menu contains one destructive item, labelled per the current
   row selection:
   - Single row: "Delete row N" (N is the 1-based row number).
   - Multiple rows (contiguous): "Delete N rows (A–B)" where A and B
     are the first and last row numbers.
4. The menu is visually positioned so it doesn't overflow the
   viewport; flip direction / shift left if needed.

## Edge cases

- **Non-contiguous row selection:** label reads "Delete N rows"
  without a range hint.
- **Right-click on a row while a cell range is selected:** treat as
  "right-clicked a non-selected row" — resets to that one row.

## Visual feedback

- Menu appears with a subtle shadow; destructive item is rendered in
  the error colour so users don't click it absent-mindedly.

## Rationale

Right-click is the universal "contextual actions for this thing"
gesture; scoping to row headers keeps the grid-cell right-click
available for future actions.
