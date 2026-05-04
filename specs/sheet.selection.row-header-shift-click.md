---
id: sheet.selection.row-header-shift-click
title: Shift+click row header extends to a contiguous row range
category: selection
status: draft
related:
  - sheet.selection.row-header-click
  - sheet.selection.row-header-drag
---

## Trigger

- Shift + left mousedown on a row header.
- Precondition: a "row anchor" exists from a prior row-header click.

## Effect

- Select every cell in every row from the anchor row to the clicked
  row, inclusive. The row anchor does not move.

## Edge cases

- **No row anchor:** degrade to `sheet.selection.row-header-click`.
- **Shift+click on the anchor row:** selection collapses to the
  single row.

## Visual feedback

- All selected row headers get the "header selected" style; their
  cells get "highlighted".

## Rationale

Symmetric with column-header Shift+click.
