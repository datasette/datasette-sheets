---
id: sheet.filter.header-bold
title: Filter header row renders bold with a tinted background
category: filter
status: draft
related:
  - sheet.filter.create
  - sheet.filter.border
  - sheet.filter.column-icon
---

## Trigger

- A filter exists on the active sheet, and the cell falls in
  the filter's first row (`min_row`) and any column inside
  `[min_col, max_col]`.

## Effect

- The cell's text renders bold.
- The cell's background carries a light tint distinct from the
  default cell background and from any user-set fill.

## Edge cases

- **Cell has an explicit user-set fill colour**: the fill wins
  via the `--cell-fill` variable; the tint applies only when
  the cell has no fill of its own.
- **Cell has explicit `bold: false` in its format**: the filter
  header still renders bold — visual consistency wins (every
  filter header is bold) over the user override on this
  particular cell.

## Visual feedback

- Bold weight on the cell value.
- Light green-leaning background (token-based, not a hard hex)
  that pairs with the filter outline colour.

## Rationale

Spreadsheet conventions consistently treat the first row of a
filterable region as a header. Bolding it gives the user a
reading anchor; the tint reinforces the rectangle's identity at
a glance. Matches Google Sheets.
