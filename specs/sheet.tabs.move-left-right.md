---
id: sheet.tabs.move-left-right
title: Move tab left/right from the context menu
category: tabs
status: draft
related:
  - sheet.tabs.drag-reorder
  - sheet.tabs.right-click-menu
---

## Trigger

- User right-clicks a tab and chooses "Move left" or "Move right"
  from the context menu.

## Effect

- The tab swaps positions with its immediate neighbour in the
  chosen direction.
- The workbook order is persisted to the server; the change
  survives reloads.
- The context menu closes on selection.
- The active sheet does not change.

## Edge cases

- **First tab + "Move left":** the menu item is disabled.
- **Last tab + "Move right":** the menu item is disabled.
- **Single-sheet workbook:** both items are disabled (there is
  nowhere to move).
- **Server rejects the reorder:** the optimistic local change is
  reverted so the strip returns to its previous order.

## Visual feedback

- Disabled menu items render in the secondary text colour at
  reduced opacity and do not respond to hover.
- On commit the tab animates to its new slot (the browser's native
  reflow handles this — no explicit transition).

## Rationale

Keyboard/menu equivalent of `sheet.tabs.drag-reorder` so
accessibility tooling and users who don't drag can still reorder.
Two-item pair matches the Google Sheets tab menu's pattern.
