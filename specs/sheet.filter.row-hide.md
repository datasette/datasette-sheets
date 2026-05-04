---
id: sheet.filter.row-hide
title: Filter predicates hide matching data rows
category: filter
status: draft
related:
  - sheet.filter.value-toggle
  - sheet.filter.column-popover
  - sheet.filter.create
---

## Trigger

- The active filter has at least one column predicate, and a
  data row's display string for that column is in the
  predicate's `hidden` list.

## Effect

1. Hidden rows compress to zero height — the row immediately
   above and below sit flush, with no gap left behind.
2. The row-number band visually skips the hidden index — the
   user sees `5, 7, 8` if row 6 is hidden, matching Google
   Sheets.
3. Arrow-up / arrow-down step *over* hidden rows. The user
   never lands on a hidden cell via keyboard nav.
4. Cells in hidden rows aren't mounted at all (virtualization
   filters them out of the rendered window) so they don't
   incur reactive-subscription cost.

## Edge cases

- **Header row (`min_row`) is never hidden**: predicates run
  on the data range only (`min_row+1..max_row`).
- **Rows outside the filter rectangle are never hidden**:
  predicates have no effect on rows above `min_row` or below
  `max_row`.
- **All data rows hidden**: the rectangle still renders with
  its border + chevron; the body is empty.
- **Wrap-grown rows that hide-then-unhide**: the row's
  measured (pre-hide) height is restored; it doesn't snap to
  the default `ROW_HEIGHT_PX`.
- **Cell value change while the row is hidden**: if the new
  display string isn't in the predicate, the row reappears
  on the next reactive frame.

## Visual feedback

- No animation — rows snap from full to zero height.
- Row numbers don't renumber; the user sees the actual
  underlying row index, just with gaps.

## Rationale

Cell IDs are A1-style (positional) throughout the codebase, so
hiding via height-collapse keeps every formula reference and
selection coordinate honest. Skipping mount via virtualization
preserves the perf win that drove [sheet.grid.virtualization].
