---
id: sheet.format.percentage
title: Toolbar applies percentage format to the active cell
category: format
status: draft
related:
  - sheet.format.currency
  - sheet.format.number
---

## Trigger

- Click the `%` button in the toolbar.

## Effect

- Set the active cell's format to `percentage` with a default of
  1 decimal place. The displayed value is `raw_value * 100` suffixed
  with `%`. E.g. raw `0.5` → displayed `50.0%`.
- Recalculate.

## Edge cases

- **Raw value is a string:** display as-is (no multiplication).
- **Already in percentage format:** re-applying is a no-op (same
  format).

## Visual feedback

- Display updates; right-aligned (numeric).

## Rationale

Match toolbar convention.
