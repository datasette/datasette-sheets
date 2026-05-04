---
id: sheet.scrolling.sticky-col-headers
title: Column header row pins to the top during vertical scroll
category: scrolling
status: draft
related:
  - sheet.scrolling.sticky-row-headers
  - sheet.scrolling.sticky-corner
---

## Trigger

- The grid is scrolled vertically.

## Effect

- The column header row (A, B, C, …) stays pinned to the top edge
  of the grid viewport. Its position does not change as the body
  scrolls underneath.

## Edge cases

- **Header cell that is also "selected" (full column selected):**
  keeps its selected style while pinned.
- **Dashed clipboard / view borders near the top:** must render below
  the pinned header (not above it) so the pinned header is fully
  opaque.

## Visual feedback

- Pinned row has an opaque background so grid content does not bleed
  through. A subtle bottom shadow when the body has scrolled away
  from the top is a pleasant affordance but not required.

## Rationale

Users lose their bearings in a table with no column header visible.
