---
id: sheet.format.numeric-align-right
title: Numeric values render right-aligned in the accent color
category: format
status: draft
related:
  - sheet.format.number
  - sheet.format.error-color
  - sheet.format.h-align
---

## Trigger

- Automatic, based on a cell's computed value type.

## Effect

- If the cell's computed value is a number: render the cell's
  displayed text right-aligned, in the accent colour.
- Non-numeric values (strings, errors) render left-aligned in the
  default text colour.
- Applies regardless of format type (general, number, currency,
  percentage).

## Edge cases

- **Bold + numeric:** both apply — right-aligned, accent-coloured,
  bold.
- **Error value:** not numeric; overrides to error colour + left
  align (see `sheet.format.error-color`).
- **Explicit horizontal alignment wins.** If the user has set
  `hAlign` on the cell (see `sheet.format.h-align`), both the
  alignment direction AND the accent colour defer — the cell renders
  in the user's chosen alignment using the default text colour.
  Accent + right-align is the "I haven't thought about it" default,
  not a floor.

## Visual feedback

- Right-aligned cells show their content flush against the right
  edge with consistent padding.

## Rationale

Matches Excel / Google Sheets. Right-alignment + distinct colour
makes numeric columns scannable.
