---
id: sheet.column.auto-fit-double-click
title: Double-click the resize handle auto-fits column to widest content
category: column
status: draft
related:
  - sheet.column.resize-drag
---

## Trigger

- Double-click on the resize handle at the right edge of a column
  header.

## Effect

1. Determine the target columns:
   - If the double-clicked column is part of a multi-column header
     selection (see `sheet.selection.column-header-*`), every
     selected column is a target.
   - Otherwise, only the double-clicked column is a target.
2. For each target column, measure the rendered width of every
   cell's displayed value in that column, plus the header label
   itself. Use the same font / size as the cells render with.
3. Take the column's maximum. Round up to the nearest integer. Add
   a small padding (a few px) so text doesn't kiss the cell edge.
4. Cap at a sensible maximum (e.g. 80% of the viewport width) so
   one pathological cell doesn't push everything else off-screen.
5. Clamp at the minimum width (same as resize-drag).
6. Apply the new width and persist.

Each column is sized independently — the result is identical to
double-clicking each one in turn.

## Edge cases

- **Empty column:** resize to "header label + padding" — do not
  shrink to minimum.
- **Column contains very long text:** hits the viewport-fraction cap.
- **Non-visible characters / multi-line content:** measure the
  widest line only.
- **Multi-selection but double-click outside it:** only the
  clicked column is fit. Match Google Sheets — a double-click
  outside the selection is treated as acting on that one column,
  not the stale selection.

## Visual feedback

- Width changes instantly; no animation required.

## Rationale

Matches Excel / Google Sheets. Fast way to "fix" a truncated column
without guessing the right drag distance.
