---
id: sheet.selection.column-header-click
title: Click column header selects full column
category: selection
status: draft
related:
  - sheet.selection.column-header-shift-click
  - sheet.selection.column-header-drag
  - sheet.selection.row-header-click
---

## Trigger

- Left mousedown on a column header (the letter/label at the top of
  a column).
- No modifier keys.

## Effect

1. Select every cell in that column (all rows).
2. The active cell becomes row 1 of that column.
3. The selection anchor moves to the same cell.
4. Record the clicked column as the "column anchor" for subsequent
   Shift+click or drag on column headers.
5. Clear any row-selection state.

## Edge cases

- **Right-click on the header:** do not select; hand off to the
  right-click column menu (`sheet.delete.column-right-click`).
- **Click the resize handle at the column's right edge:** do not
  select; start a resize drag instead (`sheet.column.resize-drag`).
- **Column already solo-selected:** no state change.

## Visual feedback

- Column header gets the "header selected" style (accent fill,
  inverted text colour).
- Every cell in the column gets the "highlighted" fill; the active
  cell also gets the selected inner border.

## Rationale

Expected baseline for spreadsheet headers — consistent with Excel /
Google Sheets / Numbers.
