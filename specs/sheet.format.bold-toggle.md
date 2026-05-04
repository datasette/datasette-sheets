---
id: sheet.format.bold-toggle
title: Cmd/Ctrl+B toggles bold on the whole selection
category: format
status: draft
related:
  - sheet.format.numeric-align-right
---

## Trigger

- Cmd+B (macOS) or Ctrl+B on a focused cell not in edit mode.

## Effect

1. Push the current format state to the undo stack.
2. Read the bold state of the **active cell** (not any other cell).
3. Compute `new_bold = !active_cell_is_bold`.
4. Apply `bold = new_bold` to every cell in the selection (including
   the active cell and all other selected cells).

## Edge cases

- **Mixed selection** (some bold, some not): the direction is
  determined by the active cell alone — not by majority vote. Users
  see the active cell's state as "authoritative".
- **In edit mode:** Cmd+B is passed through to the text input for
  any native bold behaviour; does not toggle cell-level bold.
- **No selection:** no-op.

## Visual feedback

- Selected cells re-render with or without bold weight immediately.

## Rationale

Matches Excel / Google Sheets. Using the active cell as the "read"
source for toggle direction is the standard solution to the mixed-
state problem.
