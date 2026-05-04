---
id: sheet.editing.formula-name-coloring
title: Named-range tokens colour distinctly in a formula
category: editing
status: draft
related:
  - sheet.editing.formula-ref-pointing
  - sheet.named-range.panel
---

## Trigger

- The user is editing a cell and the value begins with `=`.
- The formula contains one or more bare identifiers that lex as
  named-range references (anything that isn't followed by `(` and
  isn't a cell/range literal).

## Effect

- Cell / range references cycle through a palette so the eye can
  match each ref with its highlighted cell in the grid.
- Name references — which are workbook-scoped and not tied to any
  single cell — render in **one fixed colour** across all names in
  the formula. This makes names read as a different *kind of thing*
  from cell refs without adding the noise of yet another rotating
  colour.

## Edge cases

- **Formula contains only names**: the cycling palette is unused;
  every name renders in the shared name colour.
- **Name that isn't defined yet**: still coloured as a name (the
  lexer doesn't know the name table). The cell's computed value will
  be `#NAME?` until the user defines it.
- **Unfocused cell / plain-value cell**: the coloured overlay is
  only drawn while the cell is in edit mode.

## Visual feedback

- Overlay rendered above the text input shows each token in its
  assigned colour; the input's own text is transparent so only the
  coloured overlay is visible.
- No grid-side highlight for names (names don't correspond to a
  single cell in the grid, so there's nothing to highlight).

## Rationale

Matches Google Sheets' convention of distinguishing names from cell
refs visually. A rotating colour for each name would compete with
the cell-ref colours without giving the user any information — names
are identified by their text, not their position.
