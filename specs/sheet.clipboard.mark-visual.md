---
id: sheet.clipboard.mark-visual
title: Clipboard mark is a dashed accent border on the source range
category: clipboard
status: draft
related:
  - sheet.clipboard.copy
  - sheet.clipboard.cut
  - sheet.clipboard.paste
  - sheet.clipboard.escape-cancels-mark
  - sheet.clipboard.sheet-switch-clears-mark
---

## Trigger

- The clipboard state transitions from "no mark" to either `copy` or
  `cut` mode (i.e., after a successful copy or cut).

## Effect

- Paint a dashed border in the accent colour around the **bounding
  rectangle** of the marked range:
  - top edge on cells at the top row of the range,
  - bottom edge on cells at the bottom row,
  - left edge on cells at the leftmost column,
  - right edge on cells at the rightmost column.
- The mark persists across paste operations in `copy` mode.
- The mark is cleared by: paste consuming a `cut`; Escape
  (`sheet.clipboard.escape-cancels-mark`); a fresh copy or cut; a
  sheet switch (`sheet.clipboard.sheet-switch-clears-mark`).

## Edge cases

- **Non-rectangular selection:** the mark is drawn on the bounding
  rectangle, not on individual cells. (Cut of a non-rectangular
  selection is a rare enough case that we accept the visual
  simplification.)
- **Range entirely off-screen:** the mark draws nothing visible; no
  indicator appears in the viewport. Scrolling back reveals it.
- **Range crosses frozen header boundaries:** the mark draws on
  visible cells; the portion behind frozen headers is occluded.

## Visual feedback

- Dashed stroke in the accent colour, ~1.5px wide (at 1×), drawn
  exclusively on the outer perimeter of the range. Do not outline
  individual cells inside the range.
- Optional: an animated "marching ants" effect. If animated, stroke
  dashes slide in the direction of travel at ~0.3–0.5s per cycle.

## Rationale

Immediately recognisable spreadsheet convention ("marching ants").
Distinct from the selection fill so users can tell the two apart.
