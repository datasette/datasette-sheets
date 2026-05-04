---
id: sheet.scrolling.sticky-corner
title: Top-left corner cell pins above both sticky axes
category: scrolling
status: draft
related:
  - sheet.scrolling.sticky-col-headers
  - sheet.scrolling.sticky-row-headers
---

## Trigger

- The grid is scrolled in either axis.

## Effect

- The top-left corner (intersection of the column headers and the
  row headers — typically labelled with a small icon or left blank)
  stays pinned at the top-left of the viewport.
- In stacking order, the corner cell sits **above** both pinned axes
  so neither pinned header shows through it.

## Edge cases

- **Click the corner cell:** implementation-defined. Common
  convention is "select all"; not required by this spec.

## Visual feedback

- Fully opaque; often the same background as the headers themselves.

## Rationale

Prevents the two pinned axes from visually colliding at the corner.
