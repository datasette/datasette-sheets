---
id: sheet.editing.formula-bar
title: Formula bar provides a second editor bound to the active cell
category: editing
status: draft
related:
  - sheet.formula-bar.live-sync
  - sheet.editing.double-click
---

## Trigger

- Click or focus the formula-bar input widget.

## Effect

1. The active cell enters edit mode (if not already).
2. The formula bar and the cell's in-place editor share the same
   edit-value state. Typing in either one updates the other in real
   time.
3. Committing from the formula bar (Enter / blur) commits the cell
   value identically to committing from the in-cell editor.

## Edge cases

- **No active cell:** the bar is read-only / disabled.
- **Multi-cell selection:** the bar shows the active cell's raw
  value; editing affects only the active cell.
- **Named view mode active** (see `sheet.view.triangle-indicator`):
  the bar's label box displays the view name; the input still edits
  the active cell.

## Visual feedback

- The bar contains a label box (shows cell id / range / view name),
  an `fx` separator, and a monospace text input.
- Focusing the input does not change the cell's selected style.

## Rationale

Supports editing long formulas in a wider text field than the cell
itself. Excel / Google Sheets baseline.
