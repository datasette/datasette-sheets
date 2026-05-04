---
id: sheet.format.decimal-decrease
title: Decrease-decimal button drops `decimals` by one
category: format
status: draft
related:
  - sheet.format.decimal-increase
  - sheet.format.number
---

## Trigger

- Click the `.0←` button in the toolbar.

## Effect

- Decrement `format.decimals` on every selected cell by 1, clamped
  to a minimum of 0.
- Recalculate.

## Edge cases

- **At 0:** button is still clickable but the action is a no-op.
- Same `type=general` caveat as `sheet.format.decimal-increase`.

## Rationale

Pair with the increase button. Matches Google Sheets / Excel.
