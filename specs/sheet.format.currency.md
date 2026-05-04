---
id: sheet.format.currency
title: Toolbar applies currency format to the active cell
category: format
status: draft
related:
  - sheet.format.percentage
  - sheet.format.number
  - sheet.format.clear
---

## Trigger

- Click the `$` (or equivalent) button in the toolbar.

## Effect

1. Push the current format state to the undo stack.
2. Set the active cell's format to `currency` with a default of
   2 decimal places and the local currency symbol (`$` as
   placeholder; implementations may localise).
3. Trigger a recalculation so displayed values update.

## Edge cases

- **Currently applies to the active cell only**, not to the full
  selection. (Intentional simplification for the first release.
  Future spec revision may extend to the full selection — matching
  the bold-toggle model.)
- **Non-numeric cell:** the format is applied; display may be the
  raw string if no number can be parsed.

## Visual feedback

- Display changes to `$X.XX` or `($X.XX)` for negative numbers.
  Alignment is right per `sheet.format.numeric-align-right`.

## Rationale

One-click formatting matches Excel / Google Sheets toolbar.
