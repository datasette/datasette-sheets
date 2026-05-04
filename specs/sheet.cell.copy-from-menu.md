---
id: sheet.cell.copy-from-menu
title: "\"Copy\" in the cell context menu copies cell values"
category: cell
status: draft
related:
  - sheet.cell.context-menu
  - sheet.clipboard.copy
  - sheet.cell.cut-from-menu
---

## Trigger

- Click "Copy" in the cell context menu.

## Effect

- Same observable result as `sheet.clipboard.copy` (Cmd/Ctrl+C):
  the selection is written to the OS clipboard as both `text/html`
  (a styled table) and `text/plain` (TSV), and the dashed clipboard
  border ("marching ants") paints over the source range.

## Edge cases

- **No clipboard permission** (insecure context, denied prompt): the
  copy is a no-op; the marching-ants border is not painted.
- **Empty selection**: no-op.

## Visual feedback

- Same as `sheet.clipboard.mark-visual` — dashed coloured border on
  the source range.

## Rationale

Right-click is the universal "what can I do with this?" gesture. A
menu item with the same payload as Cmd/Ctrl+C ensures discoverable
parity with the keyboard shortcut.
