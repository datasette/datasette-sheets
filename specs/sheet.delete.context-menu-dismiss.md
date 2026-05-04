---
id: sheet.delete.context-menu-dismiss
title: Context menus dismiss on outside click or Escape
category: delete
status: draft
related:
  - sheet.delete.row-right-click
  - sheet.delete.column-right-click
  - sheet.tabs.right-click-menu
---

## Trigger

- A context menu is open AND one of:
  - Any click outside the menu.
  - The Escape key.
  - Another context menu opens (second right-click).

## Effect

- Close the menu. Do not apply the hovered item.
- Do not change the selection or any other state.

## Edge cases

- **Click on a menu item:** dispatches that item's action. Menu
  closes as part of that flow, not via this spec.
- **Click inside the menu but not on an item** (e.g. padding
  around an item): menu stays open.

## Visual feedback

- Menu disappears.

## Rationale

Universal menu dismissal idiom. Users should never feel "trapped" in
a menu.
