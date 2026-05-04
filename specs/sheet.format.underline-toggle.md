---
id: sheet.format.underline-toggle
title: Cmd/Ctrl+U toggles underline on the whole selection
category: format
status: draft
related:
  - sheet.format.bold-toggle
  - sheet.format.strikethrough-toggle
---

## Trigger

- Cmd+U (macOS) or Ctrl+U on a focused cell not in edit mode.

## Effect

1. Push the current format state to the undo stack.
2. Read the underline state of the **active cell**.
3. Compute `new_underline = !active_cell_is_underlined`.
4. Apply `underline = new_underline` to every cell in the selection.

## Edge cases

- **Mixed selection:** direction is determined by the active cell
  alone — same rule as bold / italic.
- **In edit mode:** Cmd+U is passed through to the input.
- **No selection:** no-op.
- **Combined with strikethrough:** a cell with both flags renders
  both lines — CSS stacks them as `text-decoration: underline
  line-through`.

## Visual feedback

- Selected cells re-render with an underline (or without) immediately.

## Rationale

Matches Excel / Google Sheets. Active-cell-authoritative toggle
direction avoids the mixed-state ambiguity.
