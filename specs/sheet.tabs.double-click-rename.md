---
id: sheet.tabs.double-click-rename
title: Double-click a tab to rename it inline
category: tabs
status: draft
related:
  - sheet.tabs.rename-commit
  - sheet.tabs.right-click-menu
---

## Trigger

- Double-click on a sheet tab.

## Effect

1. Enter rename mode for that tab.
2. Replace the tab's name label with a text input.
3. Populate the input with the current sheet name.
4. Auto-focus the input with the text selected (so typing replaces).

## Edge cases

- **Double-click during an existing rename on another tab:** commit
  the first rename first (per `sheet.tabs.rename-commit` blur
  semantics), then enter rename on the new tab.
- **Tab is currently active:** allowed — rename does not deactivate.
- **Tab is inactive:** rename does not imply "switch to this tab".
  The active sheet stays unchanged.

## Visual feedback

- Input visually replaces the label in-place, same size; caret
  visible; selected text highlighted.

## Rationale

Matches Google Sheets / Finder folder rename idiom.
