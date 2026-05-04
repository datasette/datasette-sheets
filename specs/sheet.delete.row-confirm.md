---
id: sheet.delete.row-confirm
title: Confirm before deleting rows; shift lower rows up
category: delete
status: draft
related:
  - sheet.delete.row-right-click
  - sheet.delete.refs-rewrite
---

## Trigger

- User clicks the "Delete row(s)" item in the row context menu.

## Effect

1. Close the context menu immediately.
2. Show a native confirmation dialog (blocking): "Delete row N? This
   can't be undone." (plural variant: "Delete N rows (A–B)? This
   can't be undone.").
3. On confirm:
   - Apply an optimistic local delete so the UI updates instantly:
     remove the rows, shift all rows below upward, and rewrite
     formula references that pointed into the deleted range
     according to `sheet.delete.refs-rewrite`.
   - Issue the delete to the server / persistence layer.
   - Clear the row selection and row anchor.
4. On cancel: no-op (menu is already closed).
5. On persistence error: surface an error notification; the optimistic
   local state should be rolled back or reloaded from authoritative
   storage.

## Edge cases

- **Deletes are not undoable** via the cell-value undo stack.
  The confirmation dialog's "can't be undone" copy reflects this.
  (Future work: make row/col deletes undoable.)
- **Deleting all rows:** implementation-defined; most spreadsheets
  keep a minimum of one row. Clamp or reject at the request layer.

## Visual feedback

- Rows below the deleted range slide up; the row numbers re-number.
- Any coloured mark (clipboard, view) on the affected cells is
  cleared.

## Rationale

Destructive, not undoable, so a confirm dialog is warranted. Cheaper
than a fancier undo system while the plugin is pre-release.
