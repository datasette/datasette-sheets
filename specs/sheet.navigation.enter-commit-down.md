---
id: sheet.navigation.enter-commit-down
title: Enter in edit mode commits and moves one row down
category: navigation
status: draft
related:
  - sheet.navigation.tab-commit-right
  - sheet.editing.blur-commits
---

## Trigger

- Enter / Return key while a cell is in edit mode.

## Effect

1. Commit the current edit value (push to undo stack, persist).
2. Exit edit mode.
3. Move focus one row down in the same column; solo-select.

## Edge cases

- **At the last row:** commit and exit, focus stays.
- **Shift+Enter:** moves one row up instead. Same commit-first
  semantics.
- **Alt/Option+Enter inside the input:** implementation-defined —
  common convention is to insert a newline into the cell's value
  rather than commit. Mark as a future-work point; do not hold back
  the spec.
- **Formula ref pointing active:** Enter exits pointing mode first,
  then commits.

## Visual feedback

- Edit input disappears; focus moves to the cell below.

## Rationale

Column-major data entry convention, paired with Tab's row-major.
