---
id: sheet.selection.shift-click
title: Shift+click extends selection to a rectangle
category: selection
status: draft
related:
  - sheet.selection.click
  - sheet.selection.cmd-click
  - sheet.navigation.shift-arrow-extend
---

## Trigger

- Shift + left mouse button on a cell.
- Precondition: not in edit mode.

## Effect

1. Fill the rectangular bounding box between the current **selection
   anchor** and the clicked cell into the selection.
2. Move the **active cell** (the cell with keyboard focus and the
   accent border) to the clicked cell.
3. The **anchor does not move** — subsequent Shift+click from the
   same anchor can grow or shrink the rectangle.

## Edge cases

- **No anchor set** (nothing was previously selected): degrades to
  `sheet.selection.click` — solo-select the clicked cell and set it
  as the anchor.
- **Click on the anchor itself:** selection collapses to a single
  cell; anchor and active cell coincide.
- **Same axis** (e.g. anchor at A1, click on A5): a single-column
  vertical range selects.

## Visual feedback

- All cells in the rectangle get the "highlighted" fill (lighter than
  selected).
- The active cell alone gets the selected inner-border accent so the
  user sees which cell is "live".

## Rationale

Matches Excel / Google Sheets. Keeping the anchor stable across
successive Shift+clicks is important for the common "click, then
refine the range" workflow.
