---
id: sheet.tabs.drag-reorder
title: Drag a tab to reorder sheets
category: tabs
status: draft
related:
  - sheet.tabs.move-left-right
  - sheet.tabs.right-click-menu
---

## Trigger

- User presses and holds on a sheet tab, then drags it horizontally
  across the tab strip.

## Effect

- The dragged tab fades visibly (reduced opacity) so the user can
  see which tab is in flight.
- While the pointer is over another tab, an accent-coloured vertical
  bar appears on the left or right edge of that tab, indicating
  where the dragged tab will be dropped. Left-of-midpoint drops
  before the target, right-of-midpoint drops after.
- Releasing over a tab commits the new order: the workbook is
  reordered to the sequence shown by the indicator, and the server
  is informed so the order persists across reloads.
- Releasing outside the tab strip, or onto the originating tab,
  cancels without any change.
- The active sheet does not change as a side-effect of a drag.

## Edge cases

- **Only one sheet:** dragging is a no-op; there is nowhere to move.
- **Dragging a tab that is being renamed:** drag is suppressed — the
  rename input takes focus priority. Commit or cancel the rename
  first.
- **Server rejects the new order:** the optimistic local reorder is
  reverted so the strip returns to its previous order and an error
  surfaces.

## Visual feedback

- Source tab at ~40% opacity during the drag.
- Accent-colour 2px vertical bar on the drop edge of the hovered
  target tab.

## Rationale

Standard drag-to-reorder convention — matches Google Sheets / Excel
tab strips. Keyboard-accessible equivalent lives at
`sheet.tabs.move-left-right`.
