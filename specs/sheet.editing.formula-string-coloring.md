---
id: sheet.editing.formula-string-coloring
title: String literals colour distinctly in a formula, and autocomplete is suppressed inside them
category: editing
status: draft
related:
  - sheet.editing.formula-name-coloring
  - sheet.editing.formula-autocomplete
---

## Trigger

- The user is editing a cell and the value begins with `=`.
- The formula contains one or more double-quoted (`"..."`) or
  single-quoted (`'...'`) string literals.

## Effect

- Every character of the string literal — including the surrounding
  quote delimiters — is rendered in a single fixed green, distinct
  from the cell-ref palette and the name-ref colour.
- While the caret sits anywhere between an opening quote and its
  matching closing quote, the function + named-range autocomplete
  popup is suppressed. Typing `="asdf a"` with the caret just before
  the closing quote does **not** offer `AVERAGE` / `AND` / `ABS`.

## Edge cases

- **Unterminated string** (`="abc` without a closing quote): coloured
  out to the end of input so the user sees what they're typing; the
  caret counts as inside the string for autocomplete purposes.
- **Mixed delimiters**: `='he said "hi"'` is one single-quoted
  string. Double quotes *inside* the single-quoted token don't close
  it.
- **Signature help inside a string argument** (e.g. caret inside
  `=SUM("|"`): remains visible. The user is editing an argument of
  `SUM`, so showing the signature is still useful — only the
  prefix-matched autocomplete popup is hidden.
- **No string at all**: behaviour unchanged; cell/range/name refs
  continue to render in their rotating / name-dedicated colours.

## Visual feedback

- The coloured overlay (same one that already paints cell / range /
  name refs) gains string segments in `#188038`. The underlying
  `<input>`'s own text stays transparent so the overlay is what the
  user sees.
- No grid-side highlight (strings have no cells to paint).

## Rationale

Matches Google Sheets' convention of tinting string literals green.
The visual distinction also makes structural mistakes legible at a
glance — an unterminated quote is obvious because everything after
it is the wrong colour.

Suppressing autocomplete inside a string is the corollary: no
completion the popup could offer is syntactically valid there, so
the popup would only ever produce a broken formula if accepted.

## Notes — implementation

String detection delegates to the engine via
`WasmSheet.formula_tokens()` (see `formulaTokens` /
`findStringLiterals` / `isCursorInString` in
`frontend/src/lib/spreadsheet/formula-helpers.ts`). Terminated
strings come back as `kind: "string"`; an unterminated trailing
string is reported as `kind: "unknown"` whose first character is a
quote — both are coloured + treated as "in-string" for autocomplete.

The engine lexer follows spreadsheet convention: `\` is not an
escape character (so `="a\"b"` is two adjacent strings, just like
Google Sheets). Doubled quotes inside a same-typed string are also
*not* an escape today — that's a known gap tracked separately.
