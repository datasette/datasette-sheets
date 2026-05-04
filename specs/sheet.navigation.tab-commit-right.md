---
id: sheet.navigation.tab-commit-right
title: Tab in edit mode commits and moves one column right
category: navigation
status: draft
related:
  - sheet.navigation.enter-commit-down
  - sheet.editing.blur-commits
---

## Trigger

- Tab key while a cell is in edit mode.

## Effect

1. Commit the current edit value to the cell (push to undo stack,
   persist, fire "cell changed").
2. Exit edit mode.
3. Move focus one cell to the right; solo-select that cell.
4. If the edited cell is the last column of the grid, commit and
   exit but do not move focus.

## Edge cases

- **Shift+Tab:** moves one cell to the left instead. Same
  commit-first semantics.
- **At the last column:** commit and exit edit mode, but focus
  stays. (Diverges from Excel/Sheets, which wrap to the next row's
  start — accepted divergence for now; may revise.)
- **Empty edit value:** still commits (an empty string is a valid
  cell value that clears any prior content).
- **Formula ref pointing active:** Tab exits pointing mode first,
  then the commit-and-move behaviour fires.

## Visual feedback

- Edit input disappears; cell re-renders its displayed value. Focus
  moves to the adjacent cell with its selected inner border.

## Rationale

Row-major data entry convention. Excel / Google Sheets / form
inputs all share this idiom.
