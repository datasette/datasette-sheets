---
id: sheet.filter.column-icon
title: Filter chevron icon in each header cell
category: filter
status: draft
related:
  - sheet.filter.create
  - sheet.filter.header-bold
  - sheet.filter.column-popover
---

## Trigger

- A filter exists on the active sheet, and the cell falls in
  the filter's first row (`min_row`) and any column inside
  `[min_col, max_col]`.

## Effect

- A small chevron icon renders anchored to the cell's right
  edge.
- Clicking the chevron opens the filter column popover
  (`sheet.filter.column-popover`).
- The icon's tint signals state at a glance:
  - **muted (default)** — column has no active predicate or sort
  - **accent (filter colour)** — predicate active OR this column
    is the active sort column

## Edge cases

- **Long header text**: the chevron sits above the cell-value
  layer (z-index) so the text never paints over the icon.
- **Cell editing**: the chevron is a button, so clicking it
  while the cell is in edit mode commits the edit then opens
  the popover. (Same blur-commits flow as any other click
  outside the input.)
- **Cell outside the filter**: no chevron renders.

## Visual feedback

- 12×12 SVG centered in an 18×18 hit target. Subtle hover
  background. Tinted accent colour when active state is on.

## Rationale

Mirrors Google Sheets — the chevron is the canonical entry
point to per-column filter / sort actions. Anchoring it to the
right edge keeps it out of the way of the header text.
