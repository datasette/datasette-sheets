---
id: sheet.editing.formula-ref-pointing
title: Arrow keys while typing a formula insert cell references
category: editing
status: draft
related:
  - sheet.editing.double-click
  - sheet.navigation.arrow
---

## Trigger

- A cell is in edit mode with an edit value that begins with `=`.
- The caret is at an "insertable" position — immediately after an
  operator (`+`, `-`, `*`, `/`, `^`, `&`, comparison operators), an
  opening paren `(`, a comma `,`, or at the position right after the
  leading `=` with no other content to its left.
- An arrow key is pressed.

## Effect

1. Start "pointing" mode: pick the neighbouring cell in the direction
   of the arrow as a reference.
2. Insert the cell reference (e.g. `B3`) at the caret.
3. Record the reference's `{start, end, cellId}` range in the edit
   value.
4. Subsequent arrow keys **move the reference** — replace the token
   with a new reference for the newly-targeted cell; do not
   re-insert.
5. Any non-arrow key exits pointing mode: Enter commits, Escape
   cancels, Tab commits+moves, a character adds to the formula.

## Edge cases

- **Caret is inside a function name or string literal:** arrow keys
  do not insert references; they also do not navigate (must not
  jump the editor caret into the grid). Pointing is suppressed.
- **Caret sits *before* the leading `=`** (cursor position 0): no
  insertion. Users can reach this position with ``Cmd+ArrowLeft``
  (jump to start of line) — pressing arrow there would otherwise
  prepend a ref, turning ``=ROUND(3.14)`` into ``E4=ROUND(3.14)``.
- **Caret in the middle of a number, identifier, or cell ref:**
  no insertion. Arrow keys move the caret as plain text editing.
  Checks apply char-by-char via the engine's grammar (scanned to
  caret); the implementation in this repo uses a local heuristic
  pending ``TODO-liblotus-ref-insertable-at.md``.
- **Caret is right after a comma or operator but the next
  non-whitespace char is a value:** no insertion. ``=SUM(1,| 2)``
  with caret between ``,`` and the space would otherwise produce
  ``=SUM(1,C4 2)``, which isn't valid. The heuristic skips
  whitespace when checking the next meaningful char.
- **Shift/Cmd with arrow while pointing:** implementation-defined;
  the minimum behaviour is "pointing treats them the same as plain
  arrow". (Future work: range-select a reference with Shift+Arrow.)
- **Leaving the grid (target would be out of bounds):** clamp — do
  not move the reference; keep the current one.
- **After a ref insertion, signature help must refresh:** the
  caret moves programmatically, which doesn't fire keyup/click
  events. The pointing handler has to refresh signature help
  explicitly so the popup reflects the new caret position.

## Visual feedback

- Referenced cells in the grid gain a coloured outline; the colour
  matches the formula token in the editor. Multiple references get
  distinct colours cycling from a small palette (e.g. 6–8 entries).
- The input text inside the cell may be rendered transparent with a
  coloured overlay that shows each reference in its assigned colour;
  the caret remains visible.

## Rationale

Matches Excel / Google Sheets. Pointing is the fastest way to build
a formula — the user doesn't type `B3`, they arrow to `B3`.
