---
id: sheet.filter.delete
title: Remove the sheet's filter
category: filter
status: draft
related:
  - sheet.filter.create
  - sheet.cell.context-menu
---

## Trigger

- Right-click any cell **inside the filter rectangle** and
  choose **Remove filter** from the context menu.
- (Phase D adds an `× Remove filter` button at the top of the
  filter chevron popover; same effect.)

## Effect

1. The server deletes the filter row.
2. The bordered rectangle disappears.
3. Header-row bold + tint clear.
4. Any previously hidden rows reappear at full height.
5. Other clients receive `filter-delete` via SSE and update
   the same way.

## Edge cases

- **Cell outside the filter rectangle**: the right-click menu
  shows neither "Create filter" (one already exists) nor
  "Remove filter" (the click landed outside it). Nothing
  user-removable from this entry point.
- **Concurrent delete**: idempotent — the second delete returns
  404, surfaced as a no-op locally (the listener already cleared
  the store on the SSE event).

## Visual feedback

- All filter chrome (border, header tint, chevron icons) clears
  on the next reactive frame.

## Rationale

Symmetry with `sheet.filter.create`: same right-click flow,
opposite verb. Hiding the entry when the click is outside the
rectangle keeps the menu unambiguous about what gets removed.
