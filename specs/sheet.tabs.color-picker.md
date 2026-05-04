---
id: sheet.tabs.color-picker
title: Color picker in tab context menu sets tab color
category: tabs
status: draft
related:
  - sheet.tabs.right-click-menu
---

## Trigger

- "Color" item in the tab context menu is clicked.

## Effect

1. Open an inline palette of preset colour swatches within the menu
   (typical: 8 colours). The menu does **not** close.
2. Clicking a swatch sets the tab's colour; persist.
3. The currently-selected colour is indicated by a ring / stronger
   border on that swatch.

## Edge cases

- **Click the current colour:** no-op.
- **Click outside the menu:** closes the menu without changing the
  colour (standard menu dismissal).

## Visual feedback

- The tab's associated colour dot (a small circle adjacent to the
  tab label) updates immediately.
- Active swatch highlight — a coloured ring or double border so
  users can tell which one is current.

## Rationale

Matches Google Sheets tab colouring. Limiting to a preset palette
(rather than free colour picker) ensures visual consistency and
accessible contrast.
