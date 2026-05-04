---
id: sheet.editing.f2-or-enter
title: F2 or Enter opens edit mode from a focused cell
category: editing
status: draft
related:
  - sheet.editing.double-click
  - sheet.editing.type-replaces
  - sheet.navigation.enter-commit-down
---

## Trigger

- F2 key, OR Enter key, on a focused cell that is not in edit mode.

## Effect

- Enter edit mode exactly as `sheet.editing.double-click` would: load
  raw value, caret at end, auto-focus input.

## Edge cases

- **Enter while already editing:** fires `sheet.navigation.enter-commit-down`
  instead (commit and move down). Disambiguate by edit-mode state.
- **F2 while already editing:** no effect — already in the target
  state.
- **Multi-cell selection:** only the active cell enters edit mode;
  the selection is retained.

## Visual feedback

- Same as `sheet.editing.double-click`.

## Rationale

F2 is Excel's traditional "edit this cell" key; Enter is Google
Sheets'. Supporting both maximises compatibility.
