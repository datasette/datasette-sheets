---
id: sheet.column.insert-left-right
title: Insert blank column(s) to the left or right of the selected columns
category: column
status: draft
related:
  - sheet.column.context-menu
  - sheet.delete.column-right-click
  - sheet.insert.refs-rewrite
---

## Trigger

- Right-click a column header → the context menu contains **"Insert
  N column(s) to the left"** and **"Insert N column(s) to the
  right"** items above the delete item. Clicking one fires the
  insert.
- **N** = the number of columns currently selected via the column
  header strip (1 for a single-header right-click; any count from a
  contiguous multi-select). Right-clicking a column that isn't in
  the current selection switches the selection to that column
  first, same as the delete path.

## Effect

1. Compute the insertion point:
   - **To the left** → `at = min(selected)`, the leftmost selected
     index.
   - **To the right** → `at = max(selected) + 1`, one past the
     rightmost selected index.
2. Apply locally for instant feedback: every cell at `col_idx >= at`
   shifts right by `N`, column widths shift in lockstep, and
   formula refs get rewritten so a ref that previously pointed at
   real data still points at the same data. See
   `sheet.insert.refs-rewrite` for the full rewrite rules.
3. POST the insert to the server. The server re-runs the same
   rewrite on formula text, applies the two-pass column shift, and
   broadcasts `columns-inserted` to every other client on the sheet
   so their optimistic updates match.
4. **Insert to the left**: the pre-existing selection follows the
   data — the selected columns end up highlighted at their new
   (shifted) positions. **Insert to the right**: the selection
   stays on the original indices, since nothing to their left
   shifted.

## Edge cases

- **No column selected** (menu can't open): impossible trigger.
- **Single-column right-click on a non-selected header**: selection
  collapses to that column first; `N = 1`.
- **Inserting past the last visible column** (at an index beyond
  the rendered column band): succeeds on the server; the local
  grid appears unchanged because there are no cells to shift.
- **Cells that would shift past the rendered column band**: dropped
  from the local view but kept on the server — they'll re-surface
  if the column band ever grows.
- **Undo**: not supported in v1. Matches the delete path.

## Visual feedback

- Context menu shows plural label (`"Insert 2 columns to the
  left"`) when N > 1, singular (`"Insert 1 column to the left"`)
  when N = 1.
- Insert items sit **above** the destructive delete item, separated
  by a divider — destructive actions live at the bottom.
- After an insert-to-the-left: selected-column headers shift right
  along with the selection; the new blank column(s) are unselected.
  After an insert-to-the-right: the blank column(s) appear
  immediately right of the selection with the selection unchanged.

## Rationale

Baseline spreadsheet UX. Google Sheets and Excel both expose
per-side insert actions directly from the column header context
menu, with selection size driving N. The left/right split removes
the ambiguity of a single "Insert" action and lets the user pick a
side in one click.

## Notes

**JS/Svelte:** The engine primitive behind the formula rewrite is
`WasmSheet.adjust_refs_for_insertion` — keep the JS side free of
regex on formula text. The server mirror is
`lotus.adjust_refs_for_insertion`. Both take `{cols, rows}`
index lists in the shape `[at] * count` for an N-col insert at
`at`.
