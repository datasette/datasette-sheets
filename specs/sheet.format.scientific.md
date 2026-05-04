---
id: sheet.format.scientific
title: Scientific format renders a number in exponential notation
category: format
status: draft
related:
  - sheet.format.number
---

## Trigger

- Pick "Scientific" in the number-format toolbar dropdown on a
  selected cell.

## Effect

- Sets `type: "scientific"`, `decimals: 2` (by default).
- Renders via `value.toExponential(decimals)` — e.g. `1.23e+3`.
- Strings and non-numeric values pass through unchanged.

## Edge cases

- **Decimals out of range:** clamp to a sane default (2) when the
  stored `decimals` is negative or non-integer.
- **Increase / decrease decimal buttons:** bump the exponent
  precision like they do for number / currency / percentage.

## Rationale

Standard for very large or very small magnitudes — matches Excel /
Google Sheets.
