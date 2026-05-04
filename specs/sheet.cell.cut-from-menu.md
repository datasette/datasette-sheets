---
id: sheet.cell.cut-from-menu
title: "\"Cut\" in the cell context menu copies cell values + flags for removal"
category: cell
status: draft
related:
  - sheet.cell.context-menu
  - sheet.clipboard.cut
  - sheet.cell.copy-from-menu
---

## Trigger

- Click "Cut" in the cell context menu.

## Effect

- Same observable result as `sheet.clipboard.cut` (Cmd/Ctrl+X): the
  selection is written to the OS clipboard, the dashed border paints
  over the source, and the clipboard mode flips to "cut" — so the
  next paste will clear the source cells.

## Edge cases

- Same as `sheet.cell.copy-from-menu`.

## Visual feedback

- Same dashed border as copy; the only difference is what paste does
  next (see `sheet.clipboard.paste`).

## Rationale

Pairs with the menu's Copy and Paste items so the full clipboard
verb set is available without leaving the context menu.
