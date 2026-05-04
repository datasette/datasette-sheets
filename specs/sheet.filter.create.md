---
id: sheet.filter.create
title: Turn a selection into a filter
category: filter
status: draft
related:
  - sheet.filter.delete
  - sheet.filter.border
  - sheet.filter.header-bold
  - sheet.cell.context-menu
---

## Trigger

- Right-click anywhere inside a cell selection (single cell or
  rectangular range) and choose **Create filter** from the
  context menu.
- Suppressed when a filter already exists on the sheet — the
  context-menu entry hides until the existing filter is removed.

## Effect

1. The bounding box of the current selection is sent to the
   server as a filter rectangle.
2. A bordered region appears on the grid covering that
   rectangle (`sheet.filter.border`).
3. The first row of the rectangle becomes the header row —
   bold + tinted background (`sheet.filter.header-bold`).
4. The filter persists across reload and is broadcast to other
   clients via SSE.

## Edge cases

- **Non-rectangular selection**: the menu uses the bounding box
  of the selected cells. Same convention as
  `sheet.cell.copy-reference`.
- **Already filtered**: the entry doesn't render — there's only
  ever one filter per sheet.
- **Concurrent creates**: if two clients click "Create filter"
  at the same time, the server returns 409 to the loser; the UI
  surfaces a generic error and the loser sees the winner's
  filter via SSE.

## Visual feedback

- The bordered rectangle appears immediately on success.
- The chevron icon (`sheet.filter.column-icon`) renders in each
  header cell once Phase C ships.

## Rationale

Right-click is the universal "contextual actions for this thing"
gesture. Selecting first, then choosing Create filter, makes the
target rectangle explicit and matches Google Sheets'
"Data → Create filter" flow on a selection.
