---
id: sheet.format.number
title: Toolbar applies number format to the active cell
category: format
status: draft
related:
  - sheet.format.currency
  - sheet.format.percentage
---

## Trigger

- Click the `.0` (or equivalent) number-format button in the toolbar.

## Effect

- Set the active cell's format to `number` with a default of
  2 decimal places and locale-appropriate thousands separators.
- Recalculate.

## Edge cases

- **Non-numeric value:** display raw.
- **Integer value:** still shown with the configured decimal count
  (`5` → `5.00`).

## Visual feedback

- Display updates; right-aligned.

## Rationale

Match toolbar convention.
