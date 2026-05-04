---
id: sheet.selection.column-header-shift-click
title: Shift+click column header extends to a contiguous column range
category: selection
status: draft
related:
  - sheet.selection.column-header-click
  - sheet.selection.column-header-drag
---

## Trigger

- Shift + left mousedown on a column header.
- Precondition: a "column anchor" exists (from a prior
  column-header click).

## Effect

- Select every cell in every column from the anchor column to the
  clicked column, inclusive. The range is contiguous — intermediate
  columns are included regardless of prior selection state.
- The column anchor does not move.

## Edge cases

- **No column anchor:** degrade to `sheet.selection.column-header-click`
  (solo-select the clicked column, set it as anchor).
- **Shift+click on the anchor column:** selection collapses to the
  single column.

## Visual feedback

- All selected column headers get the "header selected" style.
- All their cells get the "highlighted" fill.

## Rationale

Matches Excel / Google Sheets.
