---
id: sheet.filter.column-popover
title: Filter chevron popover
category: filter
status: draft
related:
  - sheet.filter.column-icon
  - sheet.filter.value-toggle
  - sheet.filter.sort-asc
  - sheet.filter.sort-desc
---

## Trigger

- Click a filter chevron icon on a header cell.

## Effect

1. A popover opens anchored to the chevron, with sections in
   this order:
   - **Header label**: the display value of the header-row cell
     for the column (the same string the grid renders bold inside
     the filter rectangle). Falls back to the column letter
     (`A`, `B`, …) when the header cell is blank.
   - **Sort row**: "Sort A → Z" / "Sort Z → A".
   - **Filter by values** — search input + checkbox list of
     distinct display strings; "Select all" / "Clear" shortcuts;
     `OK` commits the predicate, `Cancel` discards.
2. The popover dismisses on:
   - Outside-click anywhere not inside the popover element.
   - Escape key.
   - Cancel / × button in the popover.
3. Clicking inside the popover (rows, search input,
   checkboxes) does NOT dismiss.
4. If a sort is currently active on the column, a small
   "Sorted: A → Z" / "Sorted: Z → A" indicator appears below
   the footer.

## Edge cases

- **Popover at the right edge of the viewport**: positioned via
  `keepInViewport` so it flips left rather than spilling
  off-screen. Same Svelte action toolbar / Format-menu popovers
  use.
- **Filter is removed via SSE while the popover is open**: the
  popover's `$sheetFilter` derivation goes null and the active-
  sort indicator vanishes; the popover itself stays open until
  the user closes it (no jarring auto-close).
- **Multiple chevrons clicked in succession**: each click
  replaces the popover state (one popover at a time).

## Visual feedback

- Card-style popover with subtle shadow and rounded corners.

## Rationale

Single popover with two logical sections so the user can
pivot between "sort by this" and "filter by values" without
context-switching to a different surface. Matches Google Sheets
Basic Filter.

## Notes — history

Earlier drafts shipped three disabled placeholder rows ("Sort by
color" / "Filter by color" / "Filter by condition") tagged "soon"
to advertise the v2 surface. Removed once the core sort + filter-
by-values flow proved coherent on its own — the placeholders
added visual noise without informing what the popover *does*. The
header cell value also replaced the bare column letter at the
top, so the popover reads "Brand" instead of "A".
