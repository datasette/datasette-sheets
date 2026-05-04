---
id: sheet.format.italic-toggle
title: Cmd/Ctrl+I toggles italic on the whole selection
category: format
status: draft
related:
  - sheet.format.bold-toggle
---

## Trigger

- Cmd+I (macOS) or Ctrl+I on a focused cell not in edit mode.

## Effect

1. Push the current format state to the undo stack.
2. Read the italic state of the **active cell** (not any other cell).
3. Compute `new_italic = !active_cell_is_italic`.
4. Apply `italic = new_italic` to every cell in the selection
   (including the active cell and all other selected cells).

## Edge cases

- **Mixed selection** (some italic, some not): the direction is
  determined by the active cell alone — not by majority vote. Users
  see the active cell's state as "authoritative".
- **In edit mode:** Cmd+I is passed through to the text input for
  any native italic behaviour; does not toggle cell-level italic.
- **No selection:** no-op.

## Visual feedback

- Selected cells re-render in italic (or back to upright) immediately.

## Rationale

Matches the long-standing Cmd+B bold shortcut and Excel / Google
Sheets. Using the active cell as the "read" source for toggle
direction is the standard solution to the mixed-state problem.
