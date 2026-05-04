---
id: sheet.editing.double-click
title: Double-click a cell opens edit mode with existing value
category: editing
status: draft
related:
  - sheet.editing.f2-or-enter
  - sheet.editing.type-replaces
  - sheet.editing.blur-commits
---

## Trigger

- Double-click on a cell that is not already in edit mode.

## Effect

1. Ensure the cell is solo-selected (same as `sheet.selection.click`).
2. Enter edit mode: the cell becomes a text input.
3. Populate the input with the cell's **raw** value — the formula
   text, not the displayed value. (A cell holding `=1+1` opens with
   `=1+1`, not `2`.)
4. Place the text caret at the end of the value.
5. Auto-focus the input so typing goes straight in.

## Edge cases

- **Double-click on a cell in another cell's edit mode:** the edit
  mode holds; the double-click is ignored.
- **Empty cell:** open with an empty input; caret at position 0.
- **Cell with an error value (`#REF!`, etc.):** open the raw formula,
  not the error string.

## Visual feedback

- The cell's padding collapses to 0 so the input fills the bounds
  precisely. The selected inner border is still drawn around the
  editing cell.

## Rationale

Edit-in-place is the expected spreadsheet idiom; double-click is
the universal "open for editing" affordance.
