---
id: sheet.selection.row-header-click
title: Click row header selects full row
category: selection
status: draft
related:
  - sheet.selection.row-header-shift-click
  - sheet.selection.row-header-drag
  - sheet.selection.column-header-click
---

## Trigger

- Left mousedown on a row header (the number/label at the left of a
  row), no modifier keys.

## Effect

1. Select every cell in that row (all columns).
2. The active cell becomes column A of that row.
3. The selection anchor moves to the same cell.
4. Record the clicked row as the "row anchor" for subsequent
   Shift+click or drag on row headers.
5. Clear any column-selection state.

## Edge cases

- **Right-click on the row header:** do not select; hand off to the
  row delete menu (`sheet.delete.row-right-click`).
- **Row already solo-selected:** no state change.

## Visual feedback

- Row header gets the "header selected" style.
- All cells in the row get "highlighted"; active cell gets the
  selected inner border.

## Rationale

Symmetric with column-header click; Excel / Google Sheets baseline.
