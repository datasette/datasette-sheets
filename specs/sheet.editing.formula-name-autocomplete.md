---
id: sheet.editing.formula-name-autocomplete
title: Autocomplete suggests matching named ranges while typing a formula
category: editing
status: deprecated
related:
  - sheet.editing.formula-autocomplete
  - sheet.editing.formula-ref-pointing
  - sheet.editing.formula-name-coloring
  - sheet.named-range.panel
---

> **Deprecated** — superseded by
> [`sheet.editing.formula-autocomplete`](sheet.editing.formula-autocomplete.md)
> which merges function completions and named ranges into a single
> popup. Kept here as a pointer so older bug reports that cite
> this ID still resolve.


## Trigger

- The user is editing a cell whose value begins with `=`.
- The cursor sits inside an identifier-shaped token (at least one
  letter, with no digits that would make it look like a cell ref).
- At least one defined named range on the active sheet has a name
  that prefix-matches the identifier (case-insensitive) and isn't
  already an exact match.

## Effect

1. A popup appears just below the cell input, listing every matching
   name in the order the engine returned them.
2. The first match is highlighted.
3. Keyboard:
   - **Arrow Down / Up** move the highlight; wraps at the ends.
   - **Enter** or **Tab** replaces the identifier under the cursor
     with the highlighted name and moves the caret to the end of
     the inserted text. Enter does *not* commit the cell.
   - **Escape** dismisses the popup; the input is otherwise
     unaffected.
   - Any other key (typing more characters, Delete, etc.) falls
     through to the regular edit handler. The match list is then
     recomputed from the new prefix.
4. **Mouse**: clicking a match inserts it. The cell input keeps
   focus (mousedown is preempted before blur fires).

## Edge cases

- **No match after a keystroke**: the popup disappears.
- **Exact match typed** (`TaxRate` and the user types the final `e`
  that completes the name): popup closes — no value in suggesting
  the thing already typed.
- **Cursor sits in a cell-ref shape** (`A`, `BC42`): no popup. The
  engine will read the token as a cell ref, not a name.
- **Focus leaves the input** (Tab off the cell, click outside):
  popup closes.

## Visual feedback

- Popup uses the workbook surface colour with a subtle shadow and a
  border. The highlighted row is painted with the selection colour.
- Popup uses the monospace font so names line up with the way they
  appear in the formula overlay.

## Rationale

Named ranges are opaque — the name tells the user nothing about the
underlying range unless they already know it. Autocomplete means
users don't have to cross-reference the Named Ranges panel while
they type. Follows Google Sheets' identifier-completion UX.
