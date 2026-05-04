---
id: sheet.editing.formula-autocomplete
title: Autocomplete suggests functions and named ranges while typing a formula
category: editing
status: draft
related:
  - sheet.editing.formula-signature-help
  - sheet.editing.formula-ref-pointing
  - sheet.editing.formula-name-coloring
  - sheet.named-range.panel
---

## Trigger

- The user is editing a cell whose value begins with `=`.
- The cursor sits inside an identifier-shaped token (at least one
  letter, not a cell-ref shape like `A1`).
- The engine's `complete()` returns at least one candidate —
  builtin functions (e.g. `SUM`, `ROUND`) and workbook-scoped named
  ranges are merged and ranked together.

## Effect

1. A popup appears just below the cell input, listing every match
   in the order the engine returned them. Each row shows a kind
   indicator (`ƒ` for function, `▦` for named range), the candidate
   name, and a muted detail string (e.g. `ROUND(value, decimals?)`
   for a function, `Named range` for a name).
2. The first match is highlighted.
3. Keyboard:
   - **Arrow Down / Up** move the highlight; wraps at the ends.
   - **Enter** or **Tab** replaces the identifier under the cursor
     with the highlighted candidate's insert text and moves the
     caret to the end of that insert. Enter does *not* commit the
     cell.
     - For a **function**, the insert includes the opening paren
       (`SUM(`) so the caret lands ready for arguments, and the
       signature-help tooltip
       ([`sheet.editing.formula-signature-help`](sheet.editing.formula-signature-help.md))
       opens immediately.
     - For a **name**, the insert is the canonical name only. Names
       are uppercased by the engine's name table, so accepting
       `Tax` against a defined `TaxRate` inserts `TAXRATE`.
   - **Escape** dismisses the popup without touching the input.
   - Any other key (typing more characters, Delete, etc.) falls
     through to the regular edit handler. The match list is then
     recomputed from the new cursor position.
4. **Mouse**: clicking a row inserts it. The input keeps focus
   (mousedown is preempted before blur fires).

## Edge cases

- **No match after a keystroke**: the popup disappears.
- **Exact match typed** (the user types the last character that
  completes the only remaining candidate): popup closes — nothing
  left to suggest.
- **Cursor sits in a cell-ref shape** (`A1`, `BC42`): the engine
  returns no items, so no popup. Cell-ref completion is
  intentionally not suggested here.
- **Cursor is in the right-half of a range reference** — i.e. the
  character immediately before the typed identifier is `:` (as in
  `A:A` or `A1:A|`): no popup. The grammar requires a cell ref
  there, not a named identifier; autocompleting would produce
  things like `A:AVERAGE` that won't parse.
- **Focus leaves the input** (Tab off the cell, click outside):
  popup closes.

## Visual feedback

- Popup uses the workbook surface colour with a subtle shadow and
  border. The highlighted row is painted with the selection colour.
- Kind indicator and detail text are muted; the label uses the
  default text colour.
- Popup uses the monospace font so names line up with the way they
  appear in the formula overlay.

## Rationale

A spreadsheet's formula surface has two kinds of identifiers the
user needs help typing: builtins (hundreds in Google Sheets, a
dozen here) and user-defined names. Merging them into one popup
means the user never has to remember which one they're looking at —
if the identifier exists in scope, it shows up. Drives straight
off the engine's `complete()` primitive so the frontend never
re-implements identifier tokenisation.
