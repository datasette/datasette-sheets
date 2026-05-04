---
id: sheet.format.decimal-increase
title: Increase-decimal button bumps `decimals` by one
category: format
status: draft
related:
  - sheet.format.decimal-decrease
  - sheet.format.number
---

## Trigger

- Click the `.0→` button in the toolbar.

## Effect

- Increment `format.decimals` on every selected cell by 1, clamped
  to a maximum of 10.
- Recalculate so the change takes effect on rendered numbers.

## Edge cases

- **`type=general`:** the stored `decimals` rises, but the `general`
  renderer ignores it — only takes effect once the user picks a
  specific type (number / currency / percentage / scientific).
- **Upper bound:** 10 decimals; beyond that the `toLocaleString`
  numeric path emits zeros only.

## Visual feedback

- Numeric cells re-render with one more fractional digit.

## Rationale

Matches Google Sheets' `.0→` button (and Excel's equivalent).
