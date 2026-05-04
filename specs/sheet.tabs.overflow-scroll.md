---
id: sheet.tabs.overflow-scroll
title: Tab strip scrolls horizontally when tabs exceed available width
category: tabs
status: draft
---

## Trigger

- Number or total width of tabs exceeds the width of the tab strip
  container.

## Effect

- The tab strip gains horizontal scroll. Tabs do not shrink below a
  readable minimum width.
- Scrolling with horizontal wheel / trackpad gesture works as usual.
- Context menus anchored to tabs must use absolute or fixed
  positioning so they are not clipped by the scroll container.

## Edge cases

- **Active tab off-screen:** scroll the strip to bring it into view
  when the sheet is switched to.
- **New tab added:** scroll to the end so the just-created tab is
  visible.

## Visual feedback

- A subtle scrollbar (platform-appropriate) or fade-out at the ends
  of the strip to indicate overflow.

## Rationale

Allows many-sheet workbooks without collapsing tab labels into
unreadable mush.
