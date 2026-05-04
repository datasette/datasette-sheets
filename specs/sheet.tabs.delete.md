---
id: sheet.tabs.delete
title: Delete a sheet via tab context menu (with confirm)
category: tabs
status: draft
related:
  - sheet.tabs.right-click-menu
---

## Trigger

- User clicks "Delete" in the tab context menu. Only shown when
  more than one sheet exists.

## Effect

1. Close the context menu.
2. Show a native confirm dialog: "Delete sheet '{name}'? This
   can't be undone."
3. On confirm:
   - Delete the sheet from persistence.
   - Remove its tab from the strip.
   - If the deleted sheet was the active one, switch to another
     sheet (implementation-defined which — typically the first
     remaining, or the neighbour to the left).
4. On cancel: no-op.
5. On persistence error: surface an error; re-add the tab locally
   if it was removed optimistically.

## Edge cases

- **Last sheet:** the menu item is hidden; this spec does not apply.
  UI must never allow deleting the last sheet.
- **Active sheet deleted:** switching destinations must never leave
  the workbook with no active sheet.

## Visual feedback

- Tab animates out (or simply disappears); other tabs shift left.

## Rationale

Destructive and not undoable; confirm is warranted. Hiding the
option when only one sheet exists avoids a "why is this disabled"
moment.
