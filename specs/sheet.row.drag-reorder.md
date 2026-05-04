---
id: sheet.row.drag-reorder
title: Drag a row header to reorder rows
category: row
status: draft
related:
  - sheet.column.drag-reorder
  - sheet.row.context-menu-delete-only
  - sheet.delete.refs-rewrite
  - sheet.insert.refs-rewrite
---

## Trigger

- User mousedowns on the body of a row header (not Shift- or
  Cmd/Ctrl-click), then drags ≥4px along the Y axis before
  releasing.

## Effect

- The dragged row header fades to ~40% opacity for the duration
  of the drag.
- A 2px accent horizontal bar appears at the row gap nearest the
  pointer (gap = the position between two rows; top-of-midpoint
  drops above the target row, bottom-of-midpoint drops below).
  The bar spans the full visible grid width.
- On release, if the gap differs from the source position
  (i.e. is not "drop in place" or one position below the source
  range), the row moves to the gap. Cells, formats, formulas,
  and named ranges all update atomically.
- **Formula rewrite** (matches Google Sheets):
  - Single cell refs follow the data: `=A4` becomes `=A2` after
    row 4 moves to row 2.
  - Bounded ranges (`A1:D5`) in cell formulas stay positional;
    the rectangle is unchanged even though its data permutes
    inside.
  - Whole-row refs (`4:4`, `3:5`) follow the data using the
    bounding box of every forward-mapped row index in the
    range. Example: `=SUM(3:5)` after row 4 moves to row 2 stays
    `=SUM(3:5)` because the bounding box of {row 4 → row 2,
    row 2 → row 3, row 3 → row 4} = rows 2..4 — same as
    rows 2..4 originally. `=SUM(3:4)` becomes `=SUM(4:5)`
    because the data shifts down by one.
  - Whole-column refs (`A:C`) are **unaffected** by a row move.
  - Absolute markers (`$A$4`) preserve `$` and shift positionally.
  - Spill anchors (`A4#`) follow the moved cell.
- **Named-range definitions** referencing the moved row(s) are
  rewritten so they keep pointing at the cells the user named.
  Single-cell, whole-row, and bounded ranges all follow the data
  (via the engine's data-following variant — distinct from the
  positional variant used for cell formulas).
- **View-registry rows** have their `min_row` / `max_row` updated
  to the bounding box of forward-mapped row indices. The
  underlying SQL VIEW DDL is not regenerated in v1 — moves that
  don't straddle the view's range resolve correctly because the
  cells moved with their data.
- The row header selection follows the moved row(s) to the new
  position so the moved rows stay visually selected.
- The change is broadcast over SSE; other clients mirror the
  reorder.

## Edge cases

- **Drop on the source row or one position below it:** no-op. The
  row would land where it already is, so no API call is fired.
- **Drop inside a multi-row source range:** no-op.
- **Drop past either edge of the grid:** clamps to gap 0 (above
  the first row) or gap N (after the last row) — note that the
  destination must be in the rendered viewport for v1; pre-scroll
  if the target is offscreen.
- **Below the 4px movement threshold:** falls through to the
  existing row-select gesture; no reorder takes place.
- **Shift-mousedown / Cmd-Ctrl-mousedown on a row header:** the
  reorder drag is suppressed so the existing select-extend
  gesture works unmodified.
- **Right-mousedown:** the drag is never armed; right-click opens
  the row context menu as before.
- **Drag while a contiguous multi-row header selection covers
  the pressed row:** the entire contiguous block moves together.
  The selection is preserved during the drag (no collapse to
  single-row on mousedown). Non-contiguous selections fall back
  to single-row drag.
- **Server rejects the move:** the optimistic local move is
  reverted via the inverse `moveRowsLocally(finalStart, …,
  srcStart)` and an alert surfaces.
- **Component unmount mid-drag:** window listeners and body
  cursor are reset in `onDestroy`.

## Visual feedback

- Source row header opacity 0.4 during the drag.
- 2px accent horizontal bar at the drop gap, full grid width,
  pointer-events disabled (so the bar can't intercept its own
  driving mousemove).
- Document body cursor: `grabbing`.

## Rationale

Standard convention; matches Google Sheets, Excel, and Numbers.
Faster than the menu-driven "Move row up / down" affordance and
supports arbitrary destination positions.

The asymmetric ref-rewrite (single cells follow data; bounded
ranges in cell formulas stay positional) matches GSheets and the
user mental model: "I named the cell with this data" vs "I summed
that rectangle". Whole-row refs are name-like ("that row"), so
they follow.

Named-range definitions use the data-following variant for
bounded ranges too (unlike cell formulas). A named bounded range
denotes *named cells*, not a positional rectangle.

The 4px movement threshold is the standard click-vs-drag boundary
— small enough to feel responsive, large enough to absorb pointer
jitter on an intended click.
