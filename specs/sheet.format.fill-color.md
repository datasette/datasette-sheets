---
id: sheet.format.fill-color
title: Fill-color picker sets a cell's background
category: format
status: draft
related:
  - sheet.format.text-color
  - sheet.format.clear
---

## Trigger

- Click the fill-color toolbar button (paint-bucket icon + colored
  strip + dropdown caret). The same palette component used for text
  color opens.

## Effect

- Sets `fillColor` on every selected cell.
- Rendering applies it as `background` on the cell box (not the
  inner text span), so the fill extends to the cell's edges.

## Edge cases

- **Selection state:** the blue selection tint still renders over
  the fill color, so a user can always tell which cell is active
  even when an aggressive fill is applied.
- **Hover state:** hover tint sits on top of the fill; the two
  compose visually.
- **Dark fills + default text color:** the user is responsible for
  contrast. We don't auto-invert text color.

## Visual feedback

- The button's color strip reflects the current cell's `fillColor`.
- Cell background updates immediately.

## Rationale

Standard spreadsheet affordance. Google Sheets applies it on the
cell edge, not the text span, so fills tile cleanly across a range
— we match.
