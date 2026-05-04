---
id: sheet.editing.formula-signature-help
title: Tooltip shows the active function signature while typing arguments
category: editing
status: draft
related:
  - sheet.editing.formula-autocomplete
---

## Trigger

- The user is editing a cell with a formula (`=...`).
- The cursor sits inside the parentheses of a function call — either
  because the user just typed `(`, accepted a function from the
  autocomplete popup, or moved the caret into an existing call.
- The engine's `signature_help()` returns a non-null result for the
  current `(formula, cursor)`.

## Effect

1. A dark tooltip appears above the cell input showing the active
   function's signature:
   ```
   ROUND(value, decimals?)
   ```
   - Required params render as-is; optional params carry a trailing
     `?`; variadic tails render as `…name`.
2. The parameter the user is currently typing is bolded and
   underlined. The engine reports the parameter index; the UI just
   highlights the matching span.
3. The tooltip refreshes on every keystroke, every caret move
   (arrow keys, clicks into the input), and immediately after a
   function completion is accepted.
4. Nested calls resolve to the innermost open call — `=SUM(1,
   MAX(|` shows `MAX`, not `SUM`.
5. Aliased calls resolve to the primary — `=AVG(|` shows `AVERAGE`.
   The user still types the alias; the display is the canonical
   name so the args list matches.

## Edge cases

- **Cursor outside any call** (plain formula, or cursor past the
  closing `)`): tooltip is hidden.
- **Unknown function name**: tooltip is hidden. No "unknown" placeholder.
- **Unterminated string/ref at cursor**: engine returns `null`;
  tooltip is hidden rather than guessing.
- **Cell exits edit mode** (Enter, Tab, Escape, blur): tooltip
  closes with the popup.
- **Param that is both repeatable AND optional** (e.g. SUM's
  `value2`): render as `…value2` only — skip the trailing `?`.
  A variadic tail is implicitly optional; both markers would be
  redundant and visually noisy.
- **Active-arg index past the last non-repeatable param in a
  variadic catalog**: the repeatable tail stays highlighted. The
  user typing the 8th argument to SUM should still see
  `…value2` bolded, not nothing.
- **Escape with signature help visible**: Escape exits edit mode
  in one press. The tooltip unmounts because it's passive — no
  separate dismiss pass. Autocomplete, which *is* interactive,
  still swallows Escape first.

## Visual feedback

- Dark-surface tooltip with white text, positioned above the cell
  input. Fixed-coords so it escapes the cell's overflow clip.
- Active parameter is bolded + underlined. Optional parameters are
  dimmed slightly.
- Tooltip is not interactive — `pointer-events: none` so it never
  captures clicks meant for the input below.

## Rationale

Twelve builtin functions isn't many, but nested calls and
positional arguments are still enough friction to drive users to
the docs. A live signature tooltip collapses that lookup into the
edit flow. Engine owns the analysis (nesting, aliases, param
index) so the UI stays trivial to maintain.
