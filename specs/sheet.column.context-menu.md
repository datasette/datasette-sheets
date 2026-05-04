---
id: sheet.column.context-menu
title: Column header right-click opens the column context menu
category: column
status: draft
related:
  - sheet.column.insert-left-right
  - sheet.delete.column-right-click
  - sheet.delete.column-confirm
---

## Trigger

- Right-click on a column header (the letter row).

## Effect

1. If the clicked column isn't in the current column selection,
   switch the selection to that single column. (Matches the cell
   context menu's "right-click outside the selection collapses it"
   behavior.)
2. Open a floating menu at the pointer, containing the current
   column-level actions — today:
   - Insert N column(s) to the left — see
     `sheet.column.insert-left-right`.
   - Insert N column(s) to the right — see
     `sheet.column.insert-left-right`.
   - Divider.
   - Delete column(s) — see `sheet.delete.column-right-click` +
     `sheet.delete.column-confirm`.

## Edge cases

- **Empty selection after collapse** (should not happen because the
  handler just guaranteed at least one selected column): menu
  doesn't open.
- **Click outside closes the menu** — see
  `sheet.delete.context-menu-dismiss`.

## Visual feedback

- Small floating menu at the pointer position.
- Destructive actions (delete) render with the danger style and sit
  below a divider, so they can't be clicked by accident when aiming
  for a neighbouring action.

## Rationale

Umbrella spec for the column header context menu. Individual
actions get their own specs; this one just describes the invocation
surface and the ordering invariant (destructive actions at the
bottom).
