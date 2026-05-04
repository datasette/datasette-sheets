---
id: sheet.view.border
title: Named view range renders as a dashed colored outline
category: view
status: draft
related:
  - sheet.view.triangle-indicator
---

## Trigger

- A named view exists covering a contiguous cell range, and that
  range is visible in the viewport.

## Effect

- Draw a dashed outline in the view's colour on the outer perimeter
  of the range (top / bottom / left / right edges only — not around
  individual cells).

## Edge cases

- **Multiple views overlapping the same cell:** draw both outlines;
  if they coincide on the same edge, stack or offset them. No
  requirement to merge.
- **View range extends off-screen:** draw the visible portion; the
  outline simply continues into the off-screen area.
- **View range is a full column or row:** the outline is very long;
  it's still valid.

## Visual feedback

- Dashed stroke ~1.5px, in the view's assigned colour.
- The outline must be distinguishable from the clipboard mark
  (which is in the accent colour, not a view colour). Dashing can
  be identical; the colour alone disambiguates.

## Rationale

Makes named views discoverable in the grid itself, not just in a
side panel. Similar to Google Sheets' filter view border.
