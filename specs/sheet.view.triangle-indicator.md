---
id: sheet.view.triangle-indicator
title: Top-left cell of a view shows a clickable colored triangle
category: view
status: draft
related:
  - sheet.view.border
  - sheet.formula-bar.label
---

## Trigger

- A cell is the top-left of a named view's range.

## Effect

- Render a small filled triangle badge in the view's colour, anchored
  at the top-left corner of the cell.
- Hovering shows the view name as a tooltip.
- Clicking the triangle activates the named view: `active_view` is
  set, the formula-bar label shifts to show the view name, and the
  formula-bar dropdown exposes view-related actions.

## Edge cases

- **Multiple views sharing the same top-left cell:** stack triangles
  at different offsets, or pick an implementation-defined order.
- **Cell is selected AND a view triangle:** both render; the
  triangle sits above the selection styling.
- **Click directly on the triangle while a paste is in flight:**
  activate the view only; do not interfere with the paste.

## Visual feedback

- Triangle is small enough (~10px leg) not to crowd content but
  large enough to click reliably.
- Cursor becomes the pointer / click cursor on hover.

## Rationale

Makes entering "view mode" a one-click operation from the grid
itself.
