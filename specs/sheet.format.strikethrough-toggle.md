---
id: sheet.format.strikethrough-toggle
title: Cmd/Ctrl+Shift+X toggles strikethrough on the whole selection
category: format
status: draft
related:
  - sheet.format.bold-toggle
  - sheet.format.underline-toggle
---

## Trigger

- Cmd+Shift+X (macOS) or Ctrl+Shift+X on a focused cell not in edit
  mode. Matches the Google Sheets default binding.

## Effect

1. Push the current format state to the undo stack.
2. Read the strikethrough state of the **active cell**.
3. Compute `new_strike = !active_cell_is_struck`.
4. Apply `strikethrough = new_strike` to every cell in the selection.

## Edge cases

- **Mixed selection:** direction is determined by the active cell
  alone — same rule as bold / italic / underline.
- **In edit mode:** the keystroke is not claimed; any native handler
  sees it.
- **No selection:** no-op.
- **Combined with underline:** the cell renders both lines at once
  (`text-decoration: underline line-through`).

## Visual feedback

- Selected cells re-render with or without a line through the text
  immediately.

## Rationale

Matches Google Sheets. Requires the Shift modifier because plain
Cmd+X is already bound to Cut.
