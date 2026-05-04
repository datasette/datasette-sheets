---
id: sheet.filter.sort-asc
title: Sort A → Z by the column's value
category: filter
status: draft
related:
  - sheet.filter.sort-desc
  - sheet.filter.column-popover
  - sheet.row.drag-reorder
---

## Trigger

- Click "Sort A → Z" in a column's filter popover.

## Effect

1. Rows in the filter's data range (`min_row+1..max_row`) are
   physically reordered by the column's typed value. Empty cells
   sort last; numbers sort numerically; strings sort
   case-insensitively; booleans sort `false < true`.
2. Cells in the moved rows shift accordingly — formula
   references following the data via the engine's row-block-move
   primitive (same path used by drag-reorder).
3. The filter's `sort_col_idx` + `sort_direction` persist; the
   chevron in the column's header tints accent to indicate
   "this column is sorted".
4. Other clients receive `filter-update` + `rows-moved` SSE
   events and apply the same reorder locally.

## Edge cases

- **Sort already applied to the same column in the same
  direction**: idempotent — the permutation is a no-op so no
  rows move; metadata stays the same.
- **Sort applied while another sort is active**: the previous
  sort metadata clears, the new sort applies. There's no
  "secondary sort" in v1.
- **Single-row data range**: sort metadata persists, no rows
  move.
- **Concurrent sort from two clients**: server processes them
  sequentially (move_rows transactions); the second client's
  rows-moved events arrive in order.

## Visual feedback

- "Saving…" replaces the OK label briefly (sort can take
  several round-trips through the engine for large filters).
- The chevron icon turns accent green to mark the active sort
  column. The popover footer shows "Sorted: A → Z".

## Rationale

Physical sort matches Google Sheets Basic Filter. Cell IDs are
A1-style positional throughout the codebase; sorting in place
keeps every selection / clipboard / formula path honest. A
visual-only sort would require a displayed-row-vs-engine-row
indirection across every code path.

## Notes

**JS/Svelte**: server-side sort iterates `move_rows` once per
misplaced row. For typical 100-row sheets this is fast; for
larger filters the v1 implementation degrades linearly. A
``adjust_refs_for_row_permutation`` engine primitive would
collapse the work to a single transaction; deferred until perf
is measured to bite.
