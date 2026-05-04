---
id: sheet.cell.boolean
title: Boolean values render as TRUE/FALSE centered in the accent color
category: cell
related:
  - sheet.format.numeric-align-right
  - sheet.format.h-align
---

## Trigger

- Automatic, based on a cell's computed value type. Fires whenever the
  Rust engine returns a `CellValue::Boolean` for the cell — typically
  from comparison operators (`=A1>5`) or boolean-producing functions.

## Effect

- Render the cell's displayed text as the literal `TRUE` or `FALSE`.
- Centre-aligned within the cell.
- Coloured in the sheet accent colour, so a column of flags scans as
  a flag column at a glance — same "type signal" treatment as numeric
  cells, just along the centre axis.

## Edge cases

- **User typed the literal string `TRUE` or `FALSE`:** stays a string,
  renders left-aligned in the default text colour. Booleans only
  surface from formula evaluation.
- **Bold / italic / underline / strikethrough:** stack normally on
  top of the centred + accent treatment.
- **Explicit horizontal alignment wins.** If the user has set
  `hAlign` on the cell (see `sheet.format.h-align`), the alignment
  AND the accent colour defer — the cell renders in the user's
  chosen alignment using the default text colour. Centred + accent
  is the "I haven't thought about it" default, not a floor.
- **Status-bar stats:** booleans are excluded from sum / average /
  min / max (`sheet.status-bar.numeric-stats` operates on
  `typeof === "number"`). Matches Google Sheets — use `SUM(...)` if
  you want booleans coerced to 1/0.

## Visual feedback

- Centred text flush with the cell's vertical-align baseline (middle
  by default).

## Rationale

Matches Excel / Google Sheets. The all-caps `TRUE` / `FALSE` plus the
accent colour makes flag columns visually distinct from text columns
without needing an explicit format choice.
