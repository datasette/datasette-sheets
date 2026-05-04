---
id: sheet.navigation.arrow
title: Arrow key moves focus one cell, clamps at grid edge
category: navigation
status: draft
related:
  - sheet.navigation.arrow-jump
  - sheet.navigation.shift-arrow-extend
---

## Trigger

- ArrowUp / ArrowDown / ArrowLeft / ArrowRight, no modifier keys.
- Preconditions: a cell has keyboard focus, no cell is in edit mode.

## Effect

1. Move focus one cell in the direction of the arrow.
2. Solo-select the target cell — the previous selection (including
   any multi-cell rectangle) is discarded.
3. Set the selection anchor to the target cell.
4. Scroll the viewport to keep the target visible if needed.

## Edge cases

- **At the grid edge in the direction of travel:** no-op. The focus
  stays put; no selection change.
- **Focus not on a cell** (e.g. inside a text input): the arrow has
  its default text-caret behaviour and must not move cell focus.
- **During formula-ref pointing** (editing a cell whose input starts
  with `=` with the caret at an insertable position): arrow keys do
  not navigate; they insert/move a cell reference in the formula.
  See `sheet.editing.formula-ref-pointing`.

## Visual feedback

- Previous cell loses the selected inner border; target cell gains
  it.

## Rationale

Baseline spreadsheet navigation.
