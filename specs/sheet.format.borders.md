---
id: sheet.format.borders
title: Per-cell borders via a preset picker
category: format
status: draft
related:
  - sheet.format.clear
---

## Trigger

- Click the borders toolbar button (border-all icon + caret). A
  popover opens with a color picker, style selector
  (solid/dashed/dotted), and a grid of presets:
  All / Outer / Top / Right / Bottom / Left / Top+Bottom /
  Left+Right / Clear.

## Effect

- The chosen preset builds a `CellBorders` object with the selected
  color and style, and applies it to every selected cell.
- Clear sets `borders = undefined` so the cell reverts to the grid
  default.

## Edge cases

- **Edge ownership:** a cell's rendered border is its *own* four
  edges. If two adjacent cells both have a border on the shared
  edge, both render (they overlap visually at the same pixel).
  This is simpler than GSheets' bottom/right-owned convention and
  avoids the "disappearing top border" issue when only one side of
  an edge has a border set.
- **Default grid lines:** the cell's default 1px neutral border is
  underneath the user-chosen border; the user's choice overrides
  because we emit inline `border-*` declarations.
- **Copy/paste (external apps):** outbound HTML doesn't yet emit
  border styles on `<td>`; inbound HTML doesn't pick them up
  either. Intra-app paste preserves borders as part of the full
  format round-trip. (See §11 in TODO-styling.md.)

## Visual feedback

- Popover stays open while the user adjusts color + style, closes
  when a preset is clicked.

## Rationale

Borders are compositional — most of the time you want "all",
"outer", or "bottom" rather than precise single-edge tuning. The
preset grid makes those fast; the color + style controls sit at
the top of the same popover for the rare "I want a red dashed
underline" case.
