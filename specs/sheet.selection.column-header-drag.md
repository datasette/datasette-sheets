---
id: sheet.selection.column-header-drag
title: Drag across column headers selects a contiguous range of columns
category: selection
status: draft
related:
  - sheet.selection.column-header-click
  - sheet.selection.drag
---

## Trigger

- Mousedown on a column header, then pointer enters adjacent column
  headers while the button is held.

## Effect

- Each time the pointer enters a new column header, update the
  selection to "all cells in every column from the anchor column to
  the entered column, inclusive" (same rule as Shift+click on the
  header).
- Release ends the drag.

## Edge cases

- **Drag down into the grid cells below the headers:** does not
  switch to cell-drag mode; continues treating the current column of
  the pointer as the "other end" of the range.
- **Release outside the header strip:** handled by a window-level
  mouseup so the drag state is always released.

## Visual feedback

- As in `sheet.selection.column-header-click`, plus progressive
  expansion as the drag moves.

## Rationale

Matches Excel / Google Sheets; drag is more fluid than Shift+click
for selecting a run of columns.
