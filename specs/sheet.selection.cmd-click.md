---
id: sheet.selection.cmd-click
title: Cmd/Ctrl+click toggles a cell in/out of selection
category: selection
status: draft
related:
  - sheet.selection.click
  - sheet.selection.shift-click
---

## Trigger

- Cmd (macOS) or Ctrl (other platforms) + left mouse button on a cell.
- Precondition: not in edit mode.

## Effect

- If the clicked cell is **not** in the current selection: add it.
  The active cell moves to the clicked cell.
- If the clicked cell **is** in the current selection: remove it.
  If it was the active cell, pick another cell from the remaining
  selection as the new active cell (implementation-defined — any
  member of the remaining set is acceptable).
- The **selection anchor does not move.**

## Edge cases

- **Only cell in selection gets removed:** selection becomes empty;
  no active cell. Further keyboard shortcuts that require a selection
  are no-ops until the user clicks something.
- **Disjoint (non-rectangular) selections:** allowed — the selection
  is a set, not a rectangle. A subsequent Shift+Arrow or Shift+click
  still measures the rectangle from the (unchanged) anchor, which
  may produce surprising ranges. Accept this as a deliberate
  trade-off; document but do not "fix".

## Visual feedback

- Added cells gain the "highlighted" fill.
- Removed cells lose it.

## Rationale

Matches Excel / Google Sheets — supports multi-range selections for
bulk formatting or copy.
