---
id: sheet.format.wrap
title: Cell wrapping — overflow / wrap / clip
category: format
status: draft
related:
  - sheet.format.font-size
  - sheet.format.v-align
---

## Trigger

- Click the wrapping toolbar button (text-wrap icon + caret) and
  pick one of Overflow / Wrap / Clip.

## Effect

- **Overflow** (default when `wrap` is unset): single-line, long
  content is clipped with an ellipsis at the cell edge. Currently
  does not spill into empty right neighbours — see Edge cases.
- **Wrap**: `white-space: normal; word-wrap: break-word` on the
  value span. The cell's `min-height` floor is still the base row
  height, but the cell's actual height grows to fit the wrapped
  text. The containing `.data-row` is a flex row with
  `align-items: stretch` — the tallest cell sets every other cell
  (and the row header) to the same height.
- **Clip**: hard clip, no ellipsis. Use when the "..." itself is
  visual noise.

## Edge cases

- **Ideal "overflow into empty neighbours":** today Overflow is
  effectively Clip-with-ellipsis; the bit where text spills past
  the cell boundary into an empty right-neighbour is future work.
  Noted in TODO-styling.md §5 as a follow-up.
- **Edit mode:** a cell with `wrap=wrap` doesn't currently re-flow
  the edit input to match — the input keeps its single-line
  auto-widen behaviour. Editing a long wrapped value temporarily
  collapses it back to a single line until the commit re-renders.
  Acceptable for v1; true multiline editing lands later.
- **Very long unbreakable words:** `overflow-wrap: anywhere` kicks
  in so long URLs don't blow out the column width.

## Visual feedback

- Row height grows to fit when any cell in it wraps.
- Dropdown menu item for the current mode shows a ✓ mark.

## Rationale

Matches Google Sheets' three-mode behaviour. The shared
"all cells in the row stretch to the tallest" is a consequence of
the grid's flex-row layout, so no explicit row-height state is
needed in the store.
