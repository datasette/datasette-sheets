---
id: sheet.tabs.click-switch
title: Click a sheet tab to switch active sheet
category: tabs
status: draft
related:
  - sheet.tabs.add
  - sheet.tabs.right-click-menu
  - sheet.clipboard.sheet-switch-clears-mark
---

## Trigger

- Left-click on a sheet tab that is not the currently-active sheet.
- Precondition: the tab is not currently in rename mode.

## Effect

1. Flush any pending saves on the current sheet (see
   `sheet.save.flush-on-commit` semantics).
2. Close any open tab context menu.
3. Switch the active sheet:
   - Load cells and column widths from persistence.
   - Reset selection and anchor to defaults for the new sheet (e.g.
     A1 solo-selected).
   - Clear the undo / redo stacks.
   - Reconnect any per-sheet real-time channels (presence, SSE).
4. Clear the clipboard mark if one was active (see
   `sheet.clipboard.sheet-switch-clears-mark`).

## Edge cases

- **Tab is already active:** no-op.
- **Tab in rename mode:** clicks are interpreted by the rename input.

## Visual feedback

- Active tab gains the "active" style: brighter background, bolder
  weight, and a bottom border that merges with the grid boundary so
  it looks attached. Other tabs render in the inactive style.

## Rationale

Baseline multi-sheet UX.
