---
id: sheet.selection.header-shift-arrow-extend
title: Shift+Arrow extends a whole-column / whole-row header selection
category: selection
status: draft
related:
  - sheet.selection.column-header-click
  - sheet.selection.column-header-shift-click
  - sheet.selection.row-header-click
  - sheet.navigation.shift-arrow-extend
---

## Trigger

- A whole-column selection OR a whole-row selection is active (i.e.
  the selection was most recently initiated from a header click,
  shift-click, or drag — not from a cell).
- Shift + ArrowLeft/Right (for column selections) or
  Shift + ArrowUp/Down (for row selections).
- Precondition: no cell is in edit mode; focus is not inside an
  input / textarea widget.

## Effect

Mirrors `sheet.navigation.shift-arrow-extend` but along the whole-
column / whole-row axis:

- **Anchor column / row** — the one the header-select started from.
  Unchanged.
- **Far edge** — the column / row most recently extended to.
  Shift+Arrow moves this by one.
- **Selection** — the contiguous range of whole columns (or whole
  rows) from anchor to far edge, clamped at the grid edge.

Shift + perpendicular arrow (e.g. Shift+Up while a column
selection is active) is a no-op.

## Edge cases

- **At the grid edge** in the direction of the arrow: far edge
  doesn't move; selection unchanged.
- **Shift+Arrow on a cell selection** (not header-initiated):
  handled by `sheet.navigation.shift-arrow-extend` instead; this
  spec doesn't apply.
- **Editing a cell / focused in a text input:** handler bails; the
  native keybinding wins (rename inputs, formula bar, etc.).

## Visual feedback

- The same header-selected accent fill extends to the new column
  or row; the full data rectangle of those columns / rows gains
  the "highlighted" cell fill.

## Rationale

Without this, clicking a column header gave you a whole-column
selection but no keyboard way to extend it — Cell-level keydown
handlers only fire on focused cells, and header clicks don't focus
a cell. A small grid-level listener closes the gap and matches
Google Sheets, where the same keystroke walks the selection.

## Notes

**Implementation:** a single grid-level `keydown` listener is
simpler than teaching cells about whole-column state. Track
per-axis `colFarEdge` / `rowFarEdge` alongside the anchor so
repeated Shift+Arrow chains keep extending from the last edge.
