---
id: sheet.scrolling.sticky-row-headers
title: Row number column pins to the left during horizontal scroll
category: scrolling
status: draft
related:
  - sheet.scrolling.sticky-col-headers
  - sheet.scrolling.sticky-corner
---

## Trigger

- The grid is scrolled horizontally.

## Effect

- The row-number column stays pinned to the left edge of the grid
  viewport.

## Edge cases

- Same bleed-through / stacking concerns as the sticky column
  headers. Pinned column must render with an opaque background.

## Visual feedback

- Same as column variant: opaque, optional shadow on the right
  edge when scrolled.

## Rationale

Symmetric with sticky column headers.
