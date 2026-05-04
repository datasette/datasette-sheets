---
id: sheet.filter.auto-expand
title: Type below the filter to extend it
category: filter
status: draft
related:
  - sheet.filter.create
  - sheet.filter.row-hide
---

## Trigger

- Commit a non-empty value into the cell directly below the
  filter's `max_row`, within the column range
  `[min_col, max_col]`.
- "Commit" = any of the cell-edit commit paths: Enter / Tab /
  blur, paste, programmatic write, etc.

## Effect

1. The filter's `max_row` increases by 1 — the new row joins the
   filtered region.
2. The bordered rectangle visually extends to include the new
   row.
3. The new row is **visible by default**: predicates only hide
   rows whose value is in their `hidden` list, and a fresh row
   has values not in any list.
4. The server runs the same check inside `set_cells` so other
   clients receive the new bounds via `filter-update` SSE.

## Edge cases

- **Empty write**: doesn't extend. Clearing a cell below the
  filter does nothing to the bounds.
- **Write more than one row below**: doesn't extend. Skipping
  the boundary row would imply a multi-row jump; users will
  type into the boundary row first if they want the filter to
  grow.
- **Write outside the column range**: doesn't extend. A write
  in column F when the filter spans B..D doesn't bump the
  rectangle.
- **Concurrent extends from two clients**: server LWW —
  `max_row` only ever bumps to the highest target written.
  The lower client receives a no-op `filter-update` after its
  own bump merges into the same value.

## Visual feedback

- The rectangle's bottom border slides down by one row in the
  same reactive frame as the cell write (optimistic mirror).
- No animation.

## Rationale

Matches Google Sheets' Basic Filter behaviour. Users add data
to a filter region the same way they add data anywhere else —
no separate "extend filter" command needed.
