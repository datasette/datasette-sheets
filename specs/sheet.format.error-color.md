---
id: sheet.format.error-color
title: Formula errors render in the error color
category: format
status: draft
related:
  - sheet.format.numeric-align-right
  - sheet.delete.refs-rewrite
---

## Trigger

- A cell's evaluated state is an error — error strings start with
  `#` and include at least `#REF!`, `#DIV/0!`, `#NAME?`, `#VALUE!`,
  `#NUM!`, `#N/A`, `#CIRC!` (circular reference), and any
  implementation-defined additions.

## Effect

- Display the error string as the cell's value.
- Render in the **error colour** (typically a red tone).
- Left-align (override the numeric right-align).

## Edge cases

- **Error in a cell with bold applied:** render bold in error colour.
- **Hover tooltip:** implementations may add one showing the full
  underlying formula / reason; not required for spec compliance.
- **The formula bar always shows the raw formula, not the error
  string** (so the user can inspect what produced the error).

## Visual feedback

- The error text replaces the cell's normal display; colour alone
  makes it recognisable at a glance.

## Rationale

Matches Excel / Google Sheets. Colour is a faster cue than the `#`
prefix alone.
