---
id: sheet.delete.delete-key-clears
title: Delete/Backspace clears selected cell values, preserves format
category: delete
status: draft
related:
  - sheet.delete.row-confirm
  - sheet.delete.column-confirm
  - sheet.undo.scope
---

## Trigger

- Delete or Backspace key on a focused cell not in edit mode.

## Effect

1. Push the current cell state to the undo stack.
2. For each cell in the current selection:
   - Set its raw value to empty string.
3. Formatting (bold, number format, currency symbol, etc.) is
   **preserved** — only content is cleared.

## Edge cases

- **Single-cell selection:** only that cell is cleared.
- **Multi-cell or full-column/row selection:** every cell in the
  selection is cleared in one undo-able operation.
- **Inside edit mode:** Delete/Backspace behave as normal text-editing
  keys on the input; must not clear other cells.
- **Empty cells in selection:** no-op for those cells (no wasted
  write).

## Visual feedback

- Cell content disappears; the selection outline remains. Status
  bar (if it shows stats) updates immediately.

## Rationale

Matches Excel / Google Sheets. Preserving format lets users "reset
values" on a template row without re-applying formatting.
