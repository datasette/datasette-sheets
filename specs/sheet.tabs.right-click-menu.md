---
id: sheet.tabs.right-click-menu
title: Right-click a tab to open its context menu
category: tabs
status: draft
related:
  - sheet.tabs.color-picker
  - sheet.tabs.delete
  - sheet.delete.context-menu-dismiss
---

## Trigger

- Right-click on a sheet tab.

## Effect

- Open a floating context menu at the pointer coordinates. Menu
  items in order:
  1. "Rename" — enters rename mode for this tab.
  2. "Color" — opens an inline colour picker within the menu (does
     not close the menu).
  3. "Move left" — swaps this tab with its left neighbour; disabled
     on the first tab. See `sheet.tabs.move-left-right`.
  4. "Move right" — swaps this tab with its right neighbour;
     disabled on the last tab.
  5. "Delete" — shown only if more than one sheet exists; opens the
     delete confirm (see `sheet.tabs.delete`).
- A second right-click on the **same** tab toggles the menu closed.
- A right-click on a **different** tab closes the old menu and
  opens a new one on the new tab.
- Menu must escape any overflow clip of the tab strip — use
  absolute/fixed positioning so it can extend above or beside the
  strip.

## Edge cases

- **Last remaining sheet:** "Delete" is hidden (cannot delete the
  only sheet).
- **Tab is active vs. inactive:** menu contents are the same. The
  right-click does not change the active sheet.

## Visual feedback

- Menu appears with a subtle shadow, anchored at the pointer.
  Destructive action ("Delete") in the error colour.

## Rationale

Standard right-click contextual actions.
