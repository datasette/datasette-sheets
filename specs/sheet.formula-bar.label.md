---
id: sheet.formula-bar.label
title: Formula bar shows active cell id, range label, or view name
category: formula-bar
status: draft
related:
  - sheet.formula-bar.dropdown
  - sheet.view.triangle-indicator
---

## Trigger

- Selection changes, or the active named view changes.

## Effect

The label box at the left of the formula bar shows:

- **Single active cell:** the cell's A1-style id (e.g. `C7`).
- **Multi-cell selection:** the bounding range in A1 notation (e.g.
  `A1:C5`).
- **Named view mode active:** the view's name, rendered in the
  view's colour (bold).
- **No selection:** empty / blank.

A small chevron indicates the box is clickable (see
`sheet.formula-bar.dropdown`).

## Edge cases

- **Non-rectangular selection** (from Cmd+click): show the bounding-
  box range label; do not attempt to reflect non-contiguous shape
  in the label.
- **View overrides selection:** if a view is active, label shows the
  view name regardless of current cell selection.

## Visual feedback

- Monospace font; fixed width large enough for typical ranges
  (e.g. `AA100:AB200`). Chevron on the right.

## Rationale

The label is the "where am I" indicator; users consult it when
referencing cells in formulas or addresses in conversation.
