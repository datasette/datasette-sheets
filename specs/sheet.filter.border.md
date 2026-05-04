---
id: sheet.filter.border
title: Filter rectangle renders as a solid bordered outline
category: filter
status: draft
related:
  - sheet.filter.create
  - sheet.filter.header-bold
  - sheet.view.border
---

## Trigger

- A filter exists on the active sheet and its cell range is
  visible in the viewport.

## Effect

- Draw a solid 2px outline in the filter accent colour on the
  outer perimeter of the rectangle (top / bottom / left / right
  edges only — not around individual cells).

## Edge cases

- **Filter range overlaps a named view**: both outlines render.
  The view outline is dashed, the filter outline is solid; when
  they coincide on the same edge, the filter draws on top
  (later in the cascade), which is the desired stacking order.
- **Filter range extends off-screen**: the visible portion is
  drawn; the outline simply continues into the off-screen area.
- **Filter rectangle becomes empty after a structural op**: the
  filter row is deleted server-side and the outline disappears
  via SSE.

## Visual feedback

- Solid stroke 2px, in the filter accent colour.
- Distinguishable from the dashed view outline by stroke style
  and colour, so the two can render on the same edge without
  reading as a single border.

## Rationale

Solid + thicker = "this is the active query surface" —
the user knows clicking inside the filter affects the filter.
Mirrors Google Sheets' filter outline.
