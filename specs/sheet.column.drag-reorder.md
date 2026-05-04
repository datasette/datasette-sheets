---
id: sheet.column.drag-reorder
title: Drag a column header to reorder columns
category: column
status: draft
related:
  - sheet.column.resize-drag
  - sheet.column.insert-left-right
  - sheet.tabs.drag-reorder
  - sheet.delete.refs-rewrite
  - sheet.insert.refs-rewrite
---

## Trigger

- User mousedowns on the body of a column header (not the right-edge
  resize handle, not Shift- or Cmd/Ctrl-click), then drags ≥4px in
  any direction before releasing.

## Effect

- The dragged column header fades to ~40% opacity for the duration
  of the drag.
- A 2px accent vertical bar appears at the column gap nearest the
  pointer (gap = the position between two columns; left-of-midpoint
  drops before the target column, right-of-midpoint drops after).
  The bar spans the full visible grid height.
- On release, if the gap differs from the source position
  (i.e. is not "drop in place" or one position to the right of the
  source range), the column moves to the gap. Cells, widths,
  formats, and formulas all update atomically.
- **Formula rewrite** (matches Google Sheets):
  - Single cell refs follow the data: `=D1` becomes `=C1` after
    column D moves before column C.
  - Bounded ranges (`A1:D5`) stay positional; the rectangle is
    unchanged even though its data permutes inside.
  - Whole-column refs (`D:D`, `B:D`) follow the data using the
    bounding box of every forward-mapped column index in the range.
    Example: `=SUM(B:D)` after D moves before C remains `=SUM(B:D)`
    because the bounding box of {B, D, C in the new layout} is
    still B..D. `=SUM(B:C)` becomes `=SUM(B:D)` because column C's
    data is now at column D, expanding the bounding box.
  - Whole-row refs (`1:5`) are unaffected by a column move.
  - Absolute markers (`$D$1`) preserve `$` and shift positionally.
  - Spill anchors (`D1#`) follow the moved cell.
- **Named-range definitions** referencing the moved column(s) are
  rewritten so they keep pointing at the cells the user named.
  Single-cell, whole-column, AND bounded ranges all follow the
  data (via the engine's data-following variant — distinct from
  the positional variant used for cell formulas, where a bounded
  range denotes a rectangle that shouldn't move).
- **View-registry rows** (persisted SQL views over a sheet range)
  have their `min_col` / `max_col` updated to the bounding box of
  forward-mapped col indices. The underlying SQL VIEW DDL is not
  regenerated in v1 — moves that don't straddle the view's range
  resolve correctly because the cells moved with their data.
- The column header selection follows the moved column to its new
  position so the moved column stays visually selected.
- The change is broadcast over SSE; other clients mirror the
  reorder.

## Edge cases

- **Drop on the source column or one position to its right:** no-op.
  The column would land where it already is, so no API call is
  fired.
- **Drop inside a multi-column source range:** no-op (the block
  would land at the same position).
- **Drag while a contiguous multi-column header selection covers
  the pressed column:** the entire contiguous block moves together
  as a single block. The selection is preserved during the drag
  (no collapse to single-col on mousedown). Non-contiguous
  multi-col selections fall back to single-column drag.
- **Drop past either edge of the grid:** clamps to gap 0 (before
  column A) or gap N (after the last column).
- **Below the 4px movement threshold:** falls through to the
  existing column-select gesture; no reorder takes place.
- **Shift-mousedown / Cmd-Ctrl-mousedown on a column header:** the
  reorder drag is suppressed so the existing select-extend gesture
  works unmodified.
- **Right-mousedown:** the drag is never armed; right-click opens
  the column context menu as before.
- **Server rejects the move:** the optimistic local move is
  reverted via the inverse `moveColsLocally(finalStart, …, srcStart)`
  and an alert surfaces with the error.
- **Component unmount mid-drag:** window listeners and body cursor
  are reset in `onDestroy`.

## Visual feedback

- Source column header opacity 0.4 during the drag.
- 2px accent vertical bar at the drop gap, full grid height,
  pointer-events disabled (so the bar can't intercept its own
  driving mousemove).
- Document body cursor: `grabbing`.

## Rationale

Standard convention; matches Google Sheets, Excel, and Numbers.
Faster than the menu-driven "Move column right" affordance and
supports arbitrary destination positions.

The asymmetric ref-rewrite (single cells follow data; bounded
ranges stay positional) matches GSheets and the user mental model:
"I named the cell with this data" vs "I summed that rectangle".
Whole-column refs are name-like ("that column"), so they follow.

The 4px movement threshold is the standard click-vs-drag boundary —
small enough to feel responsive, large enough to absorb pointer
jitter on an intended click.
