---
id: sheet.format.v-align
title: Vertical alignment within the cell
category: format
status: draft
related:
  - sheet.format.h-align
  - sheet.format.wrap
---

## Trigger

- Click one of the three vertical-alignment buttons in the toolbar
  (top / middle / bottom) with a selection active.

## Effect

- Set `vAlign` on every selected cell.
- Render moves the cell's text to the top, center, or bottom of
  the row box.
- Default is middle when no explicit `vAlign` has been set.

## Edge cases

- **Single-row cell with `wrap: none`:** visually similar across top
  / middle / bottom because the text occupies roughly the whole
  row height. The distinction becomes visible once rows grow —
  via wrapping, larger font size, or tall row heights.
- **Edit mode:** the input's alignment is unaffected; editing always
  renders with a middle-centered input regardless of the cell's
  vAlign, so the edit UI stays consistent.
- **No selection:** no-op.

## Visual feedback

- Active toolbar button depressed.
- Cell content snaps to the chosen vertical edge.

## Rationale

Matches Google Sheets. Vertical alignment matters most once cells
start growing (wrap on, larger fonts) — but the field + UI land
here so downstream features don't need to re-open the toolbar.
