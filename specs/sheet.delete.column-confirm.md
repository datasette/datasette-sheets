---
id: sheet.delete.column-confirm
title: Confirm before deleting columns; shift right columns left
category: delete
status: draft
related:
  - sheet.delete.column-right-click
  - sheet.delete.refs-rewrite
---

## Trigger

- User clicks "Delete column(s)" in the column context menu.

## Effect

- Same as `sheet.delete.row-confirm`, but for columns:
  - Native confirm dialog with column-specific copy.
  - Optimistic local delete: remove columns, shift right-side columns
    leftward, update stored column widths in the same shift.
  - Rewrite formula references per `sheet.delete.refs-rewrite`.
  - Persist to server; clear column selection and column anchor on
    success.

## Edge cases

- **Deleting all columns:** clamp at a minimum of one column.
- Not undoable (same caveat as row-confirm).

## Visual feedback

- Columns slide left; column letters re-label. Right-side widths
  shift with their columns.

## Rationale

Symmetry with row delete.
